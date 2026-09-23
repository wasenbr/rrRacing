// Captura telas perto de elementos de pista (cruzamento X, vão G, warp reverso <).
// Uso: node scripts/pistas/telas.mjs <pastaSaida>   (com npm run dev rodando)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.route('**/@vite/client', (r) => r.fulfill({ contentType: 'application/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}});export const updateStyle=(id,css)=>{const s=document.createElement("style");s.textContent=css;document.head.appendChild(s)};export const removeStyle=()=>{};export const injectQuery=(u)=>u;' }));
await p.goto('http://localhost:5173/?autopilot&laps=3', { waitUntil: 'domcontentloaded', timeout: 120000 });
console.log('carregou html', Date.now());
await p.waitForFunction(() => !!window.game, null, { timeout: 60000 });
await p.waitForTimeout(2000);
const shots = [['nho-2', 'X', 'iso'], ['inferno-2', 'G', 'iso'], ['nho-3', 'G', 'chase'], ['inferno-1', '<', 'iso'], ['bogmire-5', 'X', 'chase']];
for (const [id, feat, cam] of shots) {
  await p.evaluate(([id, cam]) => { const a = window.game.menuActions(); a.setCamera(cam); a.quickRace({ trackId: id, vehicleId: 'havac', color: 0x2f7bff, difficulty: 'normal' }); }, [id, cam]);
  await p.waitForTimeout(1500);
  const ok = await p.evaluate((feat) => {
    const g = window.game;
    const w = g.world;
    const me = w.racers[g.playerId];
    const idx = w.track.pieces.findIndex((q) => (feat === '<' ? q.warp < 0 : q.code === feat));
    for (let k = 0; k < 60 * 90; k++) {
      g.step(1 / 60);
      const pi = me.car.pieceIndex;
      const d = (idx - pi + w.track.pieces.length) % w.track.pieces.length;
      if (k > 60 * 5 && d === 1) return true;
    }
    return false;
  }, feat);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${id}_${feat === '<' ? 'rev' : feat}_${cam}.png` });
  console.log(id, feat, ok);
}
console.log('erros', errs);
await b.close();
