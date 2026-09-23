export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Normaliza um ângulo para o intervalo (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/**
 * Convenção de eixos (igual ao Three.js, y para cima):
 * heading = 0 aponta para +z; heading crescente gira para a esquerda do piloto.
 */
export function forwardX(heading: number): number {
  return Math.sin(heading);
}
export function forwardZ(heading: number): number {
  return Math.cos(heading);
}
export function leftX(heading: number): number {
  return Math.cos(heading);
}
export function leftZ(heading: number): number {
  return -Math.sin(heading);
}

/** Gerador pseudoaleatório determinístico (mulberry32) — importante para replays e online. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
