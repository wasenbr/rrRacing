import * as THREE from 'three';
import { forwardX, forwardZ } from '../sim/math';
import { WEAPONS, type Hazard, type Pickup, type Projectile, type World } from '../sim/world';
import { canvasTexture } from './trackMesh';

/* ------------------------------------------------------------------ */
/* Partículas: dois InstancedMesh (fogo/faíscas aditivos e fumaça)      */
/* ------------------------------------------------------------------ */

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size0: number;
  size1: number;
  c0: THREE.Color;
  c1: THREE.Color;
  gravity: number;
  drag: number;
}

export type ParticleKind = 'fire' | 'smoke' | 'ball';

/**
 * Textura de partícula: mancha suave (fogo), nuvem com bordas irregulares (fumaça) ou labareda
 * encaracolada (bola de fogo das explosões: RGB = tom, miolo claro e bordas escuras/fuliginosas).
 */
function particleTexture(kind: ParticleKind): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    if (kind === 'ball') {
      let seed = 13;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      // vários rolos de chama sobrepostos: clareiam no meio, bordas em tom mais escuro
      for (let i = 0; i < 34; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * 30;
        const x = 64 + Math.cos(a) * d;
        const y = 64 + Math.sin(a) * d;
        const r = 14 + rnd() * 20;
        const v = Math.round(150 + (1 - d / 30) * 105 * rnd());
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
        g.addColorStop(0.6, `rgba(${Math.round(v * 0.6)},${Math.round(v * 0.6)},${Math.round(v * 0.6)},0.3)`);
        g.addColorStop(1, 'rgba(40,40,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
      }
      return;
    }
    if (kind === 'fire') {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return;
    }
    // fumaça: vários "puffs" sobrepostos, mais densos no meio
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * 26;
      const x = 64 + Math.cos(a) * d;
      const y = 64 + Math.sin(a) * d;
      const r = 18 + rnd() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const v = Math.round(200 + rnd() * 55);
      g.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',0.22)');
      g.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const PARTICLE_VS = /* glsl */ `
  attribute float aAlpha;
  attribute float aRot;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(instanceMatrix[0].xyz);
    float cr = cos(aRot);
    float sr = sin(aRot);
    vec2 p = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr);
    c.xy += p * s;
    gl_Position = projectionMatrix * c;
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    // some quando encosta na câmera (explosão colada no cockpit não cobre a tela)
    vAlpha = aAlpha * smoothstep(1.5, 6.0, -c.z);
  }`;

const FIRE_FS = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(vColor * t.a * vAlpha, 1.0);
  }`;

const SMOKE_FS = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * (0.75 + 0.25 * t.r), a);
  }`;

/** Bola de fogo: mistura normal (pode escurecer até a fuligem), tom da textura modula o brilho. */
const BALL_FS = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = min(1.0, t.a * 1.6) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * (0.45 + 0.75 * t.r), a);
  }`;

/**
 * Billboard instanciado: cada partícula é um quadrado virado para a câmera (no vertex shader),
 * com cor e opacidade por instância. A fumaça não é iluminada (não vira "bola facetada").
 */
export function particleMaterial(kind: ParticleKind): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: particleTexture(kind) } },
    vertexShader: PARTICLE_VS,
    fragmentShader: kind === 'fire' ? FIRE_FS : kind === 'ball' ? BALL_FS : SMOKE_FS,
    transparent: true,
    depthWrite: false,
    blending: kind === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Quadrado para billboards instanciados, com opacidade (aAlpha) e giro (aRot) por instância. */
export function billboardGeometry(capacity: number): { geo: THREE.PlaneGeometry; alpha: THREE.InstancedBufferAttribute; rot: THREE.InstancedBufferAttribute } {
  const geo = new THREE.PlaneGeometry(1, 1);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const rot = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  rot.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAlpha', alpha);
  geo.setAttribute('aRot', rot);
  return { geo, alpha, rot };
}

/** fim da bola de fogo: fuligem quase preta */
const SOOT = new THREE.Color(0x0e0a08);

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private items: (Particle & { rot: number; spin: number })[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private alpha: THREE.InstancedBufferAttribute;
  private rot: THREE.InstancedBufferAttribute;

  constructor(
    private capacity: number,
    private kind: ParticleKind,
  ) {
    const { geo, alpha, rot } = billboardGeometry(capacity);
    this.alpha = alpha;
    this.rot = rot;
    this.mesh = new THREE.InstancedMesh(geo, particleMaterial(kind), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = kind === 'fire' ? 3 : kind === 'ball' ? 2.5 : 2;
  }

  /** fração das partículas emitidas (qualidade gráfica) */
  density = 1;

  /** partículas mortas guardadas para reaproveitar (sem lixo para o coletor de memória) */
  private free: (Particle & { rot: number; spin: number })[] = [];

  /** Apaga todas as partículas vivas (troca de corrida). */
  clear(): void {
    for (const p of this.items) this.free.push(p);
    this.items.length = 0;
    this.mesh.count = 0;
  }

  emit(p: Omit<Particle, 'max'>): void {
    if (this.density < 1 && Math.random() > this.density) return;
    const it = this.items.length >= this.capacity ? this.items.shift()! : this.free.pop();
    const item = Object.assign(it ?? ({} as Particle & { rot: number; spin: number }), p);
    item.max = p.life;
    item.rot = Math.random() * Math.PI * 2;
    item.spin = (Math.random() - 0.5) * 1.6;
    this.items.push(item);
  }

  update(dt: number): void {
    // compacta no próprio vetor (antes: um vetor novo por quadro)
    const items = this.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.free.push(p);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      items[n++] = p;
    }
    items.length = n;
    for (let i = 0; i < n; i++) {
      const p = items[i];
      const t = 1 - p.life / p.max;
      // tamanho = diâmetro do billboard (a esfera antiga tinha raio 0,5 × size)
      const size = (p.size0 + (p.size1 - p.size0) * (this.kind === 'ball' ? 1 - (1 - t) * (1 - t) : t)) * (this.kind === 'smoke' ? 1.25 : 1.1);
      this.m.compose(this.p.set(p.x, p.y, p.z), this.q, this.s.setScalar(size));
      this.mesh.setMatrixAt(i, this.m);
      // bola de fogo: três tons (laranja → vermelho → fuligem preta); demais: dois
      if (this.kind === 'ball') {
        if (t < 0.3) this.c.copy(p.c0).lerp(p.c1, t / 0.3);
        else this.c.copy(p.c1).lerp(SOOT, Math.min(1, (t - 0.3) / 0.5));
      } else this.c.copy(p.c0).lerp(p.c1, t);
      this.mesh.setColorAt(i, this.c);
      // entra rápido e some aos poucos
      const fadeIn = Math.min(1, t / (this.kind === 'ball' ? 0.04 : 0.08));
      this.alpha.setX(i, fadeIn * (this.kind === 'smoke' ? 0.62 * (1 - t) : this.kind === 'ball' ? 0.95 * (1 - t * t * t) : 1 - t * t));
      this.rot.setX(i, p.rot);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.rot.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */

function coinTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, '#ffe98a');
    g.addColorStop(1, '#c78a00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#8a5a00';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#7a4a00';
    ctx.font = 'bold 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 64, 70);
  });
}

/**
 * Texturas das poças (geradas uma vez): contorno irregular com gotas soltas em volta, bolhas e
 * menisco na borda. `alpha` recorta a forma, `normal` dá relevo às bolhas/borda (o reflexo do
 * ambiente "quebra" nelas), `detail` é o tom em escala de cinza (tingido pela cor de cada líquido)
 * e `sheen` é o furta-cor do óleo.
 */
function puddleTextures(): { alpha: THREE.CanvasTexture; normal: THREE.CanvasTexture; detail: THREE.CanvasTexture; sheen: THREE.CanvasTexture } {
  const S = 256;
  const C = S / 2;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // contorno: raio médio 0,4 × S com ondulações de várias frequências
  const waves = Array.from({ length: 6 }, (_, i) => ({ k: 2 + i * 2 + Math.floor(rnd() * 2), a: (0.1 / (1 + i * 0.6)) * (0.6 + rnd() * 0.8), p: rnd() * 6.28 }));
  const radius = (a: number) => S * 0.37 * (1 + waves.reduce((s, w) => s + w.a * Math.sin(w.k * a + w.p), 0));
  const drops = Array.from({ length: 7 }, () => {
    const a = rnd() * 6.28;
    const r = radius(a) + 6 + rnd() * 14;
    return { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r, r: 3 + rnd() * 7 };
  });
  const bubbles = Array.from({ length: 16 }, () => {
    const a = rnd() * 6.28;
    const d = Math.sqrt(rnd()) * S * 0.3;
    return { x: C + Math.cos(a) * d, y: C + Math.sin(a) * d, r: 2.5 + rnd() * rnd() * 11 };
  });
  const blob = (ctx: CanvasRenderingContext2D, grow: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r = radius(a) + grow;
      if (i) ctx.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
      else ctx.moveTo(C + r, C);
    }
    ctx.closePath();
    ctx.fill();
    for (const d of drops) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, Math.max(0.5, d.r + grow * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  // altura: platô com borda arredondada (menisco) + domos das bolhas
  const hc = document.createElement('canvas');
  hc.width = hc.height = S;
  const h = hc.getContext('2d')!;
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);
  for (const [grow, v] of [[0, 60], [-3, 110], [-6, 150], [-10, 170]] as const) {
    h.fillStyle = `rgb(${v},${v},${v})`;
    blob(h, grow);
  }
  for (const b of bubbles) {
    const g = h.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    h.fillStyle = g;
    h.beginPath();
    h.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    h.fill();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const H = (x: number, y: number) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  const normal = canvasTexture(S, S, (ctx) => {
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * 3.2;
        const dy = (H(x, y + 1) - H(x, y - 1)) * 3.2;
        const l = Math.hypot(dx, dy, 1);
        const o = (y * S + x) * 4;
        img.data[o] = Math.round((-dx / l) * 127 + 128);
        img.data[o + 1] = Math.round((dy / l) * 127 + 128);
        img.data[o + 2] = Math.round((1 / l) * 127 + 128);
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, false);
  // recorte: forma com a borda levemente esfumada
  const alpha = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    ctx.filter = 'blur(1.5px)';
    ctx.fillStyle = '#fff';
    blob(ctx, 0);
    ctx.filter = 'none';
  }, false);
  // tom: centro mais escuro (fundo), borda clara (menisco), brilho nas bolhas
  const detail = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = '#bdbdbd';
    ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(C, C, 0, C, C, S * 0.42);
    g.addColorStop(0, 'rgba(40,40,40,0.55)');
    g.addColorStop(0.7, 'rgba(40,40,40,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0.35)');
    ctx.fillStyle = g;
    blob(ctx, 0);
    for (const b of bubbles) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, Math.max(0.8, b.r * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // óleo: preto com manchas furta-cor (roxo, verde-azulado, dourado) em faixas tortas
  const sheen = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = '#060608';
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'lighter';
    const cols = ['rgba(130,40,210,0.28)', 'rgba(20,170,150,0.24)', 'rgba(210,160,30,0.2)', 'rgba(210,50,120,0.18)'];
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = cols[i % cols.length];
      ctx.lineWidth = 5 + rnd() * 9;
      ctx.beginPath();
      const r0 = S * (0.08 + rnd() * 0.28);
      for (let k = 0; k <= 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        const r = r0 * (1 + 0.25 * Math.sin(a * 3 + i));
        const x = C + Math.cos(a) * r * 1.15 + (rnd() - 0.5) * 3;
        const y = C + Math.sin(a) * r * 0.85 + (rnd() - 0.5) * 3;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of bubbles) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, Math.max(0.8, b.r * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (const t of [alpha, normal, detail, sheen]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { alpha, normal, detail, sheen };
}

/** Marca queimada no chão: centro preto fosco, borda irregular em raios e fuligem esfumada. */
function scorchTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    let seed = 23;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    g.addColorStop(0, 'rgba(8,6,5,0.95)');
    g.addColorStop(0.45, 'rgba(14,11,9,0.85)');
    g.addColorStop(0.8, 'rgba(30,24,20,0.35)');
    g.addColorStop(1, 'rgba(30,24,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    // raios de fuligem saindo do centro
    ctx.translate(64, 64);
    for (let i = 0; i < 22; i++) {
      ctx.rotate((Math.PI * 2) / 22 + (rnd() - 0.5) * 0.2);
      const len = 34 + rnd() * 28;
      const w = 3 + rnd() * 6;
      const lg = ctx.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, 'rgba(10,8,6,0.7)');
      lg.addColorStop(1, 'rgba(10,8,6,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(0, -w);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, w);
      ctx.fill();
    }
    // brasas quase apagadas no meio
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(${150 + Math.round(rnd() * 80)},${40 + Math.round(rnd() * 30)},10,0.5)`;
      ctx.beginPath();
      ctx.arc((rnd() - 0.5) * 36, (rnd() - 0.5) * 36, 0.8 + rnd() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Cor "quente" (acima de 1: brilha no bloom). Guardada em cache: as partículas só leem as cores,
 * então o mesmo objeto serve para todas (antes eram 2 objetos novos por partícula).
 */
const HOT_CACHE = new Map<number, THREE.Color>();
const HOT = (hex: number, k = 1): THREE.Color => {
  const key = hex * 1024 + Math.round(k * 20);
  let c = HOT_CACHE.get(key);
  if (!c) HOT_CACHE.set(key, (c = new THREE.Color(hex).multiplyScalar(k)));
  return c;
};
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const TMP = new THREE.Vector3();
/** raio visual da mancha de óleo (igual ao da simulação) */
const OIL_R = (WEAPONS as unknown as { oil: { radius: number } }).oil.radius;

/** Destroço sólido da explosão (reaproveitado de uma lista livre). */
interface Debris { x: number; y: number; z: number; vx: number; vy: number; vz: number; floor: number; rx: number; ry: number; rz: number; spin: number; s: number; life: number }
/** Emissor da coluna de fumaça escura de uma explosão. */
interface Column { x: number; y: number; z: number; s: number; t: number; acc: number; rate: number }

/**
 * Tudo que aparece e some durante a corrida: tiros, mísseis, minas, óleo,
 * dinheiro/blindagem na pista, explosões, faíscas e fumaça.
 */
export class Effects {
  readonly group = new THREE.Group();
  private fire: ParticlePool;
  private smoke: ParticlePool;
  /** bola de fogo das explosões (mistura normal: esfria de laranja a fuligem) */
  private ball: ParticlePool;
  /** nível baixo/celular: explosão reduzida (menos bolas, destroços e fumaça) */
  private lite = false;
  private projectiles = new Map<number, THREE.Object3D>();
  private hazards = new Map<number, THREE.Object3D>();
  private pickups = new Map<number, THREE.Object3D>();
  private flashes: { light: THREE.PointLight; life: number }[] = [];
  /** ondas de choque (pool): anel esfumado que se expande e some em ~0,3 s */
  private rings: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; life: number; s0: number }[] = [];
  private static readonly RING_LIFE = 0.3;
  private time = 0;
  /** clarão aditivo curto das explosões (pool de sprites reaproveitados) */
  private blasts: { sprite: THREE.Sprite; life: number; max: number; size: number }[] = [];
  /** destroços sólidos com gravidade e quique (um InstancedMesh só, anel de instâncias) */
  private debris: THREE.InstancedMesh;
  private debrisItems: Debris[] = [];
  private debrisFree: Debris[] = [];
  private static readonly DEBRIS = 64;
  private debrisDensity = 1;
  private dm = new THREE.Matrix4();
  private dq = new THREE.Quaternion();
  private de = new THREE.Euler();
  private dv = new THREE.Vector3();
  /** marcador discreto sob o carro do jogador (anel + seta no chão) */
  readonly marker: THREE.Group;
  /** emissores de coluna de fumaça das explosões */
  private columns: Column[] = [];
  private columnsFree: Column[] = [];

  // geometrias e materiais compartilhados
  /** VK Plasma Rifles: bola de plasma verde com rastro */
  private plasmaCore = new THREE.SphereGeometry(0.22, 12, 8);
  private plasmaCoreMat = new THREE.MeshBasicMaterial({ color: HOT(0xeafff0, 4) });
  private plasmaGlow = new THREE.SphereGeometry(0.42, 12, 8);
  private plasmaGlowMat = new THREE.MeshBasicMaterial({ color: HOT(0x40ff70, 2.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  private plasmaTrail = new THREE.CapsuleGeometry(0.2, 1.8, 4, 8).rotateX(Math.PI / 2).translate(0, 0, -1.05);
  private plasmaTrailMat = new THREE.MeshBasicMaterial({ color: HOT(0x30ff60, 1.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  /** Rogue Missiles: míssil 3D com aletas e chama */
  private missileBody = new THREE.CylinderGeometry(0.2, 0.2, 1.5, 12).rotateX(Math.PI / 2);
  private missileNose = new THREE.ConeGeometry(0.2, 0.55, 12).rotateX(Math.PI / 2).translate(0, 0, 1.02);
  private missileFin = new THREE.BoxGeometry(0.04, 0.34, 0.4).translate(0, 0.28, -0.55);
  private missileMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ec, metalness: 0.6, roughness: 0.3, emissive: 0x202020 });
  private missileRed = new THREE.MeshStandardMaterial({ color: 0xe0201a, metalness: 0.3, roughness: 0.4, emissive: 0x400000 });
  private missileFlame = new THREE.ConeGeometry(0.22, 1.1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.3);
  private exhaustMat = new THREE.MeshBasicMaterial({ color: HOT(0xffb040, 5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  /** Sundog Beams: sol de energia com raios girando */
  private sunTex = canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.translate(64, 64);
    for (let k = 0; k < 12; k++) {
      ctx.rotate(Math.PI / 6);
      const g = ctx.createLinearGradient(0, 0, 0, -62);
      g.addColorStop(0, 'rgba(255,240,150,1)');
      g.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(0, k % 2 ? -62 : -44);
      ctx.lineTo(6, 0);
      ctx.fill();
    }
    const c = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
    c.addColorStop(0, 'rgba(255,255,255,1)');
    c.addColorStop(0.5, 'rgba(255,210,60,0.9)');
    c.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
  });
  /** Bear Claw Mines: disco com garras e luz piscando */
  private mineGeo = new THREE.CylinderGeometry(0.55, 0.7, 0.3, 16);
  private clawGeo = new THREE.ConeGeometry(0.1, 0.55, 5);
  private mineMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.8, roughness: 0.35, emissive: 0x5a0604, emissiveIntensity: 0.6 });
  private clawMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 1, roughness: 0.25 });
  private ledMat = new THREE.MeshBasicMaterial({ color: HOT(0xff2010, 3) });
  /** halo vermelho pequeno das minas (um material para todas) */
  private mineHaloMat = new THREE.SpriteMaterial({
    map: canvasTexture(64, 64, (ctx) => {
      ctx.clearRect(0, 0, 64, 64);
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,120,100,1)');
      g.addColorStop(0.25, 'rgba(255,40,20,0.6)');
      g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }),
    color: HOT(0xff3020, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  /** KO Scatterpack: bolinhas espinhosas amarelas e pretas */
  // scatter: esfera de metal escuro com núcleo vermelho aceso (como no visual alvo)
  private scatterGeo = new THREE.SphereGeometry(0.24, 16, 12);
  private scatterMat = new THREE.MeshStandardMaterial({ color: 0x5a0a08, metalness: 0.85, roughness: 0.22, emissive: 0xff1a10, emissiveIntensity: 0.9 });
  private scatterSpike = new THREE.ConeGeometry(0.04, 0.16, 4);
  private darkMetal = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.8, roughness: 0.3 });
  /** poças: óleo (brilho furta-cor), gosma, água, neve, lava */
  // quadrado 2,6 x 2,6 m: a forma (raio médio ~1 m) vem do recorte da textura, não da malha
  private oilGeo = new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2);
  private puddleTex = puddleTextures();
  /** material de poça: recorte irregular, relevo (bolhas/menisco) e reflexo do ambiente */
  private liquid(o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const t = this.puddleTex;
    return new THREE.MeshStandardMaterial({
      map: t.detail, alphaMap: t.alpha, normalMap: t.normal, normalScale: new THREE.Vector2(1.2, 1.2),
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 1.6,
      ...o,
    });
  }
  private oilMat = this.liquid({ map: this.puddleTex.sheen, roughness: 0.03, metalness: 0.7, envMapIntensity: 2 });
  private slimeMat = this.liquid({ color: 0x5ad820, emissive: 0x1a6a04, roughness: 0.12, metalness: 0.15 });
  private waterMat = this.liquid({ color: 0x3a6aff, emissive: 0x041a50, roughness: 0.03, metalness: 0.35, opacity: 0.9 });
  private tarMat = this.liquid({ color: 0x1a1a1e, roughness: 0.06, metalness: 0.7 });
  private snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.75 });
  private snowPatchMat = this.liquid({ color: 0xf4f8ff, roughness: 0.8, metalness: 0, envMapIntensity: 0.6, normalScale: new THREE.Vector2(2.5, 2.5) });
  private lavaMat = this.liquid({ color: 0xff5010, emissive: 0xff3a00, emissiveMap: this.puddleTex.detail, emissiveIntensity: 2, roughness: 0.55, metalness: 0 });
  private lavaBubbleMat = new THREE.MeshBasicMaterial({ color: HOT(0xffa040, 3) });
  /** LEDs das minas e do scatterpack e o miolo do sundog: um só de cada (antes, um por disparo) */
  private ledMineGeo = new THREE.SphereGeometry(0.11, 8, 6);
  private ledScatterGeo = new THREE.SphereGeometry(0.06, 6, 4);
  private sunSpriteMat = new THREE.SpriteMaterial({ map: this.sunTex, color: HOT(0xffffff, 2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  private sunCoreMat = new THREE.MeshBasicMaterial({ color: HOT(0xfff0c0, 5) });
  /** marcas queimadas das explosões (~8 s no chão), pool reaproveitado */
  private scorchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private scorches: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; life: number }[] = [];
  private static readonly SCORCH_LIFE = 8;
  /** última pista vista em update(): altura do chão para as marcas queimadas */
  private world: World | null = null;
  private coinGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.14, 24).rotateX(Math.PI / 2);
  private coinMat: THREE.Material[];
  private armorMat = new THREE.MeshStandardMaterial({ color: 0x20c060, emissive: 0x0a6a2a, metalness: 0.4, roughness: 0.3 });
  private ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  /** marcas de pneu no chão (anel de instâncias: as mais antigas são reaproveitadas) */
  private skids: THREE.InstancedMesh;
  private skidNext = 0;
  private skidM = new THREE.Matrix4();
  private skidQ = new THREE.Quaternion();
  private static readonly SKIDS = 900;

  /** Qualidade baixa: menos fumaça (a mais cara, por sobreposição) e um pouco menos de fogo. */
  setDensity(d: number): void {
    this.smoke.density = d;
    this.fire.density = Math.min(1, d + 0.3);
    this.debrisDensity = d;
    let touch = false;
    try {
      touch = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    } catch {
      touch = false;
    }
    this.lite = d < 0.7 || touch;
  }

  constructor() {
    this.fire = new ParticlePool(500, 'fire');
    this.smoke = new ParticlePool(700, 'smoke');
    this.ball = new ParticlePool(96, 'ball');
    this.group.add(this.fire.mesh, this.smoke.mesh, this.ball.mesh);
    this.skids = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.34, 0.75).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      Effects.SKIDS,
    );
    this.skids.count = 0;
    this.skids.frustumCulled = false;
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skids.renderOrder = 1;
    this.group.add(this.skids);
    const coinFace = new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.7, roughness: 0.3, emissive: 0x3a2800 });
    const coinEdge = new THREE.MeshStandardMaterial({ color: 0xd8a010, metalness: 0.9, roughness: 0.25 });
    this.coinMat = [coinEdge, coinFace, coinFace];
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xff8a30, 0, 30, 2);
      this.group.add(light);
      this.flashes.push({ light, life: 0 });
    }
    const blastTex = canvasTexture(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,236,170,1)');
      g.addColorStop(0.2, 'rgba(255,190,80,0.85)');
      g.addColorStop(0.5, 'rgba(255,110,20,0.3)');
      g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
    // onda de choque: anel esfumado (borda externa nítida, rastro suave para dentro)
    const shockTex = canvasTexture(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.82, 'rgba(255,255,255,0.45)');
      g.addColorStop(0.93, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
    // anéis de choque e marcas queimadas: pools criados uma vez (antes, um material por explosão)
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ map: shockTex, color: HOT(0xffc890, 1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, s0: 1 });
    }
    const scorchMap = scorchTexture();
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(this.scorchGeo, new THREE.MeshBasicMaterial({ map: scorchMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.scorches.push({ mesh, life: 0 });
    }
    for (let i = 0; i < 4; i++) {
      // clarão alaranjado e contido (o branco estourado tapava a cena)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: blastTex, color: HOT(0xffc070, 1.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sprite.visible = false;
      sprite.renderOrder = 4;
      this.group.add(sprite);
      this.blasts.push({ sprite, life: 0, max: 0.1, size: 1 });
    }
    // lascas irregulares de metal escuro
    const chunk = new THREE.DodecahedronGeometry(0.3, 0);
    chunk.scale(1.5, 0.5, 1.1);
    this.debris = new THREE.InstancedMesh(chunk, new THREE.MeshStandardMaterial({ color: 0x3a3634, metalness: 0.6, roughness: 0.45, emissive: 0x240800 }), Effects.DEBRIS);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.count = 0;
    this.debris.frustumCulled = false;
    this.group.add(this.debris);
    this.marker = this.makeMarker();
    this.group.add(this.marker);
  }

  /** Anel fino com seta na frente, rente ao chão: identifica o carro do jogador em qualquer câmera. */
  private makeMarker(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: HOT(0x7af0ff, 1.3), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.22, 48).rotateX(-Math.PI / 2), mat);
    const arrow = new THREE.Shape();
    arrow.moveTo(0, 3.0);
    arrow.lineTo(0.5, 2.4);
    arrow.lineTo(0.18, 2.46);
    arrow.lineTo(0, 2.3);
    arrow.lineTo(-0.18, 2.46);
    arrow.lineTo(-0.5, 2.4);
    arrow.closePath();
    // forma desenhada no plano XY com a ponta em +y; deitada no chão, a ponta vai para +z (frente)
    const head = new THREE.Mesh(new THREE.ShapeGeometry(arrow).rotateX(Math.PI / 2), mat);
    g.add(ring, head);
    g.renderOrder = 2;
    g.visible = false;
    return g;
  }

  /** Posiciona o marcador do jogador (chamado a cada quadro pelo jogo). */
  markPlayer(x: number, y: number, z: number, heading: number, visible: boolean, near = false): void {
    this.marker.visible = visible;
    if (!visible) return;
    this.marker.position.set(x, y + 0.04, z);
    this.marker.rotation.y = heading;
    // perseguição/cockpit: anel menor e discreto (na vista aérea ele identifica o carro)
    this.marker.scale.setScalar(near ? 0.5 : 1);
    const m = (this.marker.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    m.opacity = near ? 0.35 : 0.4 + Math.sin(this.time * 4) * 0.1;
  }

  /** Remove as marcas de pneu (troca de pista). */
  clearSkids(): void {
    this.skids.count = 0;
    this.skidNext = 0;
  }

  /**
   * Limpa tudo que pertence à corrida anterior (chamado em createRace): tiros, minas, poças,
   * prêmios, marcas de pneu e queimadas, destroços, fumaça e clarões. Sem isso, poças de uma pista
   * reapareciam na seguinte. Geometrias e materiais são compartilhados: nada a liberar.
   */
  reset(): void {
    for (const map of [this.projectiles, this.hazards, this.pickups]) {
      for (const o of map.values()) {
        this.group.remove(o);
        if (map === this.projectiles) this.releaseProjectile(o);
      }
      map.clear();
    }
    this.clearSkids();
    for (const c of this.columns) this.columnsFree.push(c);
    this.columns.length = 0;
    for (const d of this.debrisItems) this.debrisFree.push(d);
    this.debrisItems.length = 0;
    this.debris.count = 0;
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
    }
    for (const s of this.scorches) {
      s.life = 0;
      s.mesh.visible = false;
    }
    for (const b of this.blasts) {
      b.life = 0;
      b.sprite.visible = false;
    }
    for (const f of this.flashes) {
      f.life = 0;
      f.light.intensity = 0;
    }
    this.fire.clear();
    this.ball.clear();
    this.smoke.clear();
    this.world = null;
  }

  /** Marca de pneu num ponto do chão (x, y, z) com a direção do carro. */
  skid(x: number, y: number, z: number, heading: number): void {
    this.skidQ.setFromAxisAngle(UP, heading);
    this.skidM.compose(TMP.set(x, y + 0.035, z), this.skidQ, ONE);
    this.skids.setMatrixAt(this.skidNext, this.skidM);
    // envia só a marca nova à GPU (antes, as 900 a cada marca durante a derrapagem)
    this.skids.instanceMatrix.addUpdateRange(this.skidNext * 16, 16);
    this.skidNext = (this.skidNext + 1) % Effects.SKIDS;
    this.skids.count = Math.max(this.skids.count, this.skidNext === 0 ? Effects.SKIDS : this.skidNext);
    this.skids.instanceMatrix.needsUpdate = true;
  }

  /** Poeira levantada pelas rodas (cor do piso). */
  dust(x: number, y: number, z: number, color: number, amount = 1): void {
    this.smoke.emit({
      x: x + (Math.random() - 0.5) * 0.6, y: y + 0.3, z: z + (Math.random() - 0.5) * 0.6,
      vx: (Math.random() - 0.5) * 2.5, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 2.5,
      life: 0.6 + Math.random() * 0.5, size0: 0.35 * amount, size1: 1.8 * amount,
      c0: HOT(color), c1: HOT(color, 0.8), gravity: -0.3, drag: 2,
    });
  }

  /**
   * Jato do turbo: duas chamas saindo dos escapes (núcleo azul-branco que esquenta para laranja na
   * ponta), partículas aditivas curtas e uma fagulha de vez em quando.
   */
  nitro(x: number, y: number, z: number, heading: number, carSpeed = 0): void {
    const bx = -forwardX(heading);
    const bz = -forwardZ(heading);
    const lx = -bz;
    const lz = bx;
    // a chama anda junto com o carro (velocidade do carro + jato para trás): fica colada ao escape
    const cx = -bx * carSpeed;
    const cz = -bz * carSpeed;
    for (const side of [-0.45, 0.45]) {
      const ex = x + lx * side;
      const ez = z + lz * side;
      // núcleo azul-branco curto
      let sp = 6 + Math.random() * 3;
      this.fire.emit({
        x: ex + (Math.random() - 0.5) * 0.1, y: y + (Math.random() - 0.5) * 0.08, z: ez + (Math.random() - 0.5) * 0.1,
        vx: cx + bx * sp, vy: 0, vz: cz + bz * sp,
        life: 0.08 + Math.random() * 0.05, size0: 0.7, size1: 0.35,
        c0: HOT(0xdcecff, 2.4), c1: HOT(0x3a6aff, 1.5), gravity: 0, drag: 0,
      });
      // língua laranja mais longa
      sp = 9 + Math.random() * 5;
      this.fire.emit({
        x: ex + (Math.random() - 0.5) * 0.15, y: y + (Math.random() - 0.5) * 0.1, z: ez + (Math.random() - 0.5) * 0.15,
        vx: cx + bx * sp + (Math.random() - 0.5), vy: Math.random() * 0.6, vz: cz + bz * sp + (Math.random() - 0.5),
        life: 0.12 + Math.random() * 0.1, size0: 0.8, size1: 0.15,
        c0: HOT(0xffa040, 1.8), c1: HOT(0xff3a08, 0.9), gravity: -1, drag: 0,
      });
    }
    if (Math.random() < 0.3) this.glowBit(x, y, z, 0xffa040);
  }

  /* ---------- emissores ---------- */

  explosion(x: number, y: number, z: number, big = true): void {
    const s = big ? 1.5 : 0.75;
    const lite = this.lite;
    // clarão curto e contido (~0,1 s), alaranjado: o "estalo" sem estourar a tela de branco
    const b = this.blasts.reduce((a, c) => (a.life < c.life ? a : c));
    b.sprite.position.set(x, y + 1.1 * s, z);
    b.max = b.life = big ? 0.1 : 0.07;
    b.size = (big ? 2.4 : 2.0) * s;
    b.sprite.visible = true;
    // bola de fogo com volume: rolos de chama texturizados (laranja -> vermelho -> fuligem preta),
    // que crescem, sobem e escurecem; mistura normal, então a fuligem tapa o fundo de verdade
    const balls = (big ? 11 : 5) >> (lite ? 1 : 0);
    for (let i = 0; i < balls; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.8 * s;
      const hot = i < balls * 0.4;
      this.ball.emit({
        x: x + Math.cos(a) * r, y: y + 0.7 + Math.random() * 0.9 * s, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * (1 + Math.random() * 2) * s, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * (1 + Math.random() * 2) * s,
        life: 0.75 + Math.random() * 0.45, size0: (hot ? 1.2 : 1.6) * s, size1: (hot ? 3.0 : 3.8) * s,
        c0: hot ? HOT(0xffd26a, 1.5) : HOT(0xff9a30, 1.3), c1: HOT(0xc0280a, 0.75), gravity: -1.5, drag: 2.8,
      });
    }
    // núcleo aditivo curto (o brilho do miolo) e algumas línguas de fogo para os lados
    for (let i = 0; i < (big ? 4 : 2); i++) {
      this.fire.emit({
        x: x + (Math.random() - 0.5) * 0.8 * s, y: y + 0.9 + Math.random() * 0.6 * s, z: z + (Math.random() - 0.5) * 0.8 * s,
        vx: 0, vy: 1.5, vz: 0,
        life: 0.22 + Math.random() * 0.12, size0: 1.8 * s, size1: 2.6 * s,
        c0: HOT(0xffe090, 1.2), c1: HOT(0xff5010, 0.4), gravity: 0, drag: 3,
      });
    }
    const n = (big ? 14 : 6) >> (lite ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = (4 + Math.random() * 9) * s;
      this.fire.emit({
        x, y: y + 0.8, z,
        vx: Math.cos(a) * sp * (1 - up * 0.5), vy: up * sp * 1.1, vz: Math.sin(a) * sp * (1 - up * 0.5),
        life: 0.25 + Math.random() * 0.35, size0: 1.0 * s, size1: 0.25,
        c0: HOT(0xff8a20, 1.2), c1: HOT(0xb01800, 0.45), gravity: 4, drag: 3,
      });
    }
    // destroços sólidos (8-12 na grande), com gravidade, giro e quique no chão (metade no celular)
    const pieces = big ? 8 + Math.floor(Math.random() * 5) : 4 + Math.floor(Math.random() * 3);
    const count = lite ? Math.max(3, Math.round(pieces * Math.min(0.5, this.debrisDensity + 0.1))) : pieces;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (4 + Math.random() * 6) * (big ? 1.15 : 0.85);
      if (this.debrisItems.length >= Effects.DEBRIS) this.debrisFree.push(this.debrisItems.shift()!);
      const d = this.debrisFree.pop() ?? ({} as Debris);
      d.x = x;
      d.y = y + 0.8;
      d.z = z;
      d.vx = Math.cos(a) * sp;
      d.vy = 5 + Math.random() * 7;
      d.vz = Math.sin(a) * sp;
      d.floor = y;
      d.rx = Math.random() * 6;
      d.ry = Math.random() * 6;
      d.rz = Math.random() * 6;
      d.spin = 5 + Math.random() * 8;
      d.s = (0.9 + Math.random() * 1.1) * (big ? 1.35 : 0.8);
      d.life = 2.2 + Math.random() * 1.2;
      this.debrisItems.push(d);
    }
    // coluna de fumaça escura: o carro destruído solta fumaça por ~1,2 s, que sobe e dura 2-3 s
    const col = this.columnsFree.pop() ?? ({} as Column);
    col.x = x;
    col.y = y;
    col.z = z;
    col.s = s;
    col.t = big ? 1.2 : 0.45;
    col.acc = 0;
    col.rate = (big ? 22 : 14) * (lite ? 0.5 : 1);
    this.columns.push(col);
    // fumaça baixa que se espalha pelo chão
    const low = (big ? 10 : 5) >> (lite ? 1 : 0);
    for (let i = 0; i < low; i++) {
      const a = (i / low) * Math.PI * 2;
      this.smoke.emit({
        x: x + Math.cos(a), y: y + 0.4, z: z + Math.sin(a),
        vx: Math.cos(a) * 5 * s, vy: 0.6, vz: Math.sin(a) * 5 * s,
        life: 1.2 + Math.random() * 0.6, size0: 1.2 * s, size1: 3.5 * s,
        c0: HOT(0x2e2620), c1: HOT(0x121110), gravity: -0.2, drag: 2.5,
      });
    }
    this.sparks(x, y + 0.8, z, (big ? 24 : 10) >> (lite ? 1 : 0));
    // luz pontual temporária, mais fraca: reaproveita a luz do pool que está mais perto de apagar
    const flash = this.flashes.reduce((a, c) => (a.life < c.life ? a : c));
    flash.light.position.set(x, y + 2, z);
    flash.light.color.set(0xff7a20);
    flash.life = big ? 0.45 : 0.25;
    flash.light.intensity = big ? 150 : 55;
    // onda de choque rente ao chão (pool): expande rápido e some em ~0,3 s
    const ground = this.world ? this.world.track.query(x, z).height : y;
    const onGround = Math.abs(ground - y) < 2.5;
    const ring = this.rings.reduce((a, c) => (a.life < c.life ? a : c));
    ring.life = Effects.RING_LIFE;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, (onGround ? ground : y) + 0.12, z);
    ring.s0 = big ? 0.9 : 0.5;
    ring.mesh.scale.setScalar(ring.s0);
    ring.mesh.material.opacity = 1;
    // marca queimada no chão (~8 s)
    if (onGround) {
      const sc = this.scorches.reduce((a, c) => (a.life < c.life ? a : c));
      sc.life = Effects.SCORCH_LIFE;
      sc.mesh.visible = true;
      sc.mesh.position.set(x, ground + 0.05, z);
      sc.mesh.rotation.y = Math.random() * Math.PI * 2;
      sc.mesh.scale.setScalar((big ? 4.6 : 2.4) * (0.9 + Math.random() * 0.2));
      sc.mesh.material.opacity = 0.9;
    }
  }

  sparks(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.fire.emit({
        x, y, z,
        vx: (Math.random() - 0.5) * 22, vy: Math.random() * 12, vz: (Math.random() - 0.5) * 22,
        life: 0.25 + Math.random() * 0.35, size0: 0.3, size1: 0.08,
        c0: HOT(0xffc050, 2.4), c1: HOT(0xff5010, 1.2), gravity: 25, drag: 1,
      });
    }
  }

  puff(x: number, y: number, z: number, color = 0x2a2828, size = 1): void {
    this.smoke.emit({
      x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
      vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.5,
      life: 0.9 + Math.random() * 0.6, size0: 0.4 * size, size1: 2.2 * size,
      c0: HOT(color), c1: HOT(0x0a0a0a), gravity: -0.5, drag: 1,
    });
  }

  flame(x: number, y: number, z: number): void {
    this.fire.emit({
      x: x + (Math.random() - 0.5) * 0.8, y, z: z + (Math.random() - 0.5) * 0.8,
      vx: 0, vy: 3 + Math.random() * 2, vz: 0,
      life: 0.3 + Math.random() * 0.2, size0: 0.8, size1: 0.1,
      c0: HOT(0xffb040, 3), c1: HOT(0xff2000, 1), gravity: -2, drag: 2,
    });
  }

  /** Faísca brilhante solta (rastro de plasma e do sundog). */
  glowBit(x: number, y: number, z: number, color: number): void {
    this.fire.emit({
      x: x + (Math.random() - 0.5) * 0.3, y: y + (Math.random() - 0.5) * 0.3, z: z + (Math.random() - 0.5) * 0.3,
      vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 2,
      life: 0.18 + Math.random() * 0.15, size0: 0.35, size1: 0.05,
      c0: HOT(color, 4), c1: HOT(color, 1), gravity: 0, drag: 3,
    });
  }

  /** Clarão na boca da arma ao disparar. */
  muzzle(kind: string, x: number, y: number, z: number): void {
    const col = kind === 'missile' ? 0xffa040 : kind === 'sundog' ? 0xffd040 : 0x60ff90;
    for (let i = 0; i < (kind === 'missile' ? 10 : 7); i++) this.glowBit(x, y, z, col);
    if (kind === 'missile') for (let i = 0; i < 4; i++) this.puff(x, y, z, 0xcfc8c0, 0.7);
  }

  /** Acerto de plasma ou sundog: estouro de energia. */
  zap(kind: string, x: number, y: number, z: number): void {
    const col = kind === 'sundog' ? 0xffc040 : 0x50ff80;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 8;
      this.fire.emit({
        x, y, z, vx: Math.cos(a) * sp, vy: Math.random() * 6, vz: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.25, size0: 0.6, size1: 0.08,
        c0: HOT(col, 2.2), c1: HOT(0xff6020, 1), gravity: 6, drag: 3,
      });
    }
    const flash = this.flashes.reduce((a, b) => (a.life < b.life ? a : b));
    flash.light.color.set(col);
    flash.light.position.set(x, y + 1, z);
    flash.life = 0.2;
    flash.light.intensity = 90;
  }

  /** Jatos de pulo (Locust Jump Jets): chamas para baixo e poeira no chão. */
  jumpJet(x: number, y: number, z: number): void {
    for (let i = 0; i < 26; i++) {
      this.fire.emit({
        x: x + (Math.random() - 0.5) * 1.6, y: y + 0.2, z: z + (Math.random() - 0.5) * 1.6,
        vx: (Math.random() - 0.5) * 3, vy: -6 - Math.random() * 6, vz: (Math.random() - 0.5) * 3,
        life: 0.25 + Math.random() * 0.2, size0: 0.8, size1: 0.1,
        c0: HOT(0xfff0b0, 4), c1: HOT(0xff5a10, 1.5), gravity: 0, drag: 2,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.smoke.emit({
        x: x + Math.cos(a) * 0.8, y: y + 0.2, z: z + Math.sin(a) * 0.8,
        vx: Math.cos(a) * 5, vy: 0.6, vz: Math.sin(a) * 5,
        life: 0.7 + Math.random() * 0.4, size0: 0.6, size1: 2.2,
        c0: HOT(0x9a948e), c1: HOT(0x3a3634), gravity: -0.2, drag: 2.5,
      });
    }
  }

  /** Nitro acionado: estouro azul na traseira. */
  nitroBurst(x: number, y: number, z: number): void {
    for (let i = 0; i < 14; i++) this.glowBit(x, y + 0.5, z, 0x6ad0ff);
  }

  /** Queda da pista: respingo (água/lodo), labaredas (lava) ou poeira (chão sólido). */
  fall(x: number, y: number, z: number, style: string): void {
    const splash = style === 'ocean' ? 0xa0c8ff : style === 'sludge' ? 0xd8a040 : style === 'snow' ? 0xffffff : style === 'lava' ? 0xff6010 : 0x8a7a6a;
    const lava = style === 'lava';
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      (lava ? this.fire : this.smoke).emit({
        x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 5 + Math.random() * 8, vz: Math.sin(a) * sp,
        life: 0.7 + Math.random() * 0.5, size0: 0.7, size1: lava ? 0.2 : 1.6,
        c0: lava ? HOT(splash, 3) : HOT(splash), c1: lava ? HOT(0xff2000, 1) : HOT(splash, 0.8),
        gravity: 14, drag: 0.8,
      });
    }
  }

  private makeProjectile(kind: string): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'missile') {
      g.add(new THREE.Mesh(this.missileBody, this.missileMat), new THREE.Mesh(this.missileNose, this.missileRed));
      for (let k = 0; k < 4; k++) {
        const fin = new THREE.Mesh(this.missileFin, this.missileRed);
        fin.rotation.z = (k * Math.PI) / 2;
        g.add(fin);
      }
      const flame = new THREE.Mesh(this.missileFlame, this.exhaustMat);
      flame.name = 'flame';
      g.add(flame);
      g.scale.setScalar(1.25);
    } else if (kind === 'sundog') {
      const spr = new THREE.Sprite(this.sunSpriteMat);
      spr.name = 'sun';
      spr.scale.setScalar(2.4);
      g.add(spr, new THREE.Mesh(this.plasmaCore, this.sunCoreMat));
    } else {
      g.add(new THREE.Mesh(this.plasmaTrail, this.plasmaTrailMat), new THREE.Mesh(this.plasmaGlow, this.plasmaGlowMat), new THREE.Mesh(this.plasmaCore, this.plasmaCoreMat));
    }
    return g;
  }

  private makeHazard(kind: string, id: number, theme: string): THREE.Object3D {
    const disc = (mat: THREE.Material, r: number) => {
      const m = new THREE.Mesh(this.oilGeo, mat);
      m.scale.set(r, 1, r * 0.82);
      m.rotation.y = id * 1.7;
      return m;
    };
    const radius = (k: string, fallback: number) => (WEAPONS as unknown as Record<string, { radius?: number }>)[k]?.radius ?? fallback;
    switch (kind) {
      case 'oil':
        return disc(this.oilMat, 0.3);
      case 'slime':
        return disc(this.slimeMat, radius('slime', 2.3));
      case 'puddle':
        // poça d'água azul em Bogmire, piche preto em New Mojave
        return disc(theme === 'newmojave' ? this.tarMat : this.waterMat, radius('puddle', 2.3));
      case 'snow': {
        const g = new THREE.Group();
        g.add(disc(this.snowPatchMat, radius('snow', 2.4)));
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + id;
          const lump = new THREE.Mesh(this.plasmaGlow, this.snowMat);
          lump.position.set(Math.cos(a) * 1.2, 0.05, Math.sin(a) * 1.0);
          lump.scale.set(1.6, 0.45, 1.4);
          g.add(lump);
        }
        return g;
      }
      case 'lava': {
        const g = new THREE.Group();
        g.add(disc(this.lavaMat, radius('lava', 2.2)));
        const bubble = new THREE.Mesh(this.plasmaCore, this.lavaBubbleMat);
        bubble.name = 'bubble';
        bubble.position.set(0.4, 0.1, -0.3);
        g.add(bubble);
        return g;
      }
      case 'scatter': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.scatterGeo, this.scatterMat));
        for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
          const sp = new THREE.Mesh(this.scatterSpike, this.darkMetal);
          sp.position.set(x * 0.25, y * 0.25, z * 0.25);
          sp.quaternion.setFromUnitVectors(UP, new THREE.Vector3(x, y, z));
          g.add(sp);
        }
        const led = new THREE.Mesh(this.ledScatterGeo, this.ledMat);
        led.position.y = 0.26;
        led.name = 'led';
        const halo = new THREE.Sprite(this.mineHaloMat);
        halo.scale.setScalar(0.7);
        halo.position.y = 0.26;
        halo.name = 'halo';
        g.add(led, halo);
        return g;
      }
      default: {
        // Bear Claw Mine
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.mineGeo, this.mineMat));
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const claw = new THREE.Mesh(this.clawGeo, this.clawMat);
          claw.position.set(Math.cos(a) * 0.62, 0.18, Math.sin(a) * 0.62);
          claw.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.cos(a), 1.2, Math.sin(a)).normalize());
          g.add(claw);
        }
        const led = new THREE.Mesh(this.ledMineGeo, this.ledMat);
        led.position.y = 0.2;
        led.name = 'led';
        // halo vermelho pequeno (como as minas acesas do visual alvo)
        const halo = new THREE.Sprite(this.mineHaloMat);
        halo.scale.setScalar(1.1);
        halo.position.y = 0.24;
        halo.name = 'halo';
        g.add(led, halo);
        return g;
      }
    }
  }

  private armorBar = new THREE.BoxGeometry(0.9, 0.3, 0.3);
  private armorPost = new THREE.BoxGeometry(0.3, 0.9, 0.3);

  private makePickup(kind: string): THREE.Object3D {
    if (kind === 'money') return new THREE.Mesh(this.coinGeo, this.coinMat);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.armorBar, this.armorMat), new THREE.Mesh(this.armorPost, this.armorMat));
    return g;
  }

  /**
   * Prepara a GPU antes da largada: envia as texturas da cena e compila os shaders da pista, dos
   * carros e de tudo que só aparece durante a corrida (tiros, minas, poças, prêmios, explosão).
   * A compilação corre em paralelo (sem travar a página); antes, o primeiro quadro da largada
   * parava 400–600 ms e o primeiro tiro de cada tipo, 100–400 ms.
   */
  async warmup(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, theme: string): Promise<void> {
    const g = new THREE.Group();
    for (const k of ['laser', 'missile', 'sundog']) g.add(this.makeProjectile(k));
    for (const k of ['oil', 'slime', 'puddle', 'snow', 'lava', 'scatter', 'mine']) g.add(this.makeHazard(k, 0, theme));
    g.add(this.makePickup('money'), this.makePickup('armor'));
    for (const r of this.rings) r.mesh.visible = true;
    for (const sc of this.scorches) sc.mesh.visible = true;
    this.debris.count = 1;
    for (const b of this.blasts) b.sprite.visible = true;
    scene.add(g);
    const seen = new Set<THREE.Texture>();
    scene.traverseVisible((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : [])
        for (const v of Object.values(mat)) {
          if (v instanceof THREE.Texture && !seen.has(v)) {
            seen.add(v);
            renderer.initTexture(v);
          }
        }
    });
    try {
      await renderer.compileAsync(scene, camera);
    } finally {
      scene.remove(g);
      for (const r of this.rings) r.mesh.visible = r.life > 0;
      for (const sc of this.scorches) sc.mesh.visible = sc.life > 0;
      this.debris.count = this.debrisItems.length;
      for (const b of this.blasts) b.sprite.visible = b.life > 0;
    }
    // alguns quadros ainda com a contagem parada: sobem as malhas (pista, cenário, carros) e o
    // driver termina de preparar os shaders — as primeiras travadas ficam antes do "3"
    for (let i = 0; i < 3; i++) {
      renderer.render(scene, camera);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  /* ---------- sincronização com a simulação ---------- */

  private syncStamp = 0;

  /** projéteis fora de uso, por tipo (reaproveitados no próximo tiro: sem montar grupos por disparo) */
  private projectileFree = new Map<string, THREE.Object3D[]>();

  private takeProjectile(kind: string): THREE.Object3D {
    const o = this.projectileFree.get(kind)?.pop() ?? this.makeProjectile(kind);
    o.userData.kind = kind;
    return o;
  }

  private releaseProjectile = (o: THREE.Object3D): void => {
    const kind = o.userData.kind as string;
    let list = this.projectileFree.get(kind);
    if (!list) this.projectileFree.set(kind, (list = []));
    if (list.length < 16) list.push(o);
  };

  /** Parte nomeada de um objeto, guardada no userData (getObjectByName percorre a árvore a cada quadro). */
  private part(o: THREE.Object3D, name: string): THREE.Object3D | undefined {
    const key = `part_${name}`;
    let found = o.userData[key] as THREE.Object3D | null | undefined;
    if (found === undefined) found = o.userData[key] = o.getObjectByName(name) ?? null;
    return found ?? undefined;
  }

  private syncMap<T extends { id: number }>(
    map: Map<number, THREE.Object3D>,
    items: T[],
    create: (it: T) => THREE.Object3D,
    update: (o: THREE.Object3D, it: T) => void,
    release?: (o: THREE.Object3D) => void,
  ): void {
    // marca de "visto" por chamada no próprio objeto (sem alocar um Set a cada quadro)
    const stamp = ++this.syncStamp;
    for (const it of items) {
      let o = map.get(it.id);
      if (!o) {
        o = create(it);
        map.set(it.id, o);
        this.group.add(o);
      }
      o.userData.syncSeen = stamp;
      update(o, it);
    }
    for (const [id, o] of map) {
      if (o.userData.syncSeen !== stamp) {
        this.group.remove(o);
        map.delete(id);
        release?.(o);
      }
    }
  }

  /** `ahead` = tempo desde o último passo da simulação, para extrapolar projéteis rápidos. */
  update(world: World, dt: number, ahead: number): void {
    this.time += dt;
    this.world = world;
    // o sol do sundog gira igual em todos os disparos (um material só)
    this.sunSpriteMat.rotation = this.time * 6;

    this.syncMap(
      this.projectiles,
      world.projectiles,
      (p: Projectile) => this.takeProjectile(p.kind as string),
      (o, p: Projectile) => {
        o.position.set(p.x + forwardX(p.heading) * p.speed * ahead, p.y, p.z + forwardZ(p.heading) * p.speed * ahead);
        o.rotation.y = p.heading;
        const kind = p.kind as string;
        const bx = p.x - forwardX(p.heading) * 1.2;
        const bz = p.z - forwardZ(p.heading) * 1.2;
        if (kind === 'missile') {
          // rastro de fumaça grossa e chama
          this.puff(bx, p.y, bz, 0xd8d2cc, 0.75);
          this.puff(bx, p.y, bz, 0x9a948e, 0.55);
          this.flame(bx, p.y, bz);
          const fl = this.part(o, 'flame');
          if (fl) fl.scale.set(1, 1, 0.8 + Math.random() * 0.6);
        } else if (kind === 'sundog') {
          const spr = this.part(o, 'sun') as THREE.Sprite | undefined;
          if (spr) spr.scale.setScalar(2.4 + Math.sin(this.time * 20 + p.id) * 0.25);
          if (Math.random() < 0.6) this.glowBit(p.x, p.y, p.z, 0xffc040);
        } else {
          // plasma: faíscas verdes soltas no caminho
          if (Math.random() < 0.7) this.glowBit(bx, p.y, bz, 0x50ff80);
        }
      },
      this.releaseProjectile,
    );

    this.syncMap(
      this.hazards,
      world.hazards,
      (h: Hazard) => this.makeHazard(h.kind as string, h.id, world.track.def.theme),
      (o, h: Hazard) => {
        const kind = h.kind as string;
        if (kind === 'oil') {
          // a mancha se espalha nos primeiros instantes
          const r = OIL_R * Math.min(1, 0.3 + h.age * 3);
          o.scale.set(r, 1, r * 0.85);
          o.position.set(h.x, h.y + 0.03, h.z);
        } else if (kind === 'mine' || kind === 'scatter') {
          o.position.set(h.x, h.y + (kind === 'mine' ? 0.15 : 0.22), h.z);
          const led = this.part(o, 'led');
          const on = h.age < 0.6 || Math.sin(this.time * (kind === 'mine' ? 12 : 16) + h.id) > 0;
          if (led) led.visible = on;
          const halo = this.part(o, 'halo');
          if (halo) halo.scale.setScalar((kind === 'mine' ? 1.1 : 0.7) * (on ? 1 : 0.55));
          if (kind === 'scatter') o.rotation.y = h.id;
        } else {
          o.position.set(h.x, h.y + 0.03, h.z);
          if (kind === 'lava') {
            const m = this.part(o, 'bubble');
            if (m) m.scale.setScalar(0.5 + ((this.time * 0.8 + h.id * 0.3) % 1) * 0.7);
          }
        }
      },
    );

    this.syncMap(
      this.pickups,
      world.pickups,
      (p: Pickup) => this.makePickup(p.kind),
      (o, p: Pickup) => {
        o.visible = p.active;
        o.position.set(p.x, p.y + 1.1 + Math.sin(this.time * 3 + p.id) * 0.15, p.z);
        o.rotation.y = this.time * 2.5 + p.id;
      },
    );

    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.light.intensity *= Math.exp(-dt * 9);
        if (f.life <= 0) f.light.intensity = 0;
      }
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = Math.min(1, 1 - r.life / Effects.RING_LIFE);
      // sai rápido e desacelera (ease-out); vai apagando enquanto abre
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      r.mesh.scale.setScalar(r.s0 * (1 + e * 7));
      r.mesh.material.opacity = Math.max(0, (1 - t) * (1 - t));
      if (r.life <= 0) r.mesh.visible = false;
    }
    // marcas queimadas: somem aos poucos nos últimos 2 s
    for (const sc of this.scorches) {
      if (sc.life <= 0) continue;
      sc.life -= dt;
      sc.mesh.material.opacity = 0.9 * Math.min(1, Math.max(0, sc.life) / 2);
      if (sc.life <= 0) sc.mesh.visible = false;
    }

    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = 1 - Math.max(0, b.life) / b.max;
      b.sprite.scale.setScalar(b.size * (0.6 + t * 0.6));
      b.sprite.material.opacity = 1 - t * t;
      if (b.life <= 0) b.sprite.visible = false;
    }
    this.updateDebris(dt);
    // colunas de fumaça (compacta no próprio vetor; emissores terminados voltam à lista livre)
    let nc = 0;
    for (let i = 0; i < this.columns.length; i++) {
      const c = this.columns[i];
      c.t -= dt;
      c.acc += dt * c.rate;
      for (; c.acc >= 1; c.acc--) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.6 * c.s;
        this.smoke.emit({
          x: c.x + Math.cos(a) * r, y: c.y + 0.8 + Math.random() * 0.6, z: c.z + Math.sin(a) * r,
          vx: Math.cos(a) * 0.5, vy: 2.6 + Math.random() * 2, vz: Math.sin(a) * 0.5,
          life: 2 + Math.random(), size0: 1.1 * c.s, size1: 4 * c.s,
          c0: HOT(0x1e1814), c1: HOT(0x0a0a0a), gravity: -0.4, drag: 0.9,
        });
      }
      if (c.s > 1 && Math.random() < dt * 14) this.flame(c.x + (Math.random() - 0.5) * 1.2, c.y + 0.5, c.z + (Math.random() - 0.5) * 1.2);
      if (c.t > 0) this.columns[nc++] = c;
      else this.columnsFree.push(c);
    }
    this.columns.length = nc;
    this.fire.update(dt);
    this.ball.update(dt);
    this.smoke.update(dt);
  }

  private updateDebris(dt: number): void {
    if (!this.debrisItems.length && this.debris.count === 0) return;
    const items = this.debrisItems;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.debrisFree.push(d);
        continue;
      }
      d.vy -= 22 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < d.floor + 0.08 && d.vy < 0) {
        // quica perdendo energia e desliza até parar
        d.y = d.floor + 0.08;
        d.vy = -d.vy * 0.35;
        d.vx *= 0.6;
        d.vz *= 0.6;
        d.spin *= 0.5;
      }
      d.rx += d.spin * dt;
      d.rz += d.spin * 0.7 * dt;
      items[n++] = d;
    }
    items.length = n;
    for (let i = 0; i < n; i++) {
      const d = items[i];
      const k = d.s * Math.min(1, d.life / 0.3);
      this.dq.setFromEuler(this.de.set(d.rx, d.ry, d.rz));
      this.dm.compose(this.dv.set(d.x, d.y, d.z), this.dq, TMP.set(k, k, k));
      this.debris.setMatrixAt(i, this.dm);
    }
    this.debris.count = n;
    this.debris.instanceMatrix.needsUpdate = true;
  }
}
