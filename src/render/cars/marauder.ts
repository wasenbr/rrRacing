import * as THREE from 'three';
import { bodySink, carFrame, cockpitRig, Kit, Linkage, sideProfile, wheel, wheelDrop, wheelTravel, type CarVisual } from './common';
import { nitroThrust } from './kit';

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
  /** caixa de roda: altura do fundo sob os para-lamas (só nas laterais, |x| > WELL_X0) */
  well?: number;
  /** quanto o para-lama sobe acima de `yt` (só nas laterais) para cobrir o pneu */
  hump?: number;
}

// faixa de x onde o capô baixo do meio vira para-lama alto com caixa de roda embaixo. Por dentro de
// WELL_X0 o pneu não chega nem esterçado (a borda interna vai até ~0,5 com STEER)
const WELL_X0 = 0.42;
const WELL_X1 = 0.56;

/** Pontos de uma superelipse unitária igualmente espaçados no perímetro (o fundo e o topo ganham pontos). */
const ringCache = new Map<string, [number, number][]>();
function evenRing(n: number, count: number): [number, number][] {
  const key = `${n}:${count}`;
  const hit = ringCache.get(key);
  if (hit) return hit;
  const M = 2000;
  const pts: [number, number][] = [];
  const acc: number[] = [0];
  for (let i = 0; i <= M; i++) {
    const t = (i / M) * Math.PI * 2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    pts.push([Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(sn) * Math.abs(sn) ** (2 / n)]);
    if (i) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const L = acc[M];
  const out: [number, number][] = [];
  let i = 0;
  for (let j = 0; j < count; j++) {
    const s = (j / count) * L;
    while (acc[i + 1] < s) i++;
    const f = (s - acc[i]) / (acc[i + 1] - acc[i] || 1);
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
  }
  ringCache.set(key, out);
  return out;
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
function loft(z0: number, z1: number, f: (z: number) => Sec, rings = 56, ringN = 36, round = 0.2, even = false): THREE.BufferGeometry {
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
    const ring = even ? evenRing(s.n, ringN) : null;
    for (let j = 0; j < ringN; j++) {
      let ex: number;
      let ey: number;
      if (ring) [ex, ey] = ring[j];
      else {
        const t = (j / ringN) * Math.PI * 2;
        const c = Math.cos(t);
        const sn = Math.sin(t);
        ex = Math.sign(c) * Math.abs(c) ** (2 / s.n);
        ey = Math.sign(sn) * Math.abs(sn) ** (2 / s.n);
      }
      const v = (ey + 1) / 2;
      const hw = s.w * (1 + (s.wt - 1) * smooth(0.3, 1, v));
      const x = hw * ex;
      // laterais: fundo sobe até a caixa de roda e o topo sobe junto (para-lama), o meio fica baixo
      const side = smooth(WELL_X0, WELL_X1, Math.abs(ex) * s.w);
      const yb = s.well !== undefined && s.well > s.yb ? s.yb + (s.well - s.yb) * side : s.yb;
      const yt = s.yt + (s.hump ?? 0) * side;
      const y = yb + (yt - yb) * v + s.crown * Math.max(0, ey) * (1 - ex * ex);
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

const Z_NOSE = 2.62; // bico comprido: esportivo alongado sobre as rodas altas
const Z_TAIL = -2.32;

// topo da carroceria: capô longo em cunha (bico bem baixo subindo até o para-brisa), traseira curta
// com "ducktail". Carroceria e teto ~25% mais baixos que o cupê anterior: esportivo, não jipe.
const bodyTop = curve([
  [Z_TAIL, 1.86],
  [-2.05, 1.93],
  [-1.5, 1.9],
  [-1.0, 1.87],
  [-0.2, 1.85],
  [0.5, 1.8],
  [1.2, 1.72],
  [1.9, 1.63],
  [2.35, 1.55],
  [Z_NOSE, 1.5],
]);
// meia-largura: para-lamas salientes sobre as rodas e cintura "garrafa de Coca" no meio
const bodyW = curve([
  [Z_TAIL, 1.1],
  [-1.9, 1.24],
  [WZR, 1.3],
  [-0.7, 1.24],
  [-0.1, 1.1],
  [0.6, 1.22],
  [WZF, 1.28],
  [2.0, 1.22],
  [2.35, 1.12],
  [Z_NOSE, 0.96],
]);
const lowBase = curve([
  [Z_TAIL, 1.5],
  [-1.9, ROCK],
  [1.9, ROCK],
  [2.3, 1.4],
  [Z_NOSE, 1.42],
]);

/**
 * Caixa de roda: arco que sobe sobre cada pneu. O pneu com cravos tem raio ~0,89 e, esterçado,
 * avança ~0,12 em z; o arco (centro ARCH_Y, raio ARCH_R) passa por cima dele com folga em todo o
 * esterço — antes o arco (topo 1,66) ficava abaixo do topo do pneu (1,75) e o pneu furava o para-lama.
 */
const ARCH_Y = WR - 0.12;
const ARCH_R = 1.2; // folga de ~0,19 sobre o topo do pneu (item 51)
const SKIN = 0.1;
/** esterço máximo das rodas da frente (rad): o pneu esterçado fica dentro da caixa de roda */
const STEER = 0.32; // espessura do para-lama por cima do arco
function arch(z: number): number {
  let y = 0;
  for (const wz of [WZF, WZR]) {
    const dz = Math.abs(z - wz);
    if (dz < ARCH_R) y = Math.max(y, ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  return y;
}
/** Topo do para-lama: acompanha o capô e sobe em bojo onde o arco da roda passa dele. */
function fenderTop(z: number): number {
  return softMax(bodyTop(z), arch(z) + SKIN, 0.12);
}

/** Máximo suave: a borda do arco não vira quina (sombra serrilhada). */
const softMax = (a: number, b: number, k: number) => {
  const h = Math.max(0, Math.min(1, 0.5 + (b - a) / (2 * k)));
  return a + (b - a) * h + k * h * (1 - h);
};

function bodySec(z: number): Sec {
  return {
    w: bodyW(z),
    wt: 0.84,
    yb: lowBase(z),
    yt: bodyTop(z),
    n: 5,
    crown: 0.05,
    well: softMax(lowBase(z), arch(z), 0.04),
    hump: fenderTop(z) - bodyTop(z),
  };
}

// cabine: para-brisa e vidro traseiro bem deitados, teto baixo
const CAB_F = 0.3;
const CAB_R = -1.75;
const cabTop = curve([
  [CAB_R, 1.9],
  [-1.35, 2.02],
  [-0.95, 2.13],
  [-0.6, 2.17],
  [-0.25, 2.16],
  [0.0, 2.06],
  [CAB_F, 1.8],
]);
const cabW = curve([
  [CAB_R, 0.82],
  [-1.05, 0.93],
  [-0.4, 0.93],
  [CAB_F, 0.86],
]);
function cabSec(z: number): Sec {
  return { w: cabW(z), wt: 0.8, yb: bodyTop(z) - 0.12, yt: cabTop(z), n: 3.2, crown: 0.02 };
}

/**
 * Faixas de corrida que acompanham a superfície (projetadas de cima sobre `targets`),
 * sem enterrar no capô abaulado como um decalque plano faria.
 */
const stripeCache = new Map<string, THREE.BufferGeometry>();

function surfaceStripes(targets: THREE.Object3D[], bands: [number, number][], z0: number, z1: number, lift: number, steps = 60): THREE.BufferGeometry {
  // a carroceria é sempre a mesma: os ~700 raios (quase 1 s no tablet) só rodam na primeira vez
  const key = JSON.stringify([bands, z0, z1, lift, steps]);
  const have = stripeCache.get(key);
  if (have) return have.clone();
  const g = castStripes(targets, bands, z0, z1, lift, steps);
  stripeCache.set(key, g);
  return g.clone();
}

function castStripes(targets: THREE.Object3D[], bands: [number, number][], z0: number, z1: number, lift: number, steps: number): THREE.BufferGeometry {
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
      if (prev >= 0) idx.push(prev, base + 1, prev + 1, prev, base, base + 1); // normal para cima
      prev = base;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
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
 * Marauder: esportivo BAIXO e alongado anos 70/80 (capô longo em cunha com tomada de ar, para-lamas
 * salientes, cabine rasa de vidro escuro, aerofólio largo) levantado sobre rodas de monster truck, com a
 * bandeja do chassi e a suspensão à mostra. VK Plasma Rifles no capô, BF's Slipsauce atrás e
 * bocais dos Locust Jump Jets embaixo.
 */
export function createMarauder(color: number, shadows: boolean): CarVisual {
  const { root, body, ext, chassis } = carFrame();
  const k = new Kit(color, shadows, ext);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // carroceria de peça única
  const shell = k.add(loft(Z_TAIL, Z_NOSE, bodySec, 96, 72, 0.22, true), k.paint, 0, 0, 0);
  // estufa de vidro escuro e teto pintado por cima
  k.add(loft(CAB_R, CAB_F, cabSec, 40, 32, 0.12), k.glass, 0, 0, 0);
  const roof = k.add(
    loft(-1.12, -0.22, (z) => {
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
  k.add(loft(0.45, 1.5, scoop, 16, 24, 0.1), k.paint, 0, 0, 0);
  k.add(new THREE.BoxGeometry(0.3, 0.1, 0.04), k.dash, 0, bodyTop(1.4) + 0.08, 1.46).rotation.x = -0.2;

  // grade escura, para-choques cromados e espinhos na frente
  k.add(new THREE.BoxGeometry(1.1, 0.1, 0.06), k.dash, 0, 1.47, Z_NOSE - 0.1).rotation.x = -0.5;
  k.add(new THREE.CapsuleGeometry(0.07, 1.5, 4, 10).rotateZ(Math.PI / 2), k.chrome, 0, 1.38, Z_NOSE - 0.06);
  k.spikes(V(-0.5, 1.36, Z_NOSE - 0.02), V(0.5, 1.36, Z_NOSE - 0.02), 3, 0.26, V(0, 0, 1));
  k.add(new THREE.CapsuleGeometry(0.07, 1.6, 4, 10).rotateZ(Math.PI / 2), k.chrome, 0, 1.52, Z_TAIL - 0.02);
  // painel traseiro escuro entre as lanternas
  k.add(new THREE.BoxGeometry(1.5, 0.14, 0.04), k.trim, 0, 1.7, Z_TAIL - 0.01);

  // bordas salientes dos para-lamas contornando cada pneu
  for (const wz of [WZF, WZR])
    for (const sx of [-1, 1]) {
      // borda acompanha o arco da caixa de roda (ARCH_R), da soleira de um lado à do outro
      const lip = new THREE.TorusGeometry(ARCH_R + 0.02, 0.075, 8, 28, Math.PI * 0.58).rotateZ(Math.PI * 0.21).rotateY(Math.PI / 2).scale(1.4, 1, 1);
      k.add(lip, k.paint, sx * (bodyW(wz) - 0.08), ARCH_Y, wz);
    }

  // aerofólio traseiro LARGO (mais que a carroceria) na cor do carro, sobre dois suportes
  const WING_Y = 2.12;
  const WING_Z = -2.08;
  const WING_W = 2.75;
  k.add(sideProfile(wingShape(), WING_W, 0.03, 8).scale(1, 1, 1.25), k.paint, 0, WING_Y, WING_Z);
  for (const sx of [-0.7, 0.7]) {
    const st = k.add(new THREE.BoxGeometry(0.08, 0.3, 0.22), k.trim, sx, WING_Y - 0.13, WING_Z + 0.02);
    st.rotation.x = -0.25;
  }
  // placas laterais do aerofólio, com cantos arredondados
  const ep = new THREE.Shape();
  ep.moveTo(-0.3, -0.08);
  ep.lineTo(0.22, -0.08);
  ep.quadraticCurveTo(0.34, -0.06, 0.3, 0.06);
  ep.quadraticCurveTo(0.1, 0.2, -0.3, 0.22);
  ep.quadraticCurveTo(-0.36, 0.08, -0.3, -0.08);
  for (const sx of [-1, 1]) k.add(sideProfile(ep, 0.05, 0.015, 8).scale(1, 1.2, 1.25), k.paintDark, sx * (WING_W / 2 + 0.01), WING_Y, WING_Z);

  // VK Plasma Rifles duplos no capô, dos lados da tomada de ar (no vale entre os para-lamas)
  for (const sx of [-0.36, 0.36]) k.plasmaRifle(sx, bodyTop(1.0) + 0.12, 1.05, 1.0, k.body, 1.25);
  // BF's Slipsauce embaixo da traseira
  k.slipsauceTank(0, 1.26, -2.12, 0.9);
  // escapamentos cromados grossos saindo embaixo do para-choque (boca de 0,16 m: o nitro sai deles)
  for (const sx of [-0.58, 0.58]) {
    k.add(new THREE.CylinderGeometry(0.16, 0.12, 0.36, 16).rotateX(-Math.PI / 2), k.chrome, sx, 1.2, -2.22);
    k.add(new THREE.TorusGeometry(0.145, 0.025, 6, 18), k.gunMetal, sx, 1.2, -2.4);
    k.add(new THREE.CircleGeometry(0.13, 16).rotateY(Math.PI), k.dash, sx, 1.2, -2.395);
  }

  // bandeja do chassi (cinza, como no pack) e longarinas
  // (afina entre as rodas da frente para o pneu esterçado não entrar nela)
  const trayS = (z: number): Sec => ({ w: 0.62 - 0.24 * (1 - smooth(0.75, 1.1, Math.abs(z - WZF))), wt: 0.95, yb: CH - 0.2, yt: CH + 0.38, n: 6, crown: 0 });
  k.add(loft(-2.05, 2.15, trayS, 40, 24, 0.18), k.gunMetal, 0, 0, 0);
  for (const sx of [-1, 1]) k.tube(V(sx * 0.3, CH - 0.1, 2.2), V(sx * 0.3, CH - 0.1, -2.1), 0.06, k.trim);
  // suspensão de monster truck (à mostra entre a carroceria e as rodas): braços e amortecedores
  // recalculados a cada quadro entre a carroceria e o eixo (não descolam no ar nem no pouso)
  const links = new Linkage(root, body, chassis, shadows);
  for (const z of [WZF, WZR]) {
    k.add(new THREE.SphereGeometry(0.24, 14, 10).scale(1.1, 0.9, 1), k.gunMetal, 0, WR, z, chassis); // diferencial
    k.tube(V(-WX + 0.18, WR, z), V(WX - 0.18, WR, z), 0.07, k.gunMetal, chassis); // eixo
    for (const sx of [-1, 1]) {
      const ax = z === WZF ? 0.3 : 0.45; // na frente a bandeja é mais estreita
      links.add(V(sx * ax, CH - 0.12, z + 0.34), V(sx * (WX - 0.26), WR, z), 0.045, k.steel);
      links.add(V(sx * ax, CH - 0.12, z - 0.34), V(sx * (WX - 0.26), WR, z), 0.045, k.steel);
      // dois amortecedores com mola amarela por roda
      for (const dz of [-0.18, 0.18]) {
        // topo preso no assoalho baixo do meio (por fora dele fica a caixa de roda)
        links.add(V(sx * 0.34, ROCK - 0.02, z + dz), V(sx * (WX - 0.32), WR + 0.05, z + dz), 0.05, k.chrome);
        links.add(V(sx * 0.37, ROCK - 0.14, z + dz), V(sx * (WX - 0.38), WR + 0.22, z + dz), 0.085, k.warn);
      }
    }
  }
  // Locust Jump Jets: bocais embaixo da bandeja, entre as rodas
  for (const sx of [-1, 1]) for (const z of [0.3, -0.3]) k.jumpJet(sx * 0.36, CH - 0.32, z);

  // soleira com neon na cor do time e friso cromado na linha de cintura
  for (const sx of [-1, 1]) {
    k.add(new THREE.BoxGeometry(0.04, 0.05, 0.9), k.accent, sx * (bodyW(0.05) - 0.02), ROCK + 0.04, 0.05);
    k.tube(V(sx * (bodyW(-0.6) - 0.06), 1.74, -0.6), V(sx * (bodyW(0.5) - 0.06), 1.72, 0.5), 0.018, k.chrome);
  }
  // faixas de corrida no capô e na tampa traseira, número no teto
  // (do bico até a traseira, passando pelo teto; debaixo do vidro elas somem)
  const stripeWhite = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const stripeGeo = (pad: number, lift: number) =>
    surfaceStripes([roof, shell], [[0.23 - pad, 0.39 + pad], [-0.39 - pad, -0.23 + pad]], Z_TAIL + 0.04, Z_NOSE - 0.03, lift, 90);
  k.add(stripeGeo(0.03, 0.012), k.trim, 0, 0, 0).castShadow = false;
  k.add(stripeGeo(0, 0.02), stripeWhite, 0, 0, 0).castShadow = false;
  k.decalOn(roof, 0.95, 0.6, 0, -0.65, 'number');
  for (const sx of [-1, 1]) k.decalSide(shell, 0.56, 0.36, sx, 1.63, -0.3, 'number');
  // faróis escamoteáveis (tira baixa no bico) e lanternas largas
  k.lights([[0.52, 1.5, Z_NOSE - 0.12]], [[0.52, 1.7, Z_TAIL - 0.03]], 0.32);
  // faróis de milha na barra do teto
  k.add(new THREE.BoxGeometry(0.8, 0.05, 0.07), k.trim, 0, cabTop(-0.3) + 0.06, -0.3);
  for (const sx of [-0.3, -0.1, 0.1, 0.3]) k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 12).rotateX(Math.PI / 2), k.head, sx, cabTop(-0.3) + 0.12, -0.27);
  const flames = k.flames([[-0.58, 1.2, -2.41], [0.58, 1.2, -2.41]], 0.16, nitroThrust('marauder'));

  const wheels = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ sz, ...wheel(k, { radius: WR, width: 0.52, spokes: 5, knobby: true }, sx * WX, WR, sz > 0 ? WZF : WZR) })));
  // rodas e eixos no chassi: a carroceria balança por cima deles
  for (const w of wheels) chassis.add(w.pivot);
  const travel = wheelTravel(0.28);

  const eye = new THREE.Vector3(0, 2.02, -0.65);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.66, weapon: 'plasma' }, body);
  k.merge();

  return {
    root,
    body,
    cabin: [ext, chassis, links.group],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      // se a carroceria afundar (pouso, inclinação) mais que a folga do arco, as rodas descem junto
      chassis.position.y = wheelDrop(travel(a), bodySink(body, WX, WZF), 0.12);
      for (const w of wheels) {
        w.spin.rotation.x = a.spin;
        if (w.sz > 0) w.pivot.rotation.y = -a.steer * STEER;
      }
    },
  };
}
