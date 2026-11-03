/* GroundTruth studio (studio.html): the designs page and the editor. Plain JS. Designs are kept in this browser and,
   when signed in (auth.js), in the account too.
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
  const INK = "#262626", PAPER = "#fcfcfb", ACCENT = "#ff4c00";

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
  const FLOORS = { wood: ["Wood", 0xc69c6d], tile: ["Tiles", 0xdcd7ce], carpet: ["Carpet", 0x9fa8b3], stone: ["Stone", 0xbdb6aa], concrete: ["Concrete", 0xaaa7a1] };
  const defaultFloor = (type) => ({ bathroom: "tile", kitchen: "tile", utility: "tile", balcony: "stone", garage: "concrete", storage: "concrete", office: "carpet",
    meeting: "carpet", retail: "tile", reception: "stone" }[type] || "wood");
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

  /* ---------------- storage: this browser, and the account when signed in ---------------- */
  const GUEST = "gt.plans.v1";
  const signedIn = () => window.GTAuth?.user || null;
  const storeKey = () => (signedIn() ? `gt.plans.u.${signedIn().id}` : GUEST); // a shared computer keeps accounts apart
  let memory = {}; // used when the browser refuses storage
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(storeKey()) || "{}"); } catch { return memory; }
  }
  function saveAll(all) {
    memory = all;
    try { localStorage.setItem(storeKey(), JSON.stringify(all)); return true; } catch { return false; }
  }
  function savePlan(plan) {
    const all = loadAll();
    plan.updated = Date.now();
    all[plan.id] = plan;
    Cloud.push(plan);
    return saveAll(all);
  }
  const getPlan = (id) => loadAll()[id];
  function deletePlan(id) { const all = loadAll(); delete all[id]; saveAll(all); Cloud.remove(id); }

  // Signed in, each save also goes to the account, a moment later so that typing doesn't send a request per key.
  const Cloud = {
    timers: {}, state: "", msg: "",
    push(plan) {
      if (!signedIn()) return;
      clearTimeout(this.timers[plan.id]);
      this.set("saving");
      this.timers[plan.id] = setTimeout(async () => {
        try {
          const res = await fetch(`/api/designs/${encodeURIComponent(plan.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: plan.name, updated: plan.updated, data: plan }) });
          this.set(res.ok ? "saved" : "error", res.ok ? "" : (await res.json().catch(() => ({}))).detail);
        } catch { this.set("error"); }
      }, 700);
    },
    remove(id) { if (signedIn()) fetch(`/api/designs/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {}); },
    set(state, msg = "") { this.state = state; this.msg = msg; paintStatus(); },
    // On sign-in, designs made here as a guest move into the account; then the newer copy of each design wins.
    async sync() {
      if (!signedIn()) return;
      const mine = loadAll();
      let guest = {};
      try { guest = JSON.parse(localStorage.getItem(GUEST) || "{}"); localStorage.removeItem(GUEST); } catch {}
      for (const p of Object.values(guest)) if (!mine[p.id] || (mine[p.id].updated || 0) < (p.updated || 0)) mine[p.id] = p;
      const res = await fetch("/api/designs");
      const remote = new Map();
      if (res.ok) {
        for (const d of (await res.json()).designs) {
          remote.set(d.id, d.updated);
          if (!mine[d.id] || (mine[d.id].updated || 0) < d.updated) mine[d.id] = d.data;
        }
      }
      saveAll(mine);
      for (const p of Object.values(mine)) if (!remote.has(p.id) || remote.get(p.id) < (p.updated || 0)) this.push(p);
    },
  };

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
  // furniture follows its room: a piece against a wall moves with that wall, the rest keep their relative place
  const itemsIn = (plan, r) => plan.items.filter((it) => it.cx >= r.x && it.cx <= r.x + r.w && it.cy >= r.y && it.cy <= r.y + r.h).map((it) => ({ it, cx: it.cx, cy: it.cy }));
  function carryItems(held, o, r) {
    const follow = (c, half, lo, hi, nlo, nhi) => (c - half - lo < 0.15 ? nlo + c - lo : hi - c - half < 0.15 ? nhi - (hi - c) : nlo + ((c - lo) * (nhi - nlo)) / (hi - lo));
    for (const { it, cx, cy } of held) {
      const [fw, fd] = footprint(it);
      it.cx = r2(clamp(follow(cx, fw / 2, o.x, o.x + o.w, r.x, r.x + r.w), r.x + fw / 2, r.x + r.w - fw / 2));
      it.cy = r2(clamp(follow(cy, fd / 2, o.y, o.y + o.h, r.y, r.y + r.h), r.y + fd / 2, r.y + r.h - fd / 2));
    }
  }
  function fitView(plan, W, H, pad = 50) {
    const b = bounds(plan);
    const s = clamp(Math.min((W - 2 * pad) / Math.max(b.w, 1), (H - 2 * pad) / Math.max(b.h, 1)), 8, 400);
    return { s, tx: (W - b.w * s) / 2 - b.x * s, ty: (H - b.h * s) / 2 - b.y * s };
  }

  /* ---------------- drawing ---------------- */
  // Returns SVG markup for a plan in screen pixels. opts: { width, height, grid, labels, sel, hover, dims }
  const NO_HIDE = new Set();
  function drawPlan(plan, view, opts = {}) {
    const { s, tx, ty } = view, hide = opts.hide || NO_HIDE;
    const X = (x) => r2(tx + x * s), Y = (y) => r2(ty + y * s), L = (d) => r2(d * s);
    const out = [];
    if (opts.grid && !hide.has("grid")) out.push(grid(view, opts.width, opts.height));
    if (!hide.has("rooms")) for (const r of plan.rooms) {
      out.push(`<rect class="room" data-kind="room" data-id="${r.id}" x="${X(r.x)}" y="${Y(r.y)}" width="${L(r.w)}" height="${L(r.h)}" fill="${(ROOM_TYPES[r.type] || ROOM_TYPES.other)[1]}" fill-opacity=".72"/>`);
    }
    if (!hide.has("items")) for (const it of plan.items) out.push(drawItem(it, X, Y, L));
    if (!hide.has("walls")) for (const w of walls(plan)) {
      const ext = (cap) => (cap ? w.t / 2 : 0);
      const a = w.a - ext(w.ca), b = w.b + ext(w.cb);
      out.push(w.o === "h"
        ? `<line x1="${X(a)}" y1="${Y(w.c)}" x2="${X(b)}" y2="${Y(w.c)}" stroke="${INK}" stroke-width="${Math.max(1.5, L(w.t))}"/>`
        : `<line x1="${X(w.c)}" y1="${Y(a)}" x2="${X(w.c)}" y2="${Y(b)}" stroke="${INK}" stroke-width="${Math.max(1.5, L(w.t))}"/>`);
    }
    if (!hide.has("openings")) for (const op of plan.openings) out.push(drawOpening(plan, op, X, Y, L));
    if (opts.labels !== false && !hide.has("labels")) for (const r of plan.rooms) {
      const w = L(r.w), h = L(r.h), cx = X(r.x + r.w / 2), cy = Y(r.y + r.h / 2);
      if (w < 34 || h < 22) continue;
      const big = w > 70 && h > 40;
      const halo = `stroke="${PAPER}" stroke-width="3" stroke-opacity=".85" paint-order="stroke" stroke-linejoin="round"`;
      out.push(`<text class="lbl" x="${cx}" y="${cy - (big ? 3 : -4)}" text-anchor="middle" font-size="${big ? 12.5 : 11}" font-weight="600" fill="${INK}" ${halo}>${esc(fit(r.name, w))}</text>`);
      if (big) out.push(`<text class="lbl" x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="11" fill="#5a5850" ${halo}>${fmtA(area(r))}</text>`);
    }
    if (opts.dims && !hide.has("dims")) for (const r of plan.rooms) { // each room's width along its top, depth along its left side
      if (L(r.w) < 50 || L(r.h) < 40) continue;
      out.push(`<g class="lbl" font-size="10" fill="#6b6b6b" font-family="JetBrains Mono, monospace"><text x="${X(r.x + r.w / 2)}" y="${Y(r.y) + 13}" text-anchor="middle">${r.w.toFixed(2)}</text>
        <text transform="translate(${X(r.x) + 11} ${Y(r.y + r.h / 2)}) rotate(-90)" text-anchor="middle">${r.h.toFixed(2)}</text></g>`);
    }
    if (!hide.has("notes")) for (const n of plan.notes || []) {
      const x = X(n.x), y = Y(n.y), text = fit(n.text || "Note", 200), w = text.length * 6.4 + 14;
      out.push(`<g class="note" data-kind="note" data-id="${n.id}"><circle cx="${x}" cy="${y}" r="5" fill="${ACCENT}" stroke="#fff" stroke-width="1.5"/>
        <rect x="${x + 8}" y="${y - 10}" width="${r2(w)}" height="20" rx="3" fill="#fff8e6" stroke="#e8c37a"/>
        <text x="${x + 15}" y="${y + 4}" font-size="11.5" fill="${INK}">${esc(text)}</text></g>`);
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

  /* ---------------- designs page ---------------- */
  const isDark = () => document.documentElement.dataset.theme === "dark";
  const themeLabel = () => (isDark() ? "Light mode" : "Dark mode");
  function toggleTheme() {
    const dark = !isDark();
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("gt.theme", dark ? "dark" : "light"); } catch {}
    $$("[data-pact=theme]").forEach((b) => { if (!b.classList.contains("theme-btn")) b.textContent = themeLabel(); });
  }
  const THEME_BTN = `<button class="theme-btn" data-pact="theme" aria-label="Switch between light and dark" title="Light or dark">
    <svg class="moon" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 12.5A6.5 6.5 0 017.5 4a6.5 6.5 0 108.5 8.5z"/></svg>
    <svg class="sun" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/></svg></button>`;
  const appBar = () => `<header class="app-bar"><a class="app-brand" href="/" title="GroundTruth home"><span class="mark">✓</span><span>GroundTruth</span></a>
    <span class="app-tag">Studio</span><span class="pe-spacer"></span>${THEME_BTN}<span class="acct-slot" id="acct"></span></header>`;
  // The blank template's picture: an empty sheet with a dashed room to draw.
  const BLANK_ART = `<svg viewBox="0 0 280 180" aria-hidden="true"><rect width="280" height="180" fill="${PAPER}"/>
    <rect x="86" y="44" width="108" height="92" rx="2" fill="none" stroke="#c9c6bd" stroke-width="2" stroke-dasharray="7 6"/>
    <path d="M140 76v28M126 90h28" stroke="${ACCENT}" stroke-width="2.5" stroke-linecap="round"/></svg>`;

  function renderList(app) {
    const mine = Object.values(loadAll()).sort((a, b) => b.updated - a.updated), user = signedIn();
    const guestNote = window.GTAuth?.on && !user ? `<div class="app-note"><span>Your designs are kept in this browser.</span>
      <button class="btn small primary" data-acct="up">Create a free account</button><button class="link" data-acct="in">Sign in</button></div>` : "";
    const designs = mine.length ? `<h2 class="app-h2">Your designs <span>${mine.length}</span><small>${user ? "in your account" : "in this browser"}</small></h2>
      <div class="plan-grid">${mine.map((p) => `<div class="plan-card mine">
        <a href="#/d/${esc(p.id)}" class="pc-open" aria-label="Open ${esc(p.name)}">${thumb(p)}</a><div class="pc-body"><a href="#/d/${esc(p.id)}"><b>${esc(p.name)}</b></a>
        <span class="faint tiny">${esc(KINDS[p.kind] || "Plan")} · ${p.rooms.length} rooms · ${fmtA(totalArea(p))} · edited ${esc(new Date(p.updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</span>
        <span class="pc-actions"><a class="btn small pc-openbtn" href="#/d/${esc(p.id)}">Open</a><button class="btn small" data-pact="dup" data-id="${esc(p.id)}">Duplicate</button>
        <button class="btn small" data-pact="del" data-id="${esc(p.id)}">Delete</button></span></div></div>`).join("")}</div>` : "";
    const off = !AI.ready;
    app.innerHTML = `${appBar()}
    <div class="app-home">
      <div class="app-head"><div>${user ? `<p class="app-hi">Hi, ${esc(user.name.split(" ")[0])}</p>` : ""}<h1>What shall we build?</h1></div>${guestNote}</div>
      <form class="app-ask" id="app-ask">
        <div class="app-ask-box">
          <textarea id="ask-text" rows="2" maxlength="1500" aria-label="Describe a building" ${off ? "disabled" : ""}
            placeholder="${off ? "The AI designer is off on this server. Start from a template below." : "Describe a building, e.g. a two-bedroom flat of about 70 m² with an open kitchen and a balcony"}"></textarea>
          <div class="app-ask-bar">
            <label class="btn small ${off ? "is-off" : ""}" title="A hand sketch, a photo of a drawing or an old plan (JPG, PNG, PDF)">📎 Upload a sketch
              <input type="file" id="ask-file" accept="image/jpeg,image/png,image/webp,.pdf" hidden ${off ? "disabled" : ""}></label>
            <span class="app-ask-file" id="ask-file-name"></span><span class="pe-spacer"></span>
            <button class="btn primary" type="submit" id="ask-go" ${off ? "disabled" : ""}>✨ Design it</button>
          </div>
        </div>
        ${off ? "" : `<div class="app-ask-ex"><span>Try</span>${EX_NEW.map(([label, text]) => `<button type="button" data-pact="ask-example" data-text="${esc(text)}" title="${esc(text)}">${esc(label)}</button>`).join("")}</div>`}
      </form>
      ${designs}
      <h2 class="app-h2">${mine.length ? "Or start a new one from a template" : "Or start from a template"}</h2>
      <div class="plan-grid">${Object.entries(TEMPLATES).map(([key, t]) => {
        const p = t.make();
        return `<button class="plan-card" data-pact="new" data-template="${key}">${key === "blank" ? BLANK_ART : thumb(p)}<div class="pc-body"><b>${esc(t.name)}</b>
          <span class="faint tiny">${p.rooms.length ? `${p.rooms.length} rooms · ${fmtA(totalArea(p))}` : "Draw it yourself"}</span></div></button>`;
      }).join("")}</div>
      <p class="small muted" style="margin:12px 0 0"><button class="link" data-pact="import">Open a plan file (.json)</button>
        <input type="file" id="plan-import" accept=".json,application/json" hidden></p>
    </div>`;
    $("#plan-import").onchange = (e) => importFile(e.target.files[0]);
    const form = $("#app-ask"), text = $("#ask-text"), file = $("#ask-file");
    const showFile = () => {
      const f = file.files[0];
      $("#ask-file-name").innerHTML = f ? `<span>📎 ${esc(f.name)}</span><button type="button" class="icon-btn" aria-label="Remove the sketch">×</button>` : "";
      $("#ask-file-name button")?.addEventListener("click", () => { file.value = ""; showFile(); });
      $("#ask-go").textContent = f ? "✨ Lay it out" : "✨ Design it";
    };
    file.onchange = () => { showFile(); text.focus(); };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!text.value.trim() && !file.files[0]) { text.focus(); text.classList.add("nudge"); setTimeout(() => text.classList.remove("nudge"), 600); return; }
      startAi(text.value.trim(), file.files[0] || null);
    };
    text.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
    window.GTAuth?.mount($("#acct"));
  }

  // A new design with the AI designer starting on a description, a sketch, or both. The studio is one page,
  // so a chosen file is handed straight to the editor.
  function startAi(text, file) {
    const plan = TEMPLATES.blank.make();
    plan.name = "Untitled design";
    savePlan(plan);
    Object.assign(E, { openAssist: true, prefill: text || "", pendingFile: file || null, autorun: !!(text || file) });
    location.hash = `#/d/${plan.id}`;
  }

  function newPlan(key) {
    const plan = (TEMPLATES[key] || TEMPLATES.blank).make();
    savePlan(plan);
    location.hash = `#/d/${plan.id}`;
  }

  function importFile(file) {
    if (!file) return;
    file.text().then((text) => {
      const plan = JSON.parse(text);
      if (!Array.isArray(plan.rooms) || !Array.isArray(plan.openings) || !Array.isArray(plan.items)) throw new Error("not a plan");
      plan.id = uid("p");
      plan.name = String(plan.name || "Imported plan").slice(0, 80);
      savePlan(plan);
      location.hash = `#/d/${plan.id}`;
    }).catch(() => alert("That file isn't a GroundTruth plan (.json)."));
  }

  document.addEventListener("click", (e) => {
    // the File and Export menus close after a choice, and on a click anywhere else
    for (const m of $$("details.pe-menu[open]")) if (!m.contains(e.target) || e.target.closest(".pe-menu-list button, .pe-menu-list a")) m.open = false;
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
    assist: { open: false, running: false, mode: "edit", text: "", feed: [], result: null, error: null }, flash: new Set(), openAssist: false,
    tab: "ai", layers: { hide: new Set(["dims"]), lock: new Set() }, layerOpen: new Set(), snap: true, clip: null, measure: null, chat: [], chatFile: null, three: null,
    touches: new Map() };
  const AI = { ready: true };
  AI.check = fetch("/api/health").then((r) => r.json()).then((h) => { AI.ready = h?.keys?.meta !== false; }).catch(() => {});
  const EDIT_ACTIONS = {};

  function renderEditor(app, id) {
    const plan = getPlan(id);
    if (!plan) {
      app.innerHTML = `${appBar()}<div class="app-home"><h1>Design not found</h1>
        <p class="muted">${signedIn() ? "It isn't in this account. It may belong to another account, or have been deleted."
          : "It may have been made in another browser, or in an account. Sign in to see the designs in your account."}</p>
        <a class="btn" href="#/">← All designs</a></div>`;
      window.GTAuth?.mount($("#acct"));
      return;
    }
    E.three?.pause();
    E.three = null;
    plan.notes = plan.notes || [];
    plan.site = plan.site || defaultSite();
    Object.assign(E, { plan, sel: null, tool: "select", undo: [], redo: [], drag: null, hover: null, ghost: null, guides: [], view: null, flash: new Set(),
      measure: null, touches: new Map(), chat: plan.chat || [], chatFile: null, tab: E.openAssist || !plan.rooms.length ? "ai" : E.tab || "ai",
      assist: { open: false, running: false, mode: "edit", text: "", feed: [], result: null, error: null } });
    E.openAssist = false;
    stopSim();
    E.mode = "design";
    E.sim = { result: null, stale: true, loading: false, error: null, t: 0, season: "winter", tracks: [], walking: false, sunTimer: 0, walkFrame: 0, hour: 10 };
    app.innerHTML = `
    <div class="pe studio" id="plan-editor">
      <div class="pe-top">
        <a class="app-mark" href="#/" title="All designs">✓</a>
        <details class="pe-menu left" id="pe-file"><summary class="btn small" title="Projects and files">☰ File</summary><div class="pe-menu-list">
          <button data-pact="file-new">New blank design</button><a href="#/">All designs and templates</a>
          <button data-pact="file-import">Open a plan file (.json)…</button><input type="file" id="studio-import" accept=".json,application/json" hidden>
          <button data-pact="file-dup">Duplicate this design</button><button data-pact="theme">${themeLabel()}</button></div></details>
        <input class="pe-name" id="pe-name" value="${esc(plan.name)}" aria-label="Design name" maxlength="80">
        <div class="pe-seg pe-mode" id="pe-mode">${VIEWS.map(([k, label]) => `<button data-pact="mode" data-mode="${k}">${label}</button>`).join("")}</div>
        <span class="pe-status small muted" id="pe-status" role="status"></span>
        <span class="pe-spacer"></span>
        <span class="pe-zoom"><button class="btn small" data-pact="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
          <button class="btn small pe-fit" id="pe-scale" data-pact="fit" title="Zoom to fit (0)">100%</button>
          <button class="btn small" data-pact="zoom-in" title="Zoom in" aria-label="Zoom in">+</button></span>
        <details class="pe-menu" id="pe-export"><summary class="btn small primary">Export ▾</summary><div class="pe-menu-list">
          <button data-pact="export-png">Drawing sheet (PNG)</button><button data-pact="export-svg">Drawing sheet (SVG)</button>
          <button data-pact="export-glb">3D model (.glb) for Blender, SketchUp, AR</button><button data-pact="export-shot">3D view as an image (PNG)</button>
          <button data-pact="export-json">Design file (JSON), to back up or move</button></div></details>
        <span class="acct-slot" id="acct"></span>
      </div>
      <div class="pe-body">
        <div class="pe-left"><div class="pe-tools" id="pe-tools"></div><div class="pe-layers" id="pe-layers"></div></div>
        <div class="pe-canvas" id="pe-canvas"><svg id="pc" xmlns="http://www.w3.org/2000/svg"></svg>
          <div class="view3d" id="view3d" hidden></div><div class="hud3d" id="hud3d" hidden></div><div class="pe-hint" id="pe-hint"></div></div>
        <aside class="pe-right">
          <div class="pe-tabs" id="pe-tabs"><button data-pact="stab" data-stab="ai">✨ AI designer</button><button data-pact="stab" data-stab="props">Properties</button></div>
          <div class="pe-chat" id="pe-chat">
            <div class="chat-log" id="chat-log" aria-live="polite"></div>
            <form class="chat-in" id="chat-form">
              <div class="chat-att" id="chat-att"></div>
              <textarea id="chat-text" rows="3" maxlength="1500" placeholder="Describe a building, or a change…"></textarea>
              <div class="chat-bar"><label class="btn small" title="Attach a sketch, a photo of a drawing or an old plan (JPG, PNG, PDF)">📎 Draft
                <input type="file" id="chat-file" accept="image/jpeg,image/png,image/webp,.pdf" hidden></label>
                <span class="pe-spacer"></span><button class="btn primary small" type="submit" id="chat-send" title="Enter to send · Shift+Enter for a new line">Send ↑</button></div>
            </form>
          </div>
          <div class="pe-side" id="pe-side"></div>
        </aside>
      </div>
    </div>`;
    $("#pe-name").oninput = (e) => { E.plan.name = e.target.value || "Untitled design"; changed(false); };
    $("#studio-import").onchange = (e) => importFile(e.target.files[0]);
    const svg = $("#pc");
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("pointerleave", () => { if (E.hover) { E.hover = null; render(); } });
    bindChat();
    window.GTAuth?.mount($("#acct"));
    requestAnimationFrame(() => {
      fitToScreen();
      render(true);
      paintChat();
      if (E.autorun) { // started from a description or a sketch on the designs page
        E.autorun = false;
        const text = E.prefill, file = E.pendingFile;
        Object.assign(E, { prefill: "", pendingFile: null });
        if (AI.ready) chatSend(text, file);
        else $("#chat-text").value = text || "";
      }
    });
  }

  function canvasSize() {
    const r = $("#pc")?.getBoundingClientRect();
    return r ? { W: r.width, H: r.height } : { W: 800, H: 600 };
  }
  function fitToScreen() {
    const { W, H } = canvasSize();
    E.view = fitView(E.plan, W, H, W < 500 ? 24 : 60);
    E.fitS = E.view.s; // the zoom readout is relative to this
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
    ["select", "Select and move", "V", icon(`<path d="M5 3l11 6.5-4.6 1.4L9 15.5z"/>`), "Select"],
    ["room", "Draw a room", "R", icon(`<rect x="3" y="4.5" width="14" height="11"/><path d="M3 9.5h5v6"/>`), "Room"],
    ["door", "Add a door", "D", icon(`<path d="M3 16h14"/><path d="M5 16V5"/><path d="M5 5a11 11 0 0111 11" stroke-dasharray="2 2"/>`), "Door"],
    ["window", "Add a window", "W", icon(`<rect x="3" y="7.5" width="14" height="5"/><path d="M3 10h14"/>`), "Window"],
    ["furniture", "Add furniture and fixtures", "F", icon(`<rect x="3" y="8" width="14" height="7" rx="1"/><path d="M5 8V5.5h10V8M3 15v1.5M17 15v1.5"/>`), "Furniture"],
    ["measure", "Measure a distance", "M", icon(`<path d="M2.5 13.5l11-11 4 4-11 11z"/><path d="M6 10l1.6 1.6M8.5 7.5l1.6 1.6M11 5l1.6 1.6"/>`), "Measure"],
    ["note", "Pin a note", "T", icon(`<path d="M4 3.5h12v9l-4 4H4z"/><path d="M12 16.5v-4h4"/>`), "Note"],
  ];
  const VIEWS = [["design", "Plan"], ["3d", "3D"], ["walk", "Walk"], ["simulate", "Simulate"]];
  const UNDO_I = icon(`<path d="M7 5L3.5 8.5 7 12"/><path d="M4 8.5h8a4 4 0 010 8H9"/>`), REDO_I = icon(`<path d="M13 5l3.5 3.5L13 12"/><path d="M16 8.5H8a4 4 0 000 8h3"/>`);
  const SNAP_I = icon(`<path d="M5 3v7a5 5 0 0010 0V3"/><path d="M5 6.5h3M12 6.5h3"/>`);
  const EYE_I = icon(`<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.3"/>`);
  const EYE_OFF_I = icon(`<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><path d="M3 3l14 14"/>`);
  const LOCK_I = icon(`<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 016 0V9"/>`);
  const UNLOCK_I = icon(`<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 015.6-1.5"/>`);
  // layer, label, the plan list it holds (lockable and expandable)
  const LAYERS = [["rooms", "Rooms", "rooms"], ["labels", "Room labels"], ["walls", "Walls"], ["openings", "Doors and windows", "openings"],
    ["items", "Furniture", "items"], ["notes", "Notes", "notes"], ["dims", "Dimensions"], ["grid", "Grid"]];
  const KIND_OF = { rooms: "room", openings: "opening", items: "item", notes: "note" };
  const ITEM_GROUPS = [["Living", ["sofa", "armchair", "dining_table", "plant"]], ["Bedroom", ["bed_double", "bed_single", "wardrobe", "desk"]],
    ["Kitchen", ["counter", "stove", "kitchen_sink", "fridge"]], ["Bathroom", ["toilet", "basin", "shower", "bathtub"]],
    ["Other", ["meeting_table", "stairs", "car"]]];
  const HINTS = {
    select: "Click to edit · drag to move · drag edges to resize",
    room: "Drag to draw a room · Alt: no snapping",
    door: "Click a wall to add a door",
    window: "Click a wall to add a window",
    furniture: "Pick a piece, then click to place it",
    measure: "Drag to measure",
    note: "Click to pin a note",
  };
  const COARSE = window.matchMedia?.("(pointer: coarse)").matches;
  if (COARSE) { // touch screens: tap, and two fingers to zoom
    for (const k in HINTS) HINTS[k] = HINTS[k].replace(/^Click/, "Tap").replace(" · Alt: no snapping", "");
    HINTS.select = "Tap to edit · drag to move · pinch to zoom";
  }
  const GRID = 0.1, MIN = 0.5;
  const g = (v, step = GRID) => r2(Math.round(v / step) * step);
  const LIST = { room: "rooms", opening: "openings", item: "items", note: "notes" };
  const find = (kind, id) => E.plan[LIST[kind]]?.find((x) => x.id === id);
  const selected = () => (E.sel ? find(E.sel.kind, E.sel.id) : null);
  const snapshot = () => JSON.stringify({ rooms: E.plan.rooms, openings: E.plan.openings, items: E.plan.items, notes: E.plan.notes || [] });
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
  function select(kind, id) { E.sel = kind ? { kind, id } : null; if (kind) E.tab = "props"; render(true); }
  // A point snapped to the nearest room corner within 10 px, else to a 5 cm grid (or free with Alt / snapping off).
  function snapPoint(p, free) {
    if (free) return { x: r2(p.x), y: r2(p.y) };
    const tol = 10 / E.view.s;
    for (const r of E.plan.rooms) for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
      if (Math.hypot(x - p.x, y - p.y) <= tol) return { x, y };
    }
    return { x: g(p.x, 0.05), y: g(p.y, 0.05) };
  }

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

  // Touch: one finger edits as a mouse does; a second finger turns it into a pinch that zooms and pans,
  // and puts back whatever the first finger had started to move.
  const pinchOf = () => {
    const [a, b] = [...E.touches.values()];
    return { d: Math.hypot(a.px - b.px, a.py - b.py) || 1, mx: (a.px + b.px) / 2, my: (a.py + b.py) / 2 };
  };
  function startPinch() {
    const d = E.drag;
    if (d?.before && d.mode !== "draw") Object.assign(E.plan, JSON.parse(d.before));
    Object.assign(E, { ghost: null, guides: [], measure: null, drag: { mode: "pinch", start: pinchOf(), view: { ...E.view } } });
    render(true);
  }
  function movePinch() {
    const { start: a, view: v } = E.drag, b = pinchOf(), s = clamp(v.s * (b.d / a.d), 8, 400), k = s / v.s;
    E.view = { s, tx: b.mx - (a.mx - v.tx) * k, ty: b.my - (a.my - v.ty) * k };
    render();
  }

  function onPointerDown(ev) {
    if (ev.pointerType === "touch") {
      const q = toWorld(ev);
      E.touches.set(ev.pointerId, { px: q.px, py: q.py });
      if (E.touches.size === 2) { try { $("#pc").setPointerCapture(ev.pointerId); } catch {} startPinch(); return; }
      if (E.touches.size > 2) return;
    }
    if (ev.button !== 0 && ev.button !== 1) return;
    if (E.assist.running || E.mode !== "design") { E.drag = { mode: "pan", start: toWorld(ev), view: { ...E.view } }; return; }
    try { $("#pc").setPointerCapture(ev.pointerId); } catch { /* synthetic events have no capturable pointer */ }
    const p = toWorld(ev);
    if (ev.button === 1 || E.space) { E.drag = { mode: "pan", start: p, view: { ...E.view } }; return; }
    const free = ev.altKey || !E.snap;
    if (E.tool === "measure") {
      const a = snapPoint(p, free);
      E.measure = { a, b: a };
      E.drag = { mode: "measure" };
      return;
    }
    if (E.tool === "note" && !ev.target.closest("[data-kind=note]")) {
      const before = snapshot(), n = { id: uid("n"), x: g(p.x, 0.05), y: g(p.y, 0.05), text: "Note" };
      E.plan.notes.push(n);
      Object.assign(E, { sel: { kind: "note", id: n.id }, tab: "props", tool: "select" });
      commit(before);
      setTimeout(() => { const t = $("#pe-side [data-prop=text]"); t?.focus(); t?.select(); }, 0);
      return;
    }
    if (E.tool === "room") {
      const x = snapEdge(p.x, roomTargets("x"), free), y = snapEdge(p.y, roomTargets("y"), free);
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
    let target = ev.target.closest("[data-handle],[data-kind]");
    if (target?.dataset.kind && E.layers.lock.has(LIST[target.dataset.kind])) target = null; // a locked layer can't be picked
    if (target?.dataset.handle) {
      const r = find("room", target.dataset.id);
      const ops = Object.fromEntries(E.plan.openings.filter((o) => o.room === r.id).map((o) => [o.id, o.at]));
      E.drag = { mode: "resize", handle: target.dataset.handle, id: r.id, start: p, orig: { ...r }, ops, held: itemsIn(E.plan, r), before: snapshot() };
      return;
    }
    if (target?.dataset.kind) {
      const { kind, id } = target.dataset;
      E.sel = { kind, id };
      E.tab = "props";
      E.drag = { mode: "move", kind, id, start: p, orig: { ...find(kind, id) }, held: kind === "room" ? itemsIn(E.plan, find(kind, id)) : [], before: snapshot() };
      render(true);
      return;
    }
    if (E.sel) { E.sel = null; render(true); }
    E.drag = { mode: "pan", start: p, view: { ...E.view } };
  }

  function onPointerMove(ev) {
    if (ev.pointerType === "touch" && E.touches.has(ev.pointerId)) {
      const q = toWorld(ev);
      E.touches.set(ev.pointerId, { px: q.px, py: q.py });
      if (E.drag?.mode === "pinch") { if (E.touches.size === 2) movePinch(); return; }
    }
    const d = E.drag;
    if (!d) {
      if (E.tool === "door" || E.tool === "window") { E.hover = wallAt(toWorld(ev), OPENING_TYPES[E.tool][1]); render(); }
      if (E.tool === "furniture" && E.placing) { const q = toWorld(ev); E.hover = { item: E.placing, cx: g(q.x, 0.05), cy: g(q.y, 0.05) }; render(); }
      return;
    }
    const p = toWorld(ev), free = ev.altKey || !E.snap;
    E.guides = [];
    if (d.mode === "measure") { E.measure.b = snapPoint(p, free); render(); return; }
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
      carryItems(d.held, o, r);
      if (x.guide !== undefined) E.guides.push({ o: "v", c: x.guide });
      if (y.guide !== undefined) E.guides.push({ o: "h", c: y.guide });
    } else if (d.mode === "move" && d.kind === "opening") {
      const op = find("opening", d.id), r = roomOf(E.plan, op.room), horiz = op.side === "n" || op.side === "s", delta = horiz ? dx : dy;
      op.at = r2(clamp(d.orig.at + (free ? delta : g(delta, 0.05)), op.width / 2, sideLength(r, op.side) - op.width / 2));
    } else if (d.mode === "move" && d.kind === "note") {
      const n = find("note", d.id);
      n.x = r2(d.orig.x + (free ? dx : g(dx, 0.05)));
      n.y = r2(d.orig.y + (free ? dy : g(dy, 0.05)));
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
      carryItems(d.held, o, r);
      // keep doors and windows where they were in the world when the near edge moves
      for (const op of E.plan.openings) if (op.room === r.id && op.id in d.ops) {
        op.at = r2(d.ops[op.id] + (op.side === "n" || op.side === "s" ? o.x - r.x : o.y - r.y));
      }
    }
    render();
  }

  function onPointerUp(ev) {
    if (ev?.pointerType === "touch") E.touches.delete(ev.pointerId);
    if (E.drag?.mode === "pinch") { if (!E.touches.size) E.drag = null; return; } // the last finger up ends it, without a tap
    const d = E.drag;
    E.drag = null;
    E.guides = [];
    if (!d || d.mode === "pan" || d.mode === "measure") { if (d?.mode === "measure") render(); return; }
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
    if (s.kind === "note") { E.clip = { kind: "note", data: { ...src } }; pasteClip(); return; }
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

  function copySel() {
    const s = selected();
    if (!s) return;
    E.clip = { kind: E.sel.kind, data: JSON.parse(JSON.stringify(s)), ops: E.sel.kind === "room" ? E.plan.openings.filter((o) => o.room === s.id).map((o) => ({ ...o })) : [] };
  }
  function pasteClip() {
    const c = E.clip, before = snapshot(), d = JSON.parse(JSON.stringify(c.data));
    d.id = uid(c.kind[0]);
    if (c.kind === "room") {
      Object.assign(d, { name: uniqueName(d.name.replace(/ \d+$/, "")), x: r2(d.x + 0.5), y: r2(d.y + 0.5) });
      for (const op of c.ops) E.plan.openings.push({ ...op, id: uid("o"), room: d.id });
    } else if (c.kind === "note") Object.assign(d, { x: r2(d.x + 0.4), y: r2(d.y + 0.4) });
    else if (c.kind === "item") Object.assign(d, { cx: r2(d.cx + 0.3), cy: r2(d.cy + 0.3) });
    else return;
    E.plan[LIST[c.kind]].push(d);
    E.sel = { kind: c.kind, id: d.id };
    commit(before);
  }

  function nudge(dx, dy) {
    const s = selected();
    if (!s || E.sel.kind === "opening") return;
    const before = snapshot();
    const held = E.sel.kind === "room" ? itemsIn(E.plan, s) : [], o = { ...s };
    if (E.sel.kind === "room" || E.sel.kind === "note") { s.x = r2(s.x + dx); s.y = r2(s.y + dy); } else { s.cx = r2(s.cx + dx); s.cy = r2(s.cy + dy); }
    carryItems(held, o, s);
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
    if ((E.assist.running || E.mode !== "design") && !typing) return;
    const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    if (mod && (key === "z" || key === "y")) {
      if (typing) return;
      e.preventDefault();
      key === "y" || e.shiftKey ? redo() : undo();
      return;
    }
    if (typing) { if (e.key === "Escape" || e.key === "Enter") document.activeElement.blur(); return; }
    if (mod && key === "d") { e.preventDefault(); duplicateSel(); return; }
    if (mod && key === "c" && E.sel) { e.preventDefault(); copySel(); return; }
    if (mod && key === "v" && E.clip) { e.preventDefault(); pasteClip(); return; }
    if (mod || e.altKey) return;
    const step = e.shiftKey ? 0.5 : GRID;
    const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (arrows[key] && E.sel) { e.preventDefault(); nudge(...arrows[key]); return; }
    if (key === " ") { E.space = true; e.preventDefault(); return; }
    if (key === "r" && e.shiftKey) { EDIT_ACTIONS.rotate(); return; }
    if (key === "escape") {
      if (E.measure) { E.measure = null; render(); }
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
    if (E.measure && (E.measure.a.x !== E.measure.b.x || E.measure.a.y !== E.measure.b.y)) {
      const { a, b } = E.measure, len = Math.hypot(b.x - a.x, b.y - a.y);
      out.push(`<g pointer-events="none" stroke="${ACCENT}" stroke-width="2"><line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke-dasharray="6 4"/>
        <circle cx="${X(a.x)}" cy="${Y(a.y)}" r="4" fill="#fff"/><circle cx="${X(b.x)}" cy="${Y(b.y)}" r="4" fill="#fff"/></g>`);
      out.push(tag((X(a.x) + X(b.x)) / 2, (Y(a.y) + Y(b.y)) / 2 - 12, `${len.toFixed(2)} m`));
    }
    const s = selected();
    if (s && E.sel.kind === "note") {
      out.push(`<circle cx="${X(s.x)}" cy="${Y(s.y)}" r="10" fill="none" stroke="${ACCENT}" stroke-width="2" pointer-events="none"/>`);
    }
    if (s && E.sel.kind === "room") {
      const x = X(s.x), y = Y(s.y), w = L(s.w), h = L(s.h);
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${ACCENT}" stroke-width="2" pointer-events="none"/>`);
      out.push(dimH(x, x + w, y - 22, fmtM(s.w)), dimV(y, y + h, x - 22, fmtM(s.h)));
      const hs = 9, pts = { nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2] };
      for (const [k, [hx, hy]] of Object.entries(E.layers.lock.has("rooms") ? {} : pts)) {
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
    if (!el) return;
    const C = Cloud;
    const bad = !E.savedOk || C.state === "error";
    // [the word that always shows, the rest, shown on wide screens and in the tooltip]
    const [word, rest] = !E.savedOk ? ["Not saved", ": this browser blocks storage. Export the plan to keep it."]
      : !signedIn() ? ["Saved", window.GTAuth?.on ? " in this browser · sign in to keep it" : " in this browser"]
      : C.state === "saving" ? ["Saving…", ""] : C.state === "error" ? ["Saved here only", `: ${C.msg || "couldn't reach your account"}`] : ["Saved", " to your account"];
    el.classList.toggle("bad", bad);
    el.classList.toggle("busy", C.state === "saving" && !bad);
    el.title = word + rest;
    const html = `<i aria-hidden="true"></i><span>${esc(word)}</span><span class="more">${esc(rest)}</span>`;
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  }

  function render(sideToo = false) {
    const svg = $("#pc");
    if (!svg || !E.plan) return;
    const in3d = E.mode === "3d" || E.mode === "walk";
    svg.style.display = in3d ? "none" : "";
    $("#view3d").hidden = !in3d;
    $("#hud3d").hidden = !in3d;
    $(".pe-zoom").style.visibility = in3d ? "hidden" : "";
    if (in3d) {
      if (E.three) { // rebuild the 3D model whenever the plan changed (including while the AI is working)
        const sig = snapshot() + (E.plan.wallHeight || "");
        if (sig !== E.threeSig) { E.threeSig = sig; E.three.build(E.plan); applySun3d(); }
      }
      $("#pe-hint").textContent = "";
      $$("#pe-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === E.mode));
      paintTools(); paintLayers(); paintTabs(); paintSide(sideToo); paintStatus();
      return;
    }
    const { W, H } = canvasSize();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", `tool-${E.tool}${E.drag?.mode === "pan" ? " panning" : ""}`);
    const sim = E.mode === "simulate" && !E.assist.running;
    svg.innerHTML = `<rect width="${W}" height="${H}" fill="${PAPER}"/>` + drawPlan(E.plan, E.view, { width: W, height: H, grid: true, hide: E.layers.hide, dims: true,
      overlay: sim ? simOverlay : overlay })
      + scaleBar(W, H) + (sim ? simHud(W) : "");
    if (sim) placeWalkers();
    $("#pe-scale").textContent = `${Math.round((E.view.s / (E.fitS || E.view.s)) * 100)}%`;
    $("#pe-hint").textContent = E.drag ? "" : E.assist.running ? "✨ Designing…"
      : E.mode === "simulate" ? "Back to Plan to edit" : HINTS[E.tool] || "";
    $$("#pe-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === E.mode));
    paintTools();
    paintLayers();
    paintTabs();
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
    const off = E.mode !== "design" || E.assist.running ? "disabled" : "";
    const html = `<div class="pane-head">Tools</div><div class="tl-grid">${TOOLS.map(([id, label, key, ic, short]) => `<button class="pe-tool ${E.tool === id && !off ? "on" : ""}" ${off}
      data-pact="tool" data-tool="${id}" title="${label} (${key})" aria-pressed="${E.tool === id}">${ic}<span>${short}</span><kbd>${key}</kbd></button>`).join("")}</div>
      <div class="tl-row"><button class="pe-tool sm" data-pact="undo" title="Undo (⌘Z)" ${E.undo.length && !off ? "" : "disabled"}>${UNDO_I}<span>Undo</span></button>
      <button class="pe-tool sm" data-pact="redo" title="Redo (⇧⌘Z)" ${E.redo.length && !off ? "" : "disabled"}>${REDO_I}<span>Redo</span></button>
      <button class="pe-tool sm ${E.snap ? "on" : ""}" data-pact="snap" title="Snap to the grid and to walls (hold Alt to bypass)" ${off}>${SNAP_I}<span>Snap</span></button></div>`;
    if (box && box._html !== html) { box.innerHTML = html; box._html = html; }
  }

  function paintLayers() {
    const box = $("#pe-layers");
    if (!box) return;
    const L = E.layers, p = E.plan, mk = marks(p);
    const label = (list, x) => (list === "rooms" ? x.name : list === "items" ? ITEM_TYPES[x.type]?.[0] || x.type
      : list === "openings" ? `${mk[x.id]} · ${OPENING_TYPES[x.type][0]}` : x.text);
    const rows = LAYERS.map(([k, name, list]) => {
      const items = list ? p[list] || [] : null, open = list && E.layerOpen.has(k) && items.length;
      return `<div class="ly ${L.hide.has(k) ? "off" : ""}">
        <button class="ly-i" data-pact="ly-eye" data-l="${k}" title="${L.hide.has(k) ? "Show" : "Hide"} ${name}">${L.hide.has(k) ? EYE_OFF_I : EYE_I}</button>
        ${list ? `<button class="ly-i ${L.lock.has(k) ? "on" : ""}" data-pact="ly-lock" data-l="${k}" title="${L.lock.has(k) ? "Unlock" : "Lock"} ${name}">${L.lock.has(k) ? LOCK_I : UNLOCK_I}</button>` : `<span class="ly-i"></span>`}
        <button class="ly-name" data-pact="ly-open" data-l="${k}" ${list && items.length ? "" : "disabled"}>${list && items.length ? (open ? "▾" : "▸") : "·"} ${name}${items ? ` <span>${items.length}</span>` : ""}</button></div>
        ${open ? `<div class="ly-items">${items.map((x) => `<button class="${E.sel?.id === x.id ? "on" : ""}" data-pact="ly-sel" data-k="${KIND_OF[list]}" data-id="${x.id}">${esc(label(list, x))}</button>`).join("")}</div>` : ""}`;
    }).join("");
    const html = `<div class="pane-head">Layers</div>${rows}`;
    if (box._html !== html) { box.innerHTML = html; box._html = html; }
  }

  function paintTabs() {
    $$("#pe-tabs button").forEach((b) => {
      b.classList.toggle("on", b.dataset.stab === E.tab);
      if (b.dataset.stab === "props") b.textContent = E.mode === "simulate" ? "Simulation" : "Properties";
    });
    const chat = $("#pe-chat"), side = $("#pe-side");
    if (chat) chat.hidden = E.tab !== "ai";
    if (side) side.hidden = E.tab !== "props";
  }

  // The side panel shows the selection's properties, or the plan summary. While a field in it has focus
  // it is not rebuilt (that would steal the focus); only its live numbers are updated.
  function paintSide(force) {
    const side = $("#pe-side");
    if (!side) return;
    const key = E.mode === "simulate" ? `sim:${E.sim.loading}:${!!E.sim.result}` : E.sel ? `${E.sel.kind}:${E.sel.id}` : `plan:${E.tool === "furniture"}`;
    if (!force && key === side._key && side.contains(document.activeElement)) { paintLive(); return; }
    side._key = key;
    const s = selected();
    side.innerHTML = E.mode === "simulate" ? simPanel() : !s ? (E.tool === "furniture" ? palettePanel() : summaryPanel())
      : E.sel.kind === "room" ? roomPanel(s) : E.sel.kind === "opening" ? openingPanel(s) : E.sel.kind === "note" ? notePanel(s) : itemPanel(s);
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
      <label class="pe-field wide"><span>Floor finish</span><select data-prop="floor">${Object.entries(FLOORS).map(([k, [l]]) => `<option value="${k}" ${(r.floor || defaultFloor(r.type)) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="pe-row">${num("w", "Width (m)", r.w, `min="${MIN}"`)}${num("h", "Depth (m)", r.h, `min="${MIN}"`)}</div>
      <div class="pe-row">${num("x", "From left (m)", r.x)}${num("y", "From top (m)", r.y)}</div>
      <p class="pe-area">Area <b data-live="area"></b></p>
      <div class="pe-actions"><button class="btn small" data-pact="dup-sel" title="⌘D">Duplicate</button><button class="btn small danger" data-pact="del-sel" title="Delete key">Delete room</button></div>`;
  }

  function openingPanel(op) {
    const r = roomOf(E.plan, op.room), label = OPENING_TYPES[op.type][0];
    return `<div class="pe-head"><h3>${label}</h3><button class="link small" data-pact="deselect">Plan summary</button></div>
      <p class="small muted" style="margin:0 0 10px">${esc(r?.name)} · ${{ n: "top", s: "bottom", w: "left", e: "right" }[op.side]} wall · ${fmtM(sideLength(r, op.side))}</p>
      <label class="pe-field wide"><span>Type</span><select data-prop="type">${Object.entries(OPENING_TYPES).map(([k, [l]]) => `<option value="${k}" ${op.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="pe-row">${num("width", "Width (m)", op.width, 'min="0.4"')}${num("at", "Centre from wall start (m)", op.at)}</div>
      ${op.type === "door" ? `<div class="pe-actions"><button class="btn small" data-pact="flip-hinge">Flip hinge side</button>
        <button class="btn small" data-pact="flip-swing">Open ${op.swing === "out" ? "inwards" : "outwards"}</button></div>` : ""}
      <div class="pe-actions"><button class="btn small danger" data-pact="del-sel">Delete ${label.toLowerCase()}</button></div>`;
  }

  function palettePanel() {
    const preview = (type) => {
      const [, w, h] = ITEM_TYPES[type], s = Math.min(46 / w, 34 / h);
      return `<svg viewBox="0 0 56 42" width="56" height="42">${drawItem({ type, cx: 28 / s, cy: 21 / s, w, h, rot: 0 }, (x) => x * s, (y) => y * s, (d) => d * s)}</svg>`;
    };
    return `<div class="pe-head"><h3>Furniture and fixtures</h3><button class="link small" data-pact="tool" data-tool="select">Done</button></div>
      ${ITEM_GROUPS.map(([group, types]) => `<h4>${group}</h4><div class="pe-palette">${types.map((t) => `<button class="${E.placing === t ? "on" : ""}" data-pact="pick-item" data-type="${t}"
        title="${ITEM_TYPES[t][0]}">${preview(t)}<span>${ITEM_TYPES[t][0]}</span></button>`).join("")}</div>`).join("")}`;
  }

  function notePanel(n) {
    return `<div class="pe-head"><h3>Note</h3><button class="link small" data-pact="deselect">Plan summary</button></div>
      <label class="pe-field wide"><span>Text</span><textarea data-prop="text" rows="3" maxlength="200">${esc(n.text)}</textarea></label>
      <div class="pe-actions"><button class="btn small" data-pact="dup-sel">Duplicate</button><button class="btn small danger" data-pact="del-sel">Delete note</button></div>`;
  }

  const roomAt = (x, y) => E.plan.rooms.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  function itemPanel(it) {
    const room = roomAt(it.cx, it.cy);
    return `<div class="pe-head"><h3>${ITEM_TYPES[it.type]?.[0] || "Item"}</h3><button class="link small" data-pact="deselect">Plan summary</button></div>
      <p class="small muted" style="margin:0 0 10px">${room ? `In ${esc(room.name)}` : "Outside the rooms"}</p>
      <div class="pe-row">${num("w", "Width (m)", it.w, 'min="0.2"')}${num("h", "Depth (m)", it.h, 'min="0.2"')}</div>
      <div class="pe-actions"><button class="btn small" data-pact="rotate" title="Shift+R">Rotate 90°</button><button class="btn small" data-pact="dup-sel" title="⌘D">Duplicate</button>
        <button class="btn small danger" data-pact="del-sel">Delete</button></div>`;
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
      ${issues.length ? `<div class="pe-issues"><b>Check the plan</b><ul>${issues.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      <h4>Rooms</h4>${p.rooms.length ? `<table class="pe-table">${p.rooms.map((r) => `<tr data-pact="select-room" data-id="${r.id}" data-select><td><span class="swatch" style="background:${(ROOM_TYPES[r.type] || ROOM_TYPES.other)[1]}"></span>${esc(r.name)}</td>
        <td class="num">${fmtA(area(r))}</td></tr>`).join("")}</table>` : `<p class="small muted">No rooms yet.</p>`}
      ${p.openings.length ? `<h4>Doors and windows</h4><table class="pe-table">${p.openings.map((op) => `<tr data-pact="select-opening" data-id="${op.id}" data-select>
        <td><b>${marks(p)[op.id]}</b></td><td>${OPENING_TYPES[op.type][0]}</td><td>${esc(roomOf(p, op.room)?.name || "")}</td><td class="num">${fmtM(op.width)}</td></tr>`).join("")}</table>` : ""}
      <h4>Building</h4>
      <label class="pe-field wide"><span>Building type</span><select data-meta="kind">${Object.entries(KINDS).map(([k, v]) =>
        `<option value="${k}" ${(p.kind || "house") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <div class="pe-row"><label class="pe-field"><span>Wall height (m)</span><input type="number" step="0.1" min="2.2" max="6" data-meta="wallHeight" value="${p.wallHeight || 2.7}"></label>
        <label class="pe-field"><span>Notes</span><input disabled value="${(p.notes || []).length} pinned"></label></div>
      <h4>Drawing sheet</h4>
      <div class="pe-row"><label class="pe-field"><span>Sheet number</span><input data-meta="sheet" value="${esc(p.sheet || "A-101")}" maxlength="12"></label>
        <label class="pe-field"><span>Revision</span><input data-meta="revision" value="${esc(p.revision || "A")}" maxlength="4"></label></div>
      <label class="pe-field wide"><span>Drawn by</span><input data-meta="author" value="${esc(p.author || "")}" maxlength="60" placeholder="Your name or practice"></label>`;
  }

  function bindFields(side) {
    if (E.mode === "simulate") bindSim(side);
    const text = $("#assist-text", side);
    if (text) text.oninput = () => { E.assist.text = text.value; };
    const feed = $("#assist-feed", side);
    if (feed && E.assist.running) side.scrollTop = side.scrollHeight;
    for (const el of $$("[data-meta]", side)) {
      el.oninput = () => {
        E.plan[el.dataset.meta] = el.type === "number" ? Math.min(6, Math.max(2.2, parseFloat(el.value) || 2.7)) : el.value.trim();
        changed(false);
      };
    }
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
      const held = E.sel.kind === "room" ? itemsIn(E.plan, s) : [], o = { ...s };
      s[prop] = r2(v);
      carryItems(held, o, s);
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
    const was = E.mode;
    E.mode = mode;
    E.sel = null;
    E.tool = "select";
    E.measure = null;
    if (was === "simulate") stopSim();
    if (mode === "3d" || mode === "walk") { paintHud(); render(true); open3d(mode); return; }
    E.three?.pause();
    if (mode === "simulate") { E.tab = "props"; if (E.sim.stale || !E.sim.result) runSim(); else render(true); return; }
    render(true);
    requestAnimationFrame(() => { fitToScreen(); render(); });
  }

  /* ---------------- 3D and walk ---------------- */
  const DAYS = { winter: 355, equinox: 80, summer: 172 };
  const GEOM = { walls, openingGeom, shared, footprint, bounds, FLOORS, defaultFloor };
  async function open3d(mode) {
    const box = $("#view3d");
    try {
      if (!E.three) {
        box.innerHTML = `<p class="v3-msg"><span class="spin"></span> Loading the 3D view…</p>`;
        const mod = await import("/studio3d.js");
        if (!$("#plan-editor") || box !== $("#view3d")) return;
        box.innerHTML = "";
        E.sunPosition = mod.sunPosition;
        E.three = mod.create(box, GEOM);
        E.three.onMove((x, z, yaw) => paintMinimap(x, z, yaw));
        E.threeSig = "";
      }
      E.three.resume();
      E.threeSig = snapshot() + (E.plan.wallHeight || "");
      E.three.build(E.plan);
      applySun3d();
      E.three.setMode(mode === "walk" ? "walk" : "orbit", E.plan);
      paintHud();
    } catch (err) {
      box.innerHTML = `<p class="v3-msg">The 3D view couldn't start: ${esc(err.message || err)}. It needs WebGL and loads three.js from a CDN.</p>`;
    }
  }
  function applySun3d() {
    if (!E.three || !E.sunPosition) return;
    const site = E.plan.site, pos = E.sunPosition(site.latitude, DAYS[E.sim.season] || 355, E.sim.hour ?? 10);
    E.three.setSun(pos.azimuth, pos.elevation, site.north);
  }
  function paintHud() {
    const hud = $("#hud3d");
    if (!hud) return;
    const site = E.plan.site, hour = E.sim.hour ?? 10;
    const sunRow = `<div class="hud-row"><span>☀</span><input type="range" min="5" max="20" step="0.25" value="${hour}" data-h3="hour" aria-label="Time of day">
      <b class="mono" id="hud-hour">${hhmm(hour)}</b><select data-h3="season">${Object.entries(SEASONS).map(([k, v]) => `<option value="${k}" ${E.sim.season === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="tiny muted">${esc(site.city)}</span></div>`;
    hud.innerHTML = E.mode === "walk" ? `
      <div class="hud-card">${sunRow}<div class="keys"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span><span><kbd>⇧</kbd> run</span><span><kbd>Esc</kbd> mouse</span></div>
        <div class="hud-row"><button class="btn small primary" data-pact="walk-lock">Look around</button><button class="btn small" data-pact="mode" data-mode="3d">Back to 3D</button></div></div>
      <div class="hud-pad">${[["fwd", "▲"], ["left", "◀"], ["back", "▼"], ["right", "▶"]].map(([k, t]) => `<button data-hold="${k}" aria-label="${k}">${t}</button>`).join("")}</div>
      <div class="hud-map" id="hud-map"></div>`
      : `<div class="hud-card">${sunRow}<div class="keys"><span><kbd>drag</kbd> orbit</span><span><kbd>scroll</kbd> zoom</span><span><kbd>right-drag</kbd> pan</span></div>
        <div class="hud-row"><button class="btn small primary" data-pact="mode" data-mode="walk">🚶 Walk inside</button></div></div>`;
    for (const el of $$("[data-h3]", hud)) {
      el.oninput = () => {
        if (el.dataset.h3 === "hour") { E.sim.hour = Number(el.value); $("#hud-hour").textContent = hhmm(E.sim.hour); }
        else E.sim.season = el.value;
        applySun3d();
      };
    }
    for (const el of $$("[data-hold]", hud)) {
      const on = (v) => (e) => { e.preventDefault(); E.three?.hold(el.dataset.hold, v); };
      el.onpointerdown = on(true);
      el.onpointerup = el.onpointerleave = el.onpointercancel = on(false);
    }
    if (E.mode === "walk") paintMinimap();
  }
  // A small plan in the corner of Walk, with where you are and which way you face.
  function paintMinimap(x, z, yaw) {
    const box = $("#hud-map");
    if (!box) return;
    const W = 180, H = 140, view = fitView(E.plan, W, H, 8);
    if (box._planSig !== snapshot()) {
      box._planSig = snapshot();
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/>${drawPlan(E.plan, view, { labels: false, hide: new Set(["items", "notes"]) })}<g id="hud-me"></g></svg>`;
    }
    if (x === undefined) return;
    const px = r2(view.tx + x * view.s), py = r2(view.ty + z * view.s), dx = -Math.sin(yaw) * 12, dy = -Math.cos(yaw) * 12;
    $("#hud-me", box).innerHTML = `<line x1="${px}" y1="${py}" x2="${r2(px + dx)}" y2="${r2(py + dy)}" stroke="${ACCENT}" stroke-width="2.5"/><circle cx="${px}" cy="${py}" r="4.5" fill="${ACCENT}" stroke="#fff" stroke-width="1.5"/>`;
  }
  async function ensure3d() {
    if (!E.three) await open3d(E.mode === "walk" ? "walk" : "3d");
    if (!E.three) throw new Error("the 3D view isn't available");
    if (E.mode !== "3d" && E.mode !== "walk") { E.threeSig = snapshot() + (E.plan.wallHeight || ""); E.three.build(E.plan); applySun3d(); }
    return E.three;
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
      <p class="tiny muted" style="margin:6px 0 12px">Rules of thumb, not a code check ·
        <a href="https://github.com/compiler-aditya/groundtruth/blob/main/docs/simulation.md" target="_blank" rel="noopener">How it's scored</a>${S.stale ? " · <b>The plan changed</b>: <button class='link small' data-pact='sim-rerun'>run again</button>" : ""}</p>
      ${settings}
      <h4>☀ Sun on ${SEASONS[S.season]} in ${esc(site.city)}</h4>
      <div class="sim-time"><button class="btn small" data-pact="sim-sun-play" title="Play the day">${S.sunTimer ? "❚❚" : "▶"}</button>
        <input type="range" min="0" max="${samples.length - 1}" value="${S.t}" data-sim="t" aria-label="Time of day">
        <span class="mono small">${sample ? hhmm(sample.hour) : ""}</span></div>
      <p class="tiny muted" style="margin:2px 0 8px">${r.sun.daylight_hours} h of daylight</p>
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
    if (A.running) return `<h4>✨ Improving with AI</h4><p class="small muted"><span class="spin"></span> Changing the plan, re-simulating…</p>
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
      <p class="tiny muted" style="margin:0 0 8px">Only changes that score higher are kept.</p>${compare}
      <textarea id="sim-goal" rows="2" maxlength="800" placeholder="e.g. ${esc(SIM_GOALS[0])}">${esc(S.goal || "")}</textarea>
      <div class="pe-chips">${SIM_GOALS.map((t) => `<button data-pact="sim-goal" data-text="${esc(t)}">${esc(t)}</button>`).join("")}</div>
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

  /* ---------------- AI designer chat ---------------- */
  // [the chip's label, the message it puts in the box]
  const EX_NEW = [
    ["3-bed family house · 110 m²", "A three-bedroom family house of about 110 m² with an open kitchen and living area, two bathrooms and a hallway"],
    ["1-bed flat with a balcony", "A one-bedroom apartment of about 50 m² with a balcony"],
    ["Café · 80 m²", "A café of about 80 m² with seating, a counter, a kitchen, a store and two WCs"],
    ["Dental clinic", "A small dental clinic with a reception, a waiting room, two treatment rooms, a staff room, a WC and a store"]];
  const EX_EDIT = [
    ["Add a home office", "Add a home office of about 9 m² next to the living room"],
    ["Bigger, open kitchen", "Make the kitchen bigger and open it to the living room"],
    ["En-suite for the main bedroom", "Give the main bedroom its own bathroom"],
    ["A window in every bedroom", "Add a window to every bedroom"],
    ["How big is the living room?", "How big is the living room?"]];
  const chip = ([label, text]) => `<button type="button" data-pact="chat-example" data-text="${esc(text)}" title="${esc(text)}">${esc(label)}</button>`;

  const feedHtml = (A) => A.feed.map((f) => f.kind === "note" ? `<div class="msg">${esc(f.text)}</div>`
    : f.kind === "turn" ? `<div class="turn">${esc(f.text)}</div>`
    : `<div class="ev ${f.kind}"><span>${f.kind === "ok" ? "✓" : "✗"}</span><span>${esc(f.text)}</span></div>`).join("");

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
            if (mode === "new" && KINDS[ev.kind]) { E.plan.kind = ev.kind; }
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

  function chatHello() {
    const empty = !E.plan.rooms.length, ex = empty ? EX_NEW : EX_EDIT;
    return `<div class="msg-a hello"><div class="av">W</div><div class="body">
      <b>${empty ? "What shall we build?" : "What should change?"}</b>
      ${empty ? `<p class="small muted">Or 📎 attach a sketch.</p>` : ""}
      <div class="pe-chips">${ex.map(chip).join("")}</div>
      <div class="hello-models"><span class="chip model">muse-wonder</span><span class="chip model">muse-spark-1.3</span></div></div></div>`;
  }

  function chatMessage(m, i, lastAi) {
    if (m.role === "user") {
      return `<div class="msg-u"><div class="bubble">${m.thumb ? `<img src="${m.thumb}" alt="" data-zoom data-caption="${esc(m.file || "draft")}">` : ""}
        ${m.file ? `<div class="file">📎 ${esc(m.file)}</div>` : ""}${m.text ? `<div>${esc(m.text)}</div>` : ""}</div></div>`;
    }
    const steps = m.steps || [], working = m.status === "working";
    const last = [...steps].reverse().find((x) => x.kind !== "turn");
    const reading = m.reading ? `<div class="reading"><b>📐 Read your draft</b>${esc(m.reading.what_it_is || "")}${m.reading.rooms?.length ? `: ${m.reading.rooms.length} rooms
      (${esc(m.reading.rooms.slice(0, 8).map((r) => r.name).join(", "))}${m.reading.rooms.length > 8 ? "…" : ""})` : ""}</div>` : "";
    return `<div class="msg-a ${m.status}"><div class="av">W</div><div class="body">${reading}
      ${working ? `<div class="working"><span class="spin"></span> ${esc(last ? last.text.slice(0, 120) : "Thinking…")}</div>` : ""}
      ${m.text ? `<p>${esc(m.text)}</p>` : ""}
      ${m.issues?.length ? `<ul class="bad">${m.issues.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      ${steps.length ? `<details ${working ? "open" : ""}><summary>${((n) => `${n} step${n === 1 ? "" : "s"}`)(steps.filter((x) => x.kind === "ok" || x.kind === "no").length)} on the canvas</summary>
        <div class="assist-feed">${feedHtml({ feed: steps })}</div></details>` : ""}
      ${m.stats ? `<div class="stats">${esc(m.stats)}</div>` : ""}
      ${m.before && i === lastAi && !m.undone && !working ? `<button type="button" class="link small" data-pact="chat-undo" data-i="${i}">↶ Undo this change</button>` : ""}
      ${m.undone ? `<span class="tiny muted">Undone</span>` : ""}</div></div>`;
  }

  function paintChat() {
    const log = $("#chat-log");
    if (!log) return;
    const lastAi = E.chat.map((m) => m.role).lastIndexOf("ai");
    log.innerHTML = (E.chat.length ? "" : chatHello()) + E.chat.map((m, i) => chatMessage(m, i, lastAi)).join("")
      + (E.chat.length && !E.assist.running ? `<div class="chat-more">${(E.plan.rooms.length ? EX_EDIT : EX_NEW).slice(0, 3).map(chip).join("")}</div>` : "");
    log.scrollTop = log.scrollHeight;
    const att = $("#chat-att");
    att.innerHTML = E.chatFile ? `<span>📎 ${esc(E.chatFile.name)} <span class="muted">· starts a new layout from your draft</span></span>
      <button type="button" class="icon-btn" data-pact="chat-unattach" aria-label="Remove attachment">×</button>` : "";
    $("#chat-send").disabled = E.assist.running || !AI.ready;
    $("#chat-text").disabled = E.assist.running;
    $("#chat-text").placeholder = !AI.ready ? "The AI designer is off on this deployment (no API key)"
      : E.plan.rooms.length ? "Ask for a change, or a question about the design…" : "Describe what you want to build…";
  }

  function bindChat() {
    const form = $("#chat-form"), text = $("#chat-text"), file = $("#chat-file");
    form.onsubmit = (e) => { e.preventDefault(); chatSend(text.value, E.chatFile); };
    text.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } };
    file.onchange = () => { E.chatFile = file.files[0] || null; file.value = ""; paintChat(); text.focus(); };
  }

  async function smallImage(file, side) {
    const bitmap = await createImageBitmap(file), k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * k);
    c.height = Math.round(bitmap.height * k);
    c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
    return c;
  }

  function saveChat() {
    E.plan.chat = E.chat.slice(-40).map(({ role, text, file, stats, status, issues, reading }) => ({ role, text, file, stats, issues,
      status: status === "working" ? "error" : status, reading: reading ? { what_it_is: reading.what_it_is, rooms: (reading.rooms || []).map((r) => ({ name: r.name })) } : undefined }));
    changed(false);
  }

  async function chatSend(text, file) {
    text = (text || "").trim();
    if (E.assist.running || (!text && !file)) return;
    const planId = E.plan.id, before = snapshot(), isImage = file && /^image\//.test(file.type);
    const user = { role: "user", text, file: file?.name, thumb: isImage ? (await smallImage(file, 320)).toDataURL("image/jpeg", 0.8) : null };
    const ai = { role: "ai", text: "", steps: [], status: "working" };
    const history = E.chat.filter((m) => m.text).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    E.chat.push(user, ai);
    $("#chat-text").value = "";
    E.chatFile = null;
    const mode = file || !E.plan.rooms.length ? "new" : "edit";
    Object.assign(E.assist, { running: true, runMode: mode });
    if (mode === "new") { E.plan.rooms = []; E.plan.openings = []; E.plan.items = []; E.plan.notes = []; }
    Object.assign(E, { sel: null, tool: "select", tab: "ai" });
    if (E.mode === "simulate") setMode("design");
    paintChat();
    render(true);
    const live = () => E.plan?.id === planId && $("#plan-editor");
    const form = new FormData();
    form.append("message", text);
    form.append("plan", before);
    form.append("history", JSON.stringify(history));
    if (file) {
      const blob = isImage ? await new Promise((r) => smallImage(file, 2000).then((c) => c.toBlob(r, "image/jpeg", 0.88))) : file;
      form.append("file", blob, isImage ? file.name.replace(/\.\w+$/, "") + ".jpg" : file.name);
    }
    try {
      const res = await fetch("/api/studio/chat", { method: "POST", body: form });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.detail || `the server answered ${res.status}`); }
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buf = "", done = false;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || !live()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "note") ai.steps.push({ kind: "note", text: ev.text });
          else if (ev.type === "turn") ai.steps.push({ kind: "turn", text: `Turn ${ev.turn} · thought for ${ev.thinking_s} s · ${ev.calls} tool call${ev.calls === 1 ? "" : "s"}` });
          else if (ev.type === "sketch") ai.reading = ev.reading;
          else if (ev.type === "tool") { ai.steps.push({ kind: ev.ok ? "ok" : "no", text: ev.brief }); if (ev.plan) applyAssistPlan(ev.plan); }
          else if (ev.type === "error") throw new Error(ev.message);
          else if (ev.type === "done") {
            done = true;
            applyAssistPlan(ev.plan);
            E.flash = new Set();
            if (mode === "new" && ev.name) { E.plan.name = ev.name; const n = $("#pe-name"); if (n) n.value = ev.name; }
            if (mode === "new" && KINDS[ev.kind]) { E.plan.kind = ev.kind; }
            Object.assign(ai, { status: "done", before, text: ev.summary || (ev.finished ? "Done." : "I stopped before the plan passed every check:"),
              issues: ev.finished ? [] : ev.check?.errors, stats: `${ev.check.rooms} rooms · ${fmtA(ev.check.total_area_m2)} · ${Math.round(ev.seconds)} s · $${(ev.cost_usd || 0).toFixed(2)}` });
            E.undo.push(before);
            E.redo = [];
            continue;
          }
          paintChat();
          render();
        }
      }
      if (!done) throw new Error("the connection closed before it finished");
    } catch (err) {
      if (!live()) return;
      Object.assign(ai, { status: "error", text: `I couldn't finish that: ${err.message || err}. Your design is back as it was.` });
      E.flash = new Set();
      Object.assign(E.plan, JSON.parse(before));
    }
    E.assist.running = false;
    if (!live()) return;
    if (E.mode === "design") fitToScreen();
    saveChat();
    paintChat();
    render(true);
  }

  Object.assign(EDIT_ACTIONS, {
    stab: (el) => { E.tab = el.dataset.stab; paintTabs(); if (E.tab === "ai") $("#chat-text")?.focus(); else paintSide(true); },
    snap: () => { E.snap = !E.snap; paintTools(); },
    "ly-eye": (el) => {
      const k = el.dataset.l, L = E.layers.hide;
      L.has(k) ? L.delete(k) : L.add(k);
      if (E.sel && L.has(LIST[E.sel.kind])) E.sel = null;
      render(true);
    },
    "ly-lock": (el) => { const k = el.dataset.l, L = E.layers.lock; L.has(k) ? L.delete(k) : L.add(k); render(true); },
    "ly-open": (el) => { const k = el.dataset.l, O = E.layerOpen; O.has(k) ? O.delete(k) : O.add(k); paintLayers(); },
    "ly-sel": (el) => select(el.dataset.k, el.dataset.id),
    "chat-example": (el) => { const t = $("#chat-text"); t.value = el.dataset.text; t.focus(); },
    "ask-example": (el) => { const t = $("#ask-text"); t.value = el.dataset.text; t.focus(); },
    theme: toggleTheme,
    "chat-unattach": () => { E.chatFile = null; paintChat(); },
    "chat-undo": (el) => {
      const m = E.chat[Number(el.dataset.i)];
      if (!m?.before || E.assist.running) return;
      E.redo.push(snapshot());
      restore(m.before);
      m.undone = true;
      saveChat();
      paintChat();
    },
    "walk-lock": () => E.three?.lockPointer(),
    "file-new": () => { const plan = TEMPLATES.blank.make(); plan.name = "Untitled design"; savePlan(plan); E.openAssist = true; location.hash = `#/d/${plan.id}`; },
    "file-import": () => $("#studio-import")?.click(),
    "file-dup": () => { const copy = { ...JSON.parse(JSON.stringify(E.plan)), id: uid("p"), name: `${E.plan.name} (copy)`, chat: [] }; savePlan(copy); location.hash = `#/d/${copy.id}`; },
    "export-glb": async () => {
      $("#pe-export").open = false;
      try { download(await (await ensure3d()).exportGLB(), `${slug(E.plan)}.glb`); } catch (err) { alert(`The 3D model couldn't be exported: ${err.message || err}`); }
    },
    "export-shot": async () => {
      $("#pe-export").open = false;
      try {
        if (E.mode !== "3d" && E.mode !== "walk") setMode("3d");
        const three = await ensure3d();
        setTimeout(async () => download(await (await fetch(three.snapshot())).blob(), `${slug(E.plan)}-3d.png`), 300);
      } catch (err) { alert(`The 3D view couldn't be captured: ${err.message || err}`); }
    },
  });

  window.addEventListener("resize", () => { if ($("#plan-editor") && E.view) render(); });

  // studio.html: #/ the designs page, #/d/<id> a design, #/new a new design (with a brief from the home page, if any).
  function route(hash, app) {
    window.scrollTo(0, 0); // a design opened from low on the designs page starts at its top bar
    if (hash.startsWith("#/new")) {
      const plan = TEMPLATES.blank.make();
      plan.name = "Untitled design";
      savePlan(plan);
      let brief = "";
      try { brief = sessionStorage.getItem("gt.brief") || ""; sessionStorage.removeItem("gt.brief"); } catch {}
      Object.assign(E, { openAssist: true, prefill: brief, autorun: !!brief });
      return location.replace(`#/d/${plan.id}`);
    }
    const m = /^#\/(?:d|studio|plan)\/(.+)$/.exec(hash);
    if (m) return renderEditor(app, decodeURIComponent(m[1]));
    renderList(app);
  }

  async function boot(app) {
    await Promise.race([Promise.all([window.GTAuth?.ready, AI.check]), new Promise((r) => setTimeout(r, 3000))]);
    await Cloud.sync().catch(() => {});
    window.addEventListener("hashchange", () => route(location.hash, app));
    window.GTAuth?.onChange(async (user) => {
      await Cloud.sync().catch(() => {});
      if (!$("#plan-editor")) return route(location.hash, app);
      if (!user) return location.assign("#/"); // the design belongs to the account that just signed out
      E.savedOk = savePlan(E.plan); // a design made as a guest is now saved to the account
      paintStatus();
    });
    // pictures in the chat open full size
    document.addEventListener("click", (e) => {
      const z = e.target.closest("[data-zoom]"), box = $("#lightbox");
      if (box && z) { $("img", box).src = z.dataset.full || z.getAttribute("src"); $("p", box).textContent = z.dataset.caption || ""; box.hidden = false; }
      else if (box && e.target.closest("#lightbox")) box.hidden = true;
    });
    route(location.hash, app);
  }

  // From the home page: open the studio on a new design, with the AI designer working on the description.
  function designFrom(text) {
    try { sessionStorage.setItem("gt.brief", text); } catch {}
    location.href = "/studio#/new";
  }

  // The home page's drawing: the two-bedroom template with the simulation's sun crossing it on 21 December in Delhi
  // (a step every quarter hour from 7:00, while the drawing is on screen; held at 10:00 for reduced motion) and a
  // resident's morning route (a dot walks it). onHour(hour) hears the time shown. Without the server it shows the
  // plan alone. Returns the simulation.
  // One plan and one simulation for every drawing on the home page (the simulation is keyed by room ids).
  let heroPlan, heroSim;
  function heroData() {
    heroPlan = heroPlan || TEMPLATES.home.make();
    heroSim = heroSim || fetch("/api/plan/simulate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: { rooms: heroPlan.rooms, openings: heroPlan.openings, items: heroPlan.items }, settings: { latitude: 28.6, season: "winter", north: 0 } }) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return [heroPlan, heroSim];
  }
  // size: the drawing's [width, height]; simFirst: draw once, with the sun, so that nothing redraws mid-animation.
  async function heroPreview(el, { onHour, size = [560, 440], pad = 28, simFirst = false, grid = false } = {}) {
    const [plan, simReady] = heroData(), [W, H] = size, view = fitView(plan, W, H, pad);
    const svg = (overlay) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="A two-bedroom plan with sunlight crossing it through the day and a walking route">
      <rect width="${W}" height="${H}" fill="${PAPER}"/>${drawPlan(plan, view, { overlay, grid, width: W, height: H })}</svg>`;
    if (!simFirst) el.innerHTML = svg();
    try {
      const sim = await simReady;
      if (!sim) { if (simFirst) el.innerHTML = svg(); return null; }
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const samples = sim.sun.samples, first = Math.max(0, samples.findIndex((x) => x.hour >= 10));
      const route = (sim.movement.people[0]?.legs || []).slice(0, 4).filter((l) => l.ok).flatMap((l) => l.path);
      let X, Y;
      const patches = (s) => (s?.patches || []).map((p) => `<polygon points="${p.poly.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}" fill="#ffd54a" fill-opacity=".7" stroke="#e8a900"/>`).join("");
      el.innerHTML = svg((x, y, L) => {
        [X, Y] = [x, y];
        const out = [`<g class="hero-sun">${patches(samples[first])}</g>`];
        if (route.length > 1) {
          const d = route.map(([x, y], i) => `${i ? "L" : "M"}${X(x)},${Y(y)}`).join(" "), [x0, y0] = route[0];
          out.push(`<path d="${d}" fill="none" stroke="${ACCENT}" stroke-width="2.2" stroke-dasharray="6 5" stroke-linejoin="round"/>
            ${still ? `<circle r="7" cx="${X(x0)}" cy="${Y(y0)}" fill="${ACCENT}" stroke="#fff" stroke-width="2.5"/>`
              : `<circle r="7" fill="${ACCENT}" stroke="#fff" stroke-width="2.5"><animateMotion dur="9s" repeatCount="indefinite" path="${d}"/></circle>`}`);
        }
        for (const r of plan.rooms) {
          const h = sim.sun.rooms[r.id]?.sun_hours;
          if (h == null || L(r.w) < 70) continue;
          out.push(`<rect x="${X(r.x) + 6}" y="${Y(r.y) + 6}" width="54" height="18" rx="9" fill="${h >= 3 ? "#f2b600" : h > 0 ? "#f7d774" : "#d6d3cc"}"/>
            <text x="${X(r.x) + 33}" y="${Y(r.y) + 19}" text-anchor="middle" font-size="11" font-weight="700" fill="#3b2f00">☀ ${+h.toFixed(2)} h</text>`);
        }
        return `<g class="hero-ov">${out.join("")}</g>`;
      });
      onHour?.(samples[first]?.hour);
      if (!still && samples.length > 1) {
        let i = first, rest = 0, seen = true;
        const io = window.IntersectionObserver ? new IntersectionObserver(([e]) => { seen = e.isIntersecting; }) : null;
        io?.observe(el);
        const timer = setInterval(() => {
          if (!document.body.contains(el)) { clearInterval(timer); io?.disconnect(); return; }
          if (!seen || document.hidden) return;
          if (i === samples.length - 1 && rest++ < 6) return; // a moment at dusk before the next day
          rest = 0;
          i = (i + 1) % samples.length;
          const g = el.querySelector(".hero-sun");
          if (g) g.innerHTML = patches(samples[i]);
          onHour?.(samples[i].hour);
        }, 240);
      }
      return sim;
    } catch {
      return null;
    }
  }

  return { boot, route, drawPlan, fitView, walls, TEMPLATES, designFrom, heroPreview, heroPlan: () => heroData()[0], examples: EX_NEW,
    geometry: { walls, openingGeom, shared, footprint, bounds, FLOORS, defaultFloor } };
})();
