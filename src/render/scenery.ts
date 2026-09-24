import { billboardGeometry, particleMaterial } from './effects';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../sim/math';
import type { ThemeId, Track } from '../sim/track';
import { rockGeometry, rockTexture } from './textures';
import type { Theme } from './themes';
import { pipeTexture } from './trackStyle';

export interface Scenery {
  group: THREE.Group;
  update: (t: number) => void;
}

type PropKind =
  | 'refinery' | 'torch' | 'dome' | 'crate'
  | 'totem' | 'pod' | 'eggs' | 'skullPole' | 'claw'
  | 'stump' | 'palm' | 'rock' | 'log'
  | 'crater' | 'ribs' | 'boulder'
  | 'pine' | 'iceCrystal' | 'snowRock'
  | 'obelisk' | 'lavaTorch' | 'hellDome';

/** Objetos de cada planeta (tirados dos mapas do original) e sua frequência. */
const PROPS: Record<ThemeId, [PropKind, number][]> = {
  chem6: [['refinery', 16], ['torch', 30], ['dome', 10], ['crate', 8]],
  drakonis: [['totem', 18], ['pod', 16], ['eggs', 18], ['skullPole', 22], ['claw', 8]],
  bogmire: [['stump', 40], ['palm', 18], ['rock', 18], ['log', 14]],
  newmojave: [['crater', 26], ['ribs', 22], ['boulder', 30]],
  nho: [['pine', 45], ['iceCrystal', 22], ['snowRock', 22]],
  inferno: [['obelisk', 24], ['lavaTorch', 20], ['hellDome', 14], ['boulder', 20]],
};

/** Altura aproximada (para não esconder a pista na vista aérea). */
const TALL: Partial<Record<PropKind, number>> = { refinery: 9, torch: 6, totem: 6, pod: 4, palm: 7, pine: 7, obelisk: 10, lavaTorch: 6, claw: 5 };

function pickKind(table: [PropKind, number][], r: number): PropKind {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  for (const [k, w] of table) {
    acc += w / total;
    if (r <= acc) return k;
  }
  return table[table.length - 1][0];
}

/**
 * Junta geometrias estáticas por material: centenas de objetos viram poucas chamadas de desenho
 * (importante no celular).
 */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1, rotX = 0, rotZ = 0): void {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    this.q.setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ'));
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this.m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(g);
  }
  build(group: THREE.Group, shadows: boolean): void {
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
  }
}

/** Cenário ao redor da pista, gerado por código de acordo com o planeta. */
export function buildScenery(track: Track, theme: Theme, themeId: ThemeId, shadows: boolean, seed = 6, dense = shadows): Scenery {
  const group = new THREE.Group();
  const batch = new Batch();
  const rng = createRng(seed);
  const b = track.bounds();
  const margin = 55;
  const G = theme.groundLevel;
  const [c0, c1, c2] = theme.props;

  // materiais compartilhados
  const std = (color: number, rough = 0.7, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const pipeMat = new THREE.MeshStandardMaterial({ map: pipeTexture(theme.wallAccent), metalness: 0.85, roughness: 0.3 });
  const steel = std(0x9aa0a8, 0.35, 0.85);
  const red = std(0xd02020, 0.4, 0.3, { emissive: 0x300000 });
  const bone = std(0xd8d4c8, 0.6);
  const blue = std(c0, 0.3, 0.2, { emissive: new THREE.Color(c0).multiplyScalar(0.15) });
  const purple = std(c1, 0.35, 0.2, { emissive: new THREE.Color(c1).multiplyScalar(0.2) });
  const wood = std(0x5a3418, 0.95);
  const leaf = std(0x2a8a24, 0.8);
  const pineMat = std(0x1e5a2c, 0.9);
  const snowMat = std(0xf2f6ff, 0.6);
  const ice = std(0x8ab8ff, 0.1, 0.1, { emissive: 0x10306a, transparent: true, opacity: 0.92 });
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTexture(c0), roughness: 0.95 });
  const rockMat2 = new THREE.MeshStandardMaterial({ map: rockTexture(c2 ?? c1), roughness: 0.95 });
  const hellStone = std(0x4a1208, 0.6, 0.2, { emissive: 0x3a0800 });
  const dark = std(0x1a0808, 0.7);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glow).multiplyScalar(2.5) });
  const rockGeos = [0, 1, 2, 3].map((i) => rockGeometry(1, seed * 10 + i, 2));

  // chamas animadas (tochas e refinarias) e fumaça subindo
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a20).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6a0).multiplyScalar(4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.5, 2.2, 10, 1, true).translate(0, 1.1, 0);
  // (duas malhas instanciadas no fim: antes, cada chama eram 2 objetos e ~150 chamadas de desenho)
  const flames: { x: number; y: number; z: number; scale: number; phase: number }[] = [];
  const smokeSources: THREE.Vector3[] = [];
  const addFlame = (x: number, y: number, z: number, scale: number, smoke = true) => {
    flames.push({ x, y, z, scale, phase: rng() * 10 });
    if (smoke) smokeSources.push(new THREE.Vector3(x, y + 2 * scale, z));
  };

  const clearOfTrack = (x: number, z: number, need: number) => {
    const q = track.query(x, z);
    return Math.hypot(q.outside, Math.max(0, Math.abs(q.lateral) - track.halfWidth)) > need;
  };
  /** Na vista aérea (olhando para +x/+z), um objeto alto esconde o que fica logo atrás dele. */
  const hidesTrack = (x: number, z: number, h: number) => {
    if (h <= 0) return false;
    const reach = h * 1.9;
    for (let k = 1; k <= 6; k++) {
      const d = (reach * k) / 6 / Math.SQRT2;
      if (!clearOfTrack(x + d, z + d, 1)) return true;
    }
    return false;
  };

  const table = PROPS[themeId];
  // Drakonis e Nho tinham o entorno vazio (chão chapado): o dobro de objetos. Tudo vai para poucas
  // malhas agrupadas (Batch), e o celular (sem `dense`) ganha bem menos.
  const busy = themeId === 'drakonis' || themeId === 'nho';
  const maxProps = Math.round((dense ? 380 : 180) * (busy ? (dense ? 2 : 1.35) : 1));
  let placed = 0;
  for (let tries = 0; tries < 9000 && placed < maxProps; tries++) {
    const x = b.minX - margin + rng() * (b.maxX - b.minX + margin * 2);
    const z = b.minZ - margin + rng() * (b.maxZ - b.minZ + margin * 2);
    const kind = pickKind(table, rng());
    if (!clearOfTrack(x, z, 3.5)) continue;
    const tall = TALL[kind];
    if (tall && hidesTrack(x, z, tall + G)) continue;
    placed++;
    const rot = rng() * Math.PI * 2;
    const s = 0.8 + rng() * 0.5;

    switch (kind) {
      /* ---------------- Chem VI ---------------- */
      case 'refinery': {
        // tanque cilíndrico empilhado, com anéis vermelhos e canhões no topo
        const r = 1.6 * s;
        const levels = 1 + Math.floor(rng() * 2);
        const hh = 2.6 * s;
        for (let k = 0; k < levels; k++) {
          const y = G + hh / 2 + k * (hh + 0.2);
          batch.add(new THREE.CylinderGeometry(r, r, hh, 20), pipeMat, x, y, z, rot);
          batch.add(new THREE.TorusGeometry(r * 1.01, 0.12, 6, 20), red, x, y + hh * 0.2, z, 0, 1, 1, 1, Math.PI / 2);
          batch.add(new THREE.TorusGeometry(r * 1.01, 0.12, 6, 20), red, x, y - hh * 0.2, z, 0, 1, 1, 1, Math.PI / 2);
        }
        const topY = G + levels * (hh + 0.2);
        batch.add(new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, x, topY - 0.2, z, 0, 1, 0.45, 1);
        for (const a of [0, 2.1, 4.2]) batch.add(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), steel, x + Math.cos(a + rot) * r * 0.5, topY + 0.3, z + Math.sin(a + rot) * r * 0.5, a + rot, 1, 1, 1, Math.PI / 2.4);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(3) }));
        lamp.position.set(x, topY + 0.35, z);
        group.add(lamp);
        break;
      }
      case 'torch': {
        // tocha de gás: cano fino com chama e fumaça
        const h = 1.8 + rng() * 1.5;
        batch.add(new THREE.CylinderGeometry(0.16, 0.22, h, 8), steel, x, G + h / 2, z);
        batch.add(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 8), dark, x, G + h, z);
        addFlame(x, G + h + 0.1, z, 0.6 + rng() * 0.3);
        break;
      }
      case 'dome': {
        batch.add(new THREE.SphereGeometry(1.4 * s, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, x, G, z, rot, 1, 0.7, 1);
        batch.add(new THREE.CylinderGeometry(0.14, 0.14, 1.5, 6), dark, x + Math.cos(rot) * 0.6, G + 1, z + Math.sin(rot) * 0.6, rot, 1, 1, 1, Math.PI / 2.5);
        break;
      }
      case 'crate': {
        batch.add(new THREE.BoxGeometry(1.4, 0.8, 1.1), steel, x, G + 0.4, z, rot);
        batch.add(new THREE.BoxGeometry(1.45, 0.12, 1.15), dark, x, G + 0.6, z, rot);
        break;
      }
      /* ---------------- Drakonis ---------------- */
      case 'totem': {
        // totem de ossos: coluna, caveira no topo e ossos cruzados
        const h = 3 + rng() * 1.5;
        batch.add(new THREE.CylinderGeometry(0.16, 0.22, h, 8), bone, x, G + h / 2, z);
        batch.add(new THREE.SphereGeometry(0.42, 12, 10), bone, x, G + h + 0.25, z, rot, 1, 1.1, 1);
        batch.add(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 6), bone, x, G + h * 0.65, z, rot, 1, 1, 1, 0, 0.9);
        batch.add(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 6), bone, x, G + h * 0.65, z, rot, 1, 1, 1, 0, -0.9);
        const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), glowMat);
        eyeL.position.set(x + Math.cos(rot) * 0.3, G + h + 0.3, z + Math.sin(rot) * 0.3);
        group.add(eyeL);
        break;
      }
      case 'pod': {
        // casulo alienígena azul com abertura
        batch.add(new THREE.CapsuleGeometry(0.9 * s, 1.4 * s, 6, 12), blue, x, G + 1.3 * s, z, rot, 1, 1, 0.8);
        batch.add(new THREE.TorusGeometry(0.9 * s, 0.14, 8, 16), purple, x, G + 0.35, z, 0, 1, 1, 1, Math.PI / 2);
        break;
      }
      case 'eggs': {
        // monte de ovos/bolhas azuis
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + rot;
          const rr = 0.45 + rng() * 0.3;
          batch.add(new THREE.SphereGeometry(rr, 12, 8), blue, x + Math.cos(a) * 0.6, G + rr * 0.9, z + Math.sin(a) * 0.6, 0, 1, 1.25, 1);
        }
        batch.add(new THREE.SphereGeometry(0.6, 12, 8), blue, x, G + 1.1, z, 0, 1, 1.3, 1);
        break;
      }
      case 'skullPole': {
        const h = 1.6 + rng();
        batch.add(new THREE.CylinderGeometry(0.06, 0.06, h, 5), bone, x, G + h / 2, z);
        batch.add(new THREE.SphereGeometry(0.22, 10, 8), bone, x, G + h + 0.1, z, 0, 1, 1.15, 1);
        break;
      }
      case 'claw': {
        // máquina de garras roxas (as armas-tentáculo do mapa)
        batch.add(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 10), purple, x, G + 0.6, z);
        for (let k = 0; k < 4; k++) {
          const a = rot + (k - 1.5) * 0.35;
          batch.add(new THREE.ConeGeometry(0.16, 2.6, 6), purple, x + Math.cos(a) * 0.3, G + 2.2, z + Math.sin(a) * 0.3, a, 1, 1, 1, 0.35, 0);
        }
        batch.add(new THREE.CylinderGeometry(0.14, 0.14, 1.8, 6), blue, x, G + 1.2, z, rot, 1, 1, 1, Math.PI / 2);
        break;
      }
      /* ---------------- Bogmire ---------------- */
      case 'stump': {
        const r = 0.5 + rng() * 0.5;
        batch.add(new THREE.CylinderGeometry(r, r * 1.3, 0.9, 10), wood, x, G + 0.3, z, rot);
        break;
      }
      case 'palm': {
        const h = 3 + rng() * 2;
        const lean = (rng() - 0.5) * 0.4;
        batch.add(new THREE.CylinderGeometry(0.14, 0.24, h, 7), wood, x, G + h / 2, z, rot, 1, 1, 1, lean);
        const tx = x + Math.sin(lean) * h * 0.5 * Math.cos(rot);
        const tz = z + Math.sin(lean) * h * 0.5 * Math.sin(rot);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          batch.add(new THREE.ConeGeometry(0.35, 2.4, 4), leaf, tx + Math.cos(a) * 0.9, G + h - 0.2, tz + Math.sin(a) * 0.9, -a + Math.PI / 2, 1, 1, 0.35, 0, Math.PI / 2.4);
        }
        break;
      }
      case 'rock':
      case 'boulder':
      case 'snowRock': {
        const r = (kind === 'boulder' ? 0.9 : 0.7) + rng() * 1.3;
        const mat = kind === 'snowRock' ? snowMat : rng() > 0.5 ? rockMat : rockMat2;
        batch.add(rockGeos[Math.floor(rng() * rockGeos.length)], mat, x, G + r * 0.2, z, rot, r, r * (0.5 + rng() * 0.4), r * (1 + rng() * 0.4));
        break;
      }
      case 'log': {
        batch.add(new THREE.CylinderGeometry(0.28, 0.28, 2.6 + rng() * 2, 8), wood, x, G + 0.1, z, rot, 1, 1, 1, 0, Math.PI / 2);
        break;
      }
      /* ---------------- New Mojave ---------------- */
      case 'crater': {
        const r = 1.6 + rng() * 2.2;
        batch.add(new THREE.TorusGeometry(r, r * 0.25, 8, 22), rockMat, x, G, z, 0, 1, 1, 0.45, Math.PI / 2);
        batch.add(new THREE.CircleGeometry(r, 18), dark, x, G + 0.03, z, 0, 1, 1, 1, -Math.PI / 2);
        break;
      }
      case 'ribs': {
        // ossada de um bicho gigante: arcos de costelas
        for (let k = 0; k < 5; k++) {
          const off = (k - 2) * 0.55;
          batch.add(new THREE.TorusGeometry(1.1 - Math.abs(k - 2) * 0.12, 0.08, 6, 12, Math.PI), bone, x + Math.cos(rot) * off, G, z + Math.sin(rot) * off, rot + Math.PI / 2);
        }
        batch.add(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), bone, x, G + 0.1, z, rot, 1, 1, 1, 0, Math.PI / 2);
        break;
      }
      /* ---------------- Nho ---------------- */
      case 'pine': {
        const h = 2.4 + rng() * 2;
        batch.add(new THREE.CylinderGeometry(0.1, 0.16, h * 0.35, 6), wood, x, G + h * 0.17, z);
        for (let k = 0; k < 3; k++) {
          const w = (1.1 - k * 0.28) * (h / 3);
          batch.add(new THREE.ConeGeometry(w, h * 0.45, 8), pineMat, x, G + h * (0.35 + k * 0.22), z, rot);
          batch.add(new THREE.ConeGeometry(w * 0.7, h * 0.12, 8), snowMat, x, G + h * (0.49 + k * 0.22), z, rot);
        }
        break;
      }
      case 'iceCrystal': {
        const n = 3 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const h = 1 + rng() * 2.4;
          batch.add(new THREE.OctahedronGeometry(0.5, 0), ice, x + (rng() - 0.5) * 1.6, G + h / 2, z + (rng() - 0.5) * 1.6, rng() * 3, 0.8, h, 0.8, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5);
        }
        break;
      }
      /* ---------------- Inferno ---------------- */
      case 'obelisk': {
        const h = 3 + rng() * 3;
        batch.add(new THREE.CylinderGeometry(0.55, 0.9, h, 6), hellStone, x, G + h / 2, z, rot);
        batch.add(new THREE.ConeGeometry(0.6, 1.2, 6), hellStone, x, G + h + 0.6, z, rot);
        const core = new THREE.Mesh(new THREE.BoxGeometry(0.15, h * 0.5, 0.15), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5010).multiplyScalar(2) }));
        core.position.set(x + Math.cos(rot) * 0.62, G + h * 0.55, z + Math.sin(rot) * 0.62);
        group.add(core);
        break;
      }
      case 'lavaTorch': {
        const h = 2 + rng() * 1.5;
        batch.add(new THREE.CylinderGeometry(0.08, 0.1, h, 6), steel, x, G + h / 2, z);
        addFlame(x, G + h, z, 0.5, false);
        break;
      }
      case 'hellDome': {
        batch.add(new THREE.SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, x, G, z, rot, 1, 0.6, 1);
        batch.add(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), dark, x, G + 0.8, z, rot, 1, 1, 1, Math.PI / 2.5);
        break;
      }
    }
  }
  // detritos pequenos espalhados (pedras, cascalho): quebram o chão liso entre os objetos
  if (!theme.liquid) {
    const debris = Math.round((dense ? 420 : 160) * (busy ? (dense ? 2 : 1.35) : 1));
    const debrisMat = themeId === 'nho' ? snowMat : rockMat2;
    for (let i = 0, tries = 0; i < debris && tries < 6000; tries++) {
      const x = b.minX - margin + rng() * (b.maxX - b.minX + margin * 2);
      const z = b.minZ - margin + rng() * (b.maxZ - b.minZ + margin * 2);
      if (!clearOfTrack(x, z, 2)) continue;
      i++;
      const r = 0.15 + rng() * rng() * 0.9;
      batch.add(rockGeos[i % 4], debrisMat, x, G + r * 0.2, z, rng() * 6, r * (1 + rng()), r * 0.6, r * (1 + rng()));
    }
  }
  // Nho: aglomerados de cristais azuis na base dos paredões (como no SNES)
  if (themeId === 'nho') {
    const want = dense ? 150 : 70;
    for (let i = 0, tries = 0; i < want && tries < 6000; tries++) {
      const x = b.minX - 8 + rng() * (b.maxX - b.minX + 16);
      const z = b.minZ - 8 + rng() * (b.maxZ - b.minZ + 16);
      const q = track.query(x, z);
      const d = Math.hypot(q.outside, Math.max(0, Math.abs(q.lateral) - track.halfWidth));
      if (d < 1.2 || d > 4.5) continue;
      i++;
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const h = 1.2 + rng() * 3.2;
        batch.add(new THREE.OctahedronGeometry(0.5, 0), ice, x + (rng() - 0.5) * 1.4, G + h / 2, z + (rng() - 0.5) * 1.4, rng() * 3, 0.7 + rng() * 0.4, h, 0.7 + rng() * 0.4, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6);
      }
    }
  }
  batch.build(group, shadows);

  // fumaça das tochas: billboards suaves que sobem e somem (reaproveitados em ciclo)
  const PER = 4;
  const smokeCount = Math.max(1, smokeSources.length * PER);
  const bb = billboardGeometry(smokeCount);
  const smokeMesh = new THREE.InstancedMesh(bb.geo, particleMaterial('smoke'), smokeCount);
  smokeMesh.setColorAt(0, new THREE.Color(0x4a4440));
  for (let i = 0; i < smokeCount; i++) {
    smokeMesh.setColorAt(i, new THREE.Color(0x4a4440));
    bb.rot.setX(i, i * 1.7);
  }
  smokeMesh.renderOrder = 2;
  smokeMesh.count = smokeSources.length * PER;
  smokeMesh.frustumCulled = false;
  group.add(smokeMesh);
  const sm = new THREE.Matrix4();
  const sq = new THREE.Quaternion();
  const sp = new THREE.Vector3();
  const ss = new THREE.Vector3();

  const flameOuter = new THREE.InstancedMesh(flameGeo, flameMat, Math.max(1, flames.length));
  const flameInner = new THREE.InstancedMesh(flameGeo, flameCore, Math.max(1, flames.length));
  for (const m of [flameOuter, flameInner]) {
    m.count = flames.length;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (flames.length) group.add(m);
  }
  const fq = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  const update = (t: number) => {
    flames.forEach((f, i) => {
      const n = Math.sin(t * 13 + f.phase) * 0.14 + Math.sin(t * 29 + f.phase * 2) * 0.08;
      sp.set(f.x, f.y, f.z);
      fq.setFromAxisAngle(up, t * 2 + f.phase);
      flameOuter.setMatrixAt(i, sm.compose(sp, fq, ss.set(f.scale, f.scale * (1 + n), f.scale)));
      fq.identity();
      const k = f.scale * 0.55;
      flameInner.setMatrixAt(i, sm.compose(sp, fq, ss.set(k, k * (1 + n * 1.5), k)));
    });
    flameOuter.instanceMatrix.needsUpdate = true;
    flameInner.instanceMatrix.needsUpdate = true;
    smokeSources.forEach((src, i) => {
      for (let k = 0; k < PER; k++) {
        const life = (t * 0.35 + k / PER + i * 0.37) % 1;
        sp.set(src.x + Math.sin(i + life * 3) * 0.4 * life, src.y + life * 5, src.z + life * 0.8);
        ss.setScalar(0.8 + life * 3);
        sm.compose(sp, sq, ss);
        smokeMesh.setMatrixAt(i * PER + k, sm);
        bb.alpha.setX(i * PER + k, Math.min(1, life / 0.1) * (1 - life) * 0.8);
      }
    });
    smokeMesh.instanceMatrix.needsUpdate = true;
    bb.alpha.needsUpdate = true;
  };
  return { group, update };
}
