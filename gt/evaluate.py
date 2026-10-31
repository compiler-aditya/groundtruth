"""Compares a run's findings with the package's expected_findings.json (the answer key for a demo package).

References in the answer key: a quantity item ID (Q-A1), a schedule tag (P-101-M), a register sheet number
(E-101), or a walkthrough claim as "<capture> @ <seconds> s" (matched within 3 s).
"""

import re


def _matches(finding: dict, results: dict, ref: str) -> bool:
    result = results[finding["result_id"]]
    args, data = result["args"], result["data"]
    if " @ " in ref:
        capture, _, at = ref.partition(" @ ")
        seconds = float(re.sub(r"[^0-9.]", "", at))
        return (result["tool"] == "check_walkthrough" and args["capture_id"] == capture and finding["claim_index"] >= 0
                and abs(data["claims"][finding["claim_index"]]["t_s"] - seconds) <= 3)
    if ref in (args.get("item_id"), args.get("schedule_tag"), args.get("drawing_id")):
        return True
    return result["tool"] == "check_drawing_register" and any(
        c["field"] == "sheet_number" and c["register"] == ref for c in data.get("comparison", []))


def evaluate(report: dict, expected: dict) -> dict:
    findings, results = report["findings"], report["results"]
    used, rows = set(), []
    for kind in ("nonconformance", "design_query", "reporting_discrepancy"):
        for entry in expected.get(kind, []):
            hit = next((f for f in findings if f["id"] not in used and _matches(f, results, entry["ref"])), None)
            if hit:
                used.add(hit["id"])
            rows.append({"expected_kind": kind, "ref": entry["ref"], "what": entry["what"],
                         "finding": hit["id"] if hit else None, "found_kind": hit["kind"] if hit else None})
    passes = []
    for item in expected.get("pass", []):
        ref = item.split(" ")[0]
        wrongly = [f["id"] for f in findings if _matches(f, results, ref)]
        passes.append({"ref": ref, "wrongly_flagged_by": wrongly})
    extra = [f["id"] for f in findings if f["id"] not in used]
    return {
        "expected": len(rows),
        "found": sum(r["finding"] is not None for r in rows),
        "right_kind": sum(r["finding"] is not None and r["found_kind"] == r["expected_kind"] for r in rows),
        "missed": [r["ref"] for r in rows if r["finding"] is None],
        "extra_findings": extra,
        "passes_wrongly_flagged": [p for p in passes if p["wrongly_flagged_by"]],
        "rows": rows,
    }
