"""2D simulation of a floor plan: the sun through its windows over a day, people walking their daily routes, and
room to move. Everything is measured from the plan's geometry (the format in gt/floorplan.py). The scores are
rules of thumb for comparing options, not a building-code assessment.

Simplifications, stated so the numbers are read correctly: one storey; times are solar time; nothing outside the
building casts shade, and sunlight is followed only into the room its window belongs to.
"""

from __future__ import annotations

import heapq
import math

from .floorplan import MIN_AREA, MIN_SIDE, NEEDS_WINDOW, area, check, connects, opening_span, room_by_id

SILL, HEAD = 0.9, 2.1  # window sill and head heights, m
DAYS = {"winter": 355, "equinox": 80, "summer": 172}  # 21 December, 21 March, 21 June
CITIES = {"Delhi": 28.6, "Mumbai": 19.1, "Bengaluru": 13.0, "Singapore": 1.35, "Dubai": 25.2, "London": 51.5, "Berlin": 52.5,
          "New York": 40.7, "San Francisco": 37.8, "Tokyo": 35.7, "Sydney": -33.9, "São Paulo": -23.5}
OUTWARD = {"n": (0.0, -1.0), "s": (0.0, 1.0), "w": (-1.0, 0.0), "e": (1.0, 0.0)}
STEP_H = 0.25
FACING = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]


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
    samples, hours, walls = [], {r["id"]: 0.0 for r in plan["rooms"]}, {side: 0.0 for side in "nsew"}
    for k in range(int(24 / STEP_H)):
        hour = k * STEP_H
        az, el = sun_position(latitude, day, hour)
        if el <= 0.5:
            continue
        s = plan_vector(az, north)
        for side, n in OUTWARD.items():
            if s[0] * n[0] + s[1] * n[1] > 0.05:
                walls[side] += STEP_H
        patches = sun_patches(plan, az, el, north)
        for rid in {p["room"] for p in patches}:
            hours[rid] += STEP_H
        samples.append({"hour": hour, "azimuth": r2(az), "elevation": r2(el), "patches": patches})
    glass = {r["id"]: 0.0 for r in plan["rooms"]}
    for op, _ in outside_windows(plan):
        glass[op["room"]] += op["width"] * (HEAD - SILL)
    rooms = {r["id"]: {"sun_hours": hours[r["id"]], "glazing_ratio": r2(glass[r["id"]] / area(r)) if area(r) else 0.0} for r in plan["rooms"]}
    return {"latitude": latitude, "day": day, "north": north, "samples": samples, "rooms": rooms,
            "daylight_hours": r2(len(samples) * STEP_H), "wall_sun_hours": walls}


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


# ---------------------------------------------------------------- movement

CELL = 0.15          # walking grid, m
WALL_GAP = 0.2       # people keep this far from walls
FURNITURE_GAP = 0.1  # and this far from furniture
DOOR_REACH = 0.45    # a door or passage lets people through this far either side of its wall
TURN_RADIUS = 0.75   # a 1.5 m wheelchair turning circle


def footprint(item: dict) -> tuple[float, float, float, float]:
    w, h = (item["h"], item["w"]) if int(item.get("rot", 0)) % 180 else (item["w"], item["h"])
    return item["cx"] - w / 2, item["cy"] - h / 2, item["cx"] + w / 2, item["cy"] + h / 2


class Grid:
    """Walkable cells of a plan: inside rooms away from walls, through doors and passages, in front of the entrance,
    and (optionally) around furniture."""

    def __init__(self, plan: dict, furniture: bool = True) -> None:
        rooms = plan["rooms"]
        self.x0 = min(r["x"] for r in rooms) - 1.6
        self.y0 = min(r["y"] for r in rooms) - 1.6
        self.nx = int((max(r["x"] + r["w"] for r in rooms) + 1.6 - self.x0) / CELL) + 1
        self.ny = int((max(r["y"] + r["h"] for r in rooms) + 1.6 - self.y0) / CELL) + 1
        n = self.nx * self.ny
        self.ok, self.owner, self.item = bytearray(n), [None] * n, [None] * n
        doors = [(op, opening_span(plan, op), connects(plan, op)) for op in plan["openings"] if op["type"] in ("door", "opening")]
        doors = [(op, sp, conn) for op, sp, conn in doors if sp]
        self.entrances = [(op, sp) for op, sp, conn in doors if op["type"] == "door" and "outside" in conn]
        for i in range(n):
            x, y = self.xy(i)
            room = next((r for r in rooms if r["x"] < x < r["x"] + r["w"] and r["y"] < y < r["y"] + r["h"]), None)
            if room:
                self.owner[i] = room["id"]
                if min(x - room["x"], room["x"] + room["w"] - x, y - room["y"], room["y"] + room["h"] - y) >= WALL_GAP:
                    self.ok[i] = 1
            for op, (o, c, a, b), conn in doors:
                along, across = (x, y) if o == "h" else (y, x)
                if a + 0.08 <= along <= b - 0.08 and abs(across - c) <= DOOR_REACH and (room or "outside" in conn):
                    self.ok[i] = 1
                    self.owner[i] = self.owner[i] or "outside"
            if not room:
                for op, (o, c, a, b) in self.entrances:
                    nvec = OUTWARD[op["side"]]
                    along, out = ((x, (y - c) * nvec[1]) if o == "h" else (y, (x - c) * nvec[0]))
                    if a - 0.3 <= along <= b + 0.3 and 0 < out <= 1.5:
                        self.ok[i], self.owner[i] = 1, "outside"
        if furniture:
            for it in plan.get("items", []):
                x0, y0, x1, y1 = footprint(it)
                for i in self.cells_in(x0 - FURNITURE_GAP, y0 - FURNITURE_GAP, x1 + FURNITURE_GAP, y1 + FURNITURE_GAP):
                    self.ok[i], self.item[i] = 0, it["id"]

    def xy(self, i: int) -> tuple[float, float]:
        return self.x0 + (i // self.ny + 0.5) * CELL, self.y0 + (i % self.ny + 0.5) * CELL

    def cells_in(self, x0: float, y0: float, x1: float, y1: float):
        for ix in range(max(0, int((x0 - self.x0) / CELL)), min(self.nx, int((x1 - self.x0) / CELL) + 1)):
            for iy in range(max(0, int((y0 - self.y0) / CELL)), min(self.ny, int((y1 - self.y0) / CELL) + 1)):
                x, y = self.x0 + (ix + 0.5) * CELL, self.y0 + (iy + 0.5) * CELL
                if x0 <= x <= x1 and y0 <= y <= y1:
                    yield ix * self.ny + iy

    def spot(self, owner: str, x: float, y: float) -> int | None:
        """The walkable cell of this room (or "outside") closest to a point."""
        best, dist = None, 1e9
        for i in range(len(self.ok)):
            if self.ok[i] and self.owner[i] == owner:
                cx, cy = self.xy(i)
                d = (cx - x) ** 2 + (cy - y) ** 2
                if d < dist:
                    best, dist = i, d
        return best

    def route(self, a: int, b: int) -> list[int] | None:
        """Shortest walk between two cells (A*, eight directions, no cutting corners)."""
        ny, ok = self.ny, self.ok
        bx, by = divmod(b, ny)
        def h(i):  # noqa: E306
            dx, dy = abs(i // ny - bx), abs(i % ny - by)
            return max(dx, dy) + 0.4142 * min(dx, dy)
        g, came, heap = {a: 0.0}, {}, [(h(a), a)]
        while heap:
            _, i = heapq.heappop(heap)
            if i == b:
                path = [i]
                while i in came:
                    i = came[i]
                    path.append(i)
                return path[::-1]
            ix, iy = divmod(i, ny)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                jx, jy = ix + dx, iy + dy
                if not (0 <= jx < self.nx and 0 <= jy < ny):
                    continue
                j = jx * ny + jy
                if not ok[j] or (dx and dy and not (ok[ix * ny + jy] and ok[jx * ny + iy])):
                    continue
                cost = g[i] + (1.4142 if dx and dy else 1.0)
                if cost < g.get(j, 1e18):
                    g[j], came[j] = cost, i
                    heapq.heappush(heap, (cost + h(j), j))
        return None


def _named(rooms: list[dict], *words: str) -> list[dict]:
    return [r for r in rooms if any(w in r["name"].lower() for w in words)]


def routines(plan: dict) -> list[dict]:
    """Who moves where in a day, from the rooms present. "bath" stops are resolved to the nearest bathroom."""
    rooms = plan["rooms"]
    of = lambda kind: [r for r in rooms if r["type"] == kind]  # noqa: E731
    beds, kitchen = of("bedroom"), (of("kitchen") or [None])[0]
    living = (of("living") or of("dining") or [None])[0]
    people = []
    if beds:
        for i, bed in enumerate(beds):
            people.append({"name": f"Resident {i + 1}", "home": bed["id"], "role": "resident",
                           "stops": [bed, "bath", kitchen, living, "outside", kitchen, living, "bath", bed]})
        people.append({"name": "Guest", "role": "guest", "stops": ["outside", living or kitchen, "bath", living or kitchen, "outside"]})
    else:
        reception = (of("reception") or _named(rooms, "recep", "front"))[:1]
        waiting = _named(rooms, "wait", "lobby")[:1]
        staff = _named(rooms, "staff") or of("office")
        main = [r for r in rooms if r["type"] in ("meeting", "office", "other", "retail", "living", "dining")
                and r not in reception + waiting + staff[:1] and not _named([r], "store", "wc", "toilet")]
        visit = reception + waiting + main[:1] or sorted(rooms, key=area)[-1:]
        people.append({"name": "Visitor", "role": "visitor", "stops": ["outside", *visit, "bath", "outside"]})
        if staff or kitchen:
            people.append({"name": "Staff", "role": "staff", "stops": ["outside", *staff[:1], kitchen, "bath", "outside"]})
    for p in people:
        stops = [s for s in p["stops"] if s]
        p["stops"] = [s for k, s in enumerate(stops) if k == 0 or s != stops[k - 1]]
    return people


def movement(plan: dict) -> dict:
    """Walk everyone's day on the grid: metres walked, rooms crossed, trips that can't be made and why."""
    if not plan["rooms"]:
        return {"people": [], "notes": [], "score": None}
    grid, bare = Grid(plan), None
    names = {r["id"]: r["name"] for r in plan["rooms"]} | {"outside": "outside"}
    rooms = {r["id"]: r for r in plan["rooms"]}
    item_name = {it["id"]: it["type"].replace("_", " ") for it in plan.get("items", [])}
    entrance = grid.entrances[0] if grid.entrances else None

    def target(stop) -> tuple[str, int | None]:
        if stop == "outside":
            if not entrance:
                return "outside", None
            op, (o, c, a, b) = entrance
            n, mid = OUTWARD[op["side"]], (a + b) / 2
            x, y = (mid + 0, c + n[1] * 1.2) if o == "h" else (c + n[0] * 1.2, mid)
            return "outside", grid.spot("outside", x, y)
        return stop["id"], grid.spot(stop["id"], stop["x"] + stop["w"] / 2, stop["y"] + stop["h"] / 2)

    cache: dict = {}

    def walk(a: int | None, b: int | None):
        if a is None or b is None:
            return None
        if (a, b) not in cache:
            cache[(a, b)] = grid.route(a, b)
        return cache[(a, b)]

    def length(path: list[int]) -> float:
        total = 0.0
        for i, j in zip(path, path[1:]):
            total += CELL * (1.4142 if abs(i - j) not in (1, grid.ny) else 1.0)
        return total

    baths = [r for r in plan["rooms"] if r["type"] == "bathroom"]
    people, notes, blocked, privacy, detours = [], [], 0, 0, []
    for person in routines(plan):
        legs, day = [], 0.0
        stops = [s for s in person["stops"] if s != "bath" or baths]
        here = target(stops[0])  # where this person is: (room id, cell)
        for to in stops[1:]:
            src_id, a = here
            if to == "bath":  # the nearest bathroom they can reach, else the first one
                options = [target(bt) for bt in baths]
                options = [o for o in options if walk(a, o[1])] or options[:1]
                to_id, b = min(options, key=lambda o: len(walk(a, o[1]) or []) or 1e9)
            else:
                to_id, b = target(to)
            here = (to_id, b)
            path = walk(a, b)
            leg = {"from": names.get(src_id, "?"), "to": names.get(to_id, "?"), "ok": bool(path)}
            if path:
                pts, crossed = [], []
                for i in path:
                    x, y = grid.xy(i)
                    pts.append([r2(x), r2(y)])
                    owner = grid.owner[i]
                    if owner and (not crossed or crossed[-1] != owner):
                        crossed.append(owner)
                through = [o for o in crossed[1:-1] if o not in (src_id, to_id, "outside")]
                leg.update(path=_simplify(pts), length_m=r2(length(path)), through=[names[o] for o in through])
                day += length(path)
                ax, ay = grid.xy(a)
                bx, by = grid.xy(b)
                straight = math.hypot(bx - ax, by - ay)
                if straight > 1.5:
                    detours.append(length(path) / straight)
                for o in through:
                    room = rooms.get(o)
                    if room and room["type"] == "bedroom" and o != person.get("home"):
                        privacy += 1
                        notes.append(f"{person['name']} walks through {room['name']} on the way from {leg['from']} to {leg['to']}")
            else:
                blocked += 1
                bare = bare or Grid(plan, furniture=False)
                free_path = bare.route(a, b) if a is not None and b is not None else None
                culprits = sorted({item_name[grid.item[i]] for i in free_path or [] if grid.item[i] in item_name})
                why = (f"the {', '.join(culprits)} {'is' if len(culprits) == 1 else 'are'} in the way" if free_path and culprits
                       else "there is no door on the way" if a is not None and b is not None else "there is no entrance")
                leg["why"] = why
                notes.append(f"{person['name']} can't get from {leg['from']} to {leg['to']}: {why}")
            legs.append(leg)
        people.append({"name": person["name"], "role": person["role"], "legs": legs, "daily_m": r2(day)})
    detour = sum(detours) / len(detours) if detours else 1.0
    if detour > 2.0:  # a hallway plan is usually 1.5-1.9: rooms are entered from the corridor, not straight across
        notes.append(f"Routes are on average {detour:.1f} times the straight-line distance: people walk the long way round")
    score = max(0, 100 - 30 * blocked - 15 * privacy - (0 if detour <= 2.0 else 10 if detour <= 2.6 else 20))
    return {"people": people, "notes": list(dict.fromkeys(notes)), "score": score, "mean_detour": r2(detour), "grid_m": CELL}


def _simplify(points: list[list[float]]) -> list[list[float]]:
    """Drop points that continue in the same direction."""
    out = points[:1]
    for k in range(1, len(points) - 1):
        a, b, c = out[-1], points[k], points[k + 1]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            out.append(b)
    return out + points[-1:] if len(points) > 1 else out


# ---------------------------------------------------------------- space

def _clearance(room: dict, items: list[dict], step: float = 0.1) -> float:
    """The radius of the largest circle that fits in the room clear of its walls and furniture (sampled every 10 cm)."""
    boxes = [footprint(it) for it in items]
    best, y = 0.0, room["y"] + step / 2
    while y < room["y"] + room["h"]:
        x = room["x"] + step / 2
        while x < room["x"] + room["w"]:
            d = min(x - room["x"], room["x"] + room["w"] - x, y - room["y"], room["y"] + room["h"] - y)
            for x0, y0, x1, y1 in boxes:
                d = min(d, math.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1)))
            best = max(best, d)
            x += step
        y += step
    return best


def space(plan: dict) -> dict:
    """Furniture cover, a wheelchair turning circle in the rooms that need one, and door widths."""
    if not plan["rooms"]:
        return {"rooms": [], "notes": [], "score": None}
    rows, notes, crowded, no_turn = [], [], 0, 0
    for r in plan["rooms"]:
        cover = 0.0
        for it in plan.get("items", []):
            x0, y0, x1, y1 = footprint(it)
            w, h = min(x1, r["x"] + r["w"]) - max(x0, r["x"]), min(y1, r["y"] + r["h"]) - max(y0, r["y"])
            cover += w * h if w > 0 and h > 0 else 0
        cover = cover / area(r)
        clearance = _clearance(r, plan.get("items", []))
        turn = clearance >= TURN_RADIUS - 1e-6
        rows.append({"room": r["name"], "id": r["id"], "furniture_cover": r2(cover), "turning_circle": turn, "clearance_m": r2(clearance)})
        if cover > 0.55:
            crowded += 1
            notes.append(f"Furniture covers {cover * 100:.0f}% of {r['name']}")
        if r["type"] in ("bathroom", "hallway", "living", "kitchen") and not turn:
            no_turn += 1
            notes.append(f"A 1.5 m wheelchair turning circle doesn't fit in {r['name']}")
    small = 0
    for r in plan["rooms"]:  # a room too small for its use (rules of thumb from gt/floorplan.py)
        if area(r) < MIN_AREA.get(r["type"], 0) - 0.02 or min(r["w"], r["h"]) < MIN_SIDE.get(r["type"], 0) - 0.02:
            small += 1
            notes.append(f"{r['name']} is small for a {r['type']} ({area(r):.1f} m², {min(r['w'], r['h']):.2f} m across)")
    narrow = [w for w in check(plan)["warnings"] if "usual minimum" in w]
    notes += narrow
    score = max(0, 100 - 10 * crowded - 8 * no_turn - 12 * small - 5 * len(narrow))
    return {"rooms": rows, "notes": notes, "score": score}


# ---------------------------------------------------------------- all together

def simulate(plan: dict, latitude: float = 28.6, day: int = DAYS["winter"], north: float = 0.0) -> dict:
    """The whole simulation with its three scores (each 0-100, or None when it doesn't apply) and their mean."""
    sun = sun_day(plan, latitude, day, north)
    daylight = daylight_score(plan, sun)
    moves = movement(plan) if plan["rooms"] else {"people": [], "notes": [], "score": None}
    room = space(plan)
    scores = {"daylight": daylight["score"], "movement": moves["score"], "space": room["score"]}
    present = [v for v in scores.values() if v is not None]
    return {"sun": sun, "daylight": daylight, "movement": moves, "space": room, "scores": scores,
            "overall": round(sum(present) / len(present)) if present else None, "plan_check": check(plan)}


def summary(result: dict) -> dict:
    """The simulation without the drawing data, for the design assistant."""
    names = {"n": "north", "s": "south", "e": "east", "w": "west"}
    return {"scores": result["scores"], "overall": result["overall"],
            "sun_on_each_wall_h": {f"{names[k]} walls (facing {FACING[int(round(((result['sun']['north'] + deg) % 360) / 45)) % 8]})": v
                                   for k, deg, v in ((k, {"n": 0, "e": 90, "s": 180, "w": 270}[k], v) for k, v in result["sun"]["wall_sun_hours"].items())},
            "daylight": {"rooms": [{k: x[k] for k in ("room", "sun_hours", "glazing_ratio")} for x in result["daylight"]["rooms"]], "notes": result["daylight"]["notes"]},
            "movement": {"daily_m": {p["name"]: p["daily_m"] for p in result["movement"]["people"]}, "notes": result["movement"]["notes"],
                         "mean_detour": result["movement"].get("mean_detour")},
            "space": {"notes": result["space"]["notes"]}, "plan_errors": result["plan_check"]["errors"]}
