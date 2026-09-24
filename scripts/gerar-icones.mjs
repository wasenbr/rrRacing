// Gera os ícones do web app (PNG): o Marauder renderizado em 3D (miniatura do jogo, em 3/4) sobre
// fundo de arena com chamas e o logo "ROCK N' ROLL RACING". Quadrado cheio, sem cantos transparentes
// (o sistema aplica a própria máscara), sem halos. Precisa do servidor de desenvolvimento.
// Uso: node scripts/gerar-icones.mjs [url]   (padrão http://localhost:5173/)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const b = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const p = await b.newPage();
await p.routeWebSocket(/.*/, () => {});
await p.goto(base + '?q=baixo', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.game, null, { timeout: 180000 });

// carro 3D do jogo, fundo transparente
const car = await p.evaluate(async () => {
  const m = await import('/src/render/thumbnails.ts');
  return m.carThumbnail('marauder', 0xe02a1a, 640, 'transparent');
});

const sizes = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];
for (const [name, size, maskable] of sizes) {
  const data = await p.evaluate(
    async ([car, size, maskable]) => {
      const img = new Image();
      img.src = car;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.scale(size / 512, size / 512);
      // fundo: arena escura com brilho quente no centro e raios de velocidade
      const bg = g.createRadialGradient(256, 300, 20, 256, 280, 420);
      bg.addColorStop(0, '#6a1a5a');
      bg.addColorStop(0.45, '#2a0c3a');
      bg.addColorStop(1, '#07030e');
      g.fillStyle = bg;
      g.fillRect(0, 0, 512, 512);
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI / 2 + (i - 13) * 0.13;
        const gr = g.createLinearGradient(256, 330, 256 + Math.cos(a) * 520, 330 + Math.sin(a) * 520);
        gr.addColorStop(0, 'rgba(255,90,200,0)');
        gr.addColorStop(1, i % 2 ? 'rgba(80,200,255,0.16)' : 'rgba(255,80,200,0.14)');
        g.strokeStyle = gr;
        g.lineWidth = 3 + (i % 3) * 2;
        g.beginPath();
        g.moveTo(256, 330);
        g.lineTo(256 + Math.cos(a) * 520, 330 + Math.sin(a) * 520);
        g.stroke();
      }
      g.restore();
      // chão de chamas embaixo
      const fl = g.createLinearGradient(0, 512, 0, 300);
      fl.addColorStop(0, '#ff3a0a');
      fl.addColorStop(0.55, 'rgba(255,150,30,0.8)');
      fl.addColorStop(1, 'rgba(255,200,80,0)');
      g.fillStyle = fl;
      g.beginPath();
      g.moveTo(0, 512);
      g.lineTo(0, 430);
      let x0 = 0;
      for (const [x, y] of [[40, 360], [96, 420], [150, 340], [210, 410], [256, 330], [300, 410], [362, 340], [416, 420], [472, 360], [512, 420]]) {
        g.quadraticCurveTo((x0 + x) / 2, 480, x, y);
        x0 = x;
      }
      g.lineTo(512, 512);
      g.closePath();
      g.fill();
      // área útil: no ícone "maskable" tudo cabe no círculo central (80%)
      const k = maskable ? 0.8 : 1;
      g.translate(256, 256);
      g.scale(k, k);
      g.translate(-256, -256);
      // sombra de contato e carro em 3/4
      const sh = g.createRadialGradient(256, 462, 10, 256, 462, 220);
      sh.addColorStop(0, 'rgba(0,0,0,0.75)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.beginPath();
      g.ellipse(256, 462, 220, 40, 0, 0, Math.PI * 2);
      g.fill();
      // recorta a miniatura na caixa do carro (alfa) e encaixa em x 36..476, y 196..474
      const t = document.createElement('canvas');
      t.width = img.width;
      t.height = img.height;
      const tg = t.getContext('2d');
      tg.drawImage(img, 0, 0);
      const px = tg.getImageData(0, 0, t.width, t.height).data;
      let x1 = t.width, y1 = t.height, x2 = 0, y2 = 0;
      for (let y = 0; y < t.height; y++)
        for (let x = 0; x < t.width; x++)
          if (px[(y * t.width + x) * 4 + 3] > 160) {
            x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y);
          }
      const bw = x2 - x1 + 1;
      const bh = y2 - y1 + 1;
      const f = Math.min(440 / bw, 278 / bh);
      g.drawImage(img, x1, y1, bw, bh, 256 - (bw * f) / 2, 474 - bh * f, bw * f, bh * f);
      // logo
      const logo = (text, y, px, fill, stroke, sw) => {
        g.save();
        g.translate(256, y);
        g.transform(1, 0, -0.2, 1, 0, 0);
        g.font = `900 ${px}px Impact, "Arial Black", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = sw;
        g.strokeStyle = stroke;
        g.strokeText(text, 0, 0);
        g.fillStyle = fill;
        g.fillText(text, 0, 0);
        g.restore();
      };
      const chrome = g.createLinearGradient(0, -34, 0, 34);
      chrome.addColorStop(0, '#ffffff');
      chrome.addColorStop(0.45, '#c8d0dc');
      chrome.addColorStop(0.55, '#6a7488');
      chrome.addColorStop(1, '#e8eef6');
      logo("ROCK N' ROLL", 70, 70, chrome, '#10081a', 14);
      const fire = g.createLinearGradient(0, -52, 0, 52);
      fire.addColorStop(0, '#fff6c0');
      fire.addColorStop(0.4, '#ffd84a');
      fire.addColorStop(0.75, '#ff7a1a');
      fire.addColorStop(1, '#c0200a');
      logo('RACING', 148, 112, fire, '#1a0402', 18);
      return c.toDataURL('image/png');
    },
    [car, size, maskable],
  );
  fs.writeFileSync(`public/icons/${name}`, Buffer.from(data.split(',')[1], 'base64'));
}
await b.close();
console.log('ícones em public/icons');
