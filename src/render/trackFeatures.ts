import * as THREE from 'three';
import { forwardX, forwardZ, leftX, leftZ } from '../sim/math';
import { reverseWarpSide, type Piece, type Track } from '../sim/track';
import type { Theme } from './themes';
import { addRoadDirt, canvas, roadMaps as roadMapsRaw, tex, wallMaps as wallMapsRaw } from './trackStyle';
import { WALL_OFFSET } from './trackMesh';

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
 *  - cruzamentos (X): placa em cruz no mesmo nível, com o bloco por baixo e muretas nas quinas
 *    (a passagem de cima com as faixas de borda contínuas); em viaduto, ponte sobre a de baixo;
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
  const WALL = WALL_OFFSET;
  const rm = roadMaps(theme);
  const roadMat = new THREE.MeshStandardMaterial({ map: rm.map.clone(), normalMap: rm.normal, roughnessMap: rm.roughnessMap, roughness: 1, metalness: rm.metalness, envMapIntensity: 0.55 });
  roadMat.map!.needsUpdate = true;
  addRoadDirt(roadMat, theme);
  // a textura do piso cobre 2W x 2W metros, como na faixa contínua
  roadMat.map!.repeat.set(1, L / (W * 2));
  if (rm.emissive) {
    roadMat.emissiveMap = rm.emissive;
    roadMat.emissive = new THREE.Color(0xffffff);
    roadMat.emissiveIntensity = theme.roadGlow;
  }
  // passagem "de baixo" de um cruzamento no mesmo nível: piso mais escuro, para a de cima (com as
  // faixas de borda contínuas) se destacar como a que atravessa (item 5 da rodada 10, Nho)
  const lowMat = roadMat.clone();
  lowMat.color = new THREE.Color(0.62, 0.62, 0.66);
  if (rm.emissive) lowMat.emissiveIntensity = theme.roadGlow * 0.5;
  const edgeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.roadEdge), emissive: new THREE.Color(theme.roadEdge), emissiveIntensity: 0.25, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const wm = wallMaps(theme);
  const wallMat = new THREE.MeshStandardMaterial({ map: wm.map, normalMap: wm.normal, roughness: wm.roughness, metalness: wm.metalness });
  const railMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.curb), roughness: 0.78, metalness: 0 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.rail[1]), emissive: new THREE.Color(theme.rail[1]), emissiveIntensity: 0.4 });
  const rail = (q: Piece, s: number, side: number, len: number, y = 0): void => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(WALL, 0.45, len), railMat);
    place(r, q, s, side * (W + WALL / 2), y + 0.2);
    r.castShadow = shadows;
    group.add(r);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL + 0.02, 0.08, len), accentMat);
    place(cap, q, s, side * (W + WALL / 2), y + 0.46);
    group.add(cap);
  };
  for (const p of xs) {
    const other = track.pieces[track.crossPartner[p.index]];
    if (other && other.index < p.index) continue; // o par já foi feito
    const role = track.crossRole[p.index];
    if (other && role !== 'flat' && role !== 'none') {
      addBridge(group, track, theme, role === 'over' ? p : other, roadMat, wallMat, shadows, rail);
      continue;
    }
    const pair = other ? [p, other] : [p];
    for (const q of pair) {
      const top = q === pair[pair.length - 1];
      // piso da faixa desta passagem
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + 0.1, L).rotateX(-Math.PI / 2), top ? roadMat : lowMat);
      place(floor, q, L / 2, 0, top ? 0.004 : 0.002);
      floor.receiveShadow = shadows;
      group.add(floor);
      // bloco por baixo (continua o paredão da pista)
      const depth = q.h0 - theme.groundLevel + 0.5;
      const block = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + WALL * 2, depth, L), wallMat);
      place(block, q, L / 2, 0, -depth / 2 - 0.05);
      block.receiveShadow = shadows;
      group.add(block);
      if (top && pair.length > 1) {
        // faixas de borda contínuas atravessando a outra passagem
        for (const side of [1, -1]) {
          const e = new THREE.Mesh(new THREE.PlaneGeometry(0.35, L).rotateX(-Math.PI / 2), edgeMat);
          place(e, q, L / 2, side * (W - 0.35), 0.012);
          group.add(e);
        }
      }
    }
    // muretas nas 4 quinas da cruz (entre a borda de uma faixa e a da outra)
    const seg = (L - W * 2) / 2;
    if (seg > 0.2) {
      for (const q of pair) {
        for (const side of [1, -1]) {
          for (const end of [0, 1]) rail(q, end === 0 ? seg / 2 : L - seg / 2, side, seg);
        }
      }
    }
  }
}

/**
 * Viaduto: a passagem de baixo é pista comum (malha contínua, ver Track.isBreak); a de cima é
 * uma ponte — laje com muretas contínuas, cabeceiras até o chão e pilares nas quinas da casa,
 * fora da faixa de baixo.
 */
function addBridge(
  group: THREE.Group,
  track: Track,
  theme: Theme,
  up: Piece,
  roadMat: THREE.Material,
  wallMat: THREE.Material,
  shadows: boolean,
  rail: (q: Piece, s: number, side: number, len: number, y?: number) => void,
): void {
  const W = track.halfWidth;
  const L = up.length;
  const WALL = WALL_OFFSET;
  const n = track.pieces.length;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + 0.1, L).rotateX(-Math.PI / 2), roadMat);
  place(floor, up, L / 2, 0, 0.004);
  floor.receiveShadow = shadows;
  group.add(floor);
  // laje (0,6 m) com a textura do paredão por baixo e nas laterais
  const T = 0.6;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + WALL * 2, T, L), wallMat);
  place(slab, up, L / 2, 0, -T / 2 - 0.02);
  slab.castShadow = shadows;
  slab.receiveShadow = shadows;
  group.add(slab);
  for (const side of [1, -1]) rail(up, L / 2, side, L);
  // cabeceiras: a pista de cima chega em paredão; a face que dá para o vão sob a ponte fecha o bloco
  const prev = track.pieces[(up.index - 1 + n) % n];
  const next = track.pieces[(up.index + 1) % n];
  for (const [s, face, h] of [[0, 1, track.heightOn(prev, prev.length)], [L, -1, track.heightOn(next, 0)]] as const) {
    const depth = h - theme.groundLevel + 0.5;
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + WALL * 2, depth), wallMat);
    place(cap, up, s, 0, 0);
    cap.position.y = h - depth / 2 - T;
    if (face < 0) cap.rotation.y += Math.PI;
    cap.receiveShadow = shadows;
    group.add(cap);
  }
  // pilares nas quinas da casa (fora das duas faixas)
  const off = W + WALL + (L / 2 - W - WALL) / 2;
  const hTop = up.h0 - T;
  const hBot = theme.groundLevel - 0.5;
  const pillarGeo = new THREE.BoxGeometry(1.4, hTop - hBot, 1.4);
  for (const a of [1, -1]) {
    for (const b of [1, -1]) {
      const pil = new THREE.Mesh(pillarGeo, wallMat);
      place(pil, up, L / 2 + a * off, b * off, 0);
      pil.position.y = (hTop + hBot) / 2;
      pil.castShadow = shadows;
      group.add(pil);
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
  const WALL = WALL_OFFSET;
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
        ctx.shadowBlur = 5;
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
        // vermelhas como no original (o aviso de salto é amarelo e preto: não se confundem)
        map: arrowsTexture('#ff2a1a', '#ffb0a0'),
        emissive: 0xff2a10,
        emissiveIntensity: 1.2,
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
        emissiveIntensity: 1.3,
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
