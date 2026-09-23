import * as THREE from 'three';
import { carFrame, cockpitRig, Kit, sideProfile, wheel, type CarVisual } from './common';

const WR = 0.86; // rodas de monster truck, como nos sprites do original
const WX = 0.98; // centro das rodas
const WZF = 1.38;
const WZR = -1.32;
const CH = 1.08; // topo do chassi (bandeja) — a carroceria fica acima, sobre as rodas
const ROCK = 1.42; // borda de baixo da carroceria (soleira)

/* ------------------------------------------------------------------ */
/* Loft: superfície lisa a partir de seções transversais ao longo de z   */
/* ------------------------------------------------------------------ */

interface Sec {
  /** meia-largura embaixo */
  w: number;
  /** fator da meia-largura no topo (caimento lateral / tumblehome) */
  wt: number;
  yb: number;
  yt: number;
  /** expoente da superelipse (2 = elipse, maior = mais "quadrado") */
  n: number;
  /** abaulado do topo */
  crown: number;
}

/** Interpolação suave (Catmull-Rom) de uma tabela [z, valor]. */
function curve(pts: [number, number][]): (z: number) => number {
  return (z) => {
    if (z <= pts[0][0]) return pts[0][1];
    const last = pts.length - 1;
    if (z >= pts[last][0]) return pts[last][1];
    let i = 0;
    while (z > pts[i + 1][0]) i++;
    const p0 = pts[Math.max(0, i - 1)][1];
    const p1 = pts[i][1];
    const p2 = pts[i + 1][1];
    const p3 = pts[Math.min(last, i + 2)][1];
    const t = (z - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Casca fechada e lisa: anéis de superelipse ao longo de z, com pontas arredondadas
 * (raio `round`) — o jeito de ter volumes de "brinquedo premium" sem caixas.
 */
function loft(z0: number, z1: number, f: (z: number) => Sec, rings = 56, ringN = 36, round = 0.2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const L = z1 - z0;
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1);
    // mais anéis perto das pontas (arredondamento)
    const z = z0 + L * (0.5 - 0.5 * Math.cos(Math.PI * u));
    const s = f(z);
    const d = Math.min(z - z0, z1 - z);
    const k = d >= round ? 1 : Math.sqrt(Math.max(0.0004, 1 - (1 - d / round) ** 2));
    const yc = (s.yb + s.yt) / 2;
    for (let j = 0; j < ringN; j++) {
      const t = (j / ringN) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const ex = Math.sign(c) * Math.abs(c) ** (2 / s.n);
      const ey = Math.sign(sn) * Math.abs(sn) ** (2 / s.n);
      const v = (ey + 1) / 2;
      const hw = s.w * (1 + (s.wt - 1) * smooth(0.3, 1, v));
      const x = hw * ex;
      const y = s.yb + (s.yt - s.yb) * v + s.crown * Math.max(0, ey) * (1 - ex * ex);
      pos.push(x * k, yc + (y - yc) * k, z);
      uv.push(j / ringN, z * 0.25);
    }
  }
  for (let i = 0; i < rings - 1; i++)
    for (let j = 0; j < ringN; j++) {
      const a = i * ringN + j;
      const b = i * ringN + ((j + 1) % ringN);
      const c = a + ringN;
      const d = b + ringN;
      idx.push(a, b, d, a, d, c);
    }
  // tampas (minúsculas: as pontas já fecham no arredondamento)
  const cap = (i: number, back: boolean) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < ringN; j++) {
      cx += pos[(i * ringN + j) * 3];
      cy += pos[(i * ringN + j) * 3 + 1];
      cz += pos[(i * ringN + j) * 3 + 2];
    }
    const ci = pos.length / 3;
    pos.push(cx / ringN, cy / ringN, cz / ringN);
    uv.push(0.5, 0.5);
    for (let j = 0; j < ringN; j++) {
      const a = i * ringN + j;
      const b = i * ringN + ((j + 1) % ringN);
      if (back) idx.push(ci, b, a);
      else idx.push(ci, a, b);
    }
  };
  cap(0, true);
  cap(rings - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Formas do cupê                                                        */
/* ------------------------------------------------------------------ */

const Z_NOSE = 2.36;
const Z_TAIL = -2.22;

// topo da carroceria: bico baixo, capô longo subindo até o para-brisa, traseira curta com "ducktail"
const bodyTop = curve([
  [Z_TAIL, 1.98],
  [-1.95, 2.06],
  [-1.5, 2.02],
  [-1.0, 1.99],
  [0.0, 1.98],
  [0.5, 1.97],
  [1.2, 1.92],
  [1.9, 1.84],
  [2.2, 1.74],
  [Z_NOSE, 1.66],
]);
// meia-largura: para-lamas salientes sobre as rodas e cintura "garrafa de Coca" no meio
const bodyW = curve([
  [Z_TAIL, 1.1],
  [-1.9, 1.24],
  [WZR, 1.3],
  [-0.7, 1.24],
  [-0.1, 1.14],
  [0.6, 1.22],
  [WZF, 1.28],
  [2.0, 1.2],
  [Z_NOSE, 0.98],
]);
const lowBase = curve([
  [Z_TAIL, 1.5],
  [-1.9, ROCK],
  [1.9, ROCK],
  [2.2, 1.44],
  [Z_NOSE, 1.5],
]);

/** Caixa de roda: arco que sobe sobre cada pneu. */
function arch(z: number): number {
  let y = 0;
  for (const wz of [WZF, WZR]) {
    const dz = Math.abs(z - wz);
    const R = 0.98;
    if (dz < R) y = Math.max(y, WR - 0.3 + Math.sqrt(R * R - dz * dz));
  }
  return y;
}

function bodySec(z: number): Sec {
  return { w: bodyW(z), wt: 0.84, yb: Math.max(lowBase(z), arch(z)), yt: bodyTop(z), n: 5, crown: 0.05 };
}

// cabine: para-brisa e vidro traseiro bem deitados, teto baixo
const CAB_F = 0.55;
const CAB_R = -1.62;
const cabTop = curve([
  [CAB_R, 2.02],
  [-1.25, 2.2],
  [-0.8, 2.36],
  [-0.45, 2.42],
  [-0.1, 2.41],
  [0.15, 2.3],
  [CAB_F, 2.0],
]);
const cabW = curve([
  [CAB_R, 0.82],
  [-0.9, 0.92],
  [-0.2, 0.92],
  [CAB_F, 0.86],
]);
function cabSec(z: number): Sec {
  return { w: cabW(z), wt: 0.8, yb: bodyTop(z) - 0.12, yt: cabTop(z), n: 3.2, crown: 0.02 };
}

/**
 * Faixas de corrida que acompanham a superfície (projetadas de cima sobre `targets`),
 * sem enterrar no capô abaulado como um decalque plano faria.
 */
function surfaceStripes(targets: THREE.Object3D[], bands: [number, number][], z0: number, z1: number, lift: number, steps = 60): THREE.BufferGeometry {
  for (const t of targets) t.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const hit = (x: number, z: number): number | null => {
    ray.set(new THREE.Vector3(x, 10, z), down);
    const h = ray.intersectObjects(targets, false)[0];
    return h ? h.point.y : null;
  };
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [xa, xb] of bands) {
    let prev = -1;
    for (let i = 0; i <= steps; i++) {
      const z = z0 + ((z1 - z0) * i) / steps;
      const ya = hit(xa, z);
      const yb = hit(xb, z);
      if (ya === null || yb === null) {
        prev = -1;
        continue;
      }
      const base = pos.length / 3;
      pos.push(xa, ya + lift, z, xb, yb + lift, z);
      if (prev >= 0) idx.push(prev, prev + 1, base + 1, prev, base + 1, base);
      prev = base;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // garante normais para cima (a ordem dos vértices depende do lado da faixa)
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/** Aerofólio: perfil de asa com bordas curvas. */
function wingShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.26, 0);
  s.quadraticCurveTo(0.3, 0.07, 0.12, 0.08);
  s.quadraticCurveTo(-0.14, 0.08, -0.3, 0.14); // borda de fuga levantada (gurney)
  s.lineTo(-0.31, 0.08);
  s.quadraticCurveTo(-0.05, -0.02, 0.26, 0);
  return s;
}

/**
 * Marauder: cupê musculoso anos 70/80 (capô longo com tomada de ar, para-lamas salientes,
 * cabine baixa de vidro escuro, aerofólio) levantado sobre rodas de monster truck, com a
 * bandeja do chassi e a suspensão à mostra. VK Plasma Rifles no capô, BF's Slipsauce atrás e
 * bocais dos Locust Jump Jets embaixo.
 */
export function createMarauder(color: number, shadows: boolean): CarVisual {
  const { root, body, ext } = carFrame();
  const k = new Kit(color, shadows, ext);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // carroceria de peça única
  const shell = k.add(loft(Z_TAIL, Z_NOSE, bodySec, 72, 40, 0.22), k.paint, 0, 0, 0);
  // estufa de vidro escuro e teto pintado por cima
  k.add(loft(CAB_R, CAB_F, cabSec, 40, 32, 0.12), k.glass, 0, 0, 0);
  const roof = k.add(
    loft(-0.95, 0.02, (z) => {
      const c = cabSec(z);
      return { w: c.w * c.wt * 1.02, wt: 0.92, yb: c.yt - 0.07, yt: c.yt + 0.025, n: 4, crown: 0.02 };
    }, 20, 28, 0.12),
    k.paint,
    0,
    0,
    0,
  );

  // tomada de ar do capô (shaker) com boca escura
  const scoop = (z: number): Sec => {
    const t = smooth(0.7, 1.45, z);
    return { w: 0.2, wt: 0.85, yb: bodyTop(z) - 0.06, yt: bodyTop(z) + 0.2 - t * 0.12, n: 4, crown: 0.02 };
  };
  k.add(loft(0.55, 1.5, scoop, 16, 24, 0.1), k.paint, 0, 0, 0);
  k.add(new THREE.BoxGeometry(0.3, 0.1, 0.04), k.dash, 0, bodyTop(1.4) + 0.08, 1.46).rotation.x = -0.2;

  // grade escura, para-choques cromados e espinhos na frente
  k.add(new THREE.BoxGeometry(1.3, 0.14, 0.06), k.dash, 0, 1.56, Z_NOSE - 0.06).rotation.x = -0.35;
  k.add(new THREE.CapsuleGeometry(0.07, 1.6, 4, 10).rotateZ(Math.PI / 2), k.chrome, 0, 1.44, Z_NOSE - 0.02);
  k.spikes(V(-0.5, 1.42, Z_NOSE + 0.02), V(0.5, 1.42, Z_NOSE + 0.02), 3, 0.26, V(0, 0, 1));
  k.add(new THREE.CapsuleGeometry(0.07, 1.6, 4, 10).rotateZ(Math.PI / 2), k.chrome, 0, 1.52, Z_TAIL - 0.02);
  // painel traseiro escuro entre as lanternas
  k.add(new THREE.BoxGeometry(1.5, 0.16, 0.04), k.trim, 0, 1.76, Z_TAIL - 0.01);

  // aerofólio traseiro na cor do carro, sobre dois suportes
  k.add(sideProfile(wingShape(), 2.3, 0.03, 8), k.paint, 0, 2.3, -1.98);
  for (const sx of [-0.62, 0.62]) {
    const st = k.add(new THREE.BoxGeometry(0.07, 0.3, 0.2), k.trim, sx, 2.18, -1.96);
    st.rotation.x = -0.25;
  }
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.04, 0.26, 0.64), k.paintDark, sx * 1.16, 2.38, -2.0);

  // VK Plasma Rifles duplos no capô, dos lados da tomada de ar
  for (const sx of [-0.56, 0.56]) k.plasmaRifle(sx, bodyTop(1.0) + 0.1, 1.05, 1.0);
  // BF's Slipsauce embaixo da traseira
  k.slipsauceTank(0, 1.26, -2.12, 0.9);
  // escapamentos cromados saindo embaixo do para-choque
  for (const sx of [-0.4, 0.4]) k.add(new THREE.CylinderGeometry(0.07, 0.08, 0.36, 12).rotateX(Math.PI / 2), k.chrome, sx, 1.18, -2.1);

  // bandeja do chassi (cinza, como no pack) e longarinas
  const trayS = (): Sec => ({ w: 0.62, wt: 0.95, yb: CH - 0.2, yt: CH + 0.38, n: 6, crown: 0 });
  k.add(loft(-2.05, 2.15, trayS, 14, 24, 0.18), k.gunMetal, 0, 0, 0);
  for (const sx of [-1, 1]) k.tube(V(sx * 0.5, CH - 0.1, 2.2), V(sx * 0.5, CH - 0.1, -2.1), 0.06, k.trim);
  // suspensão de monster truck (à mostra entre a carroceria e as rodas)
  for (const z of [WZF, WZR]) {
    k.add(new THREE.SphereGeometry(0.24, 14, 10).scale(1.1, 0.9, 1), k.gunMetal, 0, WR, z); // diferencial
    k.tube(V(-WX + 0.18, WR, z), V(WX - 0.18, WR, z), 0.07, k.gunMetal); // eixo
    for (const sx of [-1, 1]) {
      k.tube(V(sx * 0.45, CH - 0.12, z + 0.34), V(sx * (WX - 0.26), WR, z), 0.045, k.steel);
      k.tube(V(sx * 0.45, CH - 0.12, z - 0.34), V(sx * (WX - 0.26), WR, z), 0.045, k.steel);
      // dois amortecedores com mola amarela por roda
      for (const dz of [-0.18, 0.18]) {
        k.tube(V(sx * 0.52, ROCK - 0.02, z + dz), V(sx * (WX - 0.32), WR + 0.05, z + dz), 0.05, k.chrome);
        k.tube(V(sx * 0.56, ROCK - 0.14, z + dz), V(sx * (WX - 0.38), WR + 0.22, z + dz), 0.085, k.warn);
      }
    }
  }
  // Locust Jump Jets: bocais embaixo da bandeja, entre as rodas
  for (const sx of [-1, 1]) for (const z of [0.3, -0.3]) k.jumpJet(sx * 0.36, CH - 0.32, z);

  // soleira com neon na cor do time e friso cromado na linha de cintura
  for (const sx of [-1, 1]) {
    k.add(new THREE.BoxGeometry(0.04, 0.05, 0.9), k.accent, sx * (bodyW(0.05) - 0.02), ROCK + 0.04, 0.05);
    k.tube(V(sx * (bodyW(-0.6) - 0.06), 1.8, -0.6), V(sx * (bodyW(0.5) - 0.06), 1.8, 0.5), 0.018, k.chrome);
  }
  // faixas de corrida no capô e na tampa traseira, número no teto
  // (do bico até a traseira, passando pelo teto; debaixo do vidro elas somem)
  const stripeWhite = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const stripeGeo = (pad: number, lift: number) =>
    surfaceStripes([roof, shell], [[0.23 - pad, 0.39 + pad], [-0.39 - pad, -0.23 + pad]], Z_TAIL + 0.04, Z_NOSE - 0.03, lift, 90);
  k.add(stripeGeo(0.03, 0.012), k.trim, 0, 0, 0).castShadow = false;
  k.add(stripeGeo(0, 0.02), stripeWhite, 0, 0, 0).castShadow = false;
  k.decalOn(roof, 0.95, 0.6, 0, -0.45, 'number');
  // faróis escamoteáveis (tira baixa no bico) e lanternas largas
  k.lights([[0.62, 1.7, Z_NOSE - 0.12]], [[0.52, 1.76, Z_TAIL - 0.03]], 0.4);
  // faróis de milha na barra do teto
  k.add(new THREE.BoxGeometry(0.8, 0.05, 0.07), k.trim, 0, cabTop(-0.1) + 0.06, -0.1);
  for (const sx of [-0.3, -0.1, 0.1, 0.3]) k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 12).rotateX(Math.PI / 2), k.head, sx, cabTop(-0.1) + 0.12, -0.07);
  const flames = k.flames([[-0.4, 1.18, -2.85], [0.4, 1.18, -2.85]], 0.8);

  const wheels = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ sz, ...wheel(k, { radius: WR, width: 0.52, spokes: 5, knobby: true }, sx * WX, WR, sz > 0 ? WZF : WZR) })));

  const eye = new THREE.Vector3(0, 2.2, -0.5);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.66, weapon: 'plasma' }, body);
  k.merge();

  return {
    root,
    body,
    cabin: [ext],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      for (const w of wheels) {
        w.spin.rotation.x = a.spin;
        if (w.sz > 0) w.pivot.rotation.y = -a.steer * 0.45;
      }
    },
  };
}
