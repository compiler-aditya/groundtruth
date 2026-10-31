"""One verification run: the agent, then the drafts, then the report. Shared by the CLI and the web app."""

import json
import time
from pathlib import Path
from typing import Callable

from .agent import run_agent
from .config import PRICE, SPARK, WONDER
from .drafts import draft_all
from .evaluate import evaluate
from .package import Package
from .report import timestamp, write
from .tools import Toolbox


def run_package(
    package: Package,
    run_dir: Path,
    cache_dir: Path,
    *,
    seed_cache: Path | None = None,
    use_cache: bool = True,
    model: str = WONDER,
    effort: str = "medium",
    max_turns: int = 30,
    draft_model: str = SPARK,
    drafts: bool = True,
    log: Callable[[str], None] = print,
    on_event: Callable[[dict], None] = lambda event: None,
    toolbox_ready: Callable[[Toolbox], None] = lambda toolbox: None,
) -> tuple[dict, Toolbox]:
    """Runs the package and writes report.json and report.html into run_dir. Returns the report and the toolbox."""
    started = time.time()
    run_dir.mkdir(parents=True, exist_ok=True)
    toolbox = Toolbox(package, run_dir, cache_dir, use_cache=use_cache, seed_cache=seed_cache, log=log)
    toolbox_ready(toolbox)
    agent = run_agent(package, toolbox, model=model, effort=effort, max_turns=max_turns, log=log, on_event=on_event)

    written, draft_usd = [], 0.0
    if drafts and toolbox.findings:
        on_event({"type": "drafting", "count": len(toolbox.findings), "model": draft_model})
        written, usage = draft_all(package, toolbox.findings, toolbox.results, toolbox.evidence, model=draft_model,
                                   on_draft=lambda d: on_event({"type": "draft", "draft": d}))
        draft_usd = usage.cost
    sam_usd = toolbox.cost["sam_requests"] * PRICE["sam_per_image"]
    cost = {**toolbox.cost, "sam_usd": sam_usd, "agent_usd": agent["cost_usd"], "drafts_usd": draft_usd}
    cost["total_usd"] = round(cost["spark_usd"] + sam_usd + cost["baseten_usd"] + agent["cost_usd"] + draft_usd, 4)
    report = {
        "project": {"name": package.name, "description": package.description, "root": str(package.root)},
        "finished_at": timestamp(), "seconds": round(time.time() - started, 1), "summary": toolbox.summary,
        "findings": toolbox.findings, "drafts": written, "results": toolbox.results, "evidence": toolbox.evidence,
        "agent": agent, "cost": cost,
    }
    expected = package.root / "expected_findings.json"
    if expected.exists():
        report["evaluation"] = evaluate(report, json.loads(expected.read_text()))
    write(run_dir, report)
    return report, toolbox
