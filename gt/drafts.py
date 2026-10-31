"""Drafts the paperwork for each finding: an NCR, an RFI or an observation report.

Drafts are written only from the finding, the measurement behind it and the design rows it concerns; anything
else (names, dates, causes, costs) is left as [to be confirmed] for the engineer who signs it.

Muse Spark 1.3 writes them. Muse Wonder (preview) drifted to unrelated topics on these data-heavy prompts
("Maidstone agreeing entry rent fee" for a rusted motor plate): 2-4 of 9 drafts per run, while Spark 1.3 stayed
on topic 9 of 9. Every draft must also pass a grounding check (it names its subject and measured numbers);
one that fails twice is replaced by a plain template built from the facts, and the report says so.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

from .config import SPARK, meta_client
from .package import Package
from .spark import Usage, structured, text_part

STOPWORDS = {"there", "these", "those", "which", "about", "their", "every", "array", "between", "along"}

DOCUMENT = {
    "nonconformance": ("NCR", "Non-Conformance Report"),
    "design_query": ("RFI", "Request for Information"),
    "reporting_discrepancy": ("OBS", "Site Observation Report"),
}

S = {"type": "string"}
DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {**S, "description": "short title without the document number"},
        "location": {**S, "description": "area, equipment tag or sheet, as named in the design"},
        "requirement": {**S, "description": "one or two sentences citing the design requirement or document exactly"},
        "condition_found": {**S, "description": "two to four sentences on what was measured or seen, with the numbers and how it was measured"},
        "evidence": {"type": "array", "items": S, "description": "one sentence per evidence ID: 'E7: <what the image shows>'"},
        "impact": {**S, "description": "one or two sentences on what this blocks or risks (e.g. energisation, handover, payment); [to be confirmed] if unknown"},
        "request": {**S, "description": "NCR: the proposed disposition; RFI: the exact question the designer or vendor must answer; OBS: the correction asked of the person who reported it. One to three sentences."},
        "actions": {"type": "array", "items": S, "description": "two to four next steps, each an imperative sentence naming who acts (by role)"},
        "to_be_confirmed": {"type": "array", "items": S, "description": "information the drafter did not have, as short phrases"},
    },
    "required": ["title", "location", "requirement", "condition_found", "evidence", "impact", "request", "actions", "to_be_confirmed"],
    "additionalProperties": False,
}


def _design_rows(package: Package, result: dict) -> dict:
    args, rows = result["args"], {}
    if "item_id" in args:
        rows["quantity_item"] = package.quantity(args["item_id"])
    if "schedule_tag" in args:
        rows["schedule_row"] = package.schedule_row(args["schedule_tag"])
    if "drawing_id" in args:
        rows["register_row"] = next((r for r in package.register if r.get("drawing_id") == args["drawing_id"]), None)
    return rows


def anchors(result: dict, finding: dict, design: dict) -> tuple[list[str], list[str]]:
    """What a draft about this finding must mention: (one of these subjects, one of these facts)."""
    a, d = result["args"], result["data"]
    subjects = [a.get("schedule_tag"), a.get("item_id"), a.get("capture_id"), a.get("drawing_id")]
    item = design.get("quantity_item") or {}
    subjects += [item.get("area"), (design.get("register_row") or {}).get("sheet_number")]
    if result["tool"] == "check_walkthrough":
        subjects += ["walkthrough", "narrat", "walk"]
        claim = d["claims"][finding["claim_index"]]["claim"]
        facts = [w for w in re.findall(r"[a-z]{5,}", claim.lower()) if w not in STOPWORDS]
    elif result["tool"] == "verify_quantity":
        facts = [str(d["observed"]), str(d["design_qty"])]
    elif result["tool"] == "check_equipment":
        facts = [f["nameplate_value"] for f in d["fields"] if f["status"] != "match" and f["nameplate_value"]]
        facts += [f["schedule_value"] for f in d["fields"] if f["status"] != "match" and f["schedule_value"]]
    else:
        facts = [c["title_block"] for c in d.get("comparison", []) if not c["match"]] or [str(d.get("title_block", {}).get("revision", ""))]
    clean = lambda xs: [x.lower() for x in xs if x and len(str(x).strip()) > 0]  # noqa: E731
    return clean(subjects), clean(facts) or [""]


def grounded(draft: dict, subjects: list[str], facts: list[str]) -> bool:
    text = json.dumps(draft, ensure_ascii=False).lower()
    return any(s in text for s in subjects) and any(f in text for f in facts)


def template(finding: dict, result: dict, design: dict, evidence: dict) -> dict:
    request = {"nonconformance": "Correct the work to match the design, or propose a disposition for the engineer's approval.",
               "design_query": "The designer or vendor is asked to confirm which value is correct and update the documents.",
               "reporting_discrepancy": "The person who reported this is asked to correct the record."}[finding["kind"]]
    return {"title": finding["title"], "location": ", ".join(str(v) for v in result["args"].values()),
            "requirement": json.dumps(design, ensure_ascii=False), "condition_found": finding["explanation"],
            "evidence": [f"{e}: {evidence[e]['caption']}" for e in finding["evidence"]], "impact": "[to be confirmed]",
            "request": request, "actions": [], "to_be_confirmed": ["all fields: the model draft failed the grounding check"]}


SYSTEM = (
    "You are the site QA engineer drafting documents for a construction project's quality log. Write only from the "
    "facts in the user's message: never add other projects, people, places or topics. Do not invent names, dates, "
    "costs or causes; write the literal text [to be confirmed] wherever information is missing and list it under "
    "to_be_confirmed. Write every field in full sentences of plain English as it would appear on the signed form, "
    "cite the measured numbers and the evidence IDs, and keep it concise."
)


def draft_all(package: Package, findings: list[dict], results: dict, evidence: dict, *, model: str = SPARK,
              effort: str = "medium") -> tuple[list[dict], Usage]:
    client = meta_client()
    usage = Usage()
    counters: dict[str, int] = {}
    jobs = []
    for finding in findings:
        prefix, name = DOCUMENT[finding["kind"]]
        counters[prefix] = counters.get(prefix, 0) + 1
        jobs.append((finding, f"{prefix}-{counters[prefix]:03d}", name))

    def one(job):
        finding, number, name = job
        result = results[finding["result_id"]]
        data = dict(result["data"])
        if finding["claim_index"] >= 0:
            data = {**{k: v for k, v in data.items() if k != "claims"}, "claim": data["claims"][finding["claim_index"]]}
        design = _design_rows(package, result)
        facts = {
            "project": package.name,
            "document": f"{name} {number}",
            "finding": {k: finding[k] for k in ("kind", "title", "explanation", "verdict")},
            "measurement": {"tool": result["tool"], "result_id": result["id"], "data": data},
            "design": design,
            "evidence": [evidence[e] for e in finding["evidence"]],
        }
        subjects, must = anchors(result, finding, design)
        content = [text_part(f"Draft {name} {number} from these facts:\n" + json.dumps(facts, indent=1))]
        for attempt in (1, 2):
            draft = structured(client, content, "draft", DRAFT_SCHEMA, usage=usage, effort=effort, model=model,
                               instructions=SYSTEM)
            if grounded(draft, subjects, must):
                return {"finding_id": finding["id"], "number": number, "document": name, "drafted_by": model,
                        "attempts": attempt, **draft}
        return {"finding_id": finding["id"], "number": number, "document": name, "attempts": 2,
                "drafted_by": f"template ({model} failed the grounding check twice)", **template(finding, result, design, evidence)}

    with ThreadPoolExecutor(max_workers=6) as pool:
        drafts = list(pool.map(one, jobs))
    return drafts, usage
