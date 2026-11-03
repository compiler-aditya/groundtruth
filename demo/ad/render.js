// Renders the ad frame by frame: node render.js [from=0] [to=duration] [step=1] [out=frames]
// The ad page is served at http://localhost:8000/__ad/ (same origin as the product, so its iframes can be reached).
// Live product iframes ("vt-…") run on virtual time; only the ones on screen move, one frame (33.3 ms) per frame.
// Frames are written as JPEGs; ffmpeg assembles them (see encode.sh).
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
// Optional local stand-ins: THREE_DIR (an npm copy of three@0.160.0, for machines without CDN access) and STUB_DIR
// (package.json + thumbs/ for the demo package, where the sample media is missing).
const THREE_DIR = process.env.THREE_DIR, STUB_DIR = process.env.STUB_DIR;
const [from = 0, to = null, step = 1, out = 'frames'] = process.argv.slice(2).map((v, i) => (i < 3 ? (v == null || v === '' ? null : Number(v)) : v));
const FPS = 30, DT = 1000 / FPS;
const OUT = path.join(__dirname, out);

// the hero window alone, full frame, without the home page around it or its side panel
const HERO_CSS = `body > header, body > footer, #lightbox { display: none !important; }
  #hs { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; margin: 0 !important; z-index: 9999; border-radius: 0 !important; display: flex; flex-direction: column; }
  #hs .hs-body { flex: 1; display: block !important; height: auto !important; }
  #hs .hs-side { display: none !important; }
  #hs .hs-stage { position: absolute !important; inset: var(--hsbar, 52px) 0 0 0 !important; height: auto !important; aspect-ratio: auto !important; }
  #hs .hs-open, #hs .hs-live { display: none !important; }
  html, body { overflow: hidden !important; }`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const c = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await c.addInitScript({ path: path.join(__dirname, 'vt.js') });
  // the design scene's hero only ever shows the plan: no WebGL there (a hidden 3D canvas slows every screenshot)
  await c.addInitScript(`(() => { if (window.name !== 'vt-hero') return;
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (k, ...a) { return /webgl/.test(k) ? null : gc.call(this, k, ...a); }; })();`);
  await c.addInitScript(`(() => { if (!String(window.name).startsWith('vt-hero')) return;
    try { localStorage.removeItem('gt.theme'); } catch {}
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(HERO_CSS)}; document.head.appendChild(s); }); })();`);
  if (THREE_DIR) await c.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r) => {
    const f = path.join(THREE_DIR, new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', ''));
    fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) }) : r.abort();
  });
  const TYPES = { html: 'text/html', js: 'application/javascript', json: 'application/json', svg: 'image/svg+xml', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  await c.route('**/__ad/**', (r) => {
    const f = path.join(__dirname, decodeURIComponent(new URL(r.request().url()).pathname.replace('/__ad/', '')));
    fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: TYPES[path.extname(f).slice(1)] || 'application/octet-stream' }) : r.fulfill({ status: 404, body: '' });
  });
  // what the live site reports: Meta keys present, so the product shows its live controls
  await c.route('**/api/health', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, hosted: true, keys: { meta: true, baseten: true }, upload_code_required: false, video_uploads: true, max_files: 8, max_file_mb: 4 }) }));
  if (STUB_DIR) {
    await c.route('**/api/packages/demo-solar', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(path.join(STUB_DIR, 'package.json')) }));
    await c.route('**/thumbs/demo-solar/*.jpg', (r) => { const f = path.join(STUB_DIR, 'thumbs', path.basename(new URL(r.request().url()).pathname)); fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(f) }) : r.abort(); });
  }

  const p = await c.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
  await p.goto('http://localhost:8000/__ad/ad.html' + (process.env.FRAMES != null ? `?frames=${process.env.FRAMES}` : ''));
  await p.waitForFunction(() => window.AD && AD.ready, null, { timeout: 30000 });
  await p.evaluate(() => document.fonts.ready);
  const AD = await p.evaluate(() => ({ duration: AD.duration, actions: AD.actions, frames: Object.keys(AD.frames) }));
  const end = to ?? AD.duration;

  // let every live frame load: the hero needs its package and plan, the Studio its templates. Waits poll from here
  // (Playwright's own waits run on the page clock, which is frozen in these frames) and clicks are made in the page.
  const T = Date.now(), log = (m) => console.log(`[setup ${((Date.now() - T) / 1000).toFixed(1)}s] ${m}`);
  const frame = (n) => p.frame({ name: n });
  for (const n of AD.frames) { for (let i = 0; i < 400 && !frame(n); i++) await p.waitForTimeout(50); await frame(n).waitForLoadState('load'); }
  const tick = (n, ms) => frame(n).evaluate((d) => window.__vt.advance(d), ms);
  const until = async (n, js, what, maxMs = 90000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < maxMs) { if (await frame(n).evaluate(js).catch(() => false)) return true; await tick(n, 40); await p.waitForTimeout(70); }
    throw new Error(`timed out: ${n} ${what}`);
  };
  const click = (n, sel) => frame(n).evaluate((s) => document.querySelector(s).click(), sel);
  const settle = async (n, ms, steps = 20) => { for (let i = 0; i < steps; i++) { await tick(n, ms / steps); await p.waitForTimeout(60); } };
  log('frames: ' + AD.frames.join(', '));
  if (frame('vt-hero')) { await until('vt-hero', () => !!document.querySelector('#hs-plan svg'), 'hero plan'); log('hero plan'); }
  if (frame('vt-hero2')) {
    await until('vt-hero2', () => !!document.querySelector('#hs-plan svg'), 'hero2 plan');
    await click('vt-hero2', '[data-hs="1"]'); // build the 3D view now, so it is ready when its scene comes round
    await until('vt-hero2', () => !!document.querySelector('#hs-3d canvas'), 'hero2 3d');
    await settle('vt-hero2', 400, 8);
    await click('vt-hero2', '[data-hs="0"]');
    await settle('vt-hero2', 100, 2);
    log('hero2 3d built');
  }
  if (frame('vt-studio')) {
    const n = 'vt-studio';
    await until(n, () => !!document.querySelector('[data-template="home"]'), 'studio templates');
    await click(n, '[data-template="home"]');
    await until(n, () => !!document.querySelector('[data-mode="simulate"]'), 'studio editor');
    await settle(n, 600, 8);
    await click(n, '[data-mode="simulate"]'); // score it once now; the result is kept for the scene
    await until(n, () => /\d/.test(document.querySelector('.sim-scores b')?.textContent || ''), 'studio sim');
    const sim = await frame(n).evaluate(() => [...document.querySelectorAll('.sim-scores b')].map((b) => +b.textContent));
    await p.evaluate((v) => { AD.live.sim = v; }, sim);
    await click(n, '[data-mode="design"]');
    await settle(n, 300, 4);
    log('studio ready, sim ' + sim.join('/'));
  }

  // the audio cues, for the mix
  fs.writeFileSync(path.join(__dirname, 'cues.json'), JSON.stringify(await p.evaluate(() => ({ duration: AD.duration, vo: AD.vo, sfx: AD.sfx })), null, 1));
  const cdp = await c.newCDPSession(p);
  fs.mkdirSync(OUT, { recursive: true });
  const N0 = Math.round(from * FPS), N1 = Math.round(end * FPS);
  let ai = 0;
  const acts = AD.actions;
  // actions before the start of this range have already happened, in order
  const fire = async (a) => { const f = frame(a.frame); if (!f) return; await f.evaluate((js) => { try { (0, eval)(js); } catch (e) { console.error('act', e.message); } }, a.js); };
  while (ai < acts.length && acts[ai].t < from) { await fire(acts[ai]); ai++; }
  const t0 = Date.now();
  let shown = [];
  for (let n = N0; n < N1; n++) {
    const t = n / FPS, tF = Date.now();
    while (ai < acts.length && acts[ai].t <= t) { await fire(acts[ai]); ai++; }
    // move the clocks of the frames on screen (also on skipped frames, so motion stays in time)
    for (const name of shown) await frame(name).evaluate((d) => window.__vt.advance(d), DT);
    shown = await p.evaluate((t) => window.seek(t), t);
    if ((n - N0) % step) continue;
    if (shown.length) await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    const tA = Date.now();
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
    if (process.env.PROFILE) console.log(`frame ${n}: step ${tA - tF}ms, shot ${Date.now() - tA}ms`);
    fs.writeFileSync(path.join(OUT, String(n).padStart(5, '0') + '.jpg'), Buffer.from(shot.data, 'base64'));
    if (n % 150 === 0) console.log(`t=${t.toFixed(1)}s  ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed`);
  }
  console.log('done', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  await b.close();
})();
