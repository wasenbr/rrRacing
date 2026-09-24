import * as THREE from 'three';
import { createCarMesh } from './cars';
import { Kit, wheel } from './cars/common';

/**
 * Miniaturas 3D (loja, garagem, seleção, planetas). Um único renderizador fora da tela é
 * compartilhado por todas elas (ver `thumbRenderer`) e cada imagem fica em cache.
 *
 * Carros: "card de veículo" — ângulo heroico 3/4 baixo, carro grande no quadro, luz de estúdio
 * (principal quente + recortes na cor do carro sobre ambiente escuro), piso escuro espelhado com
 * sombra de contato e fundo com brilho e linhas de velocidade. A variante `transparent` mantém a
 * mesma luz, mas sem fundo nem piso (para listas pequenas sobre painéis).
 */
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let envTex: THREE.Texture | null = null;
let itemRig: THREE.Group | null = null;
let carRig: { group: THREE.Group; rimL: THREE.DirectionalLight; rimR: THREE.DirectionalLight; key: THREE.DirectionalLight } | null = null;
const cache = new Map<string, string>();

/** Estúdio escuro com softboxes e tiras de luz: dá reflexos longos e nítidos no verniz. */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.BackSide }));
  env.add(room);
  const panel = (w: number, h: number, rgb: [number, number, number], x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(10, 4, [7, 6.4, 5.6], 0, 7.9, 0); // softbox de teto
  panel(9, 1.2, [9, 5, 2], 12, 3, 9); // tira quente (principal)
  panel(1.2, 8, [1.2, 2.6, 7], -14, 2, -6); // tira fria (recorte)
  panel(1.2, 8, [6, 1.2, 5], 14, 2, -10); // tira magenta (neon)
  panel(14, 1, [3, 3, 3.2], 0, -1, 14); // reflexo baixo na frente
  return env;
}

function setup(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  // contexto WebGL perdido (aparelho sem memória, aba em segundo plano): recria tudo
  if (renderer?.getContext().isContextLost()) disposeThumbnails();
  if (!renderer || !scene || !camera) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = studioEnvironment();
    envTex = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    disposeTree(env);
    scene.environment = envTex;
    // luz das peças da loja: chapada e clara
    itemRig = new THREE.Group();
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
    key.position.set(4, 7, 5);
    const rim = new THREE.DirectionalLight(0xa8c8ff, 1.6);
    rim.position.set(-5, 3, -6);
    itemRig.add(key, rim, new THREE.HemisphereLight(0xdde8ff, 0x201c24, 0.9));
    scene.add(itemRig);
    // luz dos carros: estúdio dramático (a posição é relativa à câmera, ver carThumbnail)
    const g = new THREE.Group();
    const k = new THREE.DirectionalLight(0xffd6a8, 3.8);
    const rimL = new THREE.DirectionalLight(0xffffff, 9);
    const rimR = new THREE.DirectionalLight(0xffffff, 6);
    const fill = new THREE.DirectionalLight(0x6a88ff, 0.5);
    fill.position.set(-6, 1, 4);
    g.add(k, k.target, rimL, rimL.target, rimR, rimR.target, fill, fill.target, new THREE.HemisphereLight(0x8a90b0, 0x0a0810, 0.2));
    scene.add(g);
    carRig = { group: g, rimL, rimR, key: k };
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  }
  return { renderer, scene, camera };
}

/**
 * Renderizador fora da tela compartilhado pelas miniaturas (carros, itens, planetas).
 * Retorna null se não houver WebGL.
 */
export function thumbRenderer(): THREE.WebGLRenderer | null {
  try {
    return setup().renderer;
  } catch {
    return null;
  }
}

/**
 * Libera geometrias e materiais. As texturas NÃO: algumas são compartilhadas com os carros da
 * corrida (desgaste da pintura, esteira), e descartá-las forçaria o jogo a reenviá-las à GPU.
 */
function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}

/** Pontos visíveis (sem chamas/vidros transparentes) de `obj`, já no mundo. */
function visiblePoints(obj: THREE.Object3D): THREE.Vector3[] {
  obj.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  obj.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m.material as THREE.Material).transparent) return;
    const pos = m.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  });
  return pts;
}

/**
 * Enquadra os pontos `pts`: ocupam `fill` do quadro (no maior eixo), vistos de `dir`.
 * `shiftY` desloca o objeto na tela (fração da meia-altura; negativo = mais para baixo).
 */
function frame(pts: THREE.Vector3[], camera: THREE.PerspectiveCamera, dir: THREE.Vector3, fill: number, shiftY = 0): void {
  const box = new THREE.Box3().setFromPoints(pts);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  dir.normalize();
  const target = center.clone();
  let dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.8;
  const place = () => {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = dist / 20;
    camera.far = dist * 6;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  };
  for (let pass = 0; pass < 4; pass++) {
    place();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of pts) {
      const p = c.clone().project(camera);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const scale = Math.max(x1 - x0, y1 - y0) / 2 / fill;
    // recentra: desloca o alvo no plano da câmera pelo centro projetado (com o deslocamento pedido)
    const cy = (y0 + y1) / 2 - shiftY * scale;
    const off = new THREE.Vector3((x0 + x1) / 2, cy, 0.5).unproject(camera).sub(new THREE.Vector3(0, 0, 0.5).unproject(camera));
    target.add(off);
    dist *= scale;
  }
  place();
}

/* ------------------------------------------------------------------ */
/* Fundo e piso do card                                                 */
/* ------------------------------------------------------------------ */

const hexCss = (c: THREE.Color, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

/** Fundo do card (2D): escuro, brilho na cor do carro, faixas de neon e linhas de velocidade. */
function drawBackdrop(g: CanvasRenderingContext2D, s: number, color: number, seedText: string, horizon: number): void {
  const car = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  car.getHSL(hsl);
  // cor do brilho: a do carro, saturada e clara (branco/preto viram um azul-aço neutro)
  const glow = hsl.s < 0.15 ? new THREE.Color(0x7a9cff) : new THREE.Color().setHSL(hsl.h, Math.max(0.75, hsl.s), 0.55);
  const warm = new THREE.Color(0xff8a20);
  let seed = 7;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const bg = g.createLinearGradient(0, 0, 0, s);
  bg.addColorStop(0, '#0b0814');
  bg.addColorStop(horizon / s, '#120c1e');
  bg.addColorStop(1, '#040308');
  g.fillStyle = bg;
  g.fillRect(0, 0, s, s);

  // brilho atrás do carro (cor do carro) e um contraluz quente
  let rg = g.createRadialGradient(s * 0.55, horizon * 0.92, 0, s * 0.55, horizon * 0.92, s * 0.62);
  rg.addColorStop(0, hexCss(glow, 0.55));
  rg.addColorStop(0.45, hexCss(glow, 0.16));
  rg.addColorStop(1, hexCss(glow, 0));
  g.fillStyle = rg;
  g.fillRect(0, 0, s, s);
  rg = g.createRadialGradient(s * 0.12, s * 0.08, 0, s * 0.12, s * 0.08, s * 0.5);
  rg.addColorStop(0, hexCss(warm, 0.3));
  rg.addColorStop(1, hexCss(warm, 0));
  g.fillStyle = rg;
  g.fillRect(0, 0, s, s);

  // linhas de velocidade: riscos horizontais afinando, na cor do carro e em laranja
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const y = s * (0.12 + rnd() * 0.5);
    const len = s * (0.25 + rnd() * 0.6);
    const x = -s * 0.1 + rnd() * s * 0.9;
    const th = Math.max(1, s * (0.003 + rnd() * 0.007));
    const c = rnd() < 0.35 ? warm : glow;
    const lg = g.createLinearGradient(x, 0, x + len, 0);
    const a = 0.18 + rnd() * 0.4;
    lg.addColorStop(0, hexCss(c, 0));
    lg.addColorStop(0.7, hexCss(c, a));
    lg.addColorStop(1, hexCss(c, 0));
    g.fillStyle = lg;
    g.fillRect(x, y, len, th);
  }
  // duas faixas de neon diagonais (como as luzes da pista nos cards de referência)
  for (const [y0, c, w] of [[0.36, glow, 0.012], [0.42, warm, 0.008]] as const) {
    const lg = g.createLinearGradient(0, 0, s, 0);
    lg.addColorStop(0, hexCss(c, 0));
    lg.addColorStop(0.25, hexCss(c, 0.55));
    lg.addColorStop(0.75, hexCss(c, 0.3));
    lg.addColorStop(1, hexCss(c, 0));
    g.strokeStyle = lg;
    g.lineWidth = Math.max(1.2, s * w);
    g.shadowColor = hexCss(c, 0.9);
    g.shadowBlur = s * 0.03;
    g.beginPath();
    g.moveTo(-s * 0.05, s * y0);
    g.quadraticCurveTo(s * 0.5, s * (y0 - 0.1), s * 1.05, s * (y0 - 0.26));
    g.stroke();
  }
  g.shadowBlur = 0;
  // luzes de estádio ao longe (bokeh)
  for (let i = 0; i < 9; i++) {
    const x = rnd() * s;
    const y = s * (0.04 + rnd() * 0.22);
    const r = s * (0.008 + rnd() * 0.022);
    const bg2 = g.createRadialGradient(x, y, 0, x, y, r);
    bg2.addColorStop(0, `rgba(255,236,200,${0.25 + rnd() * 0.3})`);
    bg2.addColorStop(1, 'rgba(255,236,200,0)');
    g.fillStyle = bg2;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
}

/** Borda escura e brilho no chão, aplicados por cima da cena. */
function drawVignette(g: CanvasRenderingContext2D, s: number): void {
  const v = g.createRadialGradient(s / 2, s * 0.55, s * 0.35, s / 2, s * 0.55, s * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, s, s);
}

let floorAlpha: THREE.Texture | null = null;
let shadowTex: THREE.Texture | null = null;

/** Degradê radial (branco no centro -> preto na borda), usado como alfa. */
function radialTexture(inner: number, stops: [number, number][]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(64, 64, inner * 64, 64, 64, 64);
  for (const [o, v] of stops) rg.addColorStop(o, `rgb(${v},${v},${v})`);
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Piso escuro e brilhante (some nas bordas) + sombra de contato sob o carro. */
function makeFloor(size: THREE.Vector3, groundY: number, withFloor: boolean): THREE.Group {
  floorAlpha ??= radialTexture(0, [[0, 235], [0.45, 200], [1, 0]]);
  shadowTex ??= radialTexture(0, [[0, 255], [0.5, 190], [1, 0]]);
  const g = new THREE.Group();
  const span = Math.max(size.x, size.z);
  if (withFloor) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 4.5, span * 4.5).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0a0910, roughness: 0.22, metalness: 0.6, transparent: true, alphaMap: floorAlpha, depthWrite: false, envMapIntensity: 0.7 }),
    );
    floor.position.y = groundY;
    floor.renderOrder = 1;
    g.add(floor);
  }
  // sombra de contato: quase preta sob o carro, espalhando um pouco
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.35, size.z * 1.25).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, alphaMap: shadowTex, opacity: 0.92, depthWrite: false }),
  );
  shadow.position.y = groundY + span * 0.002;
  shadow.renderOrder = 2;
  g.add(shadow);
  return g;
}

let composeCanvas: HTMLCanvasElement | null = null;

/**
 * Posiciona a luz de estúdio em relação à câmera: principal quente à frente-direita e dois
 * recortes atrás na cor `color` (cores sem saturação viram um azul-aço).
 */
function placeStudioLights(camera: THREE.PerspectiveCamera, center: THREE.Vector3, color: number): void {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  const rimCol = hsl.s < 0.15 ? new THREE.Color(0xa8c0ff) : new THREE.Color().setHSL(hsl.h, Math.max(0.7, hsl.s), 0.62);
  const rig = carRig!;
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const camFwd = center.clone().sub(camera.position).setY(0).normalize();
  const put = (l: THREE.DirectionalLight, right: number, up: number, fwd: number) => {
    l.target.position.copy(center);
    l.position.copy(center).addScaledVector(camRight, right).addScaledVector(camFwd, fwd).add(new THREE.Vector3(0, up, 0));
  };
  put(rig.key, 5, 7, -6);
  put(rig.rimL, -7, 3, 6);
  put(rig.rimR, 7, 2.5, 7);
  rig.rimL.color.copy(rimCol);
  rig.rimR.color.copy(rimCol).lerp(new THREE.Color(0xffffff), 0.35);
}

/** Fundo dos ícones da loja: chapa escura com brilho quente sutil atrás da peça. */
function drawItemBackdrop(g: CanvasRenderingContext2D, s: number): void {
  const bg = g.createLinearGradient(0, 0, 0, s);
  bg.addColorStop(0, '#15101c');
  bg.addColorStop(1, '#060409');
  g.fillStyle = bg;
  g.fillRect(0, 0, s, s);
  const rg = g.createRadialGradient(s * 0.5, s * 0.55, 0, s * 0.5, s * 0.55, s * 0.6);
  rg.addColorStop(0, 'rgba(255,140,40,0.34)');
  rg.addColorStop(0.5, 'rgba(255,90,30,0.1)');
  rg.addColorStop(1, 'rgba(255,90,30,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, s, s);
  // reflexo de piso: elipse escura sob a peça
  const fl = g.createRadialGradient(s * 0.5, s * 0.86, 0, s * 0.5, s * 0.86, s * 0.4);
  fl.addColorStop(0, 'rgba(0,0,0,0.55)');
  fl.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.scale(1, 0.35);
  g.fillStyle = fl;
  g.fillRect(0, 0, s, s / 0.35);
  g.restore();
}

/**
 * Fundo de estúdio das miniaturas grandes de armas (aba Armas da loja): ciclorama cinza-azulado
 * que escurece até o piso, foco de luz de cima atrás da peça, brilho quente na cor da arma e
 * linha do horizonte suave onde o piso encontra a parede.
 */
function drawStudioBackdrop(g: CanvasRenderingContext2D, s: number, horizon: number, tint: string): void {
  const h = Math.max(s * 0.3, Math.min(s * 0.9, horizon));
  const wall = g.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#0c0d14');
  wall.addColorStop(0.55, '#262a38');
  wall.addColorStop(1, '#3a3f50');
  g.fillStyle = wall;
  g.fillRect(0, 0, s, h);
  const floor = g.createLinearGradient(0, h, 0, s);
  floor.addColorStop(0, '#2c303e');
  floor.addColorStop(0.35, '#15171f');
  floor.addColorStop(1, '#07080c');
  g.fillStyle = floor;
  g.fillRect(0, h, s, s - h);
  // foco de luz vindo de cima: cone suave e mancha clara no piso
  const cone = g.createLinearGradient(0, 0, 0, h);
  cone.addColorStop(0, 'rgba(255,240,220,0.0)');
  cone.addColorStop(1, 'rgba(255,240,220,0.16)');
  g.fillStyle = cone;
  g.beginPath();
  g.moveTo(s * 0.44, 0);
  g.lineTo(s * 0.56, 0);
  g.lineTo(s * 0.86, h);
  g.lineTo(s * 0.14, h);
  g.closePath();
  g.fill();
  let rg = g.createRadialGradient(s * 0.5, h * 0.8, 0, s * 0.5, h * 0.8, s * 0.55);
  rg.addColorStop(0, tint.replace('A', '0.42'));
  rg.addColorStop(0.5, tint.replace('A', '0.12'));
  rg.addColorStop(1, tint.replace('A', '0'));
  g.fillStyle = rg;
  g.fillRect(0, 0, s, s);
  g.save();
  g.translate(s * 0.5, h + (s - h) * 0.35);
  g.scale(1, 0.28);
  rg = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.5);
  rg.addColorStop(0, 'rgba(255,236,210,0.28)');
  rg.addColorStop(1, 'rgba(255,236,210,0)');
  g.fillStyle = rg;
  g.fillRect(-s, -s * 2, s * 2, s * 4);
  g.restore();
  // horizonte: filete de luz onde o piso encontra o ciclorama
  const hl = g.createLinearGradient(0, 0, s, 0);
  hl.addColorStop(0, 'rgba(200,210,255,0)');
  hl.addColorStop(0.5, 'rgba(200,210,255,0.22)');
  hl.addColorStop(1, 'rgba(200,210,255,0)');
  g.fillStyle = hl;
  g.fillRect(0, h - 1, s, Math.max(1, s * 0.006));
}

/** Cor do brilho de fundo de cada arma na vitrine (rgba com 'A' no lugar do alfa). */
const ITEM_TINT: Partial<Record<string, string>> = {
  laser: 'rgba(90,200,255,A)', missile: 'rgba(255,120,40,A)', sundog: 'rgba(255,210,60,A)', oil: 'rgba(120,150,255,A)',
  mine: 'rgba(255,60,40,A)', scatter: 'rgba(255,150,40,A)', nitro: 'rgba(90,200,255,A)', jump: 'rgba(255,160,50,A)',
};

/**
 * Cor de vitrine de cada modelo na loja (carros que ainda não são do jogador): uma cor por carro, das
 * paletas do original, para os modelos não parecerem iguais lado a lado. Marauder vermelho (a cor do
 * sprite e da capa), Dirt Devil amarelo, Air Blade laranja, Battle Trak verde militar, Havac roxo.
 */
export const SHOWROOM_COLOR: Record<string, number> = {
  dirtdevil: 0xf2c318,
  marauder: 0xe02828,
  airblade: 0xff7a1a,
  battletrak: 0x2fc840,
  havac: 0xb040e0,
};

export type CarThumbStyle = 'card' | 'transparent';

/**
 * Imagem PNG (data URL) do carro em 3/4.
 * - `card` (padrão): card de veículo com fundo escuro, neon, piso espelhado e sombra.
 * - `transparent`: mesma luz de estúdio, fundo transparente (só a sombra de contato).
 * `size` é o lado do quadrado em pixels CSS (padrão 256); a imagem sai com até 2× de densidade
 * em telas retina. Retorna '' se não houver WebGL.
 */
export function carThumbnail(vehicleId: string, color: number, size = 256, style: CarThumbStyle = 'card'): string {
  const dpr = typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;
  const px = Math.round(size * dpr);
  const key = `${vehicleId}|${color}|${px}|${style}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  const extras: THREE.Object3D[] = [];
  let car: ReturnType<typeof createCarMesh> | null = null;
  try {
    const { renderer, scene, camera } = setup();
    const card = style === 'card';
    renderer.setSize(px, px, false);
    itemRig!.visible = false;
    carRig!.group.visible = true;
    // o Battle Trak é quase todo esteira preta: mais luz e câmera mais alta (mostra o casco claro)
    const tank = vehicleId === 'battletrak';
    scene.environmentIntensity = tank ? 1.2 : 0.75;
    renderer.toneMappingExposure = tank ? 1.45 : 1.05;
    car = createCarMesh(vehicleId, color, false);
    car.animate({ spin: 0.6, steer: -0.35, speed: 0, time: 0.4, grounded: true });
    for (const f of car.flames) f.visible = false;
    car.root.rotation.y = -0.35; // frente virada para a câmera, em 3/4
    scene.add(car.root);
    const pts = visiblePoints(car.root);
    const box = new THREE.Box3().setFromPoints(pts);
    const bsize = box.getSize(new THREE.Vector3());
    const groundY = box.min.y;
    // ângulo heroico: baixo e em 3/4; carro grande, um pouco abaixo do centro (sobra céu para o brilho)
    const dir = new THREE.Vector3(1, (card ? 0.34 : 0.5) + (tank ? 0.22 : 0), 1.15);
    frame(pts, camera, dir, card ? 0.87 : 0.94, card ? -0.14 : 0);

    // luzes presas à câmera: principal quente à frente-direita, recortes na cor do carro atrás
    const center = box.getCenter(new THREE.Vector3());
    placeStudioLights(camera, center, color);

    const floor = makeFloor(bsize, groundY, card);
    scene.add(floor);
    extras.push(floor);
    if (card) {
      // reflexo: o próprio carro espelhado sob o piso semitransparente
      const mirror = car.root.clone();
      mirror.position.y = 2 * groundY - mirror.position.y;
      mirror.scale.y *= -1;
      scene.add(mirror);
      extras.push(mirror);
    }
    renderer.render(scene, camera);
    if (card) {
      composeCanvas ??= document.createElement('canvas');
      const cv = composeCanvas;
      cv.width = cv.height = px;
      const g = cv.getContext('2d')!;
      const horizon = new THREE.Vector3(center.x, groundY, center.z).project(camera);
      drawBackdrop(g, px, color, vehicleId, ((1 - horizon.y) / 2) * px);
      g.drawImage(renderer.domElement, 0, 0);
      drawVignette(g, px);
      url = cv.toDataURL('image/webp', 0.9);
      if (!url.startsWith('data:image/webp')) url = cv.toDataURL('image/png');
    } else {
      url = renderer.domElement.toDataURL('image/png');
    }
  } catch {
    url = '';
  } finally {
    for (const e of extras) scene?.remove(e);
    // o espelho compartilha geometrias e materiais com o carro: só descarta o piso
    if (extras[0]) disposeTree(extras[0]);
    if (car) {
      scene?.remove(car.root);
      disposeTree(car.root);
    }
  }
  if (url) cache.set(key, url); // falha não fica no cache: tenta de novo na próxima tela
  return url;
}

/** Itens da loja com miniatura 3D: armas do original e as quatro melhorias. */
export type ShopItem =
  | 'laser' | 'missile' | 'sundog' | 'oil' | 'mine' | 'scatter' | 'nitro' | 'jump'
  | 'engine' | 'tires' | 'shocks' | 'armor';

/** Monta a peça da loja com as mesmas peças que aparecem nos carros (Kit). */
function buildItem(item: ShopItem): THREE.Group {
  const g = new THREE.Group();
  const k = new Kit(0xd8281c, false, g);
  // na loja, as partes "na cor do time" são pintura vermelha com verniz, não neon
  // (o neon estourava para rosa). Os materiais são deste Kit e são descartados depois.
  k.accent.color.copy(k.paint.color);
  k.accent.emissive.setHex(0x3a0402);
  k.accent.emissiveIntensity = 1;
  k.accent.roughness = 0.5;
  k.accent.metalness = 0.15;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c });
  switch (item) {
    case 'laser':
      k.plasmaRifle(-0.2, 0, 0, 1.3);
      k.plasmaRifle(0.2, 0, 0, 1.3);
      k.add(new THREE.BoxGeometry(0.7, 0.1, 0.5), k.trim, 0, -0.12, -0.2);
      // disparos de plasma saindo dos canos
      for (const x of [-0.2, 0.2]) {
        k.add(new THREE.CapsuleGeometry(0.06, 0.34, 4, 10).rotateX(Math.PI / 2), glow(0xbff4ff), x, 0.02, 1.35 + (x > 0 ? 0.25 : 0));
        k.add(new THREE.CapsuleGeometry(0.1, 0.4, 4, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3ab8ff, transparent: true, opacity: 0.45, depthWrite: false }), x, 0.02, 1.35 + (x > 0 ? 0.25 : 0));
      }
      break;
    case 'missile':
      k.missilePod(0, 0, 0, 1.2);
      // um míssil saindo do casulo
      k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 12).rotateX(Math.PI / 2), k.steel, 0.35, 0.25, 0.6);
      k.add(new THREE.ConeGeometry(0.07, 0.2, 12).rotateX(Math.PI / 2), k.tail, 0.35, 0.25, 1.05);
      for (const r of [0, Math.PI / 2]) k.add(new THREE.BoxGeometry(0.28, 0.02, 0.14), k.warn, 0.35, 0.25, 0.3).rotation.z = r;
      break;
    case 'sundog':
      k.sundogEmitter(0, 0, 0, 0.45);
      break;
    case 'oil':
      k.slipsauceTank(0, 0.3, 0, 1.0);
      k.add(new THREE.CylinderGeometry(0.7, 0.8, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.05, metalness: 0.4 }), 0, -0.05, -0.5);
      break;
    case 'mine': {
      k.add(new THREE.CylinderGeometry(0.4, 0.45, 0.2, 16), k.gunMetal, 0, 0, 0);
      k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), k.tail, 0, 0.13, 0);
      const claw = new THREE.ConeGeometry(0.06, 0.3, 6);
      for (let i = 0; i < 8; i++) {
        const r = (i / 8) * Math.PI * 2;
        const m = k.add(claw, k.chrome, Math.cos(r) * 0.5, 0.02, Math.sin(r) * 0.5);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), V(Math.cos(r), 0.3, Math.sin(r)).normalize());
      }
      break;
    }
    case 'scatter':
      k.scatterpack(0, 0, 0);
      for (let i = 0; i < 3; i++) k.add(new THREE.SphereGeometry(0.1, 10, 8), k.tail, -0.4 + i * 0.4, -0.05, -0.7 - (i % 2) * 0.2);
      break;
    case 'nitro':
      for (const x of [-0.18, 0.18]) {
        k.add(new THREE.CylinderGeometry(0.16, 0.16, 1.0, 16).rotateX(Math.PI / 2), k.accent, x, 0, 0);
        k.add(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16).rotateX(Math.PI / 2), k.warn, x, 0, 0.2);
        k.add(new THREE.CylinderGeometry(0.08, 0.12, 0.2, 12).rotateX(Math.PI / 2), k.chrome, x, 0, -0.58);
      }
      k.add(new THREE.ConeGeometry(0.16, 0.9, 12).rotateX(-Math.PI / 2), glow(0x7ad8ff), 0, 0, -1.1);
      break;
    case 'jump':
      for (const x of [-0.3, 0.3]) {
        k.jumpJet(x, 0, 0);
        k.add(new THREE.ConeGeometry(0.14, 0.6, 12).rotateX(Math.PI), glow(0xffa040), x, -0.5, 0);
      }
      k.add(new THREE.BoxGeometry(1.0, 0.08, 0.5), k.trim, 0, 0.18, 0);
      break;
    case 'engine':
      k.add(new THREE.BoxGeometry(0.8, 0.5, 1.0), k.gunMetal, 0, 0, 0);
      for (const x of [-0.26, 0.26]) {
        k.add(new THREE.BoxGeometry(0.22, 0.14, 0.9), k.accent, x, 0.32, 0);
        for (let i = 0; i < 4; i++) k.tube(V(x * 1.6, 0.05, -0.33 + i * 0.22), V(x * 2.4, -0.15, -0.33 + i * 0.22), 0.04, k.chrome);
      }
      k.add(new THREE.BoxGeometry(0.46, 0.3, 0.46), k.chrome, 0, 0.5, 0.1);
      k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12), k.trim, 0, 0.72, 0.1);
      break;
    case 'tires':
      wheel(k, { radius: 0.6, width: 0.5, spokes: 6, knobby: true }, 0, 0, 0).pivot.rotation.y = 0.5;
      break;
    case 'shocks': {
      k.add(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 10), k.chrome, 0, 0, 0);
      k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 12), k.gunMetal, 0, -0.35, 0);
      const coil = new THREE.TorusGeometry(0.2, 0.035, 6, 16);
      for (let i = 0; i < 7; i++) k.add(coil, k.warn, 0, -0.25 + i * 0.1, 0).rotation.x = Math.PI / 2 + 0.12;
      for (const y of [-0.72, 0.72]) k.add(new THREE.TorusGeometry(0.1, 0.04, 8, 14), k.steel, 0, y, 0);
      break;
    }
    case 'armor':
      k.plate(1.0, 1.2, 0, 0, 0, 0.9, 0);
      k.plate(0.8, 1.0, 0.1, -0.1, -0.25, 0.9, 0.2);
      k.add(new THREE.BoxGeometry(0.9, 0.08, 1.1), k.accent, -0.05, 0.08, 0.08).rotation.x = 0.9;
      break;
  }
  return g;
}

/** Miniatura 3D de uma arma ou melhoria da loja (luz de estúdio sobre fundo escuro). Em cache por item e tamanho. */
export function itemThumbnail(item: ShopItem, size = 96): string {
  const key = `item|${item}|${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const { renderer, scene, camera } = setup();
    const dpr = typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;
    const px = Math.round(size * dpr);
    renderer.setSize(px, px, false);
    itemRig!.visible = false;
    carRig!.group.visible = true;
    // peças pequenas e escuras (metal): mais reflexo e exposição que os carros
    scene.environmentIntensity = 1.2;
    renderer.toneMappingExposure = size >= 140 ? 1.55 : 1.3;
    const obj = buildItem(item);
    obj.rotation.y = -0.6;
    scene.add(obj);
    const pts = visiblePoints(obj);
    // vitrine (miniaturas grandes): piso espelhado, sombra de contato e fundo de estúdio
    const studio = size >= 140;
    const box = new THREE.Box3().setFromPoints(pts);
    const center = box.getCenter(new THREE.Vector3());
    frame(pts, camera, studio ? new THREE.Vector3(1, 0.42, 1.1) : new THREE.Vector3(0.9, 0.62, 1), studio ? 0.86 : 0.8, studio ? -0.08 : 0);
    placeStudioLights(camera, center, 0xff7a20);
    const extras: THREE.Object3D[] = [];
    if (studio) {
      const groundY = box.min.y - 0.02;
      const floor = makeFloor(box.getSize(new THREE.Vector3()), groundY, true);
      const mirror = obj.clone();
      mirror.position.y = 2 * groundY - mirror.position.y;
      mirror.scale.y *= -1;
      scene.add(floor, mirror);
      extras.push(floor, mirror);
    }
    renderer.render(scene, camera);
    composeCanvas ??= document.createElement('canvas');
    const cv = composeCanvas;
    cv.width = cv.height = px;
    const g = cv.getContext('2d')!;
    if (studio) {
      const hz = new THREE.Vector3(center.x, box.min.y, center.z - 1.5).project(camera);
      drawStudioBackdrop(g, px, ((1 - hz.y) / 2) * px, ITEM_TINT[item] ?? 'rgba(255,140,40,A)');
    } else drawItemBackdrop(g, px);
    g.drawImage(renderer.domElement, 0, 0);
    drawVignette(g, px);
    url = cv.toDataURL('image/webp', 0.9);
    if (!url.startsWith('data:image/webp')) url = cv.toDataURL('image/png');
    for (const e of extras) scene.remove(e);
    if (extras[0]) disposeTree(extras[0]);
    scene.remove(obj);
    disposeTree(obj);
  } catch {
    url = '';
  }
  if (url) cache.set(key, url); // falha não fica no cache: tenta de novo na próxima tela
  return url;
}

/** Descarta o renderizador fora da tela e o cache de imagens. */
export function disposeThumbnails(): void {
  cache.clear();
  envTex?.dispose();
  envTex = null;
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
  scene = null;
  camera = null;
  itemRig = null;
  carRig = null;
  floorAlpha?.dispose();
  shadowTex?.dispose();
  floorAlpha = shadowTex = null;
}
