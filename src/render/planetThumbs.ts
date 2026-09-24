import * as THREE from 'three';
import type { ThemeId } from '../sim/track';
import { canvasToUrl, thumbRenderer } from './thumbnails';

/**
 * Miniaturas dos 6 planetas: esfera 3D com textura procedural coerente com o tema, relevo,
 * luzes/lava no lado escuro, nuvens, atmosfera na cor do planeta e luz de terminador dramática,
 * sobre um fundo de espaço com estrelas. Usa o renderizador compartilhado das miniaturas e guarda
 * o resultado em cache (object URL) por planeta e tamanho; as texturas ficam em cache por planeta.
 */

type RGB = [number, number, number];

interface PlanetLook {
  /** cor da atmosfera / halo */
  atmo: number;
  /** tom do nebuloso ao fundo */
  nebula: string;
  /** inclinação do eixo e giro (para variar os quadros) */
  tilt: number;
  spin: number;
  /** relevo (bump) */
  bump: number;
  roughness: number;
  /** nuvens: cor e cobertura (0 = sem nuvens) */
  clouds?: { color: number; cover: number; opacity: number };
  /** anel (poeira/gelo) */
  ring?: { color: number; opacity: number };
  /** pinta um pixel: n = ruído 0..1, r = ruído "de cristas" 0..1, p = ponto na esfera; devolve cor e brilho próprio */
  paint(n: number, r: number, d: number, p: THREE.Vector3, out: { c: RGB; e: RGB; h: number }): void;
  /** crateras (New Mojave, Nho) */
  craters?: number;
}

/* ------------------------------------------------------------------ */
/* Ruído 3D (valor) — sem emendas, amostrado direto na esfera            */
/* ------------------------------------------------------------------ */

function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const v = (x: number, y: number, z: number) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const noise = (x: number, y: number, z: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(v(xi, yi, zi), v(xi + 1, yi, zi), xf), l(v(xi, yi + 1, zi), v(xi + 1, yi + 1, zi), xf), yf),
      l(l(v(xi, yi, zi + 1), v(xi + 1, yi, zi + 1), xf), l(v(xi, yi + 1, zi + 1), v(xi + 1, yi + 1, zi + 1), xf), yf),
      zf,
    );
  };
  const fbm = (x: number, y: number, z: number, oct = 5): number => {
    let a = 0.5, f = 1, t = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      t += a * noise(x * f, y * f, z * f);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return t / n;
  };
  /** cristas: 1 perto das "linhas" do ruído (rachaduras, veias, rios de lava) */
  const ridge = (x: number, y: number, z: number, oct = 4): number => {
    let a = 0.5, f = 1, t = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      t += a * (1 - Math.abs(noise(x * f, y * f, z * f) * 2 - 1));
      n += a;
      a *= 0.5;
      f *= 2.1;
    }
    return t / n;
  };
  return { fbm, ridge, rnd };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = sat((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hexRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** rampa de cores em pontos 0..1 */
function ramp(stops: [number, string][]): (t: number) => RGB {
  const s = stops.map(([o, c]) => [o, hexRgb(c)] as [number, RGB]);
  return (t: number) => {
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) return mix(s[i - 1][1], s[i][1], (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0]));
    return s[s.length - 1][1];
  };
}
const BLACK: RGB = [0, 0, 0];

/* ------------------------------------------------------------------ */
/* Identidade de cada planeta                                           */
/* ------------------------------------------------------------------ */

const chemLand = ramp([[0, '#2a1208'], [0.35, '#6a2c10'], [0.6, '#a84a18'], [0.85, '#d0782a'], [1, '#e8a050']]);
const drakBase = ramp([[0, '#140a26'], [0.4, '#3a1a5e'], [0.7, '#62309a'], [1, '#9458d0']]);
const bogSea = ramp([[0, '#04124a'], [0.6, '#0a2a86'], [1, '#1a52b8']]);
const bogLand = ramp([[0, '#6a4a22'], [0.3, '#4a6a22'], [0.7, '#2a5a1c'], [1, '#6a5a3a']]);
const mojave = ramp([[0, '#6a2a0c'], [0.35, '#a8501a'], [0.6, '#d8802a'], [0.85, '#eca858'], [1, '#f6d09a']]);
const nhoIce = ramp([[0, '#3a6aa8'], [0.35, '#8ab4e0'], [0.65, '#d4e4f6'], [1, '#f6faff']]);
const crust = ramp([[0, '#0c0404'], [0.5, '#2a0c08'], [1, '#4a1a10']]);
const lava = ramp([[0, '#8a1000'], [0.5, '#ff3a00'], [0.8, '#ff8a10'], [1, '#ffe070']]);

const LOOKS: Record<ThemeId, PlanetLook> = {
  // mundo químico: terra ferrugem, lagos de lodo ocre-esverdeado brilhante, luzes de refinaria
  chem6: {
    atmo: 0xff9a3a, nebula: '#4a1c08', tilt: 0.35, spin: 0.6, bump: 2.2, roughness: 0.85,
    clouds: { color: 0xe0c070, cover: 0.62, opacity: 0.45 },
    paint(n, r, d, _p, o) {
      const lake = smooth(0.43, 0.4, n);
      o.c = mix(chemLand(sat((n - 0.3) * 2.2 + r * 0.15)), hexRgb('#b8b020'), lake * 0.9);
      o.c = mix(o.c, hexRgb('#3a1a0a'), smooth(0.8, 0.95, r) * (1 - lake) * 0.7);
      const lights = d > 0.965 && lake < 0.5 ? 1 : 0;
      o.e = mix(mix(BLACK, [90, 90, 10], lake * 0.6), [255, 150, 60], lights);
      o.h = lake > 0.5 ? 0.35 : n;
    },
  },
  // biomecânico: roxo escuro com veias brilhantes e focos verdes
  drakonis: {
    atmo: 0xa050ff, nebula: '#2a0a4a', tilt: -0.3, spin: 2.1, bump: 3, roughness: 0.55,
    paint(n, r, d, _p, o) {
      const vein = smooth(0.8, 0.93, r);
      const pool = smooth(0.3, 0.27, n) * smooth(0.6, 0.75, r);
      o.c = mix(drakBase(n * 1.3 - 0.1), hexRgb('#c080ff'), vein * 0.75);
      o.c = mix(o.c, hexRgb('#2a6a20'), pool * 0.8);
      o.e = mix(BLACK, [170, 80, 255], vein * 0.7);
      o.e = mix(o.e, [70, 220, 40], pool * 0.7);
      if (d > 0.97) o.e = [110, 255, 70];
      o.h = n * 0.6 + r * 0.4;
    },
  },
  // oceano azul com ilhas de terra e mato
  bogmire: {
    atmo: 0x60a8ff, nebula: '#081a44', tilt: 0.4, spin: 4.0, bump: 1.6, roughness: 0.4,
    clouds: { color: 0xffffff, cover: 0.58, opacity: 0.8 },
    paint(n, r, _d, _p, o) {
      const land = smooth(0.54, 0.56, n);
      const shore = smooth(0.5, 0.54, n) * (1 - land);
      o.c = mix(bogSea(sat(n * 1.6)), bogLand(sat((n - 0.55) * 4 + r * 0.2)), land);
      o.c = mix(o.c, hexRgb('#2a7ab8'), shore * 0.6);
      o.e = BLACK;
      o.h = land ? 0.4 + (n - 0.55) * 2 : 0.3;
    },
  },
  // deserto laranja com crateras e cânions
  newmojave: {
    atmo: 0xffb060, nebula: '#3a1a08', tilt: -0.2, spin: 1.2, bump: 3.5, roughness: 0.95, craters: 26,
    ring: { color: 0xd8a070, opacity: 0.5 },
    paint(n, r, _d, _p, o) {
      o.c = mix(mojave(sat(n * 1.5 - 0.2)), hexRgb('#5a2208'), smooth(0.82, 0.95, r) * 0.8);
      o.e = BLACK;
      o.h = n - smooth(0.82, 0.95, r) * 0.25;
    },
  },
  // gelo e neve azulados, fendas escuras, calotas brancas
  nho: {
    atmo: 0x9ad0ff, nebula: '#0a1a3a', tilt: 0.5, spin: 3.0, bump: 2, roughness: 0.3, craters: 10,
    clouds: { color: 0xeaf4ff, cover: 0.64, opacity: 0.55 },
    paint(n, r, _d, p, o) {
      const pole = smooth(0.62, 0.8, Math.abs(p.y));
      o.c = mix(nhoIce(sat(n * 1.7 - 0.25)), hexRgb('#1a3a78'), smooth(0.84, 0.95, r) * 0.8);
      o.c = mix(o.c, [250, 252, 255], pole);
      o.e = mix(BLACK, [20, 60, 110], smooth(0.84, 0.95, r) * 0.6);
      o.h = n;
    },
  },
  // crosta escura com rios e mares de lava brilhante
  inferno: {
    atmo: 0xff4a10, nebula: '#3a0604', tilt: 0.25, spin: 5.2, bump: 3, roughness: 0.9,
    paint(n, r, _d, _p, o) {
      const sea = smooth(0.34, 0.3, n);
      const crack = Math.max(smooth(0.78, 0.92, r) * (0.55 + n * 0.6), sea);
      const heat = sat(crack * (0.7 + n * 0.6));
      o.c = mix(crust(sat(n * 1.4)), lava(heat), crack);
      o.e = mix(BLACK, lava(heat), crack);
      o.h = 1 - crack * 0.6 + n * 0.3;
    },
  },
};

/* ------------------------------------------------------------------ */
/* Texturas (cor, brilho próprio, relevo e nuvens)                      */
/* ------------------------------------------------------------------ */

interface PlanetTextures {
  map: THREE.Texture;
  emissive: THREE.Texture;
  bump: THREE.Texture;
  clouds: THREE.Texture | null;
}
const texCache = new Map<ThemeId, PlanetTextures>();

function canvasTex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function planetTextures(id: ThemeId): PlanetTextures {
  const hit = texCache.get(id);
  if (hit) return hit;
  const look = LOOKS[id];
  const W = 384, H = 192;
  const seed = [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 2147483647, 17) || 1;
  const { fbm, ridge, rnd } = makeNoise(seed);
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    return { c, g, img: g.createImageData(W, H) };
  };
  const col = mk(), emi = mk(), bmp = mk();
  const cld = look.clouds ? mk() : null;
  // crateras: centros aleatórios na esfera
  const craters: { p: THREE.Vector3; r: number }[] = [];
  for (let i = 0; i < (look.craters ?? 0); i++) {
    const p = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    craters.push({ p, r: 0.04 + Math.pow(rnd(), 2) * 0.16 });
  }
  const out = { c: BLACK, e: BLACK, h: 0 };
  const p = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2;
      // mesma convenção de UV da SphereGeometry do three
      p.set(-Math.cos(lon) * cl, sl, Math.sin(lon) * cl);
      const s = 2.2;
      // distorção de domínio: formas mais orgânicas
      const wx = fbm(p.x * 1.3 + 5, p.y * 1.3, p.z * 1.3, 3) - 0.5;
      const wy = fbm(p.x * 1.3, p.y * 1.3 + 9, p.z * 1.3, 3) - 0.5;
      const qx = p.x * s + wx * 1.6, qy = p.y * s + wy * 1.6, qz = p.z * s;
      const n = fbm(qx, qy, qz, 5);
      const r = ridge(qx * 1.6 + 3, qy * 1.6, qz * 1.6, 4);
      const d = fbm(p.x * 30, p.y * 30, p.z * 30, 1);
      look.paint(n, r, d, p, out);
      let c = out.c, h = out.h;
      for (const k of craters) {
        const dist = Math.acos(Math.min(1, p.dot(k.p))) / k.r;
        if (dist < 1.25) {
          const bowl = smooth(1, 0.55, dist);
          const rim = Math.exp(-Math.pow((dist - 1) / 0.12, 2));
          c = mix(c, mix(c, BLACK, 0.35), bowl * 0.8);
          c = mix(c, [255, 240, 220], rim * 0.25);
          h = h - bowl * 0.35 + rim * 0.25;
        }
      }
      const i = (y * W + x) * 4;
      col.img.data.set([c[0], c[1], c[2], 255], i);
      emi.img.data.set([out.e[0], out.e[1], out.e[2], 255], i);
      const hv = Math.round(sat(h) * 255);
      bmp.img.data.set([hv, hv, hv, 255], i);
      if (cld && look.clouds) {
        const cn = fbm(p.x * 3 + 20 + wx * 2, p.y * 7 + wy, p.z * 3, 5);
        const a = smooth(look.clouds.cover, look.clouds.cover + 0.14, cn);
        const v = Math.round(a * 255);
        cld.img.data.set([v, v, v, 255], i);
      }
    }
  }
  for (const t of [col, emi, bmp, cld]) t?.g.putImageData(t.img, 0, 0);
  const tex: PlanetTextures = {
    map: canvasTex(col.c, true),
    emissive: canvasTex(emi.c, true),
    bump: canvasTex(bmp.c, false),
    clouds: cld ? canvasTex(cld.c, false) : null,
  };
  texCache.set(id, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Cena                                                                 */
/* ------------------------------------------------------------------ */

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let sun: THREE.DirectionalLight | null = null;
const SUN_DIR = new THREE.Vector3(1, 0.42, 0.62).normalize();

function setupScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  if (!scene || !camera) {
    scene = new THREE.Scene();
    sun = new THREE.DirectionalLight(0xfff0e0, 3.4);
    sun.position.copy(SUN_DIR).multiplyScalar(10);
    scene.add(sun, new THREE.AmbientLight(0x404a70, 0.06));
    camera = new THREE.PerspectiveCamera(24, 1, 0.5, 50);
    camera.position.set(0, 0, 6.6);
    camera.lookAt(0, 0, 0);
  }
  return { scene, camera };
}

/** Brilho de atmosfera (fresnel), mais forte no lado iluminado, com um fio no lado escuro. */
function atmosphereMaterial(color: number, back: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uSun: { value: SUN_DIR.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = normalize(mat3(modelMatrix) * normal);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-(viewMatrix * wp).xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: back
      ? /* glsl */ `
      uniform vec3 uColor; uniform vec3 uSun;
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() {
        // halo por fora do disco: forte rente à borda e sumindo para fora
        // na casca de fora, -dot vai de 0 (borda da casca) a ~0.42 (borda do planeta)
        float a = pow(clamp(-dot(vN, vV) / 0.42, 0.0, 1.0), 2.4);
        float lit = clamp(dot(normalize(vW), uSun) * 0.8 + 0.45, 0.08, 1.0);
        gl_FragColor = vec4(uColor * (0.6 + lit), clamp(a * lit * 1.6, 0.0, 1.0));
      }`
      : /* glsl */ `
      uniform vec3 uColor; uniform vec3 uSun;
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() {
        float f = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 3.0);
        float lit = clamp(dot(normalize(vW), uSun) * 0.9 + 0.35, 0.05, 1.0);
        gl_FragColor = vec4(uColor * (0.8 + lit), clamp(f * lit * 1.4, 0.0, 0.95));
      }`,
    transparent: true,
    depthWrite: false,
    side: back ? THREE.BackSide : THREE.FrontSide,
  });
}

/** Fundo de espaço: gradiente, nebulosa na cor do planeta, estrelas e halo atrás do planeta. */
function drawSpace(g: CanvasRenderingContext2D, s: number, look: PlanetLook, id: string, cx: number, cy: number, pr: number): void {
  g.fillStyle = '#030208';
  g.fillRect(0, 0, s, s);
  let seed = [...id].reduce((a, ch) => (a * 37 + ch.charCodeAt(0)) % 2147483647, 99) || 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // nebulosa: manchas suaves
  for (let i = 0; i < 5; i++) {
    const x = rnd() * s, y = rnd() * s, r = s * (0.3 + rnd() * 0.4);
    const ng = g.createRadialGradient(x, y, 0, x, y, r);
    ng.addColorStop(0, look.nebula + 'aa');
    ng.addColorStop(1, look.nebula + '00');
    g.fillStyle = ng;
    g.fillRect(0, 0, s, s);
  }
  // estrelas
  const n = Math.round(s * s * 0.0028);
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s;
    const b = Math.pow(rnd(), 3);
    const rad = Math.max(0.5, s / 256) * (0.4 + b * 1.1);
    g.fillStyle = `rgba(${200 + rnd() * 55},${210 + rnd() * 45},255,${0.35 + b * 0.65})`;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // algumas estrelas com brilho em cruz
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const x = rnd() * s, y = rnd() * s * 0.5, r = s * (0.02 + rnd() * 0.03);
    const sg = g.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, 'rgba(255,255,255,0.9)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg;
    g.fillRect(x - r, y - 0.6, r * 2, 1.2);
    g.fillRect(x - 0.6, y - r, 1.2, r * 2);
  }
  // halo atrás do planeta, deslocado para o lado do sol
  const c = new THREE.Color(look.atmo);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const hx = cx + pr * 0.18, hy = cy - pr * 0.08;
  const hg = g.createRadialGradient(hx, hy, pr * 0.9, hx, hy, pr * 1.55);
  hg.addColorStop(0, `rgba(${rgb},0.55)`);
  hg.addColorStop(0.35, `rgba(${rgb},0.16)`);
  hg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = hg;
  g.fillRect(0, 0, s, s);
  g.restore();
}

const urlCache = new Map<string, Promise<string>>();
let composeCanvas: HTMLCanvasElement | null = null;

/** Planetas com miniatura (os temas do jogo). */
export const PLANET_THEMES = Object.keys(LOOKS) as ThemeId[];

/**
 * Imagem (object URL) do planeta `id` (tema), quadrada, com `size` pixels CSS de lado
 * (até 2× em telas retina). Resolve '' se não houver WebGL.
 */
export function planetThumbnail(id: ThemeId, size = 128): Promise<string> {
  const dpr = typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;
  const px = Math.round(size * dpr);
  const key = `${id}|${px}`;
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit;
  const look = LOOKS[id];
  let url: Promise<string> | null = null;
  const group = new THREE.Group();
  try {
    const renderer = thumbRenderer();
    if (!renderer || !look) throw new Error('sem WebGL');
    const { scene, camera } = setupScene();
    // miniaturas pequenas (abas) mostram o planeta maior no quadro
    camera.position.z = size <= 80 ? 5.4 : 6.6;
    const tex = planetTextures(id);
    const seg = px > 160 ? 96 : 64;
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, seg, seg / 2),
      new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 1.2,
        bumpMap: tex.bump,
        bumpScale: look.bump,
        roughness: look.roughness,
        metalness: 0,
      }),
    );
    group.add(globe);
    if (tex.clouds && look.clouds) {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(1.012, seg, seg / 2),
        new THREE.MeshStandardMaterial({ color: look.clouds.color, alphaMap: tex.clouds, transparent: true, opacity: look.clouds.opacity, depthWrite: false, roughness: 1 }),
      );
      clouds.rotation.y = 1.3;
      group.add(clouds);
    }
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1.004, seg, seg / 2), atmosphereMaterial(look.atmo, false));
    const outer = new THREE.Mesh(new THREE.SphereGeometry(1.1, seg, seg / 2), atmosphereMaterial(look.atmo, true));
    group.add(inner, outer);
    if (look.ring) {
      const rg = new THREE.RingGeometry(1.35, 1.9, 96, 1);
      // UV radial: u = 0 na borda de dentro, 1 na de fora (para as faixas do anel)
      const pos = rg.getAttribute('position');
      const uv = rg.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - 1.35) / 0.55, 0.5);
      const ring = new THREE.Mesh(
        rg,
        new THREE.MeshStandardMaterial({ color: look.ring.color, transparent: true, opacity: look.ring.opacity, side: THREE.DoubleSide, depthWrite: false, alphaMap: ringAlpha(), roughness: 1 }),
      );
      ring.rotation.x = -Math.PI / 2 + 0.28;
      ring.rotation.y = 0.2;
      group.add(ring);
    }
    group.rotation.z = look.tilt;
    globe.rotation.y = look.spin;
    scene.add(group);
    renderer.setSize(px, px, false);
    renderer.toneMappingExposure = 1.0;
    renderer.render(scene, camera);
    composeCanvas ??= document.createElement('canvas');
    const cv = composeCanvas;
    cv.width = cv.height = px;
    const g = cv.getContext('2d')!;
    // raio do planeta na tela (câmera fixa)
    const pr = (1 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.sqrt(camera.position.z ** 2 - 1)) * (px / 2);
    drawSpace(g, px, look, id, px / 2, px / 2, pr);
    g.drawImage(renderer.domElement, 0, 0);
    url = canvasToUrl(cv);
  } catch (e) {
    console.warn('miniatura do planeta falhou', id, e);
    url = null;
  } finally {
    scene?.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
  // falha (ex.: contexto WebGL perdido) não fica no cache: a próxima tela tenta de novo
  if (!url) return Promise.resolve('');
  const p = url;
  urlCache.set(key, p);
  void p.then((u) => {
    if (!u && urlCache.get(key) === p) urlCache.delete(key);
  });
  return p;
}

let ringTex: THREE.Texture | null = null;
/** Faixas do anel (listras de poeira), no sentido radial da RingGeometry. */
function ringAlpha(): THREE.Texture {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 4;
  const g = c.getContext('2d')!;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < 256; x++) {
    const edge = Math.min(x, 255 - x) / 40;
    const v = Math.min(1, edge) * (0.35 + rnd() * 0.65);
    g.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`;
    g.fillRect(x, 0, 1, 4);
  }
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}
