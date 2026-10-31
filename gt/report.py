"""Writes a run's report.json and a self-contained report.html (evidence images sit next to it)."""

import json
from datetime import datetime
from html import escape
from pathlib import Path

KIND_ORDER = {"nonconformance": 0, "design_query": 1, "reporting_discrepancy": 2}
KIND_LABEL = {"nonconformance": "Non-conformance", "design_query": "Design query", "reporting_discrepancy": "Reporting discrepancy"}


def subject(result: dict) -> str:
    a, d = result["args"], result["data"]
    if result["tool"] == "verify_quantity":
        return f"{a['item_id']} on {a['capture_id']}: {d['observed']} of {d['design_qty']} {d['unit']}(s)"
    if result["tool"] == "check_equipment":
        return f"{a['capture_id']} against {a['schedule_tag']}"
    if result["tool"] == "read_nameplate":
        return f"{a['capture_id']}: {d.get('manufacturer') or '?'} {d.get('model_number') or ''}".strip()
    if result["tool"] == "check_drawing_register":
        return f"{a['drawing_id']}: sheet {d['title_block']['sheet_number']} rev {d['title_block']['revision'] or '(none)'}"
    if result["tool"] == "check_walkthrough":
        return f"{a['capture_id']}: {len(d['claims'])} claim(s)"
    return json.dumps(a)


def facts(result: dict, claim_index: int) -> list[tuple[str, str]]:
    """The measured facts behind a finding, as label/value rows."""
    d = result["data"]
    if result["tool"] == "verify_quantity":
        rows = [("Design", f"{d['design_qty']} {d['unit']}(s)"), ("Observed", f"{d['observed']} ({d['method']})"),
                ("Difference", f"{d['difference']:+d} (tolerance ±{d['tolerance']})")]
        short = d["details"].get("rows_below_the_fullest_row")
        if short:
            rows.append(("Short rows", ", ".join(f"row {r['row']}: {r['count']} (−{r['short_by']})" for r in short)))
        return rows
    if result["tool"] == "check_equipment":
        return [(f["field"], f"schedule {f['schedule_value'] or '—'} · plate {f['nameplate_value'] or '—'} · {f['status']}")
                for f in d["fields"] if f["status"] != "match"]
    if result["tool"] == "check_drawing_register":
        return [(c["field"], f"register {c['register']} · title block {c['title_block']}" + ("" if c["match"] else " · differs"))
                for c in d["comparison"]]
    if result["tool"] == "check_walkthrough" and claim_index >= 0:
        c = d["claims"][claim_index]
        rows = [("Said at", f"{c['t_s']:.1f} s: “{c['claim']}”"), ("Verdict", f"{c['verdict']} ({c['method']})")]
        if "sam_count_in_scope" in c:
            rows.append(("Count", f"claimed {c['claimed_count']}, SAM counted {c['sam_count_in_scope']} “{c['sam_phrase']}”"))
        rows.append(("Seen", c["evidence_text"]))
        return rows
    return []


CSS = """
:root { --bg:#f7f7f5; --card:#fff; --ink:#1d1d1b; --muted:#6b6b66; --line:#e3e2dd; --ncr:#b42318; --rfi:#b54708; --obs:#175cd3; --ok:#067647; --chip:#f0efeb; }
@media (prefers-color-scheme: dark) { :root { --bg:#141413; --card:#1e1e1c; --ink:#ecebe6; --muted:#a3a29b; --line:#33332f; --ncr:#f97066; --rfi:#fdb022; --obs:#84adff; --ok:#47cd89; --chip:#2a2a27; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 36px 0 12px; } h3 { font-size: 16px; margin: 0; }
.muted { color: var(--muted); } .small { font-size: 13px; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; min-width: 120px; }
.stat b { display: block; font-size: 22px; }
.summary { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--muted); border-radius: 10px; padding: 16px; margin: 14px 0; }
.card.nonconformance { border-left-color: var(--ncr); } .card.design_query { border-left-color: var(--rfi); } .card.reporting_discrepancy { border-left-color: var(--obs); }
.head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.badge { font-weight: 600; font-size: 12px; padding: 2px 8px; border-radius: 99px; background: var(--chip); }
.nonconformance .badge { color: var(--ncr); } .design_query .badge { color: var(--rfi); } .reporting_discrepancy .badge { color: var(--obs); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 12px; }
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
.evidence img { width: 100%; border-radius: 8px; border: 1px solid var(--line); display: block; }
.evidence figure { margin: 0 0 10px; } .evidence figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 8px 0; font-size: 14px; }
dt { color: var(--muted); } dd { margin: 0; }
.draft { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 10px; font-size: 14px; }
.draft h4 { margin: 10px 0 2px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.draft ul { margin: 2px 0; padding-left: 18px; }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; font-size: 13px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.v-pass { color: var(--ok); font-weight: 600; } .v-fail { color: var(--ncr); font-weight: 600; } .v-review { color: var(--rfi); font-weight: 600; }
.trace li { margin: 3px 0; } .trace code { font-size: 12.5px; }
.table-wrap { overflow-x: auto; }
"""


def verdict_class(verdict: str) -> str:
    if verdict in ("pass", "read", "confirmed"):
        return "v-pass"
    if verdict in ("review", "wrong_row", "needs_review", "cannot_verify", "not_in_register"):
        return "v-review"
    return "v-fail"


def write(run_dir: Path, report: dict) -> Path:
    (run_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    results, evidence = report["results"], report["evidence"]
    drafts = {d["finding_id"]: d for d in report["drafts"]}
    findings = sorted(report["findings"], key=lambda f: (KIND_ORDER[f["kind"]], f["id"]))
    counts = {k: sum(f["kind"] == k for f in findings) for k in KIND_ORDER}
    checks = [r for r in results.values() if r["tool"] != "read_nameplate"]
    passed = sum(r["data"]["verdict"] == "pass" for r in checks)
    e = escape
    cost = report["cost"]

    out = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
           f"<title>GroundTruth report</title><style>{CSS}</style></head><body><main>",
           f"<p class='muted small'>GroundTruth verification report · {e(report['finished_at'])}</p>",
           f"<h1>{e(report['project']['name'])}</h1><p class='muted'>{e(report['project']['description'])}</p>",
           "<div class='stats'>",
           f"<div class='stat'><b>{len(checks)}</b>checks run</div>",
           f"<div class='stat'><b>{passed}</b>passed</div>",
           f"<div class='stat'><b style='color:var(--ncr)'>{counts['nonconformance']}</b>non-conformances</div>",
           f"<div class='stat'><b style='color:var(--rfi)'>{counts['design_query']}</b>design queries</div>",
           f"<div class='stat'><b style='color:var(--obs)'>{counts['reporting_discrepancy']}</b>reporting discrepancies</div>",
           f"<div class='stat'><b>${cost['total_usd']:.2f}</b>model cost this run</div>",
           "</div>"]
    if report["summary"]:
        out.append(f"<div class='summary'><b>Agent summary.</b> {e(report['summary'])}</div>")

    out.append("<h2>Findings</h2>")
    if not findings:
        out.append("<p class='muted'>No findings.</p>")
    for f in findings:
        r = results[f["result_id"]]
        d = drafts.get(f["id"])
        number = d["number"] if d else f["id"]
        out.append(f"<section class='card {f['kind']}'><div class='head'><span class='badge'>{e(number)}</span>"
                   f"<h3>{e(f['title'])}</h3><span class='muted small'>{KIND_LABEL[f['kind']]}</span></div>")
        out.append("<div class='grid'><div>")
        out.append(f"<p>{e(f['explanation'])}</p><dl>")
        for label, value in facts(r, f["claim_index"]):
            out.append(f"<dt>{e(str(label))}</dt><dd>{e(str(value))}</dd>")
        out.append("</dl>")
        out.append(f"<p class='muted small'>Result {r['id']} · {e(r['tool'])}({e(', '.join(str(v) for v in r['args'].values()))}) · "
                   f"{e(', '.join(r['data'].get('models', [])))} · {r['seconds']} s{' (cached)' if r['cached'] else ''}</p>")
        if d:
            by = d.get("drafted_by", "")
            note = f"drafted by {e(by)} for engineer review" if not by.startswith("template") else f"<span class='v-review'>{e(by)}</span>"
            out.append(f"<div class='draft'><b>{e(d['document'])} {e(d['number'])}</b> · {note}")
            for label, key in (("Location", "location"), ("Requirement", "requirement"), ("Condition found", "condition_found"),
                               ("Impact", "impact"), ("Request", "request")):
                out.append(f"<h4>{label}</h4><div>{e(d[key])}</div>")
            for label, key in (("Evidence", "evidence"), ("Actions", "actions"), ("To be confirmed", "to_be_confirmed")):
                if d[key]:
                    out.append(f"<h4>{label}</h4><ul>" + "".join(f"<li>{e(x)}</li>" for x in d[key]) + "</ul>")
            out.append("</div>")
        out.append("</div><div class='evidence'>")
        for eid in f["evidence"]:
            ev = evidence[eid]
            out.append(f"<figure><a href='{e(ev['file'])}'><img src='{e(ev['file'])}' alt='{e(ev['caption'])}' loading='lazy'></a>"
                       f"<figcaption>{eid} · {e(ev['caption'])}</figcaption></figure>")
        out.append("</div></div></section>")

    out.append("<h2>Every check</h2><div class='table-wrap'><table><tr><th>Result</th><th>Check</th><th>Subject</th><th>Verdict</th><th>Models</th><th>Time</th></tr>")
    for r in results.values():
        verdict = r["data"]["verdict"]
        out.append(f"<tr><td>{r['id']}</td><td>{e(r['tool'])}</td><td>{e(subject(r))}</td>"
                   f"<td class='{verdict_class(verdict)}'>{e(verdict)}</td><td>{e(', '.join(r['data'].get('models', [])))}</td>"
                   f"<td>{r['seconds']} s{' cached' if r['cached'] else ''}</td></tr>")
        for c in r["data"].get("claims", []):
            out.append(f"<tr><td></td><td class='muted'>claim {c['claim_index']}</td><td>{c['t_s']:.1f} s: “{e(c['claim'])}”</td>"
                       f"<td class='{verdict_class(c['verdict'])}'>{e(c['verdict'])}</td><td class='muted'>{e(c['method'])}</td><td></td></tr>")
    out.append("</table></div>")

    agent = report["agent"]
    out.append(f"<h2>Agent trace</h2><p class='muted small'>{e(agent['model'])} (reasoning effort {e(agent['effort'])}) · "
               f"{agent['turns']} turns · {agent['seconds']} s · {agent['input_tokens']:,} in / {agent['output_tokens']:,} out tokens</p><ol class='trace'>")
    for step in agent["trace"]:
        if step["type"] == "note":
            out.append(f"<li class='muted'>turn {step['turn']}: {e(step['text'][:400])}</li>")
        else:
            ref = step["result_id"] or step["finding_id"] or ""
            out.append(f"<li>turn {step['turn']}: <code>{e(step['tool'])}({e(', '.join(str(v) for k, v in step['args'].items() if k != 'explanation'))[:140]})</code>"
                       f" → {e(step['brief'])} <span class='muted'>{ref} · {step['seconds']} s{' cached' if step['cached'] else ''}</span></li>")
    out.append("</ol>")
    out.append(f"<p class='muted small'>Cost this run: agent ${cost['agent_usd']:.3f}, drafts ${cost['drafts_usd']:.3f}, "
               f"Spark 1.3 ${cost['spark_usd']:.3f}, SAM {cost['sam_requests']} requests (${cost['sam_usd']:.3f}), "
               f"Spark Open on Baseten ${cost['baseten_usd']:.3f}; cached checks cost nothing. Verdicts are computed in code "
               "from the models' measurements; findings link to the result they rest on; drafts are for an engineer to review and sign.</p>")
    out.append("</main></body></html>")
    path = run_dir / "report.html"
    path.write_text("\n".join(out))
    return path


def timestamp() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
