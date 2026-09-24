import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ */
/* Texturas compartilhadas (geradas uma vez)                             */
/* ------------------------------------------------------------------ */

let grimeTex: { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;

/** Desgaste da pintura: manchas, arranhões e poeira (cinza claro que multiplica a cor). */
function grime(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  if (grimeTex) return grimeTex;
  const S = 256;
  const make = (rough: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    let seed = rough ? 77 : 13;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = rough ? '#8c8c8c' : '#f6f6f6';
    g.fillRect(0, 0, S, S);
    // manchas suaves
    // tudo bem sutil: o UV das peças extrudadas estica a textura, e contraste alto vira "listras"
    for (let i = 0; i < 50; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 6 + rnd() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const v = Math.round(rough ? 170 + rnd() * 60 : 226 + rnd() * 24);
      grd.addColorStop(0, `rgba(${v},${v},${v},0.25)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // arranhões finos (brilham no mapa de cor, ficam ásperos no de rugosidade)
    g.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const a = rnd() * Math.PI;
      const l = 4 + rnd() * 18;
      g.strokeStyle = rough ? `rgba(200,200,200,${0.08 + rnd() * 0.12})` : `rgba(255,255,255,${0.08 + rnd() * 0.12})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    // pontinhos de sujeira
    for (let i = 0; i < 400; i++) {
      const v = Math.round(rough ? 230 : 170 + rnd() * 50);
      g.fillStyle = `rgba(${v},${v - 8},${v - 16},${0.08 + rnd() * 0.15})`;
      g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (!rough) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  grimeTex = { map: make(false), rough: make(true) };
  return grimeTex;
}

/** Número de corrida estável para uma cor (o mesmo carro sempre tem o mesmo número). */
function raceNumber(color: number): number {
  let h = color ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return 1 + (Math.abs(h) % 98);
}

export type DecalStyle = 'stripes' | 'number' | 'both';

/**
 * Decalque de capô/teto: faixas de corrida duplas e círculo com número.
 * Visto de cima pela câmera aérea, dá identidade a cada carro na pista.
 */
const decalCache = new Map<string, THREE.CanvasTexture>();

function decalTexture(color: number, number: number, style: DecalStyle, aspect: number): THREE.CanvasTexture {
  // compartilhada: mesma cor/número/estilo/proporção = mesma textura (várias peças e carros)
  const key = `${color}|${number}|${style}|${aspect.toFixed(2)}`;
  const hit = decalCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.max(64, Math.round(256 * aspect));
  const H = c.height;
  const cy = H / 2;
  const R = Math.min(64, H * 0.3);
  const g = c.getContext('2d')!;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  const light = hsl.l > 0.6;
  if (style !== 'number') {
    g.fillStyle = light ? '#e8e8e8' : '#161616';
    g.fillRect(72, 0, 44, H);
    g.fillRect(140, 0, 44, H);
    g.fillStyle = light ? '#161616' : '#f2f2f2';
    g.fillRect(78, 0, 32, H);
    g.fillRect(146, 0, 32, H);
  }
  if (style !== 'stripes') {
    g.beginPath();
    g.arc(128, cy, R, 0, Math.PI * 2);
    g.fillStyle = '#f4f4f4';
    g.fill();
    g.lineWidth = R * 0.16;
    g.strokeStyle = '#111';
    g.stroke();
    g.fillStyle = '#111';
    g.font = `bold ${Math.round(R * 1.25)}px Impact, "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(number), 128, cy + R * 0.09);
  }
  if (style !== 'stripes') {
    // riscos e lascas no adesivo (gasto de corrida)
    let seed = number * 7919 + 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = R * (0.55 + rnd() * 0.5);
      g.fillStyle = `rgba(0,0,0,${0.35 + rnd() * 0.5})`;
      g.fillRect(128 + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 + rnd() * 5, 1 + rnd() * 3);
    }
    g.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  decalCache.set(key, t);
  return t;
}

/** Materiais e utilitários compartilhados pelos modelos. */
export class Kit {
  readonly paint: THREE.MeshPhysicalMaterial;
  readonly paintDark: THREE.MeshPhysicalMaterial;
  /** neon na cor do carro: identifica o time até nas pistas mais escuras */
  readonly accent: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
  readonly glass = new THREE.MeshPhysicalMaterial({ color: 0x3a5068, emissive: 0x0c1826, metalness: 0.55, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.8 });
  readonly chrome = new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.7, roughness: 0.22, envMapIntensity: 1.4 });
  readonly gunMetal: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  readonly head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 4 });
  readonly tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 3 });
  /** faixas de perigo amarelas */
  readonly warn = new THREE.MeshStandardMaterial({ color: 0xffc400, emissive: 0xff9a00, emissiveIntensity: 0.35, roughness: 0.5 });
  readonly dash = new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.85 });
  /** bocas das armas: cromado com brilho fraco (as armas leem na câmera aérea) */
  readonly muzzle = new THREE.MeshStandardMaterial({ color: 0xe4e9ef, metalness: 0.75, roughness: 0.18, emissive: 0xfff0d0, emissiveIntensity: 0.4, envMapIntensity: 1.5 });
  /** bocas dos rifles de plasma (VK Plasma Rifles): verde elétrico */
  readonly plasmaGlow = new THREE.MeshStandardMaterial({ color: 0x40ff90, emissive: 0x30ff80, emissiveIntensity: 3.2 });
  /** núcleo do emissor Sundog: sol laranja */
  readonly sundogGlow = new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffa020, emissiveIntensity: 4 });
  /** interior dos bocais de jato (Locust Jump Jets) */
  readonly jetGlow = new THREE.MeshStandardMaterial({ color: 0xff8030, emissive: 0xff5010, emissiveIntensity: 2.2 });
  readonly flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x5ac8ff).multiplyScalar(4),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  readonly number: number;

  constructor(
    readonly color: number,
    readonly shadows: boolean,
    readonly body: THREE.Object3D,
  ) {
    const gr = grime();
    // metal pintado com verniz: pouco metálico para a cor aparecer mesmo sob céu escuro
    this.paint = new THREE.MeshPhysicalMaterial({
      color,
      map: gr.map,
      roughnessMap: gr.rough,
      metalness: 0.3,
      roughness: 0.38,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.3,
    });
    this.paintDark = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color).multiplyScalar(0.4),
      map: gr.map,
      metalness: 0.4,
      roughness: 0.5,
      clearcoat: 0.5,
    });
    this.accent = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25),
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    this.trim = new THREE.MeshStandardMaterial({ color: 0x1c1d22, map: gr.map, metalness: 0.5, roughness: 0.6 });
    this.gunMetal = new THREE.MeshStandardMaterial({ color: 0x5a6068, map: gr.map, metalness: 0.55, roughness: 0.4 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, map: gr.map, metalness: 0.6, roughness: 0.42 });
    this.number = raceNumber(color);
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
      for (const sx of [-1, 1]) this.add(new THREE.BoxGeometry(size, 0.12, 0.06), this.head, sx * x, y, z).rotation.x = -0.5;
    }
    for (const [x, y, z] of rear) {
      for (const sx of [-1, 1]) this.add(new THREE.BoxGeometry(size, 0.13, 0.05), this.tail, sx * x, y, z);
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

  /** Fileira de espinhos cromados entre dois pontos, apontando em `dir` (para-choques de combate). */
  spikes(a: THREE.Vector3, b: THREE.Vector3, n: number, len: number, dir: THREE.Vector3, parent: THREE.Object3D = this.body): void {
    const d = dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const geo = new THREE.ConeGeometry(len * 0.3, len, 6);
    for (let i = 0; i < n; i++) {
      const p = n === 1 ? a.clone().lerp(b, 0.5) : a.clone().lerp(b, i / (n - 1));
      p.addScaledVector(d, len * 0.5);
      const m = this.add(geo, this.chrome, p.x, p.y, p.z, parent);
      m.quaternion.copy(q);
    }
  }

  /* -------------------------- armas e acessórios -------------------------- */

  /** VK Plasma Rifle: cano cromado com aletas de refrigeração e boca verde acesa, apontando para +z. `sc` aumenta a arma toda. */
  plasmaRifle(x: number, y: number, z: number, len = 1.0, parent: THREE.Object3D = this.body, sc = 1): void {
    const L = len * sc;
    this.add(new THREE.BoxGeometry(0.24 * sc, 0.18 * sc, L * 0.45), this.gunMetal, x, y, z - L * 0.2, parent);
    this.add(new THREE.CylinderGeometry(0.06 * sc, 0.075 * sc, L, 10).rotateX(Math.PI / 2), sc > 1 ? this.chrome : this.gunMetal, x, y + 0.02 * sc, z + L * 0.25, parent);
    for (let i = 0; i < 3; i++) this.add(new THREE.CylinderGeometry(0.1 * sc, 0.1 * sc, 0.04 * sc, 10).rotateX(Math.PI / 2), this.steel, x, y + 0.02 * sc, z + i * 0.14 * sc, parent);
    // boca: anel largo cromado com brilho fraco e núcleo verde aceso (lê na câmera aérea)
    this.add(new THREE.CylinderGeometry(0.1 * sc, 0.085 * sc, 0.1 * sc, 12).rotateX(Math.PI / 2), sc > 1 ? this.muzzle : this.gunMetal, x, y + 0.02 * sc, z + L * 0.74, parent);
    this.add(new THREE.CylinderGeometry(0.075 * sc, 0.075 * sc, 0.04 * sc, 12).rotateX(Math.PI / 2), this.plasmaGlow, x, y + 0.02 * sc, z + L * 0.8, parent);
  }

  /** Locust Jump Jets: bocal apontado para baixo, com brilho laranja por dentro. */
  jumpJet(x: number, y: number, z: number, parent: THREE.Object3D = this.body): void {
    this.add(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 12), this.gunMetal, x, y, z, parent);
    this.add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), this.warn, x, y + 0.14, z, parent);
    this.add(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12), this.jetGlow, x, y - 0.16, z, parent);
  }

  /** BF's Slipsauce: tanque deitado com bico de despejo virado para trás. */
  slipsauceTank(x: number, y: number, z: number, w = 0.9, parent: THREE.Object3D = this.body): void {
    this.add(new THREE.CylinderGeometry(0.22, 0.22, w, 14).rotateZ(Math.PI / 2), this.gunMetal, x, y, z, parent);
    for (const dx of [-w * 0.32, w * 0.32]) this.add(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 14).rotateZ(Math.PI / 2), this.warn, x + dx, y, z, parent);
    this.add(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8).rotateX(Math.PI / 2 + 0.5), this.chrome, x, y - 0.12, z - 0.25, parent);
  }

  /** Rogue Missiles: casulo com 2x2 mísseis de ponta vermelha, apontando para +z. */
  missilePod(x: number, y: number, z: number, len = 1.1, parent: THREE.Object3D = this.body): THREE.Mesh {
    const pod = this.add(new THREE.BoxGeometry(0.42, 0.34, len), this.gunMetal, x, y, z, parent);
    for (const dx of [-0.1, 0.1])
      for (const dy of [-0.08, 0.08]) {
        this.add(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10).rotateX(Math.PI / 2), this.trim, x + dx, y + dy, z + len / 2, parent);
        this.add(new THREE.ConeGeometry(0.06, 0.2, 10).rotateX(Math.PI / 2), this.tail, x + dx, y + dy, z + len / 2 + 0.1, parent);
      }
    this.add(new THREE.BoxGeometry(0.43, 0.06, 0.12), this.warn, x, y + 0.14, z - len * 0.3, parent);
    return pod;
  }

  /** Bear Claw Mines: calha traseira com garras de aço à mostra. */
  bearClawDropper(x: number, y: number, z: number, parent: THREE.Object3D = this.body): void {
    this.add(new THREE.BoxGeometry(0.9, 0.24, 0.34), this.gunMetal, x, y, z, parent);
    for (let i = 0; i < 4; i++) this.add(new THREE.BoxGeometry(0.1, 0.25, 0.35), this.warn, x - 0.3 + i * 0.2, y, z, parent).rotation.z = 0.5;
    const claw = new THREE.ConeGeometry(0.05, 0.22, 5);
    for (let i = 0; i < 5; i++) {
      const m = this.add(claw, this.chrome, x - 0.32 + i * 0.16, y - 0.16, z - 0.12, parent);
      m.rotation.x = Math.PI - 0.6;
    }
  }

  /** KO Scatterpack: caixa com seis tubos virados para trás (espalha minas). */
  scatterpack(x: number, y: number, z: number, parent: THREE.Object3D = this.body): void {
    this.add(new THREE.BoxGeometry(0.95, 0.4, 0.45), this.gunMetal, x, y, z, parent);
    this.add(new THREE.BoxGeometry(0.97, 0.08, 0.47), this.warn, x, y + 0.2, z, parent);
    for (const dx of [-0.3, 0, 0.3])
      for (const dy of [-0.08, 0.08]) {
        this.add(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 10).rotateX(Math.PI / 2), this.steel, x + dx, y + dy, z - 0.26, parent);
        this.add(new THREE.CircleGeometry(0.05, 10).rotateY(Math.PI), this.dash, x + dx, y + dy, z - 0.325, parent);
      }
  }

  /** Emissor Sundog: anel cromado com um sol laranja no meio e aletas de antena. */
  sundogEmitter(x: number, y: number, z: number, r = 0.32, parent: THREE.Object3D = this.body): THREE.Mesh {
    this.add(new THREE.CylinderGeometry(r * 0.7, r * 0.9, 0.18, 16), this.gunMetal, x, y - 0.12, z, parent);
    this.add(new THREE.TorusGeometry(r, r * 0.16, 8, 24).rotateX(Math.PI / 2), this.chrome, x, y + 0.02, z, parent);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const f = this.add(new THREE.BoxGeometry(0.04, 0.28, 0.12), this.steel, x + Math.cos(a) * r, y + 0.14, z + Math.sin(a) * r, parent);
      f.rotation.y = -a;
    }
    return this.add(new THREE.SphereGeometry(r * 0.62, 16, 12), this.sundogGlow, x, y + 0.08, z, parent);
  }

  /** Placa de blindagem aparafusada (com 4 rebites). Peças soltas, para poderem ser mescladas. */
  plate(w: number, l: number, x: number, y: number, z: number, rotX = 0, rotZ = 0, parent: THREE.Object3D = this.body): void {
    const e = new THREE.Euler(rotX, 0, rotZ);
    const q = new THREE.Quaternion().setFromEuler(e);
    const c = new THREE.Vector3(x, y, z);
    this.add(new THREE.BoxGeometry(w, 0.06, l), this.steel, x, y, z, parent).quaternion.copy(q);
    const rivet = new THREE.SphereGeometry(0.04, 6, 4);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = new THREE.Vector3(sx * (w / 2 - 0.09), 0.035, sz * (l / 2 - 0.09)).applyQuaternion(q).add(c);
        this.add(rivet, this.chrome, p.x, p.y, p.z, parent);
      }
  }

  /**
   * Decalque plano (faixas e/ou número) deitado sobre uma superfície da carroceria.
   * `tilt` inclina em torno do eixo x (positivo = frente mais baixa).
   */
  decal(w: number, l: number, x: number, y: number, z: number, tilt = 0, style: DecalStyle = 'both', parent: THREE.Object3D = this.body): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      map: decalTexture(this.color, this.number, style, l / w),
      transparent: true,
      roughness: 0.35,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      depthWrite: false,
    });
    // plano deitado com o topo da textura apontando para a frente do carro (+z)
    const geo = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).rotateY(Math.PI);
    const m = this.add(geo, mat, x, y, z, parent);
    m.rotation.x = tilt;
    m.castShadow = false;
    return m;
  }

  /**
   * Decalque assentado sobre a superfície de `surface` (projetado de cima): acha a altura e a
   * inclinação reais do capô/teto, sem enterrar nem flutuar.
   */
  decalOn(surface: THREE.Mesh, w: number, l: number, x: number, z: number, style: DecalStyle = 'both', parent: THREE.Object3D = this.body): THREE.Mesh {
    surface.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const probe = (pz: number): number | null => {
      ray.set(new THREE.Vector3(x, 10, pz), down);
      const hit = ray.intersectObject(surface, false)[0];
      return hit ? hit.point.y : null;
    };
    const yF = probe(z + l * 0.4) ?? probe(z) ?? 1;
    const yB = probe(z - l * 0.4) ?? yF;
    const tilt = Math.atan2(yB - yF, l * 0.8);
    return this.decal(w, l, x, (yF + yB) / 2 + 0.025, z, tilt, style, parent);
  }

  /**
   * Decalque na lateral (porta) de `surface`, lado `side` (±1): projetado de fora para dentro, acha a
   * parede e o ângulo dela em planta. Lê de fora, com o topo para cima.
   */
  decalSide(surface: THREE.Mesh, w: number, h: number, side: number, y: number, z: number, style: DecalStyle = 'number', parent: THREE.Object3D = this.body): THREE.Mesh | null {
    surface.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3(-side, 0, 0);
    const probe = (pz: number): number | null => {
      ray.set(new THREE.Vector3(side * 10, y, pz), dir);
      const hit = ray.intersectObject(surface, false)[0];
      return hit ? hit.point.x : null;
    };
    const x0 = probe(z);
    if (x0 === null) return null;
    const xF = probe(z + w * 0.4) ?? x0;
    const xB = probe(z - w * 0.4) ?? x0;
    const yaw = Math.atan2(xF - xB, w * 0.8);
    const mat = new THREE.MeshStandardMaterial({
      map: decalTexture(this.color, this.number, style, h / w),
      transparent: true,
      roughness: 0.35,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(w, h).rotateY((side * Math.PI) / 2);
    const m = this.add(geo, mat, x0 + side * 0.025, y, z, parent);
    m.rotation.y = yaw;
    m.castShadow = false;
    return m;
  }

  /**
   * Junta as peças estáticas (filhas diretas de `parent`, sem filhos) por material: de dezenas de
   * draw calls para poucos — importante no celular. `keep` são peças que o jogo esconde ou anima.
   */
  merge(keep: THREE.Object3D[] = [], parent: THREE.Object3D = this.body): void {
    const skip = new Set(keep);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const remove: THREE.Mesh[] = [];
    for (const child of parent.children) {
      const m = child as THREE.Mesh;
      if (!m.isMesh || skip.has(m) || m.children.length || Array.isArray(m.material) || !m.visible) continue;
      m.updateMatrix();
      const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      src.applyMatrix4(m.matrix);
      if (!src.getAttribute('normal')) src.computeVertexNormals();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.getAttribute('position'));
      g.setAttribute('normal', src.getAttribute('normal'));
      g.setAttribute('uv', src.getAttribute('uv') ?? new THREE.BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
      const mat = m.material as THREE.Material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g);
      remove.push(m);
    }
    for (const m of remove) parent.remove(m);
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = this.shadows && !mat.transparent;
      mesh.receiveShadow = this.shadows;
      parent.add(mesh);
    }
  }
}
