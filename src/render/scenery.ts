import * as THREE from 'three';
import { createRng } from '../sim/math';
import type { ThemeId, Track } from '../sim/track';
import { canvasTexture } from './trackMesh';
import { concreteNormal, mesaGeometry, rockGeometry, rockTexture, terrainNormal } from './textures';
import type { Theme } from './themes';

export interface Scenery {
  group: THREE.Group;
  update: (t: number) => void;
}

function rustTexture(base: number, seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = rng() > 0.5 ? `rgba(120,50,20,${rng() * 0.35})` : `rgba(0,0,0,${rng() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(rng() * 256, rng() * 256, 3 + rng() * 22, 2 + rng() * 10, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < 256; y += 42) ctx.fillRect(0, y, 256, 3); // soldas
  });
}

type PropKind = 'flamePipe' | 'tank' | 'tower' | 'pipeline' | 'rock' | 'reeds' | 'crater' | 'crystal' | 'mesa' | 'cactus' | 'spire' | 'post' | 'vent';

/** Que tipo de objeto aparece em cada planeta, e com que frequência. */
const PROPS: Record<ThemeId, [PropKind, number][]> = {
  // pântano químico com refinarias e canos queimando metano
  chem6: [['flamePipe', 18], ['tank', 12], ['tower', 12], ['pipeline', 13], ['rock', 25], ['reeds', 20]],
  // roxo e preto, crateras lunares
  drakonis: [['crater', 30], ['rock', 30], ['crystal', 20], ['spire', 12], ['tower', 8]],
  // terra marrom e oceano azul
  bogmire: [['rock', 35], ['post', 25], ['reeds', 25], ['tank', 8], ['pipeline', 7]],
  // deserto
  newmojave: [['mesa', 22], ['cactus', 35], ['rock', 35], ['post', 8]],
  // rocha escura e cristais
  nho: [['spire', 30], ['crystal', 30], ['rock', 30], ['crater', 10]],
  // lava
  inferno: [['vent', 25], ['spire', 25], ['rock', 35], ['flamePipe', 15]],
};

function pickKind(table: [PropKind, number][], r: number): PropKind {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  for (const [k, w] of table) {
    acc += w / total;
    if (r <= acc) return k;
  }
  return table[table.length - 1][0];
}

/** Cenário ao redor da pista, gerado por código de acordo com o planeta. */
export function buildScenery(track: Track, theme: Theme, themeId: ThemeId, shadows: boolean, seed = 6): Scenery {
  const group = new THREE.Group();
  const rng = createRng(seed);
  const b = track.bounds();
  const margin = 70;
  const G = theme.groundLevel;
  const rust = theme.props.map((c, i) => new THREE.MeshStandardMaterial({ map: rustTexture(c, 10 + i), roughness: 0.7, metalness: 0.6 }));
  // rochas com cor variada e relevo (nada de polígonos chapados)
  const rock = new THREE.MeshStandardMaterial({ map: rockTexture(theme.props[0]), normalMap: concreteNormal(), normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.95 });
  const rockDark = new THREE.MeshStandardMaterial({ map: rockTexture(theme.skirt), normalMap: concreteNormal(), normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.95 });
  const mesaMat = new THREE.MeshStandardMaterial({ map: rockTexture(theme.props[0]), normalMap: terrainNormal(), normalScale: new THREE.Vector2(2, 2), roughness: 0.97, vertexColors: true });
  // poucas variações de geometria, compartilhadas entre as instâncias
  const rockGeos = [0, 1, 2, 3, 4, 5].map((i) => rockGeometry(1, seed * 10 + i));
  const crystalMat = new THREE.MeshStandardMaterial({ color: theme.glow, emissive: theme.glow, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.3, flatShading: true });
  const plant = new THREE.MeshStandardMaterial({ color: themeId === 'newmojave' ? 0x4a7a2a : 0x3a4a22, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.95 });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a20).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6a0).multiplyScalar(4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.9, 4, 10, 1, true);
  flameGeo.translate(0, 2, 0);
  const flames: { outer: THREE.Mesh; inner: THREE.Mesh; phase: number }[] = [];
  const glows: { mesh: THREE.Mesh; phase: number }[] = [];

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    group.add(m);
    return m;
  };

  const addFlame = (x: number, y: number, z: number, scale: number) => {
    const outer = new THREE.Mesh(flameGeo, flameMat);
    const inner = new THREE.Mesh(flameGeo, flameCore);
    outer.position.set(x, y, z);
    inner.position.set(x, y, z);
    outer.scale.setScalar(scale);
    inner.scale.setScalar(scale * 0.55);
    group.add(outer, inner);
    flames.push({ outer, inner, phase: rng() * 10 });
  };

  const clearOfTrack = (x: number, z: number, need: number) => {
    const q = track.query(x, z);
    return Math.hypot(q.outside, Math.max(0, Math.abs(q.lateral) - track.halfWidth)) > need;
  };

  /**
   * Na vista aérea (câmera a 30°, olhando para +x/+z), um objeto de altura h esconde o que
   * está até ~1,7·h atrás dele. Objetos altos não podem ficar nessa posição em relação à pista.
   */
  const hidesTrack = (x: number, z: number, h: number) => {
    const reach = h * 1.8;
    for (let k = 1; k <= 6; k++) {
      const d = (reach * k) / 6 / Math.SQRT2;
      if (!clearOfTrack(x + d, z + d, 1)) return true;
    }
    return false;
  };
  const TALL: Partial<Record<PropKind, number>> = { tank: 10, tower: 26, mesa: 18, spire: 18, flamePipe: 14 };

  const table = PROPS[themeId];
  let placed = 0;
  for (let tries = 0; tries < 1500 && placed < 150; tries++) {
    const x = b.minX - margin + rng() * (b.maxX - b.minX + margin * 2);
    const z = b.minZ - margin + rng() * (b.maxZ - b.minZ + margin * 2);
    const kind = pickKind(table, rng());
    const big = kind === 'tank' || kind === 'tower' || kind === 'mesa' || kind === 'crater';
    if (!clearOfTrack(x, z, big ? 16 : 8)) continue;
    const tall = TALL[kind];
    if (tall && hidesTrack(x, z, tall)) continue;
    placed++;
    const mat = rust[Math.floor(rng() * rust.length)];

    switch (kind) {
      case 'flamePipe': {
        const h = 6 + rng() * 10;
        mesh(new THREE.CylinderGeometry(0.55, 0.7, h, 12), mat, x, G + h / 2, z);
        mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.5, 12), mat, x, G + h, z);
        addFlame(x, G + h + 0.2, z, 0.8 + rng() * 0.6);
        break;
      }
      case 'tank': {
        const r = 3 + rng() * 3;
        const h = 5 + rng() * 5;
        mesh(new THREE.CylinderGeometry(r + 1, r + 1.4, 1.5, 20), rockDark, x, G + 0.5, z);
        mesh(new THREE.CylinderGeometry(r, r, h, 24), mat, x, G + 1.2 + h / 2, z);
        mesh(new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat, x, G + 1.2 + h, z).scale.y = 0.35;
        mesh(new THREE.BoxGeometry(0.4, h, 0.15), rust[0], x + r + 0.1, G + 1.2 + h / 2, z);
        break;
      }
      case 'tower': {
        const h = 14 + rng() * 14;
        mesh(new THREE.CylinderGeometry(1.2, 1.6, h, 14), mat, x, G + h / 2, z);
        for (let k = 1; k < 4; k++) mesh(new THREE.TorusGeometry(1.7, 0.18, 6, 16), rust[0], x, G + (h * k) / 4, z).rotation.x = Math.PI / 2;
        if (theme.flames && rng() > 0.5) addFlame(x, G + h, z, 1.2);
        else {
          const lamp = mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(3) }), x, G + h + 0.4, z);
          glows.push({ mesh: lamp, phase: rng() * 6 });
        }
        break;
      }
      case 'pipeline': {
        const len = 10 + rng() * 20;
        const ang = rng() * Math.PI;
        const pipe = mesh(new THREE.CylinderGeometry(0.5, 0.5, len, 10), mat, x, G + 2.5, z);
        pipe.rotation.set(0, ang, Math.PI / 2);
        for (const t of [-0.4, 0, 0.4]) mesh(new THREE.BoxGeometry(0.4, 2.5, 0.4), rust[0], x + Math.cos(ang) * len * t, G + 1.25, z - Math.sin(ang) * len * t);
        break;
      }
      case 'rock': {
        const r = 1.5 + rng() * 4;
        const m = mesh(rockGeos[Math.floor(rng() * rockGeos.length)], rng() > 0.5 ? rock : rockDark, x, G + r * 0.05, z);
        m.scale.set(r, r * (0.45 + rng() * 0.5), r * (1 + rng() * 0.6));
        m.rotation.y = rng() * Math.PI;
        break;
      }
      case 'reeds': {
        const reeds = new THREE.Group();
        for (let k = 0; k < 7; k++) {
          const h = 1 + rng() * 2;
          const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, h, 4), plant);
          r.position.set((rng() - 0.5) * 2, G + h / 2, (rng() - 0.5) * 2);
          r.rotation.set((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4);
          reeds.add(r);
        }
        reeds.position.set(x, 0, z);
        group.add(reeds);
        break;
      }
      case 'crater': {
        const r = 4 + rng() * 6;
        const rim = mesh(new THREE.TorusGeometry(r, r * 0.22, 10, 36), rock, x, G, z);
        rim.rotation.x = Math.PI / 2;
        rim.scale.z = 0.5;
        const floor = mesh(new THREE.CircleGeometry(r, 24), rockDark, x, G + 0.02, z);
        floor.rotation.x = -Math.PI / 2;
        break;
      }
      case 'crystal': {
        const n = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const h = 2 + rng() * 5;
          const c = mesh(new THREE.OctahedronGeometry(0.8, 0), crystalMat, x + (rng() - 0.5) * 3, G + h / 2, z + (rng() - 0.5) * 3);
          c.scale.set(0.7, h / 1.6, 0.7);
          c.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
          c.castShadow = false;
        }
        break;
      }
      case 'mesa': {
        const r = 6 + rng() * 10;
        const h = 6 + rng() * 14;
        const m = mesh(mesaGeometry(r, h, Math.floor(rng() * 1000)), mesaMat, x, G + h / 2, z);
        m.rotation.y = rng() * 3;
        break;
      }
      case 'cactus': {
        const h = 2.5 + rng() * 3;
        mesh(new THREE.CylinderGeometry(0.3, 0.35, h, 8), plant, x, G + h / 2, z);
        for (const side of [-1, 1]) {
          if (rng() > 0.6) continue;
          const armH = 0.8 + rng();
          const y = G + h * (0.4 + rng() * 0.3);
          mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 6), plant, x + side * 0.5, y, z).rotation.z = Math.PI / 2;
          mesh(new THREE.CylinderGeometry(0.2, 0.22, armH, 6), plant, x + side * 0.9, y + armH / 2, z);
        }
        break;
      }
      case 'spire': {
        const h = 8 + rng() * 18;
        // pico de rocha: pedra orgânica esticada na vertical
        const w = 1.5 + rng() * 2;
        const m = mesh(rockGeos[Math.floor(rng() * rockGeos.length)], rockDark, x, G + h * 0.35, z);
        m.scale.set(w, h * 0.55, w * (0.8 + rng() * 0.4));
        m.rotation.set((rng() - 0.5) * 0.15, rng() * 3, (rng() - 0.5) * 0.15);
        break;
      }
      case 'post': {
        const h = 2 + rng() * 3;
        mesh(new THREE.CylinderGeometry(0.25, 0.3, h, 6), wood, x, G + h / 2 - 0.5, z).rotation.z = (rng() - 0.5) * 0.3;
        break;
      }
      case 'vent': {
        const r = 1.5 + rng() * 1.5;
        mesh(new THREE.CylinderGeometry(r * 0.6, r, 1.6, 10), rockDark, x, G + 0.8, z);
        addFlame(x, G + 1.5, z, 0.7 + rng() * 0.5);
        break;
      }
    }
  }

  const update = (t: number) => {
    for (const f of flames) {
      const n = Math.sin(t * 13 + f.phase) * 0.12 + Math.sin(t * 29 + f.phase * 2) * 0.08;
      f.outer.scale.y = f.outer.scale.x * (1 + n);
      f.inner.scale.y = f.inner.scale.x * (1 + n * 1.5);
      f.outer.rotation.y = t * 2 + f.phase;
    }
    for (const g of glows) g.mesh.visible = Math.sin(t * 3 + g.phase) > 0;
  };
  return { group, update };
}
