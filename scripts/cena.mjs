// Capturas rápidas da cena de corrida (para ajustar o visual). Uso: node scripts/cena.mjs <pasta> [pista:carro:camera ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = process.argv[2] ?? 'cena';
const list = process.argv.slice(3).length ? process.argv.slice(3) : ['chem6-1:havac:iso', 'drakonis-2:marauder:chase', 'bogmire-1:battletrak:iso'];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.routeWebSocket(/.*/, () => {});
p.on('pageerror', (e) => console.log('ERR', String(e)));
await p.goto('http://localhost:5173/?autopilot&laps=3&q=alto', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.game, null, { timeout: 180000 });
await p.waitForTimeout(2000);
for (const item of list) {
  const [trackId, vehicleId, cam] = item.split(':');
  await p.evaluate(([trackId, vehicleId, cam]) => {
    const a = window.game.menuActions();
    a.setCamera(cam);
    a.quickRace({ trackId, vehicleId, color: 0x2f7bff, difficulty: 'normal' });
  }, [trackId, vehicleId, cam]);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { for (let k = 0; k < 60 * 8; k++) window.game.step(1 / 60); });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/${trackId}_${vehicleId}_${cam}.png` });
}
await b.close();
