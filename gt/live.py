"""Streams a run as newline-delimited JSON for the web app, evidence images included.

Every event carries `t`, seconds since the run started, so a saved stream is also a replay. Images are inlined
as small JPEG data URLs, so a browser can show the whole run from the one response; on a serverless host the
next request may land on a different instance that does not have the files.
"""

import base64
import io
import json
import queue
import threading
import time
from pathlib import Path
from typing import Callable, Iterator

from PIL import Image

from .media import fit_long_side
from .package import Package
from .pipeline import run_package
from .tools import Toolbox


def data_url(path: Path, long_side: int = 1100) -> str:
    image = fit_long_side(Image.open(path).convert("RGB"), long_side)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


class LiveRun:
    """Runs a package on a thread and yields its events as NDJSON lines (with a ping every 10 s of quiet)."""

    def __init__(self, package: Package, run_dir: Path, cache_dir: Path, *, seed_cache: Path | None = None,
                 mode: str = "live", on_finish: Callable[[dict | None], None] = lambda report: None) -> None:
        self.package, self.run_dir, self.cache_dir, self.seed_cache = package, run_dir, cache_dir, seed_cache
        self.mode, self.on_finish = mode, on_finish
        self.events: queue.Queue = queue.Queue()
        self.toolbox: Toolbox | None = None
        self.sent: set[str] = set()
        self.started = time.time()

    def emit(self, event: dict) -> None:
        self.events.put({"t": round(time.time() - self.started, 2), **event})

    def _evidence(self, ids: list[str]) -> dict:
        out = {}
        for eid in ids:
            entry = self.toolbox.evidence.get(eid) if self.toolbox else None
            if entry and eid not in self.sent:
                self.sent.add(eid)
                out[eid] = {"caption": entry["caption"], "src": data_url(self.run_dir / entry["file"])}
        return out

    def _on_event(self, event: dict) -> None:
        if event["type"] == "tool_end":
            output = event["output"]
            rid = output.get("result_id")
            if rid and self.toolbox and rid in self.toolbox.results:
                result = self.toolbox.results[rid]
                event = {**event, "result": {k: result[k] for k in ("id", "tool", "args", "data", "evidence", "cached", "seconds")},
                         "evidence": self._evidence(result["evidence"])}
            if output.get("finding_id") and self.toolbox:
                event = {**event, "finding": next(f for f in self.toolbox.findings if f["id"] == output["finding_id"])}
            event.pop("output", None)
        self.emit(event)

    def _work(self) -> None:
        report = None
        try:
            report, _ = run_package(self.package, self.run_dir, self.cache_dir, seed_cache=self.seed_cache,
                                    log=lambda line: None, on_event=self._on_event, toolbox_ready=self._bind)
            slim = {k: report[k] for k in ("project", "finished_at", "seconds", "summary", "findings", "drafts", "cost",
                                           "results", "agent", "evaluation") if k in report}
            slim["evidence"] = {k: {"caption": v["caption"]} for k, v in report["evidence"].items()}
            self.emit({"type": "done", "report": slim, "evidence": self._evidence(list(report["evidence"]))})
        except BaseException as error:  # includes SystemExit from a missing API key
            self.emit({"type": "error", "message": f"{type(error).__name__}: {error}"[:400]})
        finally:
            self.on_finish(report)  # always, so the server can free the run's slot
            self.events.put(None)

    def _bind(self, toolbox: Toolbox) -> None:
        self.toolbox = toolbox

    def stream(self, intro: dict) -> Iterator[str]:
        self.emit({"type": "start", "mode": self.mode, **intro})
        threading.Thread(target=self._work, daemon=True).start()
        while True:
            try:
                event = self.events.get(timeout=10)
            except queue.Empty:
                yield json.dumps({"t": round(time.time() - self.started, 2), "type": "ping"}) + "\n"
                continue
            if event is None:
                return
            yield json.dumps(event, ensure_ascii=False) + "\n"
