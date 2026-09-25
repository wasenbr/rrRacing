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

/**
 * Contorno da esteira (laço comprido de pontas redondas), frente levemente erguida. `inset` encolhe o
 * laço para dentro (o miolo fica sob as placas; o meio das placas corre em inset = TH / 2).
 */
function trackShape(len: number, r: number, lift = 0.1, inset = 0): THREE.Shape {
  const s = new THREE.Shape();
  const h = len / 2 - r;
  s.moveTo(-h, inset);
  s.lineTo(h - 0.3, inset);
  s.absarc(h, r + lift, r - inset, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-h, r * 2 - inset);
  s.absarc(-h, r, r - inset, Math.PI / 2, (Math.PI * 3) / 2, false);
  return s;
}

const TH = 0.09; // espessura das placas da esteira
const PITCH = 0.3; // passo entre placas

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

/** Para-brisa preto em cunha: placa grossa deitada sobre a rampa da frente; o dorso prata fica à mostra atrás. */
function glassShape(): THREE.Shape {
  return polyShape(lift([
    [2.2, 0.614],
    [2.46, 0.667],
    [2.47, 0.738],
    [0.9, 1.037],
    [0.55, 1.105],
    [0.5, 0.99],
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
    if (y > lowY(0.98)) s -= 0.16 * Math.min(1, (y - lowY(0.98)) / (lowY(1.29) - lowY(0.98)));
    p.setX(i, x * s);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Battle Trak (alvo: referencias/modernizados/tank.webp): casco PRATA metálico facetado, com chanfros,
 * subindo até o topo de duas ESTEIRAS enormes à mostra (não usa pneus); para-brisa preto brilhante em
 * cunha com moldura prata na frente; torreta sextavada baixa com cano curto e os casulos dos Rogue
 * Missiles nas laterais dela; espinhos roxos na face externa de cada esteira; escape grande atrás e
 * KO Scatterpack na traseira. As esteiras são placas retangulares pretas (instanciadas) com borda
 * cinza, que correm pelo laço todo.
 */
export function createBattleTrak(color: number, shadows: boolean): CarVisual {
  const { root, body, ext, chassis } = carFrame();
  const k = new Kit(color, shadows, ext);
  const blackGlass = new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.6, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3 });
  // casco prata metálico (não pega a cor do time: ela vai nas faixas do dorso e no neon)
  const hullMat = new THREE.MeshPhysicalMaterial({ color: 0xc9ced6, metalness: 0.8, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 1.6 });
  // moldura prata clara em volta do para-brisa
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe8ebf0, metalness: 0.85, roughness: 0.2, envMapIntensity: 1.8 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x9a8cff, emissive: 0x3a2aa0, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.22 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.35, roughness: 0.42 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8e9299, metalness: 0.65, roughness: 0.35 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x1b1c21, metalness: 0.45, roughness: 0.45 });

  // ---- ESTEIRAS: miolo escuro + placas instanciadas correndo pelo laço ----
  const beforeTreads = new Set(ext.children);
  const inner = trackShape(TL - 0.36, TR - 0.16, 0.08);
  const lipGeo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(inner.getSpacedPoints(60).slice(0, -1).map((p) => new THREE.Vector3(0, p.y, p.x)), true),
    80,
    0.025,
    5,
    true,
  );
  for (const sx of [-1, 1]) {
    // miolo sob as placas e flancos escuros (sem discos: de lado a esteira é um bloco de placas)
    k.add(sideProfile(trackShape(TL, TR, 0.1, TH), TW - 0.02, 0.03, 22), sideMat, sx * TX, 0, 0);
    k.add(sideProfile(inner, 0.06, 0.025, 18), sideMat, sx * (TX + TW / 2 - 0.01), 0.16, 0);
    k.add(sideProfile(inner, 0.05, 0.02, 12), k.trim, sx * (TX - TW / 2 - 0.01), 0.16, 0);
    // friso prata acompanhando a borda do flanco externo
    k.add(lipGeo, edgeMat, sx * (TX + TW / 2 + 0.035), 0.16, 0);
    // fileira de espinhos piramidais roxos na face externa, sobre base sextavada
    for (let i = 0; i < 4; i++) {
      const z = -0.95 + i * 0.64;
      const sp = k.add(new THREE.ConeGeometry(0.13, 0.32, 4), spikeMat, sx * (TX + TW / 2 + 0.23), TR + 0.14, z);
      sp.rotation.z = (-sx * Math.PI) / 2;
      sp.rotation.x = Math.PI / 4;
      k.add(new THREE.CylinderGeometry(0.16, 0.17, 0.08, 6).rotateZ(Math.PI / 2), k.gunMetal, sx * (TX + TW / 2 + 0.07), TR + 0.14, z);
    }
  }
  // placas: caminho do meio da placa amostrado por comprimento (consulta rápida a cada quadro)
  const path = trackShape(TL, TR, 0.1, TH / 2);
  const perim = path.getLength();
  const NP = Math.round(perim / PITCH);
  const pitch = perim / NP;
  const SAMPLES = 720;
  const pathPts: THREE.Vector2[] = [];
  const pathTan: THREE.Vector2[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    pathPts.push(path.getPointAt(i / SAMPLES));
    pathTan.push(path.getTangentAt(i / SAMPLES));
  }
  const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(TW - 0.02, TH, pitch * 0.8), plateMat, NP * 2);
  const edges = new THREE.InstancedMesh(new THREE.BoxGeometry(TW + 0.05, TH * 0.6, pitch * 0.98), edgeMat, NP * 2);
  for (const im of [plates, edges]) {
    im.castShadow = shadows;
    im.receiveShadow = shadows;
    im.frustumCulled = false; // o laço cabe na caixa do carro; as instâncias mudam a cada quadro
    chassis.add(im);
  }
  const M = new THREE.Matrix4();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  let lastOff = NaN;
  const layPlates = (off: number) => {
    if (off === lastOff) return;
    lastOff = off;
    for (let i = 0; i < NP; i++) {
      const u = (((i * pitch + off) % perim) + perim) % perim;
      const j = Math.floor((u / perim) * SAMPLES) % SAMPLES;
      const p = pathPts[j];
      const t = pathTan[j];
      // no plano do perfil (x = comprimento → z, y = altura): normal para fora (t.y, −t.x)
      Y.set(0, -t.x, t.y);
      Z.set(0, -t.y, -t.x);
      M.makeBasis(X, Y, Z);
      for (let n = 0; n < 2; n++) {
        M.setPosition((n ? 1 : -1) * TX, p.y, p.x);
        plates.setMatrixAt(n * NP + i, M);
        edges.setMatrixAt(n * NP + i, M);
      }
    }
    plates.instanceMatrix.needsUpdate = true;
    edges.instanceMatrix.needsUpdate = true;
  };
  layPlates(0);
  // esteiras no chassi: o casco balança por cima delas (suspensão), elas ficam no chão
  for (const o of ext.children.filter((c) => !beforeTreads.has(c))) chassis.add(o);
  const travel = wheelTravel(0.1);

  // ---- CASCO prata facetado, até o topo das esteiras ----
  const shell = k.add(facet(sideProfile(hullShape(), HW, 0.07, 4)), hullMat, 0, 0, 0);
  // para-brisa preto de alto brilho em cunha ocupando a frente, sobre a moldura prata (a mesma cunha
  // um pouco mais larga e mais baixa: só a borda aparece em volta do vidro)
  k.add(facet(sideProfile(glassShape(), HW - 0.3, 0.04, 4)), rimMat, 0, -0.035, 0);
  k.add(facet(sideProfile(glassShape(), HW - 0.52, 0.04, 4)), blackGlass, 0, 0.006, 0);
  // faixa escura na base do casco, entre o casco e as esteiras
  k.add(new THREE.BoxGeometry(HW - 0.1, 0.12, 3.1), k.trim, 0, 0.3, -0.55);

  // ---- TORRETA sextavada baixa com cano curto; Rogue Missiles nas laterais dela ----
  const TY = lowY(1.2);
  const TZ = -0.7;
  k.add(new THREE.CylinderGeometry(0.46, 0.54, 0.14, 6), k.gunMetal, 0, TY - 0.02, TZ);
  k.add(new THREE.CylinderGeometry(0.3, 0.44, 0.2, 6), k.steel, 0, TY + 0.15, TZ);
  k.add(new THREE.CylinderGeometry(0.16, 0.3, 0.06, 6), k.gunMetal, 0, TY + 0.28, TZ);
  // cano curto para a frente, com luva e boca
  k.add(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 12).rotateX(Math.PI / 2), k.gunMetal, 0, TY + 0.15, TZ + 0.45);
  k.add(new THREE.CylinderGeometry(0.045, 0.045, 0.55, 12).rotateX(Math.PI / 2), k.chrome, 0, TY + 0.15, TZ + 0.8);
  k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12).rotateX(Math.PI / 2), k.gunMetal, 0, TY + 0.15, TZ + 1.06);
  for (const sx of [-1, 1]) {
    // casulo de 2 mísseis colado à face lateral da torreta, ogivas vermelhas para a frente
    const px = sx * 0.62;
    const py = TY + 0.1;
    k.add(new THREE.BoxGeometry(0.16, 0.12, 0.3), k.gunMetal, sx * 0.46, py, TZ);
    k.add(new THREE.BoxGeometry(0.2, 0.3, 0.72), k.gunMetal, px, py, TZ + 0.05);
    k.add(new THREE.BoxGeometry(0.21, 0.05, 0.12), k.warn, px, py + 0.155, TZ - 0.15);
    for (const dy of [-0.07, 0.07]) {
      k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10).rotateX(Math.PI / 2), k.trim, px, py + dy, TZ + 0.42);
      k.add(new THREE.ConeGeometry(0.055, 0.18, 10).rotateX(Math.PI / 2), k.tail, px, py + dy, TZ + 0.5);
    }
  }

  const EXH_Y = 1.6;
  // escape: cilindro grande deitado no alto da traseira (sai o nitro) e KO Scatterpack embaixo
  k.add(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 20).rotateX(Math.PI / 2), k.trim, 0, EXH_Y, -1.95);
  for (const dz of [-1.55, -2.35]) k.add(new THREE.CylinderGeometry(0.335, 0.335, 0.08, 20).rotateX(Math.PI / 2), k.chrome, 0, EXH_Y, dz);
  k.add(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 16).rotateX(Math.PI / 2), k.gunMetal, 0, EXH_Y, -2.5);
  k.add(new THREE.CircleGeometry(0.22, 16).rotateY(Math.PI), k.jetGlow, 0, EXH_Y, -2.53);
  k.scatterpack(0, 0.58, -2.38);

  // número atrás da torreta e faixas na cor do time ao longo do dorso prata (identificam o time de cima)
  k.decalOn(shell, 0.62, 0.55, 0, -1.6, 'number');
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.16, 0.03, 2.1), k.paint, sx * 0.64, lowY(1.16), -0.85);
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.035, 0.035, 2.1), k.accent, sx * 0.75, lowY(1.16) + 0.005, -0.85);
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
      // o laço gira: embaixo as placas andam para trás (presas ao chão), em cima para a frente
      layPlates((((-a.spin * 0.45) % pitch) + pitch) % pitch);
    },
  };
}
