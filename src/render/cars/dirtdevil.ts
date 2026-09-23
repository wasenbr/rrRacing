import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { carFrame, cockpitRig, Kit, sideProfile, wheel, type CarVisual } from './common';

const WR = 0.82; // rodas de monster truck, como no sprite do original
const WX = 0.94; // meia-bitola
const WZ = 1.25; // meio entre-eixos
const BOT = 1.32; // fundo da carroceria (bem acima do chão)
const BL = 1.95; // meio-comprimento da bolha

// casco (metade de baixo do fusca: capô, laterais e traseira) e cabine-cúpula por cima
const TUB = { w: 0.95, h: 0.7, l: 1.98, y: BOT + 0.24 };
const CAB = { w: 0.76, h: 0.74, l: 1.08, y: BOT + 0.56, z: -0.28 };

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

/**
 * Superelipsoide liso (esfera "estufada" pelo expoente `p` < 1): volume cheio de brinquedo, sem
 * facetas. `t0..t1` recorta faixas a partir do topo; `top(zn)` modela a altura ao longo do comprimento.
 */
function blob(w: number, h: number, l: number, p: number, t0: number, t1: number, hb: number, top: (zn: number) => number = () => 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 44, 26, 0, Math.PI * 2, t0, t1 - t0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const zn = spow(z, p);
    pos.setXYZ(i, spow(x, p) * w, spow(y, p) * (y >= 0 ? h * top(zn) : h * hb), zn * l);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

/** Tubo liso com pontas arredondadas entre dois pontos (grade e para-choque "de brinquedo"). */
function bar(k: Kit, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = k.add(new THREE.CapsuleGeometry(r, len, 4, 14), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** Arco de para-lama bojudo: setor de anel extrudado na largura com chanfro grande (borda redonda). */
function fenderGeo(r0: number, r1: number, width: number, bevel: number, a0: number, a1: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, a0, a1, false);
  s.absarc(0, 0, r0, a1, a0, true);
  s.closePath();
  return sideProfile(s, width, bevel, 48);
}

/** Farol redondo: copo cromado + lente acesa, virado para +z. */
function lamp(k: Kit, x: number, y: number, z: number, r: number, lens: THREE.Material, tilt = 0): void {
  const cup = new THREE.LatheGeometry(
    [new THREE.Vector2(0.001, -r * 0.7), new THREE.Vector2(r * 0.7, -r * 0.62), new THREE.Vector2(r, -r * 0.2), new THREE.Vector2(r * 1.02, 0.02), new THREE.Vector2(r * 0.86, 0.04)],
    18,
  ).rotateX(Math.PI / 2 - tilt);
  k.add(cup, k.chrome, x, y, z);
  k.add(new THREE.SphereGeometry(r * 0.86, 16, 8, 0, Math.PI * 2, 0, 1.0).scale(1, 0.45, 1).rotateX(Math.PI / 2 - tilt), lens, x, y, z);
}

/**
 * Dirt Devil: fusca-baja de brinquedo premium — casco em bolha lisa com cabine-cúpula de vidro
 * escuro, para-lamas bojudos sobre quatro rodas enormes de monster truck (aro cromado, cravos em V),
 * grade branca com espinhos cromados na frente e barra de 4 faróis no teto, como no sprite de 1993.
 * VK Plasma Rifles no capô, BF's Slipsauce atrás e Locust Jump Jets sob o assoalho.
 */
export function createDirtDevil(color: number, shadows: boolean): CarVisual {
  const { root, body, ext } = carFrame();
  const k = new Kit(color, shadows, ext);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // pintura lisa e brilhante (sem textura de desgaste: as superfícies curvas esticariam o UV em listras)
  const gloss = k.paint.clone();
  gloss.map = null;
  gloss.roughnessMap = null;
  gloss.roughness = 0.28;
  gloss.clearcoat = 1;
  gloss.clearcoatRoughness = 0.06;
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf0efe8, metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c141c, emissive: 0x040a12, metalness: 0.3, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 });
  const tray = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.45, roughness: 0.45 });

  // ---- casco: capô baixo e comprido na frente, traseira redonda de fusca
  const tubTop = (zn: number) => (zn > 0 ? 1 - 0.34 * smooth(0.05, 1, zn) : 1 - 0.08 * smooth(0.4, 1, -zn));
  const tub = k.add(blob(TUB.w, TUB.h, TUB.l, 0.72, 0, Math.PI, 0.42, tubTop), gloss, 0, TUB.y, 0);

  // ---- cabine-cúpula: vidro escuro brilhante, teto redondo pintado e colunas pintadas
  const cabTop = (zn: number) => 1 - 0.1 * smooth(0, 1, zn);
  const RT = 0.62; // corte teto/vidro (a partir do topo)
  k.add(blob(CAB.w * 0.985, CAB.h * 0.985, CAB.l * 0.985, 0.8, RT - 0.08, Math.PI / 2, 0.3, cabTop), glass, 0, CAB.y, CAB.z);
  const roof = k.add(blob(CAB.w, CAB.h, CAB.l, 0.8, 0, RT, 0.3, cabTop), gloss, 0, CAB.y, CAB.z);
  // colunas: seguem a superfície da cúpula do teto até o casco
  const cabPt = (th: number, ph: number) => {
    const x = Math.sin(th) * Math.sin(ph);
    const y = Math.cos(th);
    const z = Math.sin(th) * Math.cos(ph);
    const zn = spow(z, 0.8);
    return V(spow(x, 0.8) * CAB.w * 1.005, CAB.y + spow(y, 0.8) * CAB.h * cabTop(zn) * 1.005, CAB.z + zn * CAB.l * 1.005);
  };
  for (const ph of [0.62, -0.62, Math.PI - 0.7, Math.PI + 0.7, Math.PI / 2 - 0.1, -Math.PI / 2 + 0.1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) pts.push(cabPt(RT - 0.05 + (i / 6) * (Math.PI / 2 - RT + 0.05), ph));
    k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.065, 8), gloss, 0, 0, 0);
  }

  // ---- bandeja/chassi escuro por baixo (como a bandeja cinza do pack)
  const trayShape = new THREE.Shape();
  const tw = 0.62;
  const tl = 1.72;
  trayShape.moveTo(-tw, -tl + 0.3);
  trayShape.quadraticCurveTo(-tw, -tl, -tw + 0.3, -tl);
  trayShape.lineTo(tw - 0.3, -tl);
  trayShape.quadraticCurveTo(tw, -tl, tw, -tl + 0.3);
  trayShape.lineTo(tw, tl - 0.3);
  trayShape.quadraticCurveTo(tw, tl, tw - 0.3, tl);
  trayShape.lineTo(-tw + 0.3, tl);
  trayShape.quadraticCurveTo(-tw, tl, -tw, tl - 0.3);
  trayShape.closePath();
  const trayGeo = new THREE.ExtrudeGeometry(trayShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 6 });
  trayGeo.rotateX(Math.PI / 2);
  k.add(trayGeo, tray, 0, BOT + 0.02, 0);

  // ---- para-lamas bojudos e redondos sobre cada roda (folga para a roda subir)
  const fender = fenderGeo(WR + 0.2, WR + 0.3, 0.58, 0.1, 0.36, Math.PI - 0.36);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      k.add(fender, gloss, sx * (WX + 0.03), WR, sz * WZ);
    }
  // estribos escuros entre os para-lamas, com friso neon na cor do time (lê até em pista escura)
  for (const sx of [-1, 1]) {
    bar(k, V(sx * (WX - 0.04), BOT + 0.1, -WZ + 0.9), V(sx * (WX - 0.04), BOT + 0.1, WZ - 0.9), 0.1, tray);
    bar(k, V(sx * (WX + 0.05), BOT + 0.12, -WZ + 0.95), V(sx * (WX + 0.05), BOT + 0.12, WZ - 0.95), 0.03, k.accent);
  }

  // ---- GRADE BRANCA com espinhos cromados: a marca do sprite do original
  const gz = BL + 0.26;
  bar(k, V(-0.8, BOT + 0.02, gz - 0.02), V(0.8, BOT + 0.02, gz - 0.02), 0.12, white);
  for (const sx of [-1, 1]) bar(k, V(sx * 0.8, BOT + 0.02, gz - 0.02), V(sx * 0.62, BOT + 0.06, gz - 0.6), 0.09, white);
  bar(k, V(-0.7, BOT + 0.54, gz - 0.3), V(0.7, BOT + 0.54, gz - 0.3), 0.075, white);
  for (const x of [-0.72, -0.24, 0.24, 0.72]) bar(k, V(x, BOT + 0.02, gz - 0.02), V(x * 0.97, BOT + 0.54, gz - 0.3), 0.065, white);
  k.spikes(V(-0.68, BOT + 0.02, gz + 0.06), V(0.68, BOT + 0.02, gz + 0.06), 5, 0.4, V(0, 0.05, 1));
  // faróis redondos grandes atrás da grade
  for (const sx of [-0.52, 0.52]) lamp(k, sx, BOT + 0.3, BL - 0.1, 0.15, k.head, 0.25);

  // lanternas redondas na traseira arredondada
  tub.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  for (const sx of [-0.52, 0.52]) {
    ray.set(V(sx, TUB.y + 0.22, -5), V(0, 0, 1));
    const hz = ray.intersectObject(tub, false)[0]?.point.z ?? -TUB.l + 0.3;
    lamp(k, sx, TUB.y + 0.22, hz - 0.02, 0.11, k.tail, Math.PI - 0.45);
  }

  // ---- barra de 4 faróis de milha no teto
  const ry = CAB.y + CAB.h + 0.02;
  const rz = CAB.z + 0.3;
  bar(k, V(-0.56, ry + 0.1, rz), V(0.56, ry + 0.1, rz), 0.045, k.trim);
  for (const sx of [-1, 1]) bar(k, V(sx * 0.5, ry - 0.08, rz - 0.05), V(sx * 0.56, ry + 0.1, rz), 0.04, k.trim);
  for (const sx of [-0.42, -0.14, 0.14, 0.42]) lamp(k, sx, ry + 0.2, rz + 0.04, 0.115, k.head);

  // ---- VK Plasma Rifles apoiados no capô (sobre selas escuras)
  for (const sx of [-0.46, 0.46]) {
    k.add(new THREE.CapsuleGeometry(0.1, 0.34, 3, 10).rotateX(Math.PI / 2), k.trim, sx, TUB.y + 0.5, 1.02);
    k.plasmaRifle(sx, TUB.y + 0.6, 1.2, 1.0);
  }
  // BF's Slipsauce sob a traseira e escapamentos cromados subindo
  k.slipsauceTank(0, BOT + 0.02, -BL + 0.02, 0.9);
  for (const sx of [-0.66, 0.66]) {
    bar(k, V(sx, BOT + 0.05, -BL + 0.12), V(sx * 1.06, BOT + 0.95, -BL + 0.18), 0.07, k.chrome);
    k.add(new THREE.CylinderGeometry(0.1, 0.085, 0.14, 12), k.trim, sx * 1.06, BOT + 1.0, -BL + 0.18);
  }
  // Locust Jump Jets sob o assoalho
  for (const sx of [-1, 1]) k.jumpJet(sx * 0.42, BOT - 0.18, 0);

  // ---- suspensão aparente: eixos rígidos, diferencial e amortecedores amarelos com mola cromada
  for (const sz of [-1, 1]) {
    bar(k, V(-WX + 0.22, WR, sz * WZ), V(WX - 0.22, WR, sz * WZ), 0.075, k.gunMetal);
    k.add(new THREE.SphereGeometry(0.2, 16, 10), k.gunMetal, 0, WR, sz * WZ);
    bar(k, V(0, WR, sz * WZ), V(0, BOT - 0.06, sz * (WZ - 0.6)), 0.06, k.gunMetal);
    for (const sx of [-1, 1]) {
      bar(k, V(sx * 0.46, BOT - 0.02, sz * (WZ + 0.2)), V(sx * 0.64, WR, sz * WZ), 0.085, k.warn);
      bar(k, V(sx * 0.46, BOT - 0.02, sz * (WZ - 0.2)), V(sx * 0.64, WR, sz * WZ), 0.085, k.warn);
      const spring = new THREE.TorusGeometry(0.1, 0.02, 5, 12).rotateX(Math.PI / 2);
      for (let i = 0; i < 3; i++) k.add(spring, k.chrome, sx * (0.5 + i * 0.04), BOT - 0.12 - i * 0.12, sz * WZ);
    }
  }

  k.decalOn(roof, 0.8, 0.7, 0, CAB.z - 0.1, 'number');
  k.decalOn(tub, 0.62, 0.6, 0, 1.55, 'stripes');
  const flames = k.flames([[-0.7, BOT + 1.0, -BL - 0.1], [0.7, BOT + 1.0, -BL - 0.1]], 0.7);

  // rodas enormes com aro cromado (anel e calota) por cima da roda padrão
  const lip = new THREE.TorusGeometry(WR * 0.6, 0.06, 8, 28).rotateY(Math.PI / 2);
  const cap = new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2);
  const wheels = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => {
      const w = wheel(k, { radius: WR, width: 0.64, spokes: 5, knobby: true }, sx * WX, WR, sz * WZ);
      const ring = new THREE.Mesh(lip, k.chrome);
      ring.position.x = sx * 0.3;
      const c = new THREE.Mesh(cap, k.chrome);
      c.position.x = sx * 0.28;
      c.scale.x = sx;
      w.spin.add(ring, c);
      return { sz, ...w };
    }),
  );

  const eye = new THREE.Vector3(0, 2.3, -0.2);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.78, weapon: 'plasma', hoodLength: 1.8 }, body);
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
