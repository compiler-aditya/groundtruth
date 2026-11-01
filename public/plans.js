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
      <div class="plan-grid">${Object.entries(TEMPLATES).map(([key, t]) => {
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
  const E = { plan: null, view: null, sel: null, tool: "select", undo: [], redo: [], drag: null, hover: null, saveTimer: 0, savedOk: true };
  const EDIT_ACTIONS = {};

  function renderEditor(app, id) {
    const plan = getPlan(id);
    if (!plan) {
      app.innerHTML = `<div class="page-head"><h1>Plan not found</h1><p class="muted">It may have been made in another browser. Plans are saved per browser.</p>
        <a class="btn" href="#/plans">← All plans</a></div>`;
      return;
    }
    Object.assign(E, { plan, sel: null, tool: "select", undo: [], redo: [], drag: null, hover: null, view: null });
    app.innerHTML = `
    <div class="pe" id="plan-editor">
      <div class="pe-top">
        <a class="btn small" href="#/plans" title="All plans">←</a>
        <input class="pe-name" id="pe-name" value="${esc(plan.name)}" aria-label="Plan name" maxlength="80">
        <select id="pe-kind" aria-label="Building type">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${plan.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <span class="pe-status small muted" id="pe-status"></span>
        <span class="pe-spacer"></span>
        <span class="pe-zoom"><button class="btn small" data-pact="zoom-out" title="Zoom out">−</button><span id="pe-scale" class="small mono"></span>
          <button class="btn small" data-pact="zoom-in" title="Zoom in">+</button><button class="btn small" data-pact="fit" title="Zoom to fit (F)">Fit</button></span>
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
    requestAnimationFrame(() => { fitToScreen(); render(); });
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

  // Pointer handling: in this first version, dragging anywhere pans the view.
  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    $("#pc").setPointerCapture(ev.pointerId);
    E.drag = { mode: "pan", start: toWorld(ev), view: { ...E.view } };
  }
  function onPointerMove(ev) {
    const d = E.drag;
    if (!d) return;
    const p = toWorld(ev);
    if (d.mode === "pan") { E.view = { ...d.view, tx: d.view.tx + p.px - d.start.px, ty: d.view.ty + p.py - d.start.py }; render(); }
  }
  function onPointerUp() { E.drag = null; }

  function changed(redraw = true) {
    clearTimeout(E.saveTimer);
    E.saveTimer = setTimeout(() => { E.savedOk = savePlan(E.plan); paintStatus(); }, 400);
    if (redraw) render();
    else paintStatus();
  }
  function paintStatus() {
    const el = $("#pe-status");
    if (el) el.textContent = E.savedOk ? "Saved in this browser" : "Not saved: this browser blocks storage. Export the plan to keep it.";
  }

  function render() {
    const svg = $("#pc");
    if (!svg || !E.plan) return;
    const { W, H } = canvasSize();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<rect width="${W}" height="${H}" fill="${PAPER}"/>` + drawPlan(E.plan, E.view, { width: W, height: H, grid: true }) + scaleBar(W, H);
    $("#pe-scale").textContent = `${Math.round(E.view.s)} px/m`;
    paintSide();
    paintStatus();
  }

  function scaleBar(W, H) {
    const s = E.view.s, m = [0.5, 1, 2, 5, 10, 20].find((v) => v * s >= 60) || 20, x = 16, y = H - 18;
    return `<g pointer-events="none"><line x1="${x}" y1="${y}" x2="${r2(x + m * s)}" y2="${y}" stroke="${INK}" stroke-width="2"/>
      <line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="${INK}"/><line x1="${r2(x + m * s)}" y1="${y - 4}" x2="${r2(x + m * s)}" y2="${y + 4}" stroke="${INK}"/>
      <text x="${r2(x + m * s + 6)}" y="${y + 4}" font-size="11" fill="${INK}">${m} m</text></g>`;
  }

  function paintSide() {
    const side = $("#pe-side");
    if (!side) return;
    const p = E.plan, doors = p.openings.filter((o) => o.type === "door").length, windows = p.openings.filter((o) => o.type === "window").length;
    side.innerHTML = `<h3>Plan summary</h3>
      <div class="pe-stats"><div><b>${fmtA(totalArea(p))}</b><span>floor area</span></div><div><b>${p.rooms.length}</b><span>rooms</span></div>
        <div><b>${doors}</b><span>doors</span></div><div><b>${windows}</b><span>windows</span></div></div>
      <h4>Rooms</h4>${p.rooms.length ? `<table class="pe-table">${p.rooms.map((r) => `<tr><td><span class="swatch" style="background:${(ROOM_TYPES[r.type] || ROOM_TYPES.other)[1]}"></span>${esc(r.name)}</td>
        <td class="num">${fmtA(area(r))}</td></tr>`).join("")}</table>` : `<p class="small muted">No rooms yet.</p>`}`;
  }

  window.addEventListener("resize", () => { if ($("#plan-editor") && E.view) render(); });

  function route(hash, app) {
    const id = hash.startsWith("#/plan/") ? decodeURIComponent(hash.slice(7)) : "";
    if (id) renderEditor(app, id);
    else renderList(app);
  }

  return { route, drawPlan, fitView, walls, TEMPLATES };
})();
