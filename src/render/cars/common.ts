import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit } from './kit';

export { Kit } from './kit';

/** Estado usado para animar o modelo a cada quadro. */
export interface CarAnim {
  /** rotação acumulada das rodas (rad) */
  spin: number;
  steer: number;
  /** velocidade para frente (m/s) */
  speed: number;
  time: number;
  grounded: boolean;
  /**
   * Suspensão visual já aplicada à carroceria pelo jogo (rad), derivada das acelerações lateral
   * (curva) e longitudinal (arranque/freada). Opcional: vitrine e miniaturas não passam.
   */
  roll?: number;
  pitch?: number;
}

export interface CarVisual {
  root: THREE.Group;
  /** carroceria (balança com a suspensão) — filha de root */
  body: THREE.Group;
  /** partes escondidas na câmera de cockpit (teto/cabine) */
  cabin: THREE.Object3D[];
  /** painel, volante e colunas, visíveis só na câmera de cockpit */
  cockpit: THREE.Group;
  steeringWheel: THREE.Object3D;
  /** chamas do nitro */
  flames: THREE.Mesh[];
  /** olhos do piloto, em coordenadas locais do carro (+z = frente) */
  eye: THREE.Vector3;
  animate(a: CarAnim): void;
}

/**
 * Cria uma peça a partir de um perfil lateral (u = comprimento, v = altura),
 * extrudada na largura com chanfro — formas bem mais realistas que caixas.
 */
export function sideProfile(shape: THREE.Shape, width: number, bevel: number, curveSegments = 16): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments,
  });
  geo.rotateY(-Math.PI / 2); // perfil vira o comprimento (z), extrusão vira a largura (x)
  geo.translate(Math.max(0.01, width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Monta um perfil a partir de uma lista de pontos (u, v). */
export function polyShape(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach(([u, v], i) => (i === 0 ? s.moveTo(u, v) : s.lineTo(u, v)));
  s.closePath();
  return s;
}

/** Roda para o cálculo de folga: centro (x > 0, espelhado do outro lado) e esterço máximo (rad). */
export interface TireSpot {
  x: number;
  y: number;
  z: number;
  steer: number;
}

/**
 * Espaço que o pneu (raio `r` com cravos, meia-largura `hw`) ocupa em qualquer esterço, na altura `y`
 * e na posição `z`: devolve o intervalo [dentro, fora] de |x| ocupado, ou null se o pneu não chega
 * ali. Serve para abrir caixas de roda (carroceria e bandeja nunca atravessadas pelo pneu).
 */
export function tireSpan(tires: TireSpot[], r: number, hw: number, y: number, z: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of tires) {
    const h = y - t.y;
    if (Math.abs(h) >= r) continue;
    const c = Math.sqrt(r * r - h * h); // meio-comprimento do corte horizontal do pneu
    const dz = z - t.z;
    const steps = t.steer > 0 ? 16 : 0;
    for (let i = 0; i <= steps; i++) {
      const th = steps ? -t.steer + (2 * t.steer * i) / steps : 0;
      const sn = Math.sin(th);
      const cs = Math.cos(th);
      // pneu = retângulo |a| <= c (rolagem) x |ax| <= hw (eixo), girado de th; corte na reta z = dz
      let amin = -hw;
      let amax = hw;
      if (Math.abs(sn) < 1e-6) {
        if (Math.abs(dz) > c) continue;
      } else {
        const p = (-c * cs - dz) / sn;
        const q = (c * cs - dz) / sn;
        amin = Math.max(amin, Math.min(p, q));
        amax = Math.min(amax, Math.max(p, q));
        if (amin > amax) continue;
      }
      const tn = sn / cs;
      lo = Math.min(lo, t.x + amin / cs + dz * tn, t.x + amax / cs + dz * tn);
      hi = Math.max(hi, t.x + amin / cs + dz * tn, t.x + amax / cs + dz * tn);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Abre caixas de roda numa malha já posicionada no carro (offset `oy` em y): vértices que o pneu
 * ocuparia são empurrados para dentro (|x| menor) até ficar `gap` longe dele.
 */
export function carveTires(geo: THREE.BufferGeometry, tires: TireSpot[], r: number, hw: number, gap: number, oy = 0, cell = 0.08): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + oy;
    const z = pos.getZ(i);
    // olha também a vizinhança (~1 face): a face entre um vértice empurrado e um não empurrado
    // é reta e cortaria o pneu na borda da caixa de roda
    let span: [number, number] | null = null;
    for (const dy of [-cell, 0, cell])
      for (const dz of [-cell, 0, cell]) {
        const s = tireSpan(tires, r + gap, hw + gap, y + dy, z + dz);
        if (s) span = span ? [Math.min(span[0], s[0]), Math.max(span[1], s[1])] : s;
      }
    if (!span) continue;
    const ax = Math.abs(x);
    if (ax > span[0] && ax < span[1] + gap) pos.setX(i, Math.sign(x) * Math.max(0, span[0]));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export interface WheelOpts {
  radius: number;
  width: number;
  spokes?: number;
  /** pneu de terra (cravos) */
  knobby?: boolean;
}

/** Roda com pneu arredondado e aro. Retorna o pivô (esterça) e a roda (gira). */
export function wheel(kit: Kit, o: WheelOpts, x: number, y: number, z: number): { pivot: THREE.Group; spin: THREE.Group } {
  const r = o.radius;
  const hw = o.width / 2;
  const tireGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(r * 0.58, -hw),
      new THREE.Vector2(r * 0.88, -hw),
      new THREE.Vector2(r * 0.98, -hw * 0.7),
      new THREE.Vector2(r, 0),
      new THREE.Vector2(r * 0.98, hw * 0.7),
      new THREE.Vector2(r * 0.88, hw),
      new THREE.Vector2(r * 0.58, hw),
    ],
    32,
  );
  tireGeo.rotateZ(Math.PI / 2);
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const spin = new THREE.Group();
  const tire = new THREE.Mesh(tireGeo, kit.rubber);
  tire.castShadow = kit.shadows;
  spin.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, o.width * 0.8, 20).rotateZ(Math.PI / 2), kit.gunMetal);
  spin.add(rim);
  // calota na cor do carro, dos dois lados
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.34, o.width * 0.86, 14).rotateZ(Math.PI / 2), kit.paint);
  spin.add(hub);
  const side = Math.sign(x) || 1;
  const n = o.spokes ?? 5;
  for (let k = 0; k < n; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, r * 1.05, 0.07), kit.chrome);
    spoke.position.x = side * hw * 0.85;
    spoke.rotation.x = (k / n) * Math.PI;
    spin.add(spoke);
  }
  if (o.knobby) {
    // cravos em V (chevron) do pneu off-road, numa única malha
    spin.add(new THREE.Mesh(chevronTread(r, o.width), kit.rubber));
  }
  pivot.add(spin);
  kit.body.add(pivot);
  return { pivot, spin };
}

const treadCache = new Map<string, THREE.BufferGeometry>();

/** Banda de rodagem com cravos em V: cada cravo são dois braços inclinados que se encontram no meio. */
/** `lug`: altura do cravo (padrão 0,09); `count`: cravos na volta (padrão ~22 por metro de raio). */
export function chevronTread(r: number, width: number, lug = 0.09, count?: number): THREE.BufferGeometry {
  const key = `${r}:${width}:${lug}:${count}`;
  const hit = treadCache.get(key);
  if (hit) return hit;
  const n = count ?? Math.max(14, Math.round(r * 22));
  const arm = width * 0.5;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const side of [-1, 1]) {
      // braço deitado sobre o topo do pneu (y = r), girado em torno do eixo radial, depois levado ao ângulo a
      const g = new THREE.BoxGeometry(arm, lug, 0.11 + (lug - 0.09) * 0.8);
      g.translate((side * arm) / 2, 0, 0);
      g.rotateY(side * 0.5);
      g.translate(0, r * 0.985 + (lug - 0.09) / 2, 0);
      g.rotateX(a);
      parts.push(g.toNonIndexed());
    }
  }
  const merged = mergeGeometries(parts, false)!;
  merged.computeVertexNormals();
  treadCache.set(key, merged);
  return merged;
}

/** Arma que aparece no capô na vista de cockpit (lembra o que o carro dispara). */
export type HoodWeapon = 'plasma' | 'missiles' | 'sundog' | 'none';

export interface CockpitOpts {
  eye: THREE.Vector3;
  /** meia-largura do capô visto de dentro */
  halfWidth: number;
  /** comprimento do capô à frente do painel */
  hoodLength?: number;
  weapon?: HoodWeapon;
  /** material do capô (padrão: pintura do carro, com verniz mais contido) */
  hoodMat?: THREE.Material;
  /** listras diagonais brancas no capô (quantidade; 0 = sem) */
  stripes?: number;
  /** saia tubular preta contornando o bico (hovercraft) */
  skirt?: boolean;
  /** tomada de ar no meio do capô (padrão: sim) */
  intake?: boolean;
}

/**
 * Superfície do capô em coordenadas do cockpit: altura (relativa aos olhos) em função do lado x
 * e da fração t do comprimento. Abaulado no meio, dois vincos longitudinais, bordas arredondadas
 * que caem para os lados e o bico que mergulha na frente.
 */
function hoodHeight(x: number, t: number, hw: number): number {
  const ax = Math.min(1, Math.abs(x) / hw);
  let y = t < 0.55 ? -0.46 - (0.1 * t) / 0.55 : -0.56 - 0.34 * ((t - 0.55) / 0.45) ** 2;
  y += 0.055 * (1 - ax * ax);
  // vincos: filetes altos e estreitos a ~45% da meia-largura (pegam a luz de lado)
  const cr = (ax - 0.46) / 0.035;
  y += 0.02 * Math.exp(-cr * cr);
  if (ax > 0.84) y -= 0.3 * ((ax - 0.84) / 0.16) ** 2;
  return y;
}

/** Malha que acompanha a superfície do capô: (u, v) em [0,1]² -> (x, t) via `at`, a `lift` acima. */
function hoodPatch(hw: number, L: number, z0: number, eyeY: number, nu: number, nv: number, lift: number, at: (u: number, v: number) => [number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const [x, t] = at(i / nu, j / nv);
      pos.push(x, eyeY + hoodHeight(x, t, hw) + lift, z0 + t * L);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Vista de dentro, igual para todos os carros: o exterior inteiro some (ver `cabin`) e fica só
 * um capô baixo na cor do carro, o painel e o volante. Nada acima da linha dos olhos: a pista
 * fica sempre livre, qualquer que seja a forma do carro.
 */
export function cockpitRig(kit: Kit, o: CockpitOpts, parent: THREE.Object3D = kit.body): { cockpit: THREE.Group; steeringWheel: THREE.Group; emitter: THREE.Group | null } {
  const cockpit = new THREE.Group();
  cockpit.visible = false;
  parent.add(cockpit);
  const e = o.eye;
  const hw = o.halfWidth;
  const L = o.hoodLength ?? 1.9;
  const z0 = e.z + 0.5;
  // pintura do capô: metal com verniz fosco (sem o espelho do carro visto de fora, que de dentro
  // virava um clarão chapado no meio do capô)
  let hoodMat = o.hoodMat;
  if (!hoodMat) {
    const hp = kit.paint.clone();
    hp.metalness = 0.35;
    hp.roughness = 0.55;
    hp.clearcoat = 0.2;
    hp.clearcoatRoughness = 0.45;
    hp.envMapIntensity = 0.5;
    hoodMat = hp;
  }
  const noShadow = <T extends THREE.Mesh>(m: T): T => {
    m.castShadow = false;
    return m;
  };
  // capô: superfície abaulada com vincos, bordas arredondadas e bico caído
  noShadow(kit.add(hoodPatch(hw, L, z0, e.y, 28, 22, 0, (u, v) => [(u * 2 - 1) * hw, v]), hoodMat, 0, 0, 0, cockpit));
  // borda do bico: friso escuro de borracha acompanhando a frente
  const lip = new THREE.CatmullRomCurve3(
    Array.from({ length: 13 }, (_, k) => {
      const x = ((k / 12) * 2 - 1) * hw * 0.98;
      return new THREE.Vector3(x, e.y + hoodHeight(x, 1, hw) - 0.01, z0 + L - 0.015);
    }),
  );
  noShadow(kit.add(new THREE.TubeGeometry(lip, 24, 0.028, 6, false), kit.trim, 0, 0, 0, cockpit));
  // para-lamas: lombadas nas laterais, acima da linha do capô (a forma do carro vista de dentro)
  const fenderGeo = new THREE.CapsuleGeometry(0.2, L * 0.6, 6, 16).rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const fx = sx * (hw - 0.13);
    const f = kit.add(fenderGeo, hoodMat, fx, e.y + hoodHeight(fx, 0.45, hw) - 0.1, z0 + L * 0.45, cockpit);
    f.scale.set(0.9, 0.75, 1);
    f.rotation.x = 0.09;
    noShadow(f);
    // farol na ponta de cada para-lama (domo cromado com a lâmpada acesa)
    const hy = e.y + hoodHeight(fx, 0.78, hw) - 0.02;
    kit.add(new THREE.SphereGeometry(0.1, 14, 10), kit.chrome, fx, hy, z0 + L * 0.78, cockpit).scale.set(1, 0.6, 1);
    kit.add(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff4c8 }), fx, hy + 0.012, z0 + L * 0.785, cockpit).scale.set(1, 0.6, 1);
  }
  // tomada de ar no meio do capô: moldura na cor do carro, boca preta e aletas cromadas
  if (o.intake ?? true) {
    const iz = z0 + L * 0.3;
    const iy = e.y + hoodHeight(0, 0.3, hw);
    const scoop = kit.add(new THREE.BoxGeometry(0.46, 0.09, 0.5), hoodMat, 0, iy + 0.02, iz, cockpit);
    scoop.rotation.x = 0.12;
    noShadow(scoop);
    const mouth = kit.add(new THREE.BoxGeometry(0.38, 0.055, 0.04), kit.dash, 0, iy + 0.04, iz + 0.255, cockpit);
    mouth.rotation.x = 0.12;
    for (const dy of [-0.012, 0.012]) kit.add(new THREE.BoxGeometry(0.36, 0.008, 0.02), kit.chrome, 0, iy + 0.04 + dy, iz + 0.27, cockpit).rotation.x = 0.12;
  }
  // listras diagonais brancas (paralelogramos que acompanham a curva do capô)
  const n = o.stripes ?? 0;
  if (n > 0) {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.4, metalness: 0.1 });
    const sw = 0.1;
    for (let k = 0; k < n; k++) {
      const x0 = (k - (n - 1) / 2) * sw * 2.1 - 0.12;
      noShadow(kit.add(hoodPatch(hw, L, z0, e.y, 2, 10, 0.006, (u, v) => [x0 + (u - 0.5) * sw + (v - 0.5) * 0.34, 0.18 + v * 0.5]), white, 0, 0, 0, cockpit));
    }
  }
  // saia tubular preta contornando os lados e o bico (hovercraft)
  if (o.skirt) {
    const pts: THREE.Vector3[] = [];
    const R = hw + 0.08;
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI; // de um lado, pela frente, ao outro
      const x = -Math.cos(a) * R;
      const t = Math.min(1, 0.25 + Math.sin(a) * 0.8);
      pts.push(new THREE.Vector3(x, e.y + hoodHeight(Math.sign(x) * Math.min(hw, Math.abs(x)), t, hw) - 0.1, z0 + (0.25 + Math.sin(a) * 0.8) * L));
    }
    noShadow(kit.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.15, 12, false), kit.rubber, 0, 0, 0, cockpit));
  }
  // friso cromado na borda do painel (separa o capô do interior)
  kit.add(new THREE.CylinderGeometry(0.025, 0.025, hw * 2, 10).rotateZ(Math.PI / 2), kit.chrome, 0, e.y - 0.45, z0 + 0.02, cockpit);
  // painel: faixa baixa e fina, com dois mostradores acesos
  kit.add(new THREE.BoxGeometry(hw * 2, 0.1, 0.28), kit.dash, 0, e.y - 0.43, e.z + 0.42, cockpit).rotation.x = 0.2;
  const gaugeGeo = new THREE.CircleGeometry(0.04, 18);
  kit.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0x3aff7a }), -0.12, e.y - 0.37, e.z + 0.33, cockpit).rotation.set(-0.35, Math.PI, 0);
  kit.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0xff8a3a }), 0.12, e.y - 0.37, e.z + 0.33, cockpit).rotation.set(-0.35, Math.PI, 0);
  // volante: só o arco de cima aparece, como num jogo de corrida
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, e.y - 0.36, e.z + 0.42);
  steeringWheel.rotation.x = -0.5;
  cockpit.add(steeringWheel);
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 28), kit.trim));
  steeringWheel.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.02), kit.trim));
  const top = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.024, 8, 10, Math.PI * 0.35), kit.accent);
  top.rotation.z = Math.PI * 0.325;
  steeringWheel.add(top);
  // arma no capô (sempre por cima da superfície, para aparecer na faixa de baixo da tela)
  const w = o.weapon ?? 'none';
  let emitter: THREE.Group | null = null;
  const surf = (x: number, t: number) => e.y + hoodHeight(x, t, hw);
  if (w === 'plasma') {
    for (const sx of [-1, 1]) {
      const x = sx * hw * 0.62;
      const gy = surf(x, 0.35) + 0.08;
      kit.add(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 10).rotateX(Math.PI / 2), kit.gunMetal, x, gy, z0 + 0.75, cockpit);
      kit.add(new THREE.BoxGeometry(0.18, 0.12, 0.35), kit.gunMetal, x, gy - 0.02, z0 + 0.25, cockpit);
      kit.add(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).rotateX(Math.PI / 2), kit.plasmaGlow, x, gy, z0 + 1.22, cockpit);
    }
  } else if (w === 'missiles') {
    for (const sx of [-1, 1]) {
      const x = sx * hw * 0.55;
      const gy = surf(x, 0.35) + 0.1;
      kit.add(new THREE.BoxGeometry(0.3, 0.2, 0.8), kit.gunMetal, x, gy, z0 + 0.7, cockpit);
      kit.add(new THREE.BoxGeometry(0.31, 0.05, 0.12), kit.warn, x, gy + 0.08, z0 + 0.45, cockpit);
      for (const dx of [-0.07, 0.07]) kit.add(new THREE.ConeGeometry(0.05, 0.16, 8).rotateX(Math.PI / 2), kit.tail, x + dx, gy, z0 + 1.17, cockpit);
    }
  } else if (w === 'sundog') {
    // emissor Sundog no bico: só o pedestal baixo fica à vista. O aro, o sol e os raios ficam num
    // grupo à parte (`emitter`), que o carro põe em `cabin`: na câmera de cockpit eles tapavam o
    // meio da pista
    const t = 0.8;
    const zz = z0 + L * t;
    const gy = surf(0, t) + 0.16;
    kit.add(new THREE.CylinderGeometry(0.07, 0.11, 0.16, 12), kit.gunMetal, 0, gy - 0.1, zz, cockpit);
    emitter = new THREE.Group();
    cockpit.add(emitter);
    kit.add(new THREE.TorusGeometry(0.15, 0.03, 8, 24), kit.chrome, 0, gy, zz, emitter);
    // (brilho contido: colado na câmera, o emissivo forte estourava o bloom e cobria a tela)
    const core = new THREE.MeshStandardMaterial({ color: 0xffc040, emissive: 0xff9020, emissiveIntensity: 1.1, roughness: 0.4 });
    kit.add(new THREE.SphereGeometry(0.075, 16, 12), core, 0, gy, zz, emitter);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const ray = kit.add(new THREE.ConeGeometry(0.022, 0.09, 5), kit.gunMetal, Math.cos(a) * 0.2, gy + Math.sin(a) * 0.2, zz, emitter);
      ray.rotation.z = a - Math.PI / 2;
    }
  }
  return { cockpit, steeringWheel, emitter };
}

/**
 * Esqueleto comum: `root` (posição/rotação do carro) > `body` (balanço da suspensão) >
 * `ext` (todo o exterior, escondido na câmera de cockpit). `chassis` (filho de root, irmão de
 * `body`) leva rodas/esteiras e eixos: a carroceria balança por cima deles (suspensão real) e eles
 * ficam no chão. Vai também na lista `cabin` (some no cockpit).
 */
export function carFrame(): { root: THREE.Group; body: THREE.Group; ext: THREE.Group; chassis: THREE.Group } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const ext = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(body, chassis);
  body.add(ext);
  return { root, body, ext, chassis };
}

/**
 * Curso da suspensão: devolve o deslocamento vertical (m, ≤ 0) do grupo das rodas. No ar as rodas
 * descem até `travel` abaixo da carroceria; ao tocar o chão voltam com uma mola amortecida.
 * Usa `a.time` para o passo; salto no tempo (vitrine, sondagem do merge) zera o estado.
 */
export function wheelTravel(travel: number): (a: CarAnim) => number {
  let y = 0;
  let v = 0;
  let t = -Infinity;
  return (a) => {
    const dt = a.time - t;
    t = a.time;
    if (!(dt > 0 && dt < 0.25)) {
      y = 0;
      v = 0;
      return 0;
    }
    const h = Math.min(dt, 0.05);
    const target = a.grounded ? 0 : -travel;
    v += ((target - y) * 160 - v * 16) * h;
    // curso limitado: a roda nunca sobe acima do repouso (entrava no para-lama, item 51) nem desce
    // além do curso (os braços descolavam)
    const ny = y + v * h;
    y = Math.max(-travel, Math.min(0, ny));
    if (y !== ny) v = 0;
    return y;
  };
}

/**
 * Quanto a carroceria desceu sobre as rodas no quadro anterior (m, ≥ 0), no canto mais baixo:
 * pouso (body.position.y < 0) mais inclinação da curva/freada nos cantos (±wx, ±wz). O jogo aplica
 * esse balanço depois de `animate`; usar o do quadro anterior basta para as rodas acompanharem.
 */
export function bodySink(body: THREE.Object3D, wx: number, wz: number): number {
  return Math.max(0, -body.position.y + Math.abs(body.rotation.z) * wx + Math.abs(body.rotation.x) * wz);
}

/**
 * Altura do grupo das rodas: curso da suspensão (`travelY`, ≤ 0) e, se a carroceria afundar mais que a
 * folga do arco (`gap`), as rodas descem junto — o pneu nunca atravessa o para-lama/bandeja.
 */
export function wheelDrop(travelY: number, sink: number, gap: number): number {
  return Math.min(travelY, Math.min(0, gap - sink));
}

const unitRod = new Map<number, THREE.CylinderGeometry>();

/**
 * Braços e amortecedores que ligam a carroceria (`body`, que balança) às rodas (`chassis`, que sobe e
 * desce): cada barra é recalculada a cada quadro entre o ponto na bandeja e o cubo da roda, então nunca
 * descola com a suspensão, o pouso ou a inclinação. Fica num grupo próprio sob `root` (vai em `cabin`,
 * some no cockpit); as barras têm onBeforeRender, então o mergeStatic não as junta.
 */
export class Linkage {
  readonly group = new THREE.Group();
  private rods: { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private readonly pa = new THREE.Vector3();
  private readonly pb = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(
    root: THREE.Object3D,
    private readonly body: THREE.Object3D,
    private readonly chassis: THREE.Object3D,
    private readonly shadows: boolean,
  ) {
    root.add(this.group);
  }

  /** Barra de raio `r` entre `a` (coordenadas da carroceria) e `b` (coordenadas do grupo das rodas). */
  add(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
    const key = Math.round(r * 1000);
    let geo = unitRod.get(key);
    if (!geo) unitRod.set(key, (geo = new THREE.CylinderGeometry(r, r, 1, 8)));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = this.shadows;
    mesh.frustumCulled = false;
    // matriz local escrita à mão (place): o three só a multiplica pela do grupo
    mesh.matrixAutoUpdate = false;
    const rod = { mesh, a: a.clone(), b: b.clone() };
    const place = () => this.place(rod);
    mesh.onBeforeRender = place;
    mesh.onBeforeShadow = place;
    this.group.add(mesh);
    this.rods.push(rod);
    this.place(rod);
    return mesh;
  }

  /** Recoloca a barra entre os dois pontos com as matrizes atuais (chamado na hora de desenhar). */
  private place(rod: { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3 }): void {
    const { body, chassis } = this;
    body.updateMatrix();
    chassis.updateMatrix();
    this.pa.copy(rod.a).applyMatrix4(body.matrix);
    this.pb.copy(rod.b).applyMatrix4(chassis.matrix);
    const len = this.pa.distanceTo(this.pb);
    this.s.set(1, Math.max(1e-4, len), 1);
    this.q.setFromUnitVectors(Linkage.UP, this.pb.sub(this.pa).normalize());
    this.pa.addScaledVector(this.pb, len / 2); // pb virou a direção: pa = ponto médio
    this.m.compose(this.pa, this.q, this.s);
    const mesh = rod.mesh;
    mesh.matrix.copy(this.m);
    mesh.matrixWorld.multiplyMatrices(this.group.matrixWorld, this.m);
  }
}

/** Textura de esteira (para o Battle Trak), com rolagem por offset. */
export function treadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, y, 64, 18);
    ctx.fillStyle = '#555';
    ctx.fillRect(4, y + 2, 56, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
