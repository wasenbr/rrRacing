import { clamp, forwardX, forwardZ, leftX, leftZ, wrapAngle } from './math';
import type { ControlInput } from './input';
import { JUMP_HEIGHT, TILE, surfaceEffect, WARP_ACCEL, WARP_REVERSE_ACCEL, type Track, type TrackSample } from './track';

/**
 * Escala dos carros em relação à pista. Com 1,0 cabem ~5 carros lado a lado (pista de 11 m),
 * o que força disputa de posição e deixa os carros legíveis na vista aérea.
 */
export const CAR_SCALE = 1.0;

/** A partir desta fração da velocidade máxima, esterçar forte faz a traseira escorregar. */
const DRIFT_START = 0.55;
/** Quanto da aderência lateral some no esterço máximo em velocidade máxima. */
const DRIFT_GRIP_LOSS = 0.5;
/** Curva fechada: multiplica o giro e freia (perde mais que a curva normal, menos que a mureta). */
const SHARP_TURN = 1.9;
const SHARP_DRAG = 1.1;

export const GRAVITY = 25; // gravidade "arcade": saltos rápidos e secos
const GROUND_SNAP = 0.35;
/**
 * Salto da rampa J: o carro sai no ângulo da rampa (com um leve "chute" do lábio), então quanto
 * mais rápido, mais alto e mais longe voa — física de verdade, previsível para o jogador.
 */
const JUMP_RAMP_SLOPE = JUMP_HEIGHT / (0.45 * TILE);
const JUMP_LAUNCH_KICK = 1.15;
/** Abaixo disto (m/s) a rampa J não lança: o carro só desce a borda. */
const JUMP_LAUNCH_MIN_SPEED = 15;
/** Correção máxima do alcance pelo "ímã de pouso" (fração) e folga depois do vão (m). */
const JUMP_ASSIST = 0.3;
const JUMP_LAND_MARGIN = 3;
/**
 * Pulo (Locust Jump Jets): o botão fica "guardado" por um instante, e vale também logo depois de
 * sair do chão (lombada, crista). Antes, apertar num quadro sem contato com o chão não fazia nada.
 */
const JUMP_BUFFER = 0.2;
const JUMP_COYOTE = 0.15;
/** Controle no ar: fração do esterço e quanto a trajetória acompanha o bico. */
const AIR_STEER = 0.45;
const AIR_CARRY = 0.6;
/** Freio-motor ao soltar o acelerador (fração da velocidade por segundo). */
const COAST_DRAG = 0.9;
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
  /** assistência (terceiro botão): turbo ou jatos de pulo. As cargas ficam em `nitroCharges`. */
  assist: Assist;
  /** tração: rodas, esteiras (Battle Trak) ou colchão de ar (Havac) — muda o efeito do terreno */
  traction?: 'wheels' | 'treads' | 'hover';
  /** fração máxima de velocidade perdida ao pousar de um salto (suspensão melhor = menos) */
  landingLoss?: number;
  /** 0..1 — resistência a rodar no óleo (suspensão) */
  spinResist?: number;
}

/**
 * Armas do original. 'laser' = VK Plasma Rifles (bolas de plasma), 'missile' = Rogue Missiles,
 * 'sundog' = Sundog Beams (teleguiado, persegue em qualquer direção, pouco dano).
 */
export type FrontWeapon = 'laser' | 'missile' | 'sundog';
/** 'oil' = BF's Slipsauce, 'mine' = Bear Claw Mines, 'scatter' = KO Scatterpack (leque de minas). */
export type RearWeapon = 'mine' | 'oil' | 'scatter';
/** 'nitro' = Lightning Nitros, 'jump' = Locust Jump Jets. */
export type Assist = 'nitro' | 'jump';

/** Nomes do original, para HUD, loja e locutor. */
export const WEAPON_NAMES: Record<FrontWeapon | RearWeapon | Assist, { name: string; short: string }> = {
  laser: { name: 'VK Plasma Rifles', short: 'Plasma' },
  missile: { name: 'Rogue Missiles', short: 'Mísseis' },
  sundog: { name: 'Sundog Beams', short: 'Sundog' },
  oil: { name: "BF's Slipsauce", short: 'Óleo' },
  mine: { name: 'Bear Claw Mines', short: 'Minas' },
  scatter: { name: 'KO Scatterpack', short: 'Scatter' },
  nitro: { name: 'Lightning Nitros', short: 'Turbo' },
  jump: { name: 'Locust Jump Jets', short: 'Pulo' },
};

/** Máximo de cargas por arma (como no original). */
export const MAX_CHARGES = 7;
/** Velocidade vertical dos jatos de pulo. */
export const JUMP_JET_VY = 11;
/** Empurrão para a frente dos jatos de pulo (m/s). */
const JUMP_JET_PUSH = 4;
/** Altura acima do piso a partir da qual o carro passa por cima da mureta. */
export const RAIL_CLEAR = 2.0;
/** Velocidade lateral (m/s) para fora necessária para passar por cima da mureta. */
const RAIL_OUT_SPEED = 6;
/** Quanto abaixo da pista o carro precisa cair para contar como queda. */
const FALL_DEPTH = 7;

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
  /** tempo restante em que um aperto do pulo ainda vale (ver JUMP_BUFFER) */
  jumpBuffer: number;
  /** o voo atual veio do pulo (não vale o "pulo tardio" de JUMP_COYOTE) */
  jumped: boolean;
  airTime: number;
  /** intensidade do último pouso (para tremer câmera / som) */
  landingImpact: number;
  /** intensidade da última batida na parede */
  wallImpact: number;
  /** 0..1 — quanto o carro está derrapando (para marcas de pneu, fumaça e som) */
  drift: number;
  /** passou por cima da mureta e caiu da pista (o mundo reposiciona o carro) */
  fell: boolean;
  /** true no passo em que a assistência (turbo/pulo) foi acionada */
  assistFired: boolean;
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
    jumpBuffer: 0,
    jumped: false,
    airTime: 0,
    landingImpact: 0,
    wallImpact: 0,
    drift: 0,
    fell: false,
    assistFired: false,
  };
}

/**
 * "Ímã de pouso" da rampa J: prevê onde o voo balístico termina e, se for no vazio de um vão (G),
 * corrige a velocidade vertical para pousar no chão mais próximo — mas só dentro de ±JUMP_ASSIST
 * do alcance natural. Quem chega devagar demais (abaixo de ~GAP_MIN_SPEED) não é salvo e cai; quem
 * vem rápido continua voando mais longe que o lento (a física segue valendo).
 */
function jumpAssist(track: Track, at: TrackSample, y: number, vy: number, speed: number): number {
  const n = track.pieces.length;
  const cur = track.pieces[at.pieceIndex];
  // intervalos de vazio à frente, em metros a partir do carro, até a primeira peça comum
  const voids: [number, number][] = [];
  let d = cur.length - at.s;
  let base = track.heightOn(cur, cur.length);
  if (cur.code === 'G') voids.push([0, d]);
  for (let k = 1; k < 8; k++) {
    const p = track.pieces[(at.pieceIndex + k) % n];
    if (p.code === 'G') {
      voids.push([d, d + p.length]);
      base = track.heightOn(p, 0);
    } else if (p.code !== 'J') break;
    d += p.length;
  }
  if (!voids.length) return vy;
  const y0 = y - base;
  const reach = (w: number) => (speed * (w + Math.sqrt(Math.max(0, w * w + 2 * GRAVITY * y0)))) / GRAVITY;
  const natural = reach(vy);
  const hole = voids.find(([a, b]) => natural > a - 1 && natural < b + JUMP_LAND_MARGIN);
  if (!hole) return vy;
  // alvos: logo depois do vão ou (se houver chão antes dele além da borda) logo antes
  const targets = [hole[1] + JUMP_LAND_MARGIN];
  if (hole[0] - 2 > 4) targets.push(hole[0] - 2);
  let best = vy;
  let bestCost = Infinity;
  for (const target of targets) {
    const ratio = target / natural;
    if (ratio < 1 - JUMP_ASSIST || ratio > 1 + JUMP_ASSIST) continue;
    const T = target / speed;
    const w = (GRAVITY * T * T) / 2 - y0;
    const cost = Math.abs(ratio - 1);
    if (cost < bestCost && w / T > 0) {
      bestCost = cost;
      best = w / T;
    }
  }
  return best;
}

export function forwardSpeed(v: VehicleState): number {
  return v.vx * forwardX(v.heading) + v.vz * forwardZ(v.heading);
}

/** Um passo de simulação com tempo fixo. Não depende de renderização (roda também num servidor). */
export function stepVehicle(v: VehicleState, spec: VehicleSpec, input: ControlInput, track: Track, dt: number): void {
  const prevX = v.x;
  const prevZ = v.z;

  // Assistência na borda de subida do botão: turbo (Lightning Nitros) ou pulo (Locust Jump Jets)
  v.assistFired = false;
  const pressed = input.nitro && !v.prevNitro;
  if (spec.assist === 'jump') {
    if (pressed && v.nitroCharges > 0) v.jumpBuffer = JUMP_BUFFER;
    const canJump = v.grounded || (!v.jumped && v.airTime < JUMP_COYOTE && v.vy < 3);
    if (v.jumpBuffer > 0 && v.nitroCharges > 0 && canJump) {
      v.jumpBuffer = 0;
      v.nitroCharges--;
      v.grounded = false;
      v.jumped = true;
      v.airTime = 0;
      v.vy = Math.max(v.vy, 0) + JUMP_JET_VY;
      // os jatos também dão um empurrão para a frente
      v.vx += forwardX(v.heading) * JUMP_JET_PUSH;
      v.vz += forwardZ(v.heading) * JUMP_JET_PUSH;
      v.assistFired = true;
    }
    v.jumpBuffer = Math.max(0, v.jumpBuffer - dt);
  } else if (pressed && v.nitroCharges > 0) {
    if (v.nitroTime <= 0) {
      v.nitroCharges--;
      v.nitroTime = 1.3;
      v.assistFired = true;
    }
  }
  v.prevNitro = input.nitro;
  const boosting = v.nitroTime > 0;
  if (boosting) v.nitroTime = Math.max(0, v.nitroTime - dt);

  v.steer += (input.steer - v.steer) * clamp(dt * 20, 0, 1);
  let vf = forwardSpeed(v);

  const sharp = !!input.sharp && v.grounded;
  if (v.grounded) {
    const speedFactor = clamp(Math.abs(vf) / 4, 0, 1) * (1 - 0.22 * clamp(Math.abs(vf) / spec.maxSpeed, 0, 1));
    // curva fechada: gira bem mais rápido (dá até para um cavalo-de-pau)
    v.heading -= v.steer * spec.steerRate * (sharp ? SHARP_TURN : 1) * speedFactor * Math.sign(vf || 1) * dt;
  } else {
    // no ar: gira o bico e a trajetória acompanha em parte (dá para corrigir o pouso)
    const dh = -v.steer * spec.steerRate * AIR_STEER * dt;
    v.heading += dh;
    const c = Math.cos(dh * AIR_CARRY);
    const sn = Math.sin(dh * AIR_CARRY);
    const vx = v.vx;
    v.vx = vx * c + v.vz * sn;
    v.vz = -vx * sn + v.vz * c;
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
      // curva de torque "arcade": empurra forte até perto da máxima (carro leve e responsivo)
      const t = clamp(vf / max, 0, 1);
      vf += spec.accel * input.throttle * (1 - t * t * t * t) * dt;
    }
    if (boosting) vf = Math.min(vf + spec.nitroAccel * dt, max);
    if (input.brake > 0) {
      if (vf > 0.5) vf -= spec.brake * input.brake * dt;
      else vf = Math.max(vf - spec.accel * 0.6 * input.brake * dt, -spec.reverseMax);
    }
    const coasting = input.throttle === 0 && input.brake === 0;
    const surf = surfaceEffect(track.surface, spec.id); // lama/gelo (pistas)
    vf -= vf * (spec.drag + surf.drag + (coasting ? COAST_DRAG : 0) + (sharp ? SHARP_DRAG : 0)) * dt;

    // Gravidade ao longo da inclinação: subir rampa custa velocidade
    const ahead = track.query(v.x + fx, v.z + fz, v.pieceIndex).height;
    const behind = track.query(v.x - fx, v.z - fz, v.pieceIndex).height;
    const slope = clamp((ahead - behind) / 2, -1, 1);
    vf -= GRAVITY * slope * 0.35 * dt;

    // Derrapagem controlável: esterço forte em alta velocidade solta a traseira e o carro gira
    // um pouco mais — dá para "jogar" o carro na curva sem perder o controle.
    const speedRatio = clamp(Math.abs(vf) / spec.maxSpeed, 0, 1.3);
    const drift = sharp ? Math.max(0.6, Math.abs(v.steer)) : Math.abs(v.steer) * clamp((speedRatio - DRIFT_START) / (1 - DRIFT_START), 0, 1);
    vl *= Math.exp(-spec.grip * surf.grip * (1 - DRIFT_GRIP_LOSS * drift) * dt);
    v.heading -= v.steer * spec.steerRate * 0.18 * drift * dt;
    v.drift = drift;
  } else {
    v.drift = 0;
  }

  v.vx = fx * vf + lx * vl;
  v.vz = fz * vf + lz * vl;
  v.x += v.vx * dt;
  v.z += v.vz * dt;

  let sample = track.query(v.x, v.z, v.pieceIndex);

  // Paredes laterais (guard-rails)
  v.wallImpact = 0;
  const limit = track.halfWidth - spec.halfWidth;
  // alto o bastante (salto, pulo, pancada), o carro passa por cima da mureta e pode cair da pista
  // (precisa estar alto E indo para fora com força: raspar a mureta num salto não derruba)
  const outward = (v.vx * leftX(sample.heading) + v.vz * leftZ(sample.heading)) * Math.sign(sample.lateral);
  const overRail = !v.grounded && v.y - sample.height > RAIL_CLEAR && outward > RAIL_OUT_SPEED;
  // vão (G): nunca tem chão; quem decola da J rápido o bastante é ajudado a pousar (ver jumpAssist)
  const gap = sample.void;
  const offTrack = Math.abs(sample.lateral) > track.halfWidth + 0.3 || gap;
  if (Math.abs(sample.lateral) > limit && !overRail && !offTrack) {
    const side = Math.sign(sample.lateral);
    const nx = leftX(sample.heading) * side;
    const nz = leftZ(sample.heading) * side;
    const pen = Math.abs(sample.lateral) - limit;
    v.x -= nx * pen;
    v.z -= nz * pen;
    const vn = v.vx * nx + v.vz * nz;
    if (vn > 0) {
      v.vx -= 1.3 * vn * nx;
      v.vz -= 1.3 * vn * nz;
      v.wallImpact = vn;
    }
    // raspando na mureta: o bico é puxado para o sentido da pista (desliza em vez de travar)
    const along = Math.abs(wrapAngle(sample.heading - v.heading)) < Math.PI / 2 ? sample.heading : sample.heading + Math.PI;
    v.heading += wrapAngle(along - v.heading) * clamp(dt * 6 + vn * 0.01, 0, 0.25);
    v.vx *= 0.99;
    v.vz *= 0.99;
    sample = track.query(v.x, v.z, v.pieceIndex);
  }

  // Chão, rampas e saltos (fora da pista não há chão: o carro cai)
  const outside = Math.abs(sample.lateral) > track.halfWidth + 0.3 || gap;
  const groundH = outside ? -Infinity : sample.height;
  v.landingImpact = 0;
  if (outside && v.grounded) {
    v.grounded = false;
    v.airTime = 0;
  }
  if (outside && v.y < sample.height - FALL_DEPTH) v.fell = true;
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
      const from = v.pieceIndex >= 0 ? track.pieces[v.pieceIndex] : undefined;
      const launch = forwardSpeed(v);
      if (from?.code === 'J' && launch > JUMP_LAUNCH_MIN_SPEED) {
        v.vy = Math.max(v.vy, launch * JUMP_RAMP_SLOPE * JUMP_LAUNCH_KICK);
        v.vy = jumpAssist(track, sample, v.y, v.vy, launch);
      }
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
      // pouso: só a parte forte do impacto custa velocidade (um salto normal perde pouco)
      const k = 1 - clamp((v.landingImpact - 13) / 80, 0, spec.landingLoss ?? 0.25);
      v.jumped = false;
      v.vx *= k;
      v.vz *= k;
    }
  }
  v.pieceIndex = sample.pieceIndex;
  // seta de warp (pistas): empurra na direção da pista (o reverso arremessa para trás)
  if (v.grounded && sample.warp !== 0) {
    const a = sample.warp > 0 ? WARP_ACCEL : -WARP_REVERSE_ACCEL;
    v.vx += forwardX(sample.heading) * a * dt;
    v.vz += forwardZ(sample.heading) * a * dt;
    const cap = spec.maxSpeed * 1.45;
    const sp = Math.hypot(v.vx, v.vz);
    if (sp > cap) {
      v.vx *= cap / sp;
      v.vz *= cap / sp;
    }
  }

  // Atitude visual (não afeta a física)
  const speed = forwardSpeed(v);
  if (v.grounded) {
    const front = track.query(v.x + fx * spec.halfLength, v.z + fz * spec.halfLength, v.pieceIndex).height;
    const back = track.query(v.x - fx * spec.halfLength, v.z - fz * spec.halfLength, v.pieceIndex).height;
    const target = Math.atan2(front - back, spec.halfLength * 2);
    v.pitch += (target - v.pitch) * clamp(dt * 14, 0, 1);
  } else {
    // no ar o bico acompanha a trajetória de leve (sobe na decolagem, desce antes do pouso)
    const target = clamp(Math.atan2(v.vy, Math.max(Math.abs(speed), 8)) * 0.45, -0.3, 0.3);
    v.pitch += (target - v.pitch) * clamp(dt * 3, 0, 1);
  }
  const rollTarget = v.grounded ? -v.steer * clamp(Math.abs(speed) / spec.maxSpeed, 0, 1) * 0.07 : 0;
  v.roll += (rollTarget - v.roll) * clamp(dt * 8, 0, 1);
  v.wheelSpin += (speed * dt) / 0.45;
}
