"""The agent's tools. Each runs one check with Meta's models; the verdict is decided here, in code.

The model chooses what to check and how to describe what it found, but never sets a verdict. Every tool result
gets an ID (R1, R2, ...) and every image it produced an evidence ID (E1, ...). A finding can only be recorded
against a result that did not pass, so every finding in the report traces back to a measurement and its images.

Results are cached on disk by tool, arguments and file content, so re-running a package (or a live demo) only
pays for what changed.
"""

import asyncio
import hashlib
import json
import re
import shutil
import statistics
import threading
import time
from pathlib import Path
from typing import Callable

from PIL import ImageDraw

from .config import PRICE, meta_async_client, meta_client
from .drawing import count_symbols, read_sheet, render_sheet
from .media import fit_long_side, load_image, make_tiles
from .nameplate import check_against_schedule, read_plate
from .package import Item, Package
from .sam import Detection, draw_detections, label_detections, masked_crop, segment_tiles
from .spark import Usage, count_modules_per_table, grid_label
from .walkthrough import analyse

CACHE_VERSION = "1"
FINDING_KINDS = ("nonconformance", "design_query", "reporting_discrepancy")

STR = {"type": "string"}


def _fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}}


TOOL_SPECS = [
    _fn("verify_quantity",
        "Count what a quantity item covers in one capture and compare it with the design quantity. For method "
        "objects/tables/modules pass a drone_still of the item's area (SAM 3.1 segments; for modules Spark 1.3 then "
        "counts the module grid inside each table). For method drawing_symbol pass the drawing sheet the item names "
        "(Spark 1.3 points at every symbol). Returns observed vs design and a verdict: pass, short, over.",
        {"item_id": {**STR, "description": "item_id from design/quantities.csv"},
         "capture_id": {**STR, "description": "capture or drawing ID"}}, ["item_id", "capture_id"]),
    _fn("read_nameplate",
        "Transcribe one nameplate photo exactly (Spark 1.3): manufacturer, model, serial, ratings, legibility and "
        "the fields that cannot be read. Use it to work out which schedule row the equipment is.",
        {"capture_id": STR}, ["capture_id"]),
    _fn("check_equipment",
        "Compare a nameplate photo with one equipment schedule row, field by field. Verdict pass, review "
        "(something unreadable or not on the plate), mismatch, or wrong_row when the manufacturer differs, "
        "meaning you picked the wrong schedule row and should try another.",
        {"capture_id": STR, "schedule_tag": {**STR, "description": "tag from design/equipment_schedule.csv"}},
        ["capture_id", "schedule_tag"]),
    _fn("check_drawing_register",
        "Read a drawing sheet's title block (Spark 1.3) and compare its sheet number, title and revision with the "
        "drawing register. Verdict pass or mismatch, with the fields that differ.",
        {"drawing_id": STR}, ["drawing_id"]),
    _fn("check_walkthrough",
        "Review a narrated walkthrough video: Muse Spark Open hears and sees each clip and lists the narrator's "
        "claims; each claim is then judged on full-resolution stills by Spark 1.3, with SAM 3.1 counting for "
        "quantity claims. Uses the site notes for the capture's area as design context. Slow (1-3 minutes); "
        "run it in parallel with other checks. Returns each claim with a verdict: confirmed, contradicted, or "
        "needs_review / cannot_verify when the evidence is split or unclear (left to a person, not a finding "
        "unless something else supports it).",
        {"capture_id": STR}, ["capture_id"]),
    _fn("record_finding",
        "Record a finding for a result that did not pass. kind: nonconformance (installed work or equipment "
        "differs from the design), design_query (the design documents disagree, a revision is not current, or "
        "evidence cannot be read, so the designer or vendor must answer), reporting_discrepancy (a person's "
        "report or claim is contradicted by the evidence). Facts and evidence are taken from the result itself.",
        {"result_id": STR, "kind": {"type": "string", "enum": list(FINDING_KINDS)},
         "title": {**STR, "description": "short and specific, e.g. 'Block A: 12 modules missing'"},
         "explanation": {**STR, "description": "2-4 sentences citing the numbers in the result"},
         "claim_index": {"type": "integer", "description": "for walkthrough results: which claim; otherwise -1"}},
        ["result_id", "kind", "title", "explanation", "claim_index"]),
    _fn("finish",
        "Call once every item is checked and every failing result has a finding.",
        {"summary": {**STR, "description": "3-5 sentences for the project manager"}}, ["summary"]),
]


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


def _norm_rev(text: str) -> str:
    value = _norm(text).removeprefix("revision").removeprefix("rev").lstrip("0")
    return "" if value in ("", "none", "na", "nil") else value


def _row_profile(detections: list[Detection]) -> list[int]:
    """Detections grouped into rows by the gaps between their centres (top to bottom); empty if no clear rows."""
    if len(detections) < 4:
        return []
    heights = [d.box[3] - d.box[1] for d in detections]
    ys = sorted((d.box[1] + d.box[3]) / 2 for d in detections)
    gap = 0.5 * statistics.median(heights)
    rows, current = [], 1
    for prev, y in zip(ys, ys[1:]):
        if y - prev > gap:
            rows.append(current)
            current = 1
        else:
            current += 1
    rows.append(current)
    return rows if len(rows) >= 2 else []


def _area_notes(notes: str, area: str) -> str:
    """The site-notes section headed with this area, or all notes if there is none."""
    sections = re.split(r"(?m)^## ", notes)
    for section in sections[1:]:
        heading, _, body = section.partition("\n")
        if heading.strip().lower() == area.strip().lower():
            return f"{heading.strip()}: {body.strip()}"
    return notes


class Toolbox:
    def __init__(self, package: Package, run_dir: Path, cache_dir: Path, *, use_cache: bool = True,
                 log: Callable[[str], None] = print) -> None:
        self.package = package
        self.run_dir = run_dir
        self.evidence_dir = run_dir / "evidence"
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir = cache_dir
        self.use_cache = use_cache
        self.log = log
        self.results: dict[str, dict] = {}
        self.evidence: dict[str, dict] = {}
        self.findings: list[dict] = []
        self.summary = ""
        self.finished = False
        self._warned_unrecorded = False
        self.cost = {"spark_usd": 0.0, "sam_requests": 0, "baseten_usd": 0.0}
        self._plates: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}
        self._computed: set[str] = set()

    # ---------- plumbing ----------

    def call(self, name: str, args: dict) -> dict:
        """Run one tool call from the model; errors go back to the model as text so it can correct itself."""
        handler = getattr(self, f"tool_{name}", None)
        if handler is None:
            return {"error": f"unknown tool {name!r}"}
        try:
            return handler(**args)
        except (KeyError, ValueError, FileNotFoundError, TypeError) as error:
            return {"error": str(error).strip("'\"")}
        except Exception as error:  # an API or media failure: tell the model rather than end the run
            self.log(f"  ! {name} failed: {type(error).__name__}: {error}")
            return {"error": f"{name} failed ({type(error).__name__}: {str(error)[:300]}). You may retry once."}

    def _cached(self, tool: str, key_args: dict, items: list[Item], compute: Callable[[Path], tuple[dict, list, dict]]):
        """compute(work_dir) -> (data, [(file, caption)], cost). Returns the same plus whether it was cached."""
        key = hashlib.sha256(json.dumps(
            {"v": CACHE_VERSION, "tool": tool, "args": key_args, "files": [i.fingerprint() for i in items]},
            sort_keys=True).encode()).hexdigest()[:20]
        entry = self.cache_dir / key
        with self._lock:
            key_lock = self._key_locks.setdefault(key, threading.Lock())
        with key_lock:  # parallel calls needing the same result (e.g. a plate read) compute it once
            if (self.use_cache or key in self._computed) and (entry / "result.json").exists():
                saved = json.loads((entry / "result.json").read_text())
                return saved["data"], [(entry / f, c) for f, c in saved["files"]], saved["cost"], True
            work = entry.with_name(key + ".tmp")
            shutil.rmtree(work, ignore_errors=True)
            work.mkdir(parents=True)
            data, files, cost = compute(work)
            names = []
            for i, (path, caption) in enumerate(files):
                name = f"f{i}{Path(path).suffix.lower()}"
                if Path(path) != work / name:
                    shutil.copy(path, work / name)
                names.append((name, caption))
            (work / "result.json").write_text(json.dumps({"data": data, "files": names, "cost": cost}, indent=1))
            shutil.rmtree(entry, ignore_errors=True)
            work.rename(entry)
            # Within one run a result is computed once even with --no-cache.
            self._computed.add(key)
            return data, [(entry / f, c) for f, c in names], cost, False

    def _record(self, tool: str, args: dict, data: dict, files: list, cost: dict, cached: bool, seconds: float) -> dict:
        with self._lock:
            evidence_ids = []
            for path, caption in files:
                eid = f"E{len(self.evidence) + 1}"
                dest = self.evidence_dir / f"{eid}{Path(path).suffix.lower()}"
                shutil.copy(path, dest)
                self.evidence[eid] = {"id": eid, "file": f"evidence/{dest.name}", "caption": caption}
                evidence_ids.append(eid)
            rid = f"R{len(self.results) + 1}"
            if not cached:
                for k in self.cost:
                    self.cost[k] += cost.get(k, 0)
            self.results[rid] = {"id": rid, "tool": tool, "args": args, "data": data, "evidence": evidence_ids,
                                 "cost": cost, "cached": cached, "seconds": round(seconds, 1)}
        return {"result_id": rid, **data, "evidence": evidence_ids}

    def _image_evidence(self, item: Item, work: Path, long_side: int = 1600) -> Path:
        path = work / f"{item.id}.jpg"
        fit_long_side(load_image(str(item.path)), long_side).save(path, quality=88)
        return path

    # ---------- tools ----------

    def tool_verify_quantity(self, item_id: str, capture_id: str) -> dict:
        q = self.package.quantity(item_id)
        if q["method"] == "drawing_symbol":
            item = self.package.item(capture_id, "drawing_sheet")
        else:
            item = self.package.item(capture_id, "drone_still")
        started = time.time()
        data, files, cost, cached = self._cached("verify_quantity", {"item": q}, [item], lambda work: self._count(q, item, work))
        return self._record("verify_quantity", {"item_id": item_id, "capture_id": capture_id}, data, files, cost, cached,
                            time.time() - started)

    def _count(self, q: dict, item: Item, work: Path) -> tuple[dict, list, dict]:
        design, tol_pct, phrase = int(q["design_qty"]), float(q["tolerance_pct"] or 0), q["count_what"]
        usage, sam_requests, details, files = Usage(), 0, {}, []
        if q["method"] == "drawing_symbol":
            sheet = render_sheet(str(item.path), 1, 150)
            points = count_symbols(meta_client(), sheet, [phrase], usage=usage).get(phrase, [])
            observed = len(points)
            overlay = fit_long_side(sheet.convert("RGB"), 3000)
            s = overlay.width / sheet.width
            draw, r = ImageDraw.Draw(overlay), max(8, overlay.width // 250)
            for x, y in points:
                draw.ellipse((x * s - r, y * s - r, x * s + r, y * s + r), outline=(220, 0, 0), width=4)
            path = work / "overlay.jpg"
            overlay.save(path, quality=88)
            files.append((path, f"Spark 1.3 points: {observed} × {phrase} on {item.id}"))
            models = ["muse-spark-1.3"]
        else:
            image = fit_long_side(load_image(str(item.path)), 4096)
            tiles = make_tiles(image, 2, 0.12)
            detections = asyncio.run(segment_tiles(meta_async_client(), tiles, phrase))
            sam_requests = len(tiles)
            confidences = [d.confidence for d in detections if d.confidence is not None]
            details["sam_matches"] = len(detections)
            details["mean_confidence"] = round(statistics.mean(confidences), 3) if confidences else None
            overlay = draw_detections(image, detections)
            models = ["sam-3.1"]
            if q["method"] == "modules":
                grids = count_modules_per_table(meta_client(), [masked_crop(image, d) for d in detections], usage=usage)
                observed = sum(g["modules_fully_visible"] for g in grids)
                details["tables"] = len(detections)
                details["modules_cut_by_image_edge"] = sum(g["modules_cut_by_crop_edge"] for g in grids)
                label_detections(overlay, detections, [grid_label(g) for g in grids])
                models.append("muse-spark-1.3")
            else:
                observed = len(detections)
                rows = _row_profile(detections) if q["method"] == "objects" else []
                if rows:
                    details["per_row_top_to_bottom"] = rows
                    full = max(rows)
                    details["rows_below_the_fullest_row"] = [
                        {"row": n + 1, "count": c, "short_by": full - c} for n, c in enumerate(rows) if c < full]
            path = work / "overlay.jpg"
            fit_long_side(overlay, 2400).save(path, quality=88)
            files.append((path, f"SAM 3.1 '{phrase}' on {item.id}: {observed} {q['unit']}(s)"))
        tolerance = round(design * tol_pct / 100)
        diff = observed - design
        verdict = "pass" if abs(diff) <= tolerance else ("short" if diff < 0 else "over")
        data = {"item_id": q["item_id"], "capture_id": item.id, "description": q["description"], "method": q["method"],
                "design_qty": design, "observed": observed, "unit": q["unit"], "difference": diff,
                "tolerance": tolerance, "verdict": verdict, "models": models, "details": details}
        cost = {"spark_usd": usage.cost, "sam_requests": sam_requests}
        return data, files, cost

    def _plate(self, item: Item) -> tuple[dict, list, dict, bool]:
        def compute(work: Path):
            usage = Usage()
            plate = read_plate(meta_client(), fit_long_side(load_image(str(item.path)), 2048), usage=usage)
            return {"plate": plate}, [(self._image_evidence(item, work), f"Nameplate photo {item.id}")], {"spark_usd": usage.cost}
        data, files, cost, cached = self._cached("read_nameplate", {}, [item], compute)
        self._plates[item.id] = data["plate"]
        return data, files, cost, cached

    def tool_read_nameplate(self, capture_id: str) -> dict:
        item = self.package.item(capture_id, "nameplate_photo")
        started = time.time()
        data, files, cost, cached = self._plate(item)
        plate = data["plate"]
        summary = {
            "capture_id": capture_id, "legibility": plate["legibility"], "equipment_type": plate["equipment_type"],
            "manufacturer": plate["manufacturer"], "model_number": plate["model_number"],
            "serial_number": plate["serial_number"], "manufacture_date": plate["manufacture_date"],
            "ratings": [f"{r['name']}: {r['value']} {r['unit']}".strip() for r in plate["ratings"]],
            "unreadable_fields": plate["unreadable_fields"], "notes": plate["notes"][:300],
            "verdict": "read", "models": ["muse-spark-1.3"],
        }
        return self._record("read_nameplate", {"capture_id": capture_id}, summary, files, cost, cached, time.time() - started)

    def tool_check_equipment(self, capture_id: str, schedule_tag: str) -> dict:
        item = self.package.item(capture_id, "nameplate_photo")
        row = self.package.schedule_row(schedule_tag)
        started = time.time()
        plate_data, plate_files, plate_cost, plate_cached = self._plate(item)

        def compute(work: Path):
            usage = Usage()
            check = check_against_schedule(meta_client(), plate_data["plate"], row, usage=usage)
            files = [(work / "plate.jpg", f"Nameplate photo {item.id}")]
            shutil.copy(plate_files[0][0], files[0][0])
            return {"check": check}, files, {"spark_usd": usage.cost}

        data, files, cost, cached = self._cached("check_equipment", {"row": row}, [item], compute)
        check = data["check"]
        manufacturer = next((f for f in check["fields"] if _norm(f["field"]) == "manufacturer"), None)
        wrong_row = manufacturer is not None and manufacturer["status"] == "mismatch"
        verdict = "wrong_row" if wrong_row else {"pass": "pass", "review": "review", "fail": "mismatch"}[check["overall"]]
        result = {
            "capture_id": capture_id, "schedule_tag": row["tag"], "verdict": verdict, "summary": check["summary"],
            "fields": [{k: f[k] for k in ("field", "schedule_value", "nameplate_value", "status", "note")} for f in check["fields"]],
            "models": ["muse-spark-1.3"],
        }
        if wrong_row:
            result["hint"] = "The manufacturer differs: this plate belongs to another schedule row. Try a different tag."
        fresh = [c for c, was_cached in ((cost, cached), (plate_cost, plate_cached)) if not was_cached]
        cost = {k: sum(c.get(k, 0) for c in fresh) for k in ("spark_usd", "sam_requests", "baseten_usd")}
        return self._record("check_equipment", {"capture_id": capture_id, "schedule_tag": row["tag"]}, result, files,
                            cost, not fresh, time.time() - started)

    def tool_check_drawing_register(self, drawing_id: str) -> dict:
        item = self.package.item(drawing_id, "drawing_sheet")
        register = next((r for r in self.package.register if r.get("drawing_id") == drawing_id), None)
        started = time.time()

        def compute(work: Path):
            usage = Usage()
            sheet = render_sheet(str(item.path), 1, 150).convert("RGB")
            info = read_sheet(meta_client(), sheet, usage=usage)
            w, h = sheet.size
            block = work / "title_block.jpg"
            fit_long_side(sheet.crop((int(w * 0.62), int(h * 0.70), w, h)), 1600).save(block, quality=90)
            whole = work / "sheet.jpg"
            fit_long_side(sheet, 1800).save(whole, quality=85)
            return {"sheet": info}, [(block, f"Title block of {drawing_id}"), (whole, f"Sheet {drawing_id}")], {"spark_usd": usage.cost}

        data, files, cost, cached = self._cached("check_drawing_register", {}, [item], compute)
        tb = data["sheet"]["title_block"]
        if register is None:
            register = next((r for r in self.package.register if _norm(r["sheet_number"]) == _norm(tb["sheet_number"])), None)
        if register is None:
            comparison, verdict = [], "not_in_register"
        else:
            comparison = [
                {"field": "sheet_number", "register": register["sheet_number"], "title_block": tb["sheet_number"],
                 "match": _norm(register["sheet_number"]) == _norm(tb["sheet_number"])},
                {"field": "title", "register": register["title"], "title_block": tb["sheet_title"],
                 "match": _norm(register["title"]) in _norm(tb["sheet_title"]) or _norm(tb["sheet_title"]) in _norm(register["title"])},
                {"field": "revision", "register": register["current_revision"] or "(none)", "title_block": tb["revision"] or "(none)",
                 "match": _norm_rev(register["current_revision"]) == _norm_rev(tb["revision"])},
            ]
            verdict = "pass" if all(c["match"] for c in comparison) else "mismatch"
        result = {"drawing_id": drawing_id, "verdict": verdict, "title_block": tb, "comparison": comparison,
                  "tags_on_sheet": len(data["sheet"]["equipment_tags"]), "readability": data["sheet"]["readability"],
                  "models": ["muse-spark-1.3"]}
        return self._record("check_drawing_register", {"drawing_id": drawing_id}, result, files, cost, cached, time.time() - started)

    def tool_check_walkthrough(self, capture_id: str) -> dict:
        item = self.package.item(capture_id, "walkthrough_video")
        context = _area_notes(self.package.site_notes, item.area)
        started = time.time()

        def compute(work: Path):
            report = analyse(item.path, work, context=context, log=lambda _: None)
            claims, files = [], []
            for n, c in enumerate(report.get("claim_verification", [])):
                frame = c["frames"][min(max(c["spark"]["frame_used"], 0), len(c["frames"]) - 1)]
                image = c.get("overlay") or frame
                files.append((Path(image), f"{capture_id} at {c['t_s']:.1f} s: \"{c['claim']}\""))
                claims.append({
                    "claim_index": n, "t_s": c["t_s"], "claim": c["claim"], "verdict": c["final_verdict"],
                    "method": c["method"], "evidence_text": c["spark"]["evidence"],
                    **({"sam_count_in_scope": c["sam_count_in_scope"], "claimed_count": c["spark"]["claimed_count"],
                        "sam_phrase": c["sam_phrase"]} if "sam_count_in_scope" in c else {}),
                })
            clips = [c for c in report.get("clips", []) if "error" not in c]
            data = {"summary": " ".join(c["summary"] for c in clips), "claims": claims,
                    "spoken_notes": [n["text"] for c in clips for n in c["spoken_notes"]]}
            sam = sum(c.get("sam_requests", 0) for c in report.get("claim_verification", []))
            spark_usd = report.get("verification_cost_usd", 0) - sam * PRICE["sam_per_image"]
            return data, files, {"baseten_usd": report.get("est_cost_usd", 0), "spark_usd": spark_usd, "sam_requests": sam}

        data, files, cost, cached = self._cached("check_walkthrough", {"context": context, "claims_logic": 2}, [item], compute)
        contradicted = sum(c["verdict"] == "contradicted" for c in data["claims"])
        unsure = sum(c["verdict"] not in ("confirmed", "contradicted") for c in data["claims"])
        verdict = "claims_contradicted" if contradicted else ("needs_review" if unsure else "pass")
        result = {"capture_id": capture_id, "area": item.area, "verdict": verdict,
                  "claims": data["claims"], "summary": data["summary"],
                  "models": ["muse-spark-open (Baseten)", "muse-spark-1.3", "sam-3.1"]}
        recorded = self._record("check_walkthrough", {"capture_id": capture_id}, result, files, cost, cached, time.time() - started)
        for claim, eid in zip(self.results[recorded["result_id"]]["data"]["claims"], recorded["evidence"]):
            claim["evidence"] = eid
        return recorded

    def tool_record_finding(self, result_id: str, kind: str, title: str, explanation: str, claim_index: int = -1) -> dict:
        result = self.results.get(result_id)
        if result is None:
            raise KeyError(f"no result {result_id!r}")
        if kind not in FINDING_KINDS:
            raise ValueError(f"kind must be one of {FINDING_KINDS}")
        data = result["data"]
        if result["tool"] == "read_nameplate":
            raise ValueError("read_nameplate only transcribes; record findings on a check_equipment result")
        if result["tool"] == "check_walkthrough":
            if not 0 <= claim_index < len(data["claims"]):
                raise ValueError(f"{result_id} has claims 0-{len(data['claims']) - 1}; pass claim_index")
            claim = data["claims"][claim_index]
            if claim["verdict"] == "confirmed":
                raise ValueError(f"claim {claim_index} was confirmed by the evidence; nothing to record")
            verdict, evidence = claim["verdict"], [claim["evidence"]]
        else:
            verdict, evidence = data["verdict"], result["evidence"]
            if verdict == "pass":
                raise ValueError(f"{result_id} passed; a finding needs a result that did not pass")
            if verdict == "wrong_row":
                raise ValueError(f"{result_id} compared the plate with the wrong schedule row; check another tag first")
        with self._lock:
            duplicate = next((f for f in self.findings if f["result_id"] == result_id and f["claim_index"] == claim_index), None)
            if duplicate:
                raise ValueError(f"{duplicate['id']} already records {result_id}" + (f" claim {claim_index}" if claim_index >= 0 else ""))
            fid = f"F{len(self.findings) + 1}"
            self.findings.append({"id": fid, "kind": kind, "title": title, "explanation": explanation,
                                  "result_id": result_id, "claim_index": claim_index, "verdict": verdict, "evidence": evidence})
        return {"finding_id": fid, "verdict": verdict, "evidence": evidence}

    def tool_finish(self, summary: str) -> dict:
        unrecorded = [
            rid for rid, r in self.results.items()
            if r["tool"] in ("verify_quantity", "check_equipment", "check_drawing_register")
            and r["data"]["verdict"] not in ("pass", "wrong_row")
            and not any(f["result_id"] == rid for f in self.findings)
        ]
        for rid, r in self.results.items():
            if r["tool"] == "check_walkthrough":
                unrecorded += [f"{rid} claim {c['claim_index']}" for c in r["data"]["claims"] if c["verdict"] == "contradicted"
                               and not any(f["result_id"] == rid and f["claim_index"] == c["claim_index"] for f in self.findings)]
        if unrecorded and not self._warned_unrecorded:
            self._warned_unrecorded = True
            return {"error": f"These results did not pass and have no finding yet: {unrecorded}. Record them, or call "
                             "finish again if you have a reason not to (say it in the summary)."}
        self.summary, self.finished = summary, True
        return {"ok": True}
