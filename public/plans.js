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
  const E = { plan: null, view: null, sel: null, tool: "select", undo: [], redo: [], drag: null, hover: null, ghost: null, guides: [], space: false, saveTimer: 0, savedOk: true };
  const EDIT_ACTIONS = {};

  function renderEditor(app, id) {
    const plan = getPlan(id);
    if (!plan) {
      app.innerHTML = `<div class="page-head"><h1>Plan not found</h1><p class="muted">It may have been made in another browser. Plans are saved per browser.</p>
        <a class="btn" href="#/plans">← All plans</a></div>`;
      return;
    }
    Object.assign(E, { plan, sel: null, tool: "select", undo: [], redo: [], drag: null, hover: null, ghost: null, guides: [], view: null });
    app.innerHTML = `
    <div class="pe" id="plan-editor">
      <div class="pe-top">
        <a class="btn small" href="#/plans" title="All plans">←</a>
        <input class="pe-name" id="pe-name" value="${esc(plan.name)}" aria-label="Plan name" maxlength="80">
        <select id="pe-kind" aria-label="Building type">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${plan.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <span class="pe-status small muted" id="pe-status"></span>
        <span class="pe-spacer"></span>
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
  ];
  const HINTS = {
    select: "Click a room to edit it · drag to move · drag its edges to resize · drag empty space to pan · scroll to zoom",
    room: "Drag to draw a room. It snaps to the 10 cm grid and to other walls; hold Alt for free placement.",
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
    if (tool !== "select") E.sel = null;
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

  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    try { $("#pc").setPointerCapture(ev.pointerId); } catch { /* synthetic events have no capturable pointer */ }
    const p = toWorld(ev);
    if (ev.button === 1 || E.space) { E.drag = { mode: "pan", start: p, view: { ...E.view } }; return; }
    if (E.tool === "room") {
      const x = snapEdge(p.x, roomTargets("x"), ev.altKey), y = snapEdge(p.y, roomTargets("y"), ev.altKey);
      E.drag = { mode: "draw", x0: x.v, y0: y.v, before: snapshot() };
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
    if (!d) return;
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
    deselect: () => select(null),
  });

  document.addEventListener("keydown", (e) => {
    if (!$("#plan-editor")) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
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
    if (E.ghost) {
      const gh = E.ghost;
      out.push(`<rect x="${X(gh.x)}" y="${Y(gh.y)}" width="${L(gh.w)}" height="${L(gh.h)}" fill="${ACCENT}" fill-opacity=".12" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>`);
      out.push(tag(X(gh.x + gh.w / 2), Y(gh.y) - 10, `${gh.w.toFixed(2)} × ${gh.h.toFixed(2)} m · ${fmtA(gh.w * gh.h)}`));
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
    svg.innerHTML = `<rect width="${W}" height="${H}" fill="${PAPER}"/>` + drawPlan(E.plan, E.view, { width: W, height: H, grid: true, overlay }) + scaleBar(W, H);
    $("#pe-scale").textContent = `${Math.round(E.view.s)} px/m`;
    $("#pe-hint").textContent = E.drag ? "" : HINTS[E.tool] || "";
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
    const html = TOOLS.map(([id, label, key, ic]) => `<button class="pe-tool ${E.tool === id ? "on" : ""}" data-pact="tool" data-tool="${id}" title="${label} (${key})"
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
    const key = E.sel ? `${E.sel.kind}:${E.sel.id}` : "plan";
    if (!force && key === side._key && side.contains(document.activeElement)) { paintLive(); return; }
    side._key = key;
    const s = selected();
    side.innerHTML = s && E.sel.kind === "room" ? roomPanel(s) : summaryPanel();
    bindFields(side);
    paintLive();
  }

  function paintLive() {
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

  function summaryPanel() {
    const p = E.plan, doors = p.openings.filter((o) => o.type === "door").length, windows = p.openings.filter((o) => o.type === "window").length;
    const issues = overlaps(p).map((o) => `${o.a.name} and ${o.b.name} overlap by ${fmtA(o.w * o.h)}`);
    return `<h3>Plan summary</h3>
      <div class="pe-stats"><div><b>${fmtA(totalArea(p))}</b><span>floor area</span></div><div><b>${p.rooms.length}</b><span>rooms</span></div>
        <div><b>${doors}</b><span>doors</span></div><div><b>${windows}</b><span>windows</span></div></div>
      ${issues.length ? `<div class="pe-issues"><b>Check the plan</b><ul>${issues.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      <h4>Rooms</h4>${p.rooms.length ? `<table class="pe-table">${p.rooms.map((r) => `<tr data-pact="select-room" data-id="${r.id}" data-select><td><span class="swatch" style="background:${(ROOM_TYPES[r.type] || ROOM_TYPES.other)[1]}"></span>${esc(r.name)}</td>
        <td class="num">${fmtA(area(r))}</td></tr>`).join("")}</table>` : `<p class="small muted">No rooms yet. Pick <b>Draw a room</b> (R) and drag on the grid.</p>`}`;
  }

  function bindFields(side) {
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
      if (prop === "w" || prop === "h") v = Math.max(MIN, v);
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

  window.addEventListener("resize", () => { if ($("#plan-editor") && E.view) render(); });

  function route(hash, app) {
    const id = hash.startsWith("#/plan/") ? decodeURIComponent(hash.slice(7)) : "";
    if (id) renderEditor(app, id);
    else renderList(app);
  }

  return { route, drawPlan, fitView, walls, TEMPLATES };
})();
