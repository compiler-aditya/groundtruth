/* GroundTruth web app: home (demo package, upload), live run (streamed events), findings. No framework. */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");
const KIND = {
  nonconformance: { label: "Non-conformance", plural: "Non-conformances", doc: "NCR", stat: "ncr" },
  design_query: { label: "Design query", plural: "Design queries", doc: "RFI", stat: "rfi" },
  reporting_discrepancy: { label: "Reporting discrepancy", plural: "Reporting discrepancies", doc: "OBS", stat: "obs" },
};
const TYPE_LABEL = { drone_still: "Drone still", nameplate_photo: "Nameplate", drawing_sheet: "Drawing", walkthrough_video: "Walkthrough video" };
const PASS = new Set(["pass", "read", "confirmed"]);
const REVIEW = new Set(["review", "needs_review", "cannot_verify", "wrong_row", "not_in_register"]);
const verdictClass = (v) => (PASS.has(v) ? "pass" : REVIEW.has(v) ? "review" : "fail");

const S = { health: null, pkg: null, run: null, report: null, filter: "all", files: [] };

/* ---------------- lightbox ---------------- */
function openImage(src, caption) {
  const box = $("#lightbox");
  $("img", box).src = src;
  $("p", box).textContent = caption || "";
  box.hidden = false;
}
$("#lightbox").addEventListener("click", () => ($("#lightbox").hidden = true));
document.addEventListener("keydown", (e) => e.key === "Escape" && ($("#lightbox").hidden = true));
document.addEventListener("click", (e) => {
  const img = e.target.closest("img[data-zoom]");
  if (img) openImage(img.dataset.full || img.src, img.dataset.caption || img.alt);
});

/* ---------------- routing ---------------- */
window.addEventListener("hashchange", route);
async function route() {
  const hash = location.hash || "#/";
  if (hash.startsWith("#/run")) return renderRun();
  if (hash.startsWith("#/findings")) return renderFindings();
  if (hash.startsWith("#/upload")) { await renderHome(); return $("#upload")?.scrollIntoView(); }
  return renderHome();
}

/* ---------------- home ---------------- */
async function load() {
  if (!S.health) S.health = await fetch("/api/health").then((r) => r.json()).catch(() => ({}));
  if (!S.pkg) S.pkg = await fetch("/api/packages/demo-solar").then((r) => r.json());
}

function table(rows, cols) {
  if (!rows?.length) return "<p class='muted small'>None in this package.</p>";
  cols = cols || Object.keys(rows[0]);
  return `<div class="table-wrap"><table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${rows
    .map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</table></div>`;
}

async function renderHome() {
  app.innerHTML = `<p class="muted" style="padding:40px 0">Loading…</p>`;
  await load();
  const p = S.pkg;
  const keys = S.health?.keys || {};
  const liveReady = keys.meta !== false;
  const planted = p.planted;
  app.innerHTML = `
  <section class="hero">
    <div>
      <h1>Check the site against the design, with evidence.</h1>
      <p class="lead">GroundTruth reads a project's design package and the captures the site already produces (drone stills,
      nameplate photos, drawings, a narrated phone walk). A Muse Wonder agent checks each design item with SAM 3.1,
      Muse Spark 1.3 and Muse Spark Open, records every failure as a finding tied to its evidence, and Spark 1.3 drafts the
      NCR, RFI or observation report.</p>
      <div class="ctas">
        <button class="btn primary" id="go-live" ${liveReady ? "" : "disabled"}>▶ Run the agent live on the demo</button>
        <button class="btn" id="go-replay">Play a recorded run</button>
      </div>
      <p class="small faint" style="margin-top:10px">Live: Muse Wonder decides every step in real time (about a minute; measurements come from
      a cache of earlier model runs on the same files). Recorded: a real run played back, no API calls.${liveReady ? "" : " Live runs are off on this deployment (no API key)."}</p>
    </div>
    <div class="flow"><ol>
      <li><div><b>Read the design package</b><span>Quantities, equipment schedule, drawing register, site notes</span></div></li>
      <li><div><b>Plan and run the checks</b><span>Muse Wonder calls tools in parallel and follows up on what it finds</span></div></li>
      <li><div><b>Measure with Meta's models</b><span>SAM 3.1 counts, Spark 1.3 reads plates and drawings, Spark Open hears and sees the walk</span></div></li>
      <li><div><b>Verdicts in code, findings with evidence</b><span>A finding can only rest on a measurement that failed</span></div></li>
      <li><div><b>Draft the paperwork</b><span>NCR, RFI or observation report, grounding-checked, for an engineer to sign</span></div></li>
    </ol></div>
  </section>

  <section class="block panel">
    <div class="panel-head">
      <div><h2>Demo package: ${esc(p.name)}</h2>
        <p class="muted small" style="margin:0;max-width:760px">${esc(p.description)}</p>
        <div class="facts-row">
          <span class="chip">${p.captures.filter((c) => c.type !== "drawing_sheet").length} captures</span>
          <span class="chip">${p.captures.filter((c) => c.type === "drawing_sheet").length} drawings</span>
          <span class="chip">${p.quantities.length} quantity items</span>
          <span class="chip">${p.schedule.length} schedule rows</span>
          <span class="chip">${p.register.length} register rows</span>
          ${planted ? `<span class="chip review">${planted.nonconformance.length + planted.design_query.length + planted.reporting_discrepancy.length} planted problems</span>` : ""}
        </div>
      </div>
    </div>
    <div class="captures">${p.captures.map((c) => `
      <div class="capture" title="${esc(c.credit)}${c.license ? " · " + esc(c.license) : ""}">
        <img src="${esc(c.thumb)}" alt="${esc(c.id)}" loading="lazy" data-zoom data-caption="${esc(c.id)} · ${esc(c.label)} · ${esc(c.credit)} ${c.license ? "(" + esc(c.license) + ")" : ""}">
        <div class="cap"><b>${esc(c.id)}</b>${esc(TYPE_LABEL[c.type] || c.type)}${c.area ? " · " + esc(c.area) : ""}</div>
      </div>`).join("")}
    </div>
    <div class="video">
      <video src="${esc(p.walk_video)}" controls preload="none" poster="/thumbs/demo-solar/WLK-01.jpg"></video>
      <div><b>WLK-01, the narrated walk.</b><p class="muted small">Real CC0 drone footage of two agrivoltaic plants (Tobi Kellner) with a
      scripted narration: three true claims and three false ones. The agent has to tell which is which from the pixels.</p></div>
    </div>
    <details><summary>Design documents the agent reads</summary>
      <h4>Quantities</h4>${table(p.quantities)}
      <h4>Equipment schedule</h4>${table(p.schedule)}
      <h4>Drawing register</h4>${table(p.register)}
      <h4>Site notes</h4><pre class="mono" style="white-space:pre-wrap">${esc(p.site_notes)}</pre>
    </details>
    ${planted ? `<details><summary>Answer key (what a correct run should find)</summary>
      ${["nonconformance", "design_query", "reporting_discrepancy"].map((k) => `<h4>${KIND[k].plural}</h4><ul>${planted[k].map((x) => `<li><b>${esc(x.ref)}</b>: ${esc(x.what)}</li>`).join("")}</ul>`).join("")}
      <h4>Should pass</h4><p class="small">${esc(planted.pass.join(" · "))}</p></details>` : ""}
  </section>

  <section class="block panel" id="upload">
    <h2>Try your own photos</h2>
    <p class="muted small" style="margin-top:0">Add nameplate photos, drone stills or drawing sheets (photos are shrunk in your browser before upload),
    plus whatever design you have: an equipment schedule, quantities, a drawing register. The agent works with what it gets.
    ${S.health?.video_uploads ? "" : "Video is not available on this deployment."} Up to ${S.health?.max_files || 8} files.</p>
    <div class="drop" id="drop">Drop files here or <u>choose files</u><input type="file" id="file-in" multiple accept="image/*,.pdf${S.health?.video_uploads ? ",video/*" : ""}" hidden></div>
    <div class="files" id="files"></div>
    <div class="grid2">
      <div>
        <label class="field">Project name</label><input id="u-name" value="My site check">
        <label class="field">Equipment schedule (CSV, needs a <span class="mono">tag</span> column)</label>
        <textarea id="u-schedule" placeholder="tag,equipment_type,manufacturer,model_number,voltage,power,phase,frequency_hz&#10;P-101-M,induction motor,ABB,M3BP 160,400 V,11 kW,3,50"></textarea>
        <label class="field">Site notes (design intent, optional)</label>
        <textarea id="u-notes" placeholder="## Block A&#10;8 rows of 24 modules..."></textarea>
      </div>
      <div>
        <label class="field">Quantities (CSV, optional)</label>
        <textarea id="u-quantities" placeholder="item_id,area,description,count_what,unit,design_qty,method,tolerance_pct&#10;Q-1,Block A,PV modules in Block A,solar panel,module,192,objects,0"></textarea>
        <label class="field">Drawing register (CSV, optional)</label>
        <textarea id="u-register" placeholder="sheet_number,title,current_revision,drawing_id&#10;E-101,FIRST FLOOR POWER PLAN,3,DWG-01"></textarea>
        ${S.health?.upload_code_required ? `<label class="field">Access code</label><input id="u-code" placeholder="from the project submission">` : ""}
      </div>
    </div>
    <p class="small faint">Uploaded drawings get IDs DWG-01, DWG-02… in upload order; use those in the register's drawing_id column.
    Methods: objects, tables, modules (drone stills) or drawing_symbol (drawings).</p>
    <button class="btn primary" id="go-upload" ${liveReady ? "" : "disabled"}>▶ Run the agent on my files</button>
  </section>`;

  $("#go-live").onclick = () => startRun({ mode: "live" });
  $("#go-replay").onclick = () => startRun({ mode: "replay" });
  setupUpload();
}

/* ---------------- upload ---------------- */
function guessType(file) {
  if (file.type === "application/pdf" || /\.(pdf|tiff?)$/i.test(file.name)) return "drawing_sheet";
  if (file.type.startsWith("video/")) return "walkthrough_video";
  if (/drone|dji|aerial|nadir/i.test(file.name)) return "drone_still";
  return "nameplate_photo";
}

function setupUpload() {
  const drop = $("#drop"), input = $("#file-in");
  drop.onclick = () => input.click();
  input.onchange = () => addFiles([...input.files]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); };
  renderFiles();
  $("#go-upload").onclick = submitUpload;
}

function addFiles(files) {
  const max = S.health?.max_files || 8;
  for (const f of files) {
    if (S.files.length >= max) break;
    S.files.push({ file: f, type: guessType(f), area: "", label: f.name, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : "" });
  }
  renderFiles();
}

function renderFiles() {
  const box = $("#files");
  if (!box) return;
  const types = Object.entries(TYPE_LABEL).filter(([k]) => k !== "walkthrough_video" || S.health?.video_uploads);
  box.innerHTML = S.files.map((f, i) => `
    <div class="file-row">
      ${f.preview ? `<img src="${f.preview}" alt="">` : `<div class="ph">${esc(f.file.name.split(".").pop().toUpperCase())}</div>`}
      <div class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.file.name)}<br><span class="faint">${(f.file.size / 1e6).toFixed(1)} MB</span></div>
      <select data-i="${i}" data-k="type">${types.map(([k, v]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input class="area" data-i="${i}" data-k="area" placeholder="Area (e.g. Block A)" value="${esc(f.area)}">
      <button class="icon-btn" data-rm="${i}" title="Remove">×</button>
    </div>`).join("");
  box.querySelectorAll("[data-k]").forEach((el) => (el.oninput = () => (S.files[+el.dataset.i][el.dataset.k] = el.value)));
  box.querySelectorAll("[data-rm]").forEach((el) => (el.onclick = () => { S.files.splice(+el.dataset.rm, 1); renderFiles(); }));
}

async function shrink(file, maxSide = 2000) {
  if (!file.type.startsWith("image/") || /tiff?$/i.test(file.name)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

async function submitUpload() {
  if (!S.files.length) return alert("Add at least one photo or drawing first.");
  const btn = $("#go-upload");
  btn.disabled = true; btn.textContent = "Preparing files…";
  const form = new FormData();
  form.append("name", $("#u-name").value);
  form.append("schedule_csv", $("#u-schedule").value);
  form.append("quantities_csv", $("#u-quantities").value);
  form.append("register_csv", $("#u-register").value);
  form.append("site_notes", $("#u-notes").value);
  form.append("code", $("#u-code")?.value || "");
  form.append("meta", JSON.stringify(S.files.map((f) => ({ type: f.type, area: f.area, label: f.label }))));
  for (const f of S.files) form.append("files", await shrink(f.file));
  startRun({ mode: "upload", form });
}

/* ---------------- run ---------------- */
function newRun(mode) {
  return { mode, events: [], tools: {}, results: {}, evidence: {}, findings: [], drafts: [], turn: 0, phase: "agent",
           agentCost: 0, started: Date.now(), t: 0, report: null, error: null, name: S.pkg?.name || "" };
}

function startRun({ mode, form }) {
  S.run = newRun(mode);
  S.report = null;
  location.hash = "#/run";
  renderRun();
  if (mode === "replay") return replay("/replays/demo-solar.ndjson");
  const req = mode === "upload"
    ? fetch("/api/run-upload", { method: "POST", body: form })
    : fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: "demo-solar" }) });
  readStream(req);
}

async function readStream(request) {
  try {
    const res = await request;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return apply({ type: "error", message: body.detail || `Server said ${res.status}` });
    }
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) apply(JSON.parse(line));
      }
    }
    if (S.run.phase !== "done" && !S.run.error) apply({ type: "error", message: "The connection closed before the run finished." });
  } catch (err) {
    apply({ type: "error", message: String(err) });
  }
}

async function replay(url) {
  const run = S.run;
  const text = await fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error("No recorded run on this deployment."))))
    .catch((e) => (apply({ type: "error", message: e.message }), ""));
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type !== "ping");
  let last = 0;
  for (const ev of events) {
    if (S.run !== run) return; // a new run replaced this one
    const gap = Math.min(Math.max(ev.t - last, 0), 2.2); // keep the rhythm, skip long waits
    last = ev.t;
    if (gap > 0.02) await new Promise((r) => setTimeout(r, gap * 1000));
    apply({ ...ev, replay: true });
  }
}

const toolTitle = (tool, a) => ({
  verify_quantity: `Count ${a.item_id} on ${a.capture_id}`,
  read_nameplate: `Read nameplate ${a.capture_id}`,
  check_equipment: `Check ${a.capture_id} against schedule row ${a.schedule_tag}`,
  check_drawing_register: `Check ${a.drawing_id} against the drawing register`,
  check_walkthrough: `Review walkthrough ${a.capture_id}: listen, watch, then re-check each claim on stills`,
  record_finding: `Record finding: ${a.title}`,
  finish: "Finish and summarise",
}[tool] || tool);

function apply(ev) {
  const run = S.run;
  if (!run) return;
  run.events.push(ev);
  run.t = ev.t ?? run.t;
  const tl = $("#timeline");
  switch (ev.type) {
    case "start":
      run.name = ev.name || run.name;
      break;
    case "turn":
      run.turn = ev.turn;
      run.agentCost = ev.agent_cost_usd ?? run.agentCost;
      tl?.insertAdjacentHTML("beforeend", `<div class="turn">Turn ${ev.turn} · Muse Wonder ${ev.calls ? `called ${ev.calls} tool${ev.calls > 1 ? "s" : ""}${ev.calls > 1 ? " in parallel" : ""}` : "replied"} after ${ev.thinking_s}s</div>`);
      break;
    case "note":
      tl?.insertAdjacentHTML("beforeend", `<div class="note"><div class="av">W</div><div class="bubble"><div class="who">Muse Wonder</div>${esc(ev.text)}</div></div>`);
      break;
    case "tool_start":
      run.tools[ev.call_id] = { start: ev };
      if (ev.tool !== "record_finding" && ev.tool !== "finish") {
        tl?.insertAdjacentHTML("beforeend", `<div class="tool" id="c-${esc(ev.call_id)}"><div><div class="title"><span class="spin"></span>${esc(toolTitle(ev.tool, ev.args))}</div><div class="sub">running…</div></div><div class="thumbs"></div></div>`);
      }
      break;
    case "tool_end": {
      run.tools[ev.call_id] = { ...(run.tools[ev.call_id] || {}), end: ev };
      Object.assign(run.evidence, ev.evidence || {});
      if (ev.result) run.results[ev.result.id] = ev.result;
      if (ev.finding) {
        run.findings.push(ev.finding);
        tl?.insertAdjacentHTML("beforeend", `<div class="tool finding ${ev.finding.kind}"><div><div class="title"><span class="chip ${ev.finding.kind}">${KIND[ev.finding.kind].label}</span>${esc(ev.finding.title)}</div><div class="sub">${esc(ev.finding.explanation)}</div></div><div class="thumbs">${thumbs(ev.finding.evidence, 1)}</div></div>`);
      } else if (ev.tool === "finish") {
        // the summary arrives with the report
      } else {
        const card = document.getElementById(`c-${ev.call_id}`);
        if (card) {
          const r = ev.result;
          const v = r?.data?.verdict;
          const models = (r?.data?.models || []).map((m) => `<span class="chip model">${esc(m)}</span>`).join("");
          $(".title", card).innerHTML = `${v ? `<span class="chip ${verdictClass(v)}">${esc(v.replace(/_/g, " "))}</span>` : ""}${esc(toolTitle(ev.tool, ev.args))}`;
          const brief = (ev.brief || "").replace(new RegExp(`^${v || "\\0"},?\\s*`), ""); // the chip already shows the verdict
          $(".sub", card).innerHTML = ev.error || ev.brief?.startsWith("error")
            ? `<span style="color:var(--ncr)">${esc(ev.brief)}</span>`
            : `${esc(brief)} <span class="faint">${brief ? "· " : ""}${ev.seconds}s${ev.cached ? " · cached measurement" : ""}</span> ${models}`;
          $(".thumbs", card).innerHTML = thumbs(r?.evidence || [], 2);
        }
      }
      break;
    }
    case "drafting":
      run.phase = "drafting";
      tl?.insertAdjacentHTML("beforeend", `<div class="turn">Drafting ${ev.count} documents with ${esc(ev.model)} (each must name its subject and numbers, or it is redone)</div>`);
      break;
    case "draft":
      run.drafts.push(ev.draft);
      tl?.insertAdjacentHTML("beforeend", `<div class="tool"><div><div class="title"><span class="chip">${esc(ev.draft.number)}</span>${esc(ev.draft.title)}</div><div class="sub">${esc(ev.draft.document)} drafted by ${esc(ev.draft.drafted_by)}${ev.draft.attempts > 1 ? " (second attempt)" : ""}</div></div><div></div></div>`);
      break;
    case "done":
      run.phase = "done";
      Object.assign(run.evidence, ev.evidence || {});
      run.report = ev.report;
      S.report = { ...ev.report, evidenceSrc: run.evidence, mode: run.mode };
      tl?.insertAdjacentHTML("beforeend", doneCard(ev.report));
      $("#see")?.addEventListener("click", () => (location.hash = "#/findings"));
      break;
    case "error":
      run.error = ev.message;
      run.phase = "error";
      tl?.insertAdjacentHTML("beforeend", `<div class="error-card"><b>The run stopped.</b> ${esc(ev.message)}
        ${run.mode !== "replay" ? `<div style="margin-top:8px"><button class="btn small" onclick="startRun({mode:'replay'})">Play the recorded run instead</button></div>` : ""}</div>`);
      break;
  }
  if (["tool_end", "turn", "done", "error", "draft", "drafting", "start"].includes(ev.type)) renderSide();
  if (ev.type !== "ping" && tl && isNearBottom()) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

const isNearBottom = () => window.innerHeight + window.scrollY > document.body.scrollHeight - 400;

function thumbs(ids, max) {
  return (ids || []).slice(0, max).map((id) => {
    const ev = S.run?.evidence[id] || S.report?.evidenceSrc?.[id];
    return ev ? `<img src="${ev.src}" alt="${esc(id)}" data-zoom data-caption="${esc(id)} · ${esc(ev.caption)}">` : "";
  }).join("");
}

function doneCard(report) {
  const ev = report.evaluation;
  return `<div class="done-card"><h3>Done: ${report.findings.length} findings from ${Object.values(report.results).filter((r) => r.tool !== "read_nameplate").length} checks</h3>
    <p style="margin:0 0 10px">${esc(report.summary)}</p>
    ${ev ? `<p><span class="score">Answer key: ${ev.found}/${ev.expected} planted problems found · ${ev.right_kind} with the right document type · ${ev.extra_findings.length} extra</span></p>` : ""}
    <button class="btn primary" id="see">See the findings, evidence and drafts →</button></div>`;
}

function counts() {
  const run = S.run;
  const checks = Object.values(run.results).filter((r) => r.tool !== "read_nameplate");
  const passed = checks.filter((r) => r.data.verdict === "pass").length;
  const by = (k) => run.findings.filter((f) => f.kind === k).length;
  return { checks: checks.length, passed, ncr: by("nonconformance"), rfi: by("design_query"), obs: by("reporting_discrepancy") };
}

function renderSide() {
  const side = $("#side");
  if (!side || !S.run) return;
  const run = S.run, c = counts();
  const status = { agent: run.turn ? `Muse Wonder · turn ${run.turn}` : "Muse Wonder is reading the package…", drafting: "Drafting documents…", done: "Finished", error: "Stopped" }[run.phase];
  const cost = run.report ? run.report.cost.total_usd : run.agentCost;
  $(".pulse")?.classList.toggle("off", run.phase === "done" || run.phase === "error");
  $("#status").textContent = status;
  side.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${c.checks}</b><span>checks run</span></div>
      <div class="stat ok"><b>${c.passed}</b><span>passed</span></div>
      <div class="stat ncr"><b>${c.ncr}</b><span>non-conformances</span></div>
      <div class="stat rfi"><b>${c.rfi}</b><span>design queries</span></div>
      <div class="stat obs"><b>${c.obs}</b><span>reporting discrepancies</span></div>
      <div class="stat"><b>${run.mode === "replay" ? "$0" : "$" + (cost || 0).toFixed(2)}</b><span>${run.mode === "replay" ? "recorded run" : run.report ? "model cost" : "agent cost so far"}</span></div>
    </div>
    <div><b class="small">Findings so far</b><div class="flist" style="margin-top:6px">${run.findings.map((f) => `<div class="f ${f.kind}">${esc(f.title)}</div>`).join("") || `<span class="small faint">None yet</span>`}</div></div>
    ${run.phase === "done" ? `<button class="btn primary" onclick="location.hash='#/findings'">See the findings →</button>` : ""}`;
}

function renderRun() {
  const run = S.run;
  if (!run) { location.hash = "#/"; return; }
  app.innerHTML = `<div class="run">
    <div class="run-head"><span class="pulse"></span><h1>${esc(run.name || "Verification run")}</h1>
      <span class="chip">${run.mode === "replay" ? "Recorded run" : "Live"}</span><span class="muted small" id="status"></span>
      <span class="muted small" id="clock" style="margin-left:auto"></span></div>
    <div class="timeline" id="timeline"></div>
    <aside class="side" id="side"></aside></div>`;
  // Re-entering the view rebuilds the timeline from the events so far.
  const events = run.events.slice();
  run.events = []; run.tools = {}; run.results = {}; run.findings = []; run.drafts = [];
  const phase = run.phase;
  events.forEach(apply);
  run.phase = phase;
  renderSide();
  clearInterval(S.clock);
  S.clock = setInterval(() => {
    const el = $("#clock");
    if (!el || !S.run) return clearInterval(S.clock);
    el.textContent = `${Math.round(S.run.t)} s`;
  }, 500);
}

/* ---------------- findings ---------------- */
function facts(r, claimIndex) {
  const d = r.data;
  if (r.tool === "verify_quantity") {
    const rows = [["Design", `${d.design_qty} ${d.unit}(s)`], ["Observed", `${d.observed} (${d.method})`], ["Difference", `${d.difference > 0 ? "+" : ""}${d.difference} (tolerance ±${d.tolerance})`]];
    const short = d.details?.rows_below_the_fullest_row;
    if (short?.length) rows.push(["Short rows", short.map((s) => `row ${s.row}: ${s.count} (−${s.short_by})`).join(", ")]);
    return rows;
  }
  if (r.tool === "check_equipment") return d.fields.filter((f) => f.status !== "match").map((f) => [f.field, `schedule ${f.schedule_value || "—"} · plate ${f.nameplate_value || "—"} · ${f.status}`]);
  if (r.tool === "check_drawing_register") return d.comparison.map((c) => [c.field, `register ${c.register} · title block ${c.title_block}${c.match ? "" : " · differs"}`]);
  if (r.tool === "check_walkthrough" && claimIndex >= 0) {
    const c = d.claims[claimIndex];
    const rows = [["Said at", `${c.t_s.toFixed(1)} s: “${c.claim}”`], ["Verdict", `${c.verdict} (${c.method})`]];
    if (c.sam_count_in_scope !== undefined) rows.push(["Count", `claimed ${c.claimed_count}, SAM counted ${c.sam_count_in_scope} “${c.sam_phrase}”`]);
    rows.push(["Seen", c.evidence_text]);
    return rows;
  }
  return [];
}

function draftHtml(d, open) {
  if (!d) return "";
  const list = (label, xs) => (xs?.length ? `<h5>${label}</h5><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  return `<div class="doc ${open ? "" : "collapsed"}">
    <div class="doc-head"><b>${esc(d.document)} ${esc(d.number)}</b><span class="muted">drafted by ${esc(d.drafted_by)} · for engineer review
      <button class="btn small" style="margin-left:8px" onclick="this.closest('.doc').classList.toggle('collapsed')">Show / hide</button></span></div>
    <div class="doc-body">
      <h5>Location</h5>${esc(d.location)}<h5>Requirement</h5>${esc(d.requirement)}<h5>Condition found</h5>${esc(d.condition_found)}
      <h5>Impact</h5>${esc(d.impact)}<h5>Request</h5>${esc(d.request)}
      ${list("Evidence", d.evidence)}${list("Actions", d.actions)}${list("To be confirmed", d.to_be_confirmed)}
    </div></div>`;
}

function renderFindings() {
  const rep = S.report;
  if (!rep) { location.hash = S.run ? "#/run" : "#/"; return; }
  const drafts = Object.fromEntries((rep.drafts || []).map((d) => [d.finding_id, d]));
  const order = { nonconformance: 0, design_query: 1, reporting_discrepancy: 2 };
  const findings = rep.findings.slice().sort((a, b) => order[a.kind] - order[b.kind]);
  const shown = findings.filter((f) => S.filter === "all" || f.kind === S.filter);
  const ev = rep.evaluation;
  const results = Object.values(rep.results);
  const checks = results.filter((r) => r.tool !== "read_nameplate");
  const img = (id) => {
    const e = rep.evidenceSrc?.[id];
    return e ? `<figure><img src="${e.src}" alt="${esc(id)}" data-zoom data-caption="${esc(id)} · ${esc(e.caption)}"><figcaption>${esc(id)} · ${esc(e.caption)}</figcaption></figure>` : "";
  };
  app.innerHTML = `<div class="results">
    <div class="res-head"><div><p class="muted small" style="margin:0">${esc(rep.finished_at)} · ${rep.mode === "replay" ? "recorded run" : "live run"} · ${rep.seconds}s</p>
      <h1>${esc(rep.project.name)}</h1></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" onclick="location.hash='#/run'">← Timeline</button>
      <button class="btn small" id="dl">Download report.json</button><button class="btn small" onclick="location.hash='#/'">New run</button></div></div>
    <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-top:12px">
      <div class="stat"><b>${checks.length}</b><span>checks run</span></div>
      <div class="stat ok"><b>${checks.filter((r) => r.data.verdict === "pass").length}</b><span>passed</span></div>
      ${Object.entries(KIND).map(([k, v]) => `<div class="stat ${v.stat}"><b>${findings.filter((f) => f.kind === k).length}</b><span>${v.plural.toLowerCase()}</span></div>`).join("")}
      <div class="stat"><b>$${(rep.cost?.total_usd || 0).toFixed(2)}</b><span>model cost${rep.mode === "replay" ? " (when recorded)" : ""}</span></div>
    </div>
    <div class="summary"><b>Agent summary.</b> ${esc(rep.summary)}
      ${ev ? `<p style="margin:10px 0 0"><span class="score">Answer key: ${ev.found}/${ev.expected} planted problems found · ${ev.right_kind} with the right document type · ${ev.extra_findings.length} extra findings · ${ev.passes_wrongly_flagged.length} passes wrongly flagged</span></p>` : ""}</div>
    <div class="tabs">${[["all", `All ${findings.length}`], ...Object.entries(KIND).map(([k, v]) => [k, `${v.doc} · ${v.plural} ${findings.filter((f) => f.kind === k).length}`])]
      .map(([k, label]) => `<button data-f="${k}" class="${S.filter === k ? "on" : ""}">${esc(label)}</button>`).join("")}</div>
    ${shown.map((f, i) => {
      const r = rep.results[f.result_id], d = drafts[f.id];
      return `<article class="fcard ${f.kind}">
        <div class="ev">${f.evidence.map(img).join("")}</div>
        <div>
          <span class="chip ${f.kind}">${esc(d?.number || f.id)} · ${KIND[f.kind].label}</span>
          <h3>${esc(f.title)}</h3><p style="margin:0">${esc(f.explanation)}</p>
          <dl class="facts">${facts(r, f.claim_index).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
          <div class="prov">${esc(r.id)} · ${esc(r.tool)}(${esc(Object.values(r.args).join(", "))}) · ${esc((r.data.models || []).join(", "))} · ${r.seconds}s${r.cached ? " (cached)" : ""}</div>
          ${draftHtml(d, i === 0)}
        </div></article>`;
    }).join("")}
    <details><summary>Every check (${results.length} results)</summary><div class="table-wrap"><table>
      <tr><th>Result</th><th>Check</th><th>Arguments</th><th>Verdict</th><th>Models</th><th>Time</th></tr>
      ${results.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.tool)}</td><td>${esc(Object.values(r.args).join(", "))}</td>
        <td><span class="chip ${verdictClass(r.data.verdict)}">${esc(r.data.verdict)}</span></td><td class="small">${esc((r.data.models || []).join(", "))}</td>
        <td class="small">${r.seconds}s${r.cached ? " cached" : ""}</td></tr>
        ${(r.data.claims || []).map((c) => `<tr><td></td><td class="muted small">claim ${c.claim_index}</td><td class="small">${c.t_s.toFixed(1)} s: “${esc(c.claim)}”</td><td><span class="chip ${verdictClass(c.verdict)}">${esc(c.verdict)}</span></td><td class="small muted">${esc(c.method)}</td><td></td></tr>`).join("")}`).join("")}
    </table></div></details>
    <details><summary>Agent trace (${rep.agent.turns} turns, ${rep.agent.model})</summary><ol class="small">
      ${rep.agent.trace.map((s) => s.type === "note" ? `<li class="muted">turn ${s.turn}: ${esc(s.text)}</li>`
        : `<li>turn ${s.turn}: <span class="mono">${esc(s.tool)}(${esc(Object.entries(s.args).filter(([k]) => k !== "explanation").map(([, v]) => v).join(", ").slice(0, 120))})</span> → ${esc(s.brief)}</li>`).join("")}
    </ol></details>
  </div>`;
  app.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; renderFindings(); }));
  $("#dl").onclick = () => {
    const { evidenceSrc, ...plain } = rep;
    const url = URL.createObjectURL(new Blob([JSON.stringify(plain, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "groundtruth-report.json" }).click();
  };
}

route();
