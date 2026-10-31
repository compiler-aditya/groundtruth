# GroundTruth

**An agent that checks a construction site against its design package, with evidence, using Meta's models.**

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
| [gt/agent.py](gt/agent.py) | Muse Wonder tool-calling loop (Responses API, stateless replay, parallel tool calls) |
| [gt/tools.py](gt/tools.py) | The tools, verdict rules, evidence store and result cache |
| [gt/drafts.py](gt/drafts.py), [gt/report.py](gt/report.py), [gt/evaluate.py](gt/evaluate.py) | NCR/RFI/OBS drafting with the grounding check, the HTML report, scoring against an answer key |
| [gt/sam.py](gt/sam.py), [gt/spark.py](gt/spark.py), [gt/nameplate.py](gt/nameplate.py), [gt/drawing.py](gt/drawing.py), [gt/walkthrough.py](gt/walkthrough.py), [gt/claims.py](gt/claims.py) | Model-level building blocks |
| [day1/](day1) | The four model go/no-go tests and their real-data scoring ([docs/day1-tests.md](docs/day1-tests.md)) |

## Built during the hackathon

Everything in this repository was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026): first the model tests in `day1/`, then the agent, tools, drafts and report. The git history shows the order. Third-party code is limited to the libraries in [requirements.txt](requirements.txt). Sample media belongs to its authors under the licences in [samples/real/SOURCES.md](samples/real/SOURCES.md); it is not redistributed here but downloaded by `day1/fetch_real_samples.py`. The synthetic samples in `samples/` are generated by `day1/make_samples.py`.
