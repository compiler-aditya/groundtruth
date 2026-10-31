"""Score the four Day 1 tests on samples/real against samples/real/ground_truth.json.

Reads the outputs the tests wrote (copied to out/real_t1 ... out/real_t4) and prints a scorecard.

  python day1/score_real.py [--t1 out/real_t1_tiles2]
"""

import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gt.media import slug  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REAL = ROOT / "samples" / "real"


def norm(text: str) -> str:
    return re.sub(r"\s+", "", str(text).lower().replace("δ", "Δ").replace("∆", "Δ"))


def decimal_norm(text: str) -> str:
    return norm(text).replace(",", ".")


def score_drone(truth: dict, results_path: Path) -> None:
    print(f"\n## Test 1: drone counts ({results_path.parent.name})")
    for row in json.loads(results_path.read_text()):
        name = Path(row["image"]).stem
        want = truth["counts"].get(name, {}).get("score_against")
        line = f"  {name}: SAM {row['sam_count']}"
        if "spark_count" in row:
            line += f", Spark {row['spark_count']} (agreement {row['sam_spark_agreement_pct']}%)"
        counts = truth["counts"].get(name, {})
        if "modules" in row:
            m = row["modules"]
            line += f" tables -> modules {m['fully_visible']} fully visible + {m['cut_by_edge']} cut"
            if counts.get("fully_visible"):
                err = 100 * (m["fully_visible"] - counts["fully_visible"]) / counts["fully_visible"]
                line += (f" | fully visible {err:+.1f}% vs hand {counts['fully_visible']} -> {'PASS' if abs(err) <= 5 else 'FAIL'}"
                         f" | total {m['total']} vs hand {counts.get('any_part_visible') or counts['at_least_half_visible']} (incl. edge-cut)")
            else:
                line += " | no hand count (see overlay)"
        elif want:
            for label, got in (("SAM", row["sam_count"]), ("Spark", row.get("spark_count"))):
                if got is not None:
                    err = 100 * (got - want) / want
                    line += f" | {label} {err:+.1f}% vs {want} -> {'PASS' if abs(err) <= 5 else 'FAIL'}"
        else:
            line += " | no hand count (see overlay)"
        print(line)


def plate_candidates(plate: dict) -> list[str]:
    values = [plate[k] for k in ("manufacturer", "model_number", "serial_number", "manufacture_date", "equipment_type", "equipment_tag")]
    for r in plate["ratings"]:
        values += [r["value"], f"{r['value']}{r['unit']}", f"{r['name']}{r['value']}"]
    values += plate["certification_marks"] + [plate["notes"]]  # long values only match here as substrings
    return [v for v in values if v]


def found(value: str, candidates: list[str], normalise) -> bool:
    target = normalise(value)
    for c in candidates:
        c = normalise(c)
        if c == target or (len(target) >= 3 and target in c):
            return True
    return False


def score_nameplates(truth: dict, results_path: Path) -> None:
    print(f"\n## Test 2: nameplates ({results_path.parent.name})")
    exact_total = loose_total = fields_total = 0
    for item in json.loads(results_path.read_text()):
        name = Path(item["image"]).stem
        t = truth[name]
        plate = item["nameplate"]
        cands = plate_candidates(plate)
        exact = [k for k, v in t["legible"].items() if found(v, cands, norm)]
        loose = [k for k, v in t["legible"].items() if found(v, cands, decimal_norm)]
        missing = [f"{k}={v}" for k, v in t["legible"].items() if k not in loose]
        exact_total += len(exact)
        loose_total += len(loose)
        fields_total += len(t["legible"])
        overall = item.get("check", {}).get("overall", "-")
        print(f"  {name}: {len(exact)}/{len(t['legible'])} legible fields exact"
              + (f" ({len(loose)} after treating , and . alike)" if len(loose) != len(exact) else "")
              + f"; legibility '{plate['legibility']}'; schedule check {overall.upper()} (expected {t['expected_overall']})")
        if missing:
            print(f"    not found: {', '.join(missing)}")
        for f in item.get("check", {}).get("fields", []):
            if f["status"] != "match":
                print(f"    {f['status']:<16} {f['field']}: schedule {f['schedule_value']!r} vs plate {f['nameplate_value']!r}")
        if "unreadable" in t:
            claimed = [f"{r['name']}={r['value']}" for r in plate["ratings"] if r["value"]]
            print(f"    plate mostly unreadable; values the model still reported: {claimed or 'none'}"
                  f"; listed unreadable: {plate['unreadable_fields']}")
    print(f"  TOTAL: {exact_total}/{fields_total} exact ({100 * exact_total / fields_total:.0f}%), "
          f"{loose_total}/{fields_total} with decimal separators normalised ({100 * loose_total / fields_total:.0f}%)")


def score_drawing(truth: dict, results_path: Path) -> None:
    print(f"\n## Test 3: drawing sheet ({results_path.parent.name})")
    report = json.loads(results_path.read_text())
    tb = report["sheet_info"]["title_block"]
    blob = norm(json.dumps(tb))
    checks = {
        "sheet number E-4": norm(tb["sheet_number"]) in ("e-4", "e4"),
        "drawing number NY 0514": norm(tb.get("drawing_number", "")) == "ny0514",
        "title says 2nd floor installation plan": "2ndfloorinstallationplan" in norm(tb["sheet_title"]),
        "project says replacement of lighting fixtures": "replacementoflightingfixtures" in blob,
        "date 14 OCT 94": "14oct94" in norm(tb["date"]) or "1994-10-14" in tb["date"],
        "revision empty / none": norm(tb["revision"]) in ("", "none", "-", "n/a", "norevision"),
    }
    for label, ok in checks.items():
        print(f"  {'OK  ' if ok else 'MISS'} {label}")
    print(f"  title block: {tb}")
    tags = [t["tag"] for t in report["sheet_info"]["equipment_tags"]]
    print(f"  tags read: {tags}")
    for name, entry in report.get("spark_counts", {}).items():
        want = truth["counts"].get(name)
        err = 100 * (entry["count"] - want) / want
        print(f"  Spark {name!r}: {entry['count']} vs hand {want} ({err:+.1f}%) -> {'PASS' if abs(err) <= 10 else 'FAIL'} (±10%)")
    for phrase, entry in report.get("sam", {}).items():
        print(f"  SAM {phrase!r}: {entry['count']} vs hand {truth['counts'].get(phrase)}")


def score_walk(truth: list[dict], report_path: Path) -> None:
    print(f"\n## Test 4: walkthrough ({report_path.parent.name})")
    report = json.loads(report_path.read_text())
    clips = [c for c in report["clips"] if "error" not in c]
    print(f"  {len(clips)}/{len(report['clips'])} clips parsed, {report['totals']['retries']} retries; "
          f"video pass ~${report['est_cost_usd']}, claim check ~${report.get('verification_cost_usd', 0)}")
    notes = [n for c in clips for n in c["spoken_notes"]]
    first = [c for clip in clips for c in clip["claim_checks"]]
    checked = report.get("claim_verification", [])
    conflicts = [c for clip in clips for c in clip["audio_visual_conflicts"]]
    print(f"  spoken notes captured: {len(notes)}; claims listed: {len(first)}; conflicts flagged in the video pass: {len(conflicts)}")

    def best(claim: dict, pool: list[dict]) -> dict | None:
        scored = [(SequenceMatcher(None, claim["claim"].lower(), p["claim"].lower()).ratio()
                   - 0.02 * abs(p["t_s"] - claim["t_s"]), p) for p in pool]
        scored = [s for s in scored if s[0] > 0.3]
        return max(scored, key=lambda s: s[0])[1] if scored else None

    caught = false_alarms = 0
    for claim in truth:
        if claim["claim"].startswith("That completes"):
            continue
        hit = best(claim, checked) or best(claim, first)
        verdict = (hit.get("final_verdict") or hit.get("verdict")) if hit else "not listed"
        if claim["true"]:
            ok = verdict == "confirmed"
            false_alarms += verdict == "contradicted"
        else:
            ok = verdict == "contradicted"
            caught += ok
        extra = ""
        if hit and "sam_count_in_scope" in hit:
            extra = f" [SAM {hit['sam_count_in_scope']} '{hit['sam_phrase']}' in scope, Spark claimed {hit['spark']['claimed_count']}, saw {hit['spark']['observed_count']}]"
        print(f"  {'OK  ' if ok else 'MISS'} {claim['t_s']:>5.1f}s {'TRUE ' if claim['true'] else 'FALSE'} -> {verdict}{extra}: {claim['claim']}")
    n_false = sum(not c["true"] for c in truth)
    print(f"  false claims caught: {caught}/{n_false}; true claims wrongly contradicted: {false_alarms}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--t1", default="out/real_t1_modules")
    parser.add_argument("--t2", default="out/real_t2")
    parser.add_argument("--t3", default="out/real_t3")
    parser.add_argument("--t4", default="out/real_t4")
    args = parser.parse_args()
    truth = json.loads((REAL / "ground_truth.json").read_text())
    stem = slug(Path(truth["drawing"]["file"]).stem)
    for label, fn, data, path in (
        ("t1", score_drone, truth["drone"], ROOT / args.t1 / "results.json"),
        ("t2", score_nameplates, truth["nameplates"], ROOT / args.t2 / "results.json"),
        ("t3", score_drawing, truth["drawing"], ROOT / args.t3 / f"{stem}.json"),
        ("t4", score_walk, json.loads((REAL / "walk" / "walk_truth.json").read_text()), ROOT / args.t4 / "report.json"),
    ):
        if path.exists():
            fn(data, path)
        else:
            print(f"\n## {label}: no results at {path}")


if __name__ == "__main__":
    main()
