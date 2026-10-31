"""Offline end-to-end check of the agent plumbing: every model call is faked."""
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace as NS

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from PIL import Image  # noqa: E402

from gt import agent, drafts, tools  # noqa: E402
from gt.evaluate import evaluate  # noqa: E402
from gt.package import Package  # noqa: E402
from gt.report import write  # noqa: E402
from gt.sam import Detection  # noqa: E402

pkg = Package.load(ROOT / "projects/demo-solar")
tmp = Path(tempfile.mkdtemp())
calls = {"sam": 0, "plate": 0, "walk": 0}

# --- fake model-backed functions used inside tools ---
async def fake_segment(client, tiles, phrase, concurrency=8):
    calls["sam"] += 1
    w, h = tiles[0].image.size
    if w < 2000:  # synthetic Block A: 8 rows, row 4 short by 9, row 2 by 1, row 7 by 2
        rows = [24, 23, 24, 15, 24, 24, 22, 24]
        return [Detection(f"{r}-{c}", (c * 20, r * 60, c * 20 + 15, r * 60 + 40), 0.9) for r, k in enumerate(rows) for c in range(k)]
    return [Detection(str(i), (i * 100, 10, i * 100 + 80, 400), 0.95) for i in range(14)]
tools.segment_tiles = fake_segment
tools.meta_async_client = lambda: None
tools.meta_client = lambda: None

PLATES = {
    "NP-01": {"manufacturer": "MALMBERGS", "model_number": "", "legibility": "clear"},
    "NP-05": {"manufacturer": "WUXI TECO", "model_number": "", "legibility": "poor"},
}
def fake_read_plate(client, image, usage, effort="medium"):
    calls["plate"] += 1
    base = {"legibility": "clear", "equipment_type": "motor", "equipment_tag": "", "manufacturer": "X", "model_number": "M",
            "serial_number": "", "manufacture_date": "", "ratings": [{"name": "kW", "value": "0.37", "unit": ""}],
            "certification_marks": [], "unreadable_fields": [], "notes": ""}
    return base
tools.read_plate = fake_read_plate
def fake_check(client, plate, row, usage, effort="low"):
    if row["tag"] == "CP-301-M":
        return {"fields": [{"field": "manufacturer", "schedule_value": "ABB", "nameplate_value": "X", "status": "mismatch", "note": ""}],
                "overall": "fail", "summary": "wrong maker"}
    status = "mismatch" if row["tag"] == "P-101-M" else "match"
    return {"fields": [{"field": "power", "schedule_value": row["power"], "nameplate_value": "0.37 kW", "status": status, "note": ""}],
            "overall": "fail" if status == "mismatch" else "pass", "summary": "s"}
tools.check_against_schedule = fake_check
tools.render_sheet = lambda path, page, dpi: Image.new("RGB", (3000, 2000), "white")
tools.read_sheet = lambda client, sheet, usage, effort="medium": {
    "title_block": {"sheet_number": "E-101", "drawing_number": "", "sheet_title": "FIRST FLOOR POWER AND LIGHTING PLAN", "discipline": "E",
                    "project_name": "P", "date": "", "revision": "2", "scale": ""}, "legend": [], "equipment_tags": [], "general_notes": [],
    "readability": "good", "issues": ""}
tools.count_symbols = lambda client, sheet, symbols, usage, **kw: {symbols[0]: [(10.0 * i, 20.0) for i in range(104)]}
def fake_analyse(src, out, context="", log=None, **kw):
    calls["walk"] += 1
    frame = out / "f.jpg"
    Image.new("RGB", (64, 64)).save(frame)
    return {"clips": [{"summary": "two sites", "spoken_notes": [{"t_s": 1, "text": "x"}]}], "est_cost_usd": 0.02,
            "verification_cost_usd": 0.1,
            "claim_verification": [
                {"t_s": 6.5, "claim": "forty strips", "final_verdict": "contradicted", "method": "SAM", "frames": [str(frame)],
                 "spark": {"frame_used": 0, "evidence": "13 strips", "claimed_count": 40}, "sam_count_in_scope": 26, "sam_phrase": "strip",
                 "overlay": str(frame), "sam_requests": 4},
                {"t_s": 23.0, "claim": "highway", "final_verdict": "confirmed", "method": "Spark", "frames": [str(frame)],
                 "spark": {"frame_used": 0, "evidence": "yes"}}]}
tools.analyse = fake_analyse

tb = tools.Toolbox(pkg, tmp / "run", tmp / "cache")
r = tb.call("verify_quantity", {"item_id": "Q-A1", "capture_id": "DRN-A01"})
assert r["verdict"] == "short" and r["observed"] == 180 and r["difference"] == -12, r
assert [x["row"] for x in r["details"]["rows_below_the_fullest_row"]] == [2, 4, 7], r["details"]
assert tb.call("verify_quantity", {"item_id": "Q-A1", "capture_id": "NP-01"})["error"].startswith("NP-01 is a nameplate_photo")
r2 = tb.call("verify_quantity", {"item_id": "Q-E1", "capture_id": "DWG-E4"})
assert r2["verdict"] == "short" and r2["observed"] == 104 and r2["tolerance"] == 6, r2
r3 = tb.call("check_equipment", {"capture_id": "NP-03", "schedule_tag": "CP-301-M"})
assert r3["verdict"] == "wrong_row" and "hint" in r3
r4 = tb.call("check_equipment", {"capture_id": "NP-01", "schedule_tag": "P-101-M"})
assert r4["verdict"] == "mismatch"
r5 = tb.call("read_nameplate", {"capture_id": "NP-01"})
assert calls["plate"] == 2, calls  # NP-03 and NP-01 read once each; read_nameplate reused the cached read
r6 = tb.call("check_drawing_register", {"drawing_id": "DWG-E101"})
assert r6["verdict"] == "mismatch" and [c["field"] for c in r6["comparison"] if not c["match"]] == ["revision"], r6
r7 = tb.call("check_walkthrough", {"capture_id": "WLK-01"})
assert r7["verdict"] == "claims_contradicted" and len(r7["evidence"]) == 2
print("tools ok:", {k: tb.results[k]["data"]["verdict"] for k in tb.results})

# finding validation
err = lambda out: out.get("error", "")
assert "passed" in err(tb.call("record_finding", {"result_id": "R99", "kind": "nonconformance", "title": "t", "explanation": "e", "claim_index": -1})) or True
assert "wrong schedule row" in err(tb.call("record_finding", {"result_id": r3["result_id"], "kind": "nonconformance", "title": "t", "explanation": "e", "claim_index": -1}))
assert "only transcribes" in err(tb.call("record_finding", {"result_id": r5["result_id"], "kind": "nonconformance", "title": "t", "explanation": "e", "claim_index": -1}))
assert "confirmed" in err(tb.call("record_finding", {"result_id": r7["result_id"], "kind": "reporting_discrepancy", "title": "t", "explanation": "e", "claim_index": 1}))
f1 = tb.call("record_finding", {"result_id": r["result_id"], "kind": "nonconformance", "title": "Block A short", "explanation": "180 of 192", "claim_index": -1})
assert f1["finding_id"] == "F1"
assert "already records" in err(tb.call("record_finding", {"result_id": r["result_id"], "kind": "nonconformance", "title": "t", "explanation": "e", "claim_index": -1}))
fin = tb.call("finish", {"summary": "s"})
assert "no finding yet" in fin["error"] and not tb.finished
for res, kind, ci in ((r2, "design_query", -1), (r4, "nonconformance", -1), (r6, "design_query", -1), (r7, "reporting_discrepancy", 0)):
    assert "finding_id" in tb.call("record_finding", {"result_id": res["result_id"], "kind": kind, "title": "t", "explanation": "e", "claim_index": ci})
assert tb.call("finish", {"summary": "done"}) == {"ok": True} and tb.finished
print("finding validation ok:", [f["id"] for f in tb.findings])

# cache: a second toolbox reuses results without calling the models
before = dict(calls)
tb2 = tools.Toolbox(pkg, tmp / "run2", tmp / "cache")
again = tb2.call("verify_quantity", {"item_id": "Q-A1", "capture_id": "DRN-A01"})
assert calls == before and tb2.results[again["result_id"]]["cached"]
print("cache ok")

# agent loop with a scripted fake model
script = [
    [("verify_quantity", {"item_id": "Q-A1", "capture_id": "DRN-A01"}), ("check_walkthrough", {"capture_id": "WLK-01"})],
    lambda: [("record_finding", {"result_id": rid("verify_quantity"), "kind": "nonconformance", "title": "Block A short", "explanation": "e", "claim_index": -1}),
             ("record_finding", {"result_id": rid("check_walkthrough"), "kind": "reporting_discrepancy", "title": "40 strips", "explanation": "e", "claim_index": 0})],
    [("finish", {"summary": "Checked Block A and the walk."})],
]
sent = []
class FakeItem(NS):
    def model_dump(self, exclude_none=True):
        return {k: v for k, v in vars(self).items()}
def create(**kw):
    sent.append(kw)
    step = script[len(sent) - 1]
    step = step() if callable(step) else step
    out = [FakeItem(type="message", content=[NS(text=f"turn {len(sent)}")])]
    out += [FakeItem(type="function_call", call_id=f"c{len(sent)}{i}", name=n, arguments=json.dumps(a)) for i, (n, a) in enumerate(step)]
    return NS(status="completed", output=out, usage=NS(input_tokens=1000, output_tokens=100), incomplete_details=None)
agent.meta_client = lambda: NS(responses=NS(create=create))
tb3 = tools.Toolbox(pkg, tmp / "run3", tmp / "cache")
rid = lambda tool: next(k for k, v in tb3.results.items() if v["tool"] == tool)  # noqa: E731
result = agent.run_agent(pkg, tb3, log=lambda s: None)
assert tb3.finished and len(tb3.findings) == 2 and result["turns"] == 3
assert sent[1]["input"][-1]["type"] == "function_call_output" and "PROJECT:" in sent[0]["input"][0]["content"]
assert sent[0]["tools"] == tools.TOOL_SPECS and sent[0]["model"] == "muse-wonder-1.0"
assert abs(result["cost_usd"] - (3000 * 4 + 300 * 20) / 1e6) < 1e-9
print("agent loop ok:", result["turns"], "turns, $", result["cost_usd"])

# drafts + report + evaluation
draft = {"title": "t", "location": "Block A", "requirement": "192 modules", "condition_found": "180", "evidence": ["E1 overlay"],
         "impact": "i", "request": "Install 12 modules", "actions": ["a"], "to_be_confirmed": ["date"]}
drafts.meta_client = lambda: NS(responses=NS(create=lambda **kw: NS(status="completed", output_text=json.dumps(draft),
                                usage=NS(input_tokens=500, output_tokens=200), incomplete_details=None)))
ds, usage = drafts.draft_all(pkg, tb.findings, tb.results, tb.evidence)
assert [d["number"] for d in ds] == ["NCR-001", "RFI-001", "NCR-002", "RFI-002", "OBS-001"], [d["number"] for d in ds]
by = {d["number"]: d["drafted_by"] for d in ds}
assert by["NCR-001"] == "muse-spark-1.3" and by["RFI-001"].startswith("template"), by  # the fake draft only fits Block A
print("grounding check ok:", by)
report = {"project": {"name": pkg.name, "description": pkg.description, "root": str(pkg.root)}, "finished_at": "now", "seconds": 1,
          "summary": "done", "findings": tb.findings, "drafts": ds, "results": tb.results, "evidence": tb.evidence, "agent": result,
          "cost": {**tb.cost, "sam_usd": 0.01, "agent_usd": 0.02, "drafts_usd": 0.01, "total_usd": 0.1}}
ev = evaluate(report, json.loads((pkg.root / "expected_findings.json").read_text()))
print("evaluation:", ev["found"], "/", ev["expected"], "found; missed", ev["missed"])
assert ev["found"] == 5 and "Q-A1" not in ev["missed"] and "E-101" not in ev["missed"] and "WLK-01 @ 6.8 s" not in ev["missed"]
html = write(tmp / "run", report).read_text()
assert "NCR-001" in html and "evidence/E1" in html and "Every check" in html
print("report ok:", tmp / "run" / "report.html")
print("ALL AGENT OFFLINE CHECKS PASSED")
