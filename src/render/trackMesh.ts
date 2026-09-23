import * as THREE from 'three';
import { createRng, forwardX, forwardZ, leftX, leftZ } from '../sim/math';
import { JUMP_HEIGHT, type CenterPoint, type Track } from '../sim/track';
import { asphaltNormal, asphaltRoughness, concreteNormal } from './textures';
import type { Theme } from './themes';

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, seed: number): void {
  const rng = createRng(seed);
  for (let i = 0; i < count; i++) {
    const v = rng();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * alpha})` : `rgba(0,0,0,${(0.5 - v) * alpha})`;
    const s = 1 + rng() * 2.5;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
}

/** Asfalto escuro com bordas coloridas (Chem VI: preto e vermelho, como no original). */
function roadTextures(theme: Theme): { map: THREE.Texture } {
  const S = 512;
  const map = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = theme.road;
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, 9000, 0.35, 1);
    // manchas de pneu e óleo
    const rng = createRng(2);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.08 + rng() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(S * (0.25 + rng() * 0.5), rng() * S, 10 + rng() * 30, 30 + rng() * 80, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // sulcos transversais do piso (textura "ranhurada" das pistas do original)
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < S; y += 16) ctx.fillRect(0, y, S, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 4; y < S; y += 16) ctx.fillRect(0, y, S, 2);
    // juntas das placas
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, S / 2);
    ctx.lineTo(S, S / 2);
    ctx.stroke();
    // faixas das bordas
    const band = S * 0.09;
    ctx.fillStyle = theme.roadEdge;
    ctx.fillRect(0, 0, band, S);
    ctx.fillRect(S - band, 0, band, S);
    for (let y = 0; y < S; y += 64) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, y, band, 32);
      ctx.fillRect(S - band, y, band, 32);
    }
    ctx.fillStyle = theme.roadLine;
    ctx.fillRect(band + 6, 0, 5, S);
    ctx.fillRect(S - band - 11, 0, 5, S);
    // tracejado central
    ctx.globalAlpha = 0.8;
    ctx.fillRect(S / 2 - 5, 40, 10, 170);
    ctx.fillRect(S / 2 - 5, 296, 10, 170);
    ctx.globalAlpha = 1;
    speckle(ctx, S, S, 3000, 0.25, 3);
  });
  return { map };
}

function railTexture(theme: Theme): THREE.CanvasTexture {
  return canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = theme.rail[1];
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = theme.rail[0];
    ctx.fillRect(0, 0, 128, 64);
    speckle(ctx, 256, 64, 1500, 0.3, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(126, 0, 4, 64);
    ctx.fillRect(0, 0, 256, 4);
    ctx.fillRect(0, 60, 256, 4);
    // parafusos
    ctx.fillStyle = 'rgba(220,220,220,0.7)';
    for (const x of [16, 112, 144, 240]) {
      ctx.beginPath();
      ctx.arc(x, 32, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function concreteTexture(color: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, 256, 256, 6000, 0.4, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    for (let y = 0; y < 256; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }
    // escorridos de sujeira
    const rng = createRng(7);
    for (let i = 0; i < 40; i++) {
      const x = rng() * 256;
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 2 + rng() * 5, 60 + rng() * 190);
    }
  });
}

function checkerTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 32, (ctx) => {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#cfcfcf';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function chevronTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 64, (ctx) => {
    ctx.fillStyle = '#101010';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#ffd21a';
    for (let i = 0; i < 3; i++) {
      const x = 14 + i * 36;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x + 18, 8);
      ctx.lineTo(x + 34, 32);
      ctx.lineTo(x + 18, 56);
      ctx.lineTo(x, 56);
      ctx.lineTo(x + 16, 32);
      ctx.fill();
    }
  });
}

function warningTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(128, 64, (ctx) => {
    ctx.fillStyle = '#ffd21a';
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 58);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 34);
  });
}

// borda da plataforma: friso baixo e claro, como no original (a colisão continua na simulação)
const RAIL_HEIGHT = 0.32;
const RAIL_THICK = 0.55;

/** Ponto de um perfil transversal: deslocamento lateral e altura (relativa à pista ou absoluta). */
interface ProfilePoint {
  l: number;
  y: number;
  abs?: boolean;
}

/**
 * "Varre" um perfil transversal ao longo da linha central. Cada segmento do perfil vira uma faixa
 * de triângulos própria (quinas ficam vivas, sem normais suavizadas).
 */
function sweep(pts: CenterPoint[], profile: ProfilePoint[], uScale: number, vScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let uAcc = 0;
  for (let k = 0; k < profile.length - 1; k++) {
    const a = profile[k];
    const b = profile[k + 1];
    const segLen = Math.hypot(b.l - a.l, (b.abs ? 0 : b.y) - (a.abs ? 0 : a.y)) || 1;
    const base = pos.length / 3;
    for (const p of pts) {
      const lx = leftX(p.heading);
      const lz = leftZ(p.heading);
      for (const q of [a, b]) {
        pos.push(p.x + lx * q.l, q.abs ? q.y : p.h + q.y, p.z + lz * q.l);
      }
      uv.push(uAcc / uScale, p.dist / vScale, (uAcc + segLen) / uScale, p.dist / vScale);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const i0 = base + i * 2;
      const i1 = i0 + 1;
      const j0 = i0 + 2;
      const j1 = i0 + 3;
      idx.push(i0, i1, j0, i1, j1, j0);
    }
    uAcc += segLen;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Gera a malha 3D da pista (asfalto, muretas, pilares, sinalização) a partir da simulação. */
export function buildTrackMesh(track: Track, theme: Theme, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  const pts = track.sampleCenterline(0.5);
  pts.push({ ...pts[0], dist: track.totalLength });
  const W = track.halfWidth;
  const G = theme.groundLevel;

  // Asfalto
  const { map } = roadTextures(theme);
  const road = new THREE.Mesh(
    sweep(pts, [{ l: W, y: 0 }, { l: -W, y: 0 }], W * 2, W * 2),
    new THREE.MeshStandardMaterial({
      map,
      normalMap: asphaltNormal(),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: asphaltRoughness(),
      roughness: 1,
      metalness: 0,
    }),
  );
  road.receiveShadow = shadows;
  group.add(road);

  // Muretas com espessura (face interna, topo, face externa)
  const railMat = new THREE.MeshStandardMaterial({ map: railTexture(theme), normalMap: concreteNormal(), normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.5, metalness: 0.45 });
  for (const side of [1, -1]) {
    const i = side * W;
    const o = side * (W + RAIL_THICK);
    const profile: ProfilePoint[] = [
      { l: i, y: 0 },
      { l: i, y: RAIL_HEIGHT },
      { l: o, y: RAIL_HEIGHT },
      { l: o, y: 0 },
    ];
    if (side > 0) profile.reverse(); // mantém as faces viradas para fora
    const rail = new THREE.Mesh(sweep(pts, profile, RAIL_HEIGHT * 2 + RAIL_THICK, 4), railMat);
    rail.castShadow = shadows;
    rail.receiveShadow = shadows;
    group.add(rail);
  }

  // Laterais do bloco da pista descendo até o terreno
  const concrete = concreteTexture(theme.skirt);
  const skirtMat = new THREE.MeshStandardMaterial({ map: concrete, normalMap: concreteNormal(), normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 });
  for (const side of [1, -1]) {
    const o = side * (W + RAIL_THICK);
    const profile: ProfilePoint[] = [
      { l: o, y: 0 },
      { l: o, y: G - 1, abs: true },
    ];
    if (side > 0) profile.reverse(); // mantém as faces viradas para fora
    const skirt = new THREE.Mesh(sweep(pts, profile, 8, 8), skirtMat);
    skirt.receiveShadow = shadows;
    group.add(skirt);
  }
  // fundo do bloco (visível na câmera de perseguição durante saltos)
  group.add(new THREE.Mesh(sweep(pts, [{ l: -W - RAIL_THICK, y: -0.6 }, { l: W + RAIL_THICK, y: -0.6 }], 8, 8), skirtMat));

  // faixa clara logo abaixo da borda: marca bem o contorno da plataforma contra o fundo escuro
  const lipMat = new THREE.MeshStandardMaterial({ map: railTexture(theme), roughness: 0.55, metalness: 0.3 });
  for (const side of [1, -1]) {
    const o = side * (W + RAIL_THICK) + side * 0.01;
    const profile: ProfilePoint[] = [
      { l: o, y: 0 },
      { l: o, y: -0.35 },
    ];
    if (side > 0) profile.reverse();
    group.add(new THREE.Mesh(sweep(pts, profile, 8, 4), lipMat));
  }
  addStartLine(group, track);
  addSigns(group, track);
  return group;
}

function addStartLine(group: THREE.Group, track: Track): void {
  const p = track.pieces[0];
  const W = track.halfWidth;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 2), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 }));
  line.rotation.set(-Math.PI / 2, 0, 0);
  line.rotateZ(p.heading0);
  line.position.set(p.x0, p.h0 + 0.02, p.z0);
  line.receiveShadow = true;
  group.add(line);

  // Pórtico de largada com semáforo
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.8, roughness: 0.35 });
  const gantry = new THREE.Group();
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.5, 0.5), mat);
    post.position.set(side * (W + 0.9), 3.25, 0);
    post.castShadow = true;
    gantry.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 2.3, 1.2, 0.3), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 }));
  banner.position.set(0, 6.3, 0);
  banner.castShadow = true;
  gantry.add(banner);
  gantry.position.set(p.x0, p.h0, p.z0);
  gantry.rotation.y = p.heading0;
  group.add(gantry);
}

/** Placas de curva e de salto — indispensáveis na câmera de cockpit. */
function addSigns(group: THREE.Group, track: Track): void {
  const chevron = new THREE.MeshStandardMaterial({ map: chevronTexture(), side: THREE.DoubleSide, emissive: 0x333322, emissiveMap: chevronTexture() });
  const jump = new THREE.MeshStandardMaterial({ map: warningTexture('SALTO'), side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.4 });
  const W = track.halfWidth;
  const board = new THREE.PlaneGeometry(2.4, 1.2);
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6);
  const addBoard = (mat: THREE.Material, x: number, y: number, z: number, rotY: number, flip: boolean) => {
    const m = new THREE.Mesh(board, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    if (flip) m.scale.x = -1;
    group.add(m);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, y - 1.1, z);
    group.add(post);
  };
  for (const p of track.pieces) {
    if (p.turn !== 0) {
      for (const t of [0.3, 0.7]) {
        const s = p.length * t;
        const pt = track.pointOn(p, s);
        const out = -p.turn;
        const d = W + RAIL_THICK / 2;
        addBoard(chevron, pt.x + leftX(pt.heading) * out * d, p.h0 + RAIL_HEIGHT + 1.2, pt.z + leftZ(pt.heading) * out * d, pt.heading + Math.PI, p.turn === 1);
      }
    } else if (p.code === 'J') {
      for (const side of [1, -1]) {
        const d = side * (W + RAIL_THICK / 2);
        addBoard(jump, p.x0 + leftX(p.heading0) * d, p.h0 + RAIL_HEIGHT + 1.2, p.z0 + leftZ(p.heading0) * d, p.heading0 + Math.PI, false);
      }
      const s = p.length * 0.74;
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 0.5), new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.6 }));
      edge.rotation.set(-Math.PI / 2, 0, 0);
      edge.rotateZ(p.heading0);
      edge.position.set(p.x0 + forwardX(p.heading0) * s, p.h0 + JUMP_HEIGHT * (0.44 / 0.45) + 0.03, p.z0 + forwardZ(p.heading0) * s);
      group.add(edge);
    }
  }
}
