"""The floor plan design assistant: Muse Wonder lays out a plan from a description by calling the tools in
gt/floorplan.py, room by room. The tools place rooms, doors and windows and refuse what does not fit; check()
decides when the plan is finished. Same loop shape as gt/agent.py (Responses API, stateless replay), but tool
calls run in order, because a room can be placed against one added earlier in the same turn.
"""

import copy
import json
import time
from typing import Callable

from .config import PRICE, WONDER, meta_client
from .floorplan import BUILDING_KINDS, ROOM_TYPES, PlanBuilder, check, describe
from .spark import Usage

NUM = {"type": "number"}
SIDE = {"type": "string", "enum": ["north", "south", "east", "west"]}
ROOM = {"type": "string", "description": "room name or id"}


def _fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}}


PLAN_TOOLS = [
    _fn("add_room",
        "Add a rectangular room. Prefer next_to + side (+ align): the room is placed flush against that room's north, "
        "south, east or west wall, aligned to its start (west or north end), center or end. Use x and y (its north-west "
        "corner, metres) only for the first room. Refused if it would overlap another room.",
        {"name": {"type": "string"}, "type": {"type": "string", "enum": list(ROOM_TYPES)}, "width": {**NUM, "description": "east-west size, m"},
         "depth": {**NUM, "description": "north-south size, m"}, "x": NUM, "y": NUM, "next_to": ROOM, "side": SIDE,
         "align": {"type": "string", "enum": ["start", "center", "end"]}}, ["name", "type", "width", "depth"]),
    _fn("update_room", "Rename, retype, move or resize a room. Refused if it would overlap another room.",
        {"room": ROOM, "name": {"type": "string"}, "type": {"type": "string", "enum": list(ROOM_TYPES)}, "x": NUM, "y": NUM,
         "width": NUM, "depth": NUM}, ["room"]),
    _fn("remove_room", "Remove a room and its doors and windows.", {"room": ROOM}, ["room"]),
    _fn("connect",
        "Put a door (or an open passage for open-plan spaces) in the wall two rooms share. The tool finds the wall and "
        "the position; the door swings into the room you enter, never into a hallway.",
        {"room_a": ROOM, "room_b": ROOM, "kind": {"type": "string", "enum": ["door", "passage"]}, "width": NUM}, ["room_a", "room_b"]),
    _fn("add_entrance", "Put the entrance door on an outside wall of a room (usually a hallway or living room).",
        {"room": ROOM, "side": SIDE, "width": NUM}, ["room"]),
    _fn("add_window", "Put windows on an outside wall of a room (the longest one if no side is given).",
        {"room": ROOM, "side": SIDE, "width": NUM, "count": {"type": "integer", "minimum": 1, "maximum": 4}}, ["room"]),
    _fn("remove_opening", "Remove a door, passage or window by its id.", {"opening": {"type": "string"}}, ["opening"]),
    _fn("check_plan",
        "Measure the plan: errors that must be fixed (overlaps, no entrance, rooms that can't be reached), warnings "
        "(rooms without windows, rooms smaller than usual), the total floor area, and every room with its neighbours.",
        {}, []),
    _fn("finish", "Finish with a short summary for the client. Refused while check_plan reports errors.",
        {"summary": {"type": "string"}, "name": {"type": "string", "description": "a short name for the plan"},
         "kind": {"type": "string", "enum": list(BUILDING_KINDS), "description": "the type of building"}}, ["summary"]),
]

SYSTEM = (
    "You are the GroundTruth design assistant. You lay out floor plans for homes, offices, shops and clinics by "
    "calling tools; the tools do all the measuring. Coordinates are metres: x grows east, y grows south, north is "
    "up. Rooms are rectangles.\n"
    "1. In a short note, list the rooms you will make with their sizes, so they add up to the requested area "
    "(circulation included). Usual sizes: double bedroom 11-16 m², single bedroom 8-11, bathroom 4-6, WC 1.5-2.5, "
    "kitchen 7-12, living room 16-30, hallway 1.1-1.4 m wide; offices about 6-10 m² per desk-based person.\n"
    "2. Add the rooms. Start with one room at x 0, y 0, then place each room with next_to, side and align, so walls "
    "line up exactly. Keep the footprint compact; a hallway or the living area should reach every room. Several "
    "add_room calls can go in one turn; they run in order.\n"
    "3. Connect the rooms with doors (passage for open-plan spaces such as kitchen to living), add one entrance on "
    "an outside wall, and windows on outside walls of every bedroom, living room, kitchen and office.\n"
    "4. Call check_plan, fix every error and the warnings you reasonably can, then call finish with a two or three "
    "sentence summary for the client that quotes the measured total area.\n"
    "If a tool refuses, read its reason and adjust; never assume a call worked. When the request changes an "
    "existing plan, keep what is not mentioned."
)


def _brief(tool: str, args: dict, out: dict) -> str:
    if "error" in out:
        return ("Refused to finish: " if tool == "finish" else "Refused: ") + out["error"]
    if tool == "add_room":
        r = out["added"]
        return f"Added {r['room']}, {r['width']:.2f} × {r['depth']:.2f} m ({r['area_m2']:.1f} m²)"
    if tool == "update_room":
        r = out["updated"]
        return f"Updated {r['room']}: {r['width']:.2f} × {r['depth']:.2f} m at x {r['x']}, y {r['y']}"
    if tool == "remove_room":
        return f"Removed {out['removed']}"
    if tool == "connect":
        return f"{'Door' if out['added'] == 'door' else 'Open passage'} between {out['between'][0]} and {out['between'][1]}"
    if tool == "add_entrance":
        return f"Entrance door on the {out['on_wall']}"
    if tool == "add_window":
        return f"{out['added'].replace('(s)', 's' if out['added'][0] != '1' else '')} in {out['room']}"
    if tool == "remove_opening":
        return f"Removed opening {out['removed']}"
    if tool == "check_plan":
        return f"Checked: {len(out['errors'])} errors, {len(out['warnings'])} warnings, {out['total_area_m2']:.1f} m² in {out['rooms']} rooms"
    if tool == "finish":
        return "Finished"
    return tool


def _text(item) -> str:
    return " ".join(part.text for part in getattr(item, "content", None) or [] if getattr(part, "text", None)).strip()


def run_planner(request: str, plan: dict | None = None, *, model: str = WONDER, effort: str = "medium", max_turns: int = 14,
                on_event: Callable[[dict], None] = lambda event: None, client=None) -> dict:
    """Lays out (or changes) a plan from a request. on_event gets note, turn and tool events; a tool event that
    changed the plan carries the whole plan, so a browser can draw it as it grows."""
    builder = PlanBuilder(plan)
    client = client or meta_client()
    usage = Usage(PRICE["wonder_in_per_m"], PRICE["wonder_out_per_m"]) if model == WONDER else Usage()
    conversation: list = [{"role": "user", "content": f"Request: {request}\n\nCurrent plan (metres; x east, y south):\n{describe(builder.plan)}"}]
    trace: list[dict] = []
    started, turn = time.time(), 0
    for turn in range(1, max_turns + 1):
        t0 = time.time()
        response = client.responses.create(model=model, instructions=SYSTEM, input=conversation, tools=PLAN_TOOLS,
                                           reasoning={"effort": effort}, max_output_tokens=12000)
        usage.add(response.usage)
        if response.status != "completed":
            raise RuntimeError(f"planner turn {turn}: response {response.status} ({response.incomplete_details})")
        conversation += [item.model_dump(exclude_none=True) for item in response.output]
        for item in response.output:
            if item.type == "message" and _text(item):
                trace.append({"turn": turn, "type": "note", "text": _text(item)})
                on_event({"type": "note", "turn": turn, "text": _text(item)})
        calls = [item for item in response.output if item.type == "function_call"]
        on_event({"type": "turn", "turn": turn, "calls": len(calls), "thinking_s": round(time.time() - t0, 1), "cost_usd": round(usage.cost, 4)})
        if not calls:
            if builder.finished:
                break
            conversation.append({"role": "user", "content": "Continue with the tools; call finish when check_plan shows no errors."})
            continue
        for call in calls:  # in order: a room may be placed against one added by an earlier call
            try:
                args = json.loads(call.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            output = builder.call(call.name, args)
            ok = "error" not in output
            event = {"type": "tool", "turn": turn, "tool": call.name, "args": args, "ok": ok, "brief": _brief(call.name, args, output)}
            if ok and call.name not in ("check_plan", "finish"):
                event["plan"] = copy.deepcopy(builder.plan)
            on_event(event)
            trace.append({"turn": turn, "type": "tool", "tool": call.name, "args": args, "ok": ok, "brief": event["brief"]})
            conversation.append({"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(output)})
        if builder.finished:
            break
    return {"plan": builder.plan, "finished": bool(builder.finished), "summary": builder.finished, "name": builder.name, "kind": builder.kind,
            "check": check(builder.plan), "model": model, "turns": turn, "seconds": round(time.time() - started, 1),
            "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens, "cost_usd": round(usage.cost, 4), "trace": trace}
