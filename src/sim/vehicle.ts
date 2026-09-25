import { clamp, forwardX, forwardZ, leftX, leftZ, wrapAngle } from './math';
import type { ControlInput } from './input';
import { GAP_MIN_SPEED, JUMP_HEIGHT, TILE, surfaceEffect, WARP_ACCEL, WARP_REVERSE_ACCEL, type Track, type TrackSample } from './track';

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
const SHARP_DRAG = 0.4;
/**
 * No botão derrapar a trajetória é sempre girada para o bico (mesmo de lado), com perda própria por
 * radiano: um grampo de 180° custa ~15% da velocidade (antes ~85%) e fecha a curva na metade do
 * diâmetro da curva comum (avaliadores, rodada 9).
 */
const SHARP_ALIGN_LOSS = 0.08;
/**
 * Derrapagem sem o botão só depois de segurar o esterço forte por este tempo (s): uma curva comum,
 * mesmo com esterço total, não solta a traseira nem freia o carro (itens 38/41).
 */
const DRIFT_HOLD = 0.4;
const DRIFT_HOLD_RAMP = 0.25;
/**
 * Alinhamento da trajetória: a velocidade lateral é girada para o bico (em vez de só amortecida),
 * perdendo esta fração da velocidade por radiano alinhado (~6% numa curva de 90°).
 */
const ALIGN_LOSS = 0.08;
/** Acima deste escorregamento (rad) o carro está de lado (pancada, óleo): volta a só amortecer. */
const ALIGN_ROTATE_MAX = 0.45;
const ALIGN_ROTATE_FADE = 0.5;
/** Rampa do esterço digital (teclado/toque, -1/0/+1): ao aumentar e ao soltar/inverter (por s). */
const STEER_RAMP = 7;
const STEER_RELEASE = 14;

export const GRAVITY = 25; // gravidade "arcade": saltos rápidos e secos
const GROUND_SNAP = 0.35;
/**
 * Salto da rampa J: o carro sai no ângulo da rampa, mais rápido = um pouco mais longe, mas com teto
 * de subida: saltos curtos e secos (pedido do usuário — antes, a 42 m/s o carro voava ~48 m).
 */
const JUMP_RAMP_SLOPE = JUMP_HEIGHT / (0.45 * TILE);
const JUMP_LAUNCH_KICK = 0.8;
/** Teto da velocidade vertical ao sair da rampa (m/s): ~0,7 m acima do lábio e ~32 m de voo a 42 m/s. */
const JUMP_VY_MAX = 6;
/** Abaixo disto (m/s) a rampa J não lança: o carro só desce a borda. */
const JUMP_LAUNCH_MIN_SPEED = 15;
/** Folga de pouso depois do vão (m) e quanto ela cresce por m/s acima de GAP_MIN_SPEED. */
const JUMP_LAND_MARGIN = 1;
const JUMP_LAND_PER_SPEED = 0.25;
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
/**
 * Mureta: abaixo de RAIL_SCRAPE (m/s contra ela) é raspão — quase de graça (só RAIL_RUB, fração por
 * segundo encostado). Acima, perde RAIL_HIT_LOSS por m/s e quica até RAIL_BOUNCE.
 */
const RAIL_SCRAPE = 2;
const RAIL_HIT_LOSS = 0.012;
const RAIL_BOUNCE = 0.3;
const RAIL_RUB = 0.1;
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
  /** tempo (s) com esterço forte seguro para um lado (sinal = lado); ver DRIFT_HOLD */
  steerHold: number;
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
    steerHold: 0,
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
 * "Ímã de pouso" da rampa J: se houver um vão (G) à frente e o carro vier a GAP_MIN_SPEED ou mais,
 * ajusta a velocidade vertical para pousar logo depois do vão (folga de alguns metros, um pouco
 * maior quanto mais rápido). Sem isso, os lentos caíam e os rápidos voavam metade da reta de pouso.
 * Abaixo de GAP_MIN_SPEED não há ajuda: a física natural manda e o carro cai no vão.
 */
function jumpAssist(track: Track, at: TrackSample, y: number, vy: number, speed: number): number {
  if (speed < GAP_MIN_SPEED) return vy;
  const n = track.pieces.length;
  const cur = track.pieces[at.pieceIndex];
  // fim do PRIMEIRO vão à frente, em metros a partir do carro. Numa sequência J G J G o carro
  // pousa na rampa do meio e decola de novo (antes, o vão duplo virava um voo único de 70 m).
  let d = cur.length - at.s;
  let end = cur.code === 'G' ? d : -1;
  let base = track.heightOn(cur, cur.length);
  for (let k = 1; k < 8; k++) {
    const p = track.pieces[(at.pieceIndex + k) % n];
    if (p.code === 'G') {
      end = d + p.length;
      base = track.heightOn(p, 0);
    } else if (p.code !== 'J' || end >= 0) break;
    d += p.length;
  }
  if (end < 0) return vy;
  const y0 = y - base;
  const target = end + JUMP_LAND_MARGIN + (speed - GAP_MIN_SPEED) * JUMP_LAND_PER_SPEED;
  const T = target / speed;
  // (negativa quando o pouso fica bem abaixo, num Gv a toda: o carro sai "mergulhando" em vez de
  // passar 20 m da reta de pouso)
  const w = (GRAVITY * T * T) / 2 - y0;
  return w / T;
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

  const target = input.steer;
  if (target === 0 || Math.abs(target) === 1) {
    // entrada digital: rampa linear (entra progressivo, solta/inverte rápido)
    const release = Math.abs(target) < Math.abs(v.steer) || target * v.steer < 0;
    const rate = (release ? STEER_RELEASE : STEER_RAMP) * dt;
    v.steer += clamp(target - v.steer, -rate, rate);
  } else {
    v.steer += (target - v.steer) * clamp(dt * 20, 0, 1);
  }
  if (target > 0.5) v.steerHold = v.steerHold > 0 ? v.steerHold + dt : dt;
  else if (target < -0.5) v.steerHold = v.steerHold < 0 ? v.steerHold - dt : -dt;
  else v.steerHold = 0;
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
    // Sem o botão, só derrapa segurando o esterço forte por um tempo (curva comum não freia).
    const speedRatio = clamp(Math.abs(vf) / spec.maxSpeed, 0, 1.3);
    const held = clamp((Math.abs(v.steerHold) - DRIFT_HOLD) / DRIFT_HOLD_RAMP, 0, 1);
    const drift = sharp ? Math.max(0.6, Math.abs(v.steer)) : Math.abs(v.steer) * held * clamp((speedRatio - DRIFT_START) / (1 - DRIFT_START), 0, 1);
    const k = Math.exp(-spec.grip * surf.grip * (1 - DRIFT_GRIP_LOSS * drift) * dt);
    const damped = vl * k;
    if (vf > 1) {
      // gira o vetor de velocidade para o bico, conservando quase toda a velocidade
      const beta = Math.atan2(vl, vf);
      const w = sharp ? 1 : clamp(1 - (Math.abs(beta) - ALIGN_ROTATE_MAX) / ALIGN_ROTATE_FADE, 0, 1);
      if (w > 0) {
        const nb = beta * k;
        const loss = sharp ? SHARP_ALIGN_LOSS : ALIGN_LOSS * (1 + drift);
        const sp = Math.hypot(vf, vl) * (1 - loss * Math.abs(beta - nb));
        vf = vf * (1 - w) + sp * Math.cos(nb) * w;
        vl = damped * (1 - w) + sp * Math.sin(nb) * w;
      } else vl = damped;
    } else vl = damped;
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
      // raspão devolve pouco; pancada forte quica e custa velocidade (atrito ~ força da batida)
      const bounce = 1 + RAIL_BOUNCE * clamp((vn - RAIL_SCRAPE) / 10, 0, 1);
      v.vx -= bounce * vn * nx;
      v.vz -= bounce * vn * nz;
      const loss = clamp((vn - RAIL_SCRAPE) * RAIL_HIT_LOSS, 0, 0.3);
      v.vx *= 1 - loss;
      v.vz *= 1 - loss;
      v.wallImpact = vn;
    }
    // raspando na mureta: o bico é puxado de leve para o sentido da pista (desliza em vez de travar)
    const along = Math.abs(wrapAngle(sample.heading - v.heading)) < Math.PI / 2 ? sample.heading : sample.heading + Math.PI;
    v.heading += wrapAngle(along - v.heading) * clamp(dt * 3 + Math.max(0, vn - RAIL_SCRAPE) * 0.006, 0, 0.12);
    const rub = 1 - RAIL_RUB * dt;
    v.vx *= rub;
    v.vz *= rub;
    sample = track.query(v.x, v.z, v.pieceIndex);
  }

  // Chão, rampas e saltos (fora da pista não há chão: o carro cai)
  const outside = Math.abs(sample.lateral) > track.halfWidth + 0.3 || gap;
  const groundH = outside ? -Infinity : sample.height;
  v.landingImpact = 0;
  // decolagem da rampa J: pelo degrau do lábio ou direto para o vão (a 50 m/s o carro anda 0,8 m
  // por passo e pode pular o degrau de 0,4 m entre o lábio e o vão)
  const launchFromJump = (): void => {
    const from = v.pieceIndex >= 0 ? track.pieces[v.pieceIndex] : undefined;
    const launch = forwardSpeed(v);
    if (from?.code === 'J' && launch > JUMP_LAUNCH_MIN_SPEED) {
      v.vy = Math.min(Math.max(v.vy, launch * JUMP_RAMP_SLOPE * JUMP_LAUNCH_KICK), JUMP_VY_MAX);
      v.vy = jumpAssist(track, sample, v.y, v.vy, launch);
    }
  };
  if (outside && v.grounded) {
    v.grounded = false;
    v.airTime = 0;
    if (gap) launchFromJump();
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
      launchFromJump();
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
