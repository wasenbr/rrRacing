import { clamp, forwardX, forwardZ, leftX, leftZ } from './math';
import type { ControlInput } from './input';
import type { Track } from './track';

/** escala dos carros em relação à pista (o original tem carros pequenos em pistas largas) */
export const CAR_SCALE = 0.8;

export const GRAVITY = 25; // gravidade "arcade": saltos rápidos e secos
const GROUND_SNAP = 0.35;
const STEP_BLOCK = 1.0;

export interface VehicleSpec {
  id: string;
  name: string;
  maxSpeed: number;
  accel: number;
  brake: number;
  reverseMax: number;
  steerRate: number;
  /** aderência lateral: quanto maior, menos o carro derrapa */
  grip: number;
  drag: number;
  nitroAccel: number;
  nitroCharges: number;
  halfWidth: number;
  halfLength: number;
  /** pontos de blindagem */
  armor: number;
  /** massa relativa nas batidas entre carros */
  mass: number;
  front: FrontWeapon;
  frontCharges: number;
  rear: RearWeapon;
  rearCharges: number;
  /** fração máxima de velocidade perdida ao pousar de um salto (suspensão melhor = menos) */
  landingLoss?: number;
  /** 0..1 — resistência a rodar no óleo (suspensão) */
  spinResist?: number;
}

export type FrontWeapon = 'laser' | 'missile';
export type RearWeapon = 'mine' | 'oil';

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  pieceIndex: number;
  /** positivo = bico para cima */
  pitch: number;
  roll: number;
  steer: number;
  wheelSpin: number;
  nitroCharges: number;
  nitroTime: number;
  prevNitro: boolean;
  airTime: number;
  /** intensidade do último pouso (para tremer câmera / som) */
  landingImpact: number;
  /** intensidade da última batida na parede */
  wallImpact: number;
}

export function createVehicleState(spec: VehicleSpec, x: number, z: number, heading: number, y = 0): VehicleState {
  return {
    x,
    y,
    z,
    heading,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    pieceIndex: -1,
    pitch: 0,
    roll: 0,
    steer: 0,
    wheelSpin: 0,
    nitroCharges: spec.nitroCharges,
    nitroTime: 0,
    prevNitro: false,
    airTime: 0,
    landingImpact: 0,
    wallImpact: 0,
  };
}

export function forwardSpeed(v: VehicleState): number {
  return v.vx * forwardX(v.heading) + v.vz * forwardZ(v.heading);
}

/** Um passo de simulação com tempo fixo. Não depende de renderização (roda também num servidor). */
export function stepVehicle(v: VehicleState, spec: VehicleSpec, input: ControlInput, track: Track, dt: number): void {
  const prevX = v.x;
  const prevZ = v.z;

  // Nitro: dispara na borda de subida do botão
  if (input.nitro && !v.prevNitro && v.nitroCharges > 0 && v.nitroTime <= 0) {
    v.nitroCharges--;
    v.nitroTime = 1.3;
  }
  v.prevNitro = input.nitro;
  const boosting = v.nitroTime > 0;
  if (boosting) v.nitroTime = Math.max(0, v.nitroTime - dt);

  v.steer += (input.steer - v.steer) * clamp(dt * 12, 0, 1);
  let vf = forwardSpeed(v);

  if (v.grounded) {
    const speedFactor = clamp(Math.abs(vf) / 6, 0, 1) * (1 - 0.35 * clamp(Math.abs(vf) / spec.maxSpeed, 0, 1));
    v.heading -= v.steer * spec.steerRate * speedFactor * Math.sign(vf || 1) * dt;
  } else {
    v.heading -= v.steer * spec.steerRate * 0.25 * dt;
  }

  const fx = forwardX(v.heading);
  const fz = forwardZ(v.heading);
  const lx = leftX(v.heading);
  const lz = leftZ(v.heading);
  vf = v.vx * fx + v.vz * fz;
  let vl = v.vx * lx + v.vz * lz;

  if (v.grounded) {
    const max = spec.maxSpeed * (boosting ? 1.3 : 1);
    if (input.throttle > 0 && vf < max) {
      const t = clamp(vf / max, 0, 1);
      vf += spec.accel * input.throttle * (1 - t * t) * dt;
    }
    if (boosting) vf = Math.min(vf + spec.nitroAccel * dt, max);
    if (input.brake > 0) {
      if (vf > 0.5) vf -= spec.brake * input.brake * dt;
      else vf = Math.max(vf - spec.accel * 0.6 * input.brake * dt, -spec.reverseMax);
    }
    const coasting = input.throttle === 0 && input.brake === 0;
    vf -= vf * (spec.drag + (coasting ? 0.6 : 0)) * dt;

    // Gravidade ao longo da inclinação: subir rampa custa velocidade
    const ahead = track.query(v.x + fx, v.z + fz, v.pieceIndex).height;
    const behind = track.query(v.x - fx, v.z - fz, v.pieceIndex).height;
    const slope = clamp((ahead - behind) / 2, -1, 1);
    vf -= GRAVITY * slope * 0.35 * dt;

    vl *= Math.exp(-spec.grip * dt);
  }

  v.vx = fx * vf + lx * vl;
  v.vz = fz * vf + lz * vl;
  v.x += v.vx * dt;
  v.z += v.vz * dt;

  let sample = track.query(v.x, v.z, v.pieceIndex);

  // Paredes laterais (guard-rails)
  v.wallImpact = 0;
  const limit = track.halfWidth - spec.halfWidth;
  if (Math.abs(sample.lateral) > limit) {
    const side = Math.sign(sample.lateral);
    const nx = leftX(sample.heading) * side;
    const nz = leftZ(sample.heading) * side;
    const pen = Math.abs(sample.lateral) - limit;
    v.x -= nx * pen;
    v.z -= nz * pen;
    const vn = v.vx * nx + v.vz * nz;
    if (vn > 0) {
      v.vx -= 1.35 * vn * nx;
      v.vz -= 1.35 * vn * nz;
      v.wallImpact = vn;
    }
    v.vx *= 0.985;
    v.vz *= 0.985;
    sample = track.query(v.x, v.z, v.pieceIndex);
  }

  // Chão, rampas e saltos
  const groundH = sample.height;
  v.landingImpact = 0;
  if (v.grounded) {
    if (groundH - v.y > STEP_BLOCK) {
      // degrau alto demais (ex.: dirigir de ré contra a face de um salto): bate e volta
      v.x = prevX;
      v.z = prevZ;
      v.vx *= -0.3;
      v.vz *= -0.3;
      sample = track.query(v.x, v.z, v.pieceIndex);
    } else if (v.y - groundH > GROUND_SNAP) {
      v.grounded = false; // o chão sumiu: decolou mantendo a velocidade vertical
      v.airTime = 0;
    } else {
      v.vy = (groundH - v.y) / dt;
      v.y = groundH;
    }
  }
  if (!v.grounded) {
    v.airTime += dt;
    v.vy -= GRAVITY * dt;
    v.y += v.vy * dt;
    if (v.y <= groundH) {
      v.landingImpact = -v.vy;
      v.y = groundH;
      v.vy = 0;
      v.grounded = true;
      const k = 1 - clamp(v.landingImpact / 60, 0, spec.landingLoss ?? 0.25);
      v.vx *= k;
      v.vz *= k;
    }
  }
  v.pieceIndex = sample.pieceIndex;

  // Atitude visual (não afeta a física)
  const speed = forwardSpeed(v);
  if (v.grounded) {
    const front = track.query(v.x + fx * spec.halfLength, v.z + fz * spec.halfLength, v.pieceIndex).height;
    const back = track.query(v.x - fx * spec.halfLength, v.z - fz * spec.halfLength, v.pieceIndex).height;
    const target = Math.atan2(front - back, spec.halfLength * 2);
    v.pitch += (target - v.pitch) * clamp(dt * 20, 0, 1);
  } else {
    const target = clamp(Math.atan2(v.vy, Math.max(Math.abs(speed), 1)) * 0.6, -0.5, 0.5);
    v.pitch += (target - v.pitch) * clamp(dt * 4, 0, 1);
  }
  const rollTarget = v.grounded ? -v.steer * clamp(Math.abs(speed) / spec.maxSpeed, 0, 1) * 0.07 : 0;
  v.roll += (rollTarget - v.roll) * clamp(dt * 8, 0, 1);
  v.wheelSpin += (speed * dt) / 0.45;
}
