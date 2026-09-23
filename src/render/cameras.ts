import * as THREE from 'three';

export type CameraMode = 'iso' | 'cockpit' | 'chase';
export const CAMERA_MODES: CameraMode[] = ['iso', 'cockpit', 'chase'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  iso: 'Vista aérea',
  cockpit: 'Cockpit',
  chase: 'Perseguição',
};

export interface CarPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  heading: number;
  velocity: THREE.Vector3;
  shake: number;
  /** olhos do piloto no espaço do carro */
  eye: THREE.Vector3;
}

// Direção fixa da câmera aérea: olhando "de baixo para cima e da direita", como no original.
// Isométrico clássico 2:1 da pixel art (câmera a 30° de elevação), como no original.
const ISO_DIR = new THREE.Vector3(-1, Math.SQRT2 * Math.tan(Math.PI / 6), -1).normalize();
const ISO_DISTANCE = 120;
const BACK = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export class CameraRig {
  mode: CameraMode = 'iso';
  readonly iso: THREE.OrthographicCamera;
  readonly persp: THREE.PerspectiveCamera;
  readonly mirror: THREE.PerspectiveCamera;
  private isoTarget = new THREE.Vector3();
  private chasePos = new THREE.Vector3();
  private first = true;
  private aspect = 1;
  /** metros de pista visíveis na vertical da vista aérea */
  isoView = 40;

  constructor() {
    this.iso = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    this.persp = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
    this.mirror = new THREE.PerspectiveCamera(55, 3, 0.5, 300);
  }

  get active(): THREE.Camera {
    return this.mode === 'iso' ? this.iso : this.persp;
  }

  resize(width: number, height: number): void {
    this.aspect = width / height;
    // no celular em pé, mostra mais pista na vertical para não ficar "apertado"
    const view = this.aspect < 1 ? this.isoView * 1.5 : this.isoView;
    const halfH = view / 2;
    const halfW = halfH * this.aspect;
    this.iso.left = -halfW;
    this.iso.right = halfW;
    this.iso.top = halfH;
    this.iso.bottom = -halfH;
    this.iso.updateProjectionMatrix();
    this.persp.aspect = this.aspect;
    this.persp.fov = this.aspect < 1 ? 85 : 70;
    this.persp.updateProjectionMatrix();
  }

  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.first = true;
    return this.mode;
  }

  update(car: CarPose, dt: number): void {
    const shake = new THREE.Vector3(
      (Math.random() - 0.5) * car.shake,
      (Math.random() - 0.5) * car.shake,
      (Math.random() - 0.5) * car.shake,
    );
    const k = this.first ? 1 : 1 - Math.exp(-dt * 6);

    if (this.mode === 'iso') {
      // olha um pouco à frente do carro, na direção do movimento
      const lead = car.velocity.clone().setY(0).multiplyScalar(0.3);
      lead.clampLength(0, 10);
      const target = car.position.clone().add(lead);
      this.isoTarget.lerp(target, this.first ? 1 : k);
      this.iso.position.copy(this.isoTarget).addScaledVector(ISO_DIR, ISO_DISTANCE).addScaledVector(shake, 0.5);
      this.iso.lookAt(this.isoTarget);
    } else if (this.mode === 'cockpit') {
      const eye = car.eye.clone().applyQuaternion(car.quaternion).add(car.position);
      this.persp.position.copy(eye).addScaledVector(shake, 0.25);
      this.persp.quaternion.copy(car.quaternion).multiply(BACK);
    } else {
      const fwd = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
      const desired = car.position.clone().addScaledVector(fwd, -9).add(new THREE.Vector3(0, 4, 0));
      if (this.first) this.chasePos.copy(desired);
      else this.chasePos.lerp(desired, 1 - Math.exp(-dt * 5));
      if (this.chasePos.y < car.position.y + 1.5) this.chasePos.y = car.position.y + 1.5;
      this.persp.position.copy(this.chasePos).add(shake);
      this.persp.lookAt(car.position.clone().addScaledVector(fwd, 5).add(new THREE.Vector3(0, 1.2, 0)));
    }

    // retrovisor (usado no cockpit): olha para trás, acima do aerofólio
    const mirrorPos = new THREE.Vector3(0, 1.7, -2.6).applyQuaternion(car.quaternion).add(car.position);
    this.mirror.position.copy(mirrorPos);
    this.mirror.quaternion.copy(car.quaternion);
    this.mirror.rotateX(-0.08);
    this.first = false;
  }
}
