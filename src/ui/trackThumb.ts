import { Track, type Piece, type TrackDef } from '../sim/track';
import { THEMES, type Theme } from '../render/themes';
import { trackTransform } from './trackMap';

const cache = new Map<string, string>();
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Clareia (k > 1) ou escurece (k < 1) uma cor #rrggbb. */
function tone(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Chão do planeta lá embaixo: cor e textura do terreno do tema (lodo, vazio, oceano, areia, neve, lava). */
function drawGround(ctx: CanvasRenderingContext2D, t: Theme, w: number, h: number, rnd: () => number): void {
  const base = css(t.ground);
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 4, w / 2, h / 2, w * 0.75);
  g.addColorStop(0, tone(base, 1.15));
  g.addColorStop(1, tone(base, 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const blob = (color: string, n: number, r0: number, r1: number, sy = 1) => {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, r0 + rnd() * (r1 - r0), (r0 + rnd() * (r1 - r0)) * sy, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const waves = (color: string, n: number, len: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len / 2, y - 3, x + len, y);
      ctx.stroke();
    }
  };
  switch (t.groundStyle) {
    case 'sludge':
      blob('rgba(60,30,0,0.35)', 14, 6, 16, 0.6);
      waves('rgba(255,220,120,0.35)', 22, 10);
      break;
    case 'void':
      blob('rgba(120,60,200,0.25)', 10, 4, 10, 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 30; i++) ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
      break;
    case 'ocean':
      waves('rgba(140,200,255,0.45)', 34, 9);
      break;
    case 'sand':
      waves('rgba(120,50,0,0.35)', 18, 16);
      blob('rgba(90,40,0,0.3)', 6, 3, 6, 0.6);
      break;
    case 'snow':
      blob('rgba(255,255,255,0.5)', 12, 5, 14, 0.6);
      ctx.fillStyle = '#2a5a3a';
      for (let i = 0; i < 10; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 3, y + 2);
        ctx.lineTo(x - 3, y + 2);
        ctx.fill();
      }
      break;
    case 'lava': {
      ctx.strokeStyle = '#ffb020';
      ctx.shadowColor = '#ff5a00';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 12; i++) {
        let x = rnd() * w;
        let y = rnd() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) ctx.lineTo((x += rnd() * 14 - 7), (y += rnd() * 10 - 5));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      break;
    }
  }
}

/**
 * Miniatura de uma pista em vista aérea com a identidade do planeta: chão do tema lá embaixo,
 * piso e muretas nas cores do tema, trechos altos mais claros, rampas de salto marcadas com
 * setas amarelas, lombadas em laranja e os vãos abertos (sem piso) com faixas de perigo.
 * @returns data URL PNG
 */
export function trackThumbnail(def: TrackDef, width = 200, height = 130): string {
  const key = `${def.id}|${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = THEMES[def.theme] ?? THEMES.chem6;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  let seed = def.id.length * 977 + def.id.charCodeAt(0) * 31 + def.id.charCodeAt(def.id.length - 1);
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  drawGround(ctx, t, width, height, rnd);

  let track: Track;
  try {
    track = new Track(def);
  } catch {
    const u = c.toDataURL();
    cache.set(key, u);
    return u;
  }
  const pad = Math.round(Math.min(width, height) * 0.12);
  const map = trackTransform(track, width, height, pad);
  const w = Math.max(5, Math.min(width, height) * 0.075);
  const hs = track.pieces.map((p) => p.h0 + p.dh / 2);
  const hMin = Math.min(...hs);
  const hMax = Math.max(...hs);
  const lift = (p: Piece) => (hMax > hMin ? (p.h0 + p.dh / 2 - hMin) / (hMax - hMin) : 0);
  const piecePath = (p: Piece, s0 = 0, s1 = p.length) => {
    ctx.beginPath();
    const n = Math.max(2, Math.ceil((s1 - s0) / 2));
    for (let i = 0; i <= n; i++) {
      const pt = track.pointOn(p, s0 + ((s1 - s0) * i) / n);
      const [x, y] = map(pt.x, pt.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  // de baixo para cima: o trecho mais alto (viaduto) passa por cima do mais baixo
  const order = track.pieces.filter((p) => p.code !== 'G').sort((a, b) => lift(a) - lift(b));
  const rail = t.rail[0];
  const accent = t.rail[1];
  // sombra dos blocos elevados
  for (const p of order) {
    ctx.save();
    ctx.translate(0, w * (0.55 + lift(p) * 0.5));
    piecePath(p);
    ctx.lineWidth = w + 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.restore();
  }
  for (const p of order) {
    const k = 0.85 + lift(p) * 0.4;
    // mureta (brilho neon nos planetas de piso luminoso)
    if (t.roadGlow > 0.1) {
      ctx.shadowColor = css(t.glow);
      ctx.shadowBlur = 6;
    }
    piecePath(p);
    ctx.lineWidth = w + 5;
    ctx.strokeStyle = tone(rail, k);
    ctx.stroke();
    ctx.shadowBlur = 0;
    piecePath(p);
    ctx.lineWidth = w + 2.4;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.setLineDash([]);
    // piso com a cor e o desenho (placas/ladrilhos) do tema
    piecePath(p);
    ctx.lineWidth = w;
    ctx.strokeStyle = tone(t.road, k);
    ctx.stroke();
    piecePath(p);
    ctx.lineWidth = w * 0.8;
    ctx.setLineDash([1.2, 2.6]);
    ctx.strokeStyle = t.roadGlow > 0.1 ? t.roadGrid : tone(t.roadGrid, 1);
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
  // marcações: rampas de salto, lombadas e vãos
  const across = (p: Piece, s: number, half: number) => {
    const pt = track.pointOn(p, s);
    const [x, y] = map(pt.x, pt.z);
    const pt2 = track.pointOn(p, Math.min(p.length, s + 1));
    const [x2, y2] = map(pt2.x, pt2.z);
    const len = Math.hypot(x2 - x, y2 - y) || 1;
    const dx = (x2 - x) / len;
    const dy = (y2 - y) / len;
    return { x, y, dx, dy, nx: -dy * half, ny: dx * half };
  };
  for (const p of track.pieces) {
    if (p.code === 'J') {
      // seta amarela apontando para o lado do salto
      const a = across(p, p.length * 0.6, w * 0.5);
      ctx.fillStyle = '#ffd21a';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x + a.dx * w * 0.6, a.y + a.dy * w * 0.6);
      ctx.lineTo(a.x + a.nx - a.dx * w * 0.3, a.y + a.ny - a.dy * w * 0.3);
      ctx.lineTo(a.x - a.nx - a.dx * w * 0.3, a.y - a.ny - a.dy * w * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (p.code === 'B') {
      ctx.strokeStyle = '#ff8a2a';
      ctx.lineWidth = 1.4;
      for (const f of [0.25, 0.5, 0.75]) {
        const a = across(p, p.length * f, w * 0.45);
        ctx.beginPath();
        ctx.moveTo(a.x + a.nx, a.y + a.ny);
        ctx.lineTo(a.x - a.nx, a.y - a.ny);
        ctx.stroke();
      }
    } else if (p.code === 'G') {
      // vão: sem piso; rota do salto tracejada e faixas de perigo nas bordas
      piecePath(p);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of [0.4, p.length - 0.4]) {
        const a = across(p, s, w * 0.62);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffd21a';
        ctx.beginPath();
        ctx.moveTo(a.x + a.nx, a.y + a.ny);
        ctx.lineTo(a.x - a.nx, a.y - a.ny);
        ctx.stroke();
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = '#111';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  // largada quadriculada
  const [sx, sy] = map(track.pieces[0].x0, track.pieces[0].z0);
  const s = Math.max(3, w * 0.35);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = (i + Math.floor(i / 2)) % 2 ? '#111' : '#fff';
    ctx.fillRect(sx - s + (i % 2) * s, sy - s + Math.floor(i / 2) * s, s, s);
  }
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
