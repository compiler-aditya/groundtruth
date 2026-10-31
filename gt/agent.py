"""The GroundTruth agent: Muse Wonder plans and runs the checks for a package with the tools in gt/tools.py.

It reads the whole design package (quantities, equipment schedule, drawing register, site notes and the list of
captures), decides which capture verifies which design item, runs the checks (in parallel where it can),
follows up where a result says so (e.g. a plate compared with the wrong schedule row), and records a finding
for every result that did not pass. Verdicts come from the tools; the model writes titles and explanations.
Tool calls use the Responses API with stateless replay: each turn resends the conversation, reasoning included.
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from .config import PRICE, WONDER, meta_client
from .package import Package
from .spark import Usage
from .tools import TOOL_SPECS, Toolbox

SYSTEM = (
    "You are GroundTruth, a commissioning QA agent on a large construction site. You verify what was built and "
    "installed against the design package, using only the tools, and you never state a fact a tool did not "
    "return.\n"
    "Work through the whole package:\n"
    "1. Every quantity item: run verify_quantity with the capture of its area (drone_still) or the drawing it "
    "names (drawing_symbol).\n"
    "2. Every nameplate photo: read_nameplate, decide from the plate itself (manufacturer, model, ratings) which "
    "equipment schedule row it is, then check_equipment against that row. If the verdict is wrong_row, try the "
    "next most likely row. Never match by capture ID or order.\n"
    "3. Every drawing sheet: check_drawing_register.\n"
    "4. Every walkthrough video: check_walkthrough.\n"
    "Call independent tools in the same turn so they run in parallel; start the slow walkthrough check early.\n"
    "Then record a finding for every result that did not pass (one per failing result, and one per walkthrough "
    "claim that was contradicted; claims marked needs_review or cannot_verify go to a person, so mention them in "
    "the summary instead): nonconformance when installed work or equipment differs from the design; "
    "design_query when design documents disagree with each other, a sheet is not at the current revision, or "
    "evidence cannot be read so the designer or vendor must answer; reporting_discrepancy when what someone "
    "reported is contradicted by the evidence. A review verdict caused only by something the plate does not show "
    "(e.g. phase implied by a vector group) is not a finding. Titles are short and specific; explanations cite the "
    "measured numbers. Finally call finish with a summary for the project manager: what was checked, what failed, "
    "what needs an answer."
)


def _text(item) -> str:
    return " ".join(part.text for part in getattr(item, "content", None) or [] if getattr(part, "text", None)).strip()


def _brief(output: dict) -> str:
    if "error" in output:
        return f"error: {output['error'][:120]}"
    if "finding_id" in output:
        return f"{output['finding_id']} ({output['verdict']})"
    parts = [output.get("verdict", "")]
    if "observed" in output:
        parts.append(f"{output['observed']} vs design {output['design_qty']}")
    if "claims" in output:
        tally = {v: sum(c["verdict"] == v for c in output["claims"]) for v in ("confirmed", "contradicted")}
        unsure = len(output["claims"]) - sum(tally.values())
        parts.append(f"{tally['confirmed']} confirmed, {tally['contradicted']} contradicted" + (f", {unsure} for review" if unsure else ""))
    if output.get("manufacturer"):
        parts.append(f"{output['manufacturer']} {output.get('model_number') or ''}".strip())
    return ", ".join(p for p in parts if p)


def run_agent(package: Package, toolbox: Toolbox, *, model: str = WONDER, effort: str = "medium",
              max_turns: int = 30, log: Callable[[str], None] = print) -> dict:
    client = meta_client()
    usage = Usage(PRICE["wonder_in_per_m"], PRICE["wonder_out_per_m"]) if model == WONDER else Usage()
    conversation: list = [{"role": "user", "content": package.overview() + "\n\nVerify this package against the captures."}]
    trace: list[dict] = []
    started = time.time()
    turn = 0
    for turn in range(1, max_turns + 1):
        t0 = time.time()
        response = client.responses.create(model=model, instructions=SYSTEM, input=conversation, tools=TOOL_SPECS,
                                           reasoning={"effort": effort}, max_output_tokens=16000)
        usage.add(response.usage)
        if response.status != "completed":
            raise RuntimeError(f"agent turn {turn}: response {response.status} ({response.incomplete_details})")
        conversation += [item.model_dump(exclude_none=True) for item in response.output]
        for item in response.output:
            if item.type == "message" and _text(item):
                trace.append({"turn": turn, "type": "note", "text": _text(item)})
                log(f"  [{turn}] agent: {_text(item)[:300]}")
        calls = [item for item in response.output if item.type == "function_call"]
        log(f"  [{turn}] {len(calls)} tool call(s) after {time.time() - t0:.1f}s of thinking")
        if not calls:
            if toolbox.finished:
                break
            conversation.append({"role": "user", "content": "Continue: call the next tools, or finish when everything is checked."})
            continue

        def run(call):
            t = time.time()
            args = json.loads(call.arguments or "{}")
            return args, toolbox.call(call.name, args), time.time() - t

        with ThreadPoolExecutor(max_workers=8) as pool:
            outputs = list(pool.map(run, calls))
        for call, (args, output, seconds) in zip(calls, outputs):
            conversation.append({"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(output)})
            cached = toolbox.results.get(output.get("result_id", ""), {}).get("cached", False)
            trace.append({"turn": turn, "type": "tool", "tool": call.name, "args": args, "result_id": output.get("result_id"),
                          "finding_id": output.get("finding_id"), "brief": _brief(output), "seconds": round(seconds, 1),
                          "cached": cached, "error": output.get("error")})
            label = ", ".join(str(args[k]) for k in ("item_id", "capture_id", "schedule_tag", "drawing_id", "result_id", "title")
                              if k in args)
            log(f"      {call.name}({label[:90]}) -> {_brief(output)} [{output.get('result_id') or output.get('finding_id') or ''}"
                f"{', cached' if cached else ''}, {seconds:.1f}s]")
        if toolbox.finished:
            break
    return {"model": model, "effort": effort, "turns": turn, "seconds": round(time.time() - started, 1),
            "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens, "cost_usd": round(usage.cost, 4),
            "trace": trace}
