"""Floor plan geometry, the plan checks, and the tools the design assistant builds plans with.

Plans use the editor's format (public/plans.js): metres, x grows east and y grows south. Rooms are rectangles
{id, name, type, x, y, w, h}. Openings sit on one room's wall: {id, type: door|window|opening, room,
side: n|s|e|w, at: distance from the wall's start (west or north end) to the centre, width, hinge, swing}.

Everything here is measured, never estimated: the assistant proposes rooms and openings, these functions place
them, refuse what does not fit, and check() decides whether a plan is ready.
"""

from __future__ import annotations

import copy
import uuid

EPS = 0.02
SIDES = {"north": "n", "south": "s", "west": "w", "east": "e", "n": "n", "s": "s", "w": "w", "e": "e"}
SIDE_NAME = {"n": "north", "s": "south", "w": "west", "e": "east"}
ROOM_TYPES = ("living", "bedroom", "kitchen", "dining", "bathroom", "hallway", "office", "meeting", "reception",
              "storage", "garage", "balcony", "utility", "retail", "other")
# Rules of thumb for a first layout, not building-code minimums (those vary by country and need a professional).
MIN_AREA = {"bedroom": 7.0, "living": 12.0, "kitchen": 5.0, "bathroom": 2.5, "office": 6.0, "meeting": 8.0, "dining": 6.0}
MIN_SIDE = {"bedroom": 2.4, "living": 3.0, "kitchen": 1.8, "bathroom": 1.2, "hallway": 0.9, "office": 2.0}
NEEDS_WINDOW = {"bedroom", "living", "kitchen", "office", "meeting", "dining", "reception"}
MIN_DOOR = 0.8
MAX_ROOMS, MAX_SIZE = 60, 60.0
BUILDING_KINDS = ("house", "apartment", "office", "shop", "clinic", "other")


def r2(v: float) -> float:
    return round(v + 0.0, 2)


def snap(v: float, step: float = 0.05) -> float:
    return r2(round(v / step) * step)


def area(room: dict) -> float:
    return room["w"] * room["h"]


def edges(room: dict) -> list[tuple]:
    """(side, orientation, line coordinate, start, end) for each wall of a room."""
    x, y, w, h = room["x"], room["y"], room["w"], room["h"]
    return [("n", "h", y, x, x + w), ("s", "h", y + h, x, x + w), ("w", "v", x, y, y + h), ("e", "v", x + w, y, y + h)]


def side_edge(room: dict, side: str) -> tuple:
    return next(e for e in edges(room) if e[0] == side)


def overlap(a: dict, b: dict) -> float:
    w = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
    h = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
    return w * h if w > EPS and h > EPS else 0.0


def shared(plan: dict, room: dict, side: str) -> list[tuple[dict, float, float]]:
    """The other rooms on the far side of this wall, with the stretch of wall each one shares."""
    _, o, c, a, b = side_edge(room, side)
    out = []
    for other in plan["rooms"]:
        if other is room or other["id"] == room["id"]:
            continue
        for _, o2, c2, a2, b2 in edges(other):
            lo, hi = max(a, a2), min(b, b2)
            if o2 == o and abs(c2 - c) < EPS and hi - lo > EPS:
                out.append((other, lo, hi))
    return out


def exterior_runs(plan: dict, room: dict, side: str) -> list[tuple[float, float]]:
    """Stretches of this wall that face outside (no other room behind them)."""
    _, _, _, a, b = side_edge(room, side)
    runs = [(a, b)]
    for _, lo, hi in sorted(shared(plan, room, side), key=lambda s: s[1]):
        nxt = []
        for p, q in runs:
            if hi <= p + EPS or lo >= q - EPS:
                nxt.append((p, q))
                continue
            if lo > p + EPS:
                nxt.append((p, lo))
            if hi < q - EPS:
                nxt.append((hi, q))
        runs = nxt
    return [(r2(p), r2(q)) for p, q in runs if q - p > EPS]


def room_by_id(plan: dict, rid: str) -> dict | None:
    return next((r for r in plan["rooms"] if r["id"] == rid), None)


def opening_span(plan: dict, op: dict) -> tuple | None:
    """(orientation, line coordinate, start, end) of an opening, clamped to its wall like the editor draws it."""
    room = room_by_id(plan, op["room"])
    if not room:
        return None
    _, o, c, a, b = side_edge(room, op["side"])
    width = min(op["width"], b - a)
    at = min(max(op["at"], width / 2), b - a - width / 2)
    return o, c, a + at - width / 2, a + at + width / 2


def connects(plan: dict, op: dict) -> set[str]:
    """Room IDs (and "outside") that a door or passage leads to from its own room."""
    span = opening_span(plan, op)
    room = room_by_id(plan, op["room"])
    if not span or not room:
        return set()
    _, _, a, b = span
    out = {other["id"] for other, lo, hi in shared(plan, room, op["side"]) if lo < b - EPS and hi > a + EPS}
    if any(p - EPS <= a and b <= q + EPS for p, q in exterior_runs(plan, room, op["side"])):
        out.add("outside")
    return out


def clashes(plan: dict, span: tuple, ignore: str = "") -> bool:
    o, c, a, b = span
    for op in plan["openings"]:
        other = opening_span(plan, op) if op["id"] != ignore else None
        if other and other[0] == o and abs(other[1] - c) < EPS and other[2] < b - EPS and a < other[3] - EPS:
            return True
    return False


def check(plan: dict) -> dict:
    """Errors (the plan is not finished) and warnings (worth a look), with the measured totals."""
    rooms, errors, warnings = plan["rooms"], [], []
    name = {r["id"]: r["name"] for r in rooms}
    for i, a in enumerate(rooms):
        for b in rooms[i + 1:]:
            if overlap(a, b):
                errors.append(f"{a['name']} and {b['name']} overlap by {overlap(a, b):.1f} m²")
    spans = [(op, opening_span(plan, op)) for op in plan["openings"]]
    for i, (op, sp) in enumerate(spans):
        if not sp:
            errors.append(f"Opening {op['id']} is on a room that no longer exists")
            continue
        for op2, sp2 in spans[i + 1:]:
            if sp2 and sp[0] == sp2[0] and abs(sp[1] - sp2[1]) < EPS and sp[2] < sp2[3] - EPS and sp2[2] < sp[3] - EPS:
                errors.append(f"Two openings overlap on a wall of {name.get(op['room'])}")
        if op["type"] == "window" and connects(plan, op) - {"outside"}:
            behind = ", ".join(name[i] for i in connects(plan, op) - {"outside"})
            warnings.append(f"A window of {name.get(op['room'])} ({op['id']}) is on a wall shared with {behind}; move it to an outside wall or remove it")
        if op["type"] == "door" and op["width"] < MIN_DOOR - EPS:
            warnings.append(f"The door into {name.get(op['room'])} is {op['width']:.2f} m wide; {MIN_DOOR:.2f} m is a usual minimum")
    # reachability: doors and passages join rooms; an entrance is a door to the outside
    links: dict[str, set[str]] = {r["id"]: set() for r in rooms} | {"outside": set()}
    for op in plan["openings"]:
        if op["type"] in ("door", "opening"):
            for other in connects(plan, op) if op["type"] == "door" else connects(plan, op) - {"outside"}:
                links.setdefault(op["room"], set()).add(other)
                links.setdefault(other, set()).add(op["room"])
    if rooms and not links["outside"]:
        errors.append("There is no entrance: add a door on an outside wall")
    seen, todo = {"outside"}, ["outside"]
    while todo:
        for nxt in links.get(todo.pop(), ()):
            if nxt not in seen:
                seen.add(nxt)
                todo.append(nxt)
    if links["outside"]:
        for r in rooms:
            if r["id"] not in seen:
                errors.append(f"{r['name']} can't be reached from the entrance: connect it with a door or passage")
    for r in rooms:
        if r["type"] in NEEDS_WINDOW and not any(op["type"] == "window" and op["room"] == r["id"] for op in plan["openings"]):
            warnings.append(f"{r['name']} has no window")
        if area(r) < MIN_AREA.get(r["type"], 0) - EPS:
            warnings.append(f"{r['name']} is {area(r):.1f} m²; a {r['type']} is usually at least {MIN_AREA[r['type']]:.0f} m²")
        if min(r["w"], r["h"]) < MIN_SIDE.get(r["type"], 0) - EPS:
            warnings.append(f"{r['name']} is only {min(r['w'], r['h']):.2f} m across")
    return {"errors": errors, "warnings": warnings, "total_area_m2": r2(sum(area(r) for r in rooms)), "rooms": len(rooms)}


def describe(plan: dict) -> str:
    """The plan as text for the assistant: each room's position, size, neighbours, outside walls and openings."""
    if not plan["rooms"]:
        return "The plan is empty."
    lines = []
    for r in plan["rooms"]:
        touches = [f"{o['name']} ({SIDE_NAME[s]}, {hi - lo:.2f} m)" for s in "nsew" for o, lo, hi in shared(plan, r, s)]
        outside = [f"{SIDE_NAME[s]} {sum(q - p for p, q in exterior_runs(plan, r, s)):.2f} m" for s in "nsew" if exterior_runs(plan, r, s)]
        ops = [f"{op['type']} {op['id']} on {SIDE_NAME[op['side']]} wall, {op['width']:.2f} m" for op in plan["openings"] if op["room"] == r["id"]]
        lines.append(f"- {r['name']} [id {r['id']}, {r['type']}]: x {r['x']}–{r2(r['x'] + r['w'])}, y {r['y']}–{r2(r['y'] + r['h'])}, "
                     f"{r['w']:.2f} × {r['h']:.2f} m = {area(r):.1f} m²; touches: {', '.join(touches) or 'nothing'}; "
                     f"outside walls: {', '.join(outside) or 'none'}; openings: {', '.join(ops) or 'none'}")
    return "\n".join(lines)


def clean(plan: dict | None) -> dict:
    """A plan from a browser, reduced to well-formed rooms, openings and items."""
    plan = plan or {}
    rooms, openings, items = [], [], []
    for r in (plan.get("rooms") or [])[:MAX_ROOMS]:
        try:
            room = {"id": str(r["id"])[:20], "name": str(r.get("name") or "Room")[:60], "type": r.get("type") if r.get("type") in ROOM_TYPES else "other",
                    "x": r2(float(r["x"])), "y": r2(float(r["y"])), "w": r2(float(r["w"])), "h": r2(float(r["h"]))}
        except (KeyError, TypeError, ValueError):
            continue
        if 0.3 <= room["w"] <= MAX_SIZE and 0.3 <= room["h"] <= MAX_SIZE and abs(room["x"]) < 500 and abs(room["y"]) < 500:
            rooms.append(room)
    ids = {r["id"] for r in rooms}
    for op in (plan.get("openings") or [])[:300]:
        try:
            if op["room"] in ids and op["side"] in "nsew" and op.get("type") in ("door", "window", "opening"):
                openings.append({"id": str(op["id"])[:20], "type": op["type"], "room": op["room"], "side": op["side"], "at": r2(float(op["at"])),
                                 "width": r2(float(op["width"])), "hinge": "end" if op.get("hinge") == "end" else "start",
                                 "swing": "out" if op.get("swing") == "out" else "in"})
        except (KeyError, TypeError, ValueError):
            continue
    for it in (plan.get("items") or [])[:300]:
        try:
            item = {"id": str(it["id"])[:20], "type": str(it["type"])[:30], "cx": r2(float(it["cx"])), "cy": r2(float(it["cy"])),
                    "w": r2(float(it["w"])), "h": r2(float(it["h"])), "rot": int(it.get("rot") or 0) % 360}
        except (KeyError, TypeError, ValueError):
            continue
        if 0.1 <= item["w"] <= 10 and 0.1 <= item["h"] <= 10:
            items.append(item)
    return {"rooms": rooms, "openings": openings, "items": items}


def new_id(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:8]


# ---------------------------------------------------------------- furniture, placed by the code against walls

ITEMS = {  # type: (width, depth) in metres, matching the editor's palette
    "bed_double": (1.6, 2.0), "bed_single": (0.9, 2.0), "sofa": (2.0, 0.9), "armchair": (0.8, 0.8), "dining_table": (1.6, 0.9),
    "meeting_table": (2.4, 1.2), "desk": (1.4, 0.7), "wardrobe": (1.2, 0.6), "counter": (2.4, 0.6), "stove": (0.6, 0.6),
    "kitchen_sink": (0.8, 0.5), "fridge": (0.7, 0.7), "toilet": (0.45, 0.7), "basin": (0.5, 0.4), "shower": (0.9, 0.9),
    "bathtub": (1.7, 0.75), "stairs": (1.0, 3.0), "car": (1.9, 4.5), "plant": (0.5, 0.5),
}
ROT = {"n": 0, "e": 90, "s": 180, "w": 270}  # rotation that puts an item's back against that wall
FREESTANDING = {"dining_table", "meeting_table", "plant", "car"}


def item_box(it: dict) -> tuple[float, float, float, float]:
    w, h = (it["h"], it["w"]) if int(it.get("rot", 0)) % 180 else (it["w"], it["h"])
    return it["cx"] - w / 2, it["cy"] - h / 2, it["cx"] + w / 2, it["cy"] + h / 2


def _hits(a: tuple, b: tuple) -> bool:
    return a[0] < b[2] - EPS and b[0] < a[2] - EPS and a[1] < b[3] - EPS and b[1] < a[3] - EPS


def keep_clear(plan: dict, room: dict) -> list[tuple]:
    """Floor in front of every door and passage on this room's walls, which furniture must leave free."""
    zones = []
    for op in plan["openings"]:
        if op["type"] == "window":
            continue
        span = opening_span(plan, op)
        if not span:
            continue
        o, c, a, b = span
        for side, o2, c2, a2, b2 in edges(room):
            if o2 == o and abs(c2 - c) < EPS and a >= a2 - EPS and b <= b2 + EPS:
                depth = min(0.95, (room["h"] if o == "h" else room["w"]) - 0.1)
                zones.append({"n": (a, c, b, c + depth), "s": (a, c - depth, b, c), "w": (c, a, c + depth, b), "e": (c - depth, a, c, b)}[side])
    return zones


class _Furnishing:
    def _item_fits(self, room: dict, box: tuple, ignore: str = "") -> bool:
        x0, y0, x1, y1 = box
        if x0 < room["x"] - EPS or y0 < room["y"] - EPS or x1 > room["x"] + room["w"] + EPS or y1 > room["y"] + room["h"] + EPS:
            return False
        if any(_hits(box, z) for z in keep_clear(self.plan, room)):
            return False
        return not any(it["id"] != ignore and _hits(box, item_box(it)) for it in self.plan["items"])

    def _carry_items(self, old: dict, new: dict) -> list[str]:
        """Furniture follows its room when it moves or is resized: a piece against a wall moves with that wall, the
        rest keep their relative place. Pieces bigger than the new room are removed; their types are returned."""
        def follow(c, half, lo, hi, nlo, nhi):
            if c - half - lo < 0.15:
                return nlo + c - lo
            if hi - c - half < 0.15:
                return nhi - (hi - c)
            return nlo + (c - lo) * (nhi - nlo) / (hi - lo)
        gone = []
        for it in self.plan["items"]:
            if not (old["x"] <= it["cx"] <= old["x"] + old["w"] and old["y"] <= it["cy"] <= old["y"] + old["h"]):
                continue
            x0, y0, x1, y1 = item_box(it)
            hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
            if 2 * hw > new["w"] + EPS or 2 * hh > new["h"] + EPS:
                gone.append(it)
                continue
            cx = follow(it["cx"], hw, old["x"], old["x"] + old["w"], new["x"], new["x"] + new["w"])
            cy = follow(it["cy"], hh, old["y"], old["y"] + old["h"], new["y"], new["y"] + new["h"])
            it["cx"] = r2(min(max(cx, new["x"] + hw), new["x"] + new["w"] - hw))
            it["cy"] = r2(min(max(cy, new["y"] + hh), new["y"] + new["h"] - hh))
        self.plan["items"] = [it for it in self.plan["items"] if it not in gone]
        return [it["type"] for it in gone]

    def _place_item(self, room: dict, kind: str, wall: str | None) -> dict | None:
        w, h = ITEMS[kind]
        if kind in FREESTANDING:  # in the middle of the free floor, nearest the centre
            cands = [(room["x"] + room["w"] / 2 + dx, room["y"] + room["h"] / 2 + dy) for dx in (0, -0.6, 0.6, -1.2, 1.2) for dy in (0, -0.6, 0.6, -1.2, 1.2)]
            for cx, cy in cands:
                it = {"id": new_id("i"), "type": kind, "cx": r2(cx), "cy": r2(cy), "w": w, "h": h, "rot": 0 if room["w"] >= room["h"] or kind == "car" and room["w"] >= 4.6 else 90}
                if self._item_fits(room, item_box(it)):
                    return it
            return None
        walls = [SIDES[wall.lower()]] if wall else sorted("nsew", key=lambda s: -(room["w"] if s in "ns" else room["h"]))
        for side in walls:
            rot = ROT[side]
            fw, fd = (h, w) if rot % 180 else (w, h)  # footprint along x, along y
            along = room["w"] if side in "ns" else room["h"]
            length = fw if side in "ns" else fd
            steps = [along / 2 - length / 2] + [i * 0.1 for i in range(int((along - length) / 0.1) + 1)]
            for start in steps:
                if side in "ns":
                    cx = room["x"] + start + fw / 2
                    cy = room["y"] + 0.03 + fd / 2 if side == "n" else room["y"] + room["h"] - 0.03 - fd / 2
                else:
                    cy = room["y"] + start + fd / 2
                    cx = room["x"] + 0.03 + fw / 2 if side == "w" else room["x"] + room["w"] - 0.03 - fw / 2
                it = {"id": new_id("i"), "type": kind, "cx": r2(cx), "cy": r2(cy), "w": w, "h": h, "rot": rot}
                if self._item_fits(room, item_box(it)):
                    return it
        return None

    def tool_add_furniture(self, room: str, type: str, wall: str | None = None) -> dict:
        r = self._room(room)
        if type not in ITEMS:
            raise ValueError(f"type must be one of {', '.join(ITEMS)}")
        it = self._place_item(r, type, wall)
        if not it:
            raise ValueError(f"no free floor in {r['name']} for a {ITEMS[type][0]} × {ITEMS[type][1]} m {type.replace('_', ' ')}"
                             f"{' on the ' + wall + ' wall' if wall else ''} (furniture keeps clear of doors and other furniture)")
        self.plan["items"].append(it)
        return {"added": type, "room": r["name"], "against": {0: "north", 90: "east", 180: "south", 270: "west"}[it["rot"]] if type not in FREESTANDING else "middle"}

    def tool_remove_furniture(self, room: str, type: str | None = None) -> dict:
        r = self._room(room)
        inside = lambda it: r["x"] <= it["cx"] <= r["x"] + r["w"] and r["y"] <= it["cy"] <= r["y"] + r["h"]  # noqa: E731
        gone = [it for it in self.plan["items"] if inside(it) and (not type or it["type"] == type)]
        self.plan["items"] = [it for it in self.plan["items"] if it not in gone]
        return {"removed": len(gone), "room": r["name"]}

    def tool_furnish_room(self, room: str) -> dict:
        """The usual furniture for the room's type, each piece placed where it fits."""
        r = self._room(room)
        a = area(r)
        plan = {
            "bedroom": ["bed_double" if a >= 9 else "bed_single", "wardrobe", *(["desk"] if a >= 13 else [])],
            "living": ["sofa", "armchair", *(["dining_table"] if a >= 24 else []), "plant"],
            "kitchen": ["counter", "fridge", "stove", "kitchen_sink", *(["dining_table"] if a >= 12 else [])],
            "dining": ["dining_table", "plant"], "bathroom": ["toilet", "basin", "bathtub" if a >= 5 else "shower"],
            "office": ["desk"] * max(1, min(6, int(a // 6))), "meeting": ["meeting_table"], "reception": ["desk", "sofa", "plant"],
            "garage": ["car"], "retail": ["counter", "plant"], "balcony": ["plant", "armchair"],
        }.get(r["type"], [])
        placed, skipped = [], []
        for kind in plan:
            it = self._place_item(r, kind, None)
            (placed if it else skipped).append(kind)
            if it:
                self.plan["items"].append(it)
        return {"room": r["name"], "placed": placed, **({"no_room_for": skipped} if skipped else {})}


class PlanBuilder(_Furnishing):
    """The assistant's tools. Each call changes the plan only if the result fits; otherwise it says why."""

    def __init__(self, plan: dict | None = None) -> None:
        self.plan = copy.deepcopy(clean(plan))
        self.finished: str | None = None
        self.name: str | None = None
        self.kind: str | None = None

    def call(self, tool: str, args: dict) -> dict:
        method = getattr(self, f"tool_{tool}", None)
        if not method:
            return {"error": f"unknown tool {tool}"}
        try:
            return method(**args)
        except (ValueError, KeyError, TypeError) as error:
            return {"error": str(error)}

    def _room(self, ref: str) -> dict:
        ref = str(ref).strip()
        hit = [r for r in self.plan["rooms"] if r["id"] == ref] or [r for r in self.plan["rooms"] if r["name"].lower() == ref.lower()]
        if len(hit) != 1:
            names = ", ".join(f"{r['name']} [{r['id']}]" for r in self.plan["rooms"]) or "none yet"
            raise ValueError(f"no single room called {ref!r} (rooms: {names})")
        return hit[0]

    def _report(self, room: dict) -> dict:
        p = self.plan
        return {"room": room["name"], "id": room["id"], "x": room["x"], "y": room["y"], "width": room["w"], "depth": room["h"],
                "area_m2": r2(area(room)),
                "touches": [{"room": o["name"], "wall": SIDE_NAME[s], "shared_m": r2(hi - lo)} for s in "nsew" for o, lo, hi in shared(p, room, s)],
                "outside_walls_m": {SIDE_NAME[s]: r2(sum(q - a for a, q in exterior_runs(p, room, s))) for s in "nsew" if exterior_runs(p, room, s)}}

    def _fits(self, room: dict) -> None:
        if not (0.8 <= room["w"] <= MAX_SIZE and 0.8 <= room["h"] <= MAX_SIZE):
            raise ValueError(f"{room['name']}: width and depth must be between 0.8 and {MAX_SIZE:.0f} m")
        clash = [f"{o['name']} by {overlap(room, o):.1f} m² (it spans x {o['x']}–{r2(o['x'] + o['w'])}, y {o['y']}–{r2(o['y'] + o['h'])})"
                 for o in self.plan["rooms"] if o["id"] != room["id"] and overlap(room, o)]
        if clash:
            raise ValueError(f"{room['name']} at x {room['x']}, y {room['y']} ({room['w']} × {room['h']} m) would overlap " + "; ".join(clash))

    def tool_add_room(self, name: str, type: str, width: float, depth: float, x: float | None = None, y: float | None = None,
                      next_to: str | None = None, side: str | None = None, align: str = "start") -> dict:
        if len(self.plan["rooms"]) >= MAX_ROOMS:
            raise ValueError(f"a plan can have at most {MAX_ROOMS} rooms")
        if type not in ROOM_TYPES:
            raise ValueError(f"type must be one of {', '.join(ROOM_TYPES)}")
        if any(r["name"].lower() == name.strip().lower() for r in self.plan["rooms"]):
            raise ValueError(f"there is already a room called {name!r}; give each room its own name")
        w, h = snap(float(width)), snap(float(depth))
        if next_to:
            n, s = self._room(next_to), SIDES.get(str(side).lower())
            if not s:
                raise ValueError("side must be north, south, east or west of the next_to room")
            if s in "ns":
                y = n["y"] - h if s == "n" else n["y"] + n["h"]
                x = {"start": n["x"], "center": n["x"] + (n["w"] - w) / 2, "end": n["x"] + n["w"] - w}.get(align, n["x"])
            else:
                x = n["x"] - w if s == "w" else n["x"] + n["w"]
                y = {"start": n["y"], "center": n["y"] + (n["h"] - h) / 2, "end": n["y"] + n["h"] - h}.get(align, n["y"])
        elif x is None or y is None:
            raise ValueError("give x and y, or next_to with a side")
        room = {"id": new_id("r"), "name": name.strip()[:60], "type": type, "x": snap(float(x)), "y": snap(float(y)), "w": w, "h": h}
        self._fits(room)
        self.plan["rooms"].append(room)
        return {"added": self._report(room)}

    def tool_update_room(self, room: str, name: str | None = None, type: str | None = None, x: float | None = None,
                         y: float | None = None, width: float | None = None, depth: float | None = None) -> dict:
        r = self._room(room)
        new = {**r, **{k: snap(float(v)) for k, v in (("x", x), ("y", y), ("w", width), ("h", depth)) if v is not None}}
        if name:
            if any(o["name"].lower() == name.strip().lower() and o["id"] != r["id"] for o in self.plan["rooms"]):
                raise ValueError(f"there is already a room called {name!r}")
            new["name"] = name.strip()[:60]
        if type:
            if type not in ROOM_TYPES:
                raise ValueError(f"type must be one of {', '.join(ROOM_TYPES)}")
            new["type"] = type
        self._fits(new)
        gone = self._carry_items(r, new)
        r.update(new)
        dropped = [op["id"] for op in self.plan["openings"] if op["room"] == r["id"]
                   and op["width"] > side_edge(r, op["side"])[4] - side_edge(r, op["side"])[3] + EPS]
        self.plan["openings"] = [op for op in self.plan["openings"] if op["id"] not in dropped]
        return {"updated": self._report(r), **({"removed_openings_that_no_longer_fit": dropped} if dropped else {}),
                **({"removed_furniture_that_no_longer_fits": gone} if gone else {})}

    def tool_swap_rooms(self, room_a: str, room_b: str) -> dict:
        """Swap two rooms' names and uses (the walls, doors and windows stay); their furniture moves with them."""
        a, b = self._room(room_a), self._room(room_b)
        if a["id"] == b["id"]:
            raise ValueError("pick two different rooms")
        inside = lambda r, it: r["x"] <= it["cx"] <= r["x"] + r["w"] and r["y"] <= it["cy"] <= r["y"] + r["h"]  # noqa: E731
        moves = [(it, a, b) for it in self.plan["items"] if inside(a, it)] + [(it, b, a) for it in self.plan["items"] if inside(b, it)]
        for it, src, dst in moves:  # same offset from the north-west corner, kept inside the new room
            it["cx"] = r2(min(max(dst["x"] + it["cx"] - src["x"], dst["x"] + 0.3), dst["x"] + dst["w"] - 0.3))
            it["cy"] = r2(min(max(dst["y"] + it["cy"] - src["y"], dst["y"] + 0.3), dst["y"] + dst["h"] - 0.3))
        a["name"], b["name"], a["type"], b["type"] = b["name"], a["name"], b["type"], a["type"]
        return {"swapped": [a["name"], b["name"]], "now": [self._report(a), self._report(b)]}

    def tool_remove_room(self, room: str) -> dict:
        r = self._room(room)
        self.plan["rooms"].remove(r)
        self.plan["openings"] = [op for op in self.plan["openings"] if op["room"] != r["id"]]
        self.plan["items"] = [it for it in self.plan["items"]
                              if not (r["x"] <= it["cx"] <= r["x"] + r["w"] and r["y"] <= it["cy"] <= r["y"] + r["h"])]
        return {"removed": r["name"]}

    def _place(self, room: dict, side: str, lo: float, hi: float, width: float, prefer: str = "middle") -> float | None:
        """Where along [lo, hi] of this wall an opening of this width fits without overlapping another; None if nowhere."""
        _, o, c, a, _ = side_edge(room, side)
        mids = [(lo + hi) / 2, lo + 0.15 + width / 2, hi - 0.15 - width / 2]
        if prefer == "corner":
            mids = mids[1:] + mids[:1]
        for mid in mids:
            mid = snap(mid)
            if mid - width / 2 < lo - EPS or mid + width / 2 > hi + EPS:
                continue
            if not clashes(self.plan, (o, c, mid - width / 2, mid + width / 2)):
                return r2(mid - a)
        return None

    def tool_connect(self, room_a: str, room_b: str, kind: str = "door", width: float | None = None) -> dict:
        a, b = self._room(room_a), self._room(room_b)
        if kind not in ("door", "passage"):
            raise ValueError("kind is door or passage (an open doorway)")
        # a door belongs to the room it opens into, so it swings into that room rather than into a hallway
        target, other = (a, b) if b["type"] == "hallway" and a["type"] != "hallway" else (b, a)
        width = r2(float(width)) if width else (1.2 if kind == "passage" else 0.8 if target["type"] == "bathroom" else 0.9)
        walls = sorted(((s, lo, hi) for s in "nsew" for o, lo, hi in shared(self.plan, target, s) if o["id"] == other["id"]),
                       key=lambda w: w[2] - w[1], reverse=True)
        if not walls:
            touching = ", ".join(f"{o['name']} ({SIDE_NAME[s]})" for s in "nsew" for o, _, _ in shared(self.plan, target, s)) or "no rooms"
            raise ValueError(f"{target['name']} and {other['name']} don't share a wall; {target['name']} touches {touching}")
        for s, lo, hi in walls:
            if hi - lo < width + 0.2:
                continue
            at = self._place(target, s, lo, hi, width, prefer="corner")
            if at is not None:
                op = {"id": new_id("o"), "type": "door" if kind == "door" else "opening", "room": target["id"], "side": s, "at": at,
                      "width": width, "hinge": "start", "swing": "in"}
                self.plan["openings"].append(op)
                return {"added": op["type"], "id": op["id"], "between": [other["name"], target["name"]], "on_wall": f"{SIDE_NAME[s]} wall of {target['name']}"}
        raise ValueError(f"{a['name']} and {b['name']} share only {walls[0][2] - walls[0][1]:.2f} m of wall, or it is taken by other "
                         f"openings; a {width:.2f} m {kind} needs {width + 0.2:.2f} m")

    def _outside(self, room: dict, side: str | None, need: float) -> list[tuple[str, float, float]]:
        sides = [SIDES[side.lower()]] if side else ["s", "n", "e", "w"]
        runs = sorted(((s, p, q) for s in sides for p, q in exterior_runs(self.plan, room, s) if q - p >= need),
                      key=lambda run: (run[2] - run[1]), reverse=True)
        if not runs:
            have = {SIDE_NAME[s]: r2(sum(q - p for p, q in exterior_runs(self.plan, room, s))) for s in "nsew"}
            fits = [f"{o['name']} ({', '.join(f'{SIDE_NAME[s]} {q - p:.2f} m' for s in 'nsew' for p, q in exterior_runs(self.plan, o, s) if q - p >= need)})"
                    for o in self.plan["rooms"] if o["id"] != room["id"]
                    and any(q - p >= need for s in "nsew" for p, q in exterior_runs(self.plan, o, s))]
            raise ValueError(f"{room['name']} has no outside wall {'on the ' + SIDE_NAME[SIDES[side.lower()]] + ' ' if side else ''}"
                             f"long enough ({need:.2f} m needed); its outside walls: {have}. "
                             + (f"Rooms with a long enough outside wall: {'; '.join(fits[:5])}" if fits else "No room has one: make a room reach the outside"))
        return runs

    def tool_add_entrance(self, room: str, side: str | None = None, width: float = 0.9) -> dict:
        r, width = self._room(room), r2(float(width))
        for s, p, q in self._outside(r, side, width + 0.3):
            at = self._place(r, s, p, q, width)
            if at is not None:
                op = {"id": new_id("o"), "type": "door", "room": r["id"], "side": s, "at": at, "width": width, "hinge": "start", "swing": "in"}
                self.plan["openings"].append(op)
                return {"added": "entrance door", "id": op["id"], "on_wall": f"{SIDE_NAME[s]} wall of {r['name']}"}
        raise ValueError(f"no free stretch of outside wall in {r['name']} for a {width:.2f} m door")

    def tool_add_window(self, room: str, side: str | None = None, width: float = 1.2, count: int = 1) -> dict:
        r, width, count = self._room(room), r2(float(width)), max(1, min(int(count), 4))
        added = []
        for s, p, q in self._outside(r, side, width + 0.3):
            step = (q - p) / count
            for i in range(count - len(added)):
                at = self._place(r, s, p + i * step, p + (i + 1) * step, width)
                if at is not None:
                    op = {"id": new_id("o"), "type": "window", "room": r["id"], "side": s, "at": at, "width": width, "hinge": "start", "swing": "in"}
                    self.plan["openings"].append(op)
                    added.append(f"{SIDE_NAME[s]} wall")
            if len(added) >= count:
                break
        if not added:
            raise ValueError(f"no free stretch of outside wall in {r['name']} for a {width:.2f} m window")
        return {"added": f"{len(added)} window(s)", "room": r["name"], "on": added}

    def tool_remove_opening(self, opening: str) -> dict:
        before = len(self.plan["openings"])
        self.plan["openings"] = [op for op in self.plan["openings"] if op["id"] != opening]
        if len(self.plan["openings"]) == before:
            raise ValueError(f"no opening {opening!r}")
        return {"removed": opening}

    def tool_check_plan(self) -> dict:
        return {**check(self.plan), "plan": describe(self.plan)}

    def tool_finish(self, summary: str, name: str | None = None, kind: str | None = None) -> dict:
        result = check(self.plan)
        if not self.plan["rooms"]:
            raise ValueError("the plan has no rooms yet")
        if result["errors"]:
            raise ValueError("not finished, fix these first: " + "; ".join(result["errors"]))
        self.finished = summary.strip()
        self.name = (name or "").strip()[:80] or None
        self.kind = kind if kind in BUILDING_KINDS else None
        return {"ok": True, "warnings_left": result["warnings"], "total_area_m2": result["total_area_m2"]}

