/* GroundTruth ad: every frame is a pure function of time t (seconds). window.seek(t) lays out the frame.
   The live product runs inside iframes named "vt-…"; the renderer moves their virtual clocks and fires AD.actions.
   AD.sfx and AD.vo list the audio cues, so the mix lines up with the picture. */
"use strict";
const FPS = 30;
const AD = (window.AD = { duration: 100.5, scenes: [], actions: [], sfx: [], vo: [], frames: {}, live: {} });
const $ = (s, el = document) => el.querySelector(s);
const cl = (x) => Math.max(0, Math.min(1, x));
const P = (t, a, b) => cl((t - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const E = {
  out: (x) => 1 - Math.pow(1 - x, 3), out5: (x) => 1 - Math.pow(1 - x, 5), in: (x) => x * x * x,
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  back: (x) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  elastic: (x) => (x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
function h(tag, cls, html, parent, style) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (style) Object.assign(e.style, style);
  if (parent) parent.appendChild(e);
  return e;
}
const css = (e, s) => Object.assign(e.style, s);
// one span per word; "*word*" is orange
function words(text, cls, parent, style) {
  const box = h("div", cls, null, parent, style);
  box._w = text.split(" ").map((w, i) => {
    const o = /^\*.*\*[.,!?]?$/.test(w);
    const s = h("span", "w" + (o ? " o" : ""), (i ? " " : "") + w.replace(/\*/g, ""), box);
    return s;
  });
  return box;
}
// words rise in one after another from t0; out at t1 (they rise away)
function kin(box, t, t0, { st = 0.07, d = 0.5, dy = 70, blur = 14, t1 = null, od = 0.3, sc = 0 } = {}) {
  box._w.forEach((s, i) => {
    const a = E.back(P(t, t0 + i * st, t0 + i * st + d)), f = P(t, t0 + i * st, t0 + i * st + d * 0.6);
    let y = (1 - a) * dy, o = f, b = (1 - f) * blur, k = sc ? lerp(sc, 1, a) : 1;
    if (t1 != null) { const q = E.in(P(t, t1 + i * 0.03, t1 + i * 0.03 + od)); y -= q * dy * 0.8; o *= 1 - q; b += q * blur; }
    css(s, { transform: `translateY(${y}px) scale(${k})`, opacity: o, filter: b > 0.2 ? `blur(${b}px)` : "none" });
  });
}
function pop(e, t, t0, { d = 0.45, from = 0.6, t1 = null, od = 0.25, dy = 0, base = "" } = {}) {
  const a = E.back(P(t, t0, t0 + d)), f = P(t, t0, t0 + d * 0.5);
  let o = f, s = lerp(from, 1, a), y = (1 - a) * dy;
  if (t1 != null) { const q = E.in(P(t, t1, t1 + od)); o *= 1 - q; s *= 1 - q * 0.2; }
  css(e, { opacity: o, transform: `${base} translateY(${y}px) scale(${s})` });
}
function scene(a, b, build, update) { AD.scenes.push({ a, b, build, update }); }
const sfx = (t, name, gain = 1) => AD.sfx.push({ t, name, gain });
const vo = (t, name) => AD.vo.push({ t, name });
const act = (t, frame, js) => AD.actions.push({ t, frame, js });
let flashes = [];
const flash = (t, k = 0.9) => flashes.push([t, k]);
// a product window: an iframe of the live app, scaled into a rounded window
// ?frames=a,b loads only those live frames (a render of one stretch of the ad needs only its own)
const ONLY = new URLSearchParams(location.search).get("frames");
function win(parent, name, src, w, h, scale) {
  const box = h_("div", "win", parent, { width: w + "px", height: h + "px" });
  if (ONLY != null && !ONLY.split(",").includes(name)) return box;
  const f = document.createElement("iframe");
  f.name = name; f.src = src;
  css(f, { width: w / scale + "px", height: h / scale + "px", transform: `scale(${scale})` });
  box.appendChild(f);
  AD.frames[name] = f;
  return box;
}
function h_(tag, cls, parent, style) { return h(tag, cls, null, parent, style); }
const counter = (t, t0, d, to, dec = 0) => (to * E.out(P(t, t0, t0 + d))).toFixed(dec);
const ICON = {
  clip: `<svg viewBox="0 0 64 64" width="120" height="120" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="10" width="36" height="46" rx="4"/><path d="M24 10V6h16v4M22 24h20M22 32h20M22 40h12"/></svg>`,
  cam: `<svg viewBox="0 0 64 64" width="120" height="120" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20h12l4-6h16l4 6h12v30H8z"/><circle cx="32" cy="34" r="9"/></svg>`,
  hand: `<svg viewBox="0 0 64 64" width="120" height="120" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 30l10-10 10 4 8-6 10 4 14 10M14 34l10 10a4 4 0 006-6M22 40l6 6a4 4 0 006-6l-8-8M34 46a4 4 0 006-6l-6-6M40 40a4 4 0 006-6L34 24"/></svg>`,
  drone: `<svg viewBox="0 0 20 20" width="54" height="54" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="7.5" y="8" width="5" height="4" rx="1"/><path d="M7.5 9L4 6M12.5 9L16 6M7.5 11L4 14M12.5 11L16 14"/><circle cx="4" cy="5.5" r="2"/><circle cx="16" cy="5.5" r="2"/><circle cx="4" cy="14.5" r="2"/><circle cx="16" cy="14.5" r="2"/></svg>`,
  plate: `<svg viewBox="0 0 20 20" width="54" height="54" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M6 8.5h8M6 11.5h5"/></svg>`,
  sheet: `<svg viewBox="0 0 20 20" width="54" height="54" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 3.5h12v13H4z"/><path d="M4 13h12M10 13v3.5M7 6.5h6v4H7z"/></svg>`,
  video: `<svg viewBox="0 0 20 20" width="54" height="54" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="11" height="10" rx="1.5"/><path d="M13.5 9l4-2.5v7l-4-2.5"/></svg>`,
};
const LOGO = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#262626"/>
  <g class="lg" transform="translate(12.99 27.17) rotate(-45)"><path class="lg-floor" d="M0 0H22V-6.2H6.2V-13.5H0Z" fill="#ff4c00"/>
  <path class="lg-inner" d="M6.2 0V-6.2M14.1 0V-6.2M14.1 -3.6V-0.6" stroke="#fff" stroke-width="1"/>
  <path class="lg-door" d="M14.1 -3.6a3 3 0 0 0 -3 3" fill="none" stroke="#fff" stroke-width=".75" stroke-dasharray=".9 .8"/>
  <path class="lg-wall" d="M0 0H22V-6.2H6.2V-13.5H0Z" fill="none" stroke="#fff" stroke-width="1.7" pathLength="1" stroke-dasharray="1 1"/></g></svg>`;
const MODELS = [["Muse Wonder", "the agent"], ["Muse Spark 1.3", "reads & counts"], ["SAM 3.1", "segments"], ["Muse Spark Open", "watches the walk"]];

/* ---------------- 0 · cold open: the design lines, then the site ---------------- */
vo(0.4, "A1");
scene(0, 4.5, (r) => {
  const wall = h_("div", "abs", r, { left: "-200px", right: "-200px", top: "-200px", height: "2600px", transformOrigin: "50% 0" });
  const L = window.DESIGN_LINES;
  for (let i = 0; i < 70; i++) h("div", "mono", L[i % L.length], wall, { font: "500 30px var(--mono)", lineHeight: "52px", whiteSpace: "nowrap", color: i % 7 === 3 ? "rgba(255,76,0,.75)" : "rgba(245,243,238,.28)" });
  r._wall = wall;
  r._img = h("img", "abs", null, r, { left: 0, top: 0, width: "1920px", height: "1080px", objectFit: "cover", opacity: 0 });
  r._img.src = "assets/drn-a01.jpg";
  r._scan = h_("div", "abs", r, { left: 0, top: 0, width: "1920px", height: "1080px", opacity: 0,
    backgroundImage: "linear-gradient(rgba(255,76,0,.35) 2px, transparent 2px), linear-gradient(90deg, rgba(255,76,0,.35) 2px, transparent 2px)", backgroundSize: "120px 120px" });
  r._shade = h_("div", "abs", r, { inset: 0, background: "linear-gradient(180deg, rgba(15,15,15,.2), rgba(15,15,15,.75))" });
  r._t1 = words("Thousands of *design* *lines.*", "center big", r, { width: "1840px", fontSize: "132px" });
  r._t2 = words("One construction *site.*", "center big", r, { width: "1840px", fontSize: "132px" });
}, (t, r) => {
  css(r._wall, { transform: `perspective(1400px) rotateX(52deg) translateY(${-t * 260}px)`, opacity: 1 - P(t, 2.1, 2.7) });
  const im = E.out(P(t, 2.2, 3.0));
  css(r._img, { opacity: im * 0.95, transform: `scale(${lerp(1.35, 1.08, E.out(P(t, 2.2, 4.5)))})` });
  css(r._scan, { opacity: P(t, 2.6, 3.0) * (1 - P(t, 4.1, 4.5)) * 0.8, backgroundPosition: `0 ${t * 60}px` });
  css(r._shade, { opacity: im });
  kin(r._t1, t, 0.45, { st: 0.18, t1: 2.25 });
  kin(r._t2, t, 2.45, { st: 0.22, t1: 4.15, od: 0.3 });
});
sfx(0.0, "riser", 0.6); sfx(2.35, "whoosh", 0.7); sfx(2.6, "scan", 0.5); sfx(4.2, "whoosh", 0.9);

/* ---------------- 1 · the problem ----------------
   VO A2 @4.6: Today 4.6 · clipboards 7.24 · photos 8.40 · trust 9.08 · mistakes 10.12 · surface 10.68 · handover 11.24–12.04 */
vo(4.6, "A2");
scene(4.5, 12.4, (r) => {
  r._k = words("Today, proving it was *built* *right* means", "abs h2", r, { left: "0", right: "0", top: "210px", textAlign: "center" });
  r._tiles = [["clip", "Clipboards."], ["cam", "Photos."], ["hand", "Trust."]].map(([i, w], k) =>
    h("div", "abs card", `<div style="color:#ff4c00">${ICON[i]}</div><div class="h2" style="margin-top:18px">${w}</div>`, r,
      { left: 300 + k * 470 + "px", top: "380px", width: "400px", height: "340px", display: "grid", placeItems: "center", alignContent: "center", textAlign: "center" }));
  r._line = h_("div", "abs", r, { left: "260px", right: "260px", top: "600px", height: "6px", background: "#333", borderRadius: "3px", transformOrigin: "0 50%" });
  r._nodes = ["Design", "Build", "Handover"].map((n, k) => h("div", "abs", `<div class="nd" style="width:46px;height:46px;border-radius:50%;background:#262626;border:5px solid #555;margin:0 auto"></div>
    <div class="h3" style="margin-top:22px;white-space:nowrap">${n}</div>`, r, { left: 260 + k * 700 - 100 + "px", top: "577px", width: "200px", textAlign: "center" }));
  r._x = h("div", "abs", `<svg width="160" height="160" viewBox="0 0 64 64"><path d="M16 16l32 32M48 16L16 48" stroke="#ef4444" stroke-width="8" stroke-linecap="round"/></svg>`, r, { left: "1580px", top: "360px" });
  r._m = words("Mistakes surface at *handover.*", "abs h1", r, { left: 0, right: 0, top: "260px", textAlign: "center" });
  r._red = h_("div", "abs", r, { inset: 0, background: "repeating-linear-gradient(135deg, rgba(239,68,68,.10) 0 30px, transparent 30px 60px)", opacity: 0 });
}, (t, r) => {
  kin(r._k, t, 4.65, { st: 0.06, d: 0.35, dy: 30, t1: 9.75 });
  r._tiles.forEach((c, k) => pop(c, t, [7.2, 8.36, 9.04][k], { from: 0.5, dy: 80, t1: 9.75 + k * 0.05 }));
  css(r._line, { opacity: P(t, 9.95, 10.4), transform: `scaleX(${E.out(P(t, 9.95, 11.0))})`, background: t > 11.25 ? "linear-gradient(90deg,#444,#444 66%,#ef4444)" : "#3a3a3a" });
  r._nodes.forEach((n, k) => {
    pop(n, t, 10.0 + k * 0.4, { from: 0.4, t1: 11.9 });
    const d = $(".nd", n);
    if (k === 2 && t > 11.25) css(d, { borderColor: "#ef4444", background: "#3a1212" }); else if (t > 10.2 + k * 0.4) css(d, { borderColor: "#ff4c00", background: "#262626" }); else css(d, { borderColor: "#555", background: "#262626" });
  });
  pop(r._x, t, 11.25, { from: 2.2, d: 0.35, t1: 11.9 });
  r._m._w.forEach((s, i) => { const t0 = [10.1, 10.66, 10.98, 11.22][i], q = E.back(P(t, t0, t0 + 0.4)), o = E.in(P(t, 11.85, 12.15)); css(s, { opacity: P(t, t0, t0 + 0.2) * (1 - o), transform: `translateY(${(1 - q) * 60 - o * 40}px)` }); });
  const g = t > 11.25 && t < 11.7 ? (Math.sin(t * 90) > 0 ? 1 : 0.4) : 0;
  css(r._red, { opacity: P(t, 11.25, 11.4) * (1 - P(t, 11.85, 12.2)) * (0.6 + g * 0.4) });
  css(r.root, { transform: `scale(${1 - E.in(P(t, 11.9, 12.4)) * 0.9})`, opacity: 1 - P(t, 12.15, 12.4), filter: t > 11.25 && t < 11.55 ? `hue-rotate(${Math.sin(t * 70) * 20}deg)` : "none" });
});
sfx(7.2, "click"); sfx(8.36, "click"); sfx(9.04, "click"); sfx(9.95, "whoosh", 0.6); sfx(11.25, "alert"); sfx(11.35, "riser", 0.7);

/* ---------------- 2 · logo sting (the music drops here) ---------------- */
vo(12.9, "A3");
flash(12.4, 0.85);
flash(85.27, 0.3);
scene(12.4, 16.8, (r) => {
  r._logo = h("div", "abs", LOGO(300), r, { left: "560px", top: "300px", width: "300px", height: "300px" });
  r._word = h("div", "abs", "GroundTruth".split("").map((c) => `<span class="w">${c}</span>`).join(""), r, { left: "900px", top: "360px", font: "700 150px/1 var(--disp)", letterSpacing: "-.05em" });
  r._word._w = [...r._word.querySelectorAll(".w")];
  r._sub = words("Built on Meta's models", "abs h3 mut", r, { left: 0, right: 0, top: "660px", textAlign: "center" });
  r._chips = MODELS.map(([m], k) => h("div", "abs chip m", `<span class="dot"></span>${m}`, r, { top: "750px", left: [330, 690, 1080, 1360][k] + "px" }));
}, (t, r) => {
  const a = E.back(P(t, 12.4, 12.95)), mv = E.inOut(P(t, 12.6, 13.4));
  $(".lg", r._logo).setAttribute("transform", `translate(${lerp(4.8, 12.99, mv)} ${lerp(22.5, 27.17, mv)}) rotate(${lerp(0, -45, mv)})`);
  $(".lg-wall", r._logo).setAttribute("stroke-dashoffset", 1 - E.out(P(t, 12.45, 13.1)));
  $(".lg-floor", r._logo).setAttribute("opacity", P(t, 12.9, 13.3));
  $(".lg-inner", r._logo).setAttribute("opacity", P(t, 13.2, 13.5));
  $(".lg-door", r._logo).setAttribute("opacity", P(t, 13.3, 13.6));
  css(r._logo, { transform: `translateX(${lerp(240, 0, E.inOut(P(t, 13.2, 13.8)))}px) scale(${a})`, opacity: P(t, 12.4, 12.6) });
  r._word._w.forEach((s, i) => { const q = E.out(P(t, 13.35 + i * 0.03, 13.75 + i * 0.03)); css(s, { opacity: q, transform: `translateX(${(1 - q) * -40}px)` }); });
  kin(r._sub, t, 14.35, { st: 0.1, dy: 30 });
  r._chips.forEach((c, k) => pop(c, t, 14.8 + k * 0.22, { from: 0.4, dy: 40 }));
  const out = E.in(P(t, 16.3, 16.8));
  css(r.root, { transform: `scale(${1 + out * 2.5})`, opacity: 1 - out, filter: out > 0.05 ? `blur(${out * 20}px)` : "none" });
});
sfx(12.4, "impact"); [0, 1, 2, 3].forEach((k) => sfx(14.8 + k * 0.22, "click", 0.7)); sfx(16.3, "whoosh");

/* ---------------- 3 · design it ----------------
   VO A4 @17.6: Describe a building 17.6 · Muse Wonder 19.36 · lays it out with the Studio's own tools 19.64–22.72 · while code checks every move 22.84–25.04
   · No overlaps 25.12 · Every room reachable 26.32–28.0 · Got a hand sketch? 28.08–29.2 · Muse Spark reads it 29.28 · to scale 30.8–31.6 */
function slam(a, word1, word2, sub) {
  scene(a, a + 1.25, (r) => {
    r._a = h("div", "abs huge", word1, r, { left: 0, right: "50%", top: "380px", textAlign: "right", paddingRight: "24px" });
    r._b = h("div", "abs huge o", word2, r, { left: "50%", right: 0, top: "380px", paddingLeft: "24px" });
    if (sub) r._s = h("div", "abs h3 mut", sub, r, { left: 0, right: 0, top: "680px", textAlign: "center" });
  }, (t, r) => {
    const x = E.out5(P(t, a, a + 0.32)), y = E.out5(P(t, a + 0.08, a + 0.4)), o = E.in(P(t, a + 1.0, a + 1.25));
    css(r._a, { transform: `translateX(${(1 - x) * -900 - o * 400}px) skewX(${(1 - x) * -12}deg)`, opacity: x * (1 - o) });
    css(r._b, { transform: `translateX(${(1 - y) * 900 + o * 400}px) skewX(${(1 - y) * 12}deg)`, opacity: y * (1 - o) });
    if (r._s) css(r._s, { opacity: P(t, a + 0.35, a + 0.6) * (1 - o) });
  });
  sfx(a, "whoosh"); sfx(a + 0.1, "impact", 0.45);
}
slam(16.8, "DESIGN", "IT.");
vo(17.6, "A4");
const HERO = "/#/";
const STEPS = [["add_room", "Living room · 6.0 × 4.5 m"], ["add_room", "Kitchen and dining · 4.0 × 4.5 m"], ["add_room", "Hallway · 10.0 × 1.2 m"], ["add_room", "Bedroom 1 · 3.8 × 3.3 m"],
  ["add_room", "Bathroom · 2.4 × 3.3 m"], ["add_room", "Bedroom 2 · 3.8 × 3.3 m"], ["connect", "doors on the shared walls"], ["add_entrance", "Hallway"], ["add_window", "× 8"], ["furnish_room", "× 6 rooms"], ["check_plan", "0 overlaps · entrance · all rooms reachable"]];
const stepT = (k) => 19.6 + k * 0.36 + (k >= 10 ? 0.25 : 0); // check_plan lands on "code checks every move"
scene(18.05, 32.4, (r) => {
  r._w = win(r, "vt-hero", HERO, 1180, 790, 1180 / 1500);
  css(r._w, { left: "90px", top: "150px" });
  const panel = h("div", "abs card", `<div class="label" style="color:#ff4c00;margin-bottom:16px">Muse Wonder · tool calls</div>`, r, { left: "1310px", top: "150px", width: "540px", height: "650px", padding: "26px 28px", overflow: "hidden" });
  r._steps = STEPS.map(([fn, arg], k) => h("div", "", `<span style="color:${fn === "check_plan" ? "#22c55e" : "#ff7a3d"};font:600 22px var(--mono)">${fn}</span><span style="font:500 19px var(--sans);color:#cfccc5;margin-left:10px">${arg}</span>`, panel, { padding: "9px 0", borderTop: k ? "1px solid #2a2a2a" : "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }));
  r._panel = panel;
  r._b1 = h("div", "abs chip okc", `<span style="color:#22c55e;font-weight:800">✓</span> No overlaps`, r, { left: "1310px", top: "830px", font: "600 30px var(--sans)" });
  r._b2 = h("div", "abs chip okc", `<span style="color:#22c55e;font-weight:800">✓</span> Every room reachable`, r, { left: "1310px", top: "905px", font: "600 30px var(--sans)" });
  r._cap = words("Describe a building.", "abs h3", r, { left: "90px", top: "62px" });
  r._prompt = h("div", "abs", "", r, { left: "520px", top: "66px", font: "500 30px var(--sans)", color: "#bdbab3" });
  r._paper = h("div", "abs", `<svg viewBox="0 0 600 440" width="760" height="557"><rect width="600" height="440" fill="#f6f1e4"/>
    <g fill="none" stroke="#3b3b3b" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M62 58 L 540 62 L 536 382 L 60 378 Z"/><path d="M300 61 L 298 220 M60 222 L 538 218 M196 220 L 194 380 M392 219 L 394 381"/>
      <path d="M150 222 q 18 -30 46 -2" stroke-dasharray="6 6"/><path d="M420 220 q 16 -28 42 0" stroke-dasharray="6 6"/></g>
    <g font-family="Comic Sans MS, Segoe Print, cursive" font-size="24" fill="#3b3b3b"><text x="140" y="140">LIVING</text><text x="370" y="140">KITCHEN</text>
      <text x="92" y="310">BED</text><text x="250" y="310">BATH</text><text x="430" y="310">BED</text>
      <text x="270" y="40" font-size="22">12 m</text><text x="10" y="230" font-size="22" transform="rotate(-90 22 230)">8 m</text></g>
    <g class="scanbox" fill="rgba(255,76,0,.14)" stroke="#ff4c00" stroke-width="3" stroke-dasharray="10 8">
      <rect x="66" y="66" width="230" height="150"/><rect x="304" y="66" width="228" height="148"/><rect x="66" y="226" width="126" height="148"/><rect x="200" y="226" width="190" height="150"/><rect x="398" y="224" width="134" height="152"/></g>
    <rect class="beam" x="0" y="0" width="600" height="6" fill="#ff4c00"/></svg>`, r, { left: "120px", top: "250px" });
  r._clean = h("div", "abs", `<svg viewBox="0 0 600 440" width="760" height="557"><rect width="600" height="440" fill="#fcfcfb"/>
    <g><rect x="60" y="60" width="240" height="160" fill="#ead9b0"/><rect x="300" y="60" width="240" height="160" fill="#f2d2bd"/><rect x="60" y="220" width="136" height="160" fill="#c9dcf2"/>
    <rect x="196" y="220" width="196" height="160" fill="#c3e8e2"/><rect x="392" y="220" width="148" height="160" fill="#c9dcf2"/></g>
    <g fill="none" stroke="#262626" stroke-width="9" stroke-linejoin="miter"><rect x="60" y="60" width="480" height="320"/></g>
    <g stroke="#262626" stroke-width="5"><path d="M300 60V220M60 220H540M196 220V380M392 220V380"/></g>
    <g font-family="Inter" font-weight="600" font-size="17" fill="#262626" text-anchor="middle"><text x="180" y="145">Living 6.0 × 4.0</text><text x="420" y="145">Kitchen 6.0 × 4.0</text>
    <text x="128" y="305">Bed 3.4 × 4.0</text><text x="294" y="305">Bath 4.9 × 4.0</text><text x="466" y="305">Bed 3.7 × 4.0</text></g></svg>`, r, { left: "1040px", top: "250px" });
  r._arrow = h("div", "abs o", "→", r, { left: "905px", top: "460px", font: "700 110px var(--disp)" });
  r._s1 = h("div", "abs chip m", `<span class="dot"></span>Muse Spark 1.3 · reads rooms and sizes`, r, { left: "120px", top: "850px" });
  r._s2 = h("div", "abs chip m", `<span class="dot"></span>Muse Wonder · lays it out to scale`, r, { left: "1040px", top: "850px" });
  r._q = words("Got a hand *sketch?*", "abs h1", r, { left: "120px", top: "90px" });
}, (t, r) => {
  const inA = E.out5(P(t, 18.05, 18.75)), away = E.inOut(P(t, 27.5, 28.0));
  // 2D only: a live frame under a 3D transform is re-rasterised in software every frame
  css(r._w, { opacity: inA * (1 - away), transform: `translateY(${(1 - inA) * 260}px) translateX(${-away * 300}px) scale(${lerp(0.9, 1, inA) - away * 0.2})` });
  pop(r._panel, t, 19.3, { from: 0.85, dy: 60, t1: 27.45 });
  r._steps.forEach((s, k) => { const q = E.out(P(t, stepT(k), stepT(k) + 0.25)); css(s, { opacity: q, transform: `translateX(${(1 - q) * 30}px)` }); });
  pop(r._b1, t, 25.15, { from: 0.5, t1: 27.45 }); pop(r._b2, t, 26.35, { from: 0.5, t1: 27.45 });
  kin(r._cap, t, 17.65, { st: 0.12, dy: 30, t1: 27.35 });
  const txt = "“A two-bedroom home with an open kitchen”", n = Math.round(txt.length * P(t, 18.3, 19.5));
  r._prompt.textContent = txt.slice(0, n) + (t > 18.3 && t < 19.7 && Math.floor(t * 4) % 2 ? "|" : "");
  css(r._prompt, { opacity: 1 - P(t, 27.2, 27.5) });
  const sk = E.out5(P(t, 27.8, 28.4));
  css(r._paper, { opacity: sk, transform: `rotate(${lerp(-8, -2, sk)}deg) translateY(${(1 - sk) * 200}px)` });
  const beam = P(t, 29.3, 30.5), bm = $(".beam", r._paper);
  bm.setAttribute("y", 440 * beam); bm.setAttribute("opacity", beam > 0 && beam < 1 ? 1 : 0);
  $(".scanbox", r._paper).querySelectorAll("rect").forEach((rc, k) => rc.setAttribute("opacity", P(t, 29.45 + k * 0.2, 29.65 + k * 0.2)));
  pop(r._s1, t, 29.35, { from: 0.6 });
  const cp = E.back(P(t, 30.75, 31.3));
  css(r._clean, { opacity: P(t, 30.75, 31.0), transform: `scale(${lerp(0.7, 1, cp)})` });
  css(r._arrow, { opacity: P(t, 30.6, 30.85), transform: `translateX(${(1 - E.out(P(t, 30.6, 30.95))) * -60}px)` });
  pop(r._s2, t, 31.15, { from: 0.6 });
  kin(r._q, t, 28.05, { st: 0.16, dy: 40 });
  const out = E.in(P(t, 31.95, 32.4));
  css(r.root, { opacity: 1 - out, transform: `translateX(${-out * 300}px)` });
});
act(18.0, "vt-hero", `document.querySelector('[data-hs="0"]').click()`);
sfx(18.3, "typing", 0.6); STEPS.forEach((s, k) => sfx(stepT(k), "click", 0.35)); sfx(25.15, "success", 0.8); sfx(26.35, "success", 0.8);
sfx(27.55, "whoosh"); sfx(29.3, "scan"); sfx(30.75, "whoosh", 0.6); sfx(31.15, "success", 0.6); sfx(31.95, "whoosh");

/* ---------------- 4 · live in it ----------------
   VO A5 @32.45: live in it 32.77 · Real sun 33.85 · for your city and date –36.73 · Walk right in 36.93–37.93 · A simulator scores daylight 38.21–39.97
   · movement 40.05 · space 40.77 · in fifty milliseconds 41.33–42.85 · Wonder improves the plan 43.09–44.61 · keeping only what scores higher 44.69–46.61 */
slam(32.4, "LIVE", "IN IT.");
vo(32.45, "A5");
scene(33.65, 47.3, (r) => {
  r._w = win(r, "vt-hero2", HERO, 1500, 860, 1);
  css(r._w, { left: "210px", top: "130px" });
  r._clock = h("div", "abs", "", r, { right: "210px", top: "58px", font: "600 46px var(--mono)", color: "#f5a524", textAlign: "right" });
  r._c1 = words("Real *sun,* for your city and date.", "abs h3", r, { left: "210px", top: "50px" });
  r._c2 = words("Walk right *in.*", "abs h3", r, { left: "210px", top: "50px" });
  r._sim = win(r, "vt-studio", "/studio", 1500, 860, 1);
  css(r._sim, { left: "210px", top: "130px" });
  r._c3 = words("A simulator scores it, from the *geometry.*", "abs h3", r, { left: "210px", top: "50px" });
  r._dials = ["Overall", "Daylight", "Movement", "Space"].map((n, k) => h("div", "abs card", `<div class="v" style="font:700 76px/1 var(--disp)">0</div><div class="label" style="margin-top:8px">${n}</div>`, r,
    { left: 250 + k * 250 + "px", top: "850px", width: "220px", height: "160px", display: "grid", placeItems: "center", alignContent: "center", borderTop: "6px solid #22c55e" }));
  r._ms = h("div", "abs", `<div style="font:700 150px/1 var(--disp);letter-spacing:-.05em;color:#ff4c00">50 ms</div><div class="label" style="margin-top:10px;text-align:right">to score a plan</div>`, r, { right: "120px", top: "820px", padding: "26px 34px", background: "rgba(15,15,15,.92)", borderRadius: "22px", border: "1.5px solid #333" });
  r._imp = h("div", "abs card", `<div class="label" style="color:#ff4c00">Improve with AI · Muse Wonder + the simulator</div>
    <div style="display:flex;gap:46px;margin-top:20px;align-items:baseline"><div><div class="label">Daylight</div><div class="v1" style="font:700 96px/1 var(--disp)">79</div></div>
    <div><div class="label">Overall</div><div class="v2" style="font:700 96px/1 var(--disp)">90</div></div></div>
    <div class="keep" style="font:600 24px var(--sans);color:#bdbab3;margin-top:16px">Keeps only the changes that score higher</div>`, r, { left: "1250px", top: "520px", width: "600px", padding: "28px 32px" });
}, (t, r) => {
  const inA = E.out5(P(t, 33.65, 34.3)), push = E.inOut(P(t, 38.05, 38.6));
  css(r._w, { opacity: inA, transform: `translateX(${-push * 1920}px) translateY(${(1 - inA) * 220}px) scale(${lerp(0.9, 1, inA)})` });
  const hr = AD.frames["vt-hero2"]?.contentDocument?.querySelector("#hs-hour")?.textContent;
  r._clock.textContent = hr ? `☀ ${hr}` : "";
  css(r._clock, { opacity: P(t, 34.0, 34.3) * (1 - P(t, 36.6, 36.9)) });
  kin(r._c1, t, 33.85, { st: 0.12, dy: 30, t1: 36.65 });
  kin(r._c2, t, 36.9, { st: 0.16, dy: 30, t1: 37.95 });
  css(r._sim, { opacity: P(t, 38.05, 38.2) * (1 - P(t, 47.0, 47.3)), transform: `translateX(${(1 - push) * 1920}px)` });
  kin(r._c3, t, 38.25, { st: 0.1, dy: 30, t1: 46.85 });
  const vals = AD.live.sim || [95, 100, 100, 84], at = [38.6, 39.3, 40.05, 40.75];
  r._dials.forEach((d, k) => { pop(d, t, at[k], { from: 0.6, dy: 40, t1: 42.95 }); $(".v", d).textContent = counter(t, at[k] + 0.05, 0.8, vals[k]); });
  pop(r._ms, t, 41.3, { from: 1.6, d: 0.35, t1: 42.95 });
  pop(r._imp, t, 43.05, { from: 0.7, dy: 60, t1: 46.85 });
  $(".v1", r._imp).textContent = Math.round(lerp(79, 90, E.out(P(t, 43.8, 45.0))));
  $(".v2", r._imp).textContent = Math.round(lerp(90, 94, E.out(P(t, 44.0, 45.2))));
  css($(".v1", r._imp), { color: t > 45.0 ? "#22c55e" : "#f5f3ee" }); css($(".v2", r._imp), { color: t > 45.2 ? "#22c55e" : "#f5f3ee" });
  css($(".keep", r._imp), { opacity: P(t, 44.7, 45.0), color: t > 44.7 ? "#22c55e" : "#bdbab3" });
});
act(33.6, "vt-hero2", `document.querySelector('[data-hs="1"]').click()`);
act(36.85, "vt-hero2", `document.querySelector('[data-hs="2"]').click()`);
act(38.0, "vt-studio", `document.querySelector('[data-mode="simulate"]').click()`);
act(38.4, "vt-studio", `document.querySelector('[data-pact="sim-walk"]')?.click()`);
sfx(33.85, "scan", 0.4); sfx(36.9, "whoosh", 0.6); sfx(38.05, "whoosh", 0.8); at4().forEach((x) => sfx(x + 0.05, "counter", 0.45)); sfx(41.3, "impact", 0.5); sfx(43.05, "whoosh", 0.5); sfx(45.0, "success", 0.8); sfx(46.55, "riser", 0.9);
function at4() { return [38.6, 39.3, 40.05, 40.75]; }

/* ---------------- 5 · prove it ----------------
   VO A6 @47.0: Now 47.0 · prove it was built right 47.64–49.04 */
vo(47.0, "A6");
flash(47.6, 0.9);
scene(47.3, 49.2, (r) => {
  r._line = h_("div", "abs", r, { left: 0, right: 0, top: "538px", height: "4px", background: "#ff4c00", transformOrigin: "50% 50%" });
  r._t = h("div", "center", `<div class="huge">PROVE <span class="o">IT.</span></div><div class="h3 mut" style="margin-top:28px">The built site, checked against the design</div>`, r, { whiteSpace: "nowrap" });
  r._logo = h("div", "abs", LOGO(150), r, { left: "885px", top: "120px" });
}, (t, r) => {
  css(r._line, { transform: `scaleX(${E.out5(P(t, 47.3, 47.6))})`, opacity: 1 - P(t, 47.6, 47.7) });
  const a = E.back(P(t, 47.6, 48.05));
  css(r._t, { transform: `translate(-50%,-50%) scale(${lerp(2.2, 1, a)})`, opacity: P(t, 47.6, 47.72) * (1 - P(t, 48.9, 49.2)) });
  pop(r._logo, t, 47.85, { from: 0.2, d: 0.5, t1: 48.9 });
});
sfx(47.3, "whoosh", 0.6); sfx(47.6, "impact"); sfx(48.9, "whoosh");

/* ---------------- 6 · the site check: captures, problems, 14 calls ----------------
   Twelve site captures 49.24–50.68 · Nine hidden problems 50.84–52.4 · Muse Wonder runs the check 52.6–54.36 · firing fourteen tool calls 54.44–56.04 · in its very first turn –57.8 */
const PINS = { "DRN-A01": 1, "DWG-E4": 1, "DWG-E101": 1, "NP-01": 1, "NP-02": 1, "NP-05": 1, "WLK-01": 3 };
const TYPEI = { drone_still: "drone", nameplate_photo: "plate", drawing_sheet: "sheet", walkthrough_video: "video" };
const IMG = { "DRN-A01": "assets/drn-a01.jpg", "DWG-E101": "assets/dwg-e101.png" };
const CALLS = [["verify_quantity", "Q-A1"], ["verify_quantity", "Q-C1"], ["verify_quantity", "Q-E1"], ["verify_quantity", "Q-E2"],
  ...["NP-01", "NP-02", "NP-03", "NP-04", "NP-05", "NP-06", "NP-07"].map((n) => ["read_nameplate", n]), ["check_drawing_register", "DWG-E101"], ["check_drawing_register", "DWG-E4"], ["check_walkthrough", "WLK-01"]];
scene(49.2, 58.6, (r) => {
  r._k = words("THE DEMO SITE · A SOLAR FARM", "kick abs", r, { left: "120px", top: "90px", fontSize: "28px" });
  r._t = words("Twelve site *captures.*", "abs h1", r, { left: "120px", top: "140px" });
  r._t2 = words("Nine hidden *problems.*", "abs h1", r, { left: "120px", top: "140px" });
  const order = ["DRN-A01", "DRN-C03", "DWG-E101", "DWG-E4", "WLK-01", "NP-01", "NP-02", "NP-03", "NP-04", "NP-05", "NP-06", "NP-07"];
  const caps = Object.fromEntries(window.CAPTURES.map((c) => [c.id, c]));
  r._cards = order.map((id, k) => {
    const c = caps[id], x = 105 + (k % 6) * 290, y = 320 + Math.floor(k / 6) * 270;
    const card = h("div", "cap", `<div class="im">${IMG[id] ? `<img src="${IMG[id]}">` : `<div style="color:#ff7a3d">${ICON[TYPEI[c.type]]}</div>`}</div><div class="t">${id}<span>${c.label}</span></div>`, r, { left: x + "px", top: y + "px" });
    card._id = id;
    card._pin = PINS[id] ? h("div", "pin", PINS[id] > 1 ? String(PINS[id]) : "!", card, { right: "10px", top: "10px" }) : null;
    return card;
  });
  r._nine = h("div", "abs", `<span style="font:700 200px/1 var(--disp);color:#ef4444">9</span>`, r, { right: "140px", top: "70px" });
  r._ag = h_("div", "abs", r, { inset: 0 });
  r._svg = h("div", "abs", `<svg width="1920" height="1080">${CALLS.map((_, k) => `<path class="ray" d="M 500 480 C 760 480, 760 ${120 + k * 64}, 985 ${120 + k * 64}" stroke="#ff4c00" stroke-width="3" fill="none" pathLength="1" stroke-dasharray="1 1" opacity=".85"/>`).join("")}</svg>`, r._ag, { inset: 0 });
  r._wn = h("div", "abs", `<div style="width:190px;height:190px;border-radius:50%;border:6px solid #ff4c00;display:grid;place-items:center;background:#1a1a1a;box-shadow:0 0 0 18px rgba(255,76,0,.12)">
    <div style="font:700 86px var(--disp);color:#ff4c00">W</div></div><div class="ring" style="position:absolute;left:0;top:0;width:190px;height:190px;border-radius:50%;border:4px solid #ff4c00"></div>
    <div class="ring" style="position:absolute;left:0;top:0;width:190px;height:190px;border-radius:50%;border:4px solid #ff4c00"></div><div class="h3" style="text-align:center;margin-top:20px">Muse Wonder</div><div class="label" style="text-align:center;margin-top:8px">runs the check</div>`, r._ag, { left: "300px", top: "380px" });
  r._calls = CALLS.map(([fn, arg], k) => h("div", "abs", `<span style="font:600 25px var(--mono);color:#ff7a3d">${fn}</span><span style="font:600 25px var(--mono);color:#f5f3ee;margin-left:14px">${arg}</span>`, r._ag, { left: "1000px", top: 105 + k * 64 + "px", whiteSpace: "nowrap" }));
  r._n14 = h("div", "abs", `<div style="font:700 180px/1 var(--disp)">14</div><div class="h3 mut" style="margin-top:8px">tool calls at once</div>`, r._ag, { left: "1560px", top: "380px", textAlign: "center" });
  r._turn = h("div", "abs chip", `<span class="dot"></span>in its first turn`, r._ag, { left: "1540px", top: "660px", font: "600 30px var(--sans)" });
}, (t, r) => {
  kin(r._k, t, 49.25, { st: 0.05, d: 0.35, dy: 20, t1: 52.3 });
  kin(r._t, t, 49.25, { st: 0.16, t1: 50.7 });
  kin(r._t2, t, 50.84, { st: 0.2, t1: 52.3 });
  const go = E.inOut(P(t, 52.35, 52.85));
  r._cards.forEach((c, k) => {
    const a = E.back(P(t, 49.4 + k * 0.075, 49.85 + k * 0.075));
    css(c, { opacity: P(t, 49.4 + k * 0.075, 49.55 + k * 0.075) * (1 - go), transform: `translateY(${(1 - a) * 120 - go * 80}px) rotate(${(1 - a) * (k % 2 ? 8 : -8)}deg) scale(${lerp(0.7, 1, a)})` });
    if (c._pin) pop(c._pin, t, 50.95 + Object.keys(PINS).indexOf(c._id) * 0.14, { from: 2.4, d: 0.35 });
  });
  pop(r._nine, t, 51.55, { from: 2, d: 0.4, t1: 52.3 });
  css(r._ag, { opacity: P(t, 52.55, 52.85) * (1 - P(t, 58.3, 58.6)) });
  pop(r._wn, t, 52.6, { from: 0.4, d: 0.5 });
  r._wn.querySelectorAll(".ring").forEach((g, i) => { const ph = ((t - 52.9 + i * 0.45) / 0.9) % 1, on = t > 52.9 && t < 54.9; css(g, { transform: `scale(${1 + ph * 0.7})`, opacity: on && ph >= 0 ? (1 - ph) * 0.8 : 0 }); });
  r._svg.querySelectorAll(".ray").forEach((p, k) => p.setAttribute("stroke-dashoffset", 1 - E.out(P(t, 54.4 + k * 0.09, 54.85 + k * 0.09))));
  r._calls.forEach((c, k) => { const q = E.out(P(t, 54.65 + k * 0.09, 54.95 + k * 0.09)); css(c, { opacity: q, transform: `translateX(${(1 - q) * 40}px)` }); });
  pop(r._n14, t, 54.92, { from: 0.5, d: 0.45 });
  pop(r._turn, t, 56.5, { from: 0.5, d: 0.4 });
});
for (let k = 0; k < 12; k++) sfx(49.4 + k * 0.075, "shutter", 0.55);
Object.keys(PINS).forEach((_, k) => sfx(50.95 + k * 0.14, "alert", 0.4)); sfx(52.35, "whoosh"); for (let k = 0; k < 14; k += 2) sfx(54.4 + k * 0.09, "click", 0.4); sfx(54.92, "impact", 0.5); sfx(56.5, "click", 0.6);

/* ---------------- 7 · which model does what ----------------
   VO A7 @58.6: SAM three point one 58.6 · segments the solar tables 60.04–61.6 · Muse Spark 61.8 · counts every module 62.52–63.88 · reads 64.04
   · ninety-two of ninety-two 64.36–65.88 · nameplate fields –67.08 · Exactly 67.24–68.04 · Muse Spark Open 68.4–69.56 · on Baseten 69.64–70.52
   · watches the narrated walkthrough 70.56–72.28 · catches the false claims 72.52–74.12 */
vo(58.6, "A7");
scene(58.6, 74.6, (r) => {
  const box = h_("div", "abs", r, { left: "90px", top: "150px", width: "1100px", height: "688px", borderRadius: "18px", overflow: "hidden", background: "#1b1b1b", boxShadow: "0 40px 100px -30px rgba(0,0,0,.8)" });
  r._box = box;
  r._img = h("img", "abs", null, box, { left: 0, top: 0, width: "1100px", height: "688px", objectFit: "cover" }); r._img.src = "assets/drn-a01.jpg";
  const M = AD.modules, s = 1100 / M.W;
  const full = M.rows.find((q) => q.mods.length === 24), pitch = (full.mods[23][0] - full.mods[0][0]) / 23;
  let masks = "", dots = "", gaps = "";
  M.rows.forEach((row, i) => {
    const x0 = row.mods[0][0], x1 = row.mods[row.mods.length - 1][1];
    masks += `<rect class="mk" x="${x0 * s - 4}" y="${row.y0 * s - 4}" width="${(x1 - x0) * s + 8}" height="${(row.y1 - row.y0) * s + 8}" rx="4"/>`;
    row.mods.forEach(([a, b]) => { dots += `<circle class="dt" cx="${((a + b) / 2) * s}" cy="${((row.y0 + row.y1) / 2) * s}" r="6"/>`; });
    for (let j = 0; j < 24; j++) {
      const cx = full.mods[0][0] + j * pitch + (full.mods[0][1] - full.mods[0][0]) / 2;
      if (!row.mods.some(([a, b]) => cx >= a - 4 && cx <= b + 4)) gaps += `<rect class="gp" x="${cx * s - 13}" y="${row.y0 * s - 2}" width="26" height="${(row.y1 - row.y0) * s + 4}" rx="3"/>`;
    }
  });
  r._ov = h("div", "abs", `<svg width="1100" height="688"><g fill="rgba(255,76,0,.28)" stroke="#ff4c00" stroke-width="3">${masks}</g>
    <g fill="#fff" stroke="#22c55e" stroke-width="3">${dots}</g><g fill="rgba(239,68,68,.35)" stroke="#ef4444" stroke-width="3">${gaps}</g></svg>`, box, { left: 0, top: 0 });
  r._cnt = h("div", "abs", `<span class="c" style="font:700 64px var(--disp)">0</span><span style="font:600 30px var(--sans);color:#bdbab3"> / 192 modules</span>`, box, { right: "26px", bottom: "20px", padding: "10px 22px", background: "rgba(15,15,15,.82)", borderRadius: "14px" });
  // nameplates
  r._np = h_("div", "abs", r, { left: "90px", top: "150px", width: "1100px", height: "688px" });
  const fields = ["Manufacturer", "Model", "Voltage", "Power", "Phase", "Frequency"];
  r._plates = [0, 1, 2, 3, 4, 5, 6].map((k) => h("div", "abs card", `<div style="color:#ff7a3d">${ICON.plate}</div><div class="mono" style="font-size:20px;margin-top:6px">NP-0${k + 1}</div>`, r._np,
    { left: 20 + (k % 4) * 270 + "px", top: (k < 4 ? 20 : 250) + "px", width: "240px", height: "200px", display: "grid", placeItems: "center", alignContent: "center", textAlign: "center" }));
  r._n92 = h("div", "abs", `<span class="c" style="font:700 104px/1 var(--disp)">0</span><span style="font:700 52px var(--disp);color:#9b9890"> / 92</span><div class="label" style="margin-top:6px">fields read</div>`, r._np, { left: "830px", top: "262px", textAlign: "left", whiteSpace: "nowrap" });
  r._fields = fields.map((f, k) => h("div", "abs chip okc", `<span style="color:#22c55e;font-weight:800">✓</span>${f}`, r._np, { left: 20 + (k % 3) * 360 + "px", top: 500 + Math.floor(k / 3) * 80 + "px", font: "600 24px var(--sans)" }));
  r._ncr = h("div", "abs chip badc", `<span style="color:#ef4444;font-weight:800">✗</span> P-101-M · plate 0.37 kW · schedule 0.55 kW`, r._np, { left: "20px", top: "660px", font: "600 24px var(--mono)" });
  // the walkthrough
  r._wk = h_("div", "abs", r, { left: "90px", top: "150px", width: "1100px", height: "688px", borderRadius: "18px", overflow: "hidden", background: "#2f3b2a" });
  let strips = "";
  for (let k = 0; k < 13; k++) strips += `<g class="st"><rect x="${70 + k * 75}" y="40" width="44" height="400" rx="4" fill="#3d5a80"/><rect x="${70 + k * 75}" y="40" width="44" height="400" rx="4" fill="none" stroke="#9cc3ff" stroke-width="2"/>
    <text x="${92 + k * 75}" y="486" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="30" fill="#fff" class="sn">${k + 1}</text></g>`;
  r._wk.innerHTML = `<svg width="1100" height="688"><rect width="1100" height="688" fill="#4a6b3a"/>${strips}</svg>
    <div class="say" style="position:absolute;left:40px;right:40px;bottom:30px;padding:18px 24px;background:rgba(10,10,10,.82);border-radius:14px;font:600 32px/1.3 var(--sans)">
    <span class="label" style="color:#f5a524">Narrator · 6.8 s</span><br>“Looking straight down, I count forty module strips in this view.”</div>
    <div class="stamp" style="position:absolute;right:40px;top:40px;padding:14px 26px;border:5px solid #ef4444;color:#ef4444;border-radius:12px;font:800 44px var(--disp);background:rgba(15,15,15,.75)">✗ CONTRADICTED · 13 IN VIEW</div>`;
  r._cards = [["SAM 3.1", "Segments every table of modules on the drone stills.", "8 tables masked"],
    ["Muse Spark 1.3", "Counts the module grid inside each mask, within 5% of a hand count.", "180 of 192 · short by 12"],
    ["Muse Spark 1.3", "Reads every nameplate. Wonder matches it to its schedule row from what the plate shows.", "92 / 92 legible fields exact"],
    ["Muse Spark Open", "Open weights, on Baseten. Hears and watches each clip of the narrated walk.", "every false claim caught"]].map(([m, d, k]) => h("div", "abs", `
      <div class="label" style="color:#ff4c00">Meta model</div><div style="font:700 72px/1.02 var(--disp);letter-spacing:-.04em;margin-top:12px">${m}</div>
      <div class="sub" style="color:#cfccc5;margin-top:22px">${d}</div><div class="chip" style="margin-top:30px;font:700 30px var(--sans)"><span class="dot"></span>${k}</div>`, r, { left: "1260px", top: "220px", width: "600px" }));
  r._exact = h("div", "abs", "Exactly.", r, { left: "1260px", top: "800px", font: "700 84px var(--disp)", color: "#22c55e" });
}, (t, r) => {
  const inB = E.out5(P(t, 58.6, 59.2));
  css(r._box, { opacity: inB * (1 - P(t, 64.0, 64.25)), transform: `perspective(2000px) rotateY(${lerp(-12, 0, inB)}deg)` });
  const zoom = E.inOut(P(t, 61.7, 62.2));
  css(r._img, { transform: `scale(${1 + zoom * 0.35})`, transformOrigin: "50% 45%" });
  css(r._ov, { transform: `scale(${1 + zoom * 0.35})`, transformOrigin: "50% 45%" });
  r._ov.querySelectorAll(".mk").forEach((m, i) => m.setAttribute("opacity", P(t, 59.95 + i * 0.16, 60.2 + i * 0.16) * (1 - P(t, 61.8, 62.2) * 0.6)));
  const nOn = Math.round(180 * E.inOut(P(t, 62.4, 63.9)));
  r._ov.querySelectorAll(".dt").forEach((d, i) => d.setAttribute("opacity", i < nOn ? 1 : 0));
  r._ov.querySelectorAll(".gp").forEach((g) => g.setAttribute("opacity", P(t, 63.85, 64.0)));
  $(".c", r._cnt).textContent = nOn;
  css(r._cnt, { opacity: P(t, 62.3, 62.5) });
  css(r._np, { opacity: P(t, 64.0, 64.25) * (1 - P(t, 68.3, 68.55)) });
  r._plates.forEach((p, k) => pop(p, t, 64.05 + k * 0.08, { from: 0.6, dy: 50 }));
  $(".c", r._n92).textContent = Math.round(92 * E.inOut(P(t, 64.4, 65.9)));
  css(r._n92, { opacity: P(t, 64.35, 64.5), color: t > 65.9 ? "#22c55e" : "#f5f3ee" });
  r._fields.forEach((f, k) => pop(f, t, 64.5 + k * 0.2, { from: 0.6 }));
  pop(r._ncr, t, 66.3, { from: 0.7 });
  css(r._wk, { opacity: P(t, 68.3, 68.55) });
  const say = $(".say", r._wk); css(say, { opacity: P(t, 70.5, 70.8), transform: `translateY(${(1 - E.out(P(t, 70.5, 70.9))) * 30}px)` });
  r._wk.querySelectorAll(".sn").forEach((n, k) => n.setAttribute("opacity", P(t, 71.3 + k * 0.08, 71.4 + k * 0.08)));
  r._wk.querySelectorAll(".st").forEach((g, k) => g.setAttribute("opacity", 0.6 + 0.4 * P(t, 71.3 + k * 0.08, 71.4 + k * 0.08)));
  pop($(".stamp", r._wk), t, 72.55, { from: 2.2, d: 0.35, base: "rotate(-6deg)" });
  r._cards.forEach((c, k) => {
    const a0 = [58.75, 61.75, 64.05, 68.35][k], a1 = [61.7, 64.0, 68.3, 74.4][k];
    const q = E.out5(P(t, a0, a0 + 0.45)), o = E.in(P(t, a1 - 0.2, a1));
    css(c, { opacity: q * (1 - o), transform: `translateX(${(1 - q) * 120 - o * 60}px)` });
  });
  pop(r._exact, t, 67.24, { from: 1.8, d: 0.3, t1: 68.1 });
  css(r.root, { opacity: 1 - P(t, 74.3, 74.6) });
});
sfx(58.6, "whoosh", 0.6); for (let i = 0; i < 8; i++) sfx(59.95 + i * 0.16, "click", 0.3); sfx(62.4, "counter", 0.6); sfx(63.85, "alert", 0.5);
sfx(64.0, "whoosh", 0.6); sfx(64.4, "counter", 0.5); for (let k = 0; k < 6; k++) sfx(64.5 + k * 0.2, "click", 0.4); sfx(66.3, "alert", 0.6); sfx(67.24, "impact", 0.45);
sfx(68.3, "whoosh", 0.6); sfx(71.3, "counter", 0.5); sfx(72.55, "alert", 0.8);

/* ---------------- 8 · the model proposes, code decides ----------------
   VO A8 @74.9: The model proposes 74.9–76.38 · Code decides 76.58–78.06 · Every finding comes with its evidence 78.34–80.5
   · and every report is drafted 80.62–82.45 · and grounding-checked 82.47–83.62 */
vo(74.9, "A8");
scene(74.6, 84.4, (r) => {
  r._l = h("div", "abs", `<div class="label">Muse Wonder</div><div class="h1" style="color:#8c8a84;margin-top:14px">The model<br>proposes.</div>`, r, { left: "130px", top: "200px" });
  r._r = h("div", "abs", `<div class="label" style="color:#ff4c00">gt/tools.py · verify_quantity</div><div class="h1" style="margin-top:14px">Code <span class="o">decides.</span></div>`, r, { left: "960px", top: "200px" });
  r._code = h("div", "abs card code", "", r, { left: "960px", top: "470px", width: "860px", padding: "30px 34px" });
  r._f = h("div", "abs card", `<div style="display:flex;gap:26px"><div style="width:300px;height:190px;border-radius:12px;overflow:hidden;flex:none;position:relative"><img src="assets/drn-a01.jpg" style="width:100%;height:100%;object-fit:cover;object-position:50% 52%"></div>
    <div><span class="chip badc" style="font:700 22px var(--mono)">NCR</span><div class="h3" style="margin-top:14px">Block A: 12 modules missing</div>
    <div style="font:500 22px/1.45 var(--sans);color:#bdbab3;margin-top:10px">180 of 192 counted · design 192<br>Evidence: DRN-A01 · SAM 3.1 + Muse Spark 1.3</div></div></div>`, r, { left: "130px", top: "560px", width: "760px", padding: "26px" });
  r._docs = [["NCR", "#ef4444", "Non-conformance report"], ["RFI", "#f5a524", "Request for information"], ["OBS", "#4f8cff", "Observation report"]].map(([k, c, n], i) =>
    h("div", "abs card", `<div style="font:800 44px var(--disp);color:${c}">${k}</div><div style="font:600 22px var(--sans);margin-top:8px">${n}</div>
      <div style="margin-top:22px;display:grid;gap:10px">${[86, 70, 92, 54].map((w) => `<div style="height:10px;border-radius:5px;background:#333;width:${w}%"></div>`).join("")}</div>`, r,
      { left: 1000 + i * 30 + "px", top: 490 + i * 26 + "px", width: "420px", height: "300px", padding: "28px", borderTop: `8px solid ${c}`, transformOrigin: "50% 100%" }));
  r._stamp = h("div", "abs", "GROUNDING CHECK ✓", r, { left: "1240px", top: "800px", padding: "14px 26px", border: "5px solid #22c55e", color: "#22c55e", borderRadius: "12px", font: "800 40px var(--disp)", background: "rgba(15,15,15,.85)" });
  r._spark = h("div", "abs chip m", `<span class="dot"></span>Drafted by Muse Spark 1.3`, r, { left: "1000px", top: "420px" });
}, (t, r) => {
  pop(r._l, t, 74.95, { from: 0.85, dy: 40 });
  pop(r._r, t, 76.55, { from: 0.85, dy: 40 });
  const L = [`<span class="k">tolerance</span> = round(design * tol_pct / 100)`, `<span class="k">diff</span> = observed - design`,
    `<span class="k">verdict</span> = <span class="s">"pass"</span> if abs(diff) &lt;= tolerance`, `    else (<span class="s">"short"</span> if diff &lt; 0 else <span class="s">"over"</span>)`];
  const n = P(t, 76.9, 78.0) * L.length;
  r._code.innerHTML = L.map((l, i) => `<div style="opacity:${cl(n - i)}">${l}</div>`).join("");
  css(r._code, { opacity: P(t, 76.8, 77.0) * (1 - P(t, 80.3, 80.6)) });
  pop(r._f, t, 78.35, { from: 0.8, dy: 80 });
  r._docs.forEach((d, i) => { const q = E.back(P(t, 80.65 + i * 0.2, 81.15 + i * 0.2)); css(d, { opacity: P(t, 80.65 + i * 0.2, 80.85 + i * 0.2), transform: `rotate(${lerp(0, (i - 1) * 7, q)}deg) translateY(${(1 - q) * 120}px)` }); });
  pop(r._spark, t, 81.95, { from: 0.6 });
  pop(r._stamp, t, 82.6, { from: 2.4, d: 0.35, base: "rotate(-5deg)" });
  css(r.root, { opacity: 1 - P(t, 84.1, 84.4) });
});
sfx(74.95, "whoosh", 0.5); sfx(76.55, "impact", 0.5); sfx(76.9, "typing", 0.4); sfx(78.35, "whoosh", 0.5); [0, 1, 2].forEach((i) => sfx(80.65 + i * 0.2, "click", 0.5)); sfx(82.6, "success");

/* ---------------- 9 · results ----------------
   VO A9 @84.6: Nine of nine problems found 84.6–86.2 · Zero false alarms 86.28–88.2 · About a minute per site 88.36–89.88 · GroundTruth 90.12–91.0
   · Design it 91.16 · Live in it 92.04 · Prove it 92.84–93.64 */
vo(84.6, "A9");
scene(84.4, 94.4, (r) => {
  r._ruler = h_("div", "abs", r, { left: "140px", right: "140px", top: "300px", height: "26px", borderTop: "3px solid #f5f3ee",
    background: "repeating-linear-gradient(90deg,#f5f3ee 0 3px,transparent 3px 10%) 0 0/100% 26px no-repeat, repeating-linear-gradient(90deg,#f5f3ee 0 2px,transparent 2px 2%) 0 0/100% 12px no-repeat", transformOrigin: "0 0" });
  r._s = [["9/9", "planted problems found", "#f5f3ee"], ["0", "false alarms", "#22c55e"], ["~1 min", "per site check", "#ff4c00"]].map(([b, s, c], k) =>
    h("div", "abs", `<div class="v" style="font:700 200px/1 var(--disp);letter-spacing:-.05em;color:${c}">${b}</div><div class="h3 mut" style="margin-top:18px">${s}</div>`, r, { left: 140 + k * 560 + "px", top: "380px" }));
  r._lock = h("div", "abs", `<div style="display:flex;align-items:center;gap:36px;justify-content:center">${LOGO(170)}<div style="font:700 140px/1 var(--disp);letter-spacing:-.05em">GroundTruth</div></div>`, r, { left: 0, right: 0, top: "300px" });
  r._tag = words("Design it. Live in it. *Prove* *it.*", "abs h1", r, { left: 0, right: 0, top: "560px", textAlign: "center" });
}, (t, r) => {
  css(r._ruler, { transform: `scaleX(${E.out(P(t, 84.4, 85.0))})`, opacity: 1 - P(t, 89.6, 90.0) });
  r._s.forEach((s, k) => {
    pop(s, t, [84.65, 86.3, 88.4][k], { from: 0.6, dy: 60, t1: 89.65 });
    if (k === 0) {
      $(".v", s).textContent = `${Math.round(9 * E.out(P(t, 84.65, 85.27)))}/9`;
      const hit = t >= 85.27 ? Math.exp(-(t - 85.27) * 7) : 0; // the music's second drop
      css($(".v", s), { transform: `scale(${1 + hit * 0.12})`, transformOrigin: "0 80%", color: hit > 0.05 ? "#ff7a3d" : "#f5f3ee" });
    }
  });
  pop(r._lock, t, 90.05, { from: 0.7, d: 0.55, dy: 40 });
  r._tag._w.forEach((s, i) => { const t0 = [91.16, 91.5, 92.04, 92.26, 92.42, 92.84, 93.2][i] ?? 93.2; const q = E.back(P(t, t0, t0 + 0.35)); css(s, { opacity: P(t, t0, t0 + 0.15), transform: `translateY(${(1 - q) * 50}px)` }); });
  css(r.root, { opacity: 1 - P(t, 94.1, 94.4) });
});
sfx(84.65, "counter", 0.8); sfx(85.27, "impact", 0.55); sfx(86.3, "success", 0.6); sfx(88.4, "impact", 0.4); sfx(90.05, "impact", 0.7); sfx(92.84, "click", 0.6);

/* ---------------- 10 · end card ---------------- */
scene(94.4, 100.5, (r) => {
  r._c = h("div", "center", `<div style="display:flex;align-items:center;gap:30px;justify-content:center">${LOGO(130)}<div style="font:700 110px/1 var(--disp);letter-spacing:-.05em">GroundTruth</div></div>
    <div class="h3" style="margin-top:34px">Design it. Live in it. <span class="o">Prove it.</span></div>
    <div style="margin-top:50px;display:flex;gap:18px;justify-content:center">${MODELS.map(([m]) => `<span class="chip m"><span class="dot"></span>${m}</span>`).join("")}</div>
    <div style="margin-top:56px;font:600 34px var(--mono)">groundtruth-mu-gules.vercel.app</div>
    <div style="margin-top:14px;font:500 28px var(--mono);color:#9b9890">github.com/compiler-aditya/groundtruth</div>
    <div style="margin-top:46px;font:500 24px var(--sans);color:#9b9890">Built Oct 31 – Nov 4, 2026 for the Meta Global AI Developer Hackathon</div>`, r, { width: "1700px" });
}, (t, r) => {
  const q = E.out5(P(t, 94.4, 95.1));
  css(r._c, { opacity: q * (1 - P(t, 99.7, 100.5)), transform: `translate(-50%,-50%) scale(${lerp(0.94, 1, q)})` });
});

/* ---------------- the frame ---------------- */
async function boot() {
  AD.modules = await (await fetch("assets/modules.json")).json();
  const host = $("#scenes");
  for (const s of AD.scenes) {
    s.root = h_("div", "scene", host); s.root.root = s.root;
    const before = new Set(Object.keys(AD.frames));
    s.build(s.root);
    const mine = Object.keys(AD.frames).filter((n) => !before.has(n));
    if (mine.length) s.live = mine;
  }
  // the time map to the current voiceover (warp.json, from build_warp.py): the scenes are written against the first
  // read; seek(t) maps t back onto them, and the cues and actions move with their words
  const warp = new URLSearchParams(location.search).has("nowarp") ? null : await fetch("warp.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (warp) {
    const A = warp.anchors, map = (t, from, to) => {
      if (t <= A[0][from]) return t - A[0][from] + A[0][to];
      for (let i = 1; i < A.length; i++) if (t <= A[i][from]) {
        const a = A[i - 1], b = A[i];
        return a[to] + ((t - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
      }
      return t - A[A.length - 1][from] + A[A.length - 1][to];
    };
    AD.W = (t) => map(t, 0, 1);
    AD.Winv = (t) => map(t, 1, 0);
    AD.sfx.forEach((c) => (c.t = +AD.W(c.t).toFixed(3)));
    AD.actions.forEach((c) => (c.t = +AD.W(c.t).toFixed(3)));
    AD.vo = Object.entries(warp.vo).map(([name, t]) => ({ t, name }));
    AD.duration = warp.duration;
  }
  AD.sfx.sort((a, b) => a.t - b.t); AD.actions.sort((a, b) => a.t - b.t);
  window.seek(0);
  AD.ready = true;
}
window.seek = (tv) => {
  const t = AD.Winv ? AD.Winv(tv) : tv; // the scenes' own time
  for (const s of AD.scenes) {
    const on = t >= s.a && t < s.b;
    // a scene holding a live frame stays laid out (hidden), so the product inside keeps its size
    if (s.live) s.root.style.cssText += on ? ";display:block;visibility:visible" : ";display:block;visibility:hidden";
    else s.root.style.display = on ? "block" : "none";
    s.on = on;
    if (on) s.update(t, s.root);
  }
  css($("#grid"), { transform: `translate(${-(t * 26) % 34}px, ${-(t * 14) % 34}px)` });
  let f = 0;
  for (const [ft, k] of flashes) f = Math.max(f, k * (1 - P(t, ft, ft + 0.22)) * (t >= ft ? 1 : 0));
  $("#flash").style.opacity = f;
  // which live frames are on screen and so need their clocks moved
  return AD.scenes.filter((s) => s.on && s.live).flatMap((s) => s.live);
};
boot();
