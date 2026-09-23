import * as THREE from 'three';
import { createRng, forwardX, forwardZ, leftX, leftZ } from '../sim/math';
import { JUMP_HEIGHT, type CenterPoint, type Track } from '../sim/track';
import type { Theme } from './themes';
import { addTrackFeatures, roadMaps, wallMaps } from './trackFeatures';
import { edgeCurve, pipeTexture, spikeStarGeometry, wallGeometry } from './trackStyle';

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

function checkerTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 32, (ctx) => {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#e8e8e8';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Setas vermelhas pintadas no piso antes dos saltos (como no original). */
function arrowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#e8201a';
    for (const y of [10, 52]) {
      ctx.beginPath();
      ctx.moveTo(14, y + 40);
      ctx.lineTo(64, y);
      ctx.lineTo(114, y + 40);
      ctx.lineTo(96, y + 40);
      ctx.lineTo(64, y + 16);
      ctx.lineTo(32, y + 40);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Ponto de um perfil transversal: deslocamento lateral e altura (relativa à pista). */
interface ProfilePoint {
  l: number;
  y: number;
}

/**
 * "Varre" um perfil transversal ao longo da linha central. Cada segmento do perfil vira uma faixa
 * de triângulos própria (quinas vivas).
 */
function sweep(pts: CenterPoint[], profile: ProfilePoint[], uScale: number, vScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let uAcc = 0;
  for (let k = 0; k < profile.length - 1; k++) {
    const a = profile[k];
    const b = profile[k + 1];
    const segLen = Math.hypot(b.l - a.l, b.y - a.y) || 1;
    const base = pos.length / 3;
    for (const p of pts) {
      const lx = leftX(p.heading);
      const lz = leftZ(p.heading);
      for (const q of [a, b]) pos.push(p.x + lx * q.l, p.h + q.y, p.z + lz * q.l);
      uv.push(uAcc / uScale, p.dist / vScale, (uAcc + segLen) / uScale, p.dist / vScale);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const i0 = base + i * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
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

/** Distância lateral da face externa da mureta (onde começa o paredão). */
export const WALL_OFFSET = 0.45;

/** Gera a malha 3D da pista (piso, muretas, paredões, largada) com a cara do planeta. */
export function buildTrackMesh(track: Track, theme: Theme, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  const W = track.halfWidth;
  const G = theme.groundLevel;
  // trechos contínuos (vãos G e cruzamentos X interrompem; ver Track.meshRuns)
  for (const pts of track.meshRuns(0.5)) buildRun(group, pts, theme, W, G, shadows);
  addStartLine(group, track);
  addJumpMarks(group, track);
  addTrackFeatures(group, track, theme, shadows);
  return group;
}

function buildRun(group: THREE.Group, pts: CenterPoint[], theme: Theme, W: number, G: number, shadows: boolean): void {

  // Piso
  const rm = roadMaps(theme);
  const roadMat = new THREE.MeshStandardMaterial({
    map: rm.map,
    normalMap: rm.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: rm.roughness,
    metalness: rm.metalness,
  });
  if (rm.emissive) {
    roadMat.emissiveMap = rm.emissive;
    roadMat.emissive = new THREE.Color(0xffffff);
    roadMat.emissiveIntensity = theme.roadGlow;
  }
  // a mesma textura cobre (2W x 2W) metros; o piso vai um pouco além para encostar na mureta
  const road = new THREE.Mesh(sweep(pts, [{ l: W + 0.05, y: 0 }, { l: -W - 0.05, y: 0 }], W * 2, W * 2), roadMat);
  road.receiveShadow = shadows;
  group.add(road);

  addWalls(group, pts, theme, W, G, shadows);
  addRails(group, pts, theme, W, shadows);

  // fundo do bloco (aparece na câmera de perseguição durante saltos)
  const under = new THREE.Mesh(
    sweep(pts, [{ l: -W - WALL_OFFSET, y: -0.7 }, { l: W + WALL_OFFSET, y: -0.7 }], 8, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.skirt).multiplyScalar(0.4), roughness: 0.9 }),
  );
  group.add(under);
}

/* ------------------------------------------------------------------ */

function addWalls(group: THREE.Group, pts: CenterPoint[], theme: Theme, W: number, G: number, shadows: boolean): void {
  const wm = wallMaps(theme);
  const mat = new THREE.MeshStandardMaterial({
    map: wm.map,
    normalMap: wm.normal,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughness: wm.roughness,
    metalness: wm.metalness,
  });
  if (wm.emissive) {
    mat.emissiveMap = wm.emissive;
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveIntensity = theme.walls === 'demonic' ? 1.6 : 1.2;
  }
  for (const side of [1, -1] as const) {
    const wall = new THREE.Mesh(wallGeometry(pts, side * (W + WALL_OFFSET), G - 0.5, side), mat);
    wall.receiveShadow = shadows;
    group.add(wall);
  }

  const rng = createRng(31);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const list: THREE.Matrix4[] = [];
  if (theme.walls === 'pipes') {
    // Chem VI: fileira de cilindros prateados de pé, encostados no paredão
    const r = 0.46;
    for (const side of [1, -1]) {
      for (let i = 0; i < pts.length - 1; i += 2) {
        const p = pts[i];
        const d = side * (W + WALL_OFFSET + r * 0.75);
        const top = p.h - 0.12;
        const hgt = top - G;
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        list.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + leftX(p.heading) * d, G + hgt / 2, p.z + leftZ(p.heading) * d), q, new THREE.Vector3(1, hgt, 1)));
      }
    }
    const geo = new THREE.CylinderGeometry(r, r, 1, 14, 1, true);
    const pm = pipeTexture(theme.wallAccent);
    pm.repeat.set(1, 2.5);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: pm, metalness: 0.85, roughness: 0.3 }), list.length);
    list.forEach((m, k) => inst.setMatrixAt(k, m));
    inst.receiveShadow = shadows;
    group.add(inst);
    // tampas vermelhas no topo dos cilindros
    const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.14, 14), new THREE.MeshStandardMaterial({ color: 0x8a8e96, metalness: 0.8, roughness: 0.35 }), list.length);
    list.forEach((m, k) => {
      const pos = new THREE.Vector3();
      const sc = new THREE.Vector3();
      m.decompose(pos, q, sc);
      caps.setMatrixAt(k, new THREE.Matrix4().compose(pos.setY(pos.y + sc.y / 2), q, new THREE.Vector3(1, 1, 1)));
    });
    group.add(caps);
  } else if (theme.walls === 'icerock') {
    // Nho: pilares azuis de gelo a cada poucos metros
    for (const side of [1, -1]) {
      for (let i = 0; i < pts.length - 1; i += 7) {
        const p = pts[i];
        const d = side * (W + WALL_OFFSET + 0.25);
        const hgt = p.h - G;
        q.setFromAxisAngle(up, p.heading);
        list.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + leftX(p.heading) * d, G + hgt / 2, p.z + leftZ(p.heading) * d), q, new THREE.Vector3(1, hgt, 1)));
      }
    }
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.55, 1, 0.8),
      new THREE.MeshStandardMaterial({ color: theme.wallAccent, emissive: 0x0a1a60, roughness: 0.2, metalness: 0.3 }),
      list.length,
    );
    list.forEach((m, k) => inst.setMatrixAt(k, m));
    inst.castShadow = shadows;
    group.add(inst);
  }
}

/** Mureta: um estilo por planeta, tudo instanciado (poucas chamadas de desenho). */
function addRails(group: THREE.Group, pts: CenterPoint[], theme: Theme, W: number, shadows: boolean): void {
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const segs = Math.floor(pts.length / 1.5);
  const main = new THREE.Color(theme.rail[0]);
  const second = new THREE.Color(theme.rail[1]);
  const along = (spacing: number, fn: (p: CenterPoint, side: 1 | -1, k: number) => void) => {
    const step = Math.max(1, Math.round(spacing / 0.5));
    for (const side of [1, -1] as const) for (let i = 0; i < pts.length - 1; i += step) fn(pts[i], side, i / step);
  };
  const at = (p: CenterPoint, off: number, y: number) => new THREE.Vector3(p.x + leftX(p.heading) * off, p.h + y, p.z + leftZ(p.heading) * off);
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cast = true) => {
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, k) => inst.setMatrixAt(k, m));
    inst.castShadow = shadows && cast;
    inst.receiveShadow = shadows;
    group.add(inst);
    return inst;
  };
  const tube = (off: number, lift: number, r: number, mat: THREE.Material) => {
    for (const side of [1, -1]) {
      const curve = edgeCurve(pts, side * off, lift);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, 10, curve.closed), mat);
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      group.add(m);
    }
  };
  const box = (inner: number, outer: number, hgt: number, mat: THREE.Material) => {
    for (const side of [1, -1]) {
      const i = side * inner;
      const o = side * outer;
      let prof: ProfilePoint[] = [{ l: i, y: -0.05 }, { l: i, y: hgt }, { l: o, y: hgt }, { l: o, y: -0.4 }];
      if (side > 0) prof = prof.reverse();
      const m = new THREE.Mesh(sweep(pts, prof, 1, 4), mat);
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      group.add(m);
    }
  };

  switch (theme.railStyle) {
    case 'lip': {
      // Chem VI: friso metálico baixo com faixa vermelha no topo
      const t = canvasTexture(64, 64, (ctx) => {
        ctx.fillStyle = theme.rail[0];
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = theme.rail[1];
        ctx.fillRect(0, 20, 64, 22);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        for (let x = 0; x < 64; x += 16) ctx.fillRect(x, 0, 2, 64);
      });
      box(W, W + WALL_OFFSET, 0.42, new THREE.MeshStandardMaterial({ map: t, metalness: 0.7, roughness: 0.35 }));
      break;
    }
    case 'tube': {
      // Drakonis: tubo roxo com bulbos (a mureta orgânica do original)
      const mat = new THREE.MeshStandardMaterial({ color: main, emissive: second, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.15 });
      tube(W + 0.2, 0.3, 0.3, mat);
      const bulbs: THREE.Matrix4[] = [];
      along(1.3, (p, side) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        bulbs.push(new THREE.Matrix4().compose(at(p, side * (W + 0.2), 0.32), q, new THREE.Vector3(1, 0.85, 1.35)));
      });
      instanced(new THREE.SphereGeometry(0.38, 12, 8), new THREE.MeshStandardMaterial({ color: main.clone().multiplyScalar(1.2), emissive: main, emissiveIntensity: 0.35, roughness: 0.25 }), bulbs);
      break;
    }
    case 'cable': {
      // Bogmire: cabo preto baixo com estrelas de espinhos prateadas
      tube(W + 0.2, 0.42, 0.13, new THREE.MeshStandardMaterial({ color: main, roughness: 0.5, metalness: 0.4 }));
      const stars: THREE.Matrix4[] = [];
      along(2.4, (p, side, k) => {
        q.setFromEuler(new THREE.Euler(k * 0.7, p.heading + k, 0));
        stars.push(new THREE.Matrix4().compose(at(p, side * (W + 0.2), 0.45), q, one));
      });
      instanced(spikeStarGeometry(0.55), new THREE.MeshStandardMaterial({ color: second, metalness: 0.85, roughness: 0.5, envMapIntensity: 0.5 }), stars);
      break;
    }
    case 'bumper': {
      // New Mojave: tubo verde com luzes amarelas
      tube(W + 0.2, 0.3, 0.3, new THREE.MeshStandardMaterial({ color: main, roughness: 0.45, metalness: 0.3 }));
      const lamps: THREE.Matrix4[] = [];
      along(1.6, (p, side) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        lamps.push(new THREE.Matrix4().compose(at(p, side * (W + 0.2), 0.52), q, one));
      });
      instanced(new THREE.BoxGeometry(0.62, 0.28, 0.5), new THREE.MeshStandardMaterial({ color: second, emissive: second, emissiveIntensity: 1.3, roughness: 0.3 }), lamps);
      break;
    }
    case 'ice': {
      // Nho: tubo de gelo translúcido com pingentes para fora
      tube(W + 0.2, 0.28, 0.3, new THREE.MeshStandardMaterial({ color: main, emissive: 0x0a2a80, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.9 }));
      const icicles: THREE.Matrix4[] = [];
      const rng = createRng(12);
      along(0.5, (p, side) => {
        if (rng() < 0.35) return;
        const len = 0.4 + rng() * 1.1;
        q.identity();
        icicles.push(new THREE.Matrix4().compose(at(p, side * (W + WALL_OFFSET + 0.08), -len / 2), q, new THREE.Vector3(1, len, 1)));
      });
      const icicle = new THREE.ConeGeometry(0.1, 1, 6).rotateX(Math.PI);
      instanced(icicle, new THREE.MeshStandardMaterial({ color: second, emissive: 0x204a90, roughness: 0.1, metalness: 0.1 }), icicles, false);
      break;
    }
    case 'spiked': {
      // Inferno: mureta preta com friso vermelho e chifres curvos
      box(W, W + WALL_OFFSET, 0.45, new THREE.MeshStandardMaterial({ color: main, roughness: 0.35, metalness: 0.6 }));
      for (const side of [1, -1]) {
        const m = new THREE.Mesh(
          sweep(pts, side > 0 ? [{ l: W + WALL_OFFSET, y: 0.46 }, { l: W, y: 0.46 }] : [{ l: -W, y: 0.46 }, { l: -W - WALL_OFFSET, y: 0.46 }], 1, 4),
          new THREE.MeshStandardMaterial({ color: second, emissive: second, emissiveIntensity: 0.9 }),
        );
        m.scale.set(1, 1, 1);
        group.add(m);
      }
      const horns: THREE.Matrix4[] = [];
      along(1.8, (p, side) => {
        const out = new THREE.Vector3(leftX(p.heading) * side, 1.4, leftZ(p.heading) * side).normalize();
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
        horns.push(new THREE.Matrix4().compose(at(p, side * (W + WALL_OFFSET * 0.6), 0.45), q, one));
      });
      const horn = new THREE.ConeGeometry(0.16, 0.85, 7).translate(0, 0.42, 0);
      instanced(horn, new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.3, metalness: 0.7, emissive: 0x300400 }), horns);
      break;
    }
  }
}

function addStartLine(group: THREE.Group, track: Track): void {
  const p = track.pieces[0];
  const W = track.halfWidth;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 2.2), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 }));
  line.rotation.set(-Math.PI / 2, 0, 0);
  line.rotateZ(p.heading0);
  line.position.set(p.x0, p.h0 + 0.02, p.z0);
  line.receiveShadow = true;
  group.add(line);
}

/** Setas vermelhas antes dos saltos e faixa amarela na borda da rampa. */
function addJumpMarks(group: THREE.Group, track: Track): void {
  const W = track.halfWidth;
  const arrowMat = new THREE.MeshStandardMaterial({ map: arrowTexture(), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const arrowGeo = new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2);
  for (const p of track.pieces) {
    if (p.code !== 'J') continue;
    for (const lat of [-W * 0.45, W * 0.45]) {
      const m = new THREE.Mesh(arrowGeo, arrowMat);
      const s = p.length * 0.25;
      m.position.set(p.x0 + forwardX(p.heading0) * s + leftX(p.heading0) * lat, p.h0 + 0.03, p.z0 + forwardZ(p.heading0) * s + leftZ(p.heading0) * lat);
      m.rotation.y = p.heading0 + Math.PI;
      group.add(m);
    }
    const s = p.length * 0.74;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 0.45), new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.6 }));
    edge.rotation.set(-Math.PI / 2, 0, 0);
    edge.rotateZ(p.heading0);
    edge.position.set(p.x0 + forwardX(p.heading0) * s, p.h0 + JUMP_HEIGHT * (0.44 / 0.45) + 0.03, p.z0 + forwardZ(p.heading0) * s);
    group.add(edge);
  }
}
