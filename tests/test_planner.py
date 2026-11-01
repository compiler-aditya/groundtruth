"""Offline check of the design assistant's loop: Muse Wonder is replaced by a scripted client."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from gt.planner import PLAN_TOOLS, run_planner  # noqa: E402


def call(n, tool, **args):
    item = NS(type="function_call", name=tool, arguments=json.dumps(args), call_id=f"c{n}")
    item.model_dump = lambda **kw: {"type": "function_call", "name": tool, "arguments": json.dumps(args), "call_id": f"c{n}"}
    return item


def note(text):
    item = NS(type="message", content=[NS(text=text)])
    item.model_dump = lambda **kw: {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}
    return item


TURNS = [
    [note("Plan: a 12 m² studio room and a 4 m² bathroom."),
     call(1, "add_room", name="Studio", type="living", width=4, depth=3, x=0, y=0),
     call(2, "add_room", name="Bathroom", type="bathroom", width=2, depth=2, next_to="Studio", side="east"),
     call(3, "add_room", name="Clash", type="other", width=2, depth=2, x=1, y=1),  # refused: overlaps
     call(4, "finish", summary="done")],                                           # refused: no entrance
    [call(5, "add_entrance", room="Studio", side="south"), call(6, "connect", room_a="Studio", room_b="Bathroom"),
     call(7, "add_window", room="Studio"), call(8, "check_plan")],
    [call(9, "finish", summary="A 16 m² studio with a bathroom.", name="Tiny studio")],
]
sent = []


class FakeResponses:
    def create(self, **kw):
        sent.append(kw)
        assert kw["tools"] is PLAN_TOOLS and kw["model"] == "muse-wonder-1.0"
        return NS(output=TURNS[len(sent) - 1], usage=NS(input_tokens=1000, output_tokens=200), status="completed", incomplete_details=None)


events = []
result = run_planner("a tiny studio", client=NS(responses=FakeResponses()), on_event=events.append)
assert result["finished"] and result["name"] == "Tiny studio" and result["turns"] == 3, result
assert [r["name"] for r in result["plan"]["rooms"]] == ["Studio", "Bathroom"]
assert result["check"]["errors"] == [] and result["check"]["total_area_m2"] == 16, result["check"]
tools = [e for e in events if e["type"] == "tool"]
assert [e["ok"] for e in tools] == [True, True, False, False, True, True, True, True, True], [e["brief"] for e in tools]
assert tools[2]["brief"].startswith("Refused: Clash at x 1") and "overlap Studio" in tools[2]["brief"]
assert tools[3]["brief"].startswith("Refused to finish: not finished, fix these first: There is no entrance")
assert "plan" in tools[0] and len(tools[1]["plan"]["rooms"]) == 2 and "plan" not in tools[2] and "plan" not in tools[7]
assert tools[1]["plan"]["rooms"][1]["x"] == 4  # placed against the studio's east wall by the code
# each refusal reached the model, so it could correct itself
outputs = [json.loads(i["output"]) for i in sent[1]["input"] if isinstance(i, dict) and i.get("type") == "function_call_output"]
assert "error" in outputs[2] and "error" in outputs[3], outputs
assert events[0] == {"type": "note", "turn": 1, "text": "Plan: a 12 m² studio room and a 4 m² bathroom."}
assert abs(result["cost_usd"] - 3 * (1000 * 4 + 200 * 20) / 1e6) < 1e-9, result["cost_usd"]

# changing an existing plan keeps its rooms and ids
existing = {"rooms": [{"id": "r1", "name": "Hall", "type": "hallway", "x": 0, "y": 0, "w": 5, "h": 1.2}], "openings": [], "items": []}
TURNS[:] = [[call(1, "add_room", name="Office", type="office", width=3, depth=3, next_to="r1", side="south", align="end")], []]
sent.clear()
edited = run_planner("add an office", existing, client=NS(responses=FakeResponses()), max_turns=2)
assert not edited["finished"] and [r["id"] for r in edited["plan"]["rooms"]][0] == "r1"
assert (edited["plan"]["rooms"][1]["x"], edited["plan"]["rooms"][1]["y"]) == (2, 1.2), edited["plan"]["rooms"]
assert "Hall [id r1, hallway]" in sent[0]["input"][0]["content"]
print("planner: all checks passed")

# the web endpoint streams start, the assistant's events and done, and frees its run slot
from fastapi.testclient import TestClient  # noqa: E402

import app  # noqa: E402


def fake_planner(text, plan, on_event):
    on_event({"type": "tool", "tool": "add_room", "ok": True, "brief": "Added Hall", "plan": {"rooms": [], "openings": [], "items": []}})
    return {"plan": plan or {"rooms": []}, "finished": True, "summary": f"for {text}"}


app.run_planner = fake_planner
web = TestClient(app.app)
lines = [json.loads(line) for line in web.post("/api/plan/assist", json={"request": "a  small\nhouse", "mode": "new"}).text.splitlines()]
assert [e["type"] for e in lines] == ["start", "tool", "done"] and lines[-1]["summary"] == "for a small house", lines
assert app._active == 0
edit = [json.loads(line) for line in web.post("/api/plan/assist", json={"request": "add a room", "mode": "edit", "plan": existing}).text.splitlines()]
assert edit[0]["mode"] == "edit" and edit[-1]["plan"]["rooms"][0]["id"] == "r1", edit
assert web.post("/api/plan/assist", json={"request": "x"}).status_code == 400
print("planner endpoint: all checks passed")
