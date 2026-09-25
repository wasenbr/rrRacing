import * as THREE from 'three';
import { bodySink, carFrame, chevronTread, cockpitRig, Kit, Linkage, wheelDrop, wheelTravel, type CarVisual } from './common';
import { nitroThrust } from './kit';

/*
 * Medidas (modelo em metros "reais"; o jogo reduz com CAR_SCALE e VISUAL_SCALE). Alvo:
 * referencias/modernizados/air-blade.png — pneus enormes de cravos em V, bandeja cinza larga POR
 * CIMA dos pneus, casco vermelho de peça única em cunha que sobe numa barbatana de tubarão alta e
 * curva, asas grossas saindo da base da barbatana, turbina cromada atrás.
 */
const TIRE_R = 0.9; // raio da carcaça do pneu
const LUG = 0.16; // altura dos cravos em V
const WR = TIRE_R * 0.985 + LUG - 0.045; // raio externo com os cravos (≈ 1,0: 20 % maior que antes)
const TIRE_W = 0.72;
const WX = 1.3; // meia-bitola
const WZ = 1.5; // meio entre-eixos
/** folga entre o topo do pneu e o fundo da bandeja */
const ARCH_GAP = 0.11;
/** posição da placa da bandeja (topo em PLATE_Y + 0,07; fundo em PLATE_Y − 0,17) */
const PLATE_Y = 2 * WR + ARCH_GAP + 0.17;
const TRAY_TOP = PLATE_Y + 0.07;
const TRAY_HALF = 1.42; // a bandeja cobre ~3/4 da largura do pneu
const TRAY_Z0 = -2.35;
const TRAY_Z1 = 2.55;
const BASE = TRAY_TOP + 0.01; // fundo do casco (dentro da "banheira" da bandeja)
const NOSE = 2.45; // ponta do bico
const TAILH = -2.2; // onde o casco termina e vira só barbatana
const FIN_Z0 = -0.25; // raiz do bordo de ataque da barbatana (logo atrás da cabine)
const FIN_TIP = -3.2; // ponta da barbatana, puxada para trás da cauda
const FIN_H = 2.3; // altura da barbatana acima do dorso

/* ------------------------------------------------------------------ */
/* Loft: superfície lisa ligando anéis (seções) de mesmo tamanho        */
/* ------------------------------------------------------------------ */

/** Liga anéis fechados de pontos numa malha lisa, com tampas; a orientação é corrigida pelo volume. */
function loft(rings: THREE.Vector3[][], capStart = true, capEnd = true): THREE.BufferGeometry {
  const n = rings[0].length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  rings.forEach((r, i) =>
    r.forEach((p, j) => {
      pos.push(p.x, p.y, p.z);
      uv.push(j / n, i / (rings.length - 1));
    }),
  );
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      idx.push(a, b, a + n, b, b + n, a + n);
    }
  const cap = (ri: number, end: boolean) => {
    const c = new THREE.Vector3();
    rings[ri].forEach((p) => c.add(p));
    c.divideScalar(n);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    uv.push(0.5, ri / (rings.length - 1));
    for (let j = 0; j < n; j++) {
      const a = ri * n + j;
      const b = ri * n + ((j + 1) % n);
      if (end) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(rings.length - 1, true);
  // volume com sinal: negativo = triângulos virados para dentro -> inverte todos
  let vol = 0;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    A.fromArray(pos, idx[t] * 3);
    B.fromArray(pos, idx[t + 1] * 3);
    C.fromArray(pos, idx[t + 2] * 3);
    vol += A.dot(B.clone().cross(C));
  }
  if (vol < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/* ------------------------------------------------------------------ */
/* Casco + barbatana: UMA peça (loft contínuo ao longo do carro)         */
/* ------------------------------------------------------------------ */

/** Altura do dorso acima de BASE: bico baixo em cunha, subindo até a cabine e reto até a cauda. */
function dorsal(z: number): number {
  if (z > 0.3) return 0.64 - 0.44 * Math.pow((z - 0.3) / (NOSE - 0.3), 1.35);
  return 0.64 + 0.18 * smooth(clamp01((0.3 - z) / 1.2));
}

/** Meia-largura do casco: bico estreito arredondado, cheio no meio e atrás, fechando na cauda. */
function hullHalf(z: number): number {
  let w: number;
  if (z > -0.4) w = 0.8 - 0.5 * Math.pow((z + 0.4) / (NOSE + 0.4), 1.5);
  else if (z > -1.45) w = 0.8;
  else w = finHalf(TAILH) + (0.8 - finHalf(TAILH)) * smooth(clamp01((z - TAILH) / (-1.45 - TAILH)));
  // ponta do bico boleada
  if (z > NOSE - 0.22) w *= Math.sqrt(Math.max(0.02, 1 - ((z - (NOSE - 0.22)) / 0.22) ** 2));
  return w;
}

/** Posição (0 na raiz, 1 na ponta) ao longo da barbatana. */
const finU = (z: number) => clamp01((FIN_Z0 - z) / (FIN_Z0 - FIN_TIP));
/**
 * Bordo de ataque (altura absoluta): a raiz já sai inclinada para trás (~50°, não um leme em pé) e
 * vai curvando até quase deitar na ponta — a foice do tubarão, legível também na vista de trás.
 */
function finLE(z: number): number {
  const u = finU(z);
  const root = BASE + dorsal(FIN_Z0);
  return root + FIN_H * (1 - Math.pow(1 - u, 1.5)) * smooth(clamp01(u / 0.3));
}
/** Bordo de fuga atrás da cauda (altura absoluta): côncavo, em foice, até encontrar a ponta. */
function finTE(z: number): number {
  const v = clamp01((TAILH - z) / (TAILH - FIN_TIP));
  const y0 = BASE + dorsal(TAILH);
  return y0 + (finLE(FIN_TIP) - y0) * Math.pow(v, 0.55);
}
/** Meia-espessura da barbatana: grossa na base (continua o casco), lâmina na ponta. */
const finHalf = (z: number) => 0.06 + 0.36 * Math.pow(1 - finU(z), 1.1);

/** Seção do corpo em z: fundo, meia-largura, altura do casco e altura da barbatana acima dele. */
function section(z: number): { yb: number; w: number; hh: number; fin: number; t: number } {
  const t = finHalf(z);
  if (z < TAILH) {
    const yb = finTE(z);
    return { yb, w: t, hh: 0, fin: Math.max(0, finLE(z) - yb), t };
  }
  // cauda: o fundo sobe até o dorso e o casco afina até a espessura da barbatana
  const v = clamp01((-1.4 - z) / (-1.4 - TAILH));
  const top = BASE + dorsal(z);
  const yb = BASE + (top - BASE) * Math.pow(smooth(v), 1.3);
  const fin = z < FIN_Z0 ? Math.max(0, finLE(z) - top) : 0;
  return { yb, w: Math.max(t, hullHalf(z)), hh: top - yb, fin, t };
}

function bodyGeo(): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  const M = 37; // pontos do dorso (densos no meio, onde nasce a barbatana)
  const K = 9; // pontos do fundo
  const S = 90;
  for (let i = 0; i <= S; i++) {
    const z = FIN_TIP + (NOSE - FIN_TIP) * (0.5 - 0.5 * Math.cos((Math.PI * i) / S));
    const s = section(z);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < M; j++) {
      const q = 1 - (2 * j) / (M - 1); // 1 -> -1
      const x = s.w * Math.sign(q) * Math.pow(Math.abs(q), 1.7);
      const r = Math.abs(x) / s.w;
      const shoulder = Math.pow(Math.max(0, 1 - Math.pow(r, 2.6)), 1 / 2.6);
      const b = Math.abs(x) < s.t ? Math.pow(1 - (x / s.t) ** 2, 2) : 0;
      ring.push(new THREE.Vector3(x, s.yb + s.hh * shoulder + s.fin * b, z));
    }
    for (let j = 1; j <= K; j++) {
      const x = -s.w + (2 * s.w * j) / (K + 1);
      ring.push(new THREE.Vector3(x, s.yb - 0.03 * (1 - (x / s.w) ** 2) * Math.min(1, s.hh / 0.3), z));
    }
    rings.push(ring);
  }
  return loft(rings);
}

/** Meia-espessura da barbatana na altura y, em z (para assentar as luzes na superfície). */
function finSurfaceX(z: number, y: number): number {
  const s = section(z);
  const top = s.yb + s.hh;
  if (s.fin <= 0 || y <= top) return s.w;
  const k = clamp01((y - top) / s.fin);
  return s.t * Math.sqrt(Math.max(0, 1 - Math.sqrt(k)));
}

/* ------------------------------------------------------------------ */
/* Asas grossas saindo da base da barbatana                             */
/* ------------------------------------------------------------------ */

const WING_Y = BASE + dorsal(-1.6) + 0.2;
const WING_X0 = 0.08; // raiz enterrada na base da barbatana
const WING_SPAN = 1.95; // pontas bem para fora da bandeja, como no modelo de referência
// enflechada e afinando: corda de 1,4 m na raiz, ~0,3 m na ponta
const wingLE = (s: number) => -0.75 - 1.45 * s;
const wingTE = (s: number) => -2.15 - 0.3 * s;
/** diedro negativo: a ponta cai ~0,35 m abaixo da raiz (de trás não fica a asa reta de avião) */
const wingY = (s: number) => WING_Y - 0.35 * Math.pow(s, 1.3);
/** meia-espessura: grossa na raiz, lâmina fina na ponta */
const wingTh = (s: number) => 0.045 + 0.26 * Math.pow(1 - s, 1.2);

function wingGeo(side: number): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  const N = 20;
  const S = 16;
  for (let i = 0; i <= S; i++) {
    const s = i / S;
    const x = side * (WING_X0 + WING_SPAN * s);
    const k = s > 0.84 ? Math.sqrt(Math.max(0, 1 - ((s - 0.84) / 0.16) ** 2)) : 1; // ponta boleada
    const mid = (wingLE(s) + wingTE(s)) / 2;
    const hc = ((wingLE(s) - wingTE(s)) / 2) * Math.max(0.55, k);
    const th = wingTh(s) * Math.max(0.12, k);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const c = Math.cos(a);
      // aerofólio: mais grosso perto do bordo de ataque
      ring.push(new THREE.Vector3(x, wingY(s) + th * Math.sin(a) * (0.72 + 0.28 * c), mid + hc * c));
    }
    rings.push(ring);
  }
  return loft(rings);
}

/* ------------------------------------------------------------------ */
/* Bandeja                                                              */
/* ------------------------------------------------------------------ */

/** Contorno da bandeja: retângulo de cantos bem arredondados, um pouco mais estreito na frente. */
function trayOutline(margin: number, path: THREE.Path): THREE.Path {
  const z0 = TRAY_Z0 - margin;
  const z1 = TRAY_Z1 + margin;
  const S = 80;
  const half = (z: number) => {
    const w = TRAY_HALF - 0.1 * smooth(clamp01((z - 1.2) / 1.3)) + margin;
    const r = 0.55 + margin;
    const e0 = clamp01((z - z0) / r);
    const e1 = clamp01((z1 - z) / r);
    return w * (0.3 + 0.7 * Math.sqrt(e0 * (2 - e0)) * Math.sqrt(e1 * (2 - e1)));
  };
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= S; i++) {
    const z = z0 + ((z1 - z0) * i) / S;
    pts.push(new THREE.Vector2(half(z), z));
  }
  for (let i = S; i >= 0; i--) {
    const z = z0 + ((z1 - z0) * i) / S;
    pts.push(new THREE.Vector2(-half(z), z));
  }
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
  return path;
}

function trayGeos(): { plate: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const flat = (s: THREE.Shape, depth: number, bevel: number) => {
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 8 });
    g.rotateX(Math.PI / 2); // forma no plano XZ, extrusão para baixo
    g.computeVertexNormals();
    return g;
  };
  const plate = flat(trayOutline(0, new THREE.Shape()) as THREE.Shape, 0.1, 0.07);
  // moldura elevada em volta (a "banheira" onde o casco assenta)
  const ring = trayOutline(0.02, new THREE.Shape()) as THREE.Shape;
  ring.holes.push(trayOutline(-0.14, new THREE.Path()));
  const rim = flat(ring, 0.06, 0.04);
  return { plate, rim };
}

/* ------------------------------------------------------------------ */
/* Rodas                                                                */
/* ------------------------------------------------------------------ */

/** Roda enorme: pneu cinza-grafite com cravos em V altos e aro cromado fundo. */
function bigWheel(k: Kit, tireMat: THREE.Material, rimMat: THREE.Material, x: number, z: number): { pivot: THREE.Group; spin: THREE.Group } {
  const r = TIRE_R;
  const w = TIRE_W;
  const hw = w / 2;
  const pivot = new THREE.Group();
  pivot.position.set(x, WR, z);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tire = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(r * 0.6, -hw * 0.92),
        new THREE.Vector2(r * 0.8, -hw),
        new THREE.Vector2(r * 0.92, -hw * 0.9),
        new THREE.Vector2(r * 0.965, -hw * 0.55),
        new THREE.Vector2(r * 0.975, 0),
        new THREE.Vector2(r * 0.965, hw * 0.55),
        new THREE.Vector2(r * 0.92, hw * 0.9),
        new THREE.Vector2(r * 0.8, hw),
        new THREE.Vector2(r * 0.6, hw * 0.92),
      ],
      28,
    ).rotateZ(Math.PI / 2),
    tireMat,
  );
  tire.castShadow = k.shadows;
  spin.add(tire);
  // cravos em V altos e espaçados (16 na volta), bem marcados como no modelo de referência
  spin.add(new THREE.Mesh(chevronTread(r * 0.97, w, LUG, 16), tireMat));
  const side = Math.sign(x) || 1;
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.82, 22).rotateZ(Math.PI / 2), rimMat));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.56, 0.05, 8, 24).rotateY(Math.PI / 2), rimMat);
  lip.position.x = side * hw * 0.82;
  spin.add(lip);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.47, r * 0.47, 0.04, 20).rotateZ(Math.PI / 2), k.steel);
  dish.position.x = side * hw * 0.8;
  spin.add(dish);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.14, r * 0.18, 0.1, 12).rotateZ(Math.PI / 2), k.chrome);
  hub.position.x = side * (hw * 0.82 + 0.03);
  spin.add(hub);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6).rotateZ(Math.PI / 2), k.gunMetal);
    b.position.set(side * (hw * 0.82 + 0.03), Math.cos(a) * r * 0.27, Math.sin(a) * r * 0.27);
    spin.add(b);
  }
  return { pivot, spin };
}

/**
 * Air Blade: o "tubarão" do original no acabamento de brinquedo premium do modelo de referência —
 * casco vermelho de peça única que sai do bico em cunha e sobe, sem emenda, numa barbatana alta
 * curvada para trás; asas grossas nascendo da base da barbatana; bandeja cinza larga por cima de
 * quatro pneus enormes de cravos em V. Rogue Missiles em casulos grandes no topo das asas (ogiva
 * vermelha), Bear Claw Mines sob a traseira, turbina cromada do Lightning Nitros atrás.
 */
export function createAirBlade(color: number, shadows: boolean): CarVisual {
  const { root, body, ext, chassis } = carFrame();
  const k = new Kit(color, shadows, ext);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x7c8188, metalness: 0.45, roughness: 0.38 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.8 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.55, roughness: 0.18, envMapIntensity: 1.8 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x40f0ff, emissive: 0x20e0ff, emissiveIntensity: 3 });
  const warhead = new THREE.MeshStandardMaterial({ color: 0xd81e1e, emissive: 0x500000, roughness: 0.3, metalness: 0.25 });

  // bandeja cinza: placa grossa arredondada por cima dos pneus, com moldura elevada
  const tray = trayGeos();
  k.add(tray.plate, trayMat, 0, PLATE_Y, 0);
  k.add(tray.rim, trayMat, 0, PLATE_Y + 0.14, 0);
  // chassi escuro sob a bandeja (liga os braços da suspensão)
  k.add(new THREE.BoxGeometry(0.9, 0.5, 3.6), k.gunMetal, 0, PLATE_Y - 0.4, 0);
  k.add(new THREE.BoxGeometry(1.2, 0.12, 0.5), k.steel, 0, PLATE_Y - 0.22, WZ);
  k.add(new THREE.BoxGeometry(1.2, 0.12, 0.5), k.steel, 0, PLATE_Y - 0.22, -WZ);

  // casco + barbatana: uma peça só
  const hull = k.add(bodyGeo(), k.paint, 0, 0, 0);
  const wings = [-1, 1].map((sx) => k.add(wingGeo(sx), k.paint, 0, 0, 0));

  // luz ciano nos dois lados da barbatana (aro cromado + lente), acima das asas
  const EYE_Y = WING_Y + 0.55;
  let eyeZ = FIN_Z0;
  while (eyeZ > FIN_TIP && finLE(eyeZ) < EYE_Y + 0.12) eyeZ -= 0.01;
  eyeZ -= 0.22;
  const eyeX = finSurfaceX(eyeZ, EYE_Y);
  for (const sx of [-1, 1]) {
    k.add(new THREE.TorusGeometry(0.1, 0.035, 8, 16).rotateY(Math.PI / 2), k.chrome, sx * (eyeX + 0.01), EYE_Y, eyeZ);
    k.add(new THREE.SphereGeometry(0.08, 12, 8), cyan, sx * eyeX, EYE_Y, eyeZ).scale.set(0.5, 1, 1);
  }

  // cabine aberta: abertura oval escura com borda cinza
  const pitZ = 0.35;
  const pitY = BASE + dorsal(pitZ);
  const slope = Math.atan2(dorsal(pitZ - 0.4) - dorsal(pitZ + 0.4), 0.8);
  const pit = k.add(new THREE.SphereGeometry(1, 22, 12), k.dash, 0, pitY - 0.02, pitZ);
  pit.scale.set(0.32, 0.08, 0.52);
  pit.rotation.x = slope;
  const lip = k.add(new THREE.TorusGeometry(1, 0.055, 8, 32).rotateX(Math.PI / 2), trayMat, 0, pitY + 0.01, pitZ);
  lip.scale.set(0.34, 1, 0.54);
  lip.rotation.x = slope;
  k.add(new THREE.SphereGeometry(0.15, 12, 8), k.trim, 0, pitY + 0.04, pitZ - 0.3).scale.set(1, 0.8, 0.8);

  // bico: luz ciano embutida na ponta
  const tipZ = NOSE - 0.25;
  const noseLight = k.add(new THREE.SphereGeometry(1, 14, 10), cyan, 0, BASE + dorsal(tipZ) - 0.02, tipZ);
  noseLight.scale.set(0.1, 0.05, 0.2);
  noseLight.rotation.x = 0.2;

  // Rogue Missiles: casulos grandes NO TOPO das asas (bem visíveis de cima), ogiva vermelha na frente
  const PR = 0.14;
  const PL = 0.7;
  const podGeo = new THREE.CylinderGeometry(PR, PR, PL, 16).rotateX(Math.PI / 2);
  const noseGeo = new THREE.ConeGeometry(PR, 0.3, 16).rotateX(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(PR * 0.8, PR, 0.06, 16).rotateX(Math.PI / 2);
  const bandGeo = new THREE.CylinderGeometry(PR + 0.008, PR + 0.008, 0.08, 16).rotateX(Math.PI / 2);
  const podS = 0.47;
  for (const sx of [-1, 1]) {
    const px = sx * (WING_X0 + WING_SPAN * podS);
    const py = wingY(podS) + wingTh(podS) * 0.9 + PR - 0.02;
    const pz = wingLE(podS) - PL / 2 + 0.05;
    k.add(podGeo, k.chrome, px, py, pz);
    k.add(bandGeo, k.warn, px, py, pz - 0.12);
    k.add(noseGeo, warhead, px, py, pz + PL / 2 + 0.15);
    k.add(capGeo, k.gunMetal, px, py, pz - PL / 2 - 0.03);
    k.add(new THREE.BoxGeometry(0.08, 0.1, PL * 0.8), k.gunMetal, px, py - PR, pz); // pilone
  }

  // turbina cromada do nitro atrás, sob a raiz da barbatana (bocal escuro)
  const turbY = BASE + 0.3;
  const turbZ = TRAY_Z0 - 0.05;
  const bell = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.13, 0.3),
      new THREE.Vector2(0.18, 0.14),
      new THREE.Vector2(0.19, -0.04),
      new THREE.Vector2(0.22, -0.18),
      new THREE.Vector2(0.2, -0.2),
      new THREE.Vector2(0.15, -0.06),
      new THREE.Vector2(0.1, -0.06),
    ],
    20,
  )
    .rotateX(Math.PI / 2)
    .scale(1.5, 1.5, 1.5);
  k.add(bell, k.chrome, 0, turbY, turbZ);
  k.add(new THREE.CircleGeometry(0.24, 18).rotateY(Math.PI), k.dash, 0, turbY, turbZ - 0.2);
  // Bear Claw Mines sob a traseira da bandeja
  k.bearClawDropper(0, PLATE_Y - 0.36, TRAY_Z0 + 0.3);

  // eixos e mangas no grupo das rodas (sobem e descem com elas)
  const hubX = WX - TIRE_W / 2 - 0.06;
  for (const sz of [-1, 1]) {
    const z = sz * WZ;
    k.tube(V(-hubX, WR, z), V(hubX, WR, z), 0.08, k.gunMetal, chassis);
    for (const sx of [-1, 1]) k.add(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 12).rotateZ(Math.PI / 2), k.steel, sx * hubX, WR, z, chassis);
  }
  // suspensão: braços e amortecedores recalculados a cada quadro entre o chassi e o cubo
  const links = new Linkage(root, body, chassis, shadows);
  const yellow = k.warn;
  for (const sz of [-1, 1]) {
    const z = sz * WZ;
    for (const sx of [-1, 1]) {
      const hx = sx * (hubX - 0.04);
      links.add(V(sx * 0.42, PLATE_Y - 0.22, z + 0.32), V(hx, WR + 0.1, z), 0.055, k.chrome);
      links.add(V(sx * 0.42, PLATE_Y - 0.22, z - 0.32), V(hx, WR + 0.1, z), 0.055, k.chrome);
      links.add(V(sx * 0.42, PLATE_Y - 0.62, z + 0.3), V(hx, WR - 0.1, z), 0.05, k.steel);
      links.add(V(sx * 0.42, PLATE_Y - 0.62, z - 0.3), V(hx, WR - 0.1, z), 0.05, k.steel);
      links.add(V(sx * 0.62, PLATE_Y - 0.18, z - sz * 0.42), V(sx * (hubX - 0.1), WR + 0.14, z - sz * 0.12), 0.075, yellow);
    }
  }

  // número nas asas (lê de cima), faixas no bico e número nas laterais do casco
  for (const sx of [-1, 1]) k.decalOn(wings[sx < 0 ? 0 : 1], 0.44, 0.44, sx * (WING_X0 + WING_SPAN * 0.78), (wingLE(0.78) + wingTE(0.78)) / 2, 'number');
  k.decalOn(hull, 0.34, 0.6, 0, 1.55, 'stripes');
  for (const sx of [-1, 1]) k.decalSide(hull, 0.5, 0.34, sx, BASE + 0.3, -0.75, 'number');
  const flames = k.flames([[0, turbY, turbZ - 0.2]], 0.26, nitroThrust('airblade'));

  const wheels = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ sz, ...bigWheel(k, tireMat, rimMat, sx * WX, sz * WZ) })));
  // rodas e eixos no chassi: a carroceria balança por cima deles
  for (const w of wheels) chassis.add(w.pivot);
  const travel = wheelTravel(0.26);

  const eye = new THREE.Vector3(0, BASE + 1.0, 0.25);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.62, weapon: 'missiles' }, body);
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
      // a bandeja fica sempre acima do pneu: se a carroceria afundar mais que a folga, as rodas descem junto
      chassis.position.y = wheelDrop(travel(a), bodySink(body, WX, WZ), ARCH_GAP - 0.02);
      for (const w of wheels) {
        w.spin.rotation.x = a.spin;
        if (w.sz > 0) w.pivot.rotation.y = -a.steer * 0.42;
      }
    },
  };
}
