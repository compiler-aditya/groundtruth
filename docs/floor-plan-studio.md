# Floor plan studio

**Design the building, then check the site against it, in one place.**

GroundTruth checks what was built against the design. Until now the design had to arrive as CSV files and PDF sheets made somewhere else. The floor plan studio lets the people who own the design make it in GroundTruth:

- a homeowner sketches the home they want,
- an architect refines it,
- and the same plan becomes the drawing and schedules the site is verified against.

Plan, build, verify, from one source of truth.

## Who it is for

| Person | What they do in the studio |
|---|---|
| Homeowner or client | Starts from a template or a blank page, drags rooms into place, places doors, windows and furniture, and sees room areas and the total floor area as they go. No CAD knowledge needed. |
| Architect or designer | Opens the client's plan, corrects dimensions precisely by typing them, adds the door and window schedule, and issues it as a revision. |
| Builder or site engineer | Prints or exports the issued sheet. Later, GroundTruth checks site photos against that revision. |

It works for any building made of rooms: a house, an apartment, an office, a shop, a clinic.

## Version 1: the editor (built first, no account needed)

- **Rooms:** draw a room by dragging, then move it, resize it from any edge or corner, or type exact sizes. Rooms snap to a 10 cm grid and to each other's walls. Each room has a name and a type (bedroom, kitchen, bathroom and so on).
- **Walls are worked out, not drawn.** Where two rooms touch, the shared wall is an interior wall; everything else is exterior and drawn thicker.
- **Doors and windows** are placed by clicking on a wall. They stay attached to their room when it moves. A door's hinge side and swing direction can be flipped.
- **Furniture and fixtures:** beds, sofas, tables, kitchen units, toilets, showers, baths, stairs and more. Each can be moved and rotated.
- **Always-visible numbers:** each room's area, the total floor area, and a schedule of rooms, doors and windows. These are computed by the code, never estimated.
- **Editing comfort:** undo and redo, keyboard shortcuts, duplicate, nudge with the arrow keys, zoom to fit, and pan.
- **Templates** to start from: studio apartment, two-bedroom home, small office.
- **Saved automatically** in the browser. Plans can be exported as JSON (to move or back up) and imported again.
- **Export a sheet** as SVG or PNG, with a title block (project, sheet number, revision, date, scale bar). This is the drawing a builder works from.

The editor is plain HTML, CSS and JavaScript like the rest of the app. Rooms are rectangles in version 1; an L-shaped space is two rooms.

## Version 2: Meta's models as a design assistant

Same rule as the rest of GroundTruth: the model proposes, the code measures.

- **Describe it (built):** "a three-bedroom house of about 110 m² with an open kitchen", or a change to the current plan. Muse Wonder builds the plan by calling geometry tools: add a room, connect two rooms, add the entrance and windows, check the plan. The code places everything, refuses overlapping rooms, doors that don't fit their wall and plans with rooms that can't be reached, and tells the agent what to fix. Furniture is not placed yet.
- **Photo of a sketch:** Muse Spark 1.3 reads a hand sketch or an existing drawing into an editable plan.
- **Review:** the code checks measurable things, such as rooms below a minimum size, doors narrower than 80 cm and bedrooms without a window. The model explains each issue in plain words and proposes an edit. The person accepts or rejects each proposal.

## Version 3: architect and client on the same plan

- **Share links with roles:** owner, architect (can edit) and viewer.
- **Revisions:** issuing the plan freezes it as revision A, B, C, with who changed what.
- **Comments pinned to a spot** on the plan, so "make this window bigger" points at the window.
- **Proposals:** an architect's change can be a proposal the client approves.

This needs a small database for shared plans. Version 1 keeps everything in the browser.

## Version 4: into the GroundTruth check

An issued plan becomes part of a project's design package:

- the sheet with its title block, entered in the drawing register at its current revision,
- the door and window schedule, and the quantities per room.

GroundTruth then checks the site against it, with the checks it already has. For example, a site photo of a printed sheet at an outdated revision is caught by the register check, and the doors counted on the sheet are checked against the schedule.

## Not in scope

Structural, mechanical or electrical engineering; certifying compliance with building codes (the review flags measurable issues for a professional to judge); 3D modelling.
