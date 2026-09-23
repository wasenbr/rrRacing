import * as THREE from 'three';

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

/** Materiais e utilitários compartilhados pelos modelos. */
export class Kit {
  readonly paint: THREE.MeshPhysicalMaterial;
  readonly paintDark: THREE.MeshPhysicalMaterial;
  readonly trim = new THREE.MeshStandardMaterial({ color: 0x141418, metalness: 0.5, roughness: 0.55 });
  readonly glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0f16, metalness: 0.2, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.88 });
  readonly chrome = new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.35, envMapIntensity: 0.5 });
  readonly gunMetal = new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.9, roughness: 0.35 });
  readonly rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
  readonly head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 3 });
  readonly tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 2.5 });
  readonly dash = new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.85 });
  readonly flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x5ac8ff).multiplyScalar(4),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  constructor(
    color: number,
    readonly shadows: boolean,
    readonly body: THREE.Object3D,
  ) {
    this.paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    this.paintDark = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color).multiplyScalar(0.45),
      metalness: 0.6,
      roughness: 0.4,
      clearcoat: 0.6,
    });
  }

  add<T extends THREE.BufferGeometry>(geo: T, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, parent: THREE.Object3D = this.body): THREE.Mesh<T> {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = this.shadows;
    m.receiveShadow = this.shadows;
    parent.add(m);
    return m;
  }

  /** Cilindro entre dois pontos (tubos de gaiola, suportes). */
  tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, parent: THREE.Object3D = this.body): THREE.Mesh {
    const len = a.distanceTo(b);
    const m = this.add(new THREE.CylinderGeometry(r, r, len, 8), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, parent);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }

  /** Faróis e lanternas simétricos. */
  lights(front: [number, number, number][], rear: [number, number, number][], size = 0.38): void {
    for (const [x, y, z] of front) {
      for (const sx of [-1, 1]) this.add(new THREE.BoxGeometry(size, 0.1, 0.06), this.head, sx * x, y, z).rotation.x = -0.5;
    }
    for (const [x, y, z] of rear) {
      for (const sx of [-1, 1]) this.add(new THREE.BoxGeometry(size, 0.12, 0.05), this.tail, sx * x, y, z);
    }
  }

  /** Chamas de nitro apontando para trás. */
  flames(points: [number, number, number][], scale = 1): THREE.Mesh[] {
    return points.map(([x, y, z]) => {
      const f = this.add(new THREE.ConeGeometry(0.22 * scale, 1.4 * scale, 10, 1, true), this.flameMat, x, y, z);
      f.rotation.x = -Math.PI / 2;
      f.castShadow = false;
      f.visible = false;
      return f;
    });
  }
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
    24,
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
  const side = Math.sign(x) || 1;
  const n = o.spokes ?? 5;
  for (let k = 0; k < n; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, r * 1.05, 0.07), kit.chrome);
    spoke.position.x = side * hw * 0.85;
    spoke.rotation.x = (k / n) * Math.PI;
    spin.add(spoke);
  }
  if (o.knobby) {
    // cravos do pneu off-road
    const knob = new THREE.BoxGeometry(o.width * 0.9, 0.08, 0.12);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const m = new THREE.Mesh(knob, kit.rubber);
      m.position.set(0, Math.cos(a) * r, Math.sin(a) * r);
      m.rotation.x = -a;
      spin.add(m);
    }
  }
  pivot.add(spin);
  kit.body.add(pivot);
  return { pivot, spin };
}

export interface CockpitOpts {
  eye: THREE.Vector3;
  /** meia-largura do habitáculo */
  halfWidth: number;
  /** altura do topo da moldura (null = sem teto, ex.: buggy aberto) */
  roofY: number | null;
  /** base do para-brisa (z) */
  frontZ: number;
}

/** Painel, volante, colunas e assoalho vistos de dentro. */
export function cockpitRig(kit: Kit, o: CockpitOpts): { cockpit: THREE.Group; steeringWheel: THREE.Group } {
  const cockpit = new THREE.Group();
  cockpit.visible = false;
  kit.body.add(cockpit);
  const e = o.eye;
  const dashY = e.y - 0.3;
  kit.add(new THREE.BoxGeometry(o.halfWidth * 2, 0.16, 0.5), kit.dash, 0, dashY, e.z + 0.85, cockpit).rotation.x = 0.15;
  kit.add(new THREE.BoxGeometry(0.5, 0.12, 0.12), kit.dash, 0, dashY + 0.1, e.z + 0.65, cockpit);
  const gaugeGeo = new THREE.CircleGeometry(0.045, 20);
  kit.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0x3aff7a }), -0.1, dashY + 0.11, e.z + 0.58, cockpit).rotation.y = Math.PI;
  kit.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0xff8a3a }), 0.1, dashY + 0.11, e.z + 0.58, cockpit).rotation.y = Math.PI;
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, dashY + 0.06, e.z + 0.45);
  steeringWheel.rotation.x = -0.45;
  cockpit.add(steeringWheel);
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 28), kit.trim));
  steeringWheel.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.02), kit.trim));
  steeringWheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12).rotateX(Math.PI / 2), kit.trim));
  if (o.roofY !== null) {
    for (const sx of [-1, 1]) {
      kit.tube(new THREE.Vector3(sx * (o.halfWidth + 0.1), dashY, o.frontZ), new THREE.Vector3(sx * o.halfWidth, o.roofY, e.z + 0.55), 0.03, kit.trim, cockpit);
    }
    kit.add(new THREE.BoxGeometry(o.halfWidth * 2 - 0.1, 0.06, 0.1), kit.trim, 0, o.roofY, e.z + 0.55, cockpit);
  }
  for (const sx of [-1, 1]) kit.add(new THREE.BoxGeometry(0.12, 0.28, 1.9), kit.dash, sx * (o.halfWidth + 0.06), dashY + 0.06, e.z + 0.3, cockpit);
  // assoalho um pouco acima da lataria (evita que a pintura apareça por dentro)
  kit.add(new THREE.BoxGeometry(o.halfWidth * 2 + 0.2, 0.06, 1.8), kit.dash, 0, dashY + 0.07, e.z + 0.2, cockpit);
  return { cockpit, steeringWheel };
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
