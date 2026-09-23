import * as THREE from 'three';
import { forwardX, forwardZ, leftX, leftZ } from '../sim/math';
import { reverseWarpSide, type Piece, type Track } from '../sim/track';
import type { Theme } from './themes';
import { canvas, roadMaps as roadMapsRaw, tex, wallMaps as wallMapsRaw } from './trackStyle';

// Pistas com vãos/cruzamentos têm vários trechos: as texturas do planeta são geradas uma vez só.
const memo = <T,>(fn: (t: Theme) => T) => {
  const cache = new WeakMap<Theme, T>();
  return (t: Theme): T => {
    if (!cache.has(t)) cache.set(t, fn(t));
    return cache.get(t)!;
  };
};
export const roadMaps = memo(roadMapsRaw);
export const wallMaps = memo(wallMapsRaw);

/**
 * Elementos de pista do original que não são a faixa contínua (ver sim/track.ts):
 *  - cruzamentos (X): placa em cruz no mesmo nível, com o bloco por baixo e muretas nas quinas;
 *  - vãos (G): tampa do bloco nas bordas do vão (a pista "acaba" no abismo) e faixa de perigo;
 *  - setas de warp (`>` impulso, `<` warp reverso de Inferno, só num lado da pista).
 */
export function addTrackFeatures(group: THREE.Group, track: Track, theme: Theme, shadows: boolean): void {
  addCrossings(group, track, theme, shadows);
  addGapEnds(group, track, theme, shadows);
  addWarps(group, track);
}

/** Posição/rotação de um objeto no ponto s de uma peça (reta), com deslocamento lateral e altura. */
function place(o: THREE.Object3D, p: Piece, s: number, lateral: number, y: number): void {
  o.position.set(
    p.x0 + forwardX(p.heading0) * s + leftX(p.heading0) * lateral,
    p.h0 + y,
    p.z0 + forwardZ(p.heading0) * s + leftZ(p.heading0) * lateral,
  );
  o.rotation.y = p.heading0; // +z local = frente da peça, +x local = esquerda
}

function addCrossings(group: THREE.Group, track: Track, theme: Theme, shadows: boolean): void {
  const xs = track.pieces.filter((p) => p.code === 'X');
  if (!xs.length) return;
  const W = track.halfWidth;
  const L = xs[0].length;
  const WALL = 0.45;
  const rm = roadMaps(theme);
  const roadMat = new THREE.MeshStandardMaterial({ map: rm.map.clone(), normalMap: rm.normal, roughness: rm.roughness, metalness: rm.metalness });
  roadMat.map!.needsUpdate = true;
  // a textura do piso cobre 2W x 2W metros, como na faixa contínua
  roadMat.map!.repeat.set(1, L / (W * 2));
  if (rm.emissive) {
    roadMat.emissiveMap = rm.emissive;
    roadMat.emissive = new THREE.Color(0xffffff);
    roadMat.emissiveIntensity = theme.roadGlow;
  }
  const wm = wallMaps(theme);
  const wallMat = new THREE.MeshStandardMaterial({ map: wm.map, normalMap: wm.normal, roughness: wm.roughness, metalness: wm.metalness });
  const railMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.rail[0]), roughness: 0.4, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.rail[1]), emissive: new THREE.Color(theme.rail[1]), emissiveIntensity: 0.4 });
  const done: { x: number; z: number }[] = [];
  for (const p of xs) {
    const c = track.pointOn(p, L / 2);
    if (done.some((d) => Math.hypot(d.x - c.x, d.z - c.z) < 1)) continue; // o par já foi feito
    done.push(c);
    const other = xs.find((o) => o !== p && Math.hypot(track.pointOn(o, L / 2).x - c.x, track.pointOn(o, L / 2).z - c.z) < 1)!;
    for (const q of [p, other]) {
      if (!q) continue;
      // piso da faixa desta passagem
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + 0.1, L).rotateX(-Math.PI / 2), roadMat);
      place(floor, q, L / 2, 0, q === p ? 0.002 : 0.004);
      floor.receiveShadow = shadows;
      group.add(floor);
      // bloco por baixo (continua o paredão da pista)
      const depth = q.h0 - theme.groundLevel + 0.5;
      const block = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + WALL * 2, depth, L), wallMat);
      place(block, q, L / 2, 0, -depth / 2 - 0.05);
      block.receiveShadow = shadows;
      group.add(block);
    }
    // muretas nas 4 quinas da cruz (entre a borda de uma faixa e a da outra)
    const seg = (L - W * 2) / 2;
    if (seg > 0.2) {
      for (const q of [p, other]) {
        for (const side of [1, -1]) {
          for (const end of [0, 1]) {
            const s = end === 0 ? seg / 2 : L - seg / 2;
            const rail = new THREE.Mesh(new THREE.BoxGeometry(WALL, 0.45, seg), railMat);
            place(rail, q, s, side * (W + WALL / 2), 0.2);
            rail.castShadow = shadows;
            group.add(rail);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL + 0.02, 0.08, seg), accentMat);
            place(cap, q, s, side * (W + WALL / 2), 0.46);
            group.add(cap);
          }
        }
      }
    }
  }
}

function hazardTexture(): THREE.CanvasTexture {
  const t = tex(
    canvas(128, 32, (ctx) => {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 128, 32);
      ctx.fillStyle = '#ffd21a';
      for (let x = -32; x < 160; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 32);
        ctx.lineTo(x + 16, 32);
        ctx.lineTo(x + 32, 0);
        ctx.lineTo(x + 16, 0);
        ctx.closePath();
        ctx.fill();
      }
    }),
  );
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function addGapEnds(group: THREE.Group, track: Track, theme: Theme, shadows: boolean): void {
  const n = track.pieces.length;
  const W = track.halfWidth;
  const WALL = 0.45;
  const wm = wallMaps(theme);
  const wallMat = new THREE.MeshStandardMaterial({ map: wm.map, normalMap: wm.normal, roughness: wm.roughness, metalness: wm.metalness });
  let hz: THREE.CanvasTexture | null = null;
  for (const p of track.pieces) {
    if (p.code !== 'G') continue;
    const prev = track.pieces[(p.index - 1 + n) % n];
    const next = track.pieces[(p.index + 1) % n];
    // bordas: onde a pista acaba antes do vão e onde recomeça depois dele
    const ends: { piece: Piece; s: number; face: 1 | -1 }[] = [];
    if (prev.code !== 'G') ends.push({ piece: p, s: 0, face: 1 });
    if (next.code !== 'G') ends.push({ piece: p, s: p.length, face: -1 });
    for (const e of ends) {
      const h = e.face > 0 ? track.heightOn(prev, prev.length) : track.heightOn(next, 0);
      const depth = h - theme.groundLevel + 0.5;
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + WALL * 2, depth), wallMat);
      place(cap, e.piece, e.s, 0, 0);
      cap.position.y = h - depth / 2;
      // a face aponta para dentro do vão
      if (e.face < 0) cap.rotation.y += Math.PI;
      cap.receiveShadow = shadows;
      group.add(cap);
      // faixa de perigo no chão, rente à borda
      hz ??= hazardTexture();
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(W * 2, 0.7).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: hz, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      (stripe.material as THREE.MeshStandardMaterial).map!.repeat.set((W * 2) / 3, 1);
      place(stripe, e.piece, e.s - e.face * 0.45, 0, 0);
      stripe.position.y = h + 0.03;
      group.add(stripe);
    }
  }
}

function arrowsTexture(color: string, glow: string): THREE.CanvasTexture {
  return tex(
    canvas(128, 256, (ctx) => {
      ctx.clearRect(0, 0, 128, 256);
      for (let k = 0; k < 3; k++) {
        const y = 30 + k * 76;
        ctx.beginPath();
        ctx.moveTo(64, y);
        ctx.lineTo(118, y + 52);
        ctx.lineTo(96, y + 52);
        ctx.lineTo(64, y + 22);
        ctx.lineTo(32, y + 52);
        ctx.lineTo(10, y + 52);
        ctx.closePath();
        ctx.shadowColor = glow;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.fill();
      }
    }),
  );
}

function addWarps(group: THREE.Group, track: Track): void {
  const W = track.halfWidth;
  let fwdMat: THREE.MeshStandardMaterial | null = null;
  let revMat: THREE.MeshStandardMaterial | null = null;
  for (const p of track.pieces) {
    if (!p.warp) continue;
    const len = p.length * 0.4;
    if (p.warp > 0) {
      fwdMat ??= new THREE.MeshStandardMaterial({
        map: arrowsTexture('#3cff6a', '#aaffc0'),
        emissive: 0x2aff5a,
        emissiveIntensity: 1.6,
        emissiveMap: null,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      });
      fwdMat.emissiveMap = fwdMat.map;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.7, len).rotateX(-Math.PI / 2), fwdMat);
      place(m, p, p.length / 2, 0, 0.04);
      m.rotation.y += Math.PI; // a ponta das setas (topo da textura) fica para a frente
      group.add(m);
    } else {
      revMat ??= new THREE.MeshStandardMaterial({
        map: arrowsTexture('#ff2a1a', '#ffb0a0'),
        emissive: 0xff2a10,
        emissiveIntensity: 1.8,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      });
      revMat.emissiveMap = revMat.map;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, len).rotateX(-Math.PI / 2), revMat);
      place(m, p, p.length / 2, reverseWarpSide(p.index) * W * 0.5, 0.04);
      group.add(m); // sem girar: as setas apontam para trás
    }
  }
}
