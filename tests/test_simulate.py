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
