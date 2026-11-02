"""Offline checks of the floor plan geometry, the plan checks and the assistant's tools (no model calls)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from gt.floorplan import PlanBuilder, check, clean, connects, exterior_runs, item_box, keep_clear  # noqa: E402

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
# swapping two rooms swaps their names and uses; furniture moves with them, kept inside
sw = PlanBuilder()
sw.call("add_room", {"name": "Kitchen", "type": "kitchen", "width": 4, "depth": 3, "x": 0, "y": 0})
sw.call("add_room", {"name": "Bedroom", "type": "bedroom", "width": 3, "depth": 3, "next_to": "Kitchen", "side": "east"})
sw.plan["items"] = [{"id": "bed", "type": "bed_double", "cx": 6.0, "cy": 1.5, "w": 1.6, "h": 2.0, "rot": 0}]
out = sw.call("swap_rooms", {"room_a": "Kitchen", "room_b": "Bedroom"})
assert out["swapped"] == ["Bedroom", "Kitchen"], out
assert [(r["name"], r["type"], r["x"]) for r in sw.plan["rooms"]] == [("Bedroom", "bedroom", 0), ("Kitchen", "kitchen", 4)]
assert sw.plan["items"][0]["cx"] == 2.0 and sw.plan["items"][0]["cy"] == 1.5, sw.plan["items"]
assert "different rooms" in sw.call("swap_rooms", {"room_a": "Kitchen", "room_b": "kitchen"})["error"]
# furniture is placed by the code: inside its room, against a wall, clear of doorways and of other pieces
f = PlanBuilder()
ok(f.call("add_room", {"name": "Living", "type": "living", "width": 5, "depth": 4.5, "x": 0, "y": 0}))
ok(f.call("add_room", {"name": "Bedroom", "type": "bedroom", "width": 3.6, "depth": 3.4, "next_to": "Living", "side": "south", "align": "start"}))
ok(f.call("add_room", {"name": "Bath", "type": "bathroom", "width": 2.4, "depth": 2.4, "next_to": "Bedroom", "side": "east", "align": "start"}))
ok(f.call("connect", {"room_a": "Living", "room_b": "Bedroom"}))
ok(f.call("connect", {"room_a": "Bedroom", "room_b": "Bath"}))
ok(f.call("add_entrance", {"room": "Living"}))
for name in ("Living", "Bedroom", "Bath"):
    ok(f.call("furnish_room", {"room": name}))
assert {"sofa", "armchair", "bed_double", "wardrobe", "toilet", "basin", "bathtub"} <= {it["type"] for it in f.plan["items"]}, f.plan["items"]
assert ok(f.call("add_furniture", {"room": "Living", "type": "desk", "wall": "east"}))["against"] == "east"
overlap = lambda a, c: a[0] < c[2] - 1e-6 and c[0] < a[2] - 1e-6 and a[1] < c[3] - 1e-6 and c[1] < a[3] - 1e-6  # noqa: E731
boxes = [item_box(it) for it in f.plan["items"]]
assert not any(overlap(a, c) for i, a in enumerate(boxes) for c in boxes[i + 1:]), boxes
for room in f.plan["rooms"]:
    for box in [x for x in boxes if room["x"] <= (x[0] + x[2]) / 2 <= room["x"] + room["w"] and room["y"] <= (x[1] + x[3]) / 2 <= room["y"] + room["h"]]:
        assert room["x"] - 1e-6 <= box[0] and box[2] <= room["x"] + room["w"] + 1e-6 and room["y"] - 1e-6 <= box[1] and box[3] <= room["y"] + room["h"] + 1e-6, (room["name"], box)
        assert not any(overlap(box, z) for z in keep_clear(f.plan, room)), (room["name"], box)
assert "no free floor in Bath" in f.call("add_furniture", {"room": "Bath", "type": "car"})["error"]
assert "type must be one of" in f.call("add_furniture", {"room": "Bath", "type": "piano"})["error"]
# resizing a room carries the furniture on the moved wall; pieces too big for the new room are removed
desk = next(it for it in f.plan["items"] if it["type"] == "desk")
x_before, on_west = desk["cx"], {it["id"]: it["cx"] for it in f.plan["items"] if item_box(it)[0] < 0.2 and it["cy"] < 4.5}
ok(f.call("update_room", {"room": "Living", "width": 6}))
assert desk["cx"] == round(x_before + 1, 2) and on_west, (x_before, desk, on_west)
assert all(it["cx"] == on_west[it["id"]] for it in f.plan["items"] if it["id"] in on_west), f.plan["items"]
out = ok(f.call("update_room", {"room": "Bedroom", "width": 1.2}))
assert "bed_double" in out["removed_furniture_that_no_longer_fits"], out
ok(f.call("update_room", {"room": "Bedroom", "width": 3.6}))
assert f.call("remove_furniture", {"room": "Bath", "type": "toilet"})["removed"] == 1
assert "toilet" not in {it["type"] for it in f.plan["items"]} and check(f.plan)["errors"] == []
print("floorplan: all checks passed")
