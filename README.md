# GroundTruth

**An agent that checks a construction site against its design package, with evidence, using Meta's models.**

**Live demo: https://groundtruth-mu-gules.vercel.app.** Watch the agent work through the demo package step by step (live, or as a recorded run), browse every finding with its evidence and draft, or try your own photos. Uploads need the access code given in the hackathon submission.

On a big site (a solar farm, a substation, a plant) commissioning means proving that what was built matches thousands of lines of design: quantities, equipment schedules, drawing revisions. Today that is people walking the site with clipboards, and progress reports that are taken on trust. Mistakes surface at handover, when they are expensive.

GroundTruth takes the design package and the captures a site already produces (drone stills, nameplate photos, a narrated phone walkthrough). A Muse Wonder agent works out which capture proves which design item and runs the checks with SAM 3.1, Muse Spark 1.3 and Muse Spark Open. Code decides each verdict from the measurements. Every failure becomes a finding linked to its evidence, and Muse Spark 1.3 drafts the paperwork: a Non-Conformance Report (NCR) for wrong work, a Request for Information (RFI) when the design is unclear, and an observation report when what someone reported is contradicted by the evidence.

```
design package ─┐                          ┌─ SAM 3.1 ........ counts modules, tables, objects on drone stills
  quantities    │                          ├─ Spark 1.3 ...... reads nameplates, title blocks, counts drawing symbols,
  equip schedule├─► Muse Wonder agent ─────┤                   judges walkthrough claims on full-resolution stills
  drawing reg.  │   plans, calls tools     └─ Spark Open ..... hears + sees each walkthrough clip (Baseten)
  site notes    │   in parallel, follows up          │
captures ───────┘                                    ▼
  drone stills, nameplate photos,         verdicts computed in code ─► findings (each tied to a result + images)
  drawings, narrated walkthroughs                                      ─► Spark 1.3 drafts NCR / RFI / OBS (grounding-checked)
                                                                       ─► report.html
```

## Quick start

```bash
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env                               # MODEL_API_KEY (Meta Model API), BASETEN_API_KEY
.venv/bin/python day1/fetch_real_samples.py        # the public sample media (not in the repo; checksums verified)
.venv/bin/python groundtruth.py run projects/demo-solar
open out/runs/demo-solar/latest/report.html
```

Needs ffmpeg (`brew install ffmpeg`). Results are cached by tool, arguments and file, so a second run only pays for the agent and the drafts; `--no-cache` recomputes everything.

## Web app

```bash
.venv/bin/python scripts/build_web.py assets      # thumbnails, a 720p copy of the walk, example nameplates for the upload page
.venv/bin/python scripts/build_web.py record      # saves a real run as the recorded run (and lists the cache it used)
.venv/bin/uvicorn app:app --port 8000             # http://localhost:8000
```

[app.py](app.py) streams each run as newline-delimited JSON ([gt/live.py](gt/live.py)). Agent notes, tool calls, results with their evidence images, findings and drafts all arrive in one response, so it runs on a serverless host. The UI is plain HTML, CSS and JS in [public/](public).
- **The home page** opens on the Studio playing live: the plan draws itself while the sun crosses it, the same plan turns in 3D as the sun moves through the day, then a walk at eye height in through the front door. It is the real 3D view in a hands-off showreel mode ([public/studio3d.js](public/studio3d.js)), and falls back to pictures without WebGL and stays still for reduced motion.
- **Live runs** of the demo use Muse Wonder in real time, with measurements served from a cache shipped with the deployment: about a minute and $0.40.
- **The recorded run** plays back a real run with no API calls.
- **Uploads** are photos and drawings, shrunk in the browser to fit Vercel's 4.5 MB request limit.
- **Guards:** per-instance limits on concurrent runs and runs per visitor per hour, file count and size limits, and an optional `GT_UPLOAD_CODE`.

Deploy: `scripts/build_web.py dist` assembles `dist/`: the app, the demo package with every capture's hash, the images, only the cache entries the demo needs, and no `.env`. Then run `vercel deploy dist --prod` and set `MODEL_API_KEY` in the Vercel project to turn on live runs.

## Studio

**Design a building by talking to it, then walk through it.** Click **Studio** in the navbar: it opens as its own app at `/studio` ([public/studio.html](public/studio.html)). It starts with a box to describe a building or upload a sketch, which goes straight to the AI designer, then your designs and the templates. The AI designer chat beside the canvas does the heavy lifting, and each change appears on the drawing as it is made:
- **Ask.** Describe a building, or a change ("make the kitchen 1 m wider and add a study next to the bedroom"). Muse Wonder edits the plan with the editor's own tools. The conversation is kept, so follow-ups work, and every reply can be undone.
- **Upload a raw draft:** a hand sketch, a photo of a drawing, an old plan or a PDF. Muse Spark 1.3 reads its rooms, written dimensions, doors and windows ([gt/sketch.py](gt/sketch.py)). The code turns them into metres, and Wonder lays them out as a clean, checked plan.
- **3D** builds the model from the plan: walls, open doors, glass, floor finishes, furniture, and the sun for the site's city, date and hour.
- **Walk** puts you inside at eye height: WASD or on-screen arrows to move, the mouse to look, and a minimap. Walls and furniture are solid.
- **Tools and layers.**
  - Tools: select, room, door, window, furniture (19 pieces), measure and note.
  - Editing: snap, undo and redo, copy and paste, arrow-key nudges, floor finishes and wall height.
  - Layers show, hide or lock rooms, labels, walls, openings, furniture, notes, dimensions and the grid.
  - Room areas, the total floor area and the door and window schedule are computed as you go.
  - On a phone or tablet the tools run in a strip above the plan, and two fingers pinch to zoom and pan.
- **Export:**
  - a drawing sheet (PNG or SVG) with a title block, sheet number and revision;
  - the 3D model as GLB, for Blender, SketchUp or an AR viewer;
  - the 3D view as an image;
  - the design file (JSON).

  Designs are saved in the browser, and in your account when you sign in.
- **Accounts** ([gt/accounts.py](gt/accounts.py), [public/auth.js](public/auth.js)) are optional: anyone can design as a guest.
  - Signing up takes an email and a password, and the designs then follow you to any browser.
  - Designs made as a guest move into the account at sign-in.
  - Passwords are hashed with scrypt. The session cookie is HttpOnly and SameSite=Lax, and only a hash of its token is stored.
  - Changes from other sites are refused, and repeated failed sign-ins are throttled.
  - Storage is Postgres when `DATABASE_URL` is set (Neon on Vercel) and SQLite locally. Accounts switch off on a serverless host with no database.

**Design with AI.** Describe a building ("a three-bedroom family house of about 110 m² with an open kitchen") or a change ("add a 9 m² home office next to the living room"), and Muse Wonder lays it out with the editor's own tools while you watch the rooms appear. The model proposes and the code measures:
- [gt/floorplan.py](gt/floorplan.py) places each room against another (`next_to`, `side`, `align`) and refuses overlaps, saying which room and by how much.
- It finds the shared wall for each door, and uses outside walls only for the entrance and windows.
- `finish` is refused until `check_plan` finds no overlaps, an entrance, and every room reachable. Warnings flag missing windows, windows that a new room has covered, and rooms below rule-of-thumb sizes.
- `furnish_room` places the usual furniture for each room's type. Each piece goes against a wall, clear of doorways and of the other pieces, and a piece that does not fit is refused with the reason. Furniture follows its room when the room is moved or resized.

The loop is [gt/planner.py](gt/planner.py). The studio chat streams it from `/api/studio/chat`, with the conversation so far and any attached draft.

| Live run (Muse Wonder, 2026-11-02) | Result | Refusals | Time | Cost |
|---|---|---|---|---|
| "Three-bedroom family house of about 110 m²…" | 8 rooms, 110.2 m², 0 errors, 0 warnings | 0 | 83 s | $0.29 |
| "One-bedroom apartment of about 50 m² with a balcony" | 6 rooms, 51.1 m², 0 errors, 0 warnings | 2 (an entrance on a hallway wall too short; it moved the entrance to the living room) | 67 s | $0.25 |
| Then "add a home office of about 9 m² next to the living room" | 7 rooms, 60.1 m², existing rooms unchanged | 0 | 22 s | $0.08 |
| "A small dental clinic with a reception, a waiting room, two treatment rooms, a staff room, a WC and a store" | 8 rooms, 80.3 m², 0 errors, 0 warnings, typed as a clinic | 0 | 49 s | $0.20 |
| A hand sketch uploaded in the studio chat (a test drawing: six rooms, the overall size written as 12 m × 8 m) | Laid out as drawn: 12 × 8 m, 96 m² | not recorded | 54 s | $0.27 |
| Studio chat, on a furnished one-bedroom: "Make the kitchen 1 m wider to the east, add a study of about 3 × 3 m next to the bedroom with a door from the hall and a window, and furnish it" | 6 rooms, 77.1 m². The study got its door, window and a desk. The bath moved east to make room, keeping its fixtures and its hall door. | not recorded (13 tool steps) | 69 s | $0.19 |

**Simulate: live in the plan before it's built.** Floor plan tools show how a plan looks; GroundTruth's Simulate mode shows how it works, room by room ([docs/simulation.md](docs/simulation.md), [gt/simulate.py](gt/simulate.py)):
- **Sun.** Patches of sunlight cross the floor through each window over a day, at the chosen city and date (21 December, March or June), with the plan turned to its real orientation. Each room's hours of direct sun are counted.
- **A day of moving around.** Residents, a guest, or a clinic's visitors and staff walk their routes through doors and around furniture on a 15 cm grid. Metres walked, routes that cross someone's bedroom and trips that are blocked (and by what) are reported.
- **Space.** Furniture cover, a 1.5 m wheelchair turning circle, rooms small for their use, and narrow doors.
- **Scores.** Daylight, movement and space, each 0–100, are measured from the geometry (about 50 ms per plan, no model calls). They are rules of thumb for comparing options, not a building-code check.

**Improve with AI.** Give a goal ("more sun in the bedrooms and the living room") and Muse Wonder changes the plan with a `simulate` tool. It re-runs the simulation after each group of changes and undoes what scores worse. The code refuses to let it finish if the overall score fell, and you see before and after scores, then keep or undo.

In a live run on the AI-designed three-bedroom house (Delhi, 21 December), Wonder:
- swapped a north-facing bedroom with the sunny kitchen and added west and south windows;
- saw the space score drop because the swapped bedroom was only 2.2 m wide, and widened it to 3.0 m;
- finished with daylight 79 → 90 and overall 90 → 94, in 15 turns, 94 s, $0.58.

What comes next is in [docs/floor-plan-studio.md](docs/floor-plan-studio.md): plan reviews with proposals to accept or reject, architect and client editing the same plan, and issued plans feeding GroundTruth's checks. The studio is [public/plans.js](public/plans.js), with 3D and walk mode in [public/studio3d.js](public/studio3d.js) (three.js).

## Tests

Offline tests, with every model call faked (no API key needed; `test_agent.py` needs the fetched samples):

```bash
for t in tests/*.py; do .venv/bin/python $t; done
```

## The demo package

[projects/demo-solar](projects/demo-solar) is a design package written for the demo around public captures: real drone stills, 7 real equipment nameplates, a real 1994 US Coast Guard lighting plan, real CC0 drone footage with a scripted narration, plus one synthetic drone still and one synthetic drawing sheet. It has 9 planted problems and 7 items that should pass, listed in [expected_findings.json](projects/demo-solar/expected_findings.json).

Three full agent runs on 2026-10-31:

| Run | Planted problems found (right document type) | False alarms | Should-pass items passed | Drafts on topic | Time | Cost |
|---|---|---|---|---|---|---|
| 1, everything computed | **9/9** | 1: a true narrated claim. SAM counted a scope box wider than the claim; fixed by requiring SAM and Spark to agree | 7/7 | 8/10 (drafted by Wonder) | 180 s | $0.86 |
| 2, after the fix | **9/9** | 0 | 7/7 | 5/9 (drafted by Wonder) | 194 s | $0.73 |
| 3, drafts by Spark 1.3 | **9/9** | 0 | 7/7 | **9/9**, all at the first attempt | 48 s (checks cached) | $0.37 |

In every run the agent matched all 7 nameplates to the right schedule row from what the plates show. It never sees file names. It planned the whole package in its first turn (14 parallel tool calls) and finished in 4 turns. A run with nothing cached costs about $0.80 and takes about 3 minutes, mostly the walkthrough video. Score any run with `python groundtruth.py evaluate out/runs/demo-solar/latest`.

## How it uses Meta's models, and what we learned

| Model | Used for | What surprised us (measured in [docs/day1-tests.md](docs/day1-tests.md)) |
|---|---|---|
| **Muse Wonder** | The agent: reads the package, matches plates to schedule rows by what they show, calls up to 14 tools in one turn, records findings | Plans the whole package in its first turn and starts the slow walkthrough check first. Tool calling was reliable in every run. But when it **drafted** documents from data-heavy prompts, it drifted to unrelated topics: 2–4 of 9 drafts per run were about something else (a rusted motor plate came back as "Maidstone agreeing entry rent fee"), though it answered a short probe correctly 5/5. So drafts moved to Spark 1.3 (9/9 on topic), behind a grounding check |
| **SAM 3.1** | Counting on drone stills; counting inside the region a narrator's claim is about | It counts a whole **table** of modules as one "solar panel", whatever the wording ("solar module", "photovoltaic module" and others all gave tables). So modules are counted in two stages: SAM masks each table, then Spark counts the module grid inside each masked crop. That gets within 0.2–5% of a hand count. It finds **0** symbols on line drawings, so drawings go to Spark |
| **Muse Spark 1.3** | Nameplates, drawing title blocks and symbol counts, module grids, judging walkthrough claims on full-resolution stills, drafting the NCR/RFI/OBS documents | 92/92 legible nameplate fields exact across 7 real plates. On a rusted plate it lists 17 fields as unreadable instead of guessing. Counting symbols on a whole sheet beats tiling it (tiles count seam symbols twice: +11.5% vs +4.8%) |
| **Muse Spark Open** (on Baseten, `meta-models/muse-spark-open-1026`) | One call per clip with the video and the narration audio: what was said, what was seen, and where they disagree | It caught every false narrated claim. But video arrives at about 70 tokens per frame, too coarse for counting, so every claim is re-checked on full-resolution stills |

## Built to be checked

- **The model chooses the checks; code decides the verdict.** `verify_quantity` compares counts with the design quantity and tolerance. `check_drawing_register` compares sheet number, title and revision. `check_equipment` maps the field-by-field comparison to pass, review or mismatch.
- **Findings can't be invented.** `record_finding` only accepts a result that did not pass, takes the facts and evidence from that result, and rejects duplicates. `finish` refuses to close while a failure has no finding.
- **Follow-ups are built in.** If the manufacturer on a plate differs from the schedule row the agent picked, the result is `wrong_row` and the agent must try another row. If SAM and Spark disagree on a narrated count, the claim goes to `needs_review` for a person rather than being called false.
- **Every number has a source.** The report shows, for each finding, the result ID, the tool and arguments, the models, the time, and the overlay images. Each run also writes `report.json`.
- **Drafts must stay on topic.** A draft has to name its subject (tag, area, sheet or claim) and its measured numbers, or it is regenerated. If it fails twice, a plain template built from the facts is used, and the report labels it.

## Project packages

```
projects/<name>/project.json        name, description, design files, drawings and captures (id, type, area, path)
projects/<name>/design/             quantities.csv, equipment_schedule.csv, drawing_register.csv, site_notes.md
projects/<name>/expected_findings.json   optional answer key: `groundtruth.py evaluate out/runs/<name>/latest`
```

Quantity methods: `objects` (SAM count), `tables` (SAM count of whole tables), `modules` (SAM tables, then Spark grids) and `drawing_symbol` (Spark points on a sheet). The agent only sees capture IDs, types, areas and labels, never file names, so it has to identify equipment from what the photos show.

## Code

| Path | What |
|---|---|
| [groundtruth.py](groundtruth.py) | `run` and `evaluate` commands |
| [app.py](app.py), [gt/live.py](gt/live.py), [public/](public), [scripts/build_web.py](scripts/build_web.py) | The web app, its event stream, the UI, and the asset/replay/deploy builder |
| [gt/pipeline.py](gt/pipeline.py) | One run: agent, drafts, report (shared by the CLI and the web app) |
| [gt/agent.py](gt/agent.py) | Muse Wonder tool-calling loop (Responses API, stateless replay, parallel tool calls) |
| [gt/tools.py](gt/tools.py) | The tools, verdict rules, evidence store and result cache |
| [gt/drafts.py](gt/drafts.py), [gt/report.py](gt/report.py), [gt/evaluate.py](gt/evaluate.py) | NCR/RFI/OBS drafting with the grounding check, the HTML report, scoring against an answer key |
| [gt/sam.py](gt/sam.py), [gt/spark.py](gt/spark.py), [gt/nameplate.py](gt/nameplate.py), [gt/drawing.py](gt/drawing.py), [gt/walkthrough.py](gt/walkthrough.py), [gt/claims.py](gt/claims.py) | Model-level building blocks |
| [gt/floorplan.py](gt/floorplan.py), [gt/planner.py](gt/planner.py), [gt/simulate.py](gt/simulate.py), [gt/sketch.py](gt/sketch.py) | Studio: plan geometry, checks and furniture placement; the design assistant's tools and loop; the simulation; reading uploaded drafts |
| [public/plans.js](public/plans.js), [public/studio3d.js](public/studio3d.js) | The studio UI (canvas, tools, layers, AI chat), and 3D and walk mode |
| [day1/](day1) | The four model go/no-go tests and their real-data scoring ([docs/day1-tests.md](docs/day1-tests.md)) |

## Built during the hackathon

Everything in this repository was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026): first the model tests in `day1/`, then the agent, tools, drafts and report. The git history shows the order. Third-party code is limited to the libraries in [requirements.txt](requirements.txt). Sample media belongs to its authors under the licences in [samples/real/SOURCES.md](samples/real/SOURCES.md); it is not redistributed here but downloaded by `day1/fetch_real_samples.py`. The synthetic samples in `samples/` are generated by `day1/make_samples.py`.
