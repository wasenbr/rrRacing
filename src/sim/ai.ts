import { emptyInput, type ControlInput } from './input';
import { clamp, wrapAngle } from './math';
import { forwardSpeed } from './vehicle';
import { DIFFICULTY, raceDistance, type Racer, type World } from './world';

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
  /** tempo até poder disparar a arma da frente de novo (s) */
  fireCooldown: number;
  /** tempo preso atrás de alguém (s): passado um tempo, parte para a ultrapassagem */
  behindTime: number;
}

export function createAiState(): AiState {
  return { thinkTimer: 0, lane: 0, stuckTime: 0, reverseTime: 0, recoverDir: -1, wantFire: false, wantDrop: false, wantNitro: false, fireCooldown: 0, behindTime: 0 };
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
  const diff = DIFFICULTY[world.difficulty];
  // a dificuldade ajusta o perfil da CPU sem mudar o perfil salvo
  const ai = { ...r.ai!, skill: clamp(r.ai!.skill + diff.skill, 0.3, 0.99), aggression: clamp(r.ai!.aggression * diff.aggression, 0, 1) };
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
  st.fireCooldown = Math.max(0, st.fireCooldown - dt);
  if (st.thinkTimer <= 0) {
    st.thinkTimer = 0.25 + world.rng() * 0.15;
    let lane = ai.lane;
    st.wantFire = false;
    st.wantDrop = false;
    let threatBehind = false;
    let blocked = false;
    let hop = false;
    const front = r.spec.front;
    const range = front === 'missile' ? 45 : front === 'sundog' ? 40 : 30;

    for (const o of world.racers) {
      if (o.id === r.id || !o.alive) continue;
      const oc = trackCoords(world, o.car.x, o.car.z, o.car.pieceIndex);
      const ahead = alongDelta(world, me.dist, oc.dist);
      // desvia de quem está logo à frente, na mesma faixa (ultrapassagem pelo lado mais livre)
      if (ahead > 0 && ahead < 14 && Math.abs(oc.lateral - lane) < 2.4) {
        blocked = true;
        // preso há um tempo: abre mais para o lado e ataca
        const side = st.behindTime > 2 ? 3.8 : 3;
        lane = oc.lateral > 0 ? oc.lateral - side : oc.lateral + side;
        // colado atrás e sem espaço: os jatos de pulo passam por cima
        if (ahead < 6 && Math.abs(oc.lateral - me.lateral) < 1.8 && speed > 12) hop = true;
      }
      // pilotos agressivos "fecham a porta" em quem vem colado atrás...
      if (ahead < -2 && ahead > -12) {
        threatBehind = true;
        if (!blocked && ai.aggression > 0.55 && world.rng() < ai.aggression * 0.5) lane = lane * 0.4 + oc.lateral * 0.6;
      }
      // ...e jogam o carro em cima de quem está emparelhado
      if (Math.abs(ahead) < 3.5 && Math.abs(oc.lateral - me.lateral) < 3.6 && ai.aggression > 0.6 && world.rng() < ai.aggression * 0.6) {
        lane = me.lateral + Math.sign(oc.lateral - me.lateral) * 2;
      }
      // atira em quem está na mira
      if (r.frontCharges > 0 && ahead > 3 && ahead < range) {
        const ang = Math.abs(wrapAngle(Math.atan2(o.car.x - car.x, o.car.z - car.z) - car.heading));
        // como no original, a CPU só atira no que está em linha reta à frente (o sundog persegue sozinho)
        const cone = front === 'missile' ? 0.22 : front === 'sundog' ? 1.2 : 0.12;
        // o sundog só sai com o alvo perto (senão vira "spam" de bolas de fogo)
        const near = front !== 'sundog' || ahead < 25;
        if (near && ang < cone && world.rng() < 0.35 + ai.aggression * 0.6) st.wantFire = true;
      }
      // o sundog persegue para qualquer lado: também vale contra quem vem colado atrás
      if (front === 'sundog' && r.frontCharges > 0 && ahead < -3 && ahead > -18 && world.rng() < ai.aggression * 0.12) st.wantFire = true;
      // solta mina/óleo em quem vem colado atrás
      // (óleo só com o perseguidor bem alinhado e perto: mancha solta a esmo só enche a pista)
      const oil = r.spec.rear === 'oil';
      const spread = r.spec.rear === 'scatter' ? 6 : oil ? 1.5 : 3;
      // óleo só com o perseguidor a 12–25 m: longe o bastante para ele ver a mancha e poder desviar
      if (r.rearCharges > 0 && ahead < (oil ? -12 : -3) && ahead > (oil ? -25 : -16) && Math.abs(oc.lateral - me.lateral) < spread) {
        if (world.rng() < 0.2 + ai.aggression * 0.5) st.wantDrop = true;
      }
    }
    // desvia de minas e óleo (pilotos melhores enxergam mais longe); considera a faixa atual e a desejada
    const see = 16 + ai.skill * 16;
    for (const h of world.hazards) {
      if (h.kind === 'slime' && ai.skill < 0.5) continue;
      const hc = trackCoords(world, h.x, h.z, car.pieceIndex);
      const ahead = alongDelta(world, me.dist, hc.dist);
      if (h.kind === 'puddle' && r.spec.traction === 'hover') continue;
      const r0 = h.kind === 'oil' ? 2.3 : h.kind === 'scatter' ? 1.9 : h.kind === 'mine' ? 2.5 : 3;
      // perigo logo à frente na faixa atual: pula por cima (só minas/óleo; poças fixas não valem o pulo)
      if ((h.kind === 'mine' || h.kind === 'oil' || h.kind === 'scatter') && ahead > 2 && ahead < 4 + speed * 0.3 && Math.abs(hc.lateral - me.lateral) < r0 - 0.4) hop = true;
      if (ahead > 0 && ahead < see && (Math.abs(hc.lateral - lane) < r0 || Math.abs(hc.lateral - me.lateral) < r0)) {
        const left = hc.lateral + r0 + 0.6;
        const right = hc.lateral - r0 - 0.6;
        const lim = track.halfWidth - 1.6;
        lane = Math.abs(left) > lim ? right : Math.abs(right) > lim ? left : Math.abs(left - me.lateral) < Math.abs(right - me.lateral) ? left : right;
      }
    }
    st.lane = clamp(lane, -track.halfWidth + 1.6, track.halfWidth - 1.6);
    st.behindTime = blocked ? st.behindTime + 0.3 : Math.max(0, st.behindTime - 0.6);

    // nitro em reta, se não estiver na frente com folga
    const straight = Math.abs(wrapAngle(track.pointAtDist(me.dist + 40).heading - track.pointAtDist(me.dist).heading)) < 0.15;
    // pulo só com trecho reto durante o voo e longe da mureta: pular perto de curva joga o carro para fora
    const flight = 6 + speed * 1.1;
    const straightJump = Math.abs(wrapAngle(track.pointAtDist(me.dist + flight).heading - track.pointAtDist(me.dist).heading)) < 0.12;
    const safeLane = Math.abs(me.lateral) < track.halfWidth - 2.2;
    if (r.spec.assist === 'jump') st.wantNitro = hop && straightJump && safeLane && world.rng() < 0.4 + ai.skill * 0.5;
    else st.wantNitro = straight && speed > r.spec.maxSpeed * 0.6 && (r.place > 1 || threatBehind) && world.rng() < 0.15 + ai.skill * 0.2;
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
  // no vácuo de quem vai à frente, arrisca mais para passar (corridas menos "em fila")
  if (st.behindTime > 2) targetSpeed *= 1.06;

  // "Elástico" leve em relação ao humano mais adiantado, para a corrida ficar disputada
  const humans = world.racers.filter((o) => !o.ai);
  if (humans.length) {
    const lead = Math.max(...humans.map((h) => raceDistance(world, h)));
    const gap = raceDistance(world, r) - lead;
    // no Fácil/Normal o elástico age antes (50 m): a liderança troca mais de mãos
    const band = world.difficulty === 'hard' ? 80 : 50;
    targetSpeed *= gap > band ? diff.aheadSlow : gap < -band ? diff.behindBoost : 1;
  }

  if (speed < targetSpeed) input.throttle = 1;
  else if (speed > targetSpeed + 4) input.brake = 0.6;

  input.fire = st.wantFire;
  input.drop = st.wantDrop;
  input.nitro = st.wantNitro;
  // o botão precisa "soltar" entre disparos (a simulação usa borda de subida)
  if (r.prevFire || st.fireCooldown > 0) input.fire = false;
  if (r.prevDrop) input.drop = false;
  if (car.prevNitro) input.nitro = false;
  // apontar a direção evita atirar na mureta durante curvas fechadas
  if (bend > 0.6 && r.spec.front === 'laser') input.fire = false;
  // cada decisão vale um disparo só
  if (input.fire) {
    st.wantFire = false;
    st.fireCooldown = r.spec.front === 'sundog' ? 1.5 : r.spec.front === 'missile' ? 0.8 : 0.3;
  }
  if (input.drop) st.wantDrop = false;
  if (input.nitro) st.wantNitro = false;
  return input;
}
