import * as THREE from 'three';
import { carFrame, cockpitRig, Kit, polyShape, sideProfile, wheelTravel, type CarVisual } from './common';
import { nitroThrust } from './kit';

const TL = 4.5; // comprimento das esteiras
const TR = 0.75; // raio das pontas das esteiras (altura = 2 * TR = 1,5 m): ~25% mais altas que o casco
/**
 * Altura do casco central: estica o perfil (topo ~1,56 m, rente ao topo das esteiras) para o casco claro aparecer por cima do
 * vão entre as esteiras, como no modelo de referência, sem passar da altura das esteiras.
 */
const lowY = (y: number) => (y <= 0.28 ? y : 0.28 + (y - 0.28) * 1.42);
const lift = (pts: [number, number][]): [number, number][] => pts.map(([z, y]) => [z, lowY(y)]);
const TX = 1.0; // centro das esteiras em x
const TW = 0.58; // largura das esteiras
const HW = 2 * (TX - TW / 2) + 0.06; // largura do casco: preenche todo o vão entre as esteiras

/** Contorno da esteira (laço comprido de pontas redondas), frente levemente erguida. */
function trackShape(len: number, r: number, lift = 0.1): THREE.Shape {
  const s = new THREE.Shape();
  const h = len / 2 - r;
  s.moveTo(-h, 0);
  s.lineTo(h - 0.3, 0);
  s.absarc(h, r + lift, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-h, r * 2);
  s.absarc(-h, r, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  return s;
}

/** Perfil lateral do casco: nariz baixo em cunha, dorso quase plano, traseira chanfrada. */
function hullShape(): THREE.Shape {
  return polyShape(lift([
    [-2.05, 0.28],
    [0.9, 0.28],
    [2.3, 0.28],
    [2.62, 0.474],
    [2.6, 0.614],
    [2.42, 0.685],
    [0.9, 0.98],
    [0.15, 1.125],
    [-1.85, 1.178],
    [-2.25, 1.019],
    [-2.28, 0.491],
  ]));
}

/** Para-brisa preto em cunha: placa grossa deitada sobre toda a rampa da frente do casco. */
function glassShape(): THREE.Shape {
  return polyShape(lift([
    [2.2, 0.614],
    [2.46, 0.667],
    [2.47, 0.738],
    [0.9, 1.037],
    [0.2, 1.186],
    [-0.12, 1.204],
    [-0.14, 1.072],
    [0.9, 0.896],
  ]));
}

/**
 * Facetado do casco em planta e no topo: o nariz afina em ponta sextavada, a traseira tem cantos
 * chanfrados e as bordas de cima caem num chanfro — o "brinquedo premium" do modelo de referência.
 */
function facet(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let s = 1;
    if (z > 0.9) s -= 0.55 * Math.min(1, (z - 0.9) / 1.72);
    if (z < -1.85) s -= 0.12 * Math.min(1, (-1.85 - z) / 0.43);
    if (y > lowY(0.98)) s -= 0.1 * Math.min(1, (y - lowY(0.98)) / (lowY(1.29) - lowY(0.98)));
    p.setX(i, x * s);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Placas da esteira: blocos pretos com frisos cinza (rola por offset). */
function treadPlates(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8c8f96';
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = '#0b0c0f';
    ctx.fillRect(0, y + 3, 30, 27);
    ctx.fillRect(34, y + 3, 30, 27);
    ctx.fillStyle = '#34363c';
    ctx.fillRect(0, y + 15, 30, 2);
    ctx.fillRect(34, y + 15, 30, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Battle Trak: casco facetado largo entre duas ESTEIRAS enormes à mostra (não usa pneus), com um
 * para-brisa preto grande em cunha na frente, espinhos roxos na face externa de cada esteira,
 * torreta sextavada com o lançador dos Rogue Missiles, escape grande atrás e KO
 * Scatterpack na traseira.
 */
export function createBattleTrak(color: number, shadows: boolean): CarVisual {
  const { root, body, ext, chassis } = carFrame();
  const k = new Kit(color, shadows, ext);
  const blackGlass = new THREE.MeshPhysicalMaterial({ color: 0x06080c, metalness: 0.8, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 3 });
  // casco central CLARO (prata com um toque da cor do time): destaca das esteiras pretas, como o
  // tank.webp; a cor do time vai nas faixas do dorso e nos painéis das esteiras
  const hullMat = k.paint.clone();
  hullMat.color = new THREE.Color(color).lerp(new THREE.Color(0xf2f4f7), 0.8);
  hullMat.metalness = 0.45;
  hullMat.roughness = 0.3;
  // friso claro contornando o para-brisa
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.5, roughness: 0.25, envMapIntensity: 1.4 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x9a8cff, emissive: 0x3a2aa0, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.22 });
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.35, roughness: 0.45 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x17181c, metalness: 0.45, roughness: 0.4 });
  const linkMat = new THREE.MeshStandardMaterial({ color: 0x8c8f96, metalness: 0.6, roughness: 0.35 });

  // esteiras: laço de placas segmentadas que rola, bem à mostra
  const tread = treadPlates();
  tread.repeat.set(1, 2);
  const treadMat = new THREE.MeshStandardMaterial({ map: tread, roughness: 0.42, metalness: 0.35 });
  const sprockets: THREE.Mesh[] = [];
  // tudo das esteiras (laço, roletes, rodas, espinhos, blocos) vai para o chassi no fim
  const beforeTreads = new Set(ext.children);
  for (const sx of [-1, 1]) {
    const geo = sideProfile(trackShape(TL, TR), TW, 0.05, 22);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    // v = distância ao longo do contorno (aprox.): as placas rolam pela borda toda
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / TW + 0.5, pos.getZ(i) / TL + pos.getY(i) * 0.22);
    uv.needsUpdate = true;
    k.add(geo, treadMat, sx * TX, 0, 0);
    // flancos escuros dos elos (cobrem as tampas do laço) e painel grafite por fora: de lado a
    // esteira é um bloco preto de placas, sem rodas à mostra (tank.webp)
    k.add(sideProfile(trackShape(TL - 0.1, TR - 0.05, 0.1), TW + 0.03, 0.015, 20), k.trim, sx * TX, 0.05, 0);
    const inner = trackShape(TL - 0.36, TR - 0.16, 0.08);
    k.add(sideProfile(inner, 0.08, 0.035, 18), sideMat, sx * (TX + TW / 2 - 0.01), 0.16, 0);
    k.add(sideProfile(inner, 0.05, 0.02, 12), k.trim, sx * (TX - TW / 2 - 0.01), 0.16, 0);
    // elos: frisos verticais cinza no painel, como as placas segmentadas vistas de lado
    for (let i = 0; i < 9; i++) {
      const z = -1.72 + i * 0.43;
      k.add(new THREE.BoxGeometry(0.02, 2 * TR - 0.5, 0.05), linkMat, sx * (TX + TW / 2 + 0.035), TR + 0.08, z);
    }
    // cubos das rodas motriz e tensora nas pontas (giram), pequenos e escuros
    for (const z of [-TL / 2 + TR, TL / 2 - TR]) {
      const w = k.add(new THREE.CylinderGeometry(TR * 0.36, TR * 0.36, 0.07, 18).rotateZ(Math.PI / 2), k.gunMetal, sx * (TX + TW / 2 + 0.07), TR + (z > 0 ? 0.1 : 0), z);
      for (let i = 0; i < 3; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, TR * 0.6, 0.07), k.trim);
        spoke.rotation.x = (i / 3) * Math.PI;
        w.add(spoke);
      }
      w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.11, 12).rotateZ(Math.PI / 2), k.chrome));
      sprockets.push(w);
    }
    // fileira de espinhos piramidais roxos na face externa, sobre base sextavada
    for (let i = 0; i < 4; i++) {
      const z = -0.95 + i * 0.64;
      const sp = k.add(new THREE.ConeGeometry(0.13, 0.32, 4), spikeMat, sx * (TX + TW / 2 + 0.23), TR + 0.14, z);
      sp.rotation.z = -sx * Math.PI / 2;
      sp.rotation.x = Math.PI / 4;
      k.add(new THREE.CylinderGeometry(0.16, 0.17, 0.08, 6).rotateZ(Math.PI / 2), k.gunMetal, sx * (TX + TW / 2 + 0.07), TR + 0.14, z);
    }
  }

  // blocos em relevo no trecho de cima da esteira (andam junto com a textura)
  const PLATE = 0.32;
  const plateGeo = new THREE.BoxGeometry(TW + 0.04, 0.09, PLATE * 0.74);
  const treadTops: THREE.Group[] = [];
  const topLen = TL - 2 * TR;
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * TX, 2 * TR + 0.03, 0);
    for (let i = 0; i < Math.floor(topLen / PLATE); i++) {
      const m = new THREE.Mesh(plateGeo, blockMat);
      m.position.z = -topLen / 2 + (i + 0.5) * PLATE;
      m.castShadow = k.shadows;
      g.add(m);
    }
    ext.add(g);
    treadTops.push(g);
  }
  // esteiras no chassi: o casco balança por cima delas (suspensão), elas ficam no chão
  for (const o of ext.children.filter((c) => !beforeTreads.has(c))) chassis.add(o);
  const travel = wheelTravel(0.1);

  // casco central largo e facetado, na cor do carro
  const shell = k.add(facet(sideProfile(hullShape(), HW, 0.07, 4)), hullMat, 0, 0, 0);
  // para-brisa preto de alto brilho em cunha ocupando a frente toda, sobre um friso claro (a mesma
  // cunha um pouco mais larga e mais baixa: só a borda aparece em volta do vidro)
  k.add(facet(sideProfile(glassShape(), HW - 0.34, 0.04, 4)), rimMat, 0, -0.03, 0);
  k.add(facet(sideProfile(glassShape(), HW - 0.5, 0.04, 4)), blackGlass, 0, 0.006, 0);
  // faixa escura na base do casco, entre o casco e as esteiras
  k.add(new THREE.BoxGeometry(HW - 0.1, 0.12, 3.1), k.trim, 0, 0.3, -0.55);

  // torreta sextavada no dorso
  const TY = lowY(1.2);
  const TZ = -0.62;
  k.add(new THREE.CylinderGeometry(0.5, 0.59, 0.2, 6), k.gunMetal, 0, TY, TZ);
  k.add(new THREE.CylinderGeometry(0.31, 0.48, 0.22, 6), k.steel, 0, TY + 0.2, TZ);
  // Rogue Missiles: lançador sobre a torreta (é dali que saem os mísseis, à frente e na altura dele):
  // dois casulos 2x2 lado a lado num suporte, ogivas vermelhas para a frente
  k.add(new THREE.BoxGeometry(0.3, 0.16, 0.5), k.gunMetal, 0, TY + 0.36, TZ + 0.1);
  for (const sx of [-0.25, 0.25]) k.missilePod(sx, TY + 0.58, TZ + 0.4, 1.05);
  k.add(new THREE.BoxGeometry(0.94, 0.05, 0.14), k.warn, 0, TY + 0.44, TZ + 0.75);

  const EXH_Y = 1.6;
  // escape: cilindro grande deitado no alto da traseira (sai o nitro) e KO Scatterpack embaixo
  k.add(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 20).rotateX(Math.PI / 2), k.trim, 0, EXH_Y, -1.95);
  for (const dz of [-1.55, -2.35]) k.add(new THREE.CylinderGeometry(0.335, 0.335, 0.08, 20).rotateX(Math.PI / 2), k.chrome, 0, EXH_Y, dz);
  k.add(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 16).rotateX(Math.PI / 2), k.gunMetal, 0, EXH_Y, -2.5);
  k.add(new THREE.CircleGeometry(0.22, 16).rotateY(Math.PI), k.jetGlow, 0, EXH_Y, -2.53);
  k.scatterpack(0, 0.58, -2.38);

  // número e faixas sobre o dorso
  k.decalOn(shell, 0.62, 0.55, 0, -1.55, 'number');
  // faixas largas na cor do time ao longo do dorso claro (identificam o time de cima)
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.2, 0.03, 2.1), k.paint, sx * 0.44, lowY(1.16) + 0.01, -0.85);
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.04, 0.035, 2.1), k.accent, sx * 0.58, lowY(1.16) + 0.015, -0.85);
  k.lights([[0.34, 0.58, 2.6]], [[0.5, lowY(0.95), -2.27]], 0.22);
  const flames = k.flames([[0, EXH_Y, -2.53]], 0.24, nitroThrust('battletrak'));

  const eye = new THREE.Vector3(0, 1.85, 0.2);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.9, weapon: 'missiles', hoodLength: 1.7, hoodMat: blackGlass }, body);

  k.merge();

  return {
    root,
    body,
    cabin: [ext, chassis],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      chassis.position.y = travel(a);
      tread.offset.y = -a.spin * 0.1;
      // blocos de cima andam para trás na velocidade da esteira
      const off = (((-a.spin * 0.45) % PLATE) + PLATE) % PLATE;
      for (const g of treadTops) g.position.z = off - PLATE / 2;
      for (const w of sprockets) w.rotation.x = a.spin * 1.2;
    },
  };
}
