import * as THREE from 'three';
import { forwardX, forwardZ } from '../sim/math';
import type { Hazard, Pickup, Projectile, World } from '../sim/world';
import { canvasTexture } from './trackMesh';

/* ------------------------------------------------------------------ */
/* Partículas: dois InstancedMesh (fogo/faíscas aditivos e fumaça)      */
/* ------------------------------------------------------------------ */

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size0: number;
  size1: number;
  c0: THREE.Color;
  c1: THREE.Color;
  gravity: number;
  drag: number;
}

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private items: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(
    private capacity: number,
    material: THREE.Material,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  emit(p: Omit<Particle, 'max'>): void {
    if (this.items.length >= this.capacity) this.items.shift();
    this.items.push({ ...p, max: p.life });
  }

  update(dt: number): void {
    const alive: Particle[] = [];
    for (const p of this.items) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      alive.push(p);
    }
    this.items = alive;
    alive.forEach((p, i) => {
      const t = 1 - p.life / p.max;
      const size = p.size0 + (p.size1 - p.size0) * t;
      this.m.compose(this.p.set(p.x, p.y, p.z), this.q, this.s.setScalar(size));
      this.mesh.setMatrixAt(i, this.m);
      this.c.copy(p.c0).lerp(p.c1, t);
      this.mesh.setColorAt(i, this.c);
    });
    this.mesh.count = alive.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */

function coinTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, '#ffe98a');
    g.addColorStop(1, '#c78a00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#8a5a00';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#7a4a00';
    ctx.font = 'bold 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 64, 70);
  });
}

const HOT = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

/**
 * Tudo que aparece e some durante a corrida: tiros, mísseis, minas, óleo,
 * dinheiro/blindagem na pista, explosões, faíscas e fumaça.
 */
export class Effects {
  readonly group = new THREE.Group();
  private fire: ParticlePool;
  private smoke: ParticlePool;
  private projectiles = new Map<number, THREE.Object3D>();
  private hazards = new Map<number, THREE.Object3D>();
  private pickups = new Map<number, THREE.Object3D>();
  private flashes: { light: THREE.PointLight; life: number }[] = [];
  private rings: { mesh: THREE.Mesh; life: number }[] = [];
  private time = 0;

  // geometrias e materiais compartilhados
  private laserGeo = new THREE.CapsuleGeometry(0.08, 1.8, 4, 8).rotateX(Math.PI / 2);
  private laserMat = new THREE.MeshBasicMaterial({ color: HOT(0x60ffb0, 2.6) });
  private missileBody = new THREE.CylinderGeometry(0.14, 0.14, 1.2, 10).rotateX(Math.PI / 2);
  private missileNose = new THREE.ConeGeometry(0.14, 0.4, 10).rotateX(Math.PI / 2);
  private missileMat = new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.8, roughness: 0.3 });
  private exhaustMat = new THREE.MeshBasicMaterial({ color: HOT(0xffa040, 5) });
  private mineGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.25, 16);
  private mineMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.7, roughness: 0.4 });
  private oilGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  private oilMat = new THREE.MeshStandardMaterial({
    color: 0x050505,
    roughness: 0.05,
    metalness: 0.9,
    transparent: true,
    opacity: 0.92,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private slimeMat = new THREE.MeshStandardMaterial({
    color: 0x3a9a10,
    emissive: 0x143a04,
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private coinGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.14, 24).rotateX(Math.PI / 2);
  private coinMat: THREE.Material[];
  private armorMat = new THREE.MeshStandardMaterial({ color: 0x20c060, emissive: 0x0a6a2a, metalness: 0.4, roughness: 0.3 });
  private ringGeo = new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2);

  constructor() {
    this.fire = new ParticlePool(500, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.smoke = new ParticlePool(400, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, roughness: 1, depthWrite: false }));
    this.group.add(this.fire.mesh, this.smoke.mesh);
    const coinFace = new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.7, roughness: 0.3, emissive: 0x3a2800 });
    const coinEdge = new THREE.MeshStandardMaterial({ color: 0xd8a010, metalness: 0.9, roughness: 0.25 });
    this.coinMat = [coinEdge, coinFace, coinFace];
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xff8a30, 0, 30, 2);
      this.group.add(light);
      this.flashes.push({ light, life: 0 });
    }
  }

  /* ---------- emissores ---------- */

  explosion(x: number, y: number, z: number, big = true): void {
    const n = big ? 40 : 14;
    const s = big ? 1 : 0.5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = (4 + Math.random() * 10) * s;
      this.fire.emit({
        x, y: y + 0.8, z,
        vx: Math.cos(a) * sp * (1 - up * 0.5), vy: up * sp * 1.2, vz: Math.sin(a) * sp * (1 - up * 0.5),
        life: 0.35 + Math.random() * 0.45, size0: 1.6 * s, size1: 0.2,
        c0: HOT(0xffd070, 4), c1: HOT(0xff3000, 1.5), gravity: 4, drag: 3,
      });
    }
    for (let i = 0; i < (big ? 26 : 8); i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({
        x: x + Math.cos(a), y: y + 0.8, z: z + Math.sin(a),
        vx: Math.cos(a) * 2, vy: 2 + Math.random() * 4, vz: Math.sin(a) * 2,
        life: 1.2 + Math.random() * 1.2, size0: 1 * s, size1: 4.5 * s,
        c0: new THREE.Color(0x3a3430), c1: new THREE.Color(0x121212), gravity: -1, drag: 1.2,
      });
    }
    this.sparks(x, y + 0.8, z, big ? 30 : 10);
    const flash = this.flashes.reduce((a, b) => (a.life < b.life ? a : b));
    flash.light.position.set(x, y + 2, z);
    flash.life = big ? 0.5 : 0.25;
    flash.light.intensity = big ? 400 : 120;
    if (big) {
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: HOT(0xffb060, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.set(x, y + 0.2, z);
      this.group.add(ring);
      this.rings.push({ mesh: ring, life: 0.45 });
    }
  }

  sparks(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.fire.emit({
        x, y, z,
        vx: (Math.random() - 0.5) * 22, vy: Math.random() * 12, vz: (Math.random() - 0.5) * 22,
        life: 0.25 + Math.random() * 0.35, size0: 0.18, size1: 0.05,
        c0: HOT(0xfff0b0, 5), c1: HOT(0xff8020, 2), gravity: 25, drag: 1,
      });
    }
  }

  puff(x: number, y: number, z: number, color = 0x2a2828, size = 1): void {
    this.smoke.emit({
      x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
      vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.5,
      life: 0.9 + Math.random() * 0.6, size0: 0.4 * size, size1: 2.2 * size,
      c0: new THREE.Color(color), c1: new THREE.Color(0x0a0a0a), gravity: -0.5, drag: 1,
    });
  }

  flame(x: number, y: number, z: number): void {
    this.fire.emit({
      x: x + (Math.random() - 0.5) * 0.8, y, z: z + (Math.random() - 0.5) * 0.8,
      vx: 0, vy: 3 + Math.random() * 2, vz: 0,
      life: 0.3 + Math.random() * 0.2, size0: 0.8, size1: 0.1,
      c0: HOT(0xffb040, 3), c1: HOT(0xff2000, 1), gravity: -2, drag: 2,
    });
  }

  /* ---------- sincronização com a simulação ---------- */

  private syncMap<T extends { id: number }>(map: Map<number, THREE.Object3D>, items: T[], create: (it: T) => THREE.Object3D, update: (o: THREE.Object3D, it: T) => void): void {
    const seen = new Set<number>();
    for (const it of items) {
      seen.add(it.id);
      let o = map.get(it.id);
      if (!o) {
        o = create(it);
        map.set(it.id, o);
        this.group.add(o);
      }
      update(o, it);
    }
    for (const [id, o] of map) {
      if (!seen.has(id)) {
        this.group.remove(o);
        map.delete(id);
      }
    }
  }

  /** `ahead` = tempo desde o último passo da simulação, para extrapolar projéteis rápidos. */
  update(world: World, dt: number, ahead: number): void {
    this.time += dt;

    this.syncMap(
      this.projectiles,
      world.projectiles,
      (p: Projectile) => {
        const g = new THREE.Group();
        if (p.kind === 'laser') g.add(new THREE.Mesh(this.laserGeo, this.laserMat));
        else {
          g.add(new THREE.Mesh(this.missileBody, this.missileMat));
          const nose = new THREE.Mesh(this.missileNose, this.missileMat);
          nose.position.z = 0.8;
          const ex = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.exhaustMat);
          ex.position.z = -0.65;
          g.add(nose, ex);
        }
        return g;
      },
      (o, p: Projectile) => {
        o.position.set(p.x + forwardX(p.heading) * p.speed * ahead, p.y, p.z + forwardZ(p.heading) * p.speed * ahead);
        o.rotation.y = p.heading;
        if (p.kind === 'missile') {
          const bx = p.x - forwardX(p.heading) * 0.8;
          const bz = p.z - forwardZ(p.heading) * 0.8;
          this.puff(bx, p.y, bz, 0x6a6460, 0.5);
          this.flame(bx, p.y, bz);
        }
      },
    );

    this.syncMap(
      this.hazards,
      world.hazards,
      (h: Hazard) => {
        if (h.kind === 'slime') {
          const m = new THREE.Mesh(this.oilGeo, this.slimeMat);
          m.scale.set(2.3, 1, 1.9);
          m.rotation.y = h.id;
          return m;
        }
        if (h.kind === 'oil') {
          const m = new THREE.Mesh(this.oilGeo, this.oilMat);
          m.scale.setScalar(0.3);
          return m;
        }
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.mineGeo, this.mineMat));
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: HOT(0xff2010, 5) }));
        led.position.y = 0.16;
        led.name = 'led';
        g.add(led);
        return g;
      },
      (o, h: Hazard) => {
        if (h.kind === 'slime') {
          o.position.set(h.x, h.y + 0.03, h.z);
        } else if (h.kind === 'oil') {
          // a mancha se espalha nos primeiros instantes
          const r = 2.4 * Math.min(1, 0.3 + h.age * 2.5);
          o.scale.set(r, 1, r * 0.85);
          o.position.set(h.x, h.y + 0.03, h.z);
        } else {
          o.position.set(h.x, h.y + 0.12, h.z);
          const led = o.getObjectByName('led');
          if (led) led.visible = h.age < 0.6 || Math.sin(this.time * 12) > 0;
        }
      },
    );

    this.syncMap(
      this.pickups,
      world.pickups,
      (p: Pickup) => {
        if (p.kind === 'money') return new THREE.Mesh(this.coinGeo, this.coinMat);
        const g = new THREE.Group();
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.3), this.armorMat);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), this.armorMat);
        g.add(a, b);
        return g;
      },
      (o, p: Pickup) => {
        o.visible = p.active;
        o.position.set(p.x, p.y + 1.1 + Math.sin(this.time * 3 + p.id) * 0.15, p.z);
        o.rotation.y = this.time * 2.5 + p.id;
      },
    );

    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.light.intensity *= Math.exp(-dt * 9);
        if (f.life <= 0) f.light.intensity = 0;
      }
    }
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      const t = 1 - r.life / 0.45;
      r.mesh.scale.setScalar(1 + t * 9);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });

    this.fire.update(dt);
    this.smoke.update(dt);
  }
}
