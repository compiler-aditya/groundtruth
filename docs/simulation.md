# Live in the plan before it's built

**A 2D simulation of how a plan works, not just how it looks, and an AI that tests its ideas in it before suggesting them.**

## What similar tools do today (checked 2026-11-02)

| Kind of tool | Examples | What you get |
|---|---|---|
| Floor plan software with AI assist | RoomSketcher, Planner 5D, Floorplanner, Homestyler | Draw walls and place furniture yourself. AI suggests layouts or furniture, and the result is shown in 3D walkthroughs and renders. You see how it *looks*. |
| Text-to-plan generators | Maket, Floor Plan AI | A layout generated from a brief, as a starting point to edit. |
| Sketch, photo and scan to plan | ArchitectGPT, Planner 5D recognition, RoomSketcher, CubiCasa | An existing sketch, blueprint or room becomes a clean or furnished plan. |
| Professional performance analysis | Autodesk Forma | Sun hours, daylight potential, wind and noise for architects, at the scale of buildings on a site. |

The gap: a homeowner or a small practice can see how a plan looks, or get a layout generated, but can't easily see how it **works** room by room:
- Does the kitchen get morning sun in winter?
- How far does each person walk in a day?
- Do guests cross a bedroom to reach the WC?
- Does the wardrobe block the way to the balcony?

Generated layouts are usually judged by eye.

## What GroundTruth does differently

1. **Simulate living in it, room by room.**
   - **Sun:** follow the sun through every window over a day, at your latitude and date, with the plan turned to its real orientation. The patches of sunlight are drawn on the floor, and each room's hours of direct sun are counted.
   - **Movement:** people's daily routes are walked through the doors and around the furniture, with the metres walked, the rooms crossed and the trips that can't be made.
   - **Space:** free floor, room for a wheelchair to turn, and door widths.
2. **Scores the code measures, never the model.** The daylight, movement and space scores come from the geometry, with the formula shown. They are rules of thumb for comparing options, not a building-code assessment.
3. **An AI that tests before it suggests.** Ask Muse Wonder for "more sun in the living room" or "shorter walks". It runs the simulation as a tool, changes the plan, runs it again, and can only finish if the measured score went up. You see the before and after scores and keep or undo the change.
4. **The same plan goes on to the build.** An issued plan becomes the design that GroundTruth checks the site against: SAM 3.1 counts, Muse Spark 1.3 reads plates and drawings, and Spark Open hears and watches narrated walkthroughs. No consumer planner we looked at closes that loop.

## How the simulation works

- **Sun.** Solar position from latitude, day of year and solar time (standard declination and hour-angle formulas; times are solar time, within about an hour of clock time).
  - A window gets direct sun when the sun is above the horizon and in front of its wall.
  - Its patch on the floor is the window opening (sill 0.9 m, head 2.1 m) projected along the sun's direction, clipped to the room.
  - Every 15 minutes from sunrise to sunset is sampled.
- **Daylight score.** For each living room, bedroom, kitchen, office and similar room: half for hours of direct sun (up to 3 h counts in full), half for window area as a share of floor area (10% counts in full, a common rule of thumb).
- **Movement.** The floor becomes a 15 cm grid.
  - Walls block, except at doors and open passages. Furniture blocks, with a margin. People walk the shortest route (A*).
  - Routines come from the rooms present:
    - homes: residents from bedroom to bathroom, kitchen, living room and out, and back in the evening, plus a guest visiting the living room and WC;
    - clinics and offices: a visitor through reception, waiting and the treatment or meeting room, and staff to their room, kitchen and WC.
  - Points are taken off for trips that can't be made, guests crossing a bedroom, and routes much longer than the straight line.
- **Space.** Furniture cover per room, whether a 1.5 m turning circle fits in hallways, bathrooms and living rooms, and door widths.

## Built in this order

1. Sun and daylight simulation (Python, `gt/simulate.py`), tested without the browser.
2. Movement and space simulation and the scores.
3. `/api/plan/simulate`: no model calls, instant.
4. Simulate mode in the editor: sun patches with a time slider, walking people, scores and issues.
5. "Improve with AI": Muse Wonder with a `simulate` tool, before and after scores, keep or undo.

Later: Muse Spark 1.3 reading a photo of a sketch into a plan, and Spark Open turning a narrated phone walkthrough of an existing home into an as-built plan to simulate and improve.
