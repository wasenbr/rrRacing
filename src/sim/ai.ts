import { emptyInput, type ControlInput } from './input';
import { clamp, wrapAngle } from './math';
import { forwardSpeed } from './vehicle';
import { raceDistance, type Racer, type World } from './world';

/** Personalidade de um piloto da CPU. */
export interface AiProfile {
  /** 0..1 — quão perto do limite do carro ele pilota */
  skill: number;
  /** 0..1 — vontade de usar armas */
  aggression: number;
  /** faixa preferida (metros a partir do centro, positivo = esquerda) */
  lane: number;
}

export interface AiState {
  thinkTimer: number;
  lane: number;
  stuckTime: number;
  reverseTime: number;
  /** +1 = sai de frente, -1 = sai de ré */
  recoverDir: number;
  wantFire: boolean;
  wantDrop: boolean;
  wantNitro: boolean;
}

export function createAiState(): AiState {
  return { thinkTimer: 0, lane: 0, stuckTime: 0, reverseTime: 0, recoverDir: -1, wantFire: false, wantDrop: false, wantNitro: false };
}

/** Posição de um ponto em coordenadas da pista: distância ao longo dela e deslocamento lateral. */
function trackCoords(world: World, x: number, z: number, hint: number) {
  const q = world.track.query(x, z, hint);
  return { dist: q.dist, lateral: q.lateral };
}

/** Diferença de distância ao longo da pista, considerando a volta (-T/2..T/2). */
function alongDelta(world: World, from: number, to: number): number {
  const T = world.track.totalLength;
  let d = (to - from) % T;
  if (d > T / 2) d -= T;
  if (d < -T / 2) d += T;
  return d;
}

export function computeAiInput(world: World, r: Racer, dt: number): ControlInput {
  const track = world.track;
  const car = r.car;
  const ai = r.ai!;
  const st = r.aiState;
  const input = emptyInput();
  const speed = forwardSpeed(car);
  const me = trackCoords(world, car.x, car.z, car.pieceIndex);

  // Preso ou virado de lado: manobra até alinhar com a pista. Se o bico aponta para o meio
  // da pista, sai de frente; se aponta para a mureta, sai de ré.
  const tangent = track.pointAtDist(me.dist).heading;
  const err = wrapAngle(tangent - car.heading);
  if (st.reverseTime > 0) {
    st.reverseTime -= dt;
    if (Math.abs(err) < 0.35 && st.reverseTime < 1.6) st.reverseTime = 0;
    if (st.recoverDir > 0) {
      input.throttle = 0.7;
      input.steer = clamp(-err * 3, -1, 1);
    } else {
      input.brake = 1;
      input.steer = clamp(err * 3, -1, 1);
    }
    return input;
  }
  if (r.spinTime > 0) return input; // rodando no óleo: nada a fazer
  if (Math.abs(speed) < 2.5) st.stuckTime += dt;
  else st.stuckTime = 0;
  if (st.stuckTime > 0.8 || (Math.abs(err) > 1.6 && Math.abs(speed) < 6)) {
    st.stuckTime = 0;
    st.reverseTime = 2.2;
    // o bico aponta para o centro da pista?
    const noseLateral = Math.sin(car.heading - tangent);
    const towardCenter = Math.abs(me.lateral) < 1.5 ? Math.abs(err) < Math.PI / 2 : Math.sign(noseLateral) === -Math.sign(me.lateral);
    st.recoverDir = towardCenter ? 1 : -1;
  }

  // "Pensa" algumas vezes por segundo: escolhe faixa, decide armas
  st.thinkTimer -= dt;
  if (st.thinkTimer <= 0) {
    st.thinkTimer = 0.25 + world.rng() * 0.15;
    let lane = ai.lane;
    st.wantFire = false;
    st.wantDrop = false;

    for (const o of world.racers) {
      if (o.id === r.id || !o.alive) continue;
      const oc = trackCoords(world, o.car.x, o.car.z, o.car.pieceIndex);
      const ahead = alongDelta(world, me.dist, oc.dist);
      // desvia de quem está logo à frente, na mesma faixa
      if (ahead > 0 && ahead < 14 && Math.abs(oc.lateral - lane) < 2.2) lane = oc.lateral > 0 ? oc.lateral - 3 : oc.lateral + 3;
      // atira em quem está na mira
      if (r.frontCharges > 0 && ahead > 3 && ahead < (r.spec.front === 'missile' ? 45 : 30)) {
        const ang = Math.abs(wrapAngle(Math.atan2(o.car.x - car.x, o.car.z - car.z) - car.heading));
        const cone = r.spec.front === 'missile' ? 0.45 : 0.12;
        if (ang < cone && world.rng() < 0.35 + ai.aggression * 0.6) st.wantFire = true;
      }
      // solta mina/óleo em quem vem colado atrás
      if (r.rearCharges > 0 && ahead < -3 && ahead > -16 && Math.abs(oc.lateral - me.lateral) < 3) {
        if (world.rng() < 0.2 + ai.aggression * 0.5) st.wantDrop = true;
      }
    }
    // desvia de minas e óleo
    for (const h of world.hazards) {
      const hc = trackCoords(world, h.x, h.z, car.pieceIndex);
      const ahead = alongDelta(world, me.dist, hc.dist);
      if (ahead > 0 && ahead < 22 && Math.abs(hc.lateral - lane) < 2.6) lane = hc.lateral > 0 ? hc.lateral - 3.2 : hc.lateral + 3.2;
    }
    st.lane = clamp(lane, -track.halfWidth + 1.6, track.halfWidth - 1.6);

    // nitro em reta, se não estiver na frente com folga
    const straight = Math.abs(wrapAngle(track.pointAtDist(me.dist + 40).heading - track.pointAtDist(me.dist).heading)) < 0.15;
    st.wantNitro = straight && speed > r.spec.maxSpeed * 0.6 && r.place > 1 && world.rng() < 0.15 + ai.skill * 0.2;
  }

  // Direção: mira num ponto à frente na faixa escolhida
  const look = 7 + Math.max(0, speed) * 0.35;
  const target = track.pointAtDist(me.dist + look);
  const tx = target.x + Math.cos(target.heading) * st.lane;
  const tz = target.z - Math.sin(target.heading) * st.lane;
  const desired = Math.atan2(tx - car.x, tz - car.z);
  input.steer = clamp(-wrapAngle(desired - car.heading) * 2.6, -1, 1);

  // Velocidade: reduz antes das curvas
  const now = track.pointAtDist(me.dist).heading;
  const later = track.pointAtDist(me.dist + 10 + Math.max(0, speed) * 0.5).heading;
  const bend = Math.abs(wrapAngle(later - now));
  let targetSpeed = r.spec.maxSpeed * (0.72 + ai.skill * 0.28) * (1 - 0.42 * clamp(bend / (Math.PI / 2), 0, 1));

  // "Elástico" leve em relação ao humano mais adiantado, para a corrida ficar disputada
  const humans = world.racers.filter((o) => !o.ai);
  if (humans.length) {
    const lead = Math.max(...humans.map((h) => raceDistance(world, h)));
    const gap = raceDistance(world, r) - lead;
    targetSpeed *= gap > 80 ? 0.9 : gap < -80 ? 1.08 : 1;
  }

  if (speed < targetSpeed) input.throttle = 1;
  else if (speed > targetSpeed + 4) input.brake = 0.6;

  input.fire = st.wantFire;
  input.drop = st.wantDrop;
  input.nitro = st.wantNitro;
  // o botão precisa "soltar" entre disparos (a simulação usa borda de subida)
  if (r.prevFire) input.fire = false;
  if (r.prevDrop) input.drop = false;
  if (car.prevNitro) input.nitro = false;
  // apontar a direção evita atirar na mureta durante curvas fechadas
  if (bend > 0.6 && r.spec.front === 'laser') input.fire = false;
  // cada decisão vale um disparo só
  if (input.fire) st.wantFire = false;
  if (input.drop) st.wantDrop = false;
  if (input.nitro) st.wantNitro = false;
  return input;
}
