import * as THREE from 'three';
import { createRng, leftX, leftZ } from '../sim/math';
import type { CenterPoint } from '../sim/track';
import { fbm, maxAnisotropy, normalMap } from './textures';
import { THEMES, type Theme } from './themes';

/**
 * Peças da pista com a cara de cada planeta do original: piso (grade, hexágonos, terra, escamas),
 * paredões sob a pista (canos, biomecânico, raízes, camuflado, rocha com gelo, demoníaco) e
 * muretas (friso, tubo, cabo com espinhos, para-choque com luzes, gelo, chifres).
 */

export function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

export function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // piso e paredes vistos em ângulo rasante (cockpit): anisotropia máxima + mipmaps trilineares
  t.anisotropy = maxAnisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const hexStr = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Mistura duas cores '#rrggbb' (t = 0 → a, 1 → b). */
function mixHex(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  let out = 0;
  for (const sh of [16, 8, 0]) out |= Math.round(((ca >> sh) & 255) * (1 - t) + ((cb >> sh) & 255) * t) << sh;
  return hexStr(out);
}

/**
 * Cor de fundo do piso: todos os planetas partem de chapa metálica (visual alvo). Drakonis, Nho e
 * Bogmire tinham a cor do planeta chapada e saturada: puxa para aço e deixa o tom para as juntas,
 * a poeira e as manchas (Chem VI e New Mojave ficam como estão, aprovados).
 */
function roadBase(theme: Theme): string {
  if (theme === THEMES.drakonis) return mixHex(theme.road, '#2e2c34', 0.5);
  if (theme.roadPattern === 'ice') return mixHex(theme.road, '#52606e', 0.7);
  if (theme.roadPattern === 'dirt') return mixHex(theme.road, '#4a4640', 0.65);
  return theme.road;
}

/** Hash 0..1 de uma célula inteira (tom por placa, repetível). */
function cellRand(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, seed: number): void {
  const rng = createRng(seed);
  for (let i = 0; i < count; i++) {
    const v = rng();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * alpha})` : `rgba(0,0,0,${(0.5 - v) * alpha})`;
    const s = 1 + rng() * 2;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
}

/** Lê um canvas em tons de cinza como campo de alturas 0..1. */
function heightFrom(c: HTMLCanvasElement): Float32Array {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

/* ------------------------------------------------------------------ */
/* Piso                                                                 */
/* ------------------------------------------------------------------ */

/** Desfoque de caixa separável (raio r, repetição nas bordas), aplicado duas vezes (quase gaussiano). */
function blur(src: Float32Array, n: number, r: number): Float32Array {
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(n * n);
    const out = new Float32Array(n * n);
    const k = 1 / (2 * r + 1);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let acc = 0;
        for (let d = -r; d <= r; d++) acc += a[y * n + ((x + d + n) % n)];
        tmp[y * n + x] = acc * k;
      }
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let acc = 0;
        for (let d = -r; d <= r; d++) acc += tmp[((y + d + n) % n) * n + x];
        out[y * n + x] = acc * k;
      }
    a = out;
  }
  return a;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Metal gasto do visual alvo: poeira/areia (cor do planeta) acumulada ao longo das juntas e numa
 * faixa junto ao meio-fio, manchas irregulares e grão fino; o fundo das juntas continua escuro.
 * Pinta direto no canvas de cor e devolve a quantidade de poeira por pixel (vira rugosidade).
 */
function grime(color: HTMLCanvasElement, height: HTMLCanvasElement, theme: Theme, amount: number): Float32Array {
  const S = color.width;
  const n = height.width;
  const hh = heightFrom(height);
  const groove = new Float32Array(n * n);
  for (let i = 0; i < hh.length; i++) groove[i] = smooth(0.42, 0.22, hh[i]);
  const near = blur(groove, n, 3);
  const patch = fbm(n, 6, 4, 57, 0.55);
  const rng = createRng(29);
  const dc = new THREE.Color(theme.dust);
  const dr = dc.r * 255;
  const dg = dc.g * 255;
  const db = dc.b * 255;
  const ctx = color.getContext('2d')!;
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const out = new Float32Array(S * S);
  const scale = n / S;
  for (let y = 0; y < S; y++) {
    const sy = Math.min(n - 1, Math.floor(y * scale));
    for (let x = 0; x < S; x++) {
      const si = sy * n + Math.min(n - 1, Math.floor(x * scale));
      const side = Math.abs(x / (S - 1) - 0.5) * 2;
      const grain = rng();
      // manchas + juntas + faixa de areia junto às bordas (onde os pneus não varrem)
      let a = (patch[si] - 0.42) * 2.1 + near[si] * 1.7 + smooth(0.7, 0.97, side) * 1.1 + 0.28;
      a = Math.min(1, Math.max(0, a)) * amount;
      a *= 0.45 + 0.55 * grain;
      const i = (y * S + x) * 4;
      const k = 0.7 + grain * 0.55;
      const m = a * 0.8;
      let r = d[i] + (dr * k - d[i]) * m;
      let g = d[i + 1] + (dg * k - d[i + 1]) * m;
      let b = d[i + 2] + (db * k - d[i + 2]) * m;
      // fundo da junta: fenda escura (a poeira fica em volta)
      const dark = 1 - groove[si] * 0.55 * (1 - patch[si] * 0.4);
      r *= dark;
      g *= dark;
      b *= dark;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      out[y * S + x] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Base comum de metal do visual alvo, por baixo do padrão de cada planeta: chapa xadrez (relevo
 * oblíquo miúdo) e, quando `joints` > 0, placas quadradas com juntas escuras em baixo relevo e
 * parafusos. Tudo em tons neutros com pouca opacidade: a cor/identidade do planeta continua mandando.
 * Repete sem emenda (período = divisor de S).
 */
function plateBase(c: CanvasRenderingContext2D, h: CanvasRenderingContext2D, S: number, cells: number, joints: number): void {
  const cell = S / cells;
  // chapa xadrez: barrinhas alternadas "/" e "\"
  const step = cell / 4;
  const n = Math.round(S / step);
  const bar = step * 0.26;
  for (const [ctx, style, w, dx] of [
    [c, 'rgba(0,0,0,0.16)', 2, 0.8],
    [c, 'rgba(255,255,255,0.07)', 1.4, 0],
    [h, '#c8c8c8', 2.4, 0],
  ] as const) {
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const cx = (x + 0.5) * step + dx;
        const cy = (y + 0.5) * step + dx;
        const s = (x + y) % 2 ? 1 : -1;
        ctx.moveTo(cx - bar, cy - bar * s);
        ctx.lineTo(cx + bar, cy + bar * s);
      }
    ctx.stroke();
    ctx.restore();
  }
  if (joints <= 0) return;
  // placas: período de 2 células quando cabe inteiro (placas maiores), senão 1
  const per = cells % 2 === 0 ? cell * 2 : cell;
  const m = Math.round(S / per);
  const lines = (ctx: CanvasRenderingContext2D, off: number) => {
    ctx.beginPath();
    for (let i = 0; i <= m; i++) {
      ctx.moveTo(i * per + off, 0);
      ctx.lineTo(i * per + off, S);
      ctx.moveTo(0, i * per + off);
      ctx.lineTo(S, i * per + off);
    }
    ctx.stroke();
  };
  c.save();
  c.lineWidth = 1.5;
  c.strokeStyle = `rgba(255,255,255,${0.07 * joints})`;
  lines(c, 2);
  c.lineWidth = 2.5;
  c.strokeStyle = `rgba(0,0,0,${0.5 * joints})`;
  lines(c, 0);
  for (let y = 0; y < m; y++)
    for (let x = 0; x < m; x++)
      for (const [bx, by] of [[6, 6], [per - 6, 6], [6, per - 6], [per - 6, per - 6]]) {
        c.fillStyle = `rgba(0,0,0,${0.4 * joints})`;
        c.beginPath();
        c.arc(x * per + bx + 0.6, y * per + by + 0.6, 2, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = `rgba(255,255,255,${0.22 * joints})`;
        c.beginPath();
        c.arc(x * per + bx, y * per + by, 1.4, 0, Math.PI * 2);
        c.fill();
      }
  c.restore();
  h.save();
  h.lineWidth = 5;
  h.strokeStyle = '#6a6a6a';
  lines(h, 0);
  h.restore();
}

function grayCanvasTexture(values: Float32Array, size: number, map: (v: number) => number): THREE.CanvasTexture {
  const c = canvas(size, size, (ctx) => {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < values.length; i++) {
      const g = Math.max(0, Math.min(255, map(values[i]) * 255));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  return tex(c, false);
}

/**
 * Resolução do piso: 2x na qualidade alta (piso nítido de perto na perseguição e no cockpit);
 * celular e placas simples ficam com a textura normal (menos memória e geração mais rápida).
 */
let roadDetail = 1;
export function setRoadDetail(hi: boolean): void {
  roadDetail = hi ? 2 : 1;
}

export function roadDetailHigh(): boolean {
  return roadDetail > 1;
}

export interface RoadMaps {
  map: THREE.Texture;
  emissive: THREE.Texture | null;
  normal: THREE.Texture;
  roughness: number;
  metalness: number;
  /** rugosidade por pixel: poeira fosca, metal limpo mais brilhante (multiplica `roughness` = 1) */
  roughnessMap: THREE.Texture;
}

/**
 * Textura do piso cobrindo a largura inteira (u = lado a lado) e o mesmo comprimento (v).
 * Desenha também um mapa de alturas (canais ficam fundos) que vira normal map.
 */
export function roadMaps(theme: Theme): RoadMaps {
  // desenho em coordenadas lógicas de 512 px; os canvas reais têm `roadDetail` vezes isso
  const S = 512;
  const K = roadDetail;
  const CELLS = theme.cells;
  const cell = S / CELLS;
  const rng = createRng(7);
  const noise = fbm(128, 8, 4, 33);
  const noiseCanvas = canvas(128, 128, (ctx) => {
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < noise.length; i++) {
      const v = noise[i] * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  const edge = S * 0.018;

  // o que é desenhado em cada padrão: cor, linhas (emissivo) e alturas
  const color = canvas(S * K, S * K, (ctx) => {
    ctx.scale(K, K);
    ctx.fillStyle = roadBase(theme);
    ctx.fillRect(0, 0, S, S);
    // variação suave da cor (manchas)
    ctx.globalAlpha = theme.roadPattern === 'dirt' ? 0.35 : 0.18;
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(noiseCanvas, 0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  });
  const glow = canvas(S, S, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
  });
  const HS = (S / 2) * K;
  const height = canvas(HS, HS, (ctx) => {
    ctx.fillStyle = '#b0b0b0';
    ctx.fillRect(0, 0, HS, HS);
  });
  const c = color.getContext('2d')!;
  const g = glow.getContext('2d')!;
  const h = height.getContext('2d')!;
  h.save();
  h.scale(0.5 * K, 0.5 * K);
  // base de placas metálicas comum a todos os planetas: a grade já tem placas, ganha só a chapa
  // xadrez; hexágonos, escamas, gelo e a chapa enlameada de Bogmire ganham também as juntas
  const drak = theme === THEMES.drakonis;
  plateBase(c, h, S, CELLS, theme.roadPattern === 'grid' ? 0 : theme.roadPattern === 'ice' ? 0.55 : theme.roadPattern === 'dirt' ? 0.85 : 0.7);

  if (theme.roadPattern === 'grid') {
    // placas metálicas (alvo visual do usuário): cada placa quadrada é dividida em dois triângulos
    // por uma junta diagonal, com leve variação de tom por triângulo, chanfro e parafusos nos cantos
    for (let y = 0; y < CELLS; y++)
      for (let x = 0; x < CELLS; x++) {
        const px = x * cell;
        const py = y * cell;
        const flip = (x + y) % 2 === 0;
        for (const tri of [0, 1]) {
          const k = 0.86 + rng() * 0.28;
          c.fillStyle = `rgba(${k > 1 ? '255,255,255' : '0,0,0'},${Math.abs(k - 1) * (drak ? 0.7 : 0.45)})`;
          c.beginPath();
          if (flip) {
            if (tri === 0) c.moveTo(px, py), c.lineTo(px + cell, py), c.lineTo(px, py + cell);
            else c.moveTo(px + cell, py), c.lineTo(px + cell, py + cell), c.lineTo(px, py + cell);
          } else if (tri === 0) c.moveTo(px, py), c.lineTo(px + cell, py), c.lineTo(px + cell, py + cell);
          else c.moveTo(px, py), c.lineTo(px + cell, py + cell), c.lineTo(px, py + cell);
          c.closePath();
          c.fill();
        }
        // chanfro: luz em cima/esquerda, sombra embaixo/direita
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(px + 3, py + 3, cell - 6, 2);
        c.fillRect(px + 3, py + 3, 2, cell - 6);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.fillRect(px + 3, py + cell - 5, cell - 6, 2);
        c.fillRect(px + cell - 5, py + 3, 2, cell - 6);
        // parafusos
        for (const [bx, by] of [[7, 7], [cell - 7, 7], [7, cell - 7], [cell - 7, cell - 7]]) {
          c.fillStyle = 'rgba(0,0,0,0.45)';
          c.beginPath();
          c.arc(px + bx + 0.6, py + by + 0.6, 2.2, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = 'rgba(255,255,255,0.28)';
          c.beginPath();
          c.arc(px + bx, py + by, 1.6, 0, Math.PI * 2);
          c.fill();
        }
      }
    // Drakonis: junta roxa apagada (metal escuro com um fio de cor), não uma grade neon chapada
    c.strokeStyle = drak ? mixHex(theme.roadGrid, '#26222c', 0.5) : theme.roadGrid;
    g.strokeStyle = drak ? mixHex(theme.roadGrid, '#000000', 0.55) : theme.roadGrid;
    h.strokeStyle = '#303030';
    for (const ctx of [c, g, h]) {
      ctx.lineWidth = ctx === h ? 6 : ctx === g ? (drak ? 1.2 : 2) : drak ? 2.5 : 3;
      ctx.beginPath();
      for (let i = 0; i <= CELLS; i++) {
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, S);
        ctx.moveTo(0, i * cell);
        ctx.lineTo(S, i * cell);
      }
      ctx.stroke();
      // juntas diagonais: finas e escuras (a grade colorida é só a das placas, como no SNES);
      // sem brilho, para não poluir as pistas neon
      if (ctx === g) continue;
      ctx.save();
      if (ctx === c) {
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2;
      }
      ctx.beginPath();
      for (let y = 0; y < CELLS; y++)
        for (let x = 0; x < CELLS; x++) {
          const px = x * cell;
          const py = y * cell;
          if ((x + y) % 2 === 0) ctx.moveTo(px + cell, py), ctx.lineTo(px, py + cell);
          else ctx.moveTo(px, py), ctx.lineTo(px + cell, py + cell);
        }
      ctx.stroke();
      ctx.restore();
    }
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 1.5;
    c.stroke();
  } else if (theme.roadPattern === 'ice') {
    // gelo de Nho (como no SNES): placas em losango azul-marinho, juntas escuras em relevo e
    // reflexos gelados; o losango repete a cada `cell` nos dois eixos (sem emenda na textura)
    const lines = (ctx: CanvasRenderingContext2D, off: number) => {
      ctx.beginPath();
      for (let k = -CELLS; k <= CELLS * 2; k++) {
        ctx.moveTo(k * cell + off, 0);
        ctx.lineTo(k * cell - S + off, S);
        ctx.moveTo(k * cell + off, 0);
        ctx.lineTo(k * cell + S + off, S);
      }
      ctx.stroke();
    };
    // tom por placa (losango): umas mais claras/foscas de geada, outras mais escuras; o losango
    // de centro (m·cell/2, n·cell/2), m+n ímpar, repete a cada `cell` (hash no índice mod 2·CELLS)
    const wrap = (v: number) => ((v % (2 * CELLS)) + 2 * CELLS) % (2 * CELLS);
    for (let m = -1; m <= CELLS * 2 + 1; m++)
      for (let n = -1; n <= CELLS * 2 + 1; n++) {
        if (((m + n) & 1) === 0) continue;
        const k = cellRand(wrap(m), wrap(n)) - 0.5;
        const cx = (m * cell) / 2;
        const cy = (n * cell) / 2;
        c.fillStyle = k > 0 ? `rgba(200,215,230,${k * 0.32})` : `rgba(0,6,20,${-k * 0.5})`;
        c.beginPath();
        c.moveTo(cx - cell / 2, cy);
        c.lineTo(cx, cy - cell / 2);
        c.lineTo(cx + cell / 2, cy);
        c.lineTo(cx, cy + cell / 2);
        c.closePath();
        c.fill();
      }
    // brilho gelado em manchas diagonais
    for (let i = 0; i < 40; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const grd = c.createRadialGradient(x, y, 0, x, y, 30 + rng() * 50);
      grd.addColorStop(0, `rgba(170,210,255,${0.06 + rng() * 0.08})`);
      grd.addColorStop(1, 'rgba(170,210,255,0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, S, S);
    }
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(170,200,230,0.35)';
    lines(c, 2.5);
    c.lineWidth = 3;
    c.strokeStyle = theme.roadGrid;
    lines(c, 0);
    // fio azul-claro discreto ao lado da junta (a "grade azul" das pistas de Nho no SNES)
    g.lineWidth = 1.2;
    g.strokeStyle = '#2a5a9a';
    lines(g, 2.5);
    h.lineWidth = 7;
    h.strokeStyle = '#303030';
    lines(h, 0);
    // cristais de geada
    for (let i = 0; i < 500; i++) {
      c.fillStyle = `rgba(210,235,255,${0.1 + rng() * 0.25})`;
      c.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
    }
  } else if (theme.roadPattern === 'hex') {
    // colmeia de placas hexagonais (New Mojave)
    const r = cell * 0.62;
    const w = Math.sqrt(3) * r;
    const path = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rr: number) => {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    const rows = Math.ceil(S / (r * 1.5)) + 1;
    const cols = Math.ceil(S / w) + 1;
    for (let row = -1; row <= rows; row++)
      for (let col = -1; col <= cols; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0);
        const cy = row * r * 1.5;
        const k = 0.88 + rng() * 0.24;
        path(c, cx, cy, r - 2);
        c.fillStyle = `rgba(${k > 1 ? '255,255,210' : '0,0,0'},${Math.abs(k - 1) * 0.5})`;
        c.fill();
        c.strokeStyle = theme.roadGrid;
        c.lineWidth = 3;
        c.stroke();
        path(g, cx, cy, r - 2);
        g.strokeStyle = theme.roadGrid;
        g.lineWidth = 2;
        g.stroke();
        path(h, cx, cy, r - 2);
        h.strokeStyle = '#303030';
        h.lineWidth = 6;
        h.stroke();
      }
  } else if (theme.roadPattern === 'scales') {
    // escamas arredondadas (Inferno): fileiras de meias-luas desencontradas
    const sw = cell * 1.1;
    const sh = cell * 0.7;
    for (let row = -1; row < S / sh + 1; row++)
      for (let col = -1; col < S / sw + 1; col++) {
        const cx = col * sw + (row % 2 ? sw / 2 : 0);
        const cy = row * sh;
        const grad = c.createRadialGradient(cx, cy - sh * 0.2, 2, cx, cy, sw * 0.62);
        const k = 0.85 + rng() * 0.3;
        // (brilho baixo: escama negra como no original; antes o piso ficava cinza-claro/rosado)
        grad.addColorStop(0, `rgba(255,255,255,${0.06 * k})`);
        grad.addColorStop(0.7, 'rgba(255,255,255,0.02)');
        grad.addColorStop(1, 'rgba(0,0,0,0.45)');
        c.fillStyle = grad;
        c.beginPath();
        c.ellipse(cx, cy, sw * 0.56, sh * 0.95, 0, 0, Math.PI);
        c.fill();
        c.strokeStyle = theme.roadGrid;
        c.lineWidth = 2.5;
        c.stroke();
        // rejunte vermelho com brilho fraco (emissivo), o calor da lava entre as escamas
        g.strokeStyle = theme.roadGrid;
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(cx, cy, sw * 0.56, sh * 0.95, 0, 0, Math.PI);
        g.stroke();
        const hg = h.createRadialGradient(cx, cy, 2, cx, cy, sw * 0.6);
        hg.addColorStop(0, '#f0f0f0');
        hg.addColorStop(1, '#303030');
        h.fillStyle = hg;
        h.beginPath();
        h.ellipse(cx, cy, sw * 0.56, sh * 0.95, 0, 0, Math.PI);
        h.fill();
      }
    speckle(c, S, S, 3000, 0.2, 4);
  } else {
    // chapa enlameada (Bogmire): placas de metal com lama marrom espalhada (mais nas bordas),
    // respingos, torrões e sulcos de pneus
    const mud = mixHex(theme.road, '#2a1808', 0.35);
    const mr = parseInt(mud.slice(1, 3), 16);
    const mg = parseInt(mud.slice(3, 5), 16);
    const mb = parseInt(mud.slice(5, 7), 16);
    for (let i = 0; i < 90; i++) {
      const x = rng() * S;
      const side = Math.abs(x / S - 0.5) * 2;
      c.fillStyle = `rgba(${mr},${mg},${mb},${(0.12 + rng() * 0.2) * (0.6 + side * 0.8)})`;
      c.beginPath();
      c.ellipse(x, rng() * S, 14 + rng() * 60, 8 + rng() * 34, rng() * 3, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 70; i++) {
      c.fillStyle = rng() > 0.5 ? `rgba(255,200,140,${0.03 + rng() * 0.05})` : `rgba(40,18,4,${0.06 + rng() * 0.1})`;
      c.beginPath();
      c.ellipse(rng() * S, rng() * S, 20 + rng() * 70, 10 + rng() * 40, rng() * 3, 0, Math.PI * 2);
      c.fill();
    }
    speckle(c, S, S, 6000, 0.4, 1);
    for (let i = 0; i < 220; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const r = 1 + rng() * 2.8;
      c.fillStyle = `rgba(${90 + rng() * 50},${60 + rng() * 35},${30 + rng() * 25},0.85)`;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      h.fillStyle = '#e0e0e0';
      h.beginPath();
      h.arc(x, y, r, 0, Math.PI * 2);
      h.fill();
    }
    for (const x of [0.28, 0.36, 0.64, 0.72]) {
      c.fillStyle = 'rgba(30,12,2,0.2)';
      c.fillRect(S * x - 10, 0, 20, S);
      h.fillStyle = '#707070';
      h.fillRect(S * x - 10, 0, 20, S);
    }
  }
  // poeira/areia acumulada nas juntas e perto do meio-fio, grão fino e metal gasto (visual alvo)
  h.restore();
  // pouca poeira (≤ ~15% do piso somando esta camada e a de addRoadDirt): a cor do tema manda
  // (Chem VI preto e vermelho, New Mojave oliva, Nho azul, Inferno escuro); o gelo leva geada
  const dustAmt = theme.roadPattern === 'dirt' ? 0.45 : theme.roadPattern === 'ice' ? 0.4 : drak ? 0.3 : 0.2;
  const rough = grime(color, height, theme, dustAmt);
  h.save();
  h.scale(0.5 * K, 0.5 * K);
  // borda fina contornando a pista (como a linha vermelha de Chem VI)
  c.fillStyle = theme.roadEdge;
  c.fillRect(0, 0, edge, S);
  c.fillRect(S - edge, 0, edge, S);
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(edge, 0, 3, S);
  c.fillRect(S - edge - 3, 0, 3, S);
  if (theme.roadGlow > 0) {
    g.fillStyle = theme.roadEdge;
    g.fillRect(0, 0, edge, S);
    g.fillRect(S - edge, 0, edge, S);
  }
  speckle(c, S, S, 2500, 0.22, 3);
  h.restore();

  const hh = heightFrom(height);
  // grão fino por cima do relevo
  const fine = fbm(HS, 64 * K, 2, 9);
  for (let i = 0; i < hh.length; i++) hh[i] = hh[i] * 0.85 + fine[i] * 0.15;
  const normal = normalMap(hh, HS, (theme.roadPattern === 'dirt' ? 2.8 : 3.2) * K);
  normal.generateMipmaps = true;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.anisotropy = maxAnisotropy;
  // gelo fosco (não espelhado) e chapa com lama (fosca onde tem barro, metal por baixo)
  const roughness = theme.roadPattern === 'ice' ? 0.4 : theme.roadPattern === 'dirt' ? 0.8 : 0.55;
  const metalness = theme.roadPattern === 'dirt' ? 0.25 : theme.roadPattern === 'scales' ? 0.15 : theme.roadPattern === 'ice' ? 0.4 : 0.3;
  const roughMap = grayCanvasTexture(rough, S * K, (d) => (theme.roadPattern === 'dirt' ? 0.55 + d * 0.45 : theme.roadPattern === 'ice' ? 0.35 + d * 0.6 : theme.roadPattern === 'scales' ? 0.78 + d * 0.2 : 0.45 + d * 0.55));
  return { map: tex(color), emissive: theme.roadGlow > 0 ? tex(glow) : null, normal, roughness, metalness, roughnessMap: roughMap };
}

let dirtTex: THREE.DataTexture | null = null;
/** Três ruídos independentes de baixa frequência (R, G, B), repetíveis, para a sujeira do piso. */
function dirtNoise(): THREE.DataTexture {
  if (dirtTex) return dirtTex;
  const n = 128;
  const a = fbm(n, 3, 4, 301, 0.55);
  const b = fbm(n, 5, 4, 419, 0.55);
  const c = fbm(n, 4, 3, 523, 0.6);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = a[i] * 255;
    data[i * 4 + 1] = b[i] * 255;
    data[i * 4 + 2] = c[i] * 255;
    data[i * 4 + 3] = 255;
  }
  dirtTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping;
  dirtTex.magFilter = THREE.LinearFilter;
  dirtTex.minFilter = THREE.LinearMipmapLinearFilter;
  dirtTex.generateMipmaps = true;
  dirtTex.needsUpdate = true;
  return dirtTex;
}

/**
 * Poeira e graxa em escala de mundo sobre as placas (visual alvo): manchas grandes de areia do
 * planeta, placas mais escuras/limpas e borrões de graxa lisos. Multiplica cor e rugosidade, então
 * a repetição da textura do piso some. Custa uma leitura de textura por pixel (serve no celular).
 */
export function addRoadDirt(mat: THREE.MeshStandardMaterial, theme: Theme): void {
  const amount = theme.roadPattern === 'dirt' ? 0.35 : theme.roadPattern === 'ice' ? 0.3 : 0.25;
  const dust = new THREE.Color(theme.dust);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.dirtMap = { value: dirtNoise() };
    sh.uniforms.dirtColor = { value: dust };
    sh.uniforms.dirtAmount = { value: amount };
    sh.vertexShader = 'varying vec2 vDirtPos;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vDirtPos = (modelMatrix * vec4(transformed, 1.0)).xz;',
    );
    sh.fragmentShader = 'uniform sampler2D dirtMap; uniform vec3 dirtColor; uniform float dirtAmount; varying vec2 vDirtPos;\n' + sh.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  vec3 dn = texture2D(dirtMap, vDirtPos * 0.019).rgb;
  float dFine = texture2D(dirtMap, vDirtPos * 0.071 + vec2(0.37, 0.61)).g;
  // areia: manchas grandes (~50 m) recortadas por detalhe médio (~14 m)
  float dirt = smoothstep(0.38, 0.72, dn.r * 0.65 + dFine * 0.5 - 0.08) * dirtAmount;
  // graxa: borrões escuros e lisos onde não há areia
  float grease = smoothstep(0.58, 0.8, dn.b) * (1.0 - dirt) * dirtAmount;
  diffuseColor.rgb *= mix(0.78, 1.1, dn.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, dirtColor * (0.62 + 0.5 * dFine), dirt * 0.85);
  diffuseColor.rgb *= 1.0 - grease * 0.45;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * (1.0 + dirt * 0.45) * (1.0 - grease * 0.4), 0.05, 1.0);`,
      );
  };
  mat.customProgramCacheKey = () => 'road-dirt';
}

/* ------------------------------------------------------------------ */
/* Paredões sob a pista                                                 */
/* ------------------------------------------------------------------ */

/** Metros cobertos por uma repetição da textura da parede (na horizontal e na vertical). */
export const WALL_TILE = 8;

export interface WallMaps {
  map: THREE.Texture;
  normal: THREE.Texture;
  emissive: THREE.Texture | null;
  roughness: number;
  metalness: number;
}

/**
 * Textura da parede: x = ao longo da pista, y = profundidade (topo do canvas = topo da parede).
 * Todas repetem nas duas direções.
 */
export function wallMaps(theme: Theme): WallMaps {
  const S = 256;
  const rng = createRng(19);
  const base = hexStr(theme.skirt);
  const accent = hexStr(theme.wallAccent);
  const color = canvas(S, S, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
  });
  const height = canvas(S, S, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, S, S);
  });
  const glow = canvas(S, S, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
  });
  const c = color.getContext('2d')!;
  const h = height.getContext('2d')!;
  const g = glow.getContext('2d')!;
  let hasGlow = false;
  let roughness = 0.8;
  let metalness = 0.1;
  let strength = 3;

  const vGrad = (ctx: CanvasRenderingContext2D, x: number, w: number, stops: [number, string][]) => {
    const gr = ctx.createLinearGradient(x, 0, x + w, 0);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    ctx.fillStyle = gr;
    ctx.fillRect(x, 0, w, S);
  };

  switch (theme.walls) {
    case 'pipes': {
      // fundo escuro atrás dos canos (os canos em si são geometria de verdade)
      c.fillStyle = '#2a2a30';
      c.fillRect(0, 0, S, S);
      speckle(c, S, S, 3000, 0.25, 2);
      roughness = 0.6;
      metalness = 0.6;
      break;
    }
    case 'biomech': {
      // costelas verticais orgânicas, com gomos e tubos (Drakonis)
      c.fillStyle = '#06101c';
      c.fillRect(0, 0, S, S);
      const n = 11;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * S + rng() * 6;
        const w = S / n - 3;
        vGrad(c, x, w, [[0, 'rgba(0,0,0,0.9)'], [0.35, base], [0.55, '#8fd0ff'], [0.7, base], [1, 'rgba(0,0,0,0.9)']]);
        vGrad(h, x, w, [[0, '#101010'], [0.5, '#f0f0f0'], [1, '#101010']]);
        // gomos (vértebras) ao longo da costela
        for (let y = rng() * 20; y < S; y += 14 + rng() * 10) {
          c.fillStyle = 'rgba(0,0,0,0.55)';
          c.fillRect(x, y, w, 3);
          h.fillStyle = '#202020';
          h.fillRect(x, y, w, 3);
        }
      }
      // tubos horizontais e olhos vermelhos
      for (const y of [S * 0.18, S * 0.62]) {
        const gr = c.createLinearGradient(0, y - 7, 0, y + 7);
        gr.addColorStop(0, '#04080e');
        gr.addColorStop(0.5, '#5ab0e8');
        gr.addColorStop(1, '#04080e');
        c.fillStyle = gr;
        c.fillRect(0, y - 7, S, 14);
        const hg = h.createLinearGradient(0, y - 7, 0, y + 7);
        hg.addColorStop(0, '#202020');
        hg.addColorStop(0.5, '#ffffff');
        hg.addColorStop(1, '#202020');
        h.fillStyle = hg;
        h.fillRect(0, y - 7, S, 14);
      }
      for (const [x, y] of [[S * 0.27, S * 0.4], [S * 0.77, S * 0.84]]) {
        const eg = c.createRadialGradient(x, y, 1, x, y, 10);
        eg.addColorStop(0, '#ffd0c0');
        eg.addColorStop(0.35, accent);
        eg.addColorStop(1, '#200000');
        c.fillStyle = eg;
        c.beginPath();
        c.ellipse(x, y, 9, 12, 0, 0, Math.PI * 2);
        c.fill();
        g.fillStyle = accent;
        g.beginPath();
        g.ellipse(x, y, 6, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
      hasGlow = true;
      roughness = 0.35;
      metalness = 0.3;
      strength = 5;
      break;
    }
    case 'roots': {
      // raízes/troncos entrelaçados descendo (Bogmire)
      c.fillStyle = '#2a1608';
      c.fillRect(0, 0, S, S);
      for (let i = 0; i < 26; i++) {
        let x = rng() * S;
        const w = 6 + rng() * 14;
        const k = 0.7 + rng() * 0.6;
        c.strokeStyle = `rgb(${Math.round(110 * k)},${Math.round(62 * k)},${Math.round(26 * k)})`;
        c.lineWidth = w;
        h.strokeStyle = `rgb(${Math.round(180 * k)},${Math.round(180 * k)},${Math.round(180 * k)})`;
        h.lineWidth = w;
        c.beginPath();
        h.beginPath();
        c.moveTo(x, -10);
        h.moveTo(x, -10);
        for (let y = 0; y <= S + 10; y += 16) {
          x += (rng() - 0.5) * 10;
          c.lineTo(x, y);
          h.lineTo(x, y);
        }
        c.stroke();
        h.stroke();
      }
      // fendas escuras
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 2;
      for (let i = 0; i < 40; i++) {
        const x = rng() * S;
        const y = rng() * S;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (rng() - 0.5) * 6, y + 10 + rng() * 20);
        c.stroke();
      }
      speckle(c, S, S, 3000, 0.3, 5);
      roughness = 0.95;
      strength = 4;
      break;
    }
    case 'riveted': {
      // New Mojave (mapas do original): chapas verde-oliva escuras com manchas de camuflagem
      // (verde-musgo e marrom), divisões rebaixadas e rebites; as tachas amarelas ficam na mureta
      const noise = fbm(S, 8, 4, 71, 0.55);
      const blot = fbm(S, 5, 3, 113, 0.6);
      const img = c.getImageData(0, 0, S, S);
      const olive = new THREE.Color(base);
      const moss = [74, 92, 34];
      const brown = [58, 42, 20];
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * 4;
          const v = noise[y * S + x];
          const w = blot[y * S + x];
          const k = 0.8 + v * 0.35;
          let r = olive.r * 255 * k;
          let g2 = olive.g * 255 * k;
          let b2 = olive.b * 255 * k;
          // manchas de bordas duras (camuflagem), como os blocos do mapa
          if (w > 0.6) [r, g2, b2] = moss.map((m) => m * k);
          else if (w < 0.36) [r, g2, b2] = brown.map((m) => m * k);
          img.data[i] = Math.min(255, r);
          img.data[i + 1] = Math.min(255, g2);
          img.data[i + 2] = Math.min(255, b2);
          img.data[i + 3] = 255;
        }
      c.putImageData(img, 0, 0);
      // sujeira escura escorrendo das juntas
      for (let i = 0; i < 30; i++) {
        const x = rng() * S;
        const y = rng() * S;
        const gr = c.createLinearGradient(0, y, 0, y + 30 + rng() * 40);
        gr.addColorStop(0, 'rgba(10,14,4,0.5)');
        gr.addColorStop(1, 'rgba(10,14,4,0)');
        c.fillStyle = gr;
        c.fillRect(x, y, 2 + rng() * 3, 70);
      }
      // divisões dos painéis: fenda escura com borda clara (chanfro)
      for (const ctx of [c, h]) {
        ctx.strokeStyle = ctx === c ? 'rgba(8,10,2,0.85)' : '#202020';
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let x = 0; x <= S; x += S / 4) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, S);
        }
        for (const y of [0, S / 2, S]) {
          ctx.moveTo(0, y);
          ctx.lineTo(S, y);
        }
        ctx.stroke();
      }
      c.strokeStyle = 'rgba(200,220,150,0.18)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let x = 3; x <= S; x += S / 4) {
        c.moveTo(x, 0);
        c.lineTo(x, S);
      }
      c.stroke();
      // rebites: fileiras junto às divisões
      for (let py = 0; py < S; py += S / 2)
        for (let px = 0; px < S; px += S / 4)
          for (const [rx, ry] of [
            ...[0.12, 0.37, 0.63, 0.88].map((t) => [8, t * (S / 2)]),
            ...[0.12, 0.37, 0.63, 0.88].map((t) => [S / 4 - 8, t * (S / 2)]),
            ...[0.25, 0.5, 0.75].map((t) => [t * (S / 4), 8]),
            ...[0.25, 0.5, 0.75].map((t) => [t * (S / 4), S / 2 - 8]),
          ]) {
            const x = px + rx;
            const y = py + ry;
            c.fillStyle = 'rgba(0,0,0,0.45)';
            c.beginPath();
            c.arc(x + 1, y + 1.2, 3, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#7a8a4a';
            c.beginPath();
            c.arc(x, y, 2.6, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = 'rgba(230,240,190,0.6)';
            c.beginPath();
            c.arc(x - 0.8, y - 0.8, 1, 0, Math.PI * 2);
            c.fill();
            const hg = h.createRadialGradient(x, y, 0, x, y, 3.2);
            hg.addColorStop(0, '#ffffff');
            hg.addColorStop(1, '#808080');
            h.fillStyle = hg;
            h.beginPath();
            h.arc(x, y, 3.2, 0, Math.PI * 2);
            h.fill();
          }
      speckle(c, S, S, 3000, 0.22, 6);
      roughness = 0.62;
      metalness = 0.45;
      strength = 4;
      break;
    }
    case 'icerock': {
      // rocha escura em estratos horizontais (Nho); os pilares azuis são geometria
      for (let y = 0; y < S; ) {
        const hgt = 3 + rng() * 9;
        const k = 0.6 + rng() * 0.8;
        c.fillStyle = `rgb(${Math.round(34 * k)},${Math.round(36 * k)},${Math.round(44 * k)})`;
        c.fillRect(0, y, S, hgt);
        h.fillStyle = `rgb(${Math.round(128 * k)},${Math.round(128 * k)},${Math.round(128 * k)})`;
        h.fillRect(0, y, S, hgt);
        y += hgt;
      }
      speckle(c, S, S, 4000, 0.3, 7);
      roughness = 0.6;
      strength = 3;
      break;
    }
    case 'demonic': {
      // entalhes demoníacos iluminados de baixo pela lava (Inferno)
      c.fillStyle = '#120202';
      c.fillRect(0, 0, S, S);
      // faixa de blocos pretos no topo
      for (let x = 0; x < S; x += 32) {
        c.fillStyle = '#0a0a0c';
        c.fillRect(x + 1, 0, 30, 26);
        c.strokeStyle = accent;
        c.lineWidth = 1.5;
        c.strokeRect(x + 1.5, 1.5, 29, 23);
        h.fillStyle = '#d0d0d0';
        h.fillRect(x + 2, 2, 28, 22);
        g.strokeStyle = '#a02000';
        g.lineWidth = 1;
        g.strokeRect(x + 1.5, 1.5, 29, 23);
      }
      // "costelas"/garras curvas com brilho de lava nas fendas
      for (let i = 0; i < 9; i++) {
        const x = (i / 9) * S + 14;
        const y0 = 34 + rng() * 20;
        const grad = c.createLinearGradient(0, y0, 0, S);
        grad.addColorStop(0, '#2a0604');
        grad.addColorStop(0.6, '#6a1206');
        grad.addColorStop(1, '#ff5a10');
        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(x - 10, S);
        c.quadraticCurveTo(x - 14, y0 + 60, x, y0);
        c.quadraticCurveTo(x + 14, y0 + 60, x + 10, S);
        c.fill();
        h.fillStyle = '#e8e8e8';
        h.beginPath();
        h.moveTo(x - 10, S);
        h.quadraticCurveTo(x - 14, y0 + 60, x, y0);
        h.quadraticCurveTo(x + 14, y0 + 60, x + 10, S);
        h.fill();
        const gg = g.createLinearGradient(0, S * 0.5, 0, S);
        gg.addColorStop(0, 'rgba(0,0,0,0)');
        gg.addColorStop(1, accent);
        g.fillStyle = gg;
        g.fillRect(x - 22, S * 0.5, 10, S * 0.5);
      }
      hasGlow = true;
      roughness = 0.5;
      metalness = 0.3;
      strength = 4;
      break;
    }
  }
  const normal = normalMap(heightFrom(height), S, strength);
  return { map: tex(color), normal, emissive: hasGlow ? tex(glow) : null, roughness, metalness };
}

/**
 * Faixa vertical (parede) de um lado da pista, com UV em metros: u ao longo da pista, v pela
 * profundidade a partir do topo (a textura não estica em rampas nem em paredes altas).
 */
export function wallGeometry(pts: CenterPoint[], offset: number, bottom: number, side: 1 | -1): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  pts.forEach((p) => {
    const x = p.x + leftX(p.heading) * offset;
    const z = p.z + leftZ(p.heading) * offset;
    const depth = p.h - bottom;
    pos.push(x, p.h, z, x, bottom, z);
    uv.push(p.dist / WALL_TILE, 1, p.dist / WALL_TILE, 1 - depth / WALL_TILE);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    // face virada para fora da pista
    if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Muretas                                                              */
/* ------------------------------------------------------------------ */

/** Curva fechada deslocada lateralmente da linha central (para tubos e cabos). */
export function edgeCurve(pts: CenterPoint[], offset: number, lift: number): THREE.CatmullRomCurve3 {
  const out: THREE.Vector3[] = [];
  // trecho aberto (pista com vão/cruzamento): a curva não fecha e vai até o último ponto
  const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.01;
  const at = (p: CenterPoint) => new THREE.Vector3(p.x + leftX(p.heading) * offset, p.h + lift, p.z + leftZ(p.heading) * offset);
  for (let i = 0; i < pts.length - 1; i += 2) out.push(at(pts[i]));
  if (!closed) out.push(at(pts[pts.length - 1]));
  return new THREE.CatmullRomCurve3(out, closed, 'centripetal');
}

/** Estrela de espinhos (cabo de Bogmire): esfera com 6 pontas. */
export function spikeStarGeometry(r: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.IcosahedronGeometry(r * 0.45, 0)];
  const dirs = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0],
  ];
  for (const [x, y, z] of dirs) {
    const cone = new THREE.ConeGeometry(r * 0.22, r, 5);
    cone.translate(0, r * 0.7, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z).normalize());
    cone.applyQuaternion(q);
    parts.push(cone);
  }
  return mergeSimple(parts);
}

/** Junta geometrias não indexadas com os mesmos atributos (posição e normal). */
export function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    g.computeVertexNormals();
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

/** Textura metálica do cilindro dos canos de Chem VI (faixas e marcas vermelhas). */
export function pipeTexture(accent: number): THREE.CanvasTexture {
  const S = 128;
  const rng = createRng(4);
  return tex(
    canvas(S, S * 2, (ctx) => {
      const gr = ctx.createLinearGradient(0, 0, S, 0);
      gr.addColorStop(0, '#6a6e76');
      gr.addColorStop(0.3, '#e8ecf2');
      gr.addColorStop(0.55, '#a8acb4');
      gr.addColorStop(1, '#4a4e56');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, S, S * 2);
      // aros e soldas
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (const y of [18, 120, 210]) ctx.fillRect(0, y, S, 4);
      // marcas vermelhas (setas/símbolos) numa face só
      ctx.fillStyle = hexStr(accent);
      ctx.fillRect(S * 0.36, 40, S * 0.18, 30);
      ctx.beginPath();
      ctx.moveTo(S * 0.3, 150);
      ctx.lineTo(S * 0.45, 128);
      ctx.lineTo(S * 0.6, 150);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(S * 0.4, 150, S * 0.1, 24);
      speckle(ctx, S, S * 2, 800, 0.25, Math.floor(rng() * 100));
    }),
  );
}
