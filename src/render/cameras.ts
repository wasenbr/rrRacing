import * as THREE from 'three';
import { isTouchDevice } from '../input/controls';
import type { Track } from '../sim/track';

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
  /** pista e trecho atual: a vista aérea antecipa pela direção da pista, não pela velocidade */
  track?: Track;
  pieceIndex?: number;
}

// Direção fixa da câmera aérea: olhando "de baixo para cima e da direita", como no original.
// Elevação de 32°: praticamente o isométrico 2:1 da pixel art do SNES (mostra as laterais dos
// blocos da pista, a marca registrada do original), só um pouco mais alto para ver o piso.
export const ISO_ELEVATION = (32 * Math.PI) / 180;
const ISO_DIR = new THREE.Vector3(-1, Math.SQRT2 * Math.tan(ISO_ELEVATION), -1).normalize();
const ISO_DISTANCE = 120;
/**
 * Antecipação da vista aérea (item 40): até ISO_LEAD m na direção da pista à frente (ponto a
 * ISO_LEAD_LOOK m), seguida devagar (ISO_LEAD_RATE por s) — não vai e volta com a velocidade.
 */
const ISO_LEAD = 8;
const ISO_LEAD_LOOK = 16;
const ISO_LEAD_RATE = 0.6;
/**
 * No toque o HUD ocupa o alto da tela e os botões o pé: o carro fica um pouco acima do centro
 * (fração da altura da tela), no meio da faixa livre entre os dois.
 */
const TOUCH_SCREEN_SHIFT = 0.06;
/** direção "para cima na tela" projetada no chão (para longe da câmera) */
const ISO_UP_GROUND = new THREE.Vector3(1, 0, 1).normalize();
/**
 * Olhos um pouco acima e atrás dos do piloto: o capô e os para-lamas (cockpitRig) ocupam a faixa
 * de baixo da tela (~1/4) sem tapar a pista.
 */
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.38, -0.05);
/** leve inclinação para baixo: horizonte perto de 40–45% da altura (a partir do topo) */
const COCKPIT_PITCH = -0.06;
const BACK = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** Perseguição: distância horizontal e altura mínimas até o carro (m). */
const CHASE_MIN_DIST = 5.8;
const CHASE_MIN_HEIGHT = 3.8;
/** Perseguição: atraso máximo (distância horizontal) em alta velocidade — o carro não "foge" da tela. */
const CHASE_MAX_DIST = 8.2;

export class CameraRig {
  mode: CameraMode = 'iso';
  readonly iso: THREE.OrthographicCamera;
  readonly persp: THREE.PerspectiveCamera;
  readonly mirror: THREE.PerspectiveCamera;
  private isoTarget = new THREE.Vector3();
  /** antecipação suavizada da vista aérea */
  private isoLead = new THREE.Vector3();
  private chasePos = new THREE.Vector3();
  private first = true;
  private aspect = 1;
  /** metros de pista visíveis na vertical da vista aérea (perto: carros grandes na tela) */
  isoView = 23;
  /** zoom atual (abre um pouco em alta velocidade: sensação de velocidade e mais pista à frente) */
  private zoom = 1;
  private readonly touch = isTouchDevice();
  private leadTmp = new THREE.Vector3();
  /** perseguição: rival colado ao carro (0–1, vem do jogo); a câmera sobe até 1,8 m para ver por cima */
  chaseLift = 0;
  private lift = 0;

  constructor() {
    this.iso = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    this.persp = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
    this.mirror = new THREE.PerspectiveCamera(55, 3, 2.5, 300);
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

  /** Próximo update() encaixa a câmera no carro sem transição (largada, troca de pista). */
  snap(): void {
    this.first = true;
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
      // olha um pouco à frente do carro, na direção da PISTA (não da velocidade) e com teto baixo; a
      // antecipação é suavizada à parte e bem devagar: derrapagem, freada, batida ou rodada não jogam
      // a câmera de um lado para o outro (item 40). O carro em si é seguido de perto.
      const speed = Math.hypot(car.velocity.x, car.velocity.z);
      const lead = this.leadTmp.set(0, 0, 0);
      if (car.track) {
        const q = car.track.query(car.position.x, car.position.z, car.pieceIndex ?? -1);
        const a = car.track.pointAtDist(q.dist + ISO_LEAD_LOOK);
        lead.set(a.x - car.position.x, 0, a.z - car.position.z);
        // parado ou saindo da largada: antecipa menos
        lead.setLength(ISO_LEAD * Math.min(1, Math.max(0.3, speed / 15)));
      }
      if (this.first) this.isoLead.copy(lead);
      else this.isoLead.lerp(lead, 1 - Math.exp(-dt * ISO_LEAD_RATE));
      const target = car.position.clone().add(this.isoLead);
      if (this.touch) {
        // tira o carro de baixo do HUD/minimapa e dos botões: ponto de mira abaixo do carro na tela
        const halfView = ((this.aspect < 1 ? this.isoView * 1.5 : this.isoView) / 2) * this.zoom;
        target.addScaledVector(ISO_UP_GROUND, (-2 * TOUCH_SCREEN_SHIFT * halfView) / Math.sin(ISO_ELEVATION));
      }
      this.isoTarget.lerp(target, this.first ? 1 : 1 - Math.exp(-dt * 10));
      // zoom abre pouco e devagar com a velocidade (até +12%), sem "respirar" a cada freada
      const wantZoom = 1 + Math.min(1, Math.max(0, (speed - 15) / 25)) * 0.12;
      this.zoom += (wantZoom - this.zoom) * (1 - Math.exp(-dt * 0.8));
      const halfH = ((this.aspect < 1 ? this.isoView * 1.5 : this.isoView) / 2) * this.zoom;
      if (Math.abs(this.iso.top - halfH) > 0.01) {
        this.iso.top = halfH;
        this.iso.bottom = -halfH;
        this.iso.left = -halfH * this.aspect;
        this.iso.right = halfH * this.aspect;
        this.iso.updateProjectionMatrix();
      }
      // tremor na vista aérea só em pancada forte, e fraco
      const isoShake = car.shake > 0.25 ? 0.15 : 0;
      this.iso.position.copy(this.isoTarget).addScaledVector(ISO_DIR, ISO_DISTANCE).addScaledVector(shake, isoShake);
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
      // mais alta e um pouco mais atrás: o carro fica no terço de baixo e quem passa ao lado não
      // "atravessa" o modelo na tela; mira longe, na pista à frente
      const desired = car.position.clone().addScaledVector(fwd, -6.8 - fast * 0.7).add(new THREE.Vector3(0, 4.4, 0));
      if (this.first) this.chasePos.copy(desired);
      else {
        // segue mais rápido quando o carro gira bruscamente (rodada, pancada): não fica para trás
        const off = this.chasePos.clone().sub(car.position).setY(0);
        const behind = off.lengthSq() > 0.01 ? -off.normalize().dot(fwd) : 1;
        // (transição contínua: o salto de 5 para 12 dava um tranco na câmera no meio da curva)
        const rate = 5 + 7 * Math.min(1, Math.max(0, (0.7 - behind) / 0.4));
        this.chasePos.lerp(desired, 1 - Math.exp(-dt * rate));
      }
      // nunca encosta no carro: distância horizontal e altura mínimas (o carro inteiro cabe no
      // terço de baixo da tela, com barbatanas e armas à vista)
      const flatOff = this.chasePos.clone().sub(car.position).setY(0);
      const d = flatOff.length();
      if (d > CHASE_MAX_DIST) {
        flatOff.setLength(CHASE_MAX_DIST);
        this.chasePos.x = car.position.x + flatOff.x;
        this.chasePos.z = car.position.z + flatOff.z;
      } else if (d < CHASE_MIN_DIST) {
        if (d < 0.1) flatOff.copy(fwd).multiplyScalar(-1);
        flatOff.setLength(CHASE_MIN_DIST);
        this.chasePos.x = car.position.x + flatOff.x;
        this.chasePos.z = car.position.z + flatOff.z;
      }
      if (this.chasePos.y < car.position.y + CHASE_MIN_HEIGHT) this.chasePos.y = car.position.y + CHASE_MIN_HEIGHT;
      // rival encostado: sobe rápido para sair do volume dele e desce devagar
      const want = Math.min(1, Math.max(0, this.chaseLift)) * 1.8;
      this.lift += (want - this.lift) * (1 - Math.exp(-dt * (want > this.lift ? 6 : 1.5)));
      this.persp.position.copy(this.chasePos).add(shake);
      this.persp.position.y += this.lift;
      this.persp.lookAt(car.position.clone().addScaledVector(fwd, 16).add(new THREE.Vector3(0, 2.6, 0)));
    }

    // retrovisor (usado no cockpit): olha para trás de cima do teto (o exterior do próprio carro
    // some no cockpit); o plano próximo de 2,5 m corta itens colados na câmera (a "moeda gigante")
    const mirrorPos = new THREE.Vector3(0, 2.1, -0.6).applyQuaternion(car.quaternion).add(car.position);
    this.mirror.position.copy(mirrorPos);
    this.mirror.quaternion.copy(car.quaternion);
    this.mirror.rotateX(-0.08);
    this.first = false;
  }
}
