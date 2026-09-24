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
// Elevação de 32°: praticamente o isométrico 2:1 da pixel art do SNES (mostra as laterais dos
// blocos da pista, a marca registrada do original), só um pouco mais alto para ver o piso.
export const ISO_ELEVATION = (32 * Math.PI) / 180;
const ISO_DIR = new THREE.Vector3(-1, Math.SQRT2 * Math.tan(ISO_ELEVATION), -1).normalize();
const ISO_DISTANCE = 120;
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.55, 0.35);
/** inclinação do cockpit para cima: horizonte perto de 40% da altura da tela, rivais à vista */
const COCKPIT_PITCH = 0.09;
const BACK = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** Perseguição: distância horizontal e altura mínimas até o carro (m). */
const CHASE_MIN_DIST = 6;
const CHASE_MIN_HEIGHT = 2.6;

export class CameraRig {
  mode: CameraMode = 'iso';
  readonly iso: THREE.OrthographicCamera;
  readonly persp: THREE.PerspectiveCamera;
  readonly mirror: THREE.PerspectiveCamera;
  private isoTarget = new THREE.Vector3();
  private chasePos = new THREE.Vector3();
  private first = true;
  private aspect = 1;
  /** metros de pista visíveis na vertical da vista aérea (perto: carros grandes na tela) */
  isoView = 23;
  /** zoom atual (abre um pouco em alta velocidade: sensação de velocidade e mais pista à frente) */
  private zoom = 1;

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
    // teleporte (nova corrida, reaparecimento): a câmera salta em vez de atravessar o mapa
    const ref = this.mode === 'iso' ? this.isoTarget : this.chasePos;
    if (!this.first && this.mode !== 'cockpit' && ref.distanceTo(car.position) > 40) this.first = true;

    if (this.mode === 'iso') {
      // olha à frente do carro, na direção do movimento (mais pista à frente em alta velocidade)
      const flat = car.velocity.clone().setY(0);
      const speed = flat.length();
      const lead = flat.multiplyScalar(0.45);
      lead.clampLength(0, 14);
      const target = car.position.clone().add(lead);
      this.isoTarget.lerp(target, this.first ? 1 : 1 - Math.exp(-dt * 8));
      // abre o zoom com a velocidade (até +28%) — o cenário passa mais rápido na tela
      const wantZoom = 1 + Math.min(1, Math.max(0, (speed - 12) / 24)) * 0.28;
      this.zoom += (wantZoom - this.zoom) * (1 - Math.exp(-dt * 2));
      const halfH = ((this.aspect < 1 ? this.isoView * 1.5 : this.isoView) / 2) * this.zoom;
      if (Math.abs(this.iso.top - halfH) > 0.01) {
        this.iso.top = halfH;
        this.iso.bottom = -halfH;
        this.iso.left = -halfH * this.aspect;
        this.iso.right = halfH * this.aspect;
        this.iso.updateProjectionMatrix();
      }
      this.iso.position.copy(this.isoTarget).addScaledVector(ISO_DIR, ISO_DISTANCE).addScaledVector(shake, 0.5);
      this.iso.lookAt(this.isoTarget);
    } else if (this.mode === 'cockpit') {
      const baseFov = this.aspect < 1 ? 85 : 70;
      if (this.persp.fov !== baseFov) {
        this.persp.fov = baseFov;
        this.persp.updateProjectionMatrix();
      }
      // um pouco acima e à frente dos olhos do piloto: o painel ocupa menos da tela
      const eye = car.eye.clone().add(COCKPIT_OFFSET).applyQuaternion(car.quaternion).add(car.position);
      this.persp.position.copy(eye).addScaledVector(shake, 0.25);
      this.persp.quaternion.copy(car.quaternion).multiply(BACK);
      this.persp.rotateX(COCKPIT_PITCH);
    } else {
      const fwd = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
      // em alta velocidade a câmera fica um pouco mais para trás e o campo de visão abre
      const speed = Math.hypot(car.velocity.x, car.velocity.z);
      const fast = Math.min(1, Math.max(0, (speed - 10) / 30));
      const fov = (this.aspect < 1 ? 85 : 70) + fast * 12;
      if (Math.abs(this.persp.fov - fov) > 0.05) {
        this.persp.fov += (fov - this.persp.fov) * Math.min(1, dt * 4);
        this.persp.updateProjectionMatrix();
      }
      const desired = car.position.clone().addScaledVector(fwd, -7.5 - fast * 1.5).add(new THREE.Vector3(0, 3.4, 0));
      if (this.first) this.chasePos.copy(desired);
      else {
        // segue mais rápido quando o carro gira bruscamente (rodada, pancada): não fica para trás
        const off = this.chasePos.clone().sub(car.position).setY(0);
        const behind = off.lengthSq() > 0.01 ? -off.normalize().dot(fwd) : 1;
        const rate = behind < 0.5 ? 12 : 5;
        this.chasePos.lerp(desired, 1 - Math.exp(-dt * rate));
      }
      // nunca encosta no carro: distância horizontal e altura mínimas (o carro inteiro cabe no
      // terço de baixo da tela, com barbatanas e armas à vista)
      const flatOff = this.chasePos.clone().sub(car.position).setY(0);
      const d = flatOff.length();
      if (d < CHASE_MIN_DIST) {
        if (d < 0.1) flatOff.copy(fwd).multiplyScalar(-1);
        flatOff.setLength(CHASE_MIN_DIST);
        this.chasePos.x = car.position.x + flatOff.x;
        this.chasePos.z = car.position.z + flatOff.z;
      }
      if (this.chasePos.y < car.position.y + CHASE_MIN_HEIGHT) this.chasePos.y = car.position.y + CHASE_MIN_HEIGHT;
      this.persp.position.copy(this.chasePos).add(shake);
      this.persp.lookAt(car.position.clone().addScaledVector(fwd, 9).add(new THREE.Vector3(0, 0.6, 0)));
    }

    // retrovisor (usado no cockpit): olha para trás, acima do aerofólio
    const mirrorPos = new THREE.Vector3(0, 1.7, -2.6).applyQuaternion(car.quaternion).add(car.position);
    this.mirror.position.copy(mirrorPos);
    this.mirror.quaternion.copy(car.quaternion);
    this.mirror.rotateX(-0.08);
    this.first = false;
  }
}
