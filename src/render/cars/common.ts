import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit } from './kit';

export { Kit } from './kit';

/** Estado usado para animar o modelo a cada quadro. */
export interface CarAnim {
  /** rotação acumulada das rodas (rad) */
  spin: number;
  steer: number;
  /** velocidade para frente (m/s) */
  speed: number;
  time: number;
  grounded: boolean;
}

export interface CarVisual {
  root: THREE.Group;
  /** carroceria (balança com a suspensão) — filha de root */
  body: THREE.Group;
  /** partes escondidas na câmera de cockpit (teto/cabine) */
  cabin: THREE.Object3D[];
  /** painel, volante e colunas, visíveis só na câmera de cockpit */
  cockpit: THREE.Group;
  steeringWheel: THREE.Object3D;
  /** chamas do nitro */
  flames: THREE.Mesh[];
  /** olhos do piloto, em coordenadas locais do carro (+z = frente) */
  eye: THREE.Vector3;
  animate(a: CarAnim): void;
}

/**
 * Cria uma peça a partir de um perfil lateral (u = comprimento, v = altura),
 * extrudada na largura com chanfro — formas bem mais realistas que caixas.
 */
export function sideProfile(shape: THREE.Shape, width: number, bevel: number, curveSegments = 16): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments,
  });
  geo.rotateY(-Math.PI / 2); // perfil vira o comprimento (z), extrusão vira a largura (x)
  geo.translate(Math.max(0.01, width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Monta um perfil a partir de uma lista de pontos (u, v). */
export function polyShape(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach(([u, v], i) => (i === 0 ? s.moveTo(u, v) : s.lineTo(u, v)));
  s.closePath();
  return s;
}

export interface WheelOpts {
  radius: number;
  width: number;
  spokes?: number;
  /** pneu de terra (cravos) */
  knobby?: boolean;
}

/** Roda com pneu arredondado e aro. Retorna o pivô (esterça) e a roda (gira). */
export function wheel(kit: Kit, o: WheelOpts, x: number, y: number, z: number): { pivot: THREE.Group; spin: THREE.Group } {
  const r = o.radius;
  const hw = o.width / 2;
  const tireGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(r * 0.58, -hw),
      new THREE.Vector2(r * 0.88, -hw),
      new THREE.Vector2(r * 0.98, -hw * 0.7),
      new THREE.Vector2(r, 0),
      new THREE.Vector2(r * 0.98, hw * 0.7),
      new THREE.Vector2(r * 0.88, hw),
      new THREE.Vector2(r * 0.58, hw),
    ],
    32,
  );
  tireGeo.rotateZ(Math.PI / 2);
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const spin = new THREE.Group();
  const tire = new THREE.Mesh(tireGeo, kit.rubber);
  tire.castShadow = kit.shadows;
  spin.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, o.width * 0.8, 20).rotateZ(Math.PI / 2), kit.gunMetal);
  spin.add(rim);
  // calota na cor do carro, dos dois lados
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.34, o.width * 0.86, 14).rotateZ(Math.PI / 2), kit.paint);
  spin.add(hub);
  const side = Math.sign(x) || 1;
  const n = o.spokes ?? 5;
  for (let k = 0; k < n; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, r * 1.05, 0.07), kit.chrome);
    spoke.position.x = side * hw * 0.85;
    spoke.rotation.x = (k / n) * Math.PI;
    spin.add(spoke);
  }
  if (o.knobby) {
    // cravos em V (chevron) do pneu off-road, numa única malha
    spin.add(new THREE.Mesh(chevronTread(r, o.width), kit.rubber));
  }
  pivot.add(spin);
  kit.body.add(pivot);
  return { pivot, spin };
}

const treadCache = new Map<string, THREE.BufferGeometry>();

/** Banda de rodagem com cravos em V: cada cravo são dois braços inclinados que se encontram no meio. */
export function chevronTread(r: number, width: number): THREE.BufferGeometry {
  const key = `${r}:${width}`;
  const hit = treadCache.get(key);
  if (hit) return hit;
  const n = Math.max(14, Math.round(r * 22));
  const arm = width * 0.5;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const side of [-1, 1]) {
      // braço deitado sobre o topo do pneu (y = r), girado em torno do eixo radial, depois levado ao ângulo a
      const g = new THREE.BoxGeometry(arm, 0.09, 0.11);
      g.translate((side * arm) / 2, 0, 0);
      g.rotateY(side * 0.5);
      g.translate(0, r * 0.985, 0);
      g.rotateX(a);
      parts.push(g.toNonIndexed());
    }
  }
  const merged = mergeGeometries(parts, false)!;
  merged.computeVertexNormals();
  treadCache.set(key, merged);
  return merged;
}

/** Arma que aparece no capô na vista de cockpit (lembra o que o carro dispara). */
export type HoodWeapon = 'plasma' | 'missiles' | 'sundog' | 'none';

export interface CockpitOpts {
  eye: THREE.Vector3;
  /** meia-largura do capô visto de dentro */
  halfWidth: number;
  /** comprimento do capô à frente do painel */
  hoodLength?: number;
  weapon?: HoodWeapon;
  /** material do capô (padrão: pintura do carro) */
  hoodMat?: THREE.Material;
}

/**
 * Vista de dentro, igual para todos os carros: o exterior inteiro some (ver `cabin`) e fica só
 * um capô baixo na cor do carro, o painel e o volante. Nada acima da linha dos olhos: a pista
 * fica sempre livre, qualquer que seja a forma do carro.
 */
export function cockpitRig(kit: Kit, o: CockpitOpts, parent: THREE.Object3D = kit.body): { cockpit: THREE.Group; steeringWheel: THREE.Group } {
  const cockpit = new THREE.Group();
  cockpit.visible = false;
  parent.add(cockpit);
  const e = o.eye;
  const hw = o.halfWidth;
  const L = o.hoodLength ?? 1.9;
  const z0 = e.z + 0.5;
  // capô: some para baixo à frente (ocupa só a faixa de baixo da tela)
  const hood = new THREE.Shape();
  hood.moveTo(0, e.y - 0.46);
  hood.lineTo(L * 0.55, e.y - 0.56);
  hood.quadraticCurveTo(L * 0.92, e.y - 0.66, L, e.y - 0.9);
  hood.lineTo(L, e.y - 1.1);
  hood.lineTo(0, e.y - 1.1);
  hood.closePath();
  const hoodGeo = sideProfile(hood, hw * 2, 0.08, 10);
  hoodGeo.translate(0, 0, z0);
  const hoodMesh = kit.add(hoodGeo, o.hoodMat ?? kit.paint, 0, 0, 0, cockpit);
  hoodMesh.castShadow = false;
  // faixa central escura no capô (referência de direção)
  const stripe = kit.add(new THREE.BoxGeometry(0.22, 0.02, L * 0.5), kit.trim, 0, e.y - 0.49, z0 + L * 0.28, cockpit);
  stripe.rotation.x = 0.1;
  // painel: faixa baixa e fina, com dois mostradores acesos
  kit.add(new THREE.BoxGeometry(hw * 2, 0.1, 0.28), kit.dash, 0, e.y - 0.43, e.z + 0.42, cockpit).rotation.x = 0.2;
  const gaugeGeo = new THREE.CircleGeometry(0.04, 18);
  kit.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0x3aff7a }), -0.12, e.y - 0.37, e.z + 0.33, cockpit).rotation.set(-0.35, Math.PI, 0);
  kit.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0xff8a3a }), 0.12, e.y - 0.37, e.z + 0.33, cockpit).rotation.set(-0.35, Math.PI, 0);
  // volante: só o arco de cima aparece, como num jogo de corrida
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, e.y - 0.36, e.z + 0.42);
  steeringWheel.rotation.x = -0.5;
  cockpit.add(steeringWheel);
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 28), kit.trim));
  steeringWheel.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.02), kit.trim));
  const top = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.024, 8, 10, Math.PI * 0.35), kit.accent);
  top.rotation.z = Math.PI * 0.325;
  steeringWheel.add(top);
  // arma no capô
  const w = o.weapon ?? 'none';
  const gy = e.y - 0.5;
  if (w === 'plasma') {
    for (const sx of [-1, 1]) {
      const x = sx * hw * 0.62;
      kit.add(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 10).rotateX(Math.PI / 2), kit.gunMetal, x, gy, z0 + 0.75, cockpit);
      kit.add(new THREE.BoxGeometry(0.18, 0.12, 0.35), kit.gunMetal, x, gy - 0.02, z0 + 0.25, cockpit);
      kit.add(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).rotateX(Math.PI / 2), kit.plasmaGlow, x, gy, z0 + 1.22, cockpit);
    }
  } else if (w === 'missiles') {
    for (const sx of [-1, 1]) {
      const x = sx * hw * 0.55;
      kit.add(new THREE.BoxGeometry(0.3, 0.2, 0.8), kit.gunMetal, x, gy + 0.02, z0 + 0.7, cockpit);
      kit.add(new THREE.BoxGeometry(0.31, 0.05, 0.12), kit.warn, x, gy + 0.1, z0 + 0.45, cockpit);
      for (const dx of [-0.07, 0.07]) kit.add(new THREE.ConeGeometry(0.05, 0.16, 8).rotateX(Math.PI / 2), kit.tail, x + dx, gy + 0.02, z0 + 1.17, cockpit);
    }
  } else if (w === 'sundog') {
    kit.add(new THREE.TorusGeometry(0.14, 0.03, 8, 20).rotateX(Math.PI / 2), kit.chrome, 0, gy - 0.1, z0 + 1.05, cockpit);
    kit.add(new THREE.SphereGeometry(0.09, 14, 10), kit.sundogGlow, 0, gy - 0.05, z0 + 1.05, cockpit);
  }
  return { cockpit, steeringWheel };
}

/**
 * Esqueleto comum: `root` (posição/rotação do carro) > `body` (balanço da suspensão) >
 * `ext` (todo o exterior, escondido na câmera de cockpit).
 */
export function carFrame(): { root: THREE.Group; body: THREE.Group; ext: THREE.Group } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const ext = new THREE.Group();
  root.add(body);
  body.add(ext);
  return { root, body, ext };
}

/** Textura de esteira (para o Battle Trak), com rolagem por offset. */
export function treadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, y, 64, 18);
    ctx.fillStyle = '#555';
    ctx.fillRect(4, y + 2, 56, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
