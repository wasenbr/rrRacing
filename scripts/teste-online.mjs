// Teste do online com amigos: duas janelas (host e convidado) numa sala real via PeerJS.
// Uso: com `npx vite --port 5199` rodando, `node scripts/teste-online.mjs [pasta-de-saida]`
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:5199/';
const OUT = process.argv[2] ?? '.';
// um navegador por jogador: com a GPU de software, uma janela sozinha já ocupa o processo de GPU
const launch = () => chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const browsers = [];
const errors = [];
const open = async (url, who) => {
  const b = await launch();
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 640, height: 400 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => errors.push(`${who} ${m.type()}: ${m.text().slice(0, 240)}`));
  await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForSelector('.main-buttons, .nick', { timeout: 180000 });
  pages.push(page);
  return page;
};

const pages = [];
const fail = async (e) => {
  console.log('FALHOU:', e.message.split('\n')[0]);
  for (const pg of pages) console.log('---', (await pg.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '?')).replace(/\s+/g, ' '));
  console.log(errors.join('\n'));
  process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);
const host = await open(`${BASE}?laps=1`, 'host');
await host.$eval('[data-act="online"]', (b) => b.click());
await host.fill('.nick', 'Anfitrião');
await host.$eval('[data-act="online-create"]', (b) => b.click());
await host.waitForSelector('.lobby', { timeout: 90000 });
const code = (await host.textContent('.card h2')).replace('SALA', '').trim();
const link = await host.inputValue('.room-link');
console.log('sala', code, link);

const guest = await open(link.replace('?', '?netdebug&'), 'convidado');
await guest.fill('.nick', 'Amigo');
await guest.$eval('[data-act="online-join"]', (b) => b.click());
await guest.waitForSelector('.lobby', { timeout: 90000 });
await host.waitForFunction(() => document.querySelectorAll('.lobby li:not(.empty)').length === 2, null, { timeout: 10000 });
console.log('host vê 2 pilotos');
await host.screenshot({ path: `${OUT}/online-sala-host.png` });
await guest.screenshot({ path: `${OUT}/online-sala-convidado.png` });

await host.$eval('[data-act="online-start"]', (b) => b.click());
await guest.waitForFunction(() => document.querySelector('.overlay')?.style.display === 'none', null, { timeout: 10000 });
console.log('convidado largou');
await host.waitForTimeout(3500);
await host.keyboard.down('ArrowUp');
await guest.keyboard.down('ArrowUp');
// espera o convidado andar (a GPU de software deixa tudo lento)
const kmh = (pg) => pg.evaluate(() => Number(document.body.innerText.match(/(\d+)\s*km\/h/i)?.[1] ?? 0));
const t0 = Date.now();
while (Date.now() - t0 < 180000 && (await kmh(guest)) < 30) await host.waitForTimeout(2000);
console.log('velocímetro: convidado', await kmh(guest), 'km/h · host', await kmh(host), 'km/h', `(${Math.round((Date.now() - t0) / 1000)}s)`);
await host.screenshot({ path: `${OUT}/online-corrida-host.png` });
await guest.screenshot({ path: `${OUT}/online-corrida-convidado.png` });
console.log(errors.length ? `ERROS:\n${errors.join('\n')}` : 'sem erros');
for (const b of browsers) await b.close();
