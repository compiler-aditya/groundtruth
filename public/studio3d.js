/* GroundTruth studio: the plan in 3D (orbit around it, or walk inside it), with the site's sun and shadows.
   Loaded only when the 3D or Walk view opens. The plan's geometry helpers come from plans.js (G). */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const SILL = 0.9, HEAD = 2.1, EYE = 1.6, RADIUS = 0.25;
const FURNITURE = { // height, colour
  bed_double: [0.5, 0xe9e4da], bed_single: [0.5, 0xe9e4da], sofa: [0.8, 0x8f9aa6], armchair: [0.8, 0x8f9aa6], dining_table: [0.75, 0xa8794f],
  meeting_table: [0.75, 0xa8794f], desk: [0.75, 0xb58a5e], wardrobe: [2.0, 0xd8cbb6], counter: [0.9, 0xeeeeea], stove: [0.92, 0x3a3a3a],
  kitchen_sink: [0.9, 0xd0d4d8], fridge: [1.8, 0xf2f2f2], toilet: [0.45, 0xffffff], basin: [0.85, 0xffffff], shower: [0.06, 0xdfe7ea],
  bathtub: [0.55, 0xffffff], stairs: [2.6, 0xc9b79c], car: [1.4, 0x4f6d8f], plant: [1.0, 0x4f8a4f],
};

export function sunPosition(latitude, day, hour) {
  const rad = Math.PI / 180, decl = 23.44 * rad * Math.sin((2 * Math.PI * (day - 81)) / 365);
  const lat = latitude * rad, h = (15 * (hour - 12)) * rad;
  const el = Math.asin(Math.max(-1, Math.min(1, Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h))));
  const az = Math.atan2(-Math.sin(h) * Math.cos(decl), Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(h));
  return { azimuth: ((az / rad) + 360) % 360, elevation: el / rad };
}

export function create(container, G) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const sky = new THREE.Color(0xeef0f2);
  scene.background = sky;
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 600);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb9b2a5, 1.1);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const ambient = new THREE.AmbientLight(0xffffff, 0.15); // raised inside, where the ceilings block the sky
  scene.add(hemi, sun, sun.target, ambient);
  const world = new THREE.Group(), ceilings = new THREE.Group();
  scene.add(world);
  world.add(ceilings);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.minDistance = 2;
  const look = new PointerLockControls(camera, document.body);
  const state = { mode: "orbit", center: new THREE.Vector3(), size: 10, colliders: [], keys: new Set(), yaw: 0, pitch: 0, running: true, wall: 2.7, onMove: null };
  const clock = new THREE.Clock();
  const disposables = [];
  const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }); disposables.push(m); return m; };
  const box = (w, h, d, material, x, y, z, ry = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    disposables.push(geo);
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  function clear() {
    for (const obj of [...world.children]) if (obj !== ceilings) world.remove(obj);
    ceilings.clear();
    disposables.splice(0).forEach((d) => d.dispose());
  }

  function build(plan) {
    clear();
    const H = state.wall = Math.max(2.2, Math.min(6, Number(plan.wallHeight) || 2.7));
    const b = G.bounds(plan), cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    state.center.set(cx, 0, cz);
    state.size = Math.max(b.w, b.h, 6);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(state.size * 6, state.size * 6), mat(0xdcd8cf));
    disposables.push(ground.geometry);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.01, cz);
    ground.receiveShadow = true;
    world.add(ground);
    const wallMat = mat(0xf5f3ee), lintelMat = wallMat, glass = mat(0x9fc6e2, { transparent: true, opacity: 0.32, roughness: 0.1 });
    const doorMat = mat(0xb6895c), ceilMat = mat(0xfbfaf7);
    for (const r of plan.rooms) {
      const floor = G.FLOORS[r.floor || G.defaultFloor(r.type)] || G.FLOORS.wood;
      world.add(box(r.w, 0.04, r.h, mat(floor[1]), r.x + r.w / 2, 0.02, r.y + r.h / 2));
      const c = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), ceilMat);
      disposables.push(c.geometry);
      c.rotation.x = Math.PI / 2;
      c.position.set(r.x + r.w / 2, H, r.y + r.h / 2);
      ceilings.add(c);
    }
    const colliders = [];
    for (const w of G.walls(plan)) {
      const a = w.a - (w.ca ? w.t / 2 : 0), e = w.b + (w.cb ? w.t / 2 : 0), len = e - a, mid = (a + e) / 2;
      world.add(w.o === "h" ? box(len, H, w.t, wallMat, mid, H / 2, w.c) : box(w.t, H, len, wallMat, w.c, H / 2, mid));
      colliders.push(w.o === "h" ? [a, w.c - w.t / 2, e, w.c + w.t / 2] : [w.c - w.t / 2, a, w.c + w.t / 2, e]);
    }
    for (const op of plan.openings) {
      const g = G.openingGeom(plan, op);
      if (!g) continue;
      const t = G.shared(plan, g.o, g.c, g.a, g.b) ? 0.1 : 0.2, width = g.b - g.a;
      const piece = (y0, y1, material, thick = t) => {
        if (y1 - y0 < 0.01) return;
        world.add(g.o === "h" ? box(width, y1 - y0, thick, material, g.mid, (y0 + y1) / 2, g.c) : box(thick, y1 - y0, width, material, g.c, (y0 + y1) / 2, g.mid));
      };
      if (op.type === "door") {
        piece(HEAD, H, lintelMat);
        const along = g.o === "h" ? [1, 0] : [0, 1], hinge = op.hinge === "end" ? g.b : g.a, sign = op.hinge === "end" ? -1 : 1;
        const swing = op.swing === "out" ? -1 : 1, n = [g.inward[0] * swing, g.inward[1] * swing];
        const angle = 75 * Math.PI / 180, dx = Math.cos(angle) * along[0] * sign + Math.sin(angle) * n[0], dz = Math.cos(angle) * along[1] * sign + Math.sin(angle) * n[1];
        const hx = g.o === "h" ? hinge : g.c, hz = g.o === "h" ? g.c : hinge;
        world.add(box(width * 0.96, HEAD - 0.04, 0.04, doorMat, hx + dx * width * 0.48, HEAD / 2, hz + dz * width * 0.48, Math.atan2(-dz, dx)));
      } else if (op.type === "window") {
        piece(0, SILL, wallMat);
        piece(HEAD, H, lintelMat);
        piece(SILL, HEAD, glass, 0.03);
        colliders.push(g.o === "h" ? [g.a, g.c - t / 2, g.b, g.c + t / 2] : [g.c - t / 2, g.a, g.c + t / 2, g.b]);
      } else piece(Math.min(H, 2.4), H, lintelMat);
    }
    for (const it of plan.items) {
      const [fw, fd] = G.footprint(it), [h, color] = FURNITURE[it.type] || [0.8, 0xcccccc], m = mat(color);
      const group = new THREE.Group();
      group.position.set(it.cx, 0, it.cy);
      group.rotation.y = -((it.rot || 0) * Math.PI) / 180;
      const W = it.w, D = it.h; // local, before rotation; the plan's +y is three's +z
      const add = (w, hh, d, x, y, z, material = m) => group.add(box(w, hh, d, material, x, y, z));
      if (it.type.startsWith("bed")) {
        add(W, 0.35, D, 0, 0.175, 0, mat(0x8a6f55)); add(W - 0.06, 0.18, D - 0.1, 0, 0.44, 0.03, mat(0xf3efe7));
        add(W, 0.9, 0.06, 0, 0.45, -D / 2 + 0.03, mat(0x8a6f55)); add(W * 0.8, 0.1, 0.35, 0, 0.58, -D / 2 + 0.3, mat(0xffffff));
      } else if (it.type === "sofa" || it.type === "armchair") {
        add(W, 0.42, D, 0, 0.21, 0); add(W, 0.45, 0.2, 0, 0.62, -D / 2 + 0.1); add(0.15, 0.25, D, -W / 2 + 0.075, 0.55, 0); add(0.15, 0.25, D, W / 2 - 0.075, 0.55, 0);
      } else if (it.type.endsWith("table") || it.type === "desk") {
        add(W, 0.04, D, 0, h - 0.02, 0);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(0.05, h - 0.04, 0.05, sx * (W / 2 - 0.06), (h - 0.04) / 2, sz * (D / 2 - 0.06));
      } else if (it.type === "stairs") {
        const n = Math.max(3, Math.round(D / 0.28));
        for (let i = 0; i < n; i++) add(W, (h * (i + 1)) / n, D / n, 0, (h * (i + 1)) / n / 2, -D / 2 + (D / n) * (i + 0.5));
      } else if (it.type === "plant") {
        group.add(box(0.3, 0.35, 0.3, mat(0x8b6b4f), 0, 0.175, 0));
        const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), m);
        disposables.push(leaves.geometry);
        leaves.position.y = 0.7;
        leaves.castShadow = true;
        group.add(leaves);
      } else if (it.type === "counter" || it.type === "kitchen_sink" || it.type === "stove") {
        add(W, h - 0.04, D, 0, (h - 0.04) / 2, 0, mat(0xe7e3da)); add(W, 0.04, D, 0, h - 0.02, 0, it.type === "stove" ? m : mat(0x6f6f6f));
      } else add(W, h, D, 0, h / 2, 0);
      world.add(group);
      if (h > 0.3) colliders.push([it.cx - fw / 2, it.cy - fd / 2, it.cx + fw / 2, it.cy + fd / 2]);
    }
    state.colliders = colliders;
    const s = state.size;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: s * 8 });
    sun.shadow.camera.updateProjectionMatrix();
    ceilings.visible = state.mode === "walk";
    if (!state.placed) { frame(); state.placed = true; }
  }

  function setSun(azimuth, elevation, north) {
    const t = ((azimuth - north) * Math.PI) / 180, e = (Math.max(elevation, 2) * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(t) * Math.cos(e), Math.sin(e), -Math.cos(t) * Math.cos(e));
    sun.position.copy(state.center).addScaledVector(dir, state.size * 3);
    sun.target.position.copy(state.center);
    const day = elevation > 0;
    sun.intensity = day ? 0.6 + 2.2 * Math.min(1, elevation / 35) : 0;
    hemi.intensity = day ? 1.1 : 0.35;
    scene.background = day ? sky : new THREE.Color(0x1d2330);
  }

  function frame() {
    const s = state.size, c = state.center;
    camera.position.set(c.x + s * 0.7, s * 0.95, c.z + s * 1.05);
    orbit.target.copy(c);
    orbit.update();
  }

  // Walk: start just inside an entrance (or in the largest room), eye height, looking into the room.
  function startWalk(plan) {
    let x = state.center.x, z = state.center.z, yaw = 0;
    const entrance = plan.openings.map((op) => G.openingGeom(plan, op)).find((g) => g && g.op.type === "door" && !G.shared(plan, g.o, g.c, g.a, g.b));
    if (entrance) {
      x = entrance.o === "h" ? entrance.mid : entrance.c;
      z = entrance.o === "h" ? entrance.c : entrance.mid;
      x += entrance.inward[0] * 0.9;
      z += entrance.inward[1] * 0.9;
      yaw = Math.atan2(-entrance.inward[0], -entrance.inward[1]);
    } else {
      const r = [...plan.rooms].sort((p, q) => q.w * q.h - p.w * p.h)[0];
      if (r) { x = r.x + r.w / 2; z = r.y + r.h / 2; }
    }
    camera.position.set(x, EYE, z);
    state.yaw = yaw;
    state.pitch = 0;
    camera.rotation.set(0, yaw, 0, "YXZ");
  }

  function setMode(mode, plan) {
    state.mode = mode;
    orbit.enabled = mode === "orbit";
    ceilings.visible = mode === "walk";
    ambient.intensity = mode === "walk" ? 1.15 : 0.15;
    if (mode === "walk") startWalk(plan);
    else { if (look.isLocked) look.unlock(); frame(); }
  }

  const blocked = (x, z) => state.colliders.some(([x0, z0, x1, z1]) => {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    return dx * dx + dz * dz < RADIUS * RADIUS;
  });

  function step(dt) {
    const k = state.keys, speed = (k.has("shift") ? 3.0 : 1.5) * dt;
    let turn = 0, fwd = 0, side = 0;
    if (k.has("w") || k.has("arrowup") || k.has("fwd")) fwd += 1;
    if (k.has("s") || k.has("arrowdown") || k.has("back")) fwd -= 1;
    if (k.has("a")) side -= 1;
    if (k.has("d")) side += 1;
    if (k.has("arrowleft") || k.has("left")) turn += 1;
    if (k.has("arrowright") || k.has("right")) turn -= 1;
    if (turn) { state.yaw += turn * 1.8 * dt; camera.rotation.set(state.pitch, state.yaw, 0, "YXZ"); }
    if (look.isLocked) { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ"); state.yaw = e.y; state.pitch = e.x; }
    if (!fwd && !side) return;
    const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw), rx = Math.cos(state.yaw), rz = -Math.sin(state.yaw);
    const dx = (fx * fwd + rx * side) * speed, dz = (fz * fwd + rz * side) * speed;
    const p = camera.position;
    if (!blocked(p.x + dx, p.z)) p.x += dx;
    if (!blocked(p.x, p.z + dz)) p.z += dz;
    state.onMove?.(p.x, p.z, state.yaw);
  }

  // Drag to look around when the pointer isn't locked (touch screens, or before clicking in).
  let drag = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { if (state.mode === "walk" && !look.isLocked) drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener("pointerup", () => { drag = null; });
  window.addEventListener("pointermove", (e) => {
    if (!drag || state.mode !== "walk") return;
    state.yaw -= (e.clientX - drag.x) * 0.005;
    state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
    camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
  });
  const keyName = (e) => (e.key === "Shift" ? "shift" : e.key.toLowerCase());
  const onKey = (down) => (e) => {
    if (state.mode !== "walk" || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
    const k = keyName(e);
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
      e.preventDefault();
      down ? state.keys.add(k) : state.keys.delete(k);
    }
  };
  const keydown = onKey(true), keyup = onKey(false);
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);

  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 600;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    if (!state.running) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (state.mode === "orbit") orbit.update();
    else step(dt);
    renderer.render(scene, camera);
  });

  return {
    build, setSun, setMode,
    lockPointer: () => look.lock(),
    hold: (k, on) => (on ? state.keys.add(k) : state.keys.delete(k)),
    onMove: (fn) => { state.onMove = fn; },
    pause: () => { state.running = false; state.keys.clear(); if (look.isLocked) look.unlock(); },
    resume: () => { state.running = true; clock.getDelta(); resize(); },
    snapshot: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); },
    exportGLB: () => new Promise((resolve, reject) => { // hidden objects (the ceilings outside Walk) are left out
      new GLTFExporter().parse(world, (glb) => resolve(new Blob([glb], { type: "model/gltf-binary" })), reject, { binary: true, onlyVisible: true });
    }),
    isLocked: () => look.isLocked,
    look,
  };
}
