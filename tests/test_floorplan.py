"""Offline checks of the floor plan geometry, the plan checks and the assistant's tools (no model calls)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from gt.floorplan import PlanBuilder, check, clean, connects, exterior_runs  # noqa: E402

b = PlanBuilder()
ok = lambda result: (result if "error" not in result else (_ for _ in ()).throw(AssertionError(result["error"])))  # noqa: E731

# rooms placed against each other by the code, not by the model's arithmetic
ok(b.call("add_room", {"name": "Living room", "type": "living", "width": 6, "depth": 4.5, "x": 0, "y": 0}))
kit = ok(b.call("add_room", {"name": "Kitchen", "type": "kitchen", "width": 4, "depth": 4.5, "next_to": "Living room", "side": "east"}))["added"]
assert (kit["x"], kit["y"]) == (6, 0) and kit["touches"] == [{"room": "Living room", "wall": "west", "shared_m": 4.5}], kit
hall = ok(b.call("add_room", {"name": "Hallway", "type": "hallway", "width": 10, "depth": 1.2, "next_to": "Living room", "side": "south"}))["added"]
assert (hall["x"], hall["y"]) == (0, 4.5), hall
ok(b.call("add_room", {"name": "Bedroom", "type": "bedroom", "width": 3.8, "depth": 3.3, "next_to": "Hallway", "side": "south"}))
ok(b.call("add_room", {"name": "Bathroom", "type": "bathroom", "width": 2.4, "depth": 3.3, "next_to": "Bedroom", "side": "east"}))

# refusals carry the reason
err = b.call("add_room", {"name": "Study", "type": "office", "width": 3, "depth": 3, "x": 5, "y": 1})["error"]
assert "would overlap Living room" in err and "Kitchen" in err, err
assert "already a room" in b.call("add_room", {"name": "kitchen", "type": "kitchen", "width": 3, "depth": 3, "x": 20, "y": 0})["error"]
assert "don't share a wall" in b.call("connect", {"room_a": "Kitchen", "room_b": "Bedroom"})["error"]
assert "no single room" in b.call("connect", {"room_a": "Garage", "room_b": "Bedroom"})["error"]

# not finished: no entrance, so nothing is reachable
result = check(b.plan)
assert "There is no entrance: add a door on an outside wall" in result["errors"], result
assert "not finished" in b.call("finish", {"summary": "done"})["error"] and b.finished is None

ok(b.call("add_entrance", {"room": "Hallway", "side": "west"}))
for a, c in (("Hallway", "Living room"), ("Hallway", "Kitchen"), ("Hallway", "Bedroom")):
    ok(b.call("connect", {"room_a": a, "room_b": c}))
result = check(b.plan)
assert result["errors"] == ["Bathroom can't be reached from the entrance: connect it with a door or passage"], result
door = ok(b.call("connect", {"room_a": "Bedroom", "room_b": "Bathroom"}))
assert door["on_wall"] == "west wall of Bathroom", door  # the door belongs to the room it opens into
# a door from a hallway swings into the room, not into the hallway
bedroom_door = next(op for op in b.plan["openings"] if op["room"] == b._room("Bedroom")["id"])
assert bedroom_door["side"] == "n" and connects(b.plan, bedroom_door) == {b._room("Hallway")["id"]}

# windows go on outside walls only; warnings name the rooms that still lack one
assert "Kitchen has no window" in check(b.plan)["warnings"]
assert "no outside wall on the west" in b.call("add_window", {"room": "Kitchen", "side": "west"})["error"]
ok(b.call("add_window", {"room": "Kitchen", "side": "east"}))
ok(b.call("add_window", {"room": "Living room", "count": 2}))
ok(b.call("add_window", {"room": "Bedroom"}))
result = check(b.plan)
assert result["errors"] == [] and not any("no window" in w for w in result["warnings"]), result
assert result["total_area_m2"] == 27 + 18 + 12 + 12.54 + 7.92, result

# outside walls are what is left after neighbours: the hallway's north wall is all shared
assert exterior_runs(b.plan, b._room("Hallway"), "n") == []
assert exterior_runs(b.plan, b._room("Hallway"), "s") == [(6.2, 10.0)]

# a room built against a wall with windows turns them into windows onto that room: flagged
ok(b.call("add_room", {"name": "Porch", "type": "other", "width": 2, "depth": 3, "next_to": "Kitchen", "side": "east", "align": "center"}))
assert any("A window of Kitchen" in w and "shared with Porch" in w for w in check(b.plan)["warnings"]), check(b.plan)["warnings"]
ok(b.call("remove_room", {"room": "Porch"}))

# moving a room re-checks overlaps; finishing records the summary
assert "overlap" in b.call("update_room", {"room": "Kitchen", "x": 5})["error"]
ok(b.call("update_room", {"room": "Bedroom", "name": "Main bedroom"}))
assert b.call("finish", {"summary": "A compact two-bedroom-ish home.", "name": "Test home"}) ["ok"] and b.finished and b.name == "Test home"

# plans from a browser are reduced to well-formed parts
dirty = {"rooms": [{"id": "a", "name": "A", "type": "nope", "x": "1", "y": 0, "w": 3, "h": 3}, {"id": "b", "x": 0}],
         "openings": [{"id": "o", "type": "door", "room": "a", "side": "n", "at": 1, "width": 0.9}, {"id": "p", "room": "zz", "side": "n"}]}
cleaned = clean(dirty)
assert [r["type"] for r in cleaned["rooms"]] == ["other"] and [o["id"] for o in cleaned["openings"]] == ["o"], cleaned
print("floorplan: all checks passed")
