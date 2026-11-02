/* GroundTruth web app: home (demo package), upload, run (streamed events on a checks board), findings. No framework. */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = $("#app");

const KIND = {
  nonconformance: { label: "Non-conformance", plural: "Non-conformances", doc: "NCR", stat: "ncr", what: "Built work does not match the design.", paper: "Non-Conformance Report" },
  design_query: { label: "Design query", plural: "Design queries", doc: "RFI", stat: "rfi", what: "The design itself is unclear or contradicts itself.", paper: "Request for Information" },
  reporting_discrepancy: { label: "Reporting discrepancy", plural: "Reporting discrepancies", doc: "OBS", stat: "obs", what: "What someone reported is contradicted by the evidence.", paper: "Observation report" },
};
const KINDS = Object.keys(KIND);
const TYPE = { drone_still: ["Drone stills", "Drone still"], nameplate_photo: ["Nameplates", "Nameplate"], drawing_sheet: ["Drawings", "Drawing"], walkthrough_video: ["Narrated walkthrough", "Walkthrough video"] };
const PREFIX = { drone_still: "DRN", nameplate_photo: "NP", drawing_sheet: "DWG", walkthrough_video: "WLK" };
const VERDICT = { pass: "Pass", read: "Read", confirmed: "Confirmed", short: "Short", over: "Over", mismatch: "Mismatch", review: "Review",
  needs_review: "For review", wrong_row: "Wrong row", not_in_register: "Not in register", claims_contradicted: "Claims contradicted",
  contradicted: "Contradicted", cannot_verify: "Can't verify", error: "Error" };
const PASS = new Set(["pass", "read", "confirmed"]);
const REVIEW = new Set(["review", "needs_review", "cannot_verify", "wrong_row", "not_in_register"]);
const tone = (v) => (PASS.has(v) ? "pass" : REVIEW.has(v) ? "review" : "fail");
const FIELD = { equipment_type: "type", model_number: "model", frequency_hz: "frequency", sheet_number: "sheet number" };
const fieldName = (f) => FIELD[f] || f.replace(/_/g, " ");
const METHOD = { objects: "SAM 3.1 object count", tables: "SAM 3.1 table count", modules: "SAM 3.1 tables, then Spark 1.3 module grids", drawing_symbol: "Spark 1.3 points on the sheet" };
const plural = (unit, n) => (!unit ? "" : +n === 1 ? unit : unit + "s");
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "");
function modelName(m) {
  if (/open/i.test(m)) return "Spark Open";
  if (/wonder/i.test(m)) return "Muse Wonder";
  const sam = /^sam-?(.*)$/i.exec(m);
  if (sam) return `SAM ${sam[1]}`.trim();
  const spark = /spark-?([\d.]+)/i.exec(m);
  return spark ? `Spark ${spark[1]}` : m;
}
const modelChips = (ms) => [...new Set((ms || []).map(modelName))].map((m) => `<span class="chip model">${esc(m)}</span>`).join("");

const S = { health: null, pkg: null, run: null, report: null, filter: "all", homeTab: "captures", docTab: "quantities",
  files: [], sched: null, u: { name: "My site check", code: "", quantities: "", register: "", notes: "" }, uploadThumbs: {} };
const liveReady = () => S.health?.keys?.meta !== false;

/* ---------------- lightbox, clicks ---------------- */
function openImage(src, caption) {
  if (!src) return;
  const box = $("#lightbox");
  $("img", box).src = src;
  $("p", box).textContent = caption || "";
  box.hidden = false;
}
$("#lightbox").addEventListener("click", () => ($("#lightbox").hidden = true));
document.addEventListener("keydown", (e) => e.key === "Escape" && ($("#lightbox").hidden = true));

const ACTIONS = {
  live: () => startRun({ mode: "live" }),
  replay: () => startRun({ mode: "replay" }),
  skip: () => S.run && (S.run.skip = true),
  findings: () => (location.hash = "#/findings"),
  "back-run": () => (location.hash = "#/run"),
  "back-upload": () => (location.hash = "#/upload"),
  home: () => (location.hash = "#/"),
  download: downloadReport,
  "toggle-doc": (el) => el.closest(".doc").classList.toggle("open"),
  "copy-doc": copyDraft,
  example: useExample,
  "add-row": () => { S.sched.push({}); renderSched(); },
  "rm-row": (el) => { S.sched.splice(+el.dataset.i, 1); if (!S.sched.length) S.sched.push({}); renderSched(); },
  "load-csv": loadScheduleCsv,
  "rm-file": (el) => { S.files.splice(+el.dataset.i, 1); renderFiles(); },
  "pick-files": () => $("#file-in")?.click(),
  "go-upload": submitUpload,
};
document.addEventListener("click", (e) => {
  const zoom = e.target.closest("[data-zoom]");
  if (zoom) return openImage(zoom.dataset.full || zoom.getAttribute("src"), zoom.dataset.caption || zoom.alt || "");
  const el = e.target.closest("[data-act],[data-tab],[data-doc-tab],[data-f],[data-jump]");
  if (!el || el.disabled) return;
  if (el.dataset.tab) return setHomeTab(el.dataset.tab);
  if (el.dataset.docTab) return setDocTab(el.dataset.docTab);
  if (el.dataset.f) return setFilter(el.dataset.f);
  if (el.dataset.jump) return jumpTo(el.dataset.jump);
  ACTIONS[el.dataset.act]?.(el, e);
});

/* ---------------- routing ---------------- */
window.addEventListener("hashchange", route);
async function route() {
  const hash = location.hash || "#/";
  const page = ["run", "findings", "upload", "how", "plans", "plan/"].find((p) => hash.startsWith(`#/${p}`))?.replace("/", "") || "home";
  $$(".top nav a[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === page || (page === "plan" && a.dataset.nav === "plans")));
  document.body.classList.toggle("studio", page === "plan");
  if (page === "plans" || page === "plan") { window.scrollTo({ top: 0, behavior: "instant" }); return window.GTPlans.route(hash, app); }
  if (page === "run") return renderRun();
  if (page === "findings") return renderFindings();
  if (page === "upload") return renderUpload();
  await renderHome();
  if (page === "how") $("#how")?.scrollIntoView({ behavior: "smooth" });
  else window.scrollTo({ top: 0, behavior: "instant" });
}

async function load() {
  if (!S.health) S.health = await fetch("/api/health").then((r) => r.json()).catch(() => ({}));
  if (!S.pkg) S.pkg = await fetch("/api/packages/demo-solar").then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

function table(rows, cols) {
  if (!rows?.length) return "<p class='muted small'>None in this package.</p>";
  cols = cols || Object.keys(rows[0]);
  return `<div class="table-wrap"><table><tr>${cols.map((c) => `<th>${esc(c.replace(/_/g, " "))}</th>`).join("")}</tr>${rows
    .map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</table></div>`;
}

/* ---------------- home ---------------- */
const RULES = [
  ["The model chooses the checks; code decides the verdict.", "Counts are compared with the design quantity and tolerance, title blocks with the register, plates field by field with the schedule."],
  ["Findings can't be invented.", "A finding must point at a measurement that failed, and takes its facts and images from it. The agent can't finish while a failure has no finding."],
  ["Follow-ups are built in.", "If a plate's manufacturer doesn't match the schedule row the agent picked, it has to try another row. If two models disagree on a count, a person decides."],
  ["Drafts must stay on topic.", "A draft has to name its subject and its measured numbers, or it is written again. Twice wrong, and a plain template is used and labelled."],
];
const MODELS = [
  ["muse-wonder", "The agent: plans the site check, designs and improves floor plans, calls up to 14 tools in one turn."],
  ["sam-3.1", "Counts modules, tables and objects on drone stills, and inside the region a narrated claim is about."],
  ["muse-spark-1.3", "Reads nameplates and title blocks, counts drawing symbols and module grids, judges claims on stills, drafts documents."],
  ["muse-spark-open", "On Baseten: hears and watches each walkthrough clip, and flags where the narration and the picture disagree."],
];
// 5x5 pixel icons: o = accent, m = light accent, anything else = grey
const ICONS = { design: "ooooo" + "o...o" + "o.mmo" + "o...o" + "ooooo", simulate: "..o.." + ".mmm." + "omomo" + ".mmm." + "..o..",
  verify: "....o" + "...om" + "o.om." + ".om.." + "....." };
const dots = (p) => `<div class="dots" aria-hidden="true">${[...p.padEnd(25, ".").slice(0, 25)].map((c) => `<i class="${c === "o" ? "on" : c === "m" ? "mid" : ""}"></i>`).join("")}</div>`;
const win = (label, body, cls = "") => `<div class="win ${cls}"><div class="win-bar"><i></i><i></i><i></i><span class="lbl">[ ${esc(label)} ]</span></div><div class="win-body">${body}</div></div>`;

async function renderHome() {
  if (!S.pkg) app.innerHTML = `<p class="muted" style="padding:80px 0">Loading…</p>`;
  await load();
  const p = S.pkg, live = liveReady();
  app.innerHTML = `
  <section class="hero">
    <div class="hero-grid"></div><div class="hero-glow"></div>
    <span class="tag" style="left:14px;top:16px">[ SITE ]</span><span class="tag" style="right:14px;top:16px">[ DESIGN ]</span>
    <span class="tag" style="left:14px;bottom:24px">[ .NCR ]</span><span class="tag" style="right:14px;bottom:24px">[ VERIFIED ]</span>
    <span class="spark" style="left:calc(50% - 404px);top:105px">✦</span><span class="spark" style="left:calc(50% + 358px);top:105px">✦</span>
    <div class="hero-in">
      <a class="badge" href="#/how">Muse Wonder · Muse Spark · SAM 3.1 <span class="go">›</span></a>
      <h1>From floor plan<br><span class="hl">to verified site</span></h1>
      <p class="lead">Design a building with an AI that measures every step, simulate how it lives, then check the built site against it.
        Every finding comes with its evidence and a drafted report.</p>
      <div class="ctas"><button class="btn primary big" data-act="live" ${live ? "" : "disabled"}>▶ Watch the site check live</button>
        <button class="btn big" data-act="replay">Play a recorded run</button></div>
      ${live ? "" : `<p class="note-off">Live runs are off on this deployment (no API key). The recorded run still works.</p>`}
      <form class="ask" id="ask">
        <textarea id="ask-text" rows="2" maxlength="800" aria-label="Describe a building to design"
          placeholder="Describe a building to design… e.g. a three-bedroom house of about 110 m² with an open kitchen"></textarea>
        <div class="bar"><span>✦ Muse Wonder lays it out, room by room</span><button class="btn primary small" type="submit" ${live ? "" : "disabled"}>Design</button></div>
      </form>
    </div>
  </section>
  <div class="proof">
    <div><b>9<span class="faint">/9</span></b>planted problems found</div>
    <div><b>7<span class="faint">/7</span></b>correct items passed</div>
    <div><b>≈1 min</b>and $0.44 per live site check</div>
    <div><b><span class="hl">4</span></b>Meta models working together</div>
  </div>
  <section class="block" id="how">
    <div class="center"><div class="eyebrow">How it works</div>
      <h2 class="section">Design it, live in it,<br><span class="hl">then prove it was built right</span></h2>
      <p class="lead-c">One plan from the first sketch to handover. The models propose and look; the code measures and decides.</p></div>
    <div class="trio">
      <div>${dots(ICONS.design)}<h3>Design</h3><p>Describe a building or draw it room by room. Muse Wonder lays out rooms, doors and windows; the code refuses overlaps and dead ends.</p>
        <div class="models"><span class="chip model">muse-wonder</span></div><a class="go" href="#/plans">Open the studio ›</a></div>
      <div>${dots(ICONS.simulate)}<h3>Simulate <span class="chip accent">NEW</span></h3><p>Sun through every window over a day, everyone's daily routes, room to move. Scored from the geometry, then improved by the AI.</p>
        <div class="models"><span class="chip model">muse-wonder</span><span class="chip model">geometry</span></div><a class="go" href="#/plans">Simulate a plan ›</a></div>
      <div>${dots(ICONS.verify)}<h3>Verify</h3><p>Drone stills, nameplate photos and a narrated phone walk checked against the design. Every failure becomes a finding with its proof.</p>
        <div class="models"><span class="chip model">sam-3.1</span><span class="chip model">muse-spark-1.3</span><span class="chip model">spark-open</span></div>
        <button class="go" data-act="live" ${live ? "" : "disabled"}>Watch it run live ›</button></div>
    </div>
  </section>
  ${p ? packageSection(p) : ""}
  <section class="block" id="rules">
    <div class="center"><div class="eyebrow">Built to be checked</div>
      <h2 class="section">The model chooses what to check.<br><span class="hl">Code decides the verdict.</span></h2>
      <p class="lead-c">Construction QA has to hold up in a dispute, so every number traces back to a measurement, a model and an image.</p></div>
    <div class="grid2" style="margin-top:36px">
      ${win("rules", `<div class="rules">${RULES.map(([b, t]) => `<p><b>${esc(b)}</b><span class="muted">${esc(t)}</span></p>`).join("")}</div>`)}
      ${win("models", `<div class="table-wrap"><table class="models-table">${MODELS.map(([m, t]) => `<tr><td>${esc(m)}</td><td>${esc(t)}</td></tr>`).join("")}</table></div>
        <p class="small muted" style="margin:14px 0 0">What we measured about each model, including where it failed and how we worked around it, is in the
        <a href="https://github.com/compiler-aditya/groundtruth#how-it-uses-metas-models-and-what-we-learned" target="_blank" rel="noopener">README ›</a></p>`)}
    </div>
  </section>`;
  $("#ask").onsubmit = (e) => {
    e.preventDefault();
    const text = $("#ask-text").value.trim();
    if (text.length < 3) return $("#ask-text").focus();
    window.GTPlans.designFrom(text);
  };
}

function packageSection(p) {
  const n = (t) => p.captures.filter((c) => c.type === t).length;
  const problems = p.planted ? KINDS.reduce((sum, k) => sum + p.planted[k].length, 0) : 0;
  const tabs = [["captures", `What the site captured (${p.captures.length})`], ["design", "The design"], ...(p.planted ? [["key", "Answer key"]] : [])];
  return `<section class="block" id="package">
    <div class="pkg-head">
      <div><div class="eyebrow">Live demo · site check</div>
        <h2 class="section">${problems || "Some"} problems are hidden on this site.<br><span class="hl">Can the agent find them?</span></h2>
        <p class="lead-c">A solar site's design package (quantities, an equipment schedule, a drawing register) against what the site captured:
          ${n("drone_still")} drone stills, ${n("nameplate_photo")} equipment nameplates, ${n("drawing_sheet")} drawing sheets and a narrated phone walk.</p></div>
      <div class="ctas"><button class="btn primary" data-act="live" ${liveReady() ? "" : "disabled"}>▶ Run it live</button>
        <button class="btn" data-act="replay">Play the recorded run</button></div>
    </div>
    ${win(`${p.id || "demo"} · ${p.captures.length} captures · 3 design documents`, `
      <div class="tabs" role="tablist" id="home-tabs">${tabs.map(([k, label]) =>
        `<button role="tab" data-tab="${k}" class="${k === "key" ? "spoiler " : ""}${S.homeTab === k ? "on" : ""}">${esc(label)}</button>`).join("")}</div>
      <div id="tab-body">${homeTab(p)}</div>`)}
  </section>`;
}

function setHomeTab(tab) {
  S.homeTab = tab;
  $$("#home-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("#tab-body").innerHTML = homeTab(S.pkg);
}

function setDocTab(tab) {
  S.docTab = tab;
  $("#tab-body").innerHTML = homeTab(S.pkg);
}

const credit = (c) => (c.license === "own work" ? "Synthetic test image" : [c.credit, c.license].filter(Boolean).join(" · "));
const DOCS = [
  ["quantities", "Quantities", "How many of each thing the design calls for, where, and how to count it."],
  ["schedule", "Equipment schedule", "What every tagged piece of equipment should be: make, model and ratings."],
  ["register", "Drawing register", "The current sheet number, title and revision of every drawing."],
  ["notes", "Site notes", "Design intent in words, which the agent reads for context."],
];

function homeTab(p) {
  if (S.homeTab === "design") {
    const doc = DOCS.find(([k]) => k === S.docTab) || DOCS[0];
    const body = { quantities: () => table(p.quantities), schedule: () => table(p.schedule), register: () => table(p.register),
      notes: () => `<pre class="notes">${esc(p.site_notes)}</pre>` }[doc[0]]();
    return `<div class="tabs sub">${DOCS.map(([k, label]) => `<button data-doc-tab="${k}" class="${doc[0] === k ? "on" : ""}">${label}</button>`).join("")}</div>
      <p class="small muted" style="margin:0 0 10px">${esc(doc[2])}</p>${body}`;
  }
  if (S.homeTab === "key" && p.planted) {
    const k = p.planted;
    return `<p class="small muted" style="margin:0 0 4px">What a correct run should find, written by hand from the samples. Try a run first, then compare.</p>
      <div class="overview">${KINDS.map((kind) => `<div class="ov ${kind}"><h3>${KIND[kind].plural}<span>${k[kind].length}</span></h3><p>${KIND[kind].what}</p>
        ${k[kind].map((x) => `<div class="small key-item"><b>${esc(x.ref)}</b>: ${esc(x.what)}</div>`).join("")}</div>`).join("")}</div>
      <p class="small" style="margin:0"><b>Should pass:</b> ${k.pass.map((x) => `<span class="chip pass">${esc(x)}</span>`).join(" ")}</p>`;
  }
  const groups = ["drone_still", "nameplate_photo", "drawing_sheet"].map((t) => [t, p.captures.filter((c) => c.type === t)]).filter(([, cs]) => cs.length);
  const walk = p.captures.find((c) => c.type === "walkthrough_video");
  return `<div class="groups">${groups.map(([t, cs]) => `<div class="group"><h3>${TYPE[t][0]}</h3><div class="captures">${cs.map((c) => `
      <div class="capture" data-zoom data-full="${esc(c.thumb)}" data-caption="${esc(`${c.id} · ${c.label}${credit(c) ? ` · ${credit(c)}` : ""}`)}">
        <img src="${esc(c.thumb)}" alt="${esc(`${c.id}: ${c.label}`)}" loading="lazy">
        <div class="cap"><b>${esc(c.id)}</b>${esc(c.area || c.label)}<div class="faint tiny">${esc(credit(c))}</div></div>
      </div>`).join("")}</div></div>`).join("")}
    ${walk ? `<div class="group"><h3>${TYPE.walkthrough_video[0]}</h3><div class="walk">
      <video src="${esc(p.walk_video)}" controls preload="none" poster="${esc(walk.thumb)}"></video>
      <div><b>${esc(walk.id)}: ${esc(walk.label)}</b>
        <p class="muted small">Real CC0 drone footage of two agrivoltaic plants (Tobi Kellner) with a scripted narration. Three of the spoken
          claims are false. The agent has to tell which ones from the pictures, and say where in the video it looked.</p>
        <p class="small muted">Spark Open hears and watches each clip; every claim is then re-checked by Spark 1.3 (and SAM 3.1 for counts) on full-resolution stills.</p></div>
    </div></div>` : ""}</div>`;
}

/* ---------------- upload ---------------- */
const SCHED_COLS = ["tag", "equipment_type", "manufacturer", "model_number", "voltage", "power", "phase", "frequency_hz"];
const SCHED_HEAD = ["Tag", "Equipment type", "Manufacturer", "Model", "Voltage", "Power", "Phase", "Hz"];
const SCHED_PH = ["P-101-M", "induction motor", "ABB", "M3BP 160", "400 V", "11 kW", "3", "50"];
const EXAMPLE = [["NP-01", "P-101-M"], ["NP-02", "CH-201-M"], ["NP-03", "CP-301-M"]];

async function renderUpload() {
  await load();
  const h = S.health || {}, max = h.max_files || 8;
  if (!S.sched) S.sched = [{}];
  app.innerHTML = `
  <div class="page-head"><div class="eyebrow">Try your own</div><h1>Check your own photos against your design</h1>
    <p class="muted" style="max-width:760px;margin:0">Upload equipment nameplates, drone stills or drawing sheets and say what the design expects.
    The agent matches each photo to the right design row from what it shows, checks it, and reports what doesn't match.
    A run takes about a minute.</p></div>
  <div class="steps">
    <div class="ustep"><div class="n">1</div><div>
      <h2>Add photos</h2>
      <p class="muted small" style="margin:0 0 10px">Nameplate photos, drone stills taken from straight above, or drawing sheets as PDF. Up to ${max} files;
        photos are shrunk in your browser before upload.${h.video_uploads ? "" : " Video can't be uploaded on this deployment."}</p>
      <div class="drop" id="drop" role="button" tabindex="0" data-act="pick-files"><b>Drop files here</b> or click to choose
        <input type="file" id="file-in" multiple accept="image/*,.pdf,.tif,.tiff${h.video_uploads ? ",video/*" : ""}" hidden></div>
      <div class="files" id="files"></div>
      <p class="small" style="margin:10px 0 0">No photos to hand? <button class="link" data-act="example">Use three example nameplates</button>
        <span class="muted">(with their schedule rows, in a different order, so the agent has to match them)</span></p>
    </div></div>
    <div class="ustep"><div class="n">2</div><div>
      <h2>Say what the design expects</h2>
      <p class="muted small" style="margin:0 0 10px">One row per piece of equipment. Leave a cell empty if the design doesn't specify it.
        The photos don't need to be labelled: the agent works out which plate belongs to which row.</p>
      <div class="table-wrap"><table class="sched"><thead><tr>${SCHED_HEAD.map((x) => `<th>${x}</th>`).join("")}<th></th></tr></thead><tbody id="sched-body"></tbody></table></div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" data-act="add-row">+ Add a row</button></div>
      <details class="more"><summary>Paste the schedule as CSV instead</summary>
        <textarea id="sched-csv" placeholder="${esc(SCHED_COLS.join(","))}&#10;${esc(SCHED_PH.join(","))}"></textarea>
        <button class="btn small" data-act="load-csv" style="margin-top:6px">Load into the table</button> <span class="small" id="csv-msg"></span>
      </details>
      <details class="more"><summary>More design documents (optional): quantities, drawing register, site notes</summary>
        <div class="grid2">
          <div><label class="field" for="u-quantities">Quantities (CSV)</label>
            <textarea id="u-quantities" data-u="quantities" placeholder="item_id,area,description,count_what,unit,design_qty,method,tolerance_pct&#10;Q-1,Block A,PV modules in Block A,solar panel,module,192,objects,0">${esc(S.u.quantities)}</textarea>
            <p class="tiny muted">method: <span class="mono">objects</span> or <span class="mono">tables</span> (SAM count), <span class="mono">modules</span> (SAM tables then Spark grids) on drone stills; <span class="mono">drawing_symbol</span> on drawings.</p></div>
          <div><label class="field" for="u-register">Drawing register (CSV)</label>
            <textarea id="u-register" data-u="register" placeholder="sheet_number,title,current_revision,drawing_id&#10;E-101,FIRST FLOOR POWER PLAN,3,DWG-01">${esc(S.u.register)}</textarea>
            <p class="tiny muted"><span class="mono">drawing_id</span> is the ID shown next to each uploaded drawing in step 1.</p></div>
        </div>
        <label class="field" for="u-notes">Site notes (design intent in words)</label>
        <textarea id="u-notes" data-u="notes" placeholder="## Block A&#10;8 rows of 24 modules…">${esc(S.u.notes)}</textarea>
      </details>
    </div></div>
    <div class="ustep"><div class="n">3</div><div>
      <h2>Run the check</h2>
      <div class="grid2" style="max-width:640px">
        <div><label class="field" for="u-name">Project name</label><input id="u-name" data-u="name" value="${esc(S.u.name)}"></div>
        ${h.upload_code_required ? `<div><label class="field" for="u-code">Access code</label><input id="u-code" data-u="code" value="${esc(S.u.code)}" placeholder="given in the hackathon submission" autocomplete="off"></div>` : ""}
      </div>
      <p class="small" id="u-msg" role="alert" style="color:var(--ncr);min-height:1.2em;margin:10px 0"></p>
      <button class="btn primary big" data-act="go-upload" id="go-upload" ${liveReady() ? "" : "disabled"}>▶ Run the agent on my files</button>
      ${liveReady() ? "" : `<p class="note-off">Live runs are off on this deployment (no API key).</p>`}
    </div></div>
  </div>`;
  const drop = $("#drop"), input = $("#file-in");
  input.onchange = () => { addFiles([...input.files]); input.value = ""; };
  drop.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.click());
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); };
  $$("[data-u]").forEach((el) => (el.oninput = () => (S.u[el.dataset.u] = el.value)));
  renderFiles();
  renderSched();
}

function guessType(file) {
  if (file.type === "application/pdf" || /\.(pdf|tiff?)$/i.test(file.name)) return "drawing_sheet";
  if (file.type.startsWith("video/")) return "walkthrough_video";
  if (/drone|dji|aerial|nadir|ortho/i.test(file.name)) return "drone_still";
  return "nameplate_photo";
}
const idFor = (i) => `${PREFIX[S.files[i].type]}-${String(i + 1).padStart(2, "0")}`;

function addFiles(files) {
  const max = S.health?.max_files || 8;
  for (const f of files) {
    if (S.files.length >= max) { uploadMsg(`Up to ${max} files per run.`); break; }
    S.files.push({ file: f, type: guessType(f), area: "", label: f.name, preview: f.type.startsWith("image/") && !/tiff?$/i.test(f.name) ? URL.createObjectURL(f) : "" });
  }
  renderFiles();
}

function renderFiles() {
  const box = $("#files");
  if (!box) return;
  const types = Object.entries(TYPE).filter(([k]) => k !== "walkthrough_video" || S.health?.video_uploads);
  box.innerHTML = S.files.map((f, i) => `
    <div class="file-row">
      ${f.preview ? `<img src="${f.preview}" alt="" data-zoom data-caption="${esc(f.file.name)}">` : `<div class="ph">${esc(f.file.name.split(".").pop().toUpperCase())}</div>`}
      <div class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b class="mono">${idFor(i)}</b> ${esc(f.file.name)}<br>
        <span class="faint">${(f.file.size / 1e6).toFixed(1)} MB</span></div>
      <select data-i="${i}" data-k="type" aria-label="What this file is">${types.map(([k, v]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${v[1]}</option>`).join("")}</select>
      <input class="area" data-i="${i}" data-k="area" placeholder="Area (e.g. Block A)" value="${esc(f.area)}" aria-label="Area">
      <button class="icon-btn" data-act="rm-file" data-i="${i}" title="Remove" aria-label="Remove ${esc(f.file.name)}">×</button>
    </div>`).join("");
  $$("[data-k]", box).forEach((el) => (el.oninput = () => {
    S.files[+el.dataset.i][el.dataset.k] = el.value;
    if (el.dataset.k === "type") renderFiles(); // the ID prefix follows the type
  }));
}

function renderSched() {
  const body = $("#sched-body");
  if (!body) return;
  body.innerHTML = S.sched.map((r, i) => `<tr>${SCHED_COLS.map((c, j) => `<td><input data-r="${i}" data-c="${c}" value="${esc(r[c] || "")}" placeholder="${esc(SCHED_PH[j])}" aria-label="${SCHED_HEAD[j]}, row ${i + 1}"></td>`).join("")}
    <td><button class="icon-btn" data-act="rm-row" data-i="${i}" title="Remove row" aria-label="Remove row ${i + 1}">×</button></td></tr>`).join("");
  $$("input", body).forEach((el) => (el.oninput = () => (S.sched[+el.dataset.r][el.dataset.c] = el.value)));
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return head ? body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()]))) : [];
}
const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(String(r[c] ?? "").trim())).join(","))].join("\n");

function loadScheduleCsv() {
  const rows = parseCsv($("#sched-csv").value);
  if (!rows.length || !("tag" in rows[0])) { $("#csv-msg").textContent = "Needs a header row with at least a tag column."; return; }
  S.sched = rows;
  renderSched();
  $("#csv-msg").textContent = `Loaded ${rows.length} rows.`;
}

async function useExample() {
  const max = S.health?.max_files || 8;
  if (S.files.length + EXAMPLE.length > max) return uploadMsg(`Remove a file first: up to ${max} files per run.`);
  try {
    for (const [id] of EXAMPLE) {
      const res = await fetch(`/examples/${id}.jpg`);
      if (!res.ok) throw new Error();
      const file = new File([await res.blob()], `example-nameplate-${id.slice(-1)}.jpg`, { type: "image/jpeg" });
      S.files.push({ file, type: "nameplate_photo", area: "Equipment yard", label: "Nameplate photo", preview: URL.createObjectURL(file) });
    }
  } catch {
    return uploadMsg("The example photos aren't available on this deployment.");
  }
  const tags = EXAMPLE.map(([, tag]) => tag).reverse();
  const rows = tags.map((tag) => (S.pkg?.schedule || []).find((r) => r.tag === tag)).filter(Boolean).map((r) => ({ ...r }));
  S.sched = [...S.sched.filter((r) => SCHED_COLS.some((c) => r[c]?.trim()) && !tags.includes(r.tag)), ...rows];
  if (S.u.name === "My site check") S.u.name = "Example: three motor nameplates";
  renderUpload();
  uploadMsg("");
}

function uploadMsg(text) {
  const el = $("#u-msg");
  if (el) el.textContent = text;
}

async function shrink(file, maxSide = 2000) {
  if (!file.type.startsWith("image/") || /tiff?$/i.test(file.name)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === "image/jpeg" && file.size < 1.5e6) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

async function submitUpload() {
  const h = S.health || {};
  const sched = S.sched.filter((r) => SCHED_COLS.some((c) => r[c]?.trim()));
  if (!S.files.length) return uploadMsg("Add at least one photo or drawing in step 1.");
  if (sched.some((r) => !r.tag?.trim())) return uploadMsg("Every schedule row needs a tag.");
  if (!sched.length && !S.u.quantities.trim() && !S.u.register.trim()) return uploadMsg("Add at least one design row in step 2, so there is something to check the photos against.");
  if (h.upload_code_required && !S.u.code.trim()) return uploadMsg("Enter the access code.");
  const btn = $("#go-upload");
  btn.disabled = true;
  btn.textContent = "Preparing files…";
  const form = new FormData();
  form.append("name", S.u.name);
  form.append("schedule_csv", sched.length ? toCsv(sched, SCHED_COLS) : "");
  form.append("quantities_csv", S.u.quantities);
  form.append("register_csv", S.u.register);
  form.append("site_notes", S.u.notes);
  form.append("code", S.u.code.trim());
  form.append("meta", JSON.stringify(S.files.map((f) => ({ type: f.type, area: f.area, label: f.label }))));
  let total = 0;
  S.uploadThumbs = {};
  for (const [i, f] of S.files.entries()) {
    const small = await shrink(f.file);
    total += small.size;
    form.append("files", small);
    if (f.preview) S.uploadThumbs[idFor(i)] = f.preview;
  }
  if (total > 4.3e6) {
    btn.disabled = false;
    btn.textContent = "▶ Run the agent on my files";
    return uploadMsg(`The files come to ${(total / 1e6).toFixed(1)} MB after shrinking; this host accepts about 4.5 MB per run. Remove a file or use a smaller PDF.`);
  }
  startRun({ mode: "upload", form });
}

/* ---------------- run: state ---------------- */
const GROUPS = [
  ["quantities", "Quantities", "Counted on drone stills and drawings, then compared with the design quantity and tolerance."],
  ["equipment", "Equipment nameplates", "Each plate is read, matched to a schedule row by what it shows, and compared field by field."],
  ["drawings", "Drawing register", "Each sheet's title block is read and compared with the register."],
  ["walk", "Narrated walkthrough", "Each spoken claim is checked against what the video shows."],
];
const STEPS = [
  ["Read the package", "Muse Wonder"], ["Run the checks", "SAM 3.1 · Spark 1.3 · Spark Open"],
  ["Record findings", "only on failed checks"], ["Draft documents", "Spark 1.3, grounding-checked"], ["Report ready", "with evidence"],
];
const STATUS = ["Muse Wonder is reading the package…", "Running the checks…", "Recording findings…", "Drafting documents…", "Finished"];
const TOOL_CARD = {
  verify_quantity: (a) => [`q:${a.item_id}`, "quantities", a.item_id],
  read_nameplate: (a) => [`np:${a.capture_id}`, "equipment", a.capture_id],
  check_equipment: (a) => [`np:${a.capture_id}`, "equipment", a.capture_id],
  check_drawing_register: (a) => [`dwg:${a.drawing_id}`, "drawings", a.drawing_id],
  check_walkthrough: (a) => [`wlk:${a.capture_id}`, "walk", a.capture_id],
};
const RUNNING = { verify_quantity: "Counting", read_nameplate: "Reading the plate", check_equipment: "Comparing with the schedule",
  check_drawing_register: "Reading the title block", check_walkthrough: "Listening and watching" };
const NOUN = { verify_quantity: ["count", "counts"], read_nameplate: ["plate read", "plate reads"], check_equipment: ["schedule comparison", "schedule comparisons"],
  check_drawing_register: ["register check", "register checks"], check_walkthrough: ["walkthrough review", "walkthrough reviews"],
  record_finding: ["finding", "findings"], finish: ["finish", "finish"] };

function newRun(mode) {
  return { mode, cards: {}, order: [], resultKey: {}, results: {}, evidence: {}, findings: [], draftOf: {}, turns: {}, feed: [], feedIndex: {},
    step: 0, turn: 0, agentCost: 0, t: 0, began: performance.now(), report: null, error: null, name: "", info: null, skip: false, seq: 0 };
}

function startRun({ mode, form }) {
  S.run = newRun(mode);
  S.report = null;
  S.filter = "all";
  location.hash = "#/run";
  renderRun();
  if (mode === "replay") return replay("/replays/demo-solar.ndjson");
  const req = mode === "upload"
    ? fetch("/api/run-upload", { method: "POST", body: form })
    : fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: "demo-solar" }) });
  readStream(req, S.run);
}

async function readStream(request, run) {
  try {
    const res = await request;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return apply({ type: "error", message: body.detail || `The server answered ${res.status}.` }, run);
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
        if (line) apply(JSON.parse(line), run);
      }
    }
    if (!run.report && !run.error) apply({ type: "error", message: "The connection closed before the run finished." }, run);
  } catch (err) {
    apply({ type: "error", message: String(err.message || err) }, run);
  }
}

async function replay(url) {
  const run = S.run;
  let text = "";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("There is no recorded run on this deployment.");
    text = await res.text();
  } catch (err) {
    return apply({ type: "error", message: err.message }, run);
  }
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type !== "ping");
  let last = 0;
  for (const ev of events) {
    if (S.run !== run) return; // a new run replaced this one
    const gap = Math.min(Math.max(ev.t - last, 0), 2.2); // keep the rhythm, skip long waits, stagger simultaneous events
    last = ev.t;
    if (!run.skip) await sleep(Math.max(gap, 0.06) * 1000);
    apply(ev, run);
  }
}

function ensureCard(key, group, id) {
  const run = S.run;
  if (!run.cards[key]) {
    run.cards[key] = { key, group, id, status: "waiting", res: {}, checks: [], findings: [], last: null, capture: null, running: null, note: "" };
    run.order.push(key);
  }
  return run.cards[key];
}

function seedCards(info) {
  for (const q of info?.quantities || []) ensureCard(`q:${q.item_id}`, "quantities", q.item_id);
  for (const c of info?.captures || []) {
    if (c.type === "nameplate_photo") ensureCard(`np:${c.id}`, "equipment", c.id);
    if (c.type === "drawing_sheet") ensureCard(`dwg:${c.id}`, "drawings", c.id);
    if (c.type === "walkthrough_video") ensureCard(`wlk:${c.id}`, "walk", c.id);
  }
}

function apply(ev, run = S.run) {
  if (!run || run !== S.run || ev.type === "ping") return;
  if (typeof ev.t === "number") run.t = ev.t;
  const touched = new Set();
  switch (ev.type) {
    case "start":
      run.name = ev.name || run.name;
      run.info = ev.package_info || (ev.package === "demo-solar" ? S.pkg : null);
      seedCards(run.info);
      run.order.forEach((k) => touched.add(k));
      break;
    case "note":
      feed(`note-${run.seq++}`, `<div class="msg">${esc(ev.text)}</div>`);
      break;
    case "turn":
      run.turn = ev.turn;
      run.step = Math.max(run.step, 1);
      run.agentCost = ev.agent_cost_usd ?? run.agentCost;
      run.turns[ev.turn] = { calls: {}, expected: ev.calls, thinking: ev.thinking_s };
      feed(`turn-${ev.turn}`, turnHtml(ev.turn));
      break;
    case "tool_start": {
      const turn = run.turns[ev.turn];
      if (turn) { turn.calls[ev.tool] = (turn.calls[ev.tool] || 0) + 1; feed(`turn-${ev.turn}`, turnHtml(ev.turn)); }
      if (ev.tool === "record_finding") run.step = Math.max(run.step, 2);
      const spec = TOOL_CARD[ev.tool];
      if (!spec) break;
      const [key, group, id] = spec(ev.args || {});
      const c = ensureCard(key, group, id);
      c.status = "running";
      c.running = ev.tool;
      if (ev.tool === "verify_quantity") c.capture = ev.args.capture_id;
      touched.add(key);
      break;
    }
    case "tool_end": {
      Object.assign(run.evidence, ev.evidence || {});
      const refused = String(ev.brief || "").startsWith("error");
      if (ev.finding) {
        const f = ev.finding;
        run.findings.push(f);
        const key = run.resultKey[f.result_id];
        if (key) { run.cards[key].findings.push(f); touched.add(key); }
        feed(`f-${f.id}`, `<div class="ev"><span class="chip ${f.kind}">${KIND[f.kind].doc}</span><span>Recorded: ${esc(f.title)}</span></div>`);
        break;
      }
      if (ev.tool === "record_finding" || ev.tool === "finish") {
        if (refused) {
          const why = ev.brief.replace(/^error:\s*/, "");
          feed(`g-${run.seq++}`, `<div class="ev"><span class="chip review">Guard</span><span>${ev.tool === "finish"
            ? "Muse Wonder tried to finish; GroundTruth refused: " : "A finding was refused: "}${esc(why)}</span></div>`);
        }
        break;
      }
      const spec = TOOL_CARD[ev.tool];
      if (!spec) break;
      const [key, group, id] = spec(ev.args || {});
      const c = ensureCard(key, group, id);
      c.running = null;
      const r = ev.result;
      if (!r || refused || ev.error) {
        c.note = `${RUNNING[ev.tool] || ev.tool} failed: ${String(ev.error || ev.brief || "no result").replace(/^error:\s*/, "")}`;
        c.status = c.last ? "done" : "error";
      } else {
        run.results[r.id] = r;
        run.resultKey[r.id] = key;
        c.res[r.tool] = r;
        if (r.tool === "check_equipment") c.checks.push(r);
        c.last = r.tool === "read_nameplate" && c.res.check_equipment ? c.res.check_equipment : r;
        c.status = "done";
        c.note = "";
      }
      touched.add(key);
      break;
    }
    case "drafting":
      run.step = Math.max(run.step, 3);
      feed("drafting", `<div class="turn">Drafting</div><div class="ev">${esc(modelName(ev.model))} is writing ${ev.count} documents. Each must name its subject and its measured numbers, or it is written again.</div>`);
      break;
    case "draft": {
      const d = ev.draft;
      run.draftOf[d.finding_id] = d;
      const f = run.findings.find((x) => x.id === d.finding_id);
      const key = f && run.resultKey[f.result_id];
      if (key) touched.add(key);
      feed(`d-${d.finding_id}`, `<div class="ev"><span class="chip ${f?.kind || ""}">${esc(d.number)}</span><span>${esc(d.title || f?.title || "")}${
        d.drafted_by === "template" ? " (template)" : d.attempts > 1 ? " (second attempt)" : ""}</span></div>`);
      break;
    }
    case "done":
      run.step = 5;
      Object.assign(run.evidence, ev.evidence || {});
      run.report = ev.report;
      S.report = { ...ev.report, evidenceSrc: run.evidence, mode: run.mode };
      for (const f of ev.report.findings || []) if (!run.findings.some((x) => x.id === f.id)) run.findings.push(f);
      run.order.forEach((k) => touched.add(k)); // unchecked cards now read "not checked"
      feed("done", `<div class="turn">Report ready</div><div class="ev">${ev.report.findings.length} findings, ${(ev.report.drafts || []).length} drafts, in ${ev.report.seconds} s.</div>`);
      break;
    case "error":
      run.error = ev.message;
      feed(`err-${run.seq++}`, `<div class="ev" style="color:var(--ncr)">Stopped: ${esc(ev.message)}</div>`);
      break;
  }
  touched.forEach(paintCard);
  paintChrome();
}

function turnHtml(n) {
  const t = S.run.turns[n];
  const parts = Object.entries(t.calls).map(([tool, c]) => `${c} ${(NOUN[tool] || [tool, tool])[c > 1 ? 1 : 0]}`);
  const total = Object.values(t.calls).reduce((a, b) => a + b, 0);
  const what = !t.expected ? "Replied without calling a tool." : `${total > 1 ? `${total} tool calls at once` : "1 tool call"}${parts.length ? ": " + parts.join(" · ") : ""}`;
  return `<div class="turn">Turn ${n} · thought for ${t.thinking}s</div><div class="ev">${esc(what)}</div>`;
}

function feed(id, html) {
  const run = S.run;
  let entry = run.feedIndex[id];
  if (entry) entry.html = html;
  else { entry = { id, html }; run.feed.push(entry); run.feedIndex[id] = entry; }
  paintFeed(entry);
}

/* ---------------- run: plain-language results ---------------- */
function plain(r) {
  const d = r.data;
  switch (r.tool) {
    case "verify_quantity": {
      if (d.verdict === "pass") return d.difference
        ? `Counted ${d.observed} ${plural(d.unit, d.observed)} on ${d.capture_id} against ${d.design_qty} designed: ${signed(d.difference)}, within the ±${d.tolerance} tolerance.`
        : `Counted ${d.observed} of ${d.design_qty} ${plural(d.unit, d.design_qty)} on ${d.capture_id}: matches the design.`;
      return `Counted ${d.observed} ${plural(d.unit, d.observed)} on ${d.capture_id}; the design says ${d.design_qty}. That's ${Math.abs(d.difference)} ${d.verdict === "short" ? "short" : "over"}${d.tolerance ? ` (tolerance ±${d.tolerance})` : ""}.`;
    }
    case "read_nameplate": {
      const name = [d.manufacturer, d.model_number].filter(Boolean).join(" ") || "the plate";
      const unread = d.unreadable_fields?.length ? ` ${d.unreadable_fields.length} fields unreadable.` : "";
      return `Read ${name}.${unread} Next: compare it with the schedule.`;
    }
    case "check_equipment": {
      if (d.verdict === "pass") return `Matches schedule row ${d.schedule_tag}.`;
      if (d.verdict === "wrong_row") return `Not schedule row ${d.schedule_tag}: the manufacturer differs, so the agent has to pick another row.`;
      const bad = (d.fields || []).filter((f) => f.status === "mismatch");
      if (bad.length) return `Differs from row ${d.schedule_tag}: ${bad.map((f) => `${fieldName(f.field)} is ${f.nameplate_value || "?"} on the plate, ${f.schedule_value || "?"} in the schedule`).join("; ")}.`;
      return `Row ${d.schedule_tag}: ${d.summary}`;
    }
    case "check_drawing_register": {
      const tb = d.title_block || {};
      if (d.verdict === "not_in_register") return `Sheet ${tb.sheet_number || "?"} is not in the drawing register.`;
      if (d.verdict === "pass") {
        const rev = (d.comparison || []).find((c) => c.field === "revision")?.title_block;
        return `Title block matches the register: sheet ${tb.sheet_number}, ${rev && rev !== "(none)" ? `revision ${rev}` : "no revision"}.`;
      }
      const bad = (d.comparison || []).filter((c) => !c.match);
      return `Differs from the register: ${bad.map((c) => `${fieldName(c.field)} ${c.title_block} on the sheet, ${c.register} in the register`).join("; ")}.`;
    }
    case "check_walkthrough": {
      const n = (v) => d.claims.filter((c) => c.verdict === v).length;
      const other = d.claims.length - n("confirmed") - n("contradicted");
      return `${d.claims.length} spoken claims: ${n("confirmed")} confirmed, ${n("contradicted")} contradicted${other ? `, ${other} for a person to review` : ""}.`;
    }
  }
  return r.brief || "";
}

function firstEvidence(r) {
  const id = r?.evidence?.[0];
  const e = id && S.run.evidence[id];
  return e ? { src: e.src, caption: `${id} · ${e.caption}` } : null;
}

function describe(c) {
  const info = S.run.info || {};
  const cap = (id) => (info.captures || []).find((x) => x.id === id);
  const thumbOf = (id) => cap(id)?.thumb || S.uploadThumbs[id] || "";
  const o = { verdict: c.last?.data?.verdict, models: c.last?.data?.models || [], text: c.last ? plain(c.last) : "", thumb: "", caption: "" };
  if (c.group === "quantities") {
    const q = (info.quantities || []).find((x) => x.item_id === c.id) || {};
    const d = c.res.verify_quantity?.data || {};
    const qty = q.design_qty ?? d.design_qty, unit = q.unit || d.unit;
    o.title = q.description || d.description || c.id;
    o.sub = `${c.id} · design ${qty ?? "?"} ${plural(unit, qty)}${+q.tolerance_pct ? ` ±${q.tolerance_pct}%` : ""}${c.capture ? ` · on ${c.capture}` : ""}`;
    o.icon = "🔢";
    const ev = firstEvidence(c.res.verify_quantity);
    o.thumb = ev?.src || (c.capture ? thumbOf(c.capture) : "");
    o.caption = ev?.caption || c.capture || "";
  } else if (c.group === "equipment") {
    const read = c.res.read_nameplate?.data;
    const scheduled = c.last?.tool === "check_equipment" && c.last.data.verdict !== "wrong_row"
      && (c.last.data.fields || []).find((f) => f.field === "equipment_type")?.schedule_value;
    const kind = scheduled || read?.equipment_type;
    o.title = `${c.id} · ${kind ? sentence(kind) : "nameplate"}`;
    o.sub = read ? [read.manufacturer, read.model_number].filter(Boolean).join(" ") || "plate read" : cap(c.id)?.area || "";
    if (c.res.check_equipment) o.sub += ` · vs. row ${c.res.check_equipment.data.schedule_tag}`;
    const tried = c.checks.filter((r) => r.data.verdict === "wrong_row" && r !== c.last).map((r) => r.data.schedule_tag);
    if (tried.length) o.text = `Tried row ${tried.join(", ")} first: wrong manufacturer. ${o.text}`;
    o.icon = "🏷️";
    o.thumb = thumbOf(c.id) || firstEvidence(c.res.read_nameplate)?.src || "";
    o.caption = `${c.id} · ${cap(c.id)?.label || "nameplate"}`;
  } else if (c.group === "drawings") {
    const tb = c.res.check_drawing_register?.data?.title_block;
    o.title = `${c.id}${tb?.sheet_number ? ` · sheet ${tb.sheet_number}` : ""}`;
    o.sub = tb?.sheet_title || cap(c.id)?.label || "";
    o.icon = "📐";
    const ev = firstEvidence(c.res.check_drawing_register);
    o.thumb = ev?.src || thumbOf(c.id);
    o.caption = ev?.caption || c.id;
  } else {
    o.title = `${c.id} · ${cap(c.id)?.label || "walkthrough"}`;
    o.sub = cap(c.id)?.area || "";
    o.icon = "🎥";
    o.thumb = thumbOf(c.id);
    o.caption = c.id;
    o.claims = c.res.check_walkthrough?.data?.claims;
  }
  return o;
}

function cardHtml(c, fresh) {
  const run = S.run, o = describe(c), finished = !!(run.report || run.error);
  let chip, cls;
  if (c.status === "running") { chip = `<span class="chip running"><span class="spin"></span>${esc(RUNNING[c.running] || "Checking")}</span>`; cls = "running"; }
  else if (c.status === "error") { chip = `<span class="chip fail">Error</span>`; cls = "fail"; }
  else if (c.status === "waiting") { chip = `<span class="chip">${finished ? "Not checked" : "Waiting"}</span>`; cls = "waiting"; }
  else { chip = `<span class="chip ${tone(o.verdict)}">${esc(VERDICT[o.verdict] || o.verdict)}</span>`; cls = tone(o.verdict); }
  const findings = c.findings.filter((f) => f.claim_index === -1 || f.claim_index === undefined || !o.claims);
  const fchips = findings.map((f) => `<span class="chip ${f.kind}">${esc(run.draftOf[f.id]?.number || KIND[f.kind].doc)} ${run.draftOf[f.id] ? "drafted" : "recorded"}</span>`).join("");
  const claimFinding = (i) => c.findings.find((f) => f.claim_index === i);
  const claims = o.claims ? `<div class="claims">${o.claims.map((cl) => {
    const f = claimFinding(cl.claim_index);
    const e = cl.evidence && run.evidence[cl.evidence];
    return `<div class="claim"><span class="chip ${tone(cl.verdict)}">${esc(VERDICT[cl.verdict] || cl.verdict)}</span>
      <div><span class="faint at">${cl.t_s.toFixed(1)} s</span> “${esc(cl.claim)}”${f ? ` <span class="chip ${f.kind}">${esc(run.draftOf[f.id]?.number || KIND[f.kind].doc)}</span>` : ""}</div>
      ${e ? `<img src="${e.src}" alt="" data-zoom data-caption="${esc(`${cl.evidence} · ${e.caption} · “${cl.claim}”`)}">` : "<span></span>"}</div>`;
  }).join("")}</div>` : "";
  const thumb = o.thumb ? `<img class="th" src="${o.thumb}" alt="" data-zoom data-caption="${esc(o.caption)}">` : `<div class="th" aria-hidden="true">${o.icon}</div>`;
  return `<div class="card ${cls}${fresh ? " new" : ""}" id="${cardId(c.key)}">${thumb}<div>
    <div class="t">${esc(o.title)}</div>${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ""}
    ${o.text && c.status !== "waiting" ? `<div class="f">${esc(o.text)}</div>` : ""}${c.note ? `<div class="note">${esc(c.note)}</div>` : ""}
    <div class="row">${chip}${fchips}${c.status === "done" ? modelChips(o.models) : ""}</div></div>${claims}</div>`;
}
const cardId = (key) => `card-${key.replace(/[^\w-]/g, "_")}`;

/* ---------------- run: painting ---------------- */
function setHtml(el, html) {
  if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
}

function paintCard(key) {
  const run = S.run, c = run?.cards[key], grp = c && $(`#grp-${c.group}`);
  if (!grp) return;
  grp.hidden = false;
  $("#empty")?.remove();
  const el = document.getElementById(cardId(key));
  if (el) el.outerHTML = cardHtml(c, false);
  else $(".cards", grp).insertAdjacentHTML("beforeend", cardHtml(c, true));
  const cards = Object.values(run.cards).filter((x) => x.group === c.group);
  $(".count", grp).textContent = `${cards.filter((x) => x.status === "done").length} of ${cards.length} checked`;
}

function paintFeed(entry) {
  const box = $("#feed");
  if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  const html = `<div id="fe-${entry.id}">${entry.html}</div>`;
  const el = document.getElementById(`fe-${entry.id}`);
  if (el) el.outerHTML = html;
  else box.insertAdjacentHTML("beforeend", html);
  if (near) box.scrollTop = box.scrollHeight;
}

function counts(run) {
  const checks = Object.values(run.results).filter((r) => r.tool !== "read_nameplate");
  const by = (k) => run.findings.filter((f) => f.kind === k).length;
  return { checks: checks.length, passed: checks.filter((r) => r.data.verdict === "pass").length, ncr: by("nonconformance"), rfi: by("design_query"), obs: by("reporting_discrepancy") };
}

function paintChrome() {
  const run = S.run;
  if (!run || !$("#stepper")) return;
  const finished = !!(run.report || run.error);
  $("#run-title").textContent = run.name || (run.mode === "upload" ? S.u.name : S.pkg?.name) || "Verification run";
  $("#pulse").classList.toggle("off", finished);
  $("#status").textContent = run.error ? "Stopped" : STATUS[Math.min(run.step, 4)];
  $("#agent-status").textContent = run.error ? "stopped" : run.report ? `finished in ${run.turn} turns` : run.turn ? `turn ${run.turn}` : "reading the package";
  const cost = run.report ? run.report.cost?.total_usd : run.agentCost;
  $("#cost").textContent = run.mode === "replay" ? "free replay" : `$${(cost || 0).toFixed(2)}${run.report ? "" : " so far"}`;
  setHtml($("#skip"), run.mode === "replay" && !finished && !run.skip ? `<button class="btn small" data-act="skip">Skip to the end ⏩</button>` : "");
  setHtml($("#stepper"), STEPS.map(([title, sub], i) => `<div class="st ${i < run.step ? "done" : i === run.step && !run.error ? "now" : ""}">
    <b>${i < run.step ? "✓ " : ""}${esc(title)}</b><span>${esc(sub)}</span></div>`).join(""));
  const c = counts(run);
  setHtml($("#tally"), `<div><b>${c.checks}</b><span>checks done</span></div><div><b style="color:var(--pass)">${c.passed}</b><span>passed</span></div>
    <div><b>${run.findings.length}</b><span>findings</span></div>
    <div class="ncr" title="Non-conformances"><b>${c.ncr}</b><span>NCRs</span></div><div class="rfi" title="Design queries"><b>${c.rfi}</b><span>RFIs</span></div>
    <div class="obs" title="Reporting discrepancies"><b>${c.obs}</b><span>observations</span></div>`);
  let banner = "";
  if (run.report) banner = doneCard(run.report);
  else if (run.error) banner = `<div class="error-card"><b>The run stopped.</b> ${esc(run.error)}
    <div class="ctas" style="margin-top:10px">${run.mode !== "replay" ? `<button class="btn small" data-act="replay">Play the recorded run instead</button>` : ""}
    ${run.mode === "upload" ? `<button class="btn small" data-act="back-upload">← Back to your files</button>` : ""}
    <button class="btn small" data-act="home">Home</button></div></div>`;
  setHtml($("#run-banner"), banner);
  setHtml($("#side-cta"), run.report ? `<button class="btn primary" style="width:100%" data-act="findings">See the findings, evidence and drafts →</button>` : "");
}

function doneCard(rep) {
  const ev = rep.evaluation;
  const checks = Object.values(rep.results).filter((r) => r.tool !== "read_nameplate").length;
  return `<div class="done-card"><h3>✓ Finished in ${rep.seconds} s: ${rep.findings.length} findings from ${checks} checks</h3>
    ${ev ? `<p class="small" style="margin:0 0 10px"><b>Answer key:</b> ${ev.found} of ${ev.expected} planted problems found, ${ev.right_kind} with the right
      document type, ${ev.extra_findings.length} extra findings, ${ev.passes_wrongly_flagged.length} correct items wrongly flagged.</p>` : ""}
    <button class="btn primary" data-act="findings">See the findings, evidence and drafts →</button></div>`;
}

function renderRun() {
  const run = S.run;
  if (!run) { location.hash = "#/"; return; }
  app.innerHTML = `
  <div class="run-top"><span class="pulse" id="pulse"></span><h1 id="run-title"></h1>
    <span class="chip ${run.mode === "replay" ? "" : "accent"}">${run.mode === "replay" ? "Recorded run" : run.mode === "upload" ? "Live · your files" : "Live"}</span>
    <div class="meta"><span id="status"></span><span>⏱ <b id="clock">0 s</b></span><span><b id="cost"></b></span><span id="skip"></span></div></div>
  <div class="stepper" id="stepper"></div>
  <div class="run">
    <div class="board"><div id="run-banner"></div>
      ${GROUPS.map(([id, title, text]) => `<div class="grp" id="grp-${id}" hidden><h3>${title} <span class="count"></span></h3>
        <p class="small muted" style="margin:-6px 0 10px">${text}</p><div class="cards"></div></div>`).join("")}
      <div class="empty-board" id="empty"><span class="spin"></span> Waiting for the agent's plan…</div></div>
    <aside class="side">
      <div class="tally" id="tally"></div>
      <div class="agent"><div class="hd"><div class="av">W</div><div><b>Muse Wonder</b> <span class="tiny muted">the agent</span>
        <div class="tiny muted" id="agent-status"></div></div></div><div class="feed" id="feed" aria-live="polite"></div></div>
      <div id="side-cta"></div>
    </aside>
  </div>`;
  run.order.forEach(paintCard);
  run.feed.forEach(paintFeed);
  paintChrome();
  clearInterval(S.clock);
  S.clock = setInterval(() => {
    const el = $("#clock");
    if (!el || !S.run) return clearInterval(S.clock);
    const r = S.run, live = r.mode !== "replay" && !r.report && !r.error;
    el.textContent = `${Math.round(r.report ? r.report.seconds : live ? Math.max(r.t, (performance.now() - r.began) / 1000) : r.t)} s`;
  }, 250);
}

/* ---------------- findings ---------------- */
function facts(r, claimIndex) {
  const d = r.data;
  let rows = [];
  if (r.tool === "verify_quantity") {
    rows = [["Design", `${d.design_qty} ${plural(d.unit, d.design_qty)}`], ["Counted", `${d.observed} on ${d.capture_id} (${METHOD[d.method] || d.method})`],
      ["Difference", `${signed(d.difference)} (tolerance ±${d.tolerance})`]];
    const short = d.details?.rows_below_the_fullest_row;
    if (short?.length) rows.push(["Short rows", short.map((s) => `row ${s.row}: ${s.count} (−${s.short_by})`).join(", ")]);
  } else if (r.tool === "check_equipment") {
    rows = [["Schedule row", d.schedule_tag], ...(d.fields || []).filter((f) => !["match", "acceptable"].includes(f.status))
      .map((f) => [sentence(fieldName(f.field)), `plate ${f.nameplate_value || "—"} · schedule ${f.schedule_value || "—"} (${f.status.replace(/_/g, " ")})`])];
  } else if (r.tool === "check_drawing_register") {
    rows = (d.comparison || []).map((c) => [sentence(fieldName(c.field)), `sheet ${c.title_block} · register ${c.register}${c.match ? "" : " (differs)"}`]);
  } else if (r.tool === "check_walkthrough" && claimIndex >= 0) {
    const c = d.claims.find((x) => x.claim_index === claimIndex) || d.claims[claimIndex];
    rows = [["Said at", `${c.t_s.toFixed(1)} s: “${c.claim}”`], ["Checked by", c.method]];
    if (c.sam_count_in_scope !== undefined) rows.push(["Count", `claimed ${c.claimed_count}, SAM 3.1 counted ${c.sam_count_in_scope} “${c.sam_phrase}”`]);
    if (c.evidence_text) rows.push(["Seen", c.evidence_text]);
  }
  return rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
}

function draftHtml(d) {
  const list = (label, xs) => (xs?.length ? `<h5>${label}</h5><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  const by = d.drafted_by === "template" ? "a plain template (the model's drafts failed the grounding check)" : `${modelName(d.drafted_by)}${d.attempts > 1 ? " at the second attempt" : ""}`;
  return `<div class="doc"><button type="button" data-act="toggle-doc"><span><b>📄 ${esc(d.number)} · ${esc(d.document)}</b><br>
      <span class="muted small">Drafted by ${esc(by)}, for an engineer to review and sign</span></span><span class="arrow" aria-hidden="true">▸</span></button>
    <div class="doc-body">
      <h5>Location</h5>${esc(d.location)}<h5>Requirement</h5>${esc(d.requirement)}<h5>Condition found</h5>${esc(d.condition_found)}
      <h5>Impact</h5>${esc(d.impact)}<h5>Request</h5>${esc(d.request)}
      ${list("Evidence", d.evidence)}${list("Actions", d.actions)}${list("To be confirmed", d.to_be_confirmed)}
      <div style="margin-top:12px"><button class="btn small" data-act="copy-doc" data-fid="${esc(d.finding_id)}">Copy as text</button></div>
    </div></div>`;
}

function draftText(d) {
  const list = (label, xs) => (xs?.length ? `\n${label}:\n${xs.map((x) => `- ${x}`).join("\n")}` : "");
  return `${d.number}: ${d.document}\n${d.title || ""}\n\nLocation: ${d.location}\nRequirement: ${d.requirement}\nCondition found: ${d.condition_found}\n` +
    `Impact: ${d.impact}\nRequest: ${d.request}${list("Evidence", d.evidence)}${list("Actions", d.actions)}${list("To be confirmed", d.to_be_confirmed)}\n`;
}

function copyDraft(el) {
  const d = (S.report?.drafts || []).find((x) => x.finding_id === el.dataset.fid);
  if (!d) return;
  navigator.clipboard?.writeText(draftText(d)).then(() => (el.textContent = "Copied ✓"), () => (el.textContent = "Copy failed"));
}

function figure(id, rep) {
  const e = rep.evidenceSrc?.[id];
  return e ? `<figure><img src="${e.src}" alt="${esc(e.caption)}" data-zoom data-caption="${esc(id)} · ${esc(e.caption)}"><figcaption>${esc(id)} · ${esc(e.caption)}</figcaption></figure>` : "";
}

function findingCard(f, rep, d) {
  const r = rep.results[f.result_id];
  const args = Object.values(r.args).join(", ");
  return `<article class="fcard ${f.kind}" id="f-${esc(f.id)}">
    <div class="ev">${f.evidence.map((id) => figure(id, rep)).join("") || `<p class="muted small">No image for this finding.</p>`}</div>
    <div>
      <span class="chip ${f.kind}">${esc(d?.number || f.id)} · ${KIND[f.kind].label}</span>
      <h3>${esc(f.title)}</h3><p style="margin:0">${esc(f.explanation)}</p>
      ${facts(r, f.claim_index)}
      <p class="how-known"><b>How we know:</b> result ${esc(r.id)} from <span class="mono">${esc(r.tool)}(${esc(args)})</span>, measured by
        ${esc([...new Set((r.data.models || []).map(modelName))].join(", ") || "code")}${r.cached ? " (measurement from the cache)" : ""}.
        The verdict “${esc(VERDICT[f.verdict] || f.verdict)}” was computed in code, not by the model.</p>
      ${d ? draftHtml(d) : ""}
    </div></article>`;
}

function renderFindings() {
  const rep = S.report;
  if (!rep) { location.hash = S.run ? "#/run" : "#/"; return; }
  const drafts = Object.fromEntries((rep.drafts || []).map((d) => [d.finding_id, d]));
  const order = { nonconformance: 0, design_query: 1, reporting_discrepancy: 2 };
  const findings = rep.findings.slice().sort((a, b) => order[a.kind] - order[b.kind]);
  const results = Object.values(rep.results);
  const passed = results.filter((r) => r.tool !== "read_nameplate" && r.data.verdict === "pass");
  const ev = rep.evaluation;
  const clean = ev && ev.found === ev.expected && !ev.extra_findings.length && !ev.passes_wrongly_flagged.length;
  const when = (() => { const t = new Date(rep.finished_at); return isNaN(t) ? rep.finished_at : t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); })();
  app.innerHTML = `
  <div class="res-head"><div><div class="eyebrow">${rep.mode === "replay" ? "Recorded run" : "Live run"} · ${esc(when)} · ${rep.seconds} s · $${(rep.cost?.total_usd || 0).toFixed(2)} in model calls</div>
    <h1>${esc(rep.project.name)}</h1></div>
    <div class="ctas"><button class="btn small" data-act="back-run">← Back to the run</button>
      <button class="btn small" data-act="download">Download report.json</button><button class="btn small" data-act="home">Start over</button></div></div>
  ${ev ? `<div class="score${clean ? "" : " warn"}"><b>${clean ? "✓ " : ""}${ev.found} / ${ev.expected}</b><span>planted problems found · ${ev.right_kind} with the right document type ·
    ${ev.extra_findings.length} extra findings · ${ev.passes_wrongly_flagged.length} correct items wrongly flagged</span></div>` : ""}
  <div class="summary"><b>The agent's summary.</b> ${esc(rep.summary)}</div>
  <div class="overview">${KINDS.map((k) => {
    const fs = findings.filter((f) => f.kind === k);
    return `<div class="ov ${k}"><h3>${KIND[k].plural} <span>${fs.length}</span></h3><p>${KIND[k].what} Drafted as a${k === "design_query" ? "" : "n"} ${KIND[k].paper}.</p>
      ${fs.map((f) => `<button class="jump" data-jump="${esc(f.id)}">${esc(drafts[f.id]?.number || f.id)} · ${esc(f.title)}</button>`).join("") || `<p class="faint">None</p>`}</div>`;
  }).join("")}</div>
  <div class="filters"><div class="tabs" id="ftabs">${[["all", `All ${findings.length}`], ...KINDS.map((k) => [k, `${KIND[k].doc} · ${KIND[k].plural} (${findings.filter((f) => f.kind === k).length})`])]
    .map(([k, label]) => `<button data-f="${k}" class="${S.filter === k ? "on" : ""}">${esc(label)}</button>`).join("")}</div></div>
  <div id="fcards"></div>
  <details class="box"><summary>What passed (${passed.length} checks)</summary><ul class="small">${passed.map((r) => `<li>${esc(plain(r))} <span class="faint">${esc(r.id)}</span></li>`).join("")}</ul></details>
  <details class="box"><summary>Every check (${results.length} results)</summary><div class="table-wrap" style="margin-top:10px"><table>
    <tr><th>Result</th><th>Check</th><th>Arguments</th><th>Verdict</th><th>Models</th><th>Time</th></tr>
    ${results.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.tool)}</td><td>${esc(Object.values(r.args).join(", "))}</td>
      <td><span class="chip ${tone(r.data.verdict)}">${esc(VERDICT[r.data.verdict] || r.data.verdict)}</span></td><td class="small">${esc([...new Set((r.data.models || []).map(modelName))].join(", "))}</td>
      <td class="small">${r.seconds}s${r.cached ? " cached" : ""}</td></tr>
      ${(r.data.claims || []).map((c) => `<tr><td></td><td class="muted small">claim ${c.claim_index}</td><td class="small">${c.t_s.toFixed(1)} s: “${esc(c.claim)}”</td>
        <td><span class="chip ${tone(c.verdict)}">${esc(VERDICT[c.verdict] || c.verdict)}</span></td><td class="small muted">${esc(c.method)}</td><td></td></tr>`).join("")}`).join("")}
  </table></div></details>
  <details class="box"><summary>Agent trace (${rep.agent.turns} turns, ${esc(rep.agent.model)})</summary><ol class="small">
    ${rep.agent.trace.map((s) => s.type === "note" ? `<li class="muted">turn ${s.turn}: ${esc(s.text)}</li>`
      : `<li>turn ${s.turn}: <span class="mono">${esc(s.tool)}(${esc(Object.entries(s.args).filter(([k]) => k !== "explanation").map(([, v]) => v).join(", ").slice(0, 120))})</span> → ${esc(s.brief)}</li>`).join("")}
  </ol></details>`;
  paintFindingCards();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function paintFindingCards() {
  const rep = S.report, box = $("#fcards");
  if (!rep || !box) return;
  const drafts = Object.fromEntries((rep.drafts || []).map((d) => [d.finding_id, d]));
  const order = { nonconformance: 0, design_query: 1, reporting_discrepancy: 2 };
  const shown = rep.findings.slice().sort((a, b) => order[a.kind] - order[b.kind]).filter((f) => S.filter === "all" || f.kind === S.filter);
  box.innerHTML = shown.map((f) => findingCard(f, rep, drafts[f.id])).join("") || `<p class="muted">No findings of this kind.</p>`;
}

function setFilter(kind) {
  S.filter = kind;
  $$("#ftabs button").forEach((b) => b.classList.toggle("on", b.dataset.f === kind));
  paintFindingCards();
}

function jumpTo(id) {
  if (S.filter !== "all") setFilter("all");
  document.getElementById(`f-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function downloadReport() {
  const { evidenceSrc, ...plainReport } = S.report || {};
  const url = URL.createObjectURL(new Blob([JSON.stringify(plainReport, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: "groundtruth-report.json" }).click();
}

route();
