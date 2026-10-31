"""GroundTruth: verify a construction site against its design package with Meta's models.

A Muse Wonder agent reads the design package, runs the checks (SAM 3.1 and Muse Spark 1.3 on drone stills,
nameplates and drawings; Muse Spark Open on Baseten for narrated walkthroughs), records a finding for everything
that did not pass, and Muse Spark 1.3 drafts the NCR, RFI or observation report for each one.

  python groundtruth.py run projects/demo-solar               # -> out/runs/demo-solar/<time>/report.html
  python groundtruth.py run projects/demo-solar --no-cache    # recompute every check instead of reusing results
  python groundtruth.py evaluate out/runs/demo-solar/latest   # compare with the package's expected_findings.json
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from gt.agent import run_agent
from gt.config import OUT, PRICE, SPARK, WONDER
from gt.drafts import draft_all
from gt.evaluate import evaluate
from gt.package import Package
from gt.report import timestamp, write
from gt.tools import Toolbox


def print_evaluation(result: dict) -> None:
    print(f"\nAgainst expected_findings.json: {result['found']}/{result['expected']} expected findings found, "
          f"{result['right_kind']} with the right kind")
    for row in result["rows"]:
        mark = "ok  " if row["finding"] and row["found_kind"] == row["expected_kind"] else ("KIND" if row["finding"] else "MISS")
        print(f"  {mark} {row['expected_kind']:<22} {row['ref']:<16} -> {row['finding'] or '-'}"
              + (f" (recorded as {row['found_kind']})" if row["finding"] and row["found_kind"] != row["expected_kind"] else ""))
    if result["extra_findings"]:
        print(f"  extra findings not in the answer key: {result['extra_findings']}")
    for p in result["passes_wrongly_flagged"]:
        print(f"  WRONG {p['ref']} should pass but was flagged by {p['wrongly_flagged_by']}")


def cmd_run(args: argparse.Namespace) -> None:
    package = Package.load(Path(args.project))
    started = time.time()
    run_dir = OUT / "runs" / package.root.name / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True)
    print(f"{package.name}\n{len(package.items)} captures/drawings, {len(package.quantities)} quantity items, "
          f"{len(package.schedule)} schedule rows, {len(package.register)} register rows -> {run_dir}\n")
    toolbox = Toolbox(package, run_dir, OUT / "cache", use_cache=not args.no_cache)
    agent = run_agent(package, toolbox, model=args.model, effort=args.effort, max_turns=args.max_turns)
    drafts, draft_usage = ([], None) if args.no_drafts else draft_all(
        package, toolbox.findings, toolbox.results, toolbox.evidence, model=args.draft_model)
    sam_usd = toolbox.cost["sam_requests"] * PRICE["sam_per_image"]
    drafts_usd = draft_usage.cost if draft_usage else 0.0
    cost = {**toolbox.cost, "sam_usd": sam_usd, "agent_usd": agent["cost_usd"], "drafts_usd": drafts_usd}
    cost["total_usd"] = round(cost["spark_usd"] + sam_usd + cost["baseten_usd"] + agent["cost_usd"] + drafts_usd, 4)
    report = {
        "project": {"name": package.name, "description": package.description, "root": str(package.root)},
        "finished_at": timestamp(), "seconds": round(time.time() - started, 1), "summary": toolbox.summary,
        "findings": toolbox.findings, "drafts": drafts, "results": toolbox.results, "evidence": toolbox.evidence,
        "agent": agent, "cost": cost,
    }
    expected_path = package.root / "expected_findings.json"
    if expected_path.exists():
        report["evaluation"] = evaluate(report, json.loads(expected_path.read_text()))
    path = write(run_dir, report)
    latest = run_dir.parent / "latest"
    latest.unlink(missing_ok=True)
    latest.symlink_to(run_dir.name)

    print(f"\n{len(toolbox.findings)} finding(s):")
    numbers = {d["finding_id"]: d["number"] for d in drafts}
    for f in toolbox.findings:
        print(f"  {numbers.get(f['id'], f['id']):<8} {f['kind']:<22} {f['title']}")
    if "evaluation" in report:
        print_evaluation(report["evaluation"])
    print(f"\n{report['seconds']:.0f}s, ~${cost['total_usd']:.2f} (agent ${agent['cost_usd']:.2f}, drafts ${drafts_usd:.2f}, "
          f"checks ${cost['spark_usd'] + sam_usd + cost['baseten_usd']:.2f})\nReport: {path}")


def cmd_evaluate(args: argparse.Namespace) -> None:
    report = json.loads((Path(args.run) / "report.json").read_text())
    expected = Path(report["project"]["root"]) / "expected_findings.json"
    print_evaluation(evaluate(report, json.loads(expected.read_text())))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="verify a project package")
    run.add_argument("project", help="folder with project.json")
    run.add_argument("--model", default=WONDER, help="agent model")
    run.add_argument("--draft-model", default=SPARK, help="model that drafts the NCR/RFI/OBS documents")
    run.add_argument("--effort", default="medium", choices=["low", "medium", "high"])
    run.add_argument("--max-turns", type=int, default=30)
    run.add_argument("--no-cache", action="store_true", help="recompute every check")
    run.add_argument("--no-drafts", action="store_true", help="skip the NCR/RFI drafts")
    run.set_defaults(func=cmd_run)
    ev = sub.add_parser("evaluate", help="compare a run with the package's expected_findings.json")
    ev.add_argument("run", help="run folder, e.g. out/runs/demo-solar/latest")
    ev.set_defaults(func=cmd_evaluate)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
