# GroundTruth: Day 1 tests

Four go/no-go tests that decide whether the GroundTruth pipeline (design package vs. what is actually built) works on Meta's models before we build the product around it.

| # | Script | Model | Question it answers |
|---|---|---|---|
| 1 | `day1/01_sam_count.py` | SAM 3.1 (+ Muse Spark 1.3 cross-check) | Can we count installed components in drone stills? |
| 2 | `day1/02_nameplate.py` | Muse Spark 1.3 | Can we read nameplates into exact JSON and catch schedule mismatches? |
| 3 | `day1/03_drawing_sheet.py` | Muse Spark 1.3 (+ optional SAM) | Can we read a drawing sheet: title block, tags, symbol counts? |
| 4 | `day1/04_walkthrough_spark_open.py` | Muse Spark Open on Baseten | Can one model connect a narrated video's audio and visuals and catch "said vs. seen" conflicts? |

## Setup

```bash
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env    # then put your two keys in .env
```

Needs ffmpeg for test 4 (`brew install ffmpeg`). Every script takes `--dry-run` (no API calls) and `--help`.

## 1. Smoke test on synthetic samples

`day1/make_samples.py` writes made-up samples with known answers into `samples/` (already generated; rerun any time). They prove the pipeline runs end to end. They are not a substitute for real data.

```bash
.venv/bin/python day1/01_sam_count.py samples/drone --phrase "solar panel" --expected "solar panel=192" --tiles 2 --spark-check
.venv/bin/python day1/02_nameplate.py samples/nameplates --schedule samples/equipment_schedule.csv
.venv/bin/python day1/03_drawing_sheet.py samples/drawing/E-101_synthetic.pdf --count "duplex receptacle" --count "light fixture" --expected "duplex receptacle=14" --expected "light fixture=10" --sam-phrase "light fixture"
.venv/bin/python day1/04_walkthrough_spark_open.py samples/walk/synthetic_walk.mp4 --context-file samples/area_context.txt
```

Expected answers:
- **Drone:** 180 of 192 modules installed (row 4 is missing 9, row 2 is missing 1, row 7 is missing 2).
- **Nameplate M-101:** 50 HP, 460 V, XP-2150. The schedule says 75 HP, which should be flagged as a **mismatch**. 480 V vs. 460 V should come back as **acceptable**, not a mismatch.
- **Drawing E-101:** revision 2; 14 receptacles and 10 fixtures (the legend's sample symbols must not be counted); tags LP-1, TX-1, EF-1.
- **Walkthrough:** the narrator says row 4 is complete and the motor shows 75 HP. Both are false, so both should appear under `audio_visual_conflicts`.

Outputs (overlays, JSON) go to `out/`.

### Smoke-test results (2026-10-31, synthetic samples)

| Test | Result | Verdict |
|---|---|---|
| 1. Drone count | SAM 180/180 with `--tiles 2` (mean confidence 0.91). Spark 180/180 on the whole image | Pass. SAM **needs tiles** (134/180 untiled). Spark counts best **untiled** (185–238 when tiled, because its points on identical panels are too loose to merge across tile seams) |
| 2. Nameplate | All 7 identity fields and all 11 ratings exact. 75 hp flagged as **mismatch**, 480 V vs. 460 V as **acceptable** | Pass |
| 3. Drawing | Title block 100%, tags 3/3, receptacles 14/14, fixtures 10/10 (legend excluded), with 2×2 tiles and with the whole-sheet default added later | Pass for Spark. **SAM found 0 fixtures**, so SAM is a no-go on line drawings |
| 4. Walkthrough | **Video pass (Spark Open):** spoken notes verbatim; the motor claim caught every run; the row-4 claim caught in only 2 of 3 runs (once it misread the aerial as ~24 modules). **Claim check on full-resolution stills (Spark 1.3 + SAM):** row 4 → SAM counts **15 in scope vs. 24 claimed → contradicted**; "75 HP" → contradicted (plate reads 50); "this is M-101" → confirmed. Cost ≈ $0.02 Baseten + $0.03 Meta per 40 s clip | Pass with the claim check. Video gets ~70 tokens per frame (≈6.9K / 96 frames), fine for narration and close-ups but not for counting in wide shots, so counts come from the stills |

Meta API spend for all of the above, including re-runs: under $0.50.

## 2. Run on real data

`samples/real/` holds 16 openly licensed real files: 4 drone stills, 7 nameplates, 2 drawing sheets and 3 CC0 site clips. Credits are in [samples/real/SOURCES.md](samples/real/SOURCES.md). The answer key is in [ANSWERS.txt](samples/real/ANSWERS.txt) and [ground_truth.json](samples/real/ground_truth.json); Claude wrote it from full-resolution zooms, and nobody has checked it by hand. The walkthrough video is real footage with a scripted, synthetic narration (three true claims, three false), built by `day1/make_real_walk.py`.

```bash
.venv/bin/python day1/01_sam_count.py samples/real/drone/taipei_energy_hill_nadir.jpg samples/real/drone/calgary_rows_nadir.jpg samples/real/drone/diagonal_rows_nadir.jpg --phrase "solar panel" --tiles 2 --modules
.venv/bin/python day1/02_nameplate.py samples/real/nameplates --schedule samples/real/schedule.csv
.venv/bin/python day1/03_drawing_sheet.py samples/real/drawing/uscg_bldg333_lighting_2nd_floor_1994.tiff --count "light fixture" --count "3-way switch" --expected "light fixture=104" --expected "3-way switch=28" --sam-phrase "light fixture"
.venv/bin/python day1/04_walkthrough_spark_open.py samples/real/walk/real_walk.mp4 --context-file samples/real/walk/area_context.txt
.venv/bin/python day1/score_real.py   # reads out/real_t1_modules, out/real_t2, out/real_t3, out/real_t4
```

Copy each test's output folder (`out/sam`, `out/nameplate`, `out/drawing`, `out/walkthrough`) to the matching `out/real_t*` folder before scoring.

### Real-data results (2026-10-31, after the fixes below)

| Test | Result | Verdict |
|---|---|---|
| 1. Drone count | **With a phrase alone, SAM and Spark count tables, not modules.** "solar panel" gives 24 and 24 on Taipei (its 24 tables) and 14 and 14 on Calgary (7 rows × 2 tables). "solar module", "photovoltaic module", "single solar panel" and "solar panel module" don't change that (24, 0, 37 and 24 on Taipei). **`--modules`** (SAM finds tables, Spark counts the module grid in each masked table crop): **Taipei 179 fully visible vs 188 (−4.8%), Calgary 475 vs 476 (−0.2%).** Before masking, Taipei 178–181 and Calgary 481–504 across runs; on the diagonal still, box crops held neighbouring tables and gave 827, masked crops 613. That still is low because SAM missed three glare-bleached rows. Oxford (high oblique): SAM boxed 88 tables, none on bare racks, but missed whole blocks | **Go on nadir stills with `--modules`.** Within ±5% on both hand-counted stills, Taipei only just. Counting tables with SAM alone is reliable. Check the overlay for missed rows (glare), and don't count from high oblique photos. Costs ~$0.009 per table (Taipei 24 tables ≈ $0.22) |
| 2. Nameplates | **92/92 legible fields exact** across 7 plates. Values Spark put in `notes` or `certification_marks` count, and short values are matched loosely. **All 7 schedule verdicts as expected:** ABB, CT and Loher PASS (380 V on a 400 V schedule marked acceptable); Malmbergs (0.55 vs 0.37 kW) and AEG (S 6472/4F vs /2F) FAIL; rusted TECO REVIEW with every stamped value unreadable; transformer REVIEW (phase only implied by Dyn 5). One slip: it read the printed box next to "kg" on the TECO plate as "WEIGHT 20 kg" | **Go.** On a 779 px plate photo some digits are ambiguous even to a person, so ask for close-ups |
| 3. Drawing | US Coast Guard lighting plan, 1994. **Title block all right**, including the new drawing-number field (NY 0514). Both panel tags and all fixture-type marks found. Light fixtures: 2×2 tiles 116 (+11.5%, the same fixture counted from both sides of a tile overlap); **whole sheet 112 (+7.7%) and 109 (+4.8%) on two runs**. 3-way switches, whole sheet: 25 (−10.7%) and 28 (0%). Synthetic sheet, whole: 14/14 and 10/10. SAM: 0 fixtures | **Go for title blocks. Counts are borderline:** within ±10% on most runs, but they swing ±5% between runs and are off by up to 25% in a single room. Show the overlay for a person to confirm. SAM stays off drawings |
| 4. Walkthrough | Real CC0 footage, 44 s, scripted narration. 1/1 clip valid JSON, no retry. **3/3 false claims contradicted** in both the video pass and the stills check. **0 true claims contradicted.** The "forty strips" claim: SAM counted 26 strip halves in scope, Spark 13 strips → contradicted. Cost ≈ $0.02 Baseten + $0.15 Meta | **Go.** The voice is clean text-to-speech, so a real phone narration (wind, accents, crosstalk) is still untested |

Fixes made after the first real-data run:
- **Test 2:** the schedule `tag` column now only finds the row and is no longer compared against the plate. Plates rarely carry project tags, so the comparison had forced every plate to REVIEW.
- **Test 3:**
  - It counts on the whole sheet by default (`--tiles 1`).
  - It scales count tiles to `--count-max-side` (4096); the API rejects a 7177 px image.
  - The title block has a `drawing_number` field.
- **Test 1:** `--modules` crops each SAM table with its mask ([gt/sam.py](gt/sam.py) `masked_crop`). Spark then counts the module grid in each crop ([gt/spark.py](gt/spark.py) `count_modules_per_table`), and the table counts are summed.

Meta spend for the real-data runs, experiments and re-runs: about $2.20; Baseten about $0.02.

### Your own data

Put real files in `samples/real/` (or anywhere) and point the scripts at them:

- **Drone stills:** 3–5 overhead photos of a solar site under construction. Your own or a partner's are best. If you take public images (e.g. Wikimedia Commons), check each file's license. Hand-count one image to score against.
- **Nameplates:** 5+ phone photos of real motor, pump, transformer or inverter plates, including one with glare or an angle. Write a schedule CSV with one deliberately wrong value.
- **Drawing sheet:** one real plan sheet (PDF or image). Public bid sets from government agencies are a good source. Hand-count one symbol type.
- **Walkthrough:** a 1–3 minute phone video of any work area, with you narrating and one deliberate false claim.

## Go / no-go

| Test | Go if… | If no-go |
|---|---|---|
| SAM counting | Count within ±5% of a hand count on 3 real stills; no systematic misses in the overlays | Try `--tiles 2/3` and more specific phrases. Otherwise fall back to Spark point-and-count |
| Nameplates | ≥90% of legible fields exact; the planted mismatch is flagged every time | Raise `--effort`; send a tighter crop of the plate |
| Drawing sheet | Title block 100% right, ≥80% of tags found, symbol counts within ±10% | More tiles / higher `--dpi`; restrict to schedules and title blocks |
| Spark Open walkthrough | Spoken notes captured, the planted conflict caught, ≥90% of clips valid JSON without a retry | Shorter clips; `--effort high`; or split the job between Spark 1.3 (video) and Voice Transcribe (audio) |

Record SAM-on-drawings (`--sam-phrase` in test 3) either way. It decides whether SAM is used on drawings at all.

## Cost per run (pay-as-you-go)

SAM costs $2.50 per 1,000 images, so a 2×2-tiled still is 1 cent. Spark 1.3 and Spark Open cost $1.25 / $4.25 per 1M tokens in/out, so each nameplate or sheet read is roughly 1–3 cents. A 45 s walkthrough clip is about 6–7K video tokens plus audio and reasoning, so a few cents. The whole Day 1 run should cost under $2.

## Notes from the docs that shaped these scripts

- SAM takes **one short noun phrase per request**. Use separate requests for "solar panel" and "pile". Video tracking is capped at 16 objects per frame, so counting uses stills.
- Images are rotated per EXIF and re-encoded before sending, so the coordinates SAM and Spark return line up with the overlays.
- Spark grounding uses a 0–1000 grid. Counts are done per tile, mapped back to pixels and de-duplicated across tile overlaps.
- Hackathon Baseten keys only work with the model ID `meta-models/muse-spark-open-1026` (the default in `gt/config.py`; override with `SPARK_OPEN_MODEL` in `.env`). Other IDs return `403 please check the api-key`.
- Spark Open on Baseten has **no structured output or JSON mode**, so test 4 validates JSON itself and retries once. Its video encoder samples at most 96 frames per clip, so clips default to 45 s.
- Test 4 runs in two passes. Spark Open hears the narration and lists each claim. Then [gt/claims.py](gt/claims.py) pulls full-resolution stills from the original video at that moment. Spark 1.3 judges each claim on the stills and, for quantity claims, names the object and boxes the region the claim covers, and SAM counts inside that box. The verdict is exact match = confirmed, off by 1 (or 5%) = needs review, otherwise contradicted. Overlays are saved next to the report.
- Spark Open reasons at its highest standard level by default. Test 4 sets `--effort medium` and prints reasoning tokens per clip, so you can compare `low` / `medium` / `high`.
