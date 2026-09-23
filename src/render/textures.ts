import * as THREE from 'three';
import { createRng } from '../sim/math';

/**
 * Texturas procedurais para materiais realistas: ruído fractal que "fecha" nas bordas
 * (repetição sem emenda) e mapas de relevo (normal maps) calculados a partir da altura.
 */

/** Ruído de valor com repetição perfeita em `period` células. */
function tileNoise(size: number, period: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const grid = new Float32Array(period * period).map(() => rng());
  const out = new Float32Array(size * size);
  const g = (x: number, y: number) => grid[((y % period) + period) % period * period + (((x % period) + period) % period)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  return out;
}

/** Ruído fractal (várias oitavas), valores ~0..1. */
export function fbm(size: number, basePeriod: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise(size, basePeriod << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Normal map a partir de um campo de alturas (com repetição nas bordas). */
export function normalMap(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

/** Textura em tons de cinza (ex.: mapa de rugosidade) a partir de valores 0..1. */
export function grayTexture(values: Float32Array, size: number, map: (v: number) => number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < values.length; i++) {
    const g = Math.max(0, Math.min(255, map(values[i]) * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

/** Textura colorida: cor base modulada por ruído (manchas, variação natural). */
export function tintedTexture(values: Float32Array, size: number, base: THREE.Color, dark: number, light: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const col = base.clone().convertLinearToSRGB();
  for (let i = 0; i < values.length; i++) {
    const k = dark + (light - dark) * values[i];
    img.data[i * 4] = Math.min(255, col.r * k * 255);
    img.data[i * 4 + 1] = Math.min(255, col.g * k * 255);
    img.data[i * 4 + 2] = Math.min(255, col.b * k * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, true);
}

const cache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

/** Relevo fino de asfalto (grãos) com juntas das placas. */
export function asphaltNormal(): THREE.Texture {
  return cached('asphalt-n', () => {
    const size = 256;
    const h = fbm(size, 32, 3, 11, 0.6);
    // sulcos transversais e juntas das placas (a textura cobre 2 placas no comprimento)
    for (let y = 0; y < size; y++) {
      const groove = y % 8 < 2 ? -0.35 : 0;
      for (let x = 0; x < size; x++) h[y * size + x] += groove;
    }
    for (let x = 0; x < size; x++) for (const y of [0, 1, size / 2, size / 2 + 1]) h[y * size + x] -= 0.6;
    return normalMap(h, size, 5);
  });
}

/** Rugosidade do asfalto: manchas de óleo e borracha ficam mais lisas/brilhantes. */
export function asphaltRoughness(): THREE.Texture {
  return cached('asphalt-r', () => grayTexture(fbm(256, 4, 4, 23), 256, (v) => 0.55 + v * 0.45));
}

export function concreteNormal(): THREE.Texture {
  return cached('concrete-n', () => normalMap(fbm(256, 8, 5, 31, 0.55), 256, 3.5));
}

/** Relevo do terreno sólido (areia, rocha, poeira). */
export function terrainNormal(): THREE.Texture {
  return cached('terrain-n', () => normalMap(fbm(256, 4, 5, 41, 0.55), 256, 6));
}

/** Ondulação para água, pântano e lava (repete sem emenda, é rolada no tempo). */
export function rippleNormal(): THREE.Texture {
  return cached('ripple-n', () => {
    const size = 256;
    const h = fbm(size, 8, 4, 53, 0.5);
    // ondas longas que também repetem
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2;
        const v = (y / size) * Math.PI * 2;
        h[y * size + x] += 0.25 * Math.sin(u * 3 + Math.sin(v * 2) * 1.5) + 0.15 * Math.sin(v * 5 + u * 2);
      }
    return normalMap(h, size, 2.5);
  });
}

/** Sombra de contato (mancha radial escura) para colocar sob os carros. */
export function contactShadow(): THREE.Texture {
  return cached('contact', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  });
}

/** Lava: crosta escura com rachaduras incandescentes (cor + emissão). */
export function lavaTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const size = 256;
  const n = fbm(size, 4, 5, 77, 0.55);
  const mk = (f: (v: number) => [number, number, number]) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < n.length; i++) {
      const [r, g, b] = f(n[i]);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, true);
  };
  // rachaduras = faixa estreita em torno do valor médio do ruído
  const crack = (v: number) => Math.max(0, 1 - Math.abs(v - 0.5) * 9);
  return {
    map: mk((v) => {
      const c = crack(v);
      return [40 + c * 200, 18 + c * 60, 12 + c * 10];
    }),
    emissive: mk((v) => {
      const c = Math.pow(crack(v), 1.5);
      return [255 * c, 110 * c, 20 * c];
    }),
  };
}

/** Pedra com cor variada (para rochas e mesetas). */
export function rockTexture(color: number): THREE.Texture {
  return cached(`rock-${color}`, () => tintedTexture(fbm(256, 8, 5, 91, 0.6), 256, new THREE.Color(color), 0.55, 1.35));
}

/** Ruído 3D simples (para deformar geometrias de rocha). */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const h = (a: number, b: number, c: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + seed * 13.13) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Rocha orgânica: icosaedro subdividido e deformado por ruído, com normais suaves. */
export function rockGeometry(radius: number, seed: number, detail = 3): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.clone().normalize();
    const n =
      noise3(d.x * 1.5, d.y * 1.5, d.z * 1.5, seed) * 0.35 +
      noise3(d.x * 4, d.y * 4, d.z * 4, seed + 1) * 0.15 +
      noise3(d.x * 9, d.y * 9, d.z * 9, seed + 2) * 0.06;
    v.multiplyScalar(0.75 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Meseta/rochedo em camadas: cilindro irregular com estratos horizontais. */
export function mesaGeometry(radius: number, height: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius * 0.8, radius, height, 40, 16, false);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const hy = v.y / height + 0.5;
    const r = Math.hypot(v.x, v.z);
    if (r > 0.01) {
      // bordas irregulares e degraus de erosão nas camadas
      const strata = Math.floor(hy * 7) / 7;
      const k = 0.82 + noise3(Math.cos(a) * 2.5, strata * 6, Math.sin(a) * 2.5, seed) * 0.3 + (hy * 7 - Math.floor(hy * 7)) * 0.05;
      v.x *= k;
      v.z *= k;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
    const band = 0.8 + 0.2 * Math.sin(hy * 38 + noise3(a, hy * 5, 0, seed) * 3);
    colors.push(band, band * 0.97, band * 0.93);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
