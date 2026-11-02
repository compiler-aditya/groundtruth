"""2D simulation of a floor plan: the sun through its windows over a day, people walking their daily routes, and
room to move. Everything is measured from the plan's geometry (the format in gt/floorplan.py). The scores are
rules of thumb for comparing options, not a building-code assessment.

Simplifications, stated so the numbers are read correctly: one storey; times are solar time; nothing outside the
building casts shade, and sunlight is followed only into the room its window belongs to.
"""

from __future__ import annotations

import heapq
import math

from .floorplan import EPS, NEEDS_WINDOW, area, check, connects, opening_span, room_by_id

SILL, HEAD = 0.9, 2.1  # window sill and head heights, m
DAYS = {"winter": 355, "equinox": 80, "summer": 172}  # 21 December, 21 March, 21 June
CITIES = {"Delhi": 28.6, "Mumbai": 19.1, "Bengaluru": 13.0, "Singapore": 1.35, "Dubai": 25.2, "London": 51.5, "Berlin": 52.5,
          "New York": 40.7, "San Francisco": 37.8, "Tokyo": 35.7, "Sydney": -33.9, "São Paulo": -23.5}
OUTWARD = {"n": (0.0, -1.0), "s": (0.0, 1.0), "w": (-1.0, 0.0), "e": (1.0, 0.0)}
STEP_H = 0.25


def r2(v: float) -> float:
    return round(v + 0.0, 2)


# ---------------------------------------------------------------- sun

def sun_position(latitude: float, day: int, hour: float) -> tuple[float, float]:
    """(azimuth clockwise from north, elevation) in degrees, for a day of the year and a solar hour."""
    decl = math.radians(23.44) * math.sin(2 * math.pi * (day - 81) / 365)
    lat, h = math.radians(latitude), math.radians(15 * (hour - 12))
    sin_el = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(h)
    el = math.degrees(math.asin(max(-1.0, min(1.0, sin_el))))
    az = math.degrees(math.atan2(-math.sin(h) * math.cos(decl), math.cos(lat) * math.sin(decl) - math.sin(lat) * math.cos(decl) * math.cos(h))) % 360
    return az, el


def plan_vector(bearing: float, north: float) -> tuple[float, float]:
    """Unit vector in plan coordinates (x east-ish, y down) for a compass bearing, when the plan's top faces `north` degrees."""
    t = math.radians(bearing - north)
    return math.sin(t), -math.cos(t)


def clip(poly: list[tuple[float, float]], room: dict) -> list[tuple[float, float]]:
    """Sutherland-Hodgman clip of a polygon to a room's rectangle."""
    x0, y0, x1, y1 = room["x"], room["y"], room["x"] + room["w"], room["y"] + room["h"]
    edges = [(lambda p: p[0] >= x0, lambda p, q: (x0, p[1] + (q[1] - p[1]) * (x0 - p[0]) / (q[0] - p[0]))),
             (lambda p: p[0] <= x1, lambda p, q: (x1, p[1] + (q[1] - p[1]) * (x1 - p[0]) / (q[0] - p[0]))),
             (lambda p: p[1] >= y0, lambda p, q: (p[0] + (q[0] - p[0]) * (y0 - p[1]) / (q[1] - p[1]), y0)),
             (lambda p: p[1] <= y1, lambda p, q: (p[0] + (q[0] - p[0]) * (y1 - p[1]) / (q[1] - p[1]), y1))]
    out = poly
    for inside, cross in edges:
        if not out:
            break
        src, out = out, []
        for i, q in enumerate(src):
            p = src[i - 1]
            if inside(q):
                if not inside(p):
                    out.append(cross(p, q))
                out.append(q)
            elif inside(p):
                out.append(cross(p, q))
    return out


def poly_area(poly: list[tuple[float, float]]) -> float:
    return abs(sum(poly[i - 1][0] * p[1] - p[0] * poly[i - 1][1] for i, p in enumerate(poly))) / 2


def outside_windows(plan: dict) -> list[tuple[dict, tuple]]:
    """Windows on outside walls, with their span; a window on a wall another room shares gets no sun."""
    out = []
    for op in plan["openings"]:
        if op["type"] == "window" and connects(plan, op) == {"outside"}:
            span = opening_span(plan, op)
            if span:
                out.append((op, span))
    return out


def sun_patches(plan: dict, az: float, el: float, north: float) -> list[dict]:
    """The patches of direct sunlight on the floor for one sun position."""
    if el <= 0.5:
        return []
    s = plan_vector(az, north)  # towards the sun
    d = (-s[0], -s[1])          # the way the light travels across the floor
    near, far = SILL / math.tan(math.radians(el)), HEAD / math.tan(math.radians(el))
    patches = []
    for op, (o, c, a, b) in outside_windows(plan):
        n = OUTWARD[op["side"]]
        if s[0] * n[0] + s[1] * n[1] <= 0.05:  # the sun is behind this wall
            continue
        p1, p2 = ((a, c), (b, c)) if o == "h" else ((c, a), (c, b))
        quad = [(p1[0] + d[0] * near, p1[1] + d[1] * near), (p2[0] + d[0] * near, p2[1] + d[1] * near),
                (p2[0] + d[0] * far, p2[1] + d[1] * far), (p1[0] + d[0] * far, p1[1] + d[1] * far)]
        room = room_by_id(plan, op["room"])
        poly = clip(quad, room)
        if len(poly) >= 3 and poly_area(poly) > 0.02:
            patches.append({"room": room["id"], "window": op["id"], "area_m2": r2(poly_area(poly)), "poly": [[r2(x), r2(y)] for x, y in poly]})
    return patches


def sun_day(plan: dict, latitude: float, day: int, north: float = 0.0) -> dict:
    """Sun samples every 15 minutes of daylight, each room's hours of direct sun and its window-to-floor ratio."""
    samples, hours = [], {r["id"]: 0.0 for r in plan["rooms"]}
    for k in range(int(24 / STEP_H)):
        hour = k * STEP_H
        az, el = sun_position(latitude, day, hour)
        if el <= 0.5:
            continue
        patches = sun_patches(plan, az, el, north)
        for rid in {p["room"] for p in patches}:
            hours[rid] += STEP_H
        samples.append({"hour": hour, "azimuth": r2(az), "elevation": r2(el), "patches": patches})
    glass = {r["id"]: 0.0 for r in plan["rooms"]}
    for op, _ in outside_windows(plan):
        glass[op["room"]] += op["width"] * (HEAD - SILL)
    rooms = {r["id"]: {"sun_hours": hours[r["id"]], "glazing_ratio": r2(glass[r["id"]] / area(r)) if area(r) else 0.0} for r in plan["rooms"]}
    return {"latitude": latitude, "day": day, "north": north, "samples": samples, "rooms": rooms,
            "daylight_hours": r2(len(samples) * STEP_H)}


def daylight_score(plan: dict, sun: dict) -> dict:
    """Per living room, bedroom, kitchen, office and similar: half for direct sun (3 h counts in full), half for window
    area as a share of floor area (10% counts in full)."""
    rows, notes = [], []
    for r in plan["rooms"]:
        if r["type"] not in NEEDS_WINDOW:
            continue
        m = sun["rooms"][r["id"]]
        score = 50 * min(m["sun_hours"], 3) / 3 + 50 * min(m["glazing_ratio"] / 0.10, 1)
        rows.append({"room": r["name"], "id": r["id"], "sun_hours": m["sun_hours"], "glazing_ratio": m["glazing_ratio"], "score": round(score)})
        if m["sun_hours"] == 0:
            notes.append(f"{r['name']} gets no direct sun on this day")
        if m["glazing_ratio"] < 0.10:
            notes.append(f"{r['name']} has windows of {m['glazing_ratio'] * 100:.0f}% of its floor area (10% is a common rule of thumb)")
    score = round(sum(x["score"] for x in rows) / len(rows)) if rows else None
    return {"score": score, "rooms": rows, "notes": notes}
