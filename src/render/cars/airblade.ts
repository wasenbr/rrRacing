import * as THREE from 'three';
import { carFrame, chevronTread, cockpitRig, Kit, type CarVisual } from './common';

const WR = 0.82; // pneus enormes, como no sprite do original
const WX = 1.3; // meia-bitola (rodas por fora da bandeja larga)
const WZ = 1.35; // meio entre-eixos
const TRAY_Y = 1.02; // bandeja/chassi onde o casco assenta
const BASE = TRAY_Y + 0.14; // fundo do casco (em cima da placa da bandeja)
const TAIL = -2.1; // traseira do casco
const NOSE = 2.3; // ponta do bico

/* ------------------------------------------------------------------ */
/* Loft: superfície lisa ligando anéis (seções) de mesmo tamanho        */
/* ------------------------------------------------------------------ */

/**
 * Liga anéis fechados de pontos numa malha lisa (indexada, normais suavizadas).
 * Anéis devem girar no sentido anti-horário visto da direção de avanço; `flip` inverte.
 */
function loft(rings: THREE.Vector3[][], capStart = true, capEnd = true, flip = false): THREE.BufferGeometry {
  const n = rings[0].length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tri = (a: number, b: number, c: number) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
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
      const c = a + n;
      const d = b + n;
      tri(a, b, c);
      tri(b, d, c);
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
      if (end) tri(ci, a, b);
      else tri(ci, b, a);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(rings.length - 1, true);
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
/* Casco de peça única (tubarão/jato)                                   */
/* ------------------------------------------------------------------ */

/** Meia-largura do casco em z: cheio no meio, afinando até o bico pontudo e até a cauda (rabo de tubarão). */
function hullW(z: number): number {
  let w: number;
  if (z >= -0.2) {
    const u = clamp01((z + 0.2) / (NOSE + 0.2));
    w = 0.8 * Math.pow(1 - Math.pow(u, 2.5), 0.65);
  } else {
    const t = clamp01((z - TAIL) / (-0.2 - TAIL));
    w = 0.8 * (0.3 + 0.7 * smooth(t));
    const e = clamp01((z - TAIL) / 0.2); // fecha a cauda numa quilha estreita
    w *= 0.4 + 0.6 * Math.sqrt(e * (2 - e));
  }
  return Math.max(0.035, w);
}

/** Altura do dorso em z: bico baixo, subindo até a cabine e virando a base da barbatana atrás. */
function hullTop(z: number): number {
  let y: number;
  if (z > 0.9) y = 1.66 - (1.66 - 1.3) * Math.pow((z - 0.9) / (NOSE - 0.9), 1.3);
  else y = 1.66 + 0.24 * smooth(clamp01((0.9 - z) / 1.8));
  const t = clamp01((z - TAIL) / 0.3);
  y = BASE + (y - BASE) * (0.7 + 0.3 * Math.sqrt(t * (2 - t)));
  if (z > NOSE - 0.12) y = BASE + (y - BASE) * (0.55 + 0.45 * ((NOSE - z) / 0.12));
  return y;
}

/** Fundo do casco: plano, levantando na cauda (rabo de tubarão). */
const hullBot = (z: number) => BASE + 0.22 * Math.pow(clamp01((-1.2 - z) / (-1.2 - TAIL)), 1.6);

function hullGeo(): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  const N = 30;
  const S = 44;
  for (let i = 0; i <= S; i++) {
    const z = TAIL + (NOSE - TAIL) * (1 - Math.pow(1 - i / S, 1.15));
    const w = hullW(z);
    const yb = hullBot(z);
    const h = hullTop(z) - yb;
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = w * Math.sign(c) * Math.pow(Math.abs(c), 0.7);
      // lado de cima: superelipse (ombros cheios); de baixo: quase plano
      const y = s >= 0 ? yb + h * Math.pow(s, 0.8) : yb - 0.05 * Math.pow(-s, 0.5);
      ring.push(new THREE.Vector3(x, y, z));
    }
    rings.push(ring);
  }
  return loft(rings);
}

/* ------------------------------------------------------------------ */
/* Barbatana em foice e asas trapezoidais varridas                      */
/* ------------------------------------------------------------------ */

const FIN_Y0 = 1.45; // a raiz fica dentro do casco: a barbatana nasce dele
const FIN_H = 2.05;
/** bordo de ataque: convexo, subindo e curvando cada vez mais para trás */
const finLE = (t: number) => -0.05 - 1.0 * t - 1.4 * t * t;
/** bordo de fuga: côncavo (foice), da cauda até a ponta */
const finTE = (t: number) => -2.02 - 0.43 * t + 1.25 * t * Math.pow(1 - t, 1.3);
/** meia-espessura: na raiz acompanha a largura do casco (continua com ele), vira lâmina acima */
const finTh = (t: number, z: number) => {
  const blade = 0.035 + 0.11 * Math.pow(1 - t, 0.7);
  const k = smooth(clamp01(t / 0.32));
  return hullW(z) * 0.9 * (1 - k) + blade * k;
};

function finGeo(): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  const N = 26;
  const S = 26;
  for (let i = 0; i <= S; i++) {
    const t = 1 - Math.pow(1 - i / S, 1.3); // mais anéis perto da ponta
    const y = FIN_Y0 + FIN_H * t;
    const le = finLE(t);
    const te = finTE(t);
    const mid = (le + te) / 2;
    const hc = Math.max(0.03, (le - te) / 2);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const c = Math.cos(a);
      const z = mid + hc * c;
      // perfil de aerofólio: mais grosso perto do bordo de ataque
      const x = finTh(t, z) * Math.sin(a) * (0.72 + 0.28 * c);
      ring.push(new THREE.Vector3(x, y, z));
    }
    rings.push(ring);
  }
  return loft(rings);
}

/** altura da raiz das asas (no ombro do casco, saindo da base da barbatana) */
const WING_Y = 1.9;
const WING_SPAN = 1.5;
const WING_X0 = 0.22;
const wingLE = (s: number) => -0.35 - 1.35 * s;
const wingTE = (s: number) => -2.02 - 0.28 * s;
const wingY = (s: number) => WING_Y + 0.2 * s;

/** Asa trapezoidal larga, varrida para trás, corda afinando para a ponta (side = ±1). */
function wingGeo(side: number): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  const N = 18;
  const S = 16;
  for (let i = 0; i <= S; i++) {
    const s = i / S;
    const x = side * (WING_X0 + WING_SPAN * s);
    const y = wingY(s);
    const le = wingLE(s);
    const te = wingTE(s);
    // ponta cortada levemente arredondada: fecha nos últimos 6%
    const k = s > 0.94 ? Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.94) / 0.06, 2))) : 1;
    const mid = (le + te) / 2;
    const hc = ((le - te) / 2) * Math.max(0.6, k);
    const th = (0.09 - 0.03 * s) * Math.max(0.15, k);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const c = Math.cos(a);
      ring.push(new THREE.Vector3(x, y + th * Math.sin(a) * (0.7 + 0.3 * c), mid - hc * c));
    }
    rings.push(ring);
  }
  return loft(rings, true, true, side < 0);
}

/* ------------------------------------------------------------------ */
/* Bandeja do chassi                                                    */
/* ------------------------------------------------------------------ */

/**
 * Contorno da bandeja: bem mais larga que o casco (a aba cinza aparece dos dois lados, como no
 * modelo de referência), cantos arredondados, cabendo entre as rodas.
 */
function trayOutline(margin: number, path: THREE.Path): THREE.Path {
  const pts: THREE.Vector2[] = [];
  const S = 28;
  const z0 = TAIL - 0.22 - margin;
  const z1 = NOSE + 0.04 + margin;
  const half = (z: number) => {
    const w = Math.min(0.97, Math.max(hullW(Math.min(z, NOSE - 0.45)), 0.46) + 0.2) + margin;
    const r = 0.45 + margin;
    const e0 = clamp01((z - z0) / r);
    const e1 = clamp01((z1 - z) / r);
    return w * (0.12 + 0.88 * Math.sqrt(e0 * (2 - e0)) * Math.sqrt(e1 * (2 - e1)));
  };
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
  // placa grossa de bordas boleadas (arredondada por baixo)
  const plate = flat(trayOutline(0, new THREE.Shape()) as THREE.Shape, 0.1, 0.09);
  // moldura elevada em volta (a "banheira" onde o casco assenta)
  const ring = trayOutline(0.02, new THREE.Shape()) as THREE.Shape;
  ring.holes.push(trayOutline(-0.12, new THREE.Path()));
  const rim = flat(ring, 0.06, 0.04);
  return { plate, rim };
}

/* ------------------------------------------------------------------ */
/* Rodas                                                                */
/* ------------------------------------------------------------------ */

/** Roda grande: pneu largo cinza-grafite com cravos em V e aro cromado fundo. */
function bigWheel(k: Kit, tireMat: THREE.Material, rimMat: THREE.Material, x: number, z: number): { pivot: THREE.Group; spin: THREE.Group } {
  const r = WR;
  const w = 0.6;
  const hw = w / 2;
  const pivot = new THREE.Group();
  pivot.position.set(x, r, z);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tire = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(r * 0.58, -hw * 0.92),
        new THREE.Vector2(r * 0.8, -hw),
        new THREE.Vector2(r * 0.92, -hw * 0.9),
        new THREE.Vector2(r * 0.965, -hw * 0.55),
        new THREE.Vector2(r * 0.975, 0),
        new THREE.Vector2(r * 0.965, hw * 0.55),
        new THREE.Vector2(r * 0.92, hw * 0.9),
        new THREE.Vector2(r * 0.8, hw),
        new THREE.Vector2(r * 0.58, hw * 0.92),
      ],
      26,
    ).rotateZ(Math.PI / 2),
    tireMat,
  );
  tire.castShadow = k.shadows;
  spin.add(tire);
  spin.add(new THREE.Mesh(chevronTread(r * 0.97, w), tireMat));
  // aro cromado: miolo cheio, anel de borda e prato rebaixado
  const side = Math.sign(x) || 1;
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.59, r * 0.59, w * 0.82, 22).rotateZ(Math.PI / 2), rimMat));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, 0.045, 8, 24).rotateY(Math.PI / 2), rimMat);
  lip.position.x = side * hw * 0.82;
  spin.add(lip);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.46, r * 0.46, 0.04, 20).rotateZ(Math.PI / 2), k.steel);
  dish.position.x = side * (hw * 0.82 - 0.0);
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
  k.body.add(pivot);
  return { pivot, spin };
}

/**
 * Air Blade: o "tubarão" do original, no acabamento de brinquedo premium — casco liso de peça
 * única com bico baixo e pontudo, barbatana dorsal curva integrada, asas largas varridas saindo
 * dela, cabine aberta oval, bandeja cinza em volta e quatro pneus enormes.
 * Rogue Missiles nas laterais do bico, Bear Claw Mines sob a cauda, turbina cromada
 * do Lightning Nitros atrás.
 */
export function createAirBlade(color: number, shadows: boolean): CarVisual {
  const { root, body, ext } = carFrame();
  const k = new Kit(color, shadows, ext);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x80858c, metalness: 0.4, roughness: 0.4 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.8 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.55, roughness: 0.18, envMapIntensity: 1.8 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x40f0ff, emissive: 0x20e0ff, emissiveIntensity: 3 });

  // bandeja do chassi cinza: placa grossa arredondada, bem mais larga que o casco, com moldura elevada
  const tray = trayGeos();
  k.add(tray.plate, trayMat, 0, TRAY_Y + 0.06, 0);
  k.add(tray.rim, trayMat, 0, TRAY_Y + 0.26, 0);

  // casco liso de peça única
  const hull = k.add(hullGeo(), k.paint, 0, 0, 0);

  // barbatana em foice contínua com o casco e asas trapezoidais varridas saindo da base dela
  k.add(finGeo(), k.paint, 0, 0, 0);
  const wings = [-1, 1].map((sx) => k.add(wingGeo(sx), k.paint, 0, 0, 0));

  // luz ciano na barbatana, acima da raiz das asas (aro cromado + lente)
  const EYE_Y = WING_Y + 0.42;
  const eyeT = (EYE_Y - FIN_Y0) / FIN_H;
  const eyeZ = finLE(eyeT) - 0.2;
  const mid = (finLE(eyeT) + finTE(eyeT)) / 2;
  const hc = (finLE(eyeT) - finTE(eyeT)) / 2;
  const u = (eyeZ - mid) / hc;
  const eyeX = finTh(eyeT, eyeZ) * Math.sqrt(1 - u * u) * (0.72 + 0.28 * u);
  for (const sx of [-1, 1]) {
    k.add(new THREE.TorusGeometry(0.09, 0.035, 8, 16).rotateY(Math.PI / 2), k.chrome, sx * (eyeX + 0.01), EYE_Y, eyeZ);
    const lens = k.add(new THREE.SphereGeometry(0.075, 12, 8), cyan, sx * eyeX, EYE_Y, eyeZ);
    lens.scale.set(0.5, 1, 1);
  }

  // cabine aberta: abertura oval escura com borda cinza
  const pitZ = 0.45;
  const pitY = hullTop(pitZ);
  const slope = Math.atan2(hullTop(pitZ - 0.4) - hullTop(pitZ + 0.4), 0.8);
  const pit = k.add(new THREE.SphereGeometry(1, 22, 12), k.dash, 0, pitY - 0.02, pitZ);
  pit.scale.set(0.3, 0.08, 0.48);
  pit.rotation.x = slope;
  const lip = k.add(new THREE.TorusGeometry(1, 0.055, 8, 32).rotateX(Math.PI / 2), trayMat, 0, pitY + 0.01, pitZ);
  lip.scale.set(0.32, 1, 0.5);
  lip.rotation.x = slope;
  const seat = k.add(new THREE.SphereGeometry(0.14, 12, 8), k.trim, 0, pitY + 0.04, pitZ - 0.28);
  seat.scale.set(1, 0.8, 0.8);

  // bico: luz ciano embutida na ponta
  const tipZ = NOSE - 0.2;
  const noseLight = k.add(new THREE.SphereGeometry(1, 14, 10), cyan, 0, hullTop(tipZ) - 0.02, tipZ);
  noseLight.scale.set(0.08, 0.05, 0.2);
  noseLight.rotation.x = 0.15;

  // Rogue Missiles: casulos cromados sobre as asas (visíveis de cima), 2 mísseis cada
  const PR = 0.2;
  const podGeo = new THREE.CapsuleGeometry(PR, 0.78, 4, 14).rotateX(Math.PI / 2);
  const missileGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.36, 10).rotateX(Math.PI / 2);
  const mouthGeo = new THREE.TorusGeometry(0.075, 0.022, 6, 14);
  const tipGeo = new THREE.ConeGeometry(0.07, 0.2, 10).rotateX(Math.PI / 2);
  const bandGeo = new THREE.CylinderGeometry(PR + 0.006, PR + 0.006, 0.1, 14).rotateX(Math.PI / 2);
  const podS = (1.0 - WING_X0) / WING_SPAN;
  for (const sx of [-1, 1]) {
    const px = sx * 1.0;
    const py = wingY(podS) + 0.07 + PR + 0.02;
    const pz = -1.5;
    k.add(podGeo, k.chrome, px, py, pz);
    k.add(bandGeo, k.warn, px, py, pz - 0.2);
    k.add(new THREE.BoxGeometry(0.08, 0.1, 0.5), k.gunMetal, px, py - PR, pz);
    for (const dx of [-0.09, 0.09]) {
      k.add(mouthGeo, k.muzzle, px + dx, py + 0.02, pz + 0.58);
      k.add(missileGeo, rimMat, px + dx, py + 0.02, pz + 0.6);
      k.add(tipGeo, k.tail, px + dx, py + 0.02, pz + 0.86);
    }
  }

  // turbina cromada do nitro, pequena, sob a quilha da cauda (bocal escuro, sem "olho" aceso)
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
  ).rotateX(Math.PI / 2);
  k.add(bell, k.chrome, 0, 1.36, TAIL - 0.02);
  k.add(new THREE.CircleGeometry(0.15, 16).rotateY(Math.PI), k.dash, 0, 1.36, TAIL - 0.1);
  // Bear Claw Mines sob a cauda
  k.bearClawDropper(0, TRAY_Y + 0.0, -2.0);

  // suspensão: braços cromados da bandeja até as rodas, eixo e amortecedor amarelo
  for (const sz of [-1, 1]) {
    const z = sz * WZ;
    for (const sx of [-1, 1]) {
      k.tube(V(sx * 0.55, TRAY_Y + 0.02, z + 0.25), V(sx * (WX - 0.25), WR, z), 0.06, k.chrome);
      k.tube(V(sx * 0.55, TRAY_Y + 0.02, z - 0.25), V(sx * (WX - 0.25), WR, z), 0.05, k.steel);
      k.tube(V(sx * 0.45, TRAY_Y + 0.08, z), V(sx * (WX - 0.3), WR + 0.1, z), 0.07, k.warn);
    }
    k.tube(V(-0.6, WR, z), V(0.6, WR, z), 0.08, k.gunMetal);
  }

  // número nas asas (lê de cima), no bico e nas laterais do casco
  for (const sx of [-1, 1]) k.decalOn(wings[sx < 0 ? 0 : 1], 0.46, 0.46, sx * 1.45, -1.86, 'number');
  k.decalOn(hull, 0.34, 0.5, 0, 1.45, 'stripes');
  for (const sx of [-1, 1]) k.decalSide(hull, 0.5, 0.36, sx, 1.45, -0.55, 'number');
  const flames = k.flames([[0, 1.36, TAIL - 0.95]], 1.1);

  const wheels = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ sz, ...bigWheel(k, tireMat, rimMat, sx * WX, sz * WZ) })));

  const eye = new THREE.Vector3(0, 1.9, 0.2);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.6, weapon: 'missiles' }, body);
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
        if (w.sz > 0) w.pivot.rotation.y = -a.steer * 0.42;
      }
    },
  };
}
