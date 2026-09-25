// Mede travadas numa corrida real com GPU: registra quadros lentos e o que custou em cada um.
// Uso: node scripts/perfil-travadas.mjs [segundos] [pista] [url]
import { chromium } from 'playwright-core';
const secs = +(process.argv[2] ?? 60);
const trackId = process.argv[3] ?? 'chem6-1';
const base = process.argv[4] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--no-proxy-server', '--window-position=-2400,-2400', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.routeWebSocket(/.*/, () => {});
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto(base + '?autopilot&laps=5', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.game, null, { timeout: 120000 });
await page.waitForTimeout(2000);
await page.evaluate((trackId) => {
  const g = window.game;
  const P = (window.__perf = { cur: {}, frames: [], long: [] });
  const wrap = (obj, name, label) => {
    const f = obj[name];
    if (typeof f !== 'function') return;
    obj[name] = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); } finally { P.cur[label] = (P.cur[label] || 0) + performance.now() - t; }
    };
  };
  wrap(g, 'step', 'step');
  wrap(g, 'render', 'render');
  wrap(g, 'onEvent', 'onEvent');
  wrap(g, 'resize', 'resize');
  wrap(g.effects, 'update', 'effects');
  wrap(g.renderer, 'render', 'gl.render');
  // tempo de GPU por quadro (EXT_disjoint_timer_query_webgl2)
  const gl = g.renderer.getContext();
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  P.gpu = [];
  const pending = [];
  let q = null;
  const origRender = g.render;
  g.render = function (...a) {
    if (tq && !q) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
    const r = origRender.apply(this, a);
    if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); pending.push({ q, at: performance.now() }); q = null; }
    while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const p0 = pending.shift();
      const ns = gl.getQueryParameter(p0.q, gl.QUERY_RESULT);
      gl.deleteQuery(p0.q);
      P.gpu.push(ns / 1e6);
      if (ns / 1e6 > 30) P.long.push({ gpuMs: +(ns / 1e6).toFixed(1), at: +(p0.at / 1000).toFixed(2) });
    }
    return r;
  };
  if (g.postfx) wrap(g.postfx, 'render', 'postfx');
  wrap(g.hud, 'update', 'hud');
  wrap(g.commentary, 'update', 'commentary');
  const origOn = g.onEvent;
  g.onEvent = function (e) { (P.cur.ev ||= []).push(e.type ?? e.t ?? e.kind); return origOn.call(this, e); };
  const origFrame = g.frame;
  let last = 0;
  g.frame = function (now) {
    P.cur = {};
    const t = performance.now();
    origFrame.call(this, now);
    const cost = performance.now() - t;
    const gap = last ? now - last : 0;
    last = now;
    P.frames.push(gap);
    if (g.dynRes.scale !== P.lastScale) { P.long.push({ at: +(now / 1000).toFixed(2), escala: g.dynRes.scale, pr: g.renderer.getPixelRatio() }); P.lastScale = g.dynRes.scale; }
    if (gap > 40 || cost > 25) P.long.push({ calls: g.renderer.info.render.calls, at: +(now / 1000).toFixed(2), gap: +gap.toFixed(1), cost: +cost.toFixed(1), phase: g.phase, ...Object.fromEntries(Object.entries(P.cur).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v])) });
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push({ longtask: +e.duration.toFixed(0), at: +(e.startTime / 1000).toFixed(2) }); }).observe({ type: 'longtask', buffered: false });
  } catch {}
  g.menuActions().quickRace({ trackId, vehicleId: 'marauder', color: 0x2f7bff, difficulty: 'normal' });
}, trackId);
await page.waitForTimeout(secs * 1000);
const r = await page.evaluate(() => {
  const P = window.__perf, g = window.game;
  const f = P.frames.filter((x) => x > 0).sort((a, b) => a - b);
  const pct = (p) => f[Math.floor(f.length * p)]?.toFixed(1);
  const gg = P.gpu.slice().sort((a, b) => a - b);
  return { gpuMediana: gg[gg.length >> 1]?.toFixed(1), gpuP95: gg[Math.floor(gg.length * 0.95)]?.toFixed(1), dpr: devicePixelRatio, pr: g.renderer.getPixelRatio(), quadros: f.length, mediana: pct(0.5), p99: pct(0.99), max: f.at(-1)?.toFixed(1), acima33: f.filter((x) => x > 33).length, acima50: f.filter((x) => x > 50).length, qualidade: g.quality.level, escala: g.dynRes.scale, fase: g.phase, long: P.long };
});
console.log(JSON.stringify({ ...r, long: undefined }, null, 1));
for (const l of r.long) console.log(JSON.stringify(l));
await browser.close();
