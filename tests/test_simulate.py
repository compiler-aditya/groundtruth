"""Offline checks of the plan simulation: sun, movement, space and the scores (no model calls)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from gt.floorplan import PlanBuilder  # noqa: E402
from gt import simulate as sim  # noqa: E402

# --- the sun where it should be
az, el = sim.sun_position(0, 80, 12)
assert el > 89, el                                           # equator, equinox, noon: overhead
az, el = sim.sun_position(51.5, 172, 12)
assert abs(az - 180) < 1 and 61 < el < 63, (az, el)           # London, midsummer noon: south, about 62°
az, el = sim.sun_position(28.6, 80, 9)
assert 90 < az < 180 and el > 0, (az, el)                     # Delhi, a spring morning: south-east
az, el = sim.sun_position(-33.9, 172, 12)
assert abs(az) < 1 or abs(az - 360) < 1, az                   # Sydney, June noon: north

# --- a room with one south window and one north window
b = PlanBuilder()
b.call("add_room", {"name": "Living", "type": "living", "width": 5, "depth": 4, "x": 0, "y": 0})
b.call("add_window", {"room": "Living", "side": "south", "width": 1.6})
b.call("add_window", {"room": "Living", "side": "north", "width": 1.6})
plan = b.plan
south = next(op for op in plan["openings"] if op["side"] == "s")
noon = sim.sun_patches(plan, *sim.sun_position(28.6, 355, 12), north=0)
assert [p["window"] for p in noon] == [south["id"]], noon     # winter noon in Delhi: only the south window
patch = noon[0]["poly"]
assert all(0 <= x <= 5 and 0 <= y <= 4 for x, y in patch) and 0.5 < noon[0]["area_m2"] < 5, noon
# turn the plan around (its top faces south): now the "north" window is the sunny one
flipped = sim.sun_patches(plan, *sim.sun_position(28.6, 355, 12), north=180)
assert [p["window"] for p in flipped] != [south["id"]] and len(flipped) == 1, flipped
day = sim.sun_day(plan, 28.6, sim.DAYS["winter"])
liv = day["rooms"][plan["rooms"][0]["id"]]
assert 4 <= liv["sun_hours"] <= 10 and 10 < day["daylight_hours"] < 11.5, (liv, day["daylight_hours"])
assert liv["glazing_ratio"] == round(2 * 1.6 * 1.2 / 20, 2), liv
score = sim.daylight_score(plan, day)
assert score["score"] == 100 and score["notes"] == [], score   # >3 h of sun and 19% glazing
# a window covered by a new room gets no sun
b.call("add_room", {"name": "Porch", "type": "other", "width": 5, "depth": 2, "next_to": "Living", "side": "south"})
assert sim.sun_patches(b.plan, *sim.sun_position(28.6, 355, 12), north=0) == []
print("simulate (sun): all checks passed")

# --- movement: a two-bedroom home
def home():
    h = PlanBuilder()
    for args in ({"name": "Living", "type": "living", "width": 6, "depth": 4.5, "x": 0, "y": 0},
                 {"name": "Kitchen", "type": "kitchen", "width": 4, "depth": 4.5, "next_to": "Living", "side": "east"},
                 {"name": "Hallway", "type": "hallway", "width": 10, "depth": 1.2, "next_to": "Living", "side": "south"},
                 {"name": "Bedroom 1", "type": "bedroom", "width": 3.8, "depth": 3.3, "next_to": "Hallway", "side": "south"},
                 {"name": "Bathroom", "type": "bathroom", "width": 2.4, "depth": 3.3, "next_to": "Bedroom 1", "side": "east"},
                 {"name": "Bedroom 2", "type": "bedroom", "width": 3.8, "depth": 3.3, "next_to": "Bathroom", "side": "east"}):
        assert "error" not in h.call("add_room", args), args
    assert "error" not in h.call("add_entrance", {"room": "Hallway", "side": "west"})
    for room in ("Living", "Kitchen", "Bedroom 1", "Bathroom", "Bedroom 2"):
        assert "error" not in h.call("connect", {"room_a": "Hallway", "room_b": room})
    for room in ("Living", "Kitchen", "Bedroom 1", "Bedroom 2"):
        h.call("add_window", {"room": room})
    return h


h = home()
res = sim.simulate(h.plan, 28.6, sim.DAYS["winter"])
mv = res["movement"]
assert [p["name"] for p in mv["people"]] == ["Resident 1", "Resident 2", "Guest"], mv["people"]
assert all(leg["ok"] for p in mv["people"] for leg in p["legs"]), mv["notes"]
assert mv["score"] == 100 and mv["notes"] == [], mv
r1 = mv["people"][0]
assert [(leg["from"], leg["to"]) for leg in r1["legs"]][:4] == [("Bedroom 1", "Bathroom"), ("Bathroom", "Kitchen"), ("Kitchen", "Living"), ("Living", "outside")]
assert all(leg["through"] in ([], ["Hallway"]) for leg in r1["legs"]), [leg["through"] for leg in r1["legs"]]
assert 20 < r1["daily_m"] < 80, r1["daily_m"]
first = r1["legs"][0]["path"]
assert len(first) >= 2 and all(isinstance(v, float) for xy in first for v in xy)

# the bathroom only through Bedroom 1: the guest and Resident 2 now cross it
bath_door = next(op for op in h.plan["openings"] if op["room"] == h._room("Bathroom")["id"])
h.call("remove_opening", {"opening": bath_door["id"]})
h.call("connect", {"room_a": "Bedroom 1", "room_b": "Bathroom"})
mv2 = sim.movement(h.plan)
assert any(n.startswith("Guest walks through Bedroom 1") for n in mv2["notes"]), mv2["notes"]
assert any(n.startswith("Resident 2 walks through Bedroom 1") for n in mv2["notes"]), mv2["notes"]
assert not any(n.startswith("Resident 1 walks through") for n in mv2["notes"]), mv2["notes"]
assert mv2["score"] < 100

# a wardrobe in front of Bedroom 2's door: Resident 2 is shut in, and the simulation says what is in the way
h = home()
door = next(op for op in h.plan["openings"] if op["room"] == h._room("Bedroom 2")["id"] and op["type"] == "door")
from gt.floorplan import opening_span  # noqa: E402
_, c, a, b = opening_span(h.plan, door)
h.plan["items"].append({"id": "w1", "type": "wardrobe", "cx": (a + b) / 2, "cy": c + 0.35, "w": 1.2, "h": 0.6, "rot": 0})
mv3 = sim.movement(h.plan)
stuck = [n for n in mv3["notes"] if n.startswith("Resident 2 can't get")]
assert stuck and "the wardrobe is in the way" in stuck[0], mv3["notes"]
assert mv3["score"] <= 40, mv3["score"]

# --- space: an empty bathroom has room to turn, a 1.2 m hallway doesn't; furniture cover is measured
sp = sim.space(home().plan)
rows = {r["room"]: r for r in sp["rooms"]}
assert rows["Bathroom"]["turning_circle"] and not rows["Hallway"]["turning_circle"], rows
assert "A 1.5 m wheelchair turning circle doesn't fit in Hallway" in sp["notes"] and sp["score"] == 92, sp
assert rows["Bedroom 2"]["furniture_cover"] == 0
h = home()
bed2 = h._room("Bedroom 2")
h.plan["items"] += [{"id": f"x{i}", "type": "wardrobe", "cx": bed2["x"] + 1.9, "cy": bed2["y"] + 0.4 + i * 0.6, "w": 3.6, "h": 0.6, "rot": 0} for i in range(4)]
assert any(n.startswith("Furniture covers") and "Bedroom 2" in n for n in sim.space(h.plan)["notes"])

# --- a clinic: a visitor goes through reception and waiting to treatment; staff to their room
c = PlanBuilder()
for args in ({"name": "Reception", "type": "reception", "width": 4, "depth": 3, "x": 0, "y": 0},
             {"name": "Waiting room", "type": "other", "width": 4, "depth": 3, "next_to": "Reception", "side": "east"},
             {"name": "Corridor", "type": "hallway", "width": 8, "depth": 1.2, "next_to": "Reception", "side": "south"},
             {"name": "Treatment 1", "type": "other", "width": 4, "depth": 3, "next_to": "Corridor", "side": "south"},
             {"name": "Staff room", "type": "office", "width": 2.5, "depth": 3, "next_to": "Treatment 1", "side": "east"},
             {"name": "WC", "type": "bathroom", "width": 1.5, "depth": 3, "next_to": "Staff room", "side": "east"}):
    assert "error" not in c.call("add_room", args), args
c.call("add_entrance", {"room": "Reception", "side": "north"})
c.call("connect", {"room_a": "Reception", "room_b": "Waiting room", "kind": "passage"})
for room in ("Reception", "Treatment 1", "Staff room", "WC"):
    assert "error" not in c.call("connect", {"room_a": "Corridor", "room_b": room}), room
cm = sim.simulate(c.plan, 51.5, sim.DAYS["equinox"])["movement"]
visitor = next(p for p in cm["people"] if p["name"] == "Visitor")
assert [leg["to"] for leg in visitor["legs"]] == ["Reception", "Waiting room", "Treatment 1", "WC", "outside"], visitor["legs"]
assert all(leg["ok"] for p in cm["people"] for leg in p["legs"]), cm["notes"]
assert [leg["to"] for leg in next(p for p in cm["people"] if p["name"] == "Staff")["legs"]][0] == "Staff room"

full = sim.simulate(home().plan, 51.5, sim.DAYS["summer"], north=90)
assert set(full["scores"]) == {"daylight", "movement", "space"} and 0 <= full["overall"] <= 100
assert sim.summary(full)["movement"]["daily_m"]["Guest"] > 0
print("simulate (movement, space, scores): all checks passed")
