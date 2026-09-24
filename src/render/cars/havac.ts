import * as THREE from 'three';
import { carFrame, cockpitRig, Kit, polyShape, sideProfile, type CarVisual } from './common';

/** Retângulo de cantos arredondados (visto de cima), centrado na origem: x = largura, y = comprimento. */
function roundRect(hw: number, hl: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hl);
  s.lineTo(hw - r, -hl);
  s.absarc(hw - r, -hl + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hl - r);
  s.absarc(hw - r, hl - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hl);
  s.absarc(-hw + r, hl - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hl + r);
  s.absarc(-hw + r, -hl + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Placa arredondada extrudada para cima (altura = y), com borda bem boleada. */
function slab(shape: THREE.Shape, h: number, bevel: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: 5,
    curveSegments: 10,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Elipsoide do casco (sabonete): centro e semi-eixos. */
const EC = new THREE.Vector3(0, 0.6, -0.1);
const EA = new THREE.Vector3(0.84, 0.4, 1.52); // achatado: corcova baixa, listras bem visíveis de cima
/** topo do convés (slab em y 0.44, altura 0.14 + bevel 0.14) */
const DECK_TOP = 0.72;
function hullY(x: number, z: number): number {
  const q = 1 - (x / EA.x) ** 2 - ((z - EC.z) / EA.z) ** 2;
  return EC.y + EA.y * Math.sqrt(Math.max(0, q));
}

/**
 * Faixa colada à superfície do casco: fita entre `a` e `b` (em xz), largura `w`, `lift` acima
 * da pele. Fica sempre justa ao volume, sem enterrar nas pontas.
 */
function ribbon(ax: number, az: number, bx: number, bz: number, w: number, lift: number): THREE.BufferGeometry {
  const n = 10;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const px = (-dz / len) * (w / 2);
  const pz = (dx / len) * (w / 2);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    for (const s of [-1, 1]) {
      const x = cx + px * s;
      const z = cz + pz * s;
      // fora do sabonete a faixa deita no convés (topo em y≈0.72), em vez de despencar
      pos.push(x, Math.max(hullY(x, z), DECK_TOP) + lift, z);
    }
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.getAttribute('normal').getY(0) < 0) {
    idx.reverse();
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g.toNonIndexed();
}

/** Seção do duto da turbina: anel grosso de borda arredondada (girado depois para apontar em z). */
function ductGeo(rIn: number, rOut: number, hl: number, cr: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr));
    }
  };
  // contorno fechado no plano (raio, eixo): sentido que deixa as normais para fora
  corner(rOut - cr, -hl + cr, -Math.PI / 2);
  corner(rOut - cr, hl - cr, 0);
  corner(rIn + cr, hl - cr, Math.PI / 2);
  corner(rIn + cr, -hl + cr, Math.PI);
  pts.push(pts[0].clone());
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Havac: o AERODESLIZADOR do original, no estilo "brinquedo premium" — casco liso em forma de
 * sabonete sobre uma saia tubular preta grossa, cabine escura na frente, listras brancas diagonais
 * no topo e duas turbinas carenadas no alto da traseira, em pilares. Sem rodas.
 * Emissor Sundog no bico e KO Scatterpack atrás.
 */
export function createHavac(color: number, shadows: boolean): CarVisual {
  const { root, body, ext } = carFrame();
  // tudo que flutua fica em "hull", que balança sozinho
  const hull = new THREE.Group();
  ext.add(hull);
  const k = new Kit(color, shadows, hull);

  // pintura lisa e brilhante (sem desgaste): cara de brinquedo envernizado
  const gloss = new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const rubber = new THREE.MeshPhysicalMaterial({ color: 0x141418, roughness: 0.32, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xc8c8c8, roughness: 0.3, side: THREE.DoubleSide });
  const ink = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5, side: THREE.DoubleSide });

  // ---- SAIA TUBULAR: tubo de borracha grosso contornando todo o casco ----
  const TR = 0.3;
  const TY = 0.38;
  const outline = roundRect(0.98, 1.72, 0.72).getSpacedPoints(80).slice(0, -1);
  const path = new THREE.CatmullRomCurve3(outline.map((p) => new THREE.Vector3(p.x, TY, p.y)), true, 'centripetal');
  k.add(new THREE.TubeGeometry(path, 120, TR, 16, true), rubber, 0, 0, 0);
  // gomos do tubo: vincos finos e escuros (sutis)
  const seamGeo = new THREE.TorusGeometry(TR + 0.004, 0.012, 5, 20);
  for (let i = 0; i < 22; i++) {
    const t = (i + 0.5) / 22;
    const p = path.getPointAt(t);
    const tg = path.getTangentAt(t);
    k.add(seamGeo, seamMat, p.x, p.y, p.z).lookAt(p.x + tg.x, p.y + tg.y, p.z + tg.z);
  }
  // fundo que fecha o tubo por baixo
  k.add(slab(roundRect(0.95, 1.68, 0.7), 0.04, 0.02), k.trim, 0, 0.16, 0);

  // ---- CASCO: convés arredondado + corpo em sabonete ----
  const deck = k.add(slab(roundRect(0.86, 1.6, 0.62), 0.14, 0.14), gloss, 0, 0.44, 0);
  // corpo central alongado (sabonete), liso e brilhante
  const shell = k.add(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), gloss, EC.x, EC.y, EC.z);
  shell.scale.copy(EA);
  // friso neon na cor do time entre casco e saia
  const rim = new THREE.CatmullRomCurve3(
    roundRect(0.9, 1.64, 0.66).getSpacedPoints(60).slice(0, -1).map((p) => new THREE.Vector3(p.x, 0.62, p.y)),
    true,
    'centripetal',
  );
  k.add(new THREE.TubeGeometry(rim, 90, 0.022, 5, true), k.accent, 0, 0, 0);

  // ---- LISTRAS BRANCAS DIAGONAIS no topo, atrás da cabine (com contorno preto) ----
  // quatro faixas largas e inclinadas, lidas de longe na câmera aérea
  for (let i = 0; i < 4; i++) {
    const x = -0.48 + i * 0.32;
    const ax = x - 0.2;
    const bx = x + 0.2;
    const az = 0.1;
    const bz = -0.86;
    k.add(ribbon(ax, az + 0.04, bx, bz - 0.04, 0.3, 0.01), ink, 0, 0, 0);
    k.add(ribbon(ax, az, bx, bz, 0.22, 0.02), white, 0, 0, 0);
  }

  // ---- CABINE: bolha escura na frente, com moldura ----
  const CZ = 0.72;
  // cúpula baixa e achatada (não uma bolha alta)
  const canopy = k.add(new THREE.SphereGeometry(0.5, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), k.glass, 0, hullY(0, CZ) - 0.08, CZ);
  canopy.scale.set(0.8, 0.42, 1.0);
  k.add(new THREE.TorusGeometry(0.5, 0.04, 8, 32).rotateX(Math.PI / 2), k.trim, 0, hullY(0, CZ) - 0.07, CZ).scale.set(0.81, 1, 1.01);

  // emissor Sundog no bico: canhão curto apontado para a frente, com lente acesa bem à vista
  const SZ = 1.62;
  k.add(new THREE.CylinderGeometry(0.2, 0.26, 0.4, 16).rotateX(Math.PI / 2), k.gunMetal, 0, 0.78, SZ - 0.12);
  k.add(new THREE.TorusGeometry(0.2, 0.05, 8, 20), k.chrome, 0, 0.78, SZ + 0.08);
  const sun = k.add(new THREE.SphereGeometry(0.17, 16, 10), k.sundogGlow, 0, 0.78, SZ + 0.1);
  sun.scale.set(1, 1, 0.55);
  // KO Scatterpack na traseira, entre os pilares das turbinas
  k.scatterpack(0, 0.84, -1.4);

  // ---- DUAS TURBINAS: dutos cilíndricos profundos e carenados, sobre suportes largos ----
  const fans: THREE.Group[] = [];
  const FR = 0.36; // raio interno (área da hélice)
  const FO = 0.52; // raio externo da carenagem
  const FL = 0.32; // meia-profundidade do duto (~0,64 m)
  const FY = 1.42;
  const FZ = -1.22;
  const FX = 0.56;
  const duct = ductGeo(FR, FO, FL, 0.09);
  const ductMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1b20, metalness: 0.5, roughness: 0.35, clearcoat: 0.6 });
  // suporte largo: lâmina trapezoidal do convés até a barriga do duto
  const pylon = sideProfile(
    polyShape([
      [FZ - 0.42, 0],
      [FZ + 0.42, 0],
      [FZ + 0.26, FY - 0.62 - FO + 0.1],
      [FZ - 0.3, FY - 0.62 - FO + 0.1],
    ]),
    0.2,
    0.04,
    4,
  );
  const ribGeo = new THREE.BoxGeometry(0.07, 0.06, FL * 2 - 0.1);
  for (const sx of [-FX, FX]) {
    k.add(duct, ductMat, sx, FY, FZ);
    // parede interna escura e fosca (dá profundidade)
    k.add(new THREE.CylinderGeometry(FR - 0.005, FR - 0.005, FL * 2 - 0.05, 24, 1, true).rotateX(Math.PI / 2), k.dash, sx, FY, FZ);
    // aletas longitudinais na carenagem (leem como duto, não como pneu)
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2 + Math.PI / 8;
      const rib = k.add(ribGeo, k.gunMetal, sx + Math.cos(a) * (FO + 0.01), FY + Math.sin(a) * (FO + 0.01), FZ);
      rib.rotation.z = a;
    }
    // lábio cromado da entrada e anel de saída
    k.add(new THREE.TorusGeometry(FR + 0.06, 0.05, 8, 28), k.chrome, sx, FY, FZ + FL);
    k.add(new THREE.TorusGeometry(FR + 0.04, 0.03, 6, 28), k.steel, sx, FY, FZ - FL);
    // estator na saída: cubo + três braços
    for (let r = 0; r < 3; r++) k.add(new THREE.BoxGeometry(FR * 2, 0.04, 0.04), k.steel, sx, FY, FZ - FL + 0.06).rotation.z = (r / 3) * Math.PI + 0.25;
    k.add(new THREE.CylinderGeometry(0.08, 0.1, 0.14, 12).rotateX(Math.PI / 2), k.gunMetal, sx, FY, FZ - FL + 0.08);
    // suporte largo na cor do casco, com sapata escura
    k.add(pylon, gloss, sx, 0.62, 0);
    k.add(new THREE.BoxGeometry(0.34, 0.08, 0.95), k.gunMetal, sx, 0.66, FZ);
    // ventoinha no fundo do duto: cubo + pás (gira)
    const fan = new THREE.Group();
    fan.position.set(sx, FY, FZ + 0.06);
    hull.add(fan);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 8), k.chrome);
    hub.scale.set(1, 1, 1.6);
    fan.add(hub);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.04, 0.07);
    bladeShape.quadraticCurveTo(0.11, FR * 0.55, 0.1, FR * 0.93);
    bladeShape.lineTo(-0.11, FR * 0.93);
    bladeShape.quadraticCurveTo(-0.13, FR * 0.5, -0.04, 0.07);
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.02, bevelEnabled: false, curveSegments: 5 });
    for (let b = 0; b < 7; b++) {
      const blade = new THREE.Mesh(bladeGeo, k.steel);
      const pivot = new THREE.Group();
      pivot.rotation.z = (b / 7) * Math.PI * 2;
      blade.rotation.y = 0.55;
      pivot.add(blade);
      fan.add(pivot);
    }
    fans.push(fan);
  }
  // viga larga ligando as duas turbinas
  k.add(new THREE.BoxGeometry(FX * 2 - FO * 2 + 0.2, 0.14, 0.5), gloss, 0, FY - 0.08, FZ);

  // número de corrida no convés do bico, ao lado do emissor
  k.decalOn(deck, 0.42, 0.42, 0.5, 1.28, 'number');
  // lanternas: faróis no bico e lanternas traseiras no convés
  k.lights([[0.36, 0.64, 1.64]], [[0.62, 0.66, -1.58]], 0.2);
  const flames = k.flames([[-0.56, FY, FZ - 0.9], [0.56, FY, FZ - 0.9]], 1.1);

  // colchão de ar: brilho suave no chão, embaixo da saia
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ab0ff), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), haloMat);
  glow.position.y = 0.04;
  glow.scale.set(1.2, 1, 2.0);
  hull.add(glow);

  const eye = new THREE.Vector3(0, 1.22, 0.5);
  // o cockpit fica preso à carroceria (não ao casco que balança), alinhado com a câmera
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.85, weapon: 'sundog' }, body);

  k.merge([sun, glow], hull);

  const sway = { r: 0, rv: 0, p: 0, pv: 0, t: 0 };

  return {
    root,
    body,
    cabin: [ext],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      // flutua, inclina na curva e empina levemente ao acelerar
      hull.position.y = 0.1 + Math.sin(a.time * 4.7) * 0.05;
      // balanço extra do colchão de ar: mola frouxa que segue (e passa um pouco) a rolagem e a
      // arfagem da carroceria, então o casco oscila depois da curva/freada
      const dt = Math.min(0.05, Math.max(0, a.time - sway.t));
      sway.t = a.time;
      const rollT = (a.roll ?? -a.steer * 0.04) * 0.6;
      const pitchT = (a.pitch ?? 0) * 0.5;
      sway.rv += ((rollT - sway.r) * 38 - sway.rv * 3.2) * dt;
      sway.pv += ((pitchT - sway.p) * 32 - sway.pv * 3.2) * dt;
      sway.r = Math.max(-0.05, Math.min(0.05, sway.r + sway.rv * dt));
      sway.p = Math.max(-0.04, Math.min(0.04, sway.p + sway.pv * dt));
      hull.rotation.z = sway.r + Math.sin(a.time * 2.3) * 0.012;
      hull.rotation.x = sway.p + Math.sin(a.time * 1.7 + 1) * 0.008;
      const rate = 14 + Math.abs(a.speed) * 0.8;
      for (const [i, f] of fans.entries()) f.rotation.z = a.time * rate * (i ? -1 : 1);
      haloMat.opacity = 0.16 + Math.sin(a.time * 21) * 0.05;
      sun.scale.setScalar(1 + Math.sin(a.time * 9) * 0.08);
    },
  };
}
