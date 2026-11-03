// Virtual time for a product page embedded in the ad: timers, requestAnimationFrame, the clock and CSS animations
// move only when the ad calls window.__vt.advance(ms), so every frame of the product is rendered exactly on time.
// Only frames whose name starts with "vt" are affected.
(() => {
  if (!String(window.name).startsWith('vt')) return;
  let now = 0;
  const date0 = Date.now(), RealDate = Date, timers = new Map(), rafs = new Map();
  let nextId = 1;
  performance.now = () => now;
  Date.now = () => date0 + now;
  window.setTimeout = (fn, d = 0, ...a) => { const id = nextId++; timers.set(id, { at: now + Math.max(0, +d || 0), fn, a, every: 0 }); return id; };
  window.setInterval = (fn, d = 0, ...a) => { const id = nextId++, e = Math.max(1, +d || 0); timers.set(id, { at: now + e, fn, a, every: e }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (fn) => { const id = nextId++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  const run = (fn, a) => { try { typeof fn === 'function' ? fn(...a) : new Function(fn)(); } catch (e) { console.error('vt', e); } };
  window.__vt = {
    get now() { return now; },
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 10000; guard++) {
        let best = null;
        for (const [id, t] of timers) if (t.at <= end && (!best || t.at < best[1].at)) best = [id, t];
        if (!best) break;
        const [id, t] = best;
        now = Math.max(now, t.at);
        if (t.every) t.at += t.every; else timers.delete(id);
        run(t.fn, t.a);
      }
      now = end;
      const cbs = [...rafs.values()]; rafs.clear();
      for (const fn of cbs) run(fn, [now]);
      // a one-pixel change each step, so the frame always hands the compositor a new frame (screenshots wait for one)
      let px = document.getElementById('__vt_px');
      if (!px && document.body) { px = document.createElement('div'); px.id = '__vt_px'; px.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:2147483647;pointer-events:none'; document.body.appendChild(px); }
      if (px) px.style.background = (Math.round(now / 33) % 2) ? 'rgba(255,255,255,.02)' : 'rgba(0,0,0,.02)';
      for (const an of document.getAnimations()) { if (an.playState === 'running') an.pause(); if (an.playState !== 'finished') an.currentTime = (an.currentTime || 0) + ms; }
    },
  };
})();
