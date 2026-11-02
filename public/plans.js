/* GroundTruth floor plan studio: the plans page and the plan editor. Plain JS; plans are saved in this browser.
   Units are metres. Rooms are axis-aligned rectangles; walls are worked out from where rooms touch. */
"use strict";
window.GTPlans = (() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = (p) => p + Math.random().toString(36).slice(2, 9);
  const r2 = (n) => Math.round(n * 100) / 100;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtM = (n) => `${n.toFixed(2)} m`;
  const fmtA = (n) => `${n.toFixed(1)} m²`;
  const INK = "#22211d", PAPER = "#fbfaf6", ACCENT = "#1f5f4a";

  /* ---------------- model ---------------- */
  const ROOM_TYPES = {
    living: ["Living room", "#ead9b0"], bedroom: ["Bedroom", "#c9dcf2"], kitchen: ["Kitchen", "#f2d2bd"], dining: ["Dining", "#eedfc0"],
    bathroom: ["Bathroom", "#c3e8e2"], hallway: ["Hallway", "#e4e1d9"], office: ["Office", "#d8e0f4"], meeting: ["Meeting room", "#ded5f2"],
    reception: ["Reception", "#eadcf0"], storage: ["Storage", "#dedede"], garage: ["Garage", "#d6d6d4"], balcony: ["Balcony or terrace", "#d4ebcb"],
    utility: ["Utility", "#e8e2cf"], retail: ["Shop floor", "#f0e0c8"], other: ["Other", "#e9e9e6"],
  };
  const KINDS = { house: "House", apartment: "Apartment", office: "Office", shop: "Shop", clinic: "Clinic", other: "Other building" };
  // type: [label, width, depth] in metres, before rotation
  const ITEM_TYPES = {
    bed_double: ["Double bed", 1.6, 2.0], bed_single: ["Single bed", 0.9, 2.0], sofa: ["Sofa", 2.0, 0.9], armchair: ["Armchair", 0.8, 0.8],
    dining_table: ["Dining table", 1.6, 0.9], meeting_table: ["Meeting table", 2.4, 1.2], desk: ["Desk", 1.4, 0.7], wardrobe: ["Wardrobe", 1.2, 0.6],
    counter: ["Kitchen counter", 2.4, 0.6], stove: ["Cooker", 0.6, 0.6], kitchen_sink: ["Kitchen sink", 0.8, 0.5], fridge: ["Fridge", 0.7, 0.7],
    toilet: ["Toilet", 0.45, 0.7], basin: ["Washbasin", 0.5, 0.4], shower: ["Shower", 0.9, 0.9], bathtub: ["Bathtub", 1.7, 0.75],
    stairs: ["Stairs", 1.0, 3.0], car: ["Car", 1.9, 4.5], plant: ["Plant", 0.5, 0.5],
  };
  const OPENING_TYPES = { door: ["Door", 0.9], window: ["Window", 1.2], opening: ["Open passage", 1.2] };
  const area = (r) => r.w * r.h;
  const totalArea = (plan) => plan.rooms.reduce((s, r) => s + area(r), 0);

  function build(meta, rooms, openings, items) {
    const ids = {};
    const R = rooms.map(([key, name, type, x, y, w, h]) => { const r = { id: uid("r"), name, type, x, y, w, h }; ids[key] = r.id; return r; });
    const O = openings.map(([type, key, side, at, width, hinge = "start", swing = "in"]) => ({ id: uid("o"), type, room: ids[key], side, at, width, hinge, swing }));
    const I = items.map(([type, x, y, rot = 0]) => { // x, y: top-left of the footprint as placed
      const [, w, h] = ITEM_TYPES[type], fw = rot % 180 ? h : w, fh = rot % 180 ? w : h;
      return { id: uid("i"), type, cx: r2(x + fw / 2), cy: r2(y + fh / 2), w, h, rot };
    });
    const now = Date.now();
    return { v: 1, id: uid("p"), sheet: "A-101", revision: "A", author: "", ...meta, rooms: R, openings: O, items: I, created: now, updated: now };
  }

  const TEMPLATES = {
    blank: { name: "Blank plan", text: "An empty page. Draw your first room.", make: () => build({ name: "My plan", kind: "house" }, [], [], []) },
    studio: { name: "Studio apartment", text: "One room to live and sleep, a kitchen and a bathroom.", make: () => build({ name: "Studio apartment", kind: "apartment" }, [
      ["liv", "Living and sleeping", "living", 0, 0, 6, 3.8], ["kit", "Kitchen", "kitchen", 0, 3.8, 3.4, 2.2], ["bath", "Bathroom", "bathroom", 3.4, 3.8, 2.6, 2.2],
    ], [
      ["door", "kit", "w", 1.1, 0.9], ["opening", "liv", "s", 1.7, 1.6], ["door", "bath", "n", 1.3, 0.8, "end"],
      ["window", "liv", "n", 1.6, 1.6], ["window", "liv", "n", 4.4, 1.6], ["window", "liv", "e", 1.9, 1.2], ["window", "kit", "s", 1.7, 1.0], ["window", "bath", "e", 1.1, 0.6],
    ], [
      ["bed_double", 4.1, 0.3], ["wardrobe", 4.4, 3.1], ["sofa", 0.4, 2.6], ["dining_table", 2.6, 1.0], ["counter", 0.9, 5.35], ["stove", 2.3, 5.35],
      ["kitchen_sink", 1.2, 5.4], ["fridge", 2.7, 3.85], ["shower", 3.5, 5.0], ["toilet", 5.4, 5.2], ["basin", 5.4, 4.7],
    ]) },
    home: { name: "Two-bedroom home", text: "Living room and kitchen, a hallway, two bedrooms and a bathroom.", make: () => build({ name: "Two-bedroom home", kind: "house" }, [
      ["liv", "Living room", "living", 0, 0, 6, 4.5], ["kit", "Kitchen and dining", "kitchen", 6, 0, 4, 4.5], ["hall", "Hallway", "hallway", 0, 4.5, 10, 1.2],
      ["bed1", "Bedroom 1", "bedroom", 0, 5.7, 3.8, 3.3], ["bath", "Bathroom", "bathroom", 3.8, 5.7, 2.4, 3.3], ["bed2", "Bedroom 2", "bedroom", 6.2, 5.7, 3.8, 3.3],
    ], [
      ["door", "hall", "w", 0.6, 0.9], ["door", "liv", "s", 4.5, 0.9, "end", "out"], ["door", "kit", "s", 1.0, 0.9, "start", "out"], ["opening", "liv", "e", 2.6, 1.6],
      ["door", "bed1", "n", 3.0, 0.8, "end"], ["door", "bath", "n", 1.2, 0.8], ["door", "bed2", "n", 0.8, 0.8],
      ["window", "liv", "n", 3.0, 2.4], ["window", "liv", "w", 2.2, 1.4], ["window", "kit", "n", 2.0, 1.4], ["window", "kit", "e", 2.2, 1.2],
      ["window", "bed1", "w", 1.65, 1.2], ["window", "bath", "s", 1.2, 0.6], ["window", "bed2", "s", 1.9, 1.5], ["window", "bed2", "e", 1.6, 1.0],
    ], [
      ["sofa", 0.6, 3.3], ["armchair", 3.4, 3.3], ["dining_table", 7.0, 2.4], ["counter", 6.6, 0.1], ["stove", 8.0, 0.1], ["kitchen_sink", 7.0, 0.15], ["fridge", 9.2, 0.8],
      ["bed_double", 0.3, 6.9], ["wardrobe", 2.5, 8.3], ["bathtub", 4.0, 8.15], ["toilet", 5.6, 6.8], ["basin", 3.9, 6.8], ["bed_double", 7.9, 6.9], ["desk", 6.3, 8.2],
    ]) },
    office: { name: "Small office", text: "Open-plan desks, a meeting room, kitchenette, reception and toilets.", make: () => build({ name: "Small office", kind: "office" }, [
      ["open", "Open office", "office", 0, 0, 7.5, 5], ["meet", "Meeting room", "meeting", 7.5, 0, 4.5, 3.2], ["kit", "Kitchenette", "kitchen", 7.5, 3.2, 4.5, 1.8],
      ["cor", "Corridor", "hallway", 0, 5, 12, 1.4], ["rec", "Reception", "reception", 0, 6.4, 4, 2.6], ["wc1", "WC", "bathroom", 4, 6.4, 1.8, 2.6],
      ["wc2", "WC", "bathroom", 5.8, 6.4, 1.8, 2.6], ["sto", "Storage", "storage", 7.6, 6.4, 4.4, 2.6],
    ], [
      ["door", "rec", "s", 2.0, 1.0, "start", "out"], ["opening", "rec", "n", 2.0, 1.6], ["opening", "open", "s", 2.0, 1.2], ["door", "meet", "w", 2.4, 0.9],
      ["door", "kit", "s", 1.0, 0.9], ["door", "wc1", "n", 0.9, 0.8], ["door", "wc2", "n", 0.9, 0.8], ["door", "sto", "n", 1.0, 0.9],
      ["window", "open", "n", 1.5, 1.6], ["window", "open", "n", 4.0, 1.6], ["window", "open", "n", 6.3, 1.4], ["window", "open", "w", 2.5, 1.6],
      ["window", "meet", "n", 2.2, 1.8], ["window", "meet", "e", 1.6, 1.2], ["window", "kit", "e", 0.9, 0.8], ["window", "rec", "w", 1.3, 1.2],
    ], [
      ["desk", 0.4, 0.6], ["desk", 2.2, 0.6], ["desk", 4.0, 0.6], ["desk", 0.4, 2.6], ["desk", 2.2, 2.6], ["desk", 4.0, 2.6], ["meeting_table", 8.6, 1.0],
      ["counter", 9.4, 4.3], ["fridge", 8.6, 4.2], ["desk", 1.3, 7.2], ["sofa", 0.3, 8.0], ["toilet", 4.7, 8.1], ["basin", 4.2, 6.9], ["toilet", 6.5, 8.1], ["basin", 6.0, 6.9],
    ]) },
  };

  /* ---------------- storage (this browser only) ---------------- */
  const KEY = "gt.plans.v1";
  let memory = {}; // used when the browser refuses storage
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return memory; }
  }
  function saveAll(all) {
    memory = all;
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
  }
  function savePlan(plan) {
    const all = loadAll();
    plan.updated = Date.now();
    all[plan.id] = plan;
    return saveAll(all);
  }
  const getPlan = (id) => loadAll()[id];
  function deletePlan(id) { const all = loadAll(); delete all[id]; saveAll(all); }

  /* ---------------- geometry ---------------- */
  const EPS = 0.02, EXT = 0.2, INT = 0.1; // wall thickness: exterior, interior
  const roomOf = (plan, id) => plan.rooms.find((r) => r.id === id);
  function edges(r) {
    return [{ room: r.id, side: "n", o: "h", c: r.y, a: r.x, b: r.x + r.w }, { room: r.id, side: "s", o: "h", c: r.y + r.h, a: r.x, b: r.x + r.w },
      { room: r.id, side: "w", o: "v", c: r.x, a: r.y, b: r.y + r.h }, { room: r.id, side: "e", o: "v", c: r.x + r.w, a: r.y, b: r.y + r.h }];
  }
  function merge(iv) {
    const out = [];
    for (const [a, b] of iv.slice().sort((p, q) => p[0] - q[0])) {
      if (out.length && a <= out[out.length - 1][1] + 1e-6) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
      else out.push([a, b]);
    }
    return out;
  }
  function cut(pieces, cuts, capNew) { // pieces: [a, b, capA, capB]; a cap extends the wall by half its thickness
    let res = pieces;
    for (const [u, v] of cuts) {
      const next = [];
      for (const [a, b, ca, cb] of res) {
        if (v <= a + 1e-6 || u >= b - 1e-6) { next.push([a, b, ca, cb]); continue; }
        if (u > a + 1e-6) next.push([a, u, ca, capNew]);
        if (v < b - 1e-6) next.push([v, b, capNew, cb]);
      }
      res = next;
    }
    return res;
  }
  function sideLength(r, side) { return side === "n" || side === "s" ? r.w : r.h; }
  function openingGeom(plan, op) {
    const r = roomOf(plan, op.room);
    if (!r) return null;
    const horiz = op.side === "n" || op.side === "s", len = sideLength(r, op.side);
    const width = Math.min(op.width, len), at = clamp(op.at, width / 2, len - width / 2);
    const c = { n: r.y, s: r.y + r.h, w: r.x, e: r.x + r.w }[op.side];
    const mid = (horiz ? r.x : r.y) + at;
    const inward = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[op.side];
    return { op, o: horiz ? "h" : "v", c, a: mid - width / 2, b: mid + width / 2, mid, width, inward };
  }
  // Is the stretch [a, b] of the line (o, c) shared by two rooms (an interior wall)?
  function shared(plan, o, c, a, b) {
    const hits = plan.rooms.flatMap(edges).filter((e) => e.o === o && Math.abs(e.c - c) < EPS && e.a < b - EPS && e.b > a + EPS);
    return new Set(hits.map((e) => e.room)).size > 1;
  }
  function walls(plan) {
    const all = plan.rooms.flatMap(edges);
    const gaps = plan.openings.map((op) => openingGeom(plan, op)).filter(Boolean);
    const out = [];
    for (const e of all) {
      const covered = merge(all.filter((f) => f.room !== e.room && f.o === e.o && Math.abs(f.c - e.c) < EPS && f.b > e.a + EPS && f.a < e.b - EPS)
        .map((f) => [Math.max(e.a, f.a), Math.min(e.b, f.b)]));
      const g = merge(gaps.filter((o) => o.o === e.o && Math.abs(o.c - e.c) < EPS).map((o) => [o.a, o.b]));
      cut(cut([[e.a, e.b, true, true]], covered, true), g, false).forEach(([a, b, ca, cb]) => out.push({ o: e.o, c: e.c, a, b, ca, cb, t: EXT }));
      cut(covered.map(([a, b]) => [a, b, true, true]), g, false).forEach(([a, b, ca, cb]) => out.push({ o: e.o, c: e.c, a, b, ca, cb, t: INT }));
    }
    return out;
  }
  function bounds(plan) {
    const xs = [], ys = [];
    for (const r of plan.rooms) xs.push(r.x, r.x + r.w), ys.push(r.y, r.y + r.h);
    for (const it of plan.items) { const [fw, fh] = footprint(it); xs.push(it.cx - fw / 2, it.cx + fw / 2); ys.push(it.cy - fh / 2, it.cy + fh / 2); }
    if (!xs.length) return { x: 0, y: 0, w: 10, h: 8 };
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const footprint = (it) => (it.rot % 180 ? [it.h, it.w] : [it.w, it.h]);
  function fitView(plan, W, H, pad = 50) {
    const b = bounds(plan);
    const s = clamp(Math.min((W - 2 * pad) / Math.max(b.w, 1), (H - 2 * pad) / Math.max(b.h, 1)), 8, 400);
    return { s, tx: (W - b.w * s) / 2 - b.x * s, ty: (H - b.h * s) / 2 - b.y * s };
  }

  /* ---------------- drawing ---------------- */
  // Returns SVG markup for a plan in screen pixels. opts: { width, height, grid, labels, sel, hover, dims }
  function drawPlan(plan, view, opts = {}) {
    const { s, tx, ty } = view;
    const X = (x) => r2(tx + x * s), Y = (y) => r2(ty + y * s), L = (d) => r2(d * s);
    const out = [];
    if (opts.grid) out.push(grid(view, opts.width, opts.height));
    for (const r of plan.rooms) {
      out.push(`<rect class="room" data-kind="room" data-id="${r.id}" x="${X(r.x)}" y="${Y(r.y)}" width="${L(r.w)}" height="${L(r.h)}" fill="${(ROOM_TYPES[r.type] || ROOM_TYPES.other)[1]}" fill-opacity=".72"/>`);
    }
    for (const it of plan.items) out.push(drawItem(it, X, Y, L));
    for (const w of walls(plan)) {
      const ext = (cap) => (cap ? w.t / 2 : 0);
      const a = w.a - ext(w.ca), b = w.b + ext(w.cb);
      out.push(w.o === "h"
        ? `<line x1="${X(a)}" y1="${Y(w.c)}" x2="${X(b)}" y2="${Y(w.c)}" stroke="${INK}" stroke-width="${Math.max(1.5, L(w.t))}"/>`
        : `<line x1="${X(w.c)}" y1="${Y(a)}" x2="${X(w.c)}" y2="${Y(b)}" stroke="${INK}" stroke-width="${Math.max(1.5, L(w.t))}"/>`);
    }
    for (const op of plan.openings) out.push(drawOpening(plan, op, X, Y, L));
    if (opts.labels !== false) for (const r of plan.rooms) {
      const w = L(r.w), h = L(r.h), cx = X(r.x + r.w / 2), cy = Y(r.y + r.h / 2);
      if (w < 34 || h < 22) continue;
      const big = w > 70 && h > 40;
      const halo = `stroke="${PAPER}" stroke-width="3" stroke-opacity=".85" paint-order="stroke" stroke-linejoin="round"`;
      out.push(`<text class="lbl" x="${cx}" y="${cy - (big ? 3 : -4)}" text-anchor="middle" font-size="${big ? 12.5 : 11}" font-weight="600" fill="${INK}" ${halo}>${esc(fit(r.name, w))}</text>`);
      if (big) out.push(`<text class="lbl" x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="11" fill="#5a5850" ${halo}>${fmtA(area(r))}</text>`);
    }
    if (opts.overlay) out.push(opts.overlay(X, Y, L));
    return out.join("");
  }
  const fit = (text, px) => (text.length * 6.6 > px ? text.slice(0, Math.max(1, Math.floor(px / 6.6) - 1)) + "…" : text);

  function grid(view, W, H) {
    const { s, tx, ty } = view, step = s >= 40 ? 0.5 : s >= 14 ? 1 : 5, out = [];
    const x0 = Math.floor(-tx / s / step) * step, y0 = Math.floor(-ty / s / step) * step;
    for (let x = x0; tx + x * s <= W; x += step) {
      const major = Math.abs(x - Math.round(x)) < 1e-6 && (step < 5 || Math.round(x) % 5 === 0);
      out.push(`<line x1="${r2(tx + x * s)}" y1="0" x2="${r2(tx + x * s)}" y2="${H}" stroke="${INK}" stroke-opacity="${major ? 0.09 : 0.04}"/>`);
    }
    for (let y = y0; ty + y * s <= H; y += step) {
      const major = Math.abs(y - Math.round(y)) < 1e-6 && (step < 5 || Math.round(y) % 5 === 0);
      out.push(`<line x1="0" y1="${r2(ty + y * s)}" x2="${W}" y2="${r2(ty + y * s)}" stroke="${INK}" stroke-opacity="${major ? 0.09 : 0.04}"/>`);
    }
    return `<g class="grid" pointer-events="none">${out.join("")}</g>`;
  }

  function drawOpening(plan, op, X, Y, L) {
    const g = openingGeom(plan, op);
    if (!g) return "";
    const t = shared(plan, g.o, g.c, g.a, g.b) ? INT : EXT;
    const P = (along, across) => (g.o === "h" ? [X(along), Y(g.c + across)] : [X(g.c + across), Y(along)]);
    const line = (p, q, extra = "") => `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" ${extra}/>`;
    const parts = [];
    // jambs: short ticks across the wall at both ends
    for (const e of [g.a, g.b]) parts.push(line(P(e, -t / 2), P(e, t / 2), `stroke="${INK}" stroke-width="1.5"`));
    if (op.type === "window") {
      for (const off of [-t / 2, 0, t / 2]) parts.push(line(P(g.a, off), P(g.b, off), `stroke="${INK}" stroke-width="${off ? 1.2 : 0.8}"`));
    } else if (op.type === "door") {
      const dir = op.swing === "out" ? -1 : 1, n = g.inward.map((v) => v * dir);
      const hinge = op.hinge === "end" ? g.b : g.a, other = op.hinge === "end" ? g.a : g.b;
      const H = g.o === "h" ? [hinge, g.c] : [g.c, hinge], C = g.o === "h" ? [other, g.c] : [g.c, other];
      const O = [H[0] + n[0] * g.width, H[1] + n[1] * g.width];
      const cross = (O[0] - H[0]) * (C[1] - H[1]) - (O[1] - H[1]) * (C[0] - H[0]);
      const sp = (p) => [X(p[0]), Y(p[1])];
      parts.push(line(sp(H), sp(O), `stroke="${INK}" stroke-width="2"`));
      parts.push(`<path d="M${sp(O).join(",")} A${L(g.width)},${L(g.width)} 0 0 ${cross > 0 ? 1 : 0} ${sp(C).join(",")}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="3 2"/>`);
    }
    // a generous invisible target so the opening is easy to pick
    const [p, q] = [P(g.a, -0.25), P(g.b, 0.25)];
    parts.push(`<rect data-kind="opening" data-id="${op.id}" x="${Math.min(p[0], q[0])}" y="${Math.min(p[1], q[1])}" width="${Math.abs(q[0] - p[0])}" height="${Math.abs(q[1] - p[1])}" fill="transparent"/>`);
    return `<g class="opening">${parts.join("")}</g>`;
  }

  function drawItem(it, X, Y, L) {
    const w = L(it.w), h = L(it.h), x = X(it.cx) - w / 2, y = Y(it.cy) - h / 2;
    const st = `fill="#ffffff" fill-opacity=".85" stroke="${INK}" stroke-width="1"`, ln = `stroke="${INK}" stroke-width="1" fill="none"`;
    const R = (a, b, c, d, extra = st) => `<rect x="${r2(x + a * w)}" y="${r2(y + b * h)}" width="${r2(c * w)}" height="${r2(d * h)}" ${extra}/>`;
    const C = (a, b, rad, extra = ln) => `<circle cx="${r2(x + a * w)}" cy="${r2(y + b * h)}" r="${r2(rad)}" ${extra}/>`;
    const Ln = (a, b, c, d) => `<line x1="${r2(x + a * w)}" y1="${r2(y + b * h)}" x2="${r2(x + c * w)}" y2="${r2(y + d * h)}" ${ln}/>`;
    const E = (a, b, rx, ry) => `<ellipse cx="${r2(x + a * w)}" cy="${r2(y + b * h)}" rx="${r2(rx * w)}" ry="${r2(ry * h)}" ${ln}/>`;
    let body;
    switch (it.type) {
      case "bed_double": case "bed_single":
        body = R(0, 0, 1, 1) + (it.type === "bed_double" ? R(0.08, 0.04, 0.38, 0.14) + R(0.54, 0.04, 0.38, 0.14) : R(0.12, 0.04, 0.76, 0.14)) + Ln(0, 0.3, 1, 0.3); break;
      case "sofa": case "armchair": body = R(0, 0, 1, 1) + R(0, 0, 1, 0.28) + R(0, 0.28, 0.14, 0.72) + R(0.86, 0.28, 0.14, 0.72); break;
      case "dining_table": case "meeting_table": {
        const n = Math.max(2, Math.round(it.w / 0.6));
        body = Array.from({ length: n }, (_, i) => R((i + 0.5) / n - 0.08, 0, 0.16, 0.14) + R((i + 0.5) / n - 0.08, 0.86, 0.16, 0.14)).join("") + R(0.04, 0.16, 0.92, 0.68);
        break;
      }
      case "desk": body = R(0, 0, 1, 0.75) + C(0.5, 0.88, Math.min(w, h) * 0.16); break;
      case "wardrobe": body = R(0, 0, 1, 1) + Ln(0.04, 0.5, 0.96, 0.5) + Ln(0.2, 0.3, 0.2, 0.7) + Ln(0.5, 0.3, 0.5, 0.7) + Ln(0.8, 0.3, 0.8, 0.7); break;
      case "counter": body = R(0, 0, 1, 1); break;
      case "stove": body = R(0, 0, 1, 1) + [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].map(([a, b]) => C(a, b, Math.min(w, h) * 0.14)).join(""); break;
      case "kitchen_sink": body = R(0, 0, 1, 1) + R(0.12, 0.15, 0.76, 0.7, ln) + C(0.5, 0.5, 2); break;
      case "fridge": body = R(0, 0, 1, 1) + Ln(0, 0.82, 1, 0.82) + Ln(0.15, 0.15, 0.85, 0.85); break;
      case "toilet": body = R(0.05, 0, 0.9, 0.28) + E(0.5, 0.62, 0.42, 0.34); break;
      case "basin": body = R(0, 0, 1, 1) + E(0.5, 0.52, 0.36, 0.32); break;
      case "shower": body = R(0, 0, 1, 1) + Ln(0, 0, 1, 1) + Ln(1, 0, 0, 1) + C(0.5, 0.5, 2.5); break;
      case "bathtub": body = R(0, 0, 1, 1) + `<rect x="${r2(x + 0.07 * w)}" y="${r2(y + 0.12 * h)}" width="${r2(0.86 * w)}" height="${r2(0.76 * h)}" rx="${r2(0.3 * h)}" ${ln}/>` + C(0.85, 0.5, 2.5); break;
      case "stairs": {
        const n = Math.max(3, Math.round(it.h / 0.28));
        body = R(0, 0, 1, 1) + Array.from({ length: n - 1 }, (_, i) => Ln(0, (i + 1) / n, 1, (i + 1) / n)).join("") + Ln(0.5, 0.92, 0.5, 0.1) + Ln(0.38, 0.22, 0.5, 0.1) + Ln(0.62, 0.22, 0.5, 0.1);
        break;
      }
      case "car": body = `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(0.18 * w)}" ${st}/>` + R(0.12, 0.24, 0.76, 0.16, ln) + R(0.12, 0.66, 0.76, 0.12, ln); break;
      case "plant": body = C(0.5, 0.5, Math.min(w, h) * 0.5, st) + C(0.5, 0.5, Math.min(w, h) * 0.22); break;
      default: body = R(0, 0, 1, 1);
    }
    return `<g class="item" data-kind="item" data-id="${it.id}" transform="rotate(${it.rot || 0} ${r2(X(it.cx))} ${r2(Y(it.cy))})">${body}</g>`;
  }

  // Door, window and passage marks (D1, W1, P1) in plan order, as used on the sheet and in the schedule.
  function marks(plan) {
    const m = {}, n = { door: 0, window: 0, opening: 0 }, P = { door: "D", window: "W", opening: "P" };
    for (const op of plan.openings) m[op.id] = P[op.type] + ++n[op.type];
    return m;
  }

  // A drawing sheet: the plan with opening marks, the room and opening schedules, and a title block.
  function sheetSvg(plan) {
    const W = 1600, H = 1131, col = 1180, mk = marks(plan);
    const view = fitView(plan, col - 60, H - 60, 60);
    view.tx += 30; view.ty += 30;
    const T = (x, y, text, size = 13, extra = "") => `<text x="${x}" y="${y}" font-size="${size}" fill="${INK}" ${extra}>${esc(text)}</text>`;
    const markLayer = (X, Y) => plan.openings.map((op) => {
      const og = openingGeom(plan, op);
      if (!og) return "";
      const off = 0.45 * (op.type === "door" && op.swing === "out" ? 1 : -1); // on the side away from the door's swing
      const [x, y] = og.o === "h" ? [X(og.mid), Y(og.c + og.inward[1] * off)] : [X(og.c + og.inward[0] * off), Y(og.mid)];
      return `<circle cx="${x}" cy="${y}" r="11" fill="#fff" stroke="${INK}"/><text x="${x}" y="${r2(y + 3.5)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${INK}">${mk[op.id]}</text>`;
    }).join("");
    const out = [`<rect width="${W}" height="${H}" fill="#fff"/><rect x="15" y="15" width="${W - 30}" height="${H - 30}" fill="none" stroke="${INK}" stroke-width="2"/>`,
      `<line x1="${col}" y1="15" x2="${col}" y2="${H - 15}" stroke="${INK}" stroke-width="1.5"/>`, drawPlan(plan, view, { overlay: markLayer })];
    let y = 52;
    const x0 = col + 20, x1 = W - 35;
    out.push(T(x0, y, "Room schedule", 15, 'font-weight="700"'));
    y += 24;
    for (const r of plan.rooms.slice(0, 18)) {
      out.push(T(x0, y, fit(r.name, 210), 12.5), T(x0 + 230, y, (ROOM_TYPES[r.type] || ROOM_TYPES.other)[0], 11.5, 'fill-opacity=".65"'), T(x1, y, fmtA(area(r)), 12.5, 'text-anchor="end"'));
      y += 19;
    }
    if (plan.rooms.length > 18) { out.push(T(x0, y, `+ ${plan.rooms.length - 18} more rooms`, 11.5)); y += 19; }
    out.push(`<line x1="${x0}" y1="${y - 12}" x2="${x1}" y2="${y - 12}" stroke="${INK}"/>`, T(x0, y + 4, "Total floor area", 12.5, 'font-weight="700"'),
      T(x1, y + 4, fmtA(totalArea(plan)), 12.5, 'text-anchor="end" font-weight="700"'));
    y += 44;
    out.push(T(x0, y, "Door and window schedule", 15, 'font-weight="700"'));
    y += 22;
    out.push(T(x0, y, "Mark", 11, 'font-weight="700"'), T(x0 + 50, y, "Type", 11, 'font-weight="700"'), T(x0 + 160, y, "Room", 11, 'font-weight="700"'), T(x1, y, "Width", 11, 'text-anchor="end" font-weight="700"'));
    y += 18;
    for (const op of plan.openings.slice(0, 24)) {
      out.push(T(x0, y, mk[op.id], 12, 'font-weight="700"'), T(x0 + 50, y, OPENING_TYPES[op.type][0], 12), T(x0 + 160, y, fit(roomOf(plan, op.room)?.name || "", 150), 12),
        T(x1, y, fmtM(op.width), 12, 'text-anchor="end"'));
      y += 18;
    }
    if (plan.openings.length > 24) out.push(T(x0, y, `+ ${plan.openings.length - 24} more`, 11.5));
    // title block
    const tb = H - 275, rows = [["Project", plan.name], ["Building", KINDS[plan.kind] || ""], ["Drawing", "Floor plan"],
      ["Sheet", plan.sheet || "A-101"], ["Revision", plan.revision || "A"], ["Date", new Date().toISOString().slice(0, 10)], ["Drawn by", plan.author || "—"]];
    out.push(`<line x1="${col}" y1="${tb}" x2="${W - 15}" y2="${tb}" stroke="${INK}" stroke-width="1.5"/>`);
    rows.forEach(([k, v], i) => out.push(T(x0, tb + 28 + i * 24, k, 11.5, 'fill-opacity=".65"'), T(x0 + 100, tb + 28 + i * 24, fit(String(v), 260), 14, i === 0 ? 'font-weight="700"' : "")));
    const m = [0.5, 1, 2, 5, 10].find((v) => v * view.s >= 80) || 10, by = H - 40;
    out.push(`<line x1="${x0}" y1="${by}" x2="${r2(x0 + m * view.s)}" y2="${by}" stroke="${INK}" stroke-width="3"/>`, T(r2(x0 + m * view.s + 8), by + 4, `${m} m`, 12),
      T(x1, by + 4, "Made with GroundTruth", 11, 'text-anchor="end" fill-opacity=".6"'));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">${out.join("")}</svg>`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const slug = (plan) => `${(plan.name || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan"}-${plan.sheet || "A-101"}-rev-${plan.revision || "A"}`;
  function exportPng(plan) {
    const svg = sheetSvg(plan), img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 3200; c.height = 2262;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => download(b, `${slug(plan)}.png`), "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function thumb(plan, W = 280, H = 180) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(plan.name)}"><rect width="${W}" height="${H}" fill="${PAPER}"/>${
      plan.rooms.length ? drawPlan(plan, fitView(plan, W, H, 14), { labels: false }) : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#9a9890">Empty</text>`}</svg>`;
  }

  /* ---------------- plans page ---------------- */
  function renderList(app) {
    const mine = Object.values(loadAll()).sort((a, b) => b.updated - a.updated);
    app.innerHTML = `
    <div class="page-head"><div class="eyebrow">Floor plan studio</div><h1>Design a home, an office or any building, room by room</h1>
      <p class="muted" style="max-width:780px;margin:0">Drag out rooms, put doors and windows on the walls, furnish it, and watch the areas add up.
      Homeowners can sketch what they want; architects can make it exact by typing dimensions. The plan is saved in this browser and can be exported as a drawing sheet.</p></div>
    <section class="block"><h2 class="section" style="font-size:19px">Start a new plan</h2>
      <div class="plan-grid"><button class="plan-card ai" data-pact="new-ai"><div class="ai-art" aria-hidden="true">✨</div><div class="pc-body"><b>Describe it to the AI</b>
        <span class="muted small">Say what you need, for example “a three-bedroom house of about 110 m²”. Muse Wonder lays out the rooms, doors and windows; the code checks every step.</span></div></button>
        ${Object.entries(TEMPLATES).map(([key, t]) => {
        const p = t.make();
        return `<button class="plan-card" data-pact="new" data-template="${key}">${thumb(p)}<div class="pc-body"><b>${esc(t.name)}</b>
          <span class="muted small">${esc(t.text)}</span>${p.rooms.length ? `<span class="faint tiny">${p.rooms.length} rooms · ${fmtA(totalArea(p))}</span>` : ""}</div></button>`;
      }).join("")}</div>
      <p class="small muted" style="margin:12px 0 0">Have a plan file? <button class="link" data-pact="import">Import a plan (.json)</button>
        <input type="file" id="plan-import" accept=".json,application/json" hidden></p>
    </section>
    <section class="block"><h2 class="section" style="font-size:19px">Your plans</h2>
      ${mine.length ? `<div class="plan-grid">${mine.map((p) => `<div class="plan-card mine">
        <a href="#/plan/${esc(p.id)}" class="pc-open">${thumb(p)}</a><div class="pc-body"><a href="#/plan/${esc(p.id)}"><b>${esc(p.name)}</b></a>
        <span class="faint tiny">${esc(KINDS[p.kind] || "Plan")} · ${p.rooms.length} rooms · ${fmtA(totalArea(p))} · edited ${esc(new Date(p.updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</span>
        <span class="pc-actions"><a class="btn small" href="#/plan/${esc(p.id)}">Open</a><button class="btn small" data-pact="dup" data-id="${esc(p.id)}">Duplicate</button>
        <button class="btn small" data-pact="del" data-id="${esc(p.id)}">Delete</button></span></div></div>`).join("")}</div>`
        : `<p class="muted">No plans yet. Pick a template above to start; your plans will be listed here.</p>`}
    </section>`;
    $("#plan-import").onchange = (e) => importFile(e.target.files[0]);
  }

  function newPlan(key) {
    const plan = (TEMPLATES[key] || TEMPLATES.blank).make();
    savePlan(plan);
    location.hash = `#/plan/${plan.id}`;
  }

  function importFile(file) {
    if (!file) return;
    file.text().then((text) => {
      const plan = JSON.parse(text);
      if (!Array.isArray(plan.rooms) || !Array.isArray(plan.openings) || !Array.isArray(plan.items)) throw new Error("not a plan");
      plan.id = uid("p");
      plan.name = String(plan.name || "Imported plan").slice(0, 80);
      savePlan(plan);
      location.hash = `#/plan/${plan.id}`;
    }).catch(() => alert("That file isn't a GroundTruth plan (.json)."));
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-pact]");
    if (!el) return;
    const act = el.dataset.pact;
    if (act === "new") newPlan(el.dataset.template);
    else if (act === "new-ai") { E.openAssist = true; newPlan("blank"); }
    else if (act === "import") $("#plan-import")?.click();
    else if (act === "dup") {
      const src = getPlan(el.dataset.id);
      if (src) { const copy = { ...JSON.parse(JSON.stringify(src)), id: uid("p"), name: `${src.name} (copy)` }; savePlan(copy); renderList($("#app")); }
    } else if (act === "del") {
      const p = getPlan(el.dataset.id);
      if (p && confirm(`Delete “${p.name}”? This can't be undone.`)) { deletePlan(p.id); renderList($("#app")); }
    } else EDIT_ACTIONS[act]?.(el, e);
  });

  /* ---------------- editor ---------------- */
  const E = { plan: null, view: null, sel: null, tool: "select", undo: [], redo: [], drag: null, hover: null, ghost: null, guides: [], space: false, saveTimer: 0, savedOk: true,
    assist: { open: false, running: false, mode: "edit", text: "", feed: [], result: null, error: null }, flash: new Set(), openAssist: false };
  const AI = { ready: true };
  fetch("/api/health").then((r) => r.json()).then((h) => { AI.ready = h?.keys?.meta !== false; }).catch(() => {});
  const EDIT_ACTIONS = {};

  function renderEditor(app, id) {
    const plan = getPlan(id);
    if (!plan) {
      app.innerHTML = `<div class="page-head"><h1>Plan not found</h1><p class="muted">It may have been made in another browser. Plans are saved per browser.</p>
        <a class="btn" href="#/plans">← All plans</a></div>`;
      return;
    }
    Object.assign(E, { plan, sel: null, tool: "select", undo: [], redo: [], drag: null, hover: null, ghost: null, guides: [], view: null, flash: new Set(),
      assist: { open: E.openAssist, running: false, mode: plan.rooms.length ? "edit" : "new", text: "", feed: [], result: null, error: null } });
    E.openAssist = false;
    stopSim();
    E.mode = "design";
    E.sim = { result: null, stale: true, loading: false, error: null, t: 0, season: "winter", tracks: [], walking: false, sunTimer: 0, walkFrame: 0 };
    plan.site = plan.site || defaultSite();
    app.innerHTML = `
    <div class="pe" id="plan-editor">
      <div class="pe-top">
        <a class="btn small" href="#/plans" title="All plans">←</a>
        <input class="pe-name" id="pe-name" value="${esc(plan.name)}" aria-label="Plan name" maxlength="80">
        <select id="pe-kind" aria-label="Building type">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${plan.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <div class="pe-seg pe-mode" id="pe-mode"><button data-pact="mode" data-mode="design" class="on">Design</button><button data-pact="mode" data-mode="simulate">▶ Simulate</button></div>
        <span class="pe-status small muted" id="pe-status"></span>
        <span class="pe-spacer"></span>
        <button class="btn small primary" data-pact="assist" title="Describe what you want; Muse Wonder lays it out">✨ Design with AI</button>
        <details class="pe-menu" id="pe-export"><summary class="btn small">Export</summary><div class="pe-menu-list">
          <button data-pact="export-png">Drawing sheet (PNG)</button><button data-pact="export-svg">Drawing sheet (SVG)</button>
          <button data-pact="export-json">Plan file (JSON), to back up or move</button></div></details>
        <span class="pe-zoom"><button class="btn small" data-pact="zoom-out" title="Zoom out">−</button><span id="pe-scale" class="small mono"></span>
          <button class="btn small" data-pact="zoom-in" title="Zoom in">+</button><button class="btn small" data-pact="fit" title="Zoom to fit (0)">Fit</button></span>
      </div>
      <div class="pe-body">
        <div class="pe-tools" id="pe-tools"></div>
        <div class="pe-canvas" id="pe-canvas"><svg id="pc" xmlns="http://www.w3.org/2000/svg"></svg><div class="pe-hint" id="pe-hint"></div></div>
        <aside class="pe-side" id="pe-side"></aside>
      </div>
    </div>`;
    $("#pe-name").oninput = (e) => { E.plan.name = e.target.value || "Untitled plan"; changed(false); };
    $("#pe-kind").onchange = (e) => { E.plan.kind = e.target.value; changed(false); };
    const svg = $("#pc");
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("pointerleave", () => { if (E.hover) { E.hover = null; render(); } });
    requestAnimationFrame(() => { fitToScreen(); render(true); });
  }

  function canvasSize() {
    const r = $("#pc")?.getBoundingClientRect();
    return r ? { W: r.width, H: r.height } : { W: 800, H: 600 };
  }
  function fitToScreen() {
    const { W, H } = canvasSize();
    E.view = fitView(E.plan, W, H, 60);
  }
  function toWorld(ev) {
    const r = $("#pc").getBoundingClientRect();
    return { x: (ev.clientX - r.left - E.view.tx) / E.view.s, y: (ev.clientY - r.top - E.view.ty) / E.view.s, px: ev.clientX - r.left, py: ev.clientY - r.top };
  }
  function zoomAt(factor, px, py) {
    const v = E.view, s = clamp(v.s * factor, 8, 400), k = s / v.s;
    E.view = { s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    render();
  }
  function onWheel(ev) {
    ev.preventDefault();
    const r = $("#pc").getBoundingClientRect();
    zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018)), ev.clientX - r.left, ev.clientY - r.top);
  }
  Object.assign(EDIT_ACTIONS, {
    "zoom-in": () => { const { W, H } = canvasSize(); zoomAt(1.25, W / 2, H / 2); },
    "zoom-out": () => { const { W, H } = canvasSize(); zoomAt(0.8, W / 2, H / 2); },
    fit: () => { fitToScreen(); render(); },
  });

  /* ---------------- editing: tools, selection, snapping, undo ---------------- */
  const icon = (d) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
  const TOOLS = [
    ["select", "Select and move", "V", icon(`<path d="M5 3l11 6.5-4.6 1.4L9 15.5z"/>`)],
    ["room", "Draw a room", "R", icon(`<rect x="3" y="4.5" width="14" height="11"/><path d="M3 9.5h5v6"/>`)],
    ["door", "Add a door", "D", icon(`<path d="M3 16h14"/><path d="M5 16V5"/><path d="M5 5a11 11 0 0111 11" stroke-dasharray="2 2"/>`)],
    ["window", "Add a window", "W", icon(`<rect x="3" y="7.5" width="14" height="5"/><path d="M3 10h14"/>`)],
    ["furniture", "Add furniture and fixtures", "F", icon(`<rect x="3" y="8" width="14" height="7" rx="1"/><path d="M5 8V5.5h10V8M3 15v1.5M17 15v1.5"/>`)],
  ];
  const ITEM_GROUPS = [["Living", ["sofa", "armchair", "dining_table", "plant"]], ["Bedroom", ["bed_double", "bed_single", "wardrobe", "desk"]],
    ["Kitchen", ["counter", "stove", "kitchen_sink", "fridge"]], ["Bathroom", ["toilet", "basin", "shower", "bathtub"]],
    ["Other", ["meeting_table", "stairs", "car"]]];
  const HINTS = {
    select: "Click a room to edit it · drag to move · drag its edges to resize · drag empty space to pan · scroll to zoom",
    room: "Drag to draw a room. It snaps to the 10 cm grid and to other walls; hold Alt for free placement.",
    door: "Click on a wall to put a door there · drag a door to slide it along its wall · Esc when done",
    window: "Click on a wall to put a window there · drag a window to slide it · Esc when done",
    furniture: "Pick a piece in the panel on the right, then click on the plan to place it",
  };
  const GRID = 0.1, MIN = 0.5;
  const g = (v, step = GRID) => r2(Math.round(v / step) * step);
  const LIST = { room: "rooms", opening: "openings", item: "items" };
  const find = (kind, id) => E.plan[LIST[kind]]?.find((x) => x.id === id);
  const selected = () => (E.sel ? find(E.sel.kind, E.sel.id) : null);
  const snapshot = () => JSON.stringify({ rooms: E.plan.rooms, openings: E.plan.openings, items: E.plan.items });
  function commit(before) {
    if (before !== snapshot()) { E.undo.push(before); if (E.undo.length > 200) E.undo.shift(); E.redo = []; }
    changed(true, true);
  }
  function restore(json) {
    Object.assign(E.plan, JSON.parse(json));
    if (E.sel && !selected()) E.sel = null;
    changed(true, true);
  }
  function undo() { if (E.undo.length) { E.redo.push(snapshot()); restore(E.undo.pop()); } }
  function redo() { if (E.redo.length) { E.undo.push(snapshot()); restore(E.redo.pop()); } }

  function setTool(tool) {
    E.tool = tool;
    E.hover = null;
    E.ghost = null;
    if (tool === "room" || tool === "furniture") E.sel = null;
    E.placing = null;
    render(true);
  }
  function select(kind, id) { E.sel = kind ? { kind, id } : null; render(true); }

  function roomTargets(axis, exceptId) {
    const out = [];
    for (const r of E.plan.rooms) if (r.id !== exceptId) axis === "x" ? out.push(r.x, r.x + r.w) : out.push(r.y, r.y + r.h);
    return out;
  }
  // Snap one coordinate to the nearest wall within 8 px, else to the grid. Alt turns snapping off.
  function snapEdge(v, targets, free) {
    if (free) return { v: r2(v) };
    const tol = 8 / E.view.s;
    let best = null;
    for (const t of targets) if (Math.abs(t - v) <= tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
    return best !== null ? { v: r2(best), guide: best } : { v: g(v) };
  }
  // Snap a span [a, a + len] by whichever end is closest to a wall.
  function snapSpan(a, len, targets, free) {
    if (free) return { v: r2(a) };
    const tol = 8 / E.view.s;
    let best = null;
    for (const t of targets) for (const off of [0, len]) {
      const d = t - (a + off);
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, guide: t };
    }
    return best ? { v: r2(a + best.d), guide: best.guide } : { v: g(a) };
  }

  function overlaps(plan) {
    const out = [];
    plan.rooms.forEach((a, i) => plan.rooms.slice(i + 1).forEach((b) => {
      const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
      if (w > EPS && h > EPS) out.push({ a, b, x, y, w, h });
    }));
    return out;
  }

  function uniqueName(label, exceptId) {
    const names = new Set(E.plan.rooms.filter((r) => r.id !== exceptId).map((r) => r.name));
    if (!names.has(label)) return label;
    for (let n = 2; ; n++) if (!names.has(`${label} ${n}`)) return `${label} ${n}`;
  }

  // The wall nearest the pointer (within 12 px) and where an opening of this width would sit on it.
  function wallAt(p, width) {
    const tol = 12 / E.view.s;
    let best = null;
    for (const r of E.plan.rooms) for (const e of edges(r)) {
      const along = e.o === "h" ? p.x : p.y, across = e.o === "h" ? p.y : p.x, dist = Math.abs(across - e.c);
      if (along < e.a - tol || along > e.b + tol || dist > tol) continue;
      const inside = p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
      const score = dist - (inside ? tol : 0); // on a shared wall, prefer the room the pointer is in
      if (!best || score < best.score) best = { score, r, e, along };
    }
    if (!best) return null;
    const len = best.e.b - best.e.a;
    if (len < width + 0.1) return { room: best.r.id, side: best.e.side, at: r2(len / 2), width, ok: false, why: "This wall is too short" };
    const at = r2(clamp(g(best.along - best.e.a, 0.05), width / 2 + 0.05, len - width / 2 - 0.05));
    const spot = { room: best.r.id, side: best.e.side, at, width };
    const mine = openingGeom(E.plan, spot);
    const clash = E.plan.openings.some((op) => {
      const o = openingGeom(E.plan, op);
      return o && o.o === mine.o && Math.abs(o.c - mine.c) < EPS && o.a < mine.b - EPS && mine.a < o.b - EPS;
    });
    return { ...spot, ok: !clash, why: clash ? "Overlaps another door or window" : "" };
  }

  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    if (E.assist.running || E.mode === "simulate") { E.drag = { mode: "pan", start: toWorld(ev), view: { ...E.view } }; return; }
    try { $("#pc").setPointerCapture(ev.pointerId); } catch { /* synthetic events have no capturable pointer */ }
    const p = toWorld(ev);
    if (ev.button === 1 || E.space) { E.drag = { mode: "pan", start: p, view: { ...E.view } }; return; }
    if (E.tool === "room") {
      const x = snapEdge(p.x, roomTargets("x"), ev.altKey), y = snapEdge(p.y, roomTargets("y"), ev.altKey);
      E.drag = { mode: "draw", x0: x.v, y0: y.v, before: snapshot() };
      return;
    }
    if (E.tool === "furniture" && E.placing) {
      const [, w, h] = ITEM_TYPES[E.placing], before = snapshot();
      const it = { id: uid("i"), type: E.placing, cx: g(p.x, 0.05), cy: g(p.y, 0.05), w, h, rot: 0 };
      E.plan.items.push(it);
      E.hover = null;
      E.tool = "select";
      E.placing = null;
      E.sel = { kind: "item", id: it.id };
      commit(before);
      return;
    }
    if ((E.tool === "door" || E.tool === "window") && !ev.target.closest("[data-kind=opening]")) {
      const spot = wallAt(p, OPENING_TYPES[E.tool][1]);
      if (spot?.ok) {
        const before = snapshot(), op = { id: uid("o"), type: E.tool, ...spot, hinge: "start", swing: "in" };
        E.plan.openings.push(op);
        E.sel = { kind: "opening", id: op.id };
        E.hover = null;
        commit(before);
      } else E.drag = { mode: "pan", start: p, view: { ...E.view } };
      return;
    }
    const target = ev.target.closest("[data-handle],[data-kind]");
    if (target?.dataset.handle) {
      const r = find("room", target.dataset.id);
      const ops = Object.fromEntries(E.plan.openings.filter((o) => o.room === r.id).map((o) => [o.id, o.at]));
      E.drag = { mode: "resize", handle: target.dataset.handle, id: r.id, start: p, orig: { ...r }, ops, before: snapshot() };
      return;
    }
    if (target?.dataset.kind) {
      const { kind, id } = target.dataset;
      E.sel = { kind, id };
      E.drag = { mode: "move", kind, id, start: p, orig: { ...find(kind, id) }, before: snapshot() };
      render(true);
      return;
    }
    if (E.sel) { E.sel = null; render(true); }
    E.drag = { mode: "pan", start: p, view: { ...E.view } };
  }

  function onPointerMove(ev) {
    const d = E.drag;
    if (!d) {
      if (E.tool === "door" || E.tool === "window") { E.hover = wallAt(toWorld(ev), OPENING_TYPES[E.tool][1]); render(); }
      if (E.tool === "furniture" && E.placing) { const q = toWorld(ev); E.hover = { item: E.placing, cx: g(q.x, 0.05), cy: g(q.y, 0.05) }; render(); }
      return;
    }
    const p = toWorld(ev), free = ev.altKey;
    E.guides = [];
    if (d.mode === "pan") { E.view = { ...d.view, tx: d.view.tx + p.px - d.start.px, ty: d.view.ty + p.py - d.start.py }; render(); return; }
    if (d.mode === "draw") {
      const x = snapEdge(p.x, roomTargets("x"), free), y = snapEdge(p.y, roomTargets("y"), free);
      E.ghost = { x: Math.min(d.x0, x.v), y: Math.min(d.y0, y.v), w: r2(Math.abs(x.v - d.x0)), h: r2(Math.abs(y.v - d.y0)) };
      if (x.guide !== undefined) E.guides.push({ o: "v", c: x.guide });
      if (y.guide !== undefined) E.guides.push({ o: "h", c: y.guide });
      render();
      return;
    }
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (d.mode === "move" && d.kind === "room") {
      const r = find("room", d.id), o = d.orig;
      const x = snapSpan(o.x + dx, o.w, roomTargets("x", r.id), free), y = snapSpan(o.y + dy, o.h, roomTargets("y", r.id), free);
      r.x = x.v; r.y = y.v;
      if (x.guide !== undefined) E.guides.push({ o: "v", c: x.guide });
      if (y.guide !== undefined) E.guides.push({ o: "h", c: y.guide });
    } else if (d.mode === "move" && d.kind === "opening") {
      const op = find("opening", d.id), r = roomOf(E.plan, op.room), horiz = op.side === "n" || op.side === "s", delta = horiz ? dx : dy;
      op.at = r2(clamp(d.orig.at + (free ? delta : g(delta, 0.05)), op.width / 2, sideLength(r, op.side) - op.width / 2));
    } else if (d.mode === "move" && d.kind === "item") {
      const it = find("item", d.id);
      it.cx = r2(d.orig.cx + (free ? dx : g(dx, 0.05)));
      it.cy = r2(d.orig.cy + (free ? dy : g(dy, 0.05)));
    } else if (d.mode === "resize") {
      const r = find("room", d.id), o = d.orig, h = d.handle;
      const xt = roomTargets("x", r.id), yt = roomTargets("y", r.id);
      let left = o.x, right = o.x + o.w, top = o.y, bottom = o.y + o.h;
      const take = (s, o2) => { if (s.guide !== undefined) E.guides.push({ o: o2, c: s.guide }); return s.v; };
      if (h.includes("w")) left = Math.min(take(snapEdge(o.x + dx, xt, free), "v"), right - MIN);
      if (h.includes("e")) right = Math.max(take(snapEdge(o.x + o.w + dx, xt, free), "v"), left + MIN);
      if (h.includes("n")) top = Math.min(take(snapEdge(o.y + dy, yt, free), "h"), bottom - MIN);
      if (h.includes("s")) bottom = Math.max(take(snapEdge(o.y + o.h + dy, yt, free), "h"), top + MIN);
      Object.assign(r, { x: r2(left), y: r2(top), w: r2(right - left), h: r2(bottom - top) });
      // keep doors and windows where they were in the world when the near edge moves
      for (const op of E.plan.openings) if (op.room === r.id && op.id in d.ops) {
        op.at = r2(d.ops[op.id] + (op.side === "n" || op.side === "s" ? o.x - r.x : o.y - r.y));
      }
    }
    render();
  }

  function onPointerUp() {
    const d = E.drag;
    E.drag = null;
    E.guides = [];
    if (!d || d.mode === "pan") return;
    if (d.mode === "draw") {
      const gh = E.ghost;
      E.ghost = null;
      if (gh && gh.w >= MIN && gh.h >= MIN) {
        const r = { id: uid("r"), name: uniqueName("Room"), type: "other", ...gh };
        E.plan.rooms.push(r);
        E.tool = "select";
        E.sel = { kind: "room", id: r.id };
        commit(d.before);
        setTimeout(() => $("#pe-side [data-prop=type]")?.focus(), 0);
      } else render(true);
      return;
    }
    commit(d.before);
  }

  function deleteSel() {
    const s = E.sel;
    if (!s) return;
    const before = snapshot();
    E.plan[LIST[s.kind]] = E.plan[LIST[s.kind]].filter((x) => x.id !== s.id);
    if (s.kind === "room") E.plan.openings = E.plan.openings.filter((o) => o.room !== s.id);
    E.sel = null;
    commit(before);
  }

  function duplicateSel() {
    const s = E.sel, src = selected();
    if (!s || s.kind === "opening" || !src) return;
    const before = snapshot();
    if (s.kind === "room") {
      // place the copy against the right-hand wall if that space is free, else offset it
      const right = { ...src, id: uid("r"), name: uniqueName(src.name.replace(/ \d+$/, "")), x: r2(src.x + src.w) };
      const free = !overlaps({ rooms: [...E.plan.rooms, right] }).some((o) => o.a.id === right.id || o.b.id === right.id);
      const copy = free ? right : { ...right, x: r2(src.x + 0.5), y: r2(src.y + 0.5) };
      E.plan.rooms.push(copy);
      for (const op of E.plan.openings.filter((o) => o.room === src.id)) E.plan.openings.push({ ...op, id: uid("o"), room: copy.id });
      E.sel = { kind: "room", id: copy.id };
    } else {
      const copy = { ...src, id: uid("i"), cx: r2(src.cx + 0.3), cy: r2(src.cy + 0.3) };
      E.plan.items.push(copy);
      E.sel = { kind: "item", id: copy.id };
    }
    commit(before);
  }

  function nudge(dx, dy) {
    const s = selected();
    if (!s || E.sel.kind === "opening") return;
    const before = snapshot();
    if (E.sel.kind === "room") { s.x = r2(s.x + dx); s.y = r2(s.y + dy); } else { s.cx = r2(s.cx + dx); s.cy = r2(s.cy + dy); }
    commit(before);
  }

  Object.assign(EDIT_ACTIONS, {
    tool: (el) => setTool(el.dataset.tool),
    undo, redo,
    "dup-sel": duplicateSel,
    "del-sel": deleteSel,
    "select-room": (el) => select("room", el.dataset.id),
    "export-png": () => { exportPng(E.plan); $("#pe-export").open = false; },
    "export-svg": () => { download(new Blob([sheetSvg(E.plan)], { type: "image/svg+xml" }), `${slug(E.plan)}.svg`); $("#pe-export").open = false; },
    "export-json": () => { download(new Blob([JSON.stringify(E.plan, null, 2)], { type: "application/json" }), `${slug(E.plan)}.json`); $("#pe-export").open = false; },
    "select-opening": (el) => select("opening", el.dataset.id),
    "pick-item": (el) => { E.placing = el.dataset.type; E.hover = null; render(true); },
    rotate: () => { const it = selected(); if (!it || E.sel.kind !== "item") return; const before = snapshot(); it.rot = ((it.rot || 0) + 90) % 360; commit(before); },
    "flip-hinge": () => { const op = selected(), before = snapshot(); op.hinge = op.hinge === "end" ? "start" : "end"; commit(before); },
    "flip-swing": () => { const op = selected(), before = snapshot(); op.swing = op.swing === "out" ? "in" : "out"; commit(before); },
    deselect: () => select(null),
  });

  document.addEventListener("keydown", (e) => {
    if (!$("#plan-editor")) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    if ((E.assist.running || E.mode === "simulate") && !typing) return;
    const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    if (mod && (key === "z" || key === "y")) {
      if (typing) return;
      e.preventDefault();
      key === "y" || e.shiftKey ? redo() : undo();
      return;
    }
    if (typing) { if (e.key === "Escape" || e.key === "Enter") document.activeElement.blur(); return; }
    if (mod && key === "d") { e.preventDefault(); duplicateSel(); return; }
    if (mod || e.altKey) return;
    const step = e.shiftKey ? 0.5 : GRID;
    const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (arrows[key] && E.sel) { e.preventDefault(); nudge(...arrows[key]); return; }
    if (key === " ") { E.space = true; e.preventDefault(); return; }
    if (key === "r" && e.shiftKey) { EDIT_ACTIONS.rotate(); return; }
    if (key === "escape") {
      if (E.drag?.mode === "draw") { E.drag = null; E.ghost = null; render(); }
      else if (E.tool !== "select") setTool("select");
      else select(null);
    } else if (key === "delete" || key === "backspace") { e.preventDefault(); deleteSel(); }
    else if (key === "0") EDIT_ACTIONS.fit();
    else {
      const tool = TOOLS.find(([, , k]) => k.toLowerCase() === key);
      if (tool) setTool(tool[0]);
    }
  });
  document.addEventListener("keyup", (e) => { if (e.key === " ") E.space = false; });

  /* ---------------- painting ---------------- */
  function overlay(X, Y, L) {
    const out = [];
    for (const o of overlaps(E.plan)) {
      out.push(`<rect x="${X(o.x)}" y="${Y(o.y)}" width="${L(o.w)}" height="${L(o.h)}" fill="#d92d20" fill-opacity=".22" stroke="#d92d20" stroke-dasharray="4 3" pointer-events="none"/>`);
    }
    for (const gd of E.guides || []) {
      out.push(gd.o === "v" ? `<line x1="${X(gd.c)}" y1="0" x2="${X(gd.c)}" y2="4000" stroke="#e8590c" stroke-dasharray="5 4" pointer-events="none"/>`
        : `<line x1="0" y1="${Y(gd.c)}" x2="6000" y2="${Y(gd.c)}" stroke="#e8590c" stroke-dasharray="5 4" pointer-events="none"/>`);
    }
    for (const id of E.flash) {
      const r = roomOf(E.plan, id);
      if (r) out.push(`<rect x="${X(r.x)}" y="${Y(r.y)}" width="${L(r.w)}" height="${L(r.h)}" fill="${ACCENT}" fill-opacity=".14" stroke="${ACCENT}" stroke-width="3" pointer-events="none"/>`);
    }
    if (E.ghost) {
      const gh = E.ghost;
      out.push(`<rect x="${X(gh.x)}" y="${Y(gh.y)}" width="${L(gh.w)}" height="${L(gh.h)}" fill="${ACCENT}" fill-opacity=".12" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>`);
      out.push(tag(X(gh.x + gh.w / 2), Y(gh.y) - 10, `${gh.w.toFixed(2)} × ${gh.h.toFixed(2)} m · ${fmtA(gh.w * gh.h)}`));
    }
    if (E.hover?.item && !E.drag) {
      const [, w, h] = ITEM_TYPES[E.hover.item];
      out.push(`<g opacity=".55" pointer-events="none">${drawItem({ type: E.hover.item, cx: E.hover.cx, cy: E.hover.cy, w, h, rot: 0 }, X, Y, L)}</g>`);
    } else if (E.hover && !E.drag) {
      const h = E.hover, hg = openingGeom(E.plan, { ...h, type: E.tool });
      if (hg) {
        const color = h.ok ? ACCENT : "#d92d20";
        out.push(hg.o === "h" ? `<line x1="${X(hg.a)}" y1="${Y(hg.c)}" x2="${X(hg.b)}" y2="${Y(hg.c)}" stroke="${color}" stroke-width="8" stroke-opacity=".6" pointer-events="none"/>`
          : `<line x1="${X(hg.c)}" y1="${Y(hg.a)}" x2="${X(hg.c)}" y2="${Y(hg.b)}" stroke="${color}" stroke-width="8" stroke-opacity=".6" pointer-events="none"/>`);
        const [tx, ty] = hg.o === "h" ? [X(hg.mid), Y(hg.c) - 16] : [X(hg.c), Y(hg.mid) - 16];
        out.push(tag(tx, ty, h.ok ? `${OPENING_TYPES[E.tool][0]} ${fmtM(h.width)}` : h.why));
      }
    }
    const s = selected();
    if (s && E.sel.kind === "room") {
      const x = X(s.x), y = Y(s.y), w = L(s.w), h = L(s.h);
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${ACCENT}" stroke-width="2" pointer-events="none"/>`);
      out.push(dimH(x, x + w, y - 22, fmtM(s.w)), dimV(y, y + h, x - 22, fmtM(s.h)));
      const hs = 9, pts = { nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2] };
      for (const [k, [hx, hy]] of Object.entries(pts)) {
        out.push(`<rect class="handle h-${k}" data-handle="${k}" data-id="${s.id}" x="${r2(hx - hs / 2)}" y="${r2(hy - hs / 2)}" width="${hs}" height="${hs}" fill="#fff" stroke="${ACCENT}" stroke-width="1.6"/>`);
      }
    } else if (s && E.sel.kind === "item") {
      const [fw, fh] = footprint(s);
      out.push(`<rect x="${X(s.cx - fw / 2) - 3}" y="${Y(s.cy - fh / 2) - 3}" width="${L(fw) + 6}" height="${L(fh) + 6}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>`);
    } else if (s && E.sel.kind === "opening") {
      const og = openingGeom(E.plan, s);
      if (og) out.push(og.o === "h" ? `<line x1="${X(og.a)}" y1="${Y(og.c)}" x2="${X(og.b)}" y2="${Y(og.c)}" stroke="${ACCENT}" stroke-width="6" stroke-opacity=".55" pointer-events="none"/>`
        : `<line x1="${X(og.c)}" y1="${Y(og.a)}" x2="${X(og.c)}" y2="${Y(og.b)}" stroke="${ACCENT}" stroke-width="6" stroke-opacity=".55" pointer-events="none"/>`);
    }
    return out.join("");
  }
  const tag = (x, y, text) => `<g pointer-events="none"><rect x="${r2(x - text.length * 3.4 - 6)}" y="${r2(y - 12)}" width="${r2(text.length * 6.8 + 12)}" height="18" rx="9" fill="${ACCENT}"/>
    <text x="${r2(x)}" y="${r2(y + 1)}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#fff">${esc(text)}</text></g>`;
  function dimH(x1, x2, y, text) {
    return `<g pointer-events="none" stroke="${ACCENT}"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}"/>
      <line x1="${x2}" y1="${y - 4}" x2="${x2}" y2="${y + 4}"/></g>` + tag((x1 + x2) / 2, y, text);
  }
  function dimV(y1, y2, x, text) {
    const cy = (y1 + y2) / 2;
    return `<g pointer-events="none" stroke="${ACCENT}"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}"/>
      <line x1="${x - 4}" y1="${y2}" x2="${x + 4}" y2="${y2}"/></g><g transform="rotate(-90 ${r2(x)} ${r2(cy)})">${tag(x, cy, text)}</g>`;
  }

  function changed(redraw = true, sideToo = false) {
    if (E.sim) E.sim.stale = true;
    clearTimeout(E.saveTimer);
    E.saveTimer = setTimeout(() => { E.savedOk = savePlan(E.plan); paintStatus(); }, 400);
    if (redraw) render(sideToo);
    else paintStatus();
  }
  function paintStatus() {
    const el = $("#pe-status");
    if (el) el.textContent = E.savedOk ? "Saved in this browser" : "Not saved: this browser blocks storage. Export the plan to keep it.";
  }

  function render(sideToo = false) {
    const svg = $("#pc");
    if (!svg || !E.plan) return;
    const { W, H } = canvasSize();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", `tool-${E.tool}${E.drag?.mode === "pan" ? " panning" : ""}`);
    const sim = E.mode === "simulate" && !E.assist.running;
    svg.innerHTML = `<rect width="${W}" height="${H}" fill="${PAPER}"/>` + drawPlan(E.plan, E.view, { width: W, height: H, grid: true, overlay: sim ? simOverlay : overlay })
      + scaleBar(W, H) + (sim ? simHud(W) : "");
    if (sim) placeWalkers();
    $("#pe-scale").textContent = `${Math.round(E.view.s)} px/m`;
    $("#pe-hint").textContent = E.drag ? "" : E.mode === "simulate" ? "Simulation: drag to pan, scroll to zoom. Switch back to Design to edit." : HINTS[E.tool] || "";
    $$("#pe-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === E.mode));
    paintTools();
    paintSide(sideToo);
    paintStatus();
  }

  function scaleBar(W, H) {
    const s = E.view.s, m = [0.5, 1, 2, 5, 10, 20].find((v) => v * s >= 60) || 20, x = 16, y = H - 18;
    return `<g pointer-events="none"><line x1="${x}" y1="${y}" x2="${r2(x + m * s)}" y2="${y}" stroke="${INK}" stroke-width="2"/>
      <line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="${INK}"/><line x1="${r2(x + m * s)}" y1="${y - 4}" x2="${r2(x + m * s)}" y2="${y + 4}" stroke="${INK}"/>
      <text x="${r2(x + m * s + 6)}" y="${y + 4}" font-size="11" fill="${INK}">${m} m</text></g>`;
  }

  function paintTools() {
    const box = $("#pe-tools");
    const off = E.mode === "simulate" ? "disabled" : "";
    const html = TOOLS.map(([id, label, key, ic]) => `<button class="pe-tool ${E.tool === id && !off ? "on" : ""}" ${off} data-pact="tool" data-tool="${id}" title="${label} (${key})"
      aria-label="${label}" aria-pressed="${E.tool === id}">${ic}<span>${key}</span></button>`).join("") +
      `<span class="pe-sep"></span><button class="pe-tool" data-pact="undo" title="Undo (⌘Z)" aria-label="Undo" ${E.undo.length ? "" : "disabled"}>${icon(`<path d="M7 5L3.5 8.5 7 12"/><path d="M4 8.5h8a4 4 0 010 8H9"/>`)}</button>
      <button class="pe-tool" data-pact="redo" title="Redo (⇧⌘Z)" aria-label="Redo" ${E.redo.length ? "" : "disabled"}>${icon(`<path d="M13 5l3.5 3.5L13 12"/><path d="M16 8.5H8a4 4 0 000 8h3"/>`)}</button>`;
    if (box && box._html !== html) { box.innerHTML = html; box._html = html; }
  }

  // The side panel shows the selection's properties, or the plan summary. While a field in it has focus
  // it is not rebuilt (that would steal the focus); only its live numbers are updated.
  function paintSide(force) {
    const side = $("#pe-side");
    if (!side) return;
    const key = E.mode === "simulate" ? `sim:${E.sim.loading}:${!!E.sim.result}` : E.assist.open ? "assist" : E.sel ? `${E.sel.kind}:${E.sel.id}` : "plan";
    if (!force && key === side._key && side.contains(document.activeElement)) { paintLive(); return; }
    side._key = key;
    const s = selected();
    side.innerHTML = E.mode === "simulate" ? simPanel() : E.assist.open ? assistPanel() : !s ? (E.tool === "furniture" ? palettePanel() : summaryPanel())
      : E.sel.kind === "room" ? roomPanel(s) : E.sel.kind === "opening" ? openingPanel(s) : itemPanel(s);
    bindFields(side);
    paintLive();
  }

  function paintLive() {
    if (E.mode === "simulate") {
      const sample = E.sim.result?.sun.samples[E.sim.t], label = $(".sim-time .mono");
      if (label && sample) label.textContent = hhmm(sample.hour);
      return;
    }
    const s = selected();
    $$("[data-live]", $("#pe-side")).forEach((el) => {
      if (el.dataset.live === "area" && s) el.textContent = `${fmtA(area(s))} (${fmtM(s.w)} × ${fmtM(s.h)})`;
    });
  }

  const num = (prop, label, value, extra = "") => `<label class="pe-field"><span>${label}</span><input type="number" step="0.1" data-prop="${prop}" value="${value}" ${extra}></label>`;
  function roomPanel(r) {
    return `<div class="pe-head"><h3>Room</h3><button class="link small" data-pact="deselect">Plan summary</button></div>
      <label class="pe-field wide"><span>Name</span><input data-prop="name" value="${esc(r.name)}" maxlength="60"></label>
      <label class="pe-field wide"><span>Type</span><select data-prop="type">${Object.entries(ROOM_TYPES).map(([k, [label]]) => `<option value="${k}" ${r.type === k ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <div class="pe-row">${num("w", "Width (m)", r.w, `min="${MIN}"`)}${num("h", "Depth (m)", r.h, `min="${MIN}"`)}</div>
      <div class="pe-row">${num("x", "From left (m)", r.x)}${num("y", "From top (m)", r.y)}</div>
      <p class="pe-area">Area <b data-live="area"></b></p>
      <div class="pe-actions"><button class="btn small" data-pact="dup-sel" title="⌘D">Duplicate</button><button class="btn small danger" data-pact="del-sel" title="Delete key">Delete room</button></div>
      <p class="tiny muted">Drag the room to move it or its edges to resize; arrow keys nudge by 10 cm (Shift: 50 cm). Doors and windows move with it.</p>`;
  }

  function openingPanel(op) {
    const r = roomOf(E.plan, op.room), label = OPENING_TYPES[op.type][0];
    return `<div class="pe-head"><h3>${label}</h3><button class="link small" data-pact="deselect">Plan summary</button></div>
      <p class="small muted" style="margin:0 0 10px">On the ${{ n: "top", s: "bottom", w: "left", e: "right" }[op.side]} wall of ${esc(r?.name)} (wall ${fmtM(sideLength(r, op.side))} long)</p>
      <label class="pe-field wide"><span>Type</span><select data-prop="type">${Object.entries(OPENING_TYPES).map(([k, [l]]) => `<option value="${k}" ${op.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="pe-row">${num("width", "Width (m)", op.width, 'min="0.4"')}${num("at", "Centre from wall start (m)", op.at)}</div>
      ${op.type === "door" ? `<div class="pe-actions"><button class="btn small" data-pact="flip-hinge">Flip hinge side</button>
        <button class="btn small" data-pact="flip-swing">Open ${op.swing === "out" ? "inwards" : "outwards"}</button></div>` : ""}
      <div class="pe-actions"><button class="btn small danger" data-pact="del-sel">Delete ${label.toLowerCase()}</button></div>
      <p class="tiny muted">Drag it along the wall to move it. Wall start is the left end of a top or bottom wall, the top end of a side wall.</p>`;
  }

  function palettePanel() {
    const preview = (type) => {
      const [, w, h] = ITEM_TYPES[type], s = Math.min(46 / w, 34 / h);
      return `<svg viewBox="0 0 56 42" width="56" height="42">${drawItem({ type, cx: 28 / s, cy: 21 / s, w, h, rot: 0 }, (x) => x * s, (y) => y * s, (d) => d * s)}</svg>`;
    };
    return `<div class="pe-head"><h3>Furniture and fixtures</h3><button class="link small" data-pact="tool" data-tool="select">Done</button></div>
      <p class="small muted" style="margin:0 0 6px">Pick one, then click on the plan to place it.</p>
      ${ITEM_GROUPS.map(([group, types]) => `<h4>${group}</h4><div class="pe-palette">${types.map((t) => `<button class="${E.placing === t ? "on" : ""}" data-pact="pick-item" data-type="${t}"
        title="${ITEM_TYPES[t][0]}">${preview(t)}<span>${ITEM_TYPES[t][0]}</span></button>`).join("")}</div>`).join("")}`;
  }

  const roomAt = (x, y) => E.plan.rooms.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  function itemPanel(it) {
    const room = roomAt(it.cx, it.cy);
    return `<div class="pe-head"><h3>${ITEM_TYPES[it.type]?.[0] || "Item"}</h3><button class="link small" data-pact="deselect">Plan summary</button></div>
      <p class="small muted" style="margin:0 0 10px">${room ? `In ${esc(room.name)}` : "Outside the rooms"}</p>
      <div class="pe-row">${num("w", "Width (m)", it.w, 'min="0.2"')}${num("h", "Depth (m)", it.h, 'min="0.2"')}</div>
      <div class="pe-actions"><button class="btn small" data-pact="rotate" title="Shift+R">Rotate 90°</button><button class="btn small" data-pact="dup-sel" title="⌘D">Duplicate</button>
        <button class="btn small danger" data-pact="del-sel">Delete</button></div>
      <p class="tiny muted">Drag to move; arrow keys nudge by 10 cm. Width and depth are before rotation.</p>`;
  }

  function openingIssues(plan) {
    const gs = plan.openings.map((op) => openingGeom(plan, op)).filter(Boolean), out = [];
    gs.forEach((a, i) => gs.slice(i + 1).forEach((b) => {
      if (a.o === b.o && Math.abs(a.c - b.c) < EPS && a.a < b.b - EPS && b.a < a.b - EPS) {
        out.push(`A ${OPENING_TYPES[a.op.type][0].toLowerCase()} and a ${OPENING_TYPES[b.op.type][0].toLowerCase()} overlap on the wall of ${roomOf(plan, a.op.room)?.name}`);
      }
    }));
    return out;
  }

  function summaryPanel() {
    const p = E.plan, doors = p.openings.filter((o) => o.type === "door").length, windows = p.openings.filter((o) => o.type === "window").length;
    const issues = [...overlaps(p).map((o) => `${o.a.name} and ${o.b.name} overlap by ${fmtA(o.w * o.h)}`), ...openingIssues(p)];
    return `<h3>Plan summary</h3>
      <div class="pe-stats"><div><b>${fmtA(totalArea(p))}</b><span>floor area</span></div><div><b>${p.rooms.length}</b><span>rooms</span></div>
        <div><b>${doors}</b><span>doors</span></div><div><b>${windows}</b><span>windows</span></div></div>
      <p class="small muted" style="margin:8px 0 0">${p.items.length} pieces of furniture and fixtures</p>
      ${issues.length ? `<div class="pe-issues"><b>Check the plan</b><ul>${issues.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      <h4>Rooms</h4>${p.rooms.length ? `<table class="pe-table">${p.rooms.map((r) => `<tr data-pact="select-room" data-id="${r.id}" data-select><td><span class="swatch" style="background:${(ROOM_TYPES[r.type] || ROOM_TYPES.other)[1]}"></span>${esc(r.name)}</td>
        <td class="num">${fmtA(area(r))}</td></tr>`).join("")}</table>` : `<p class="small muted">No rooms yet. Pick <b>Draw a room</b> (R) and drag on the grid.</p>`}
      ${p.openings.length ? `<h4>Doors and windows</h4><table class="pe-table">${p.openings.map((op) => `<tr data-pact="select-opening" data-id="${op.id}" data-select>
        <td><b>${marks(p)[op.id]}</b></td><td>${OPENING_TYPES[op.type][0]}</td><td>${esc(roomOf(p, op.room)?.name || "")}</td><td class="num">${fmtM(op.width)}</td></tr>`).join("")}</table>` : ""}
      <h4>Drawing sheet</h4>
      <div class="pe-row"><label class="pe-field"><span>Sheet number</span><input data-meta="sheet" value="${esc(p.sheet || "A-101")}" maxlength="12"></label>
        <label class="pe-field"><span>Revision</span><input data-meta="revision" value="${esc(p.revision || "A")}" maxlength="4"></label></div>
      <label class="pe-field wide"><span>Drawn by</span><input data-meta="author" value="${esc(p.author || "")}" maxlength="60" placeholder="Your name or practice"></label>
      <p class="tiny muted">These go in the title block of the exported sheet (Export, top right).</p>`;
  }

  function bindFields(side) {
    if (E.mode === "simulate") bindSim(side);
    const text = $("#assist-text", side);
    if (text) text.oninput = () => { E.assist.text = text.value; };
    const feed = $("#assist-feed", side);
    if (feed && E.assist.running) side.scrollTop = side.scrollHeight;
    for (const el of $$("[data-meta]", side)) el.oninput = () => { E.plan[el.dataset.meta] = el.value.trim(); changed(false); };
    for (const el of $$("[data-prop]", side)) {
      el.onfocus = () => { E.fieldBefore = snapshot(); };
      el.oninput = () => applyField(el, false);
      el.onchange = () => { applyField(el, true); commit(E.fieldBefore || snapshot()); E.fieldBefore = snapshot(); };
    }
  }

  function applyField(el, final) {
    const s = selected();
    if (!s) return;
    const prop = el.dataset.prop;
    if (el.type === "number") {
      let v = parseFloat(el.value);
      if (!isFinite(v)) return;
      if (prop === "w" || prop === "h") v = Math.max(E.sel.kind === "room" ? MIN : 0.2, v);
      if (prop === "width" && E.sel.kind === "opening") v = clamp(v, 0.4, sideLength(roomOf(E.plan, s.room), s.side));
      s[prop] = r2(v);
      if (final) el.value = s[prop];
    } else if (prop === "type" && E.sel.kind === "room") {
      const old = (ROOM_TYPES[s.type] || ROOM_TYPES.other)[0];
      // a room still called by its default or type name follows its new type
      if (/^Room( \d+)?$/.test(s.name) || s.name.replace(/ \d+$/, "") === old) {
        s.name = uniqueName(ROOM_TYPES[el.value][0], s.id);
        const name = $("#pe-side [data-prop=name]");
        if (name) name.value = s.name;
      }
      s.type = el.value;
    } else s[prop] = el.value;
    render();
  }

  /* ---------------- simulation ---------------- */
  const CITIES = { Delhi: 28.6, Mumbai: 19.1, Bengaluru: 13.0, Singapore: 1.35, Dubai: 25.2, London: 51.5, Berlin: 52.5, "New York": 40.7,
    "San Francisco": 37.8, Tokyo: 35.7, Sydney: -33.9, "São Paulo": -23.5 };
  const ZONES = { Kolkata: "Delhi", Calcutta: "Delhi", Singapore: "Singapore", Dubai: "Dubai", London: "London", Berlin: "Berlin", New_York: "New York",
    Los_Angeles: "San Francisco", Tokyo: "Tokyo", Sydney: "Sydney", Sao_Paulo: "São Paulo" };
  const SEASONS = { winter: "21 December", equinox: "21 March", summer: "21 June" };
  const FACES = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const PEOPLE_COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2"];
  const WALK_SPEED = 9; // metres of route shown per second: about 7x walking pace
  function defaultSite() {
    let zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* no Intl */ }
    const city = ZONES[zone.split("/").pop()] || "Delhi";
    return { city, latitude: CITIES[city], north: 0 };
  }
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const compass = (az) => FACES[Math.round(az / 45) % 8];
  const tone = (v) => (v == null ? "" : v >= 80 ? "good" : v >= 60 ? "fair" : "poor");

  async function runSim() {
    const S = E.sim, planId = E.plan.id;
    S.loading = true;
    S.error = null;
    render(true);
    try {
      const site = E.plan.site;
      const res = await fetch("/api/plan/simulate", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: { rooms: E.plan.rooms, openings: E.plan.openings, items: E.plan.items },
          settings: { latitude: site.latitude, north: site.north, season: S.season } }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `the server answered ${res.status}`);
      if (E.plan?.id !== planId) return;
      S.result = body;
      S.stale = false;
      const samples = body.sun.samples;
      S.t = Math.max(0, samples.findIndex((x) => x.hour >= 10));
      S.tracks = body.movement.people.map((person, i) => {
        const pts = person.legs.filter((l) => l.ok).flatMap((l) => l.path);
        const cum = [0];
        for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
        return { name: person.name, color: PEOPLE_COLORS[i % PEOPLE_COLORS.length], pts, cum, total: cum[cum.length - 1] || 0 };
      });
    } catch (err) {
      S.error = String(err.message || err);
    }
    S.loading = false;
    render(true);
  }

  function setMode(mode) {
    if (mode === E.mode) return;
    E.mode = mode;
    E.sel = null;
    E.assist.open = false;
    E.tool = "select";
    if (mode === "simulate") { if (E.sim.stale || !E.sim.result) runSim(); else render(true); }
    else { stopSim(); render(true); }
  }

  function stopSim() {
    if (!E.sim) return;
    clearInterval(E.sim.sunTimer);
    cancelAnimationFrame(E.sim.walkFrame);
    E.sim.sunTimer = 0;
    E.sim.walking = false;
  }

  function simOverlay(X, Y, L) {
    const S = E.sim, r = S.result, out = [];
    if (!r) return "";
    const sample = r.sun.samples[S.t];
    for (const p of sample?.patches || []) {
      out.push(`<polygon points="${p.poly.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}" fill="#ffd54a" fill-opacity=".62" stroke="#e8a900" stroke-width="1" pointer-events="none"/>`);
    }
    for (const room of E.plan.rooms) {
      const m = r.sun.rooms[room.id];
      if (!m || L(room.w) < 60) continue;
      const hours = m.sun_hours, fill = hours >= 3 ? "#f2b600" : hours > 0 ? "#f7d774" : "#d6d3cc";
      out.push(`<g pointer-events="none"><rect x="${X(room.x) + 6}" y="${Y(room.y) + 6}" width="58" height="18" rx="9" fill="${fill}"/>
        <text x="${X(room.x) + 35}" y="${Y(room.y) + 19}" text-anchor="middle" font-size="11" font-weight="700" fill="#3b2f00">☀ ${+hours.toFixed(2)} h</text></g>`);
    }
    S.tracks.forEach((t) => {
      if (t.pts.length > 1) out.push(`<polyline points="${t.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}" fill="none" stroke="${t.color}" stroke-width="2" stroke-opacity=".35" stroke-linejoin="round" pointer-events="none"/>`);
    });
    out.push(`<g id="walkers" pointer-events="none">${S.tracks.map((t, i) => `<circle data-w="${i}" r="7" fill="${t.color}" stroke="#fff" stroke-width="2" cx="-99" cy="-99"/>`).join("")}</g>`);
    return out.join("");
  }

  // Compass and sun in the canvas corner: where north is on this plan and where the sun is now.
  function simHud(W) {
    const r = E.sim.result;
    if (!r) return "";
    const sample = r.sun.samples[E.sim.t], north = E.plan.site.north, cx = W - 64, cy = 72, R = 40;
    const at = (bearing, rad) => { const a = ((bearing - north) * Math.PI) / 180; return [r2(cx + Math.sin(a) * rad), r2(cy - Math.cos(a) * rad)]; };
    const [nx, ny] = at(0, R + 10), [sx, sy] = sample ? at(sample.azimuth, R * (1 - sample.elevation / 90)) : [cx, cy];
    return `<g pointer-events="none"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff" fill-opacity=".9" stroke="#bdb9ae"/>
      <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${INK}" stroke-width="2"/><text x="${nx}" y="${ny - 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">N</text>
      ${sample ? `<circle cx="${sx}" cy="${sy}" r="8" fill="#ffc107" stroke="#e8a900"/>` : ""}
      <text x="${W - 12}" y="${cy + R + 30}" text-anchor="end" font-size="11.5" fill="${INK}" stroke="${PAPER}" stroke-width="3" paint-order="stroke">${sample ? `${hhmm(sample.hour)} · sun ${Math.round(sample.elevation)}°, ${compass(sample.azimuth)}` : "night"}</text></g>`;
  }

  function placeWalkers() {
    const S = E.sim, { s, tx, ty } = E.view;
    if (!S.result) return;
    const now = S.walking ? (performance.now() - S.walkStart) / 1000 : S.walkPaused || 0;
    S.tracks.forEach((t, i) => {
      const dot = document.querySelector(`#walkers [data-w="${i}"]`);
      if (!dot || t.pts.length < 2) return;
      const d = (now * WALK_SPEED) % (t.total + 4);
      let k = t.cum.findIndex((c) => c >= d);
      if (k <= 0) k = d > 0 ? t.pts.length - 1 : 1;
      const a = t.pts[k - 1], b = t.pts[k], seg = t.cum[k] - t.cum[k - 1] || 1, f = Math.min(1, Math.max(0, (d - t.cum[k - 1]) / seg));
      dot.setAttribute("cx", r2(tx + (a[0] + (b[0] - a[0]) * f) * s));
      dot.setAttribute("cy", r2(ty + (a[1] + (b[1] - a[1]) * f) * s));
    });
  }

  function walkLoop() {
    if (!E.sim.walking || !$("#plan-editor")) return;
    placeWalkers();
    E.sim.walkFrame = requestAnimationFrame(walkLoop);
  }

  function simPanel() {
    const S = E.sim, r = S.result, site = E.plan.site;
    const card = (label, v, sub) => `<div class="sim-score ${tone(v)}"><b>${v ?? "–"}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ""}</div>`;
    const settings = `<div class="pe-row"><label class="pe-field"><span>Location</span><select data-sim="city">${Object.keys(CITIES).map((c) => `<option ${site.city === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label class="pe-field"><span>Day</span><select data-sim="season">${Object.entries(SEASONS).map(([k, v]) => `<option value="${k}" ${S.season === k ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
      <label class="pe-field wide"><span>The top of the plan faces</span><select data-sim="north">${FACES.map((f, i) => `<option value="${i * 45}" ${Number(site.north) === i * 45 ? "selected" : ""}>${f}</option>`).join("")}</select></label>`;
    if (!r) {
      return `<div class="pe-head"><h3>Simulation</h3><button class="link small" data-pact="mode" data-mode="design">Back to design</button></div>${settings}
        ${S.loading ? `<p class="small muted"><span class="spin"></span> Simulating the sun, the routes and the space…</p>` : ""}${S.error ? `<p class="assist-err">${esc(S.error)}</p>` : ""}`;
    }
    const samples = r.sun.samples, sample = samples[S.t];
    const daylightRows = r.daylight.rooms.map((x) => `<tr><td>${esc(x.room)}</td><td class="num">${x.sun_hours} h</td><td class="num">${Math.round(x.glazing_ratio * 100)}%</td></tr>`).join("");
    const people = r.movement.people.map((p, i) => `<tr><td><span class="swatch" style="background:${PEOPLE_COLORS[i % PEOPLE_COLORS.length]}"></span>${esc(p.name)}</td>
      <td class="num">${Math.round(p.daily_m)} m</td><td class="num">${p.legs.filter((l) => !l.ok).length ? `<span class="bad">${p.legs.filter((l) => !l.ok).length} blocked</span>` : "✓"}</td></tr>`).join("");
    const notes = (xs) => (xs.length ? `<ul class="sim-notes">${xs.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="small muted">Nothing to flag.</p>`);
    return `<div class="pe-head"><h3>Simulation</h3><button class="link small" data-pact="mode" data-mode="design">Back to design</button></div>
      <div class="sim-scores">${card("Overall", r.overall)}${card("Daylight", r.scores.daylight)}${card("Movement", r.scores.movement)}${card("Space", r.scores.space)}</div>
      <p class="tiny muted" style="margin:6px 0 12px">Measured from the plan's geometry: rules of thumb to compare options, not a building-code check.
        <a href="https://github.com/compiler-aditya/groundtruth/blob/main/docs/simulation.md" target="_blank" rel="noopener">How it's scored</a>${S.stale ? " · <b>The plan changed</b>: <button class='link small' data-pact='sim-rerun'>run again</button>" : ""}</p>
      ${settings}
      <h4>☀ Sun on ${SEASONS[S.season]} in ${esc(site.city)}</h4>
      <div class="sim-time"><button class="btn small" data-pact="sim-sun-play" title="Play the day">${S.sunTimer ? "❚❚" : "▶"}</button>
        <input type="range" min="0" max="${samples.length - 1}" value="${S.t}" data-sim="t" aria-label="Time of day">
        <span class="mono small">${sample ? hhmm(sample.hour) : ""}</span></div>
      <p class="tiny muted" style="margin:2px 0 8px">Solar time. Sunrise to sunset: ${r.sun.daylight_hours} h of daylight.</p>
      ${r.daylight.rooms.length ? `<table class="pe-table"><tr><td class="muted small">Room</td><td class="num muted small">Direct sun</td><td class="num muted small">Windows</td></tr>${daylightRows}</table>` : ""}
      ${notes(r.daylight.notes)}
      <h4>🚶 A day of moving around</h4>
      <div class="pe-actions"><button class="btn small" data-pact="sim-walk">${S.walking ? "❚❚ Pause" : "▶ Watch everyone's day"}</button></div>
      <table class="pe-table">${people}</table>
      ${notes(r.movement.notes)}
      <h4>♿ Space</h4>${notes(r.space.notes)}
      ${simAi()}`;
  }

  const SIM_GOALS = ["More sun in the bedrooms and the living room", "Keep guests out of the bedrooms", "Shorter walks to the kitchen and bathroom",
    "Make it easier for a wheelchair user"];
  function simAi() {
    const A = E.assist, S = E.sim, c = S.compare;
    if (A.running) return `<h4>✨ Improving with AI</h4><p class="small muted"><span class="spin"></span> Muse Wonder is changing the plan and re-running the simulation…</p>
      <div class="assist-feed">${feedHtml(A)}</div>`;
    const row = (k, label) => {
      const b = c.before[k], a = c.after[k];
      if (b == null && a == null) return "";
      const d = (a ?? 0) - (b ?? 0);
      return `<tr><td>${label}</td><td class="num">${b ?? "–"}</td><td class="num"><b>${a ?? "–"}</b></td><td class="num ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" : ""}${d || "±0"}</td></tr>`;
    };
    const compare = c ? `<div class="assist-done ${c.finished ? "" : "warn"}"><b>${!c.finished ? "Stopped before it finished" : c.changed ? "✓ Improved, measured by the simulation" : "No change kept"}</b>
        <table class="pe-table sim-compare"><tr><td></td><td class="num muted small">Before</td><td class="num muted small">After</td><td></td></tr>
        ${row("overall", "Overall")}${row("daylight", "Daylight")}${row("movement", "Movement")}${row("space", "Space")}</table>
        ${c.summary ? `<p>${esc(c.summary)}</p>` : ""}<span class="tiny muted">${c.seconds} s · $${(c.cost || 0).toFixed(2)}</span>
        ${c.changed ? `<div class="pe-actions" style="margin-top:8px"><button class="btn small" data-pact="sim-keep">Keep it</button><button class="btn small" data-pact="sim-undo">Undo</button></div>` : ""}</div>` : "";
    return `<h4>✨ Improve with AI</h4>
      <p class="tiny muted" style="margin:0 0 8px">Muse Wonder changes the plan, re-runs this simulation after each change and undoes what scores worse.
        The code won't let it finish if the overall score went down.</p>${compare}
      <textarea id="sim-goal" rows="2" maxlength="800" placeholder="e.g. ${esc(SIM_GOALS[0])}">${esc(S.goal || "")}</textarea>
      <div class="pe-chips">${SIM_GOALS.map((t) => `<button data-pact="sim-goal" data-text="${esc(t)}" title="${esc(t)}">${esc(short(t))}</button>`).join("")}</div>
      <button class="btn primary" style="width:100%" data-pact="sim-improve" ${AI.ready ? "" : "disabled"}>Improve the plan</button>
      ${A.error ? `<p class="assist-err">${esc(A.error)}</p>` : ""}`;
  }

  function bindSim(side) {
    const goal = $("#sim-goal", side);
    if (goal) goal.oninput = () => { E.sim.goal = goal.value; };
    for (const el of $$("[data-sim]", side)) {
      const apply = () => {
        const k = el.dataset.sim, site = E.plan.site;
        if (k === "t") { E.sim.t = Number(el.value); render(); return; }
        if (k === "city") { site.city = el.value; site.latitude = CITIES[el.value]; }
        if (k === "north") site.north = Number(el.value);
        if (k === "season") E.sim.season = el.value;
        changed(false);
        runSim();
      };
      el.oninput = el.dataset.sim === "t" ? apply : null;
      el.onchange = el.dataset.sim === "t" ? null : apply;
    }
  }

  Object.assign(EDIT_ACTIONS, {
    mode: (el) => setMode(el.dataset.mode),
    "sim-goal": (el) => { E.sim.goal = el.dataset.text; render(true); },
    "sim-improve": () => {
      const site = E.plan.site;
      E.assist.error = null;
      runAssist({ text: E.sim.goal || "", mode: "improve", settings: { latitude: site.latitude, north: site.north, season: E.sim.season } });
    },
    "sim-keep": () => { E.sim.compare = null; render(true); },
    "sim-undo": () => { undo(); E.sim.compare = null; runSim(); },
    "sim-rerun": runSim,
    "sim-sun-play": () => {
      const S = E.sim;
      if (S.sunTimer) { clearInterval(S.sunTimer); S.sunTimer = 0; render(true); return; }
      if (S.t >= S.result.sun.samples.length - 1) S.t = 0;
      S.sunTimer = setInterval(() => {
        if (!$("#plan-editor") || E.mode !== "simulate") return stopSim();
        S.t += 1;
        if (S.t >= S.result.sun.samples.length - 1) { clearInterval(S.sunTimer); S.sunTimer = 0; }
        render(true);
      }, 140);
      render(true);
    },
    "sim-walk": () => {
      const S = E.sim;
      if (S.walking) { S.walkPaused = (performance.now() - S.walkStart) / 1000; S.walking = false; cancelAnimationFrame(S.walkFrame); }
      else { S.walkStart = performance.now() - (S.walkPaused || 0) * 1000; S.walking = true; walkLoop(); }
      render(true);
    },
  });

  /* ---------------- design assistant ---------------- */
  const EX_NEW = ["A three-bedroom family house of about 110 m² with an open kitchen and living area, two bathrooms and a hallway",
    "A one-bedroom apartment of about 50 m² with a balcony", "A small dental clinic with a reception, a waiting room, two treatment rooms, a staff room, a WC and a store",
    "A café of about 80 m² with seating, a counter, a kitchen, a store and two WCs"];
  const EX_EDIT = ["Add a home office of about 9 m² next to the living room", "Give the main bedroom its own bathroom", "Add a single garage on the west side"];
  const short = (t) => t.split(" ").slice(0, 5).join(" ") + "…";

  const feedHtml = (A) => A.feed.map((f) => f.kind === "note" ? `<div class="msg">${esc(f.text)}</div>`
    : f.kind === "turn" ? `<div class="turn">${esc(f.text)}</div>`
    : `<div class="ev ${f.kind}"><span>${f.kind === "ok" ? "✓" : "✗"}</span><span>${esc(f.text)}</span></div>`).join("");

  function assistPanel() {
    const A = E.assist, hasRooms = E.plan.rooms.length > 0, mode = hasRooms ? A.mode : "new", examples = mode === "edit" ? EX_EDIT : EX_NEW;
    const feed = feedHtml(A);
    const r = A.result;
    const resultBox = r ? `<div class="assist-done ${r.finished ? "" : "warn"}"><b>${r.finished ? "✓ Done" : "Stopped before the plan passed its checks"}</b>
        <span class="small">${r.check.rooms} rooms · ${fmtA(r.check.total_area_m2)} · ${r.turns} turns · ${r.seconds} s · $${(r.cost_usd || 0).toFixed(2)}</span>
        ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
        ${r.check.errors.length ? `<ul class="bad">${r.check.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
        ${r.check.warnings.length ? `<p class="tiny muted" style="margin:6px 0 2px">Worth a look:</p><ul>${r.check.warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
        <div class="pe-actions" style="margin-top:8px"><button class="btn small" data-pact="undo">Undo the assistant's changes</button></div>
        <p class="tiny muted">Furniture isn't placed by the assistant yet: add it with the Furniture tool (F).</p></div>` : "";
    return `<div class="pe-head"><h3>✨ Design assistant</h3><button class="link small" data-pact="assist-close">Close</button></div>
      <p class="small muted" style="margin:0 0 10px">Describe what you want. Muse Wonder lays out rooms, doors and windows with the editor's own tools;
        the code measures every step and refuses anything that overlaps or doesn't fit.</p>
      ${hasRooms ? `<div class="pe-seg"><button data-pact="assist-mode" data-mode="edit" class="${mode === "edit" ? "on" : ""}" ${A.running ? "disabled" : ""}>Change this plan</button>
        <button data-pact="assist-mode" data-mode="new" class="${mode === "new" ? "on" : ""}" ${A.running ? "disabled" : ""}>Start a new layout</button></div>` : ""}
      <textarea id="assist-text" maxlength="800" rows="4" placeholder="${esc(mode === "edit" ? "e.g. " + EX_EDIT[0] : "e.g. " + EX_NEW[0])}" ${A.running ? "disabled" : ""}>${esc(A.text)}</textarea>
      <div class="pe-chips">${examples.map((t) => `<button data-pact="assist-example" data-text="${esc(t)}" title="${esc(t)}" ${A.running ? "disabled" : ""}>${esc(short(t))}</button>`).join("")}</div>
      <button class="btn primary" style="width:100%" data-pact="assist-run" ${A.running || !AI.ready ? "disabled" : ""}>${A.running ? `<span class="spin"></span> Designing… a minute or two` : mode === "new" ? "Design it" : "Make the change"}</button>
      ${AI.ready ? "" : `<p class="note-off">The assistant is off on this deployment (no API key).</p>`}
      ${mode === "new" && hasRooms && !A.running && !r ? `<p class="tiny muted">This replaces the rooms, doors and windows. One undo brings them back.</p>` : ""}
      ${A.error ? `<p class="assist-err">${esc(A.error)}</p>` : ""}
      ${feed ? `<div class="assist-feed" id="assist-feed">${feed}</div>` : ""}${resultBox}`;
  }

  function applyAssistPlan(p) {
    const before = new Set(E.plan.rooms.map((r) => r.id));
    E.plan.rooms = p.rooms;
    E.plan.openings = p.openings;
    if (Array.isArray(p.items) && E.assist.runMode !== "new") E.plan.items = p.items;
    E.flash = new Set(p.rooms.filter((r) => !before.has(r.id)).map((r) => r.id));
    if (E.assist.runMode === "new" || p.rooms.some((r) => !before.has(r.id))) fitToScreen();
  }

  async function runAssist(opts = {}) {
    const A = E.assist, text = (opts.text ?? A.text).trim(), planId = E.plan.id;
    if (text.length < 3) { A.error = "Describe what you want first, or pick an example."; render(true); return; }
    const mode = opts.mode || (E.plan.rooms.length ? A.mode : "new");
    if (mode === "improve") { stopSim(); E.sim.compare = null; }
    Object.assign(A, { running: true, feed: [], result: null, error: null, before: snapshot(), runMode: mode });
    if (mode === "new") { E.plan.rooms = []; E.plan.openings = []; E.plan.items = []; }
    E.sel = null;
    E.tool = "select";
    render(true);
    const live = () => E.plan?.id === planId && $("#plan-editor");
    const fail = (message) => {
      if (!live()) return;
      Object.assign(A, { running: false, error: `The assistant stopped: ${message} Your plan is back as it was.` });
      E.flash = new Set();
      restore(A.before);
      if (mode === "improve") runSim();
    };
    try {
      const res = await fetch("/api/plan/assist", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: text, mode, settings: opts.settings,
          plan: mode === "new" ? null : { rooms: E.plan.rooms, openings: E.plan.openings, items: E.plan.items } }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.detail || `the server answered ${res.status}.`); }
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buf = "", done = false;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || !live()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "note") A.feed.push({ kind: "note", text: ev.text });
          else if (ev.type === "turn") A.feed.push({ kind: "turn", text: `Turn ${ev.turn} · thought for ${ev.thinking_s} s · ${ev.calls} tool call${ev.calls === 1 ? "" : "s"}` });
          else if (ev.type === "tool") { A.feed.push({ kind: ev.ok ? "ok" : "no", text: ev.brief }); if (ev.plan) applyAssistPlan(ev.plan); }
          else if (ev.type === "error") throw new Error(ev.message);
          else if (ev.type === "done") {
            done = true;
            applyAssistPlan(ev.plan);
            E.flash = new Set();
            if (mode === "new" && ev.name) { E.plan.name = ev.name; const n = $("#pe-name"); if (n) n.value = ev.name; }
            if (mode === "new" && KINDS[ev.kind]) { E.plan.kind = ev.kind; const k = $("#pe-kind"); if (k) k.value = ev.kind; }
            Object.assign(A, { running: false, result: mode === "improve" ? null : ev, text: mode === "improve" ? A.text : "", mode: "edit" });
            E.undo.push(A.before);
            E.redo = [];
            fitToScreen();
            changed(true, true);
            if (mode === "improve") {
              E.sim.compare = { before: ev.before, after: ev.after, summary: ev.summary, finished: ev.finished, seconds: ev.seconds, cost: ev.cost_usd,
                changed: JSON.stringify(JSON.parse(A.before)) !== JSON.stringify({ rooms: E.plan.rooms, openings: E.plan.openings, items: E.plan.items }) };
              runSim();
            }
            continue;
          }
          render(true);
        }
      }
      if (!done) throw new Error("the connection closed before it finished.");
    } catch (err) {
      fail(String(err.message || err));
    }
  }

  Object.assign(EDIT_ACTIONS, {
    assist: () => { E.assist.open = !E.assist.open; E.sel = null; render(true); if (E.assist.open) setTimeout(() => $("#assist-text")?.focus(), 0); },
    "assist-close": () => { E.assist.open = false; render(true); },
    "assist-mode": (el) => { E.assist.mode = el.dataset.mode; E.assist.result = null; render(true); },
    "assist-example": (el) => { E.assist.text = el.dataset.text; render(true); },
    "assist-run": runAssist,
  });

  window.addEventListener("resize", () => { if ($("#plan-editor") && E.view) render(); });

  function route(hash, app) {
    const id = hash.startsWith("#/plan/") ? decodeURIComponent(hash.slice(7)) : "";
    if (id) renderEditor(app, id);
    else renderList(app);
  }

  return { route, drawPlan, fitView, walls, TEMPLATES };
})();
