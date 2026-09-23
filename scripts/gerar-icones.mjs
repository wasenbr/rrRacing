// Gera os ícones do web app (PNG) desenhando em canvas no Chrome. Uso: node scripts/gerar-icones.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
const sizes = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, maskable] of sizes) {
  const data = await p.evaluate(([size, maskable]) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const s = size / 512;
    g.scale(s, s);
    // fundo: espaço roxo escuro com brilho
    const bg = g.createRadialGradient(256, 200, 20, 256, 256, 380);
    bg.addColorStop(0, '#5a1e8a');
    bg.addColorStop(0.55, '#24103e');
    bg.addColorStop(1, '#07030e');
    g.fillStyle = bg;
    if (maskable) g.fillRect(0, 0, 512, 512);
    else {
      g.beginPath();
      g.roundRect(8, 8, 496, 496, 96);
      g.fill();
    }
    // estrelas
    g.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 97) % 512, (i * 211) % 300, 3, 3);
    // chamas na base
    const fl = g.createLinearGradient(0, 512, 0, 250);
    fl.addColorStop(0, '#ff3a0a');
    fl.addColorStop(0.6, '#ffb020');
    fl.addColorStop(1, 'rgba(255,224,112,0)');
    g.fillStyle = fl;
    g.beginPath();
    g.moveTo(0, 512);
    const peaks = [[40, 330], [90, 400], [140, 300], [200, 390], [256, 280], [312, 390], [372, 300], [422, 400], [472, 330], [512, 400]];
    g.lineTo(0, 420);
    let x0 = 0;
    for (const [x, y] of peaks) {
      g.quadraticCurveTo((x0 + x) / 2, 470, x, y);
      x0 = x;
    }
    g.lineTo(512, 512);
    g.closePath();
    g.fill();
    // roda estilizada
    g.save();
    g.translate(256, 250);
    g.fillStyle = '#141418';
    g.beginPath();
    g.arc(0, 0, 150, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a2a30';
    for (let k = 0; k < 16; k++) {
      g.rotate(Math.PI / 8);
      g.fillRect(-14, -160, 28, 26);
    }
    g.fillStyle = '#9aa0aa';
    g.beginPath();
    g.arc(0, 0, 92, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a5e68';
    for (let k = 0; k < 5; k++) {
      g.rotate((Math.PI * 2) / 5);
      g.beginPath();
      g.moveTo(-10, 0);
      g.lineTo(-22, -80);
      g.lineTo(22, -80);
      g.lineTo(10, 0);
      g.fill();
    }
    g.restore();
    // "RR" em fogo, inclinado
    g.save();
    g.translate(256, 262);
    g.transform(1, 0, -0.18, 1, 0, 0);
    g.font = '900 190px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 22;
    g.strokeStyle = '#1a0402';
    g.strokeText('RR', 0, 0);
    const t = g.createLinearGradient(0, -90, 0, 90);
    t.addColorStop(0, '#fff6c0');
    t.addColorStop(0.4, '#ffd84a');
    t.addColorStop(0.7, '#ff8a1a');
    t.addColorStop(1, '#c02a0a');
    g.fillStyle = t;
    g.fillText('RR', 0, 0);
    g.restore();
    // faixa "3D"
    g.save();
    g.translate(380, 400);
    g.rotate(-0.2);
    g.fillStyle = '#5cff5c';
    g.strokeStyle = '#042a0a';
    g.lineWidth = 10;
    g.font = '900 96px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.strokeText('3D', 0, 0);
    g.fillText('3D', 0, 0);
    g.restore();
    return c.toDataURL('image/png');
  }, [size, maskable]);
  fs.writeFileSync(`public/icons/${name}`, Buffer.from(data.split(',')[1], 'base64'));
}
await b.close();
console.log('ícones em public/icons');
