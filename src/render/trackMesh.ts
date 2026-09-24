import * as THREE from 'three';
import { createRng, forwardX, forwardZ, leftX, leftZ, wrapAngle } from '../sim/math';
import { JUMP_HEIGHT, type CenterPoint, type Track } from '../sim/track';
import type { Theme } from './themes';
import { addTrackFeatures, roadMaps, wallMaps } from './trackFeatures';
import { concreteNormal, fbm } from './textures';
import { addRoadDirt, edgeCurve, pipeTexture, roadDetailHigh, spikeStarGeometry, wallGeometry } from './trackStyle';

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

/**
 * Pontos da linha central que a malha precisa: nas retas planas, um a cada 4 m (a textura segue a
 * distância, então nada muda); nas curvas, um a cada `bendStep` pontos; em rampas, saltos e
 * lombadas (altura não linear), todos. Troca de peça sempre fica. Corta ~70% dos triângulos.
 */
function simplifyRun(pts: CenterPoint[], bendStep: number): CenterPoint[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let since = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    since++;
    const a = pts[i - 1];
    const c = pts[i];
    const b = pts[i + 1];
    const bend = Math.abs(wrapAngle(b.heading - c.heading)) > 1e-5 || Math.abs(wrapAngle(c.heading - a.heading)) > 1e-5;
    const kink = Math.abs(b.h - c.h - (c.h - a.h)) > 1e-4;
    const limit = kink ? 1 : bend ? bendStep : 8;
    if (since >= limit || c.pieceIndex !== b.pieceIndex || c.pieceIndex !== a.pieceIndex) {
      out.push(c);
      since = 0;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
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

/**
 * Como `sweep`, mas com vértices compartilhados entre os pontos do perfil (normais suaves: peças
 * arredondadas como o meio-fio). u vai de 0 a 1 ao longo do perfil; v em metros / vScale.
 */
function sweepSmooth(pts: CenterPoint[], profile: ProfilePoint[], vScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const acc = [0];
  for (let k = 1; k < profile.length; k++) acc.push(acc[k - 1] + Math.hypot(profile[k].l - profile[k - 1].l, profile[k].y - profile[k - 1].y));
  const total = acc[acc.length - 1] || 1;
  const P = profile.length;
  for (const p of pts) {
    const lx = leftX(p.heading);
    const lz = leftZ(p.heading);
    profile.forEach((q, k) => {
      pos.push(p.x + lx * q.l, p.h + q.y, p.z + lz * q.l);
      uv.push(acc[k] / total, p.dist / vScale);
    });
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < P - 1; k++) {
      const a = i * P + k;
      idx.push(a, a + 1, a + P, a + 1, a + P + 1, a + P);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Meio-fio: altura e perfil arredondado (largura = WALL_OFFSET). */
export const CURB_HEIGHT = 0.42;

/** Perfil do meio-fio de um lado, da borda interna para fora (e = distância a partir da borda do piso). */
function curbProfile(W: number, side: 1 | -1, C: number): ProfilePoint[] {
  const out: { e: number; y: number }[] = [{ e: -0.03, y: -0.02 }];
  const N = 10;
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * Math.PI;
    // meia-lua achatada: sobe rápido por dentro, topo largo e cai em curva por fora
    out.push({ e: (C / 2) * (1 - Math.cos(t)), y: CURB_HEIGHT * Math.pow(Math.sin(t), 0.7) });
  }
  out.push({ e: C, y: -0.4 });
  const prof = out.map((q) => ({ l: side * (W + q.e), y: q.y }));
  // face para cima/fora: o perfil vai da esquerda (l maior) para a direita
  return side > 0 ? prof.reverse() : prof;
}

const curbCache = new WeakMap<Theme, { map: THREE.Texture; emissive: THREE.Texture | null }>();
/**
 * Textura do meio-fio: concreto cor de osso/areia, gasto, com areia acumulada no pé interno
 * (junto ao piso) e uma faixa de destaque do planeta na face externa (u: 0 = fora, 1 = dentro,
 * trocado no lado direito — a faixa é simétrica em torno do topo).
 */
function curbMaps(theme: Theme): { map: THREE.Texture; emissive: THREE.Texture | null } {
  const hit = curbCache.get(theme);
  if (hit) return hit;
  const S = 128;
  const n = fbm(S, 4, 4, 83, 0.55);
  const stripe = theme.railStyle === 'lip' || theme.railStyle === 'spiked' ? theme.rail[1] : theme.railStyle === 'bumper' || theme.railStyle === 'ice' ? theme.rail[0] : null;
  const rng = createRng(5);
  const map = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = theme.curb;
    ctx.fillRect(0, 0, S, S);
    const img = ctx.getImageData(0, 0, S, S);
    const dust = new THREE.Color(theme.dust);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const u = x / (S - 1);
        // simétrico: 0 nas duas bases, 1 no topo
        const top = Math.sin(u * Math.PI);
        const v = n[y * S + x];
        const k = 0.78 + v * 0.3 + (rng() - 0.5) * 0.08;
        // areia/sujeira acumulada nas bases e manchas escuras de uso
        const sand = Math.max(0, 1 - top * 2.2) * (0.6 + v * 0.6);
        for (let c = 0; c < 3; c++) {
          const base = img.data[i + c] * k;
          const dc = (c === 0 ? dust.r : c === 1 ? dust.g : dust.b) * 255 * (0.7 + v * 0.4);
          img.data[i + c] = Math.min(255, base + (dc - base) * Math.min(1, sand));
        }
      }
    ctx.putImageData(img, 0, 0);
    // lascas e riscos
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(40,30,20,${0.08 + rng() * 0.18})`;
      ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 1 + rng() * 2);
    }
    if (stripe) {
      ctx.fillStyle = stripe;
      for (const x0 of [0.14, 0.86 - 0.08]) ctx.fillRect(S * x0, 0, S * 0.08, S);
    }
  });
  let emissive: THREE.Texture | null = null;
  if (stripe && theme.railStyle === 'spiked')
    emissive = canvasTexture(S, S, (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = stripe;
      for (const x0 of [0.14, 0.86 - 0.08]) ctx.fillRect(S * x0, 0, S * 0.08, S);
    });
  const out = { map, emissive };
  curbCache.set(theme, out);
  return out;
}

/** Distância lateral da face externa da mureta (onde começa o paredão). */
export const WALL_OFFSET = 0.8;

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
    roughnessMap: rm.roughnessMap,
    roughness: 1,
    metalness: rm.metalness,
    // reflexo contido: o piso não "lava" com o céu; o brilho vem do sol rasante nas placas limpas
    envMapIntensity: 0.55,
  });
  addRoadDirt(roadMat, theme);
  if (rm.emissive) {
    roadMat.emissiveMap = rm.emissive;
    roadMat.emissive = new THREE.Color(0xffffff);
    roadMat.emissiveIntensity = theme.roadGlow;
  }
  // a mesma textura cobre (2W x 2W) metros; o piso vai um pouco além para encostar na mureta
  // malhas contínuas com menos pontos nas retas (o posicionamento de enfeites usa todos)
  const gp = simplifyRun(pts, roadDetailHigh() ? 1 : 2);
  const road = new THREE.Mesh(sweep(gp, [{ l: W + 0.05, y: 0 }, { l: -W - 0.05, y: 0 }], W * 2, W * 2), roadMat);
  road.receiveShadow = shadows;
  group.add(road);

  addWalls(group, pts, gp, theme, W, G, shadows);
  addRails(group, pts, gp, theme, W, shadows);

  // fundo do bloco (aparece na câmera de perseguição durante saltos)
  const under = new THREE.Mesh(
    sweep(gp, [{ l: -W - WALL_OFFSET, y: -0.7 }, { l: W + WALL_OFFSET, y: -0.7 }], 8, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.skirt).multiplyScalar(0.4), roughness: 0.9 }),
  );
  group.add(under);
}

/* ------------------------------------------------------------------ */

function addWalls(group: THREE.Group, pts: CenterPoint[], gp: CenterPoint[], theme: Theme, W: number, G: number, shadows: boolean): void {
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
    const wall = new THREE.Mesh(wallGeometry(gp, side * (W + WALL_OFFSET), G - 0.5, side), mat);
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
function addRails(group: THREE.Group, pts: CenterPoint[], gp: CenterPoint[], theme: Theme, W: number, shadows: boolean): void {
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const segs = Math.floor(pts.length / 2.5);
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
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, 8, curve.closed), mat);
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      group.add(m);
    }
  };

  // meio-fio claro e arredondado em todas as pistas (visual alvo); o estilo do planeta vira detalhe
  const C = WALL_OFFSET;
  const H = CURB_HEIGHT;
  const cm = curbMaps(theme);
  const curbMat = new THREE.MeshStandardMaterial({ map: cm.map, normalMap: concreteNormal(), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.78, metalness: 0 });
  if (cm.emissive) {
    curbMat.emissiveMap = cm.emissive;
    curbMat.emissive = new THREE.Color(0xffffff);
    curbMat.emissiveIntensity = 1.2;
  }
  for (const side of [1, -1] as const) {
    const m = new THREE.Mesh(sweepSmooth(gp, curbProfile(W, side, C), 3), curbMat);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    group.add(m);
  }

  switch (theme.railStyle) {
    case 'lip':
      // Chem VI: a faixa vermelha do friso original está pintada no meio-fio
      break;
    case 'tube': {
      // Drakonis: tubo roxo fino na face externa e bulbos orgânicos sobre o meio-fio
      tube(W + C * 0.95, 0.06, 0.1, new THREE.MeshStandardMaterial({ color: main, emissive: second, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.15 }));
      const bulbs: THREE.Matrix4[] = [];
      along(2.6, (p, side) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        bulbs.push(new THREE.Matrix4().compose(at(p, side * (W + C * 0.55), H - 0.02), q, new THREE.Vector3(1, 0.8, 1.4)));
      });
      instanced(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: main.clone().multiplyScalar(1.2), emissive: main, emissiveIntensity: 0.5, roughness: 0.25 }), bulbs);
      break;
    }
    case 'cable': {
      // Bogmire: cabo preto por fora do meio-fio com estrelas de espinhos prateadas
      tube(W + C + 0.08, 0.18, 0.07, new THREE.MeshStandardMaterial({ color: main, roughness: 0.5, metalness: 0.4 }));
      const stars: THREE.Matrix4[] = [];
      along(2.4, (p, side, k) => {
        q.setFromEuler(new THREE.Euler(k * 0.7, p.heading + k, 0));
        stars.push(new THREE.Matrix4().compose(at(p, side * (W + C + 0.08), 0.2), q, new THREE.Vector3(0.75, 0.75, 0.75)));
      });
      instanced(spikeStarGeometry(0.55), new THREE.MeshStandardMaterial({ color: second, metalness: 0.85, roughness: 0.5, envMapIntensity: 0.5 }), stars);
      break;
    }
    case 'bumper': {
      // New Mojave: faixa verde no meio-fio e luzes amarelas encaixadas no topo
      const lamps: THREE.Matrix4[] = [];
      along(3.2, (p, side) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        lamps.push(new THREE.Matrix4().compose(at(p, side * (W + C * 0.5), H - 0.01), q, one));
      });
      instanced(new THREE.BoxGeometry(0.26, 0.08, 0.42), new THREE.MeshStandardMaterial({ color: second, emissive: second, emissiveIntensity: 1.4, roughness: 0.3 }), lamps, false);
      break;
    }
    case 'ice': {
      // Nho: meio-fio de neve com faixa azul e pingentes de gelo para fora
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
      // Inferno: faixa vermelha incandescente no meio-fio e chifres curvos para fora
      const horns: THREE.Matrix4[] = [];
      along(1.8, (p, side) => {
        const out = new THREE.Vector3(leftX(p.heading) * side, 1.4, leftZ(p.heading) * side).normalize();
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
        horns.push(new THREE.Matrix4().compose(at(p, side * (W + C * 0.85), 0.18), q, new THREE.Vector3(0.9, 0.9, 0.9)));
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
