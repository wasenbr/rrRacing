import { emptyInput, type ControlInput } from './input';
import { clamp, wrapAngle } from './math';
import { forwardSpeed } from './vehicle';
import { DIFFICULTY, DRAFT_SPEED, draftFactor, raceDistance, WEAPONS, type Hazard, type Racer, type World } from './world';

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

/** Distância (m) entre líder e 2º em que há disputa pela ponta (DUEL_MIN..DUEL_GAP). */
const DUEL_GAP = 40;
/** A CPU usa o DERRAPAR com a curva à frente acima deste ângulo (rad) e acima desta fração da final. */
const AI_SHARP_BEND = 0.9;
const AI_SHARP_SPEED = 0.55;
/**
 * Ritmo da CPU. `basePace`: fração da final com habilidade 0 (com 1, a final inteira); `cornerSkill`:
 * quanto a habilidade baixa tira da velocidade de curva; `cornerCut`: quanto do giro o carro de fato usa
 * na curva (corta por dentro); `cornerGrip`: desconto da aderência baixa (grip / (grip + cornerGrip)).
 */
export const AI_TUNING = { basePace: 0.8, cornerSkill: 0.2, cornerCut: 1.6, cornerGrip: 2 };
/** Janela (m) em que se mede a curvatura da pista à frente e até onde a CPU olha para frear. */
const CORNER_WINDOW = 12;
const CORNER_STEP = 3;
/** Fração do freio com que a CPU conta ao planejar a frenagem (freia tarde). */
const CORNER_BRAKE = 0.85;

/**
 * Velocidade máxima (m/s) com que dá para entrar nas curvas dos próximos metros: em cada ponto à frente,
 * a curvatura da pista (giro na janela / comprimento) contra o giro do carro nessa velocidade (o mesmo
 * de stepVehicle: steerRate × (1 − 0,22 v/final), vezes o DERRAPAR), descontada a aderência; e quanto
 * dá para frear até lá.
 */
function cornerSpeed(world: World, r: Racer, dist: number, speed: number): number {
  const track = world.track;
  const spec = r.spec;
  const turn = spec.steerRate * SHARP_TURN_AI * AI_TUNING.cornerCut * (spec.grip / (spec.grip + AI_TUNING.cornerGrip));
  const decel = spec.brake * CORNER_BRAKE;
  const horizon = 6 + (speed * speed) / (2 * decel);
  let best = Infinity;
  let h0 = track.pointAtDist(dist).heading;
  for (let x = 0; x <= horizon; x += CORNER_STEP) {
    const h1 = track.pointAtDist(dist + x + CORNER_WINDOW).heading;
    const k = Math.abs(wrapAngle(h1 - (x === 0 ? h0 : (h0 = track.pointAtDist(dist + x).heading)))) / CORNER_WINDOW;
    if (k < 0.02) continue;
    // v·k = turn·(1 − 0,22 v/final)  →  v = turn / (k + 0,22·turn/final)
    const vc = turn / (k + (0.22 * turn) / spec.maxSpeed);
    best = Math.min(best, Math.sqrt(vc * vc + 2 * decel * x));
  }
  return best;
}
/** Giro a mais do DERRAPAR (SHARP_TURN em vehicle.ts). */
const SHARP_TURN_AI = 1.9;
const DUEL_MIN = 4;

/**
 * Faixa para passar quem está à frente (lateral `lat`): pelo lado com mais pista; atacando (`free`),
 * pelo lado em que ninguém mais ocupa a faixa nos próximos metros.
 */
function passLane(world: World, r: Racer, dist: number, lat: number, side: number, free: boolean): number {
  const lim = world.track.halfWidth - 1.6;
  const a = clamp(lat - side, -lim, lim);
  const b = clamp(lat + side, -lim, lim);
  // quanto de carro cabe de cada lado
  const roomA = lat - -lim;
  const roomB = lim - lat;
  let pick = roomA >= roomB ? a : b;
  if (free) {
    const busy = (c: number) =>
      world.racers.some((o) => {
        if (o.id === r.id || !o.alive || o.finishPlace) return false;
        const oc = trackCoords(world, o.car.x, o.car.z, o.car.pieceIndex);
        const ahead = alongDelta(world, dist, oc.dist);
        return ahead > -3 && ahead < 16 && Math.abs(oc.lateral - c) < 2;
      });
    const other = pick === a ? b : a;
    const roomOther = pick === a ? roomB : roomA;
    if (busy(pick) && !busy(other) && roomOther > 1.5) pick = other;
  }
  return pick;
}

/** Líder (da CPU) com alguém colado atrás, ou o 2º colado no líder; entre quem ainda corre. */
function leaderDuel(world: World, r: Racer): 'leader' | 'chaser' | null {
  const place = r.place - world.finishedCount;
  if (place > 2 || r.finishPlace) return null;
  const other = world.racers.find((o) => o.place === (place === 1 ? r.place + 1 : r.place - 1));
  // só entre CPUs: a dificuldade contra o jogador continua a cargo do elástico
  if (!other || !other.ai || other.finishPlace || !other.alive) return null;
  const gap = Math.abs(raceDistance(world, r) - raceDistance(world, other));
  // lado a lado (< DUEL_MIN) ninguém ganha nem perde: sem isso a ponta trocava a cada quadro
  if (gap >= DUEL_GAP || gap < DUEL_MIN) return null;
  return place === 1 ? 'leader' : 'chaser';
}

/** Raio de perigo de cada obstáculo para a CPU (raio de acerto + folga para o carro). */
function hazardRadius(kind: Hazard['kind']): number {
  switch (kind) {
    case 'mine':
      return WEAPONS.mine.radius + 0.8;
    case 'scatter':
      // (folga menor: entre duas minas do leque cabe um carro passando bem no meio)
      return WEAPONS.scatter.radius + 0.6;
    case 'oil':
      return WEAPONS.oil.radius + 0.8;
    default:
      return WEAPONS[kind].radius + 0.6;
  }
}

/**
 * Tempo de reação da CPU a uma arma recém-solta (s): antes disso ela não "viu" a mina/óleo que caiu
 * logo à frente (rodada 11: é o que decide se o perseguidor visado leva a mina — ~1/3 das vezes).
 */
export const AI_REACTION = { base: 0.5, skill: 0.3 };
function noticed(h: Hazard, skill: number): boolean {
  if (h.kind !== 'mine' && h.kind !== 'scatter' && h.kind !== 'oil') return true;
  return h.age >= AI_REACTION.base - AI_REACTION.skill * skill;
}

/** Onde a CPU mira (ponto à frente na faixa): a mesma conta da direção, em `computeAiInput`. */
function aimLook(speed: number): number {
  return 7 + Math.max(0, speed) * 0.35;
}

/**
 * Distância de mira para a direção: a normal (`aimLook`) ou, com mina/scatter/óleo logo à frente perto
 * da trajetória, mais curta (até o obstáculo): mirando longe o carro demora a sair de lado e passava
 * por cima do que tinha "desviado" (rodada 10).
 */
function steerLook(world: World, r: Racer, me: { dist: number; lateral: number }, speed: number): number {
  const look = aimLook(speed);
  let threat = look;
  for (const h of world.hazards) {
    if (h.kind !== 'mine' && h.kind !== 'scatter' && h.kind !== 'oil') continue;
    if (!noticed(h, r.ai?.skill ?? 1)) continue;
    const hc = trackCoords(world, h.x, h.z, r.car.pieceIndex);
    const ahead = alongDelta(world, me.dist, hc.dist);
    if (ahead > 2 && ahead < threat && Math.abs(hc.lateral - me.lateral) < hazardRadius(h.kind) + 2.5) threat = ahead;
  }
  return clamp(threat * 1.1, Math.min(look, 9), look);
}

/**
 * Escolhe a faixa mais perto da desejada que passa livre de todos os obstáculos à frente (até `see` m).
 * Varre as faixas possíveis (em vez de desviar de um obstáculo por vez, que num leque de scatter jogava o
 * carro em cima da mina vizinha). Até o ponto de mira o carro anda na reta entre ele e esse ponto (nas
 * curvas ele corta por dentro, fora da faixa): o teste usa essa reta, não só a faixa. Obstáculos mais
 * perto pesam mais; sem saída livre, fica com a menos ruim.
 */
function avoidHazards(world: World, r: Racer, me: { dist: number; lateral: number }, lane: number, see: number, skill: number, look: number, prev: number): number {
  const track = world.track;
  const car = r.car;
  const lim = track.halfWidth - 1.6;
  const near: { x: number; z: number; lat: number; ahead: number; rad: number; w: number }[] = [];
  for (const h of world.hazards) {
    if (h.kind === 'slime' && skill < 0.5) continue;
    if (h.kind === 'puddle' && r.spec.traction === 'hover') continue;
    if (!noticed(h, skill)) continue;
    const hc = trackCoords(world, h.x, h.z, car.pieceIndex);
    const ahead = alongDelta(world, me.dist, hc.dist);
    if (ahead <= 0 || ahead > see) continue;
    // poças fixas: evita quando der; as armas (minas, scatter, óleo) pesam muito mais
    const weapon = h.kind === 'mine' || h.kind === 'scatter' || h.kind === 'oil';
    near.push({ x: h.x, z: h.z, lat: hc.lateral, ahead, rad: hazardRadius(h.kind), w: (weapon ? 3 : 1) * (1 + (see - ahead) / see) });
  }
  if (!near.length) return lane;
  const aim = track.pointAtDist(me.dist + look);
  const lx = Math.cos(aim.heading);
  const lz = -Math.sin(aim.heading);
  const cost = (c: number) => {
    const tx = aim.x + lx * c - car.x;
    const tz = aim.z + lz * c - car.z;
    const len2 = tx * tx + tz * tz || 1;
    let k = 0;
    for (const n of near) {
      let d: number;
      if (n.ahead < look) {
        // distância do obstáculo à reta carro → ponto de mira
        const px = n.x - car.x;
        const pz = n.z - car.z;
        const u = clamp((px * tx + pz * tz) / len2, 0, 1);
        d = Math.hypot(px - tx * u, pz - tz * u);
      } else d = Math.abs(c - n.lat);
      if (d < n.rad) k += n.w * (1 + (n.rad - d));
    }
    return k;
  };
  const want = clamp(lane, -lim, lim);
  if (cost(want) === 0) return lane;
  let best = want;
  let bestCost = Infinity;
  for (let c = -lim; c <= lim + 1e-6; c += 0.25) {
    // perto da faixa desejada e da atual: menos esterço e menos risco de bater em outro carro
    // (e perto da escolhida antes: sem trocar de lado a cada quadro)
    const k = cost(c) * 10 + Math.abs(c - want) * 0.6 + Math.abs(c - me.lateral) * 0.4 + Math.abs(c - prev) * 0.5;
    if (k < bestCost) {
      bestCost = k;
      best = c;
    }
  }
  return best;
}

export function computeAiInput(world: World, r: Racer, dt: number): ControlInput {
  // desvios (bifurcação): cada CPU segue o ramo em que está; na chegada, o ramo alterna por carro e por volta
  return world.track.withRoute(r.car.pieceIndex, (b) => (r.id + b + r.progress.lap) % 2 === 1, () => computeAiInputOnRoute(world, r, dt));
}

function computeAiInputOnRoute(world: World, r: Racer, dt: number): ControlInput {
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
    // Munição dosada ao longo da volta (recarrega na volta, como no original): até ~15% da volta
    // pode gastar 1 carga, na metade ~55% delas, a última só no fim; na última volta solta mais cedo.
    const T = track.totalLength;
    const lapFrac = clamp((raceDistance(world, r) - (r.progress.lap - 1) * T) / T, 0, 1);
    const slack = r.progress.lap >= world.laps ? 0.35 : 0.1;
    const canUse = (charges: number, max: number, extra = 0) => max - charges < Math.ceil(max * (lapFrac * 0.9 + slack + extra));
    // o plasma tem cargas de sobra (5, e recarrega na volta): gasta sem economizar tanto
    const frontOk = canUse(r.frontCharges, r.spec.frontCharges, r.spec.front === 'laser' ? 0.3 : 0);
    const rearOk = canUse(r.rearCharges, r.spec.rearCharges);
    let lane = ai.lane;
    st.wantFire = false;
    st.wantDrop = false;
    let threatBehind = false;
    let blocked = false;
    let hop = false;
    const front = r.spec.front;
    const range = front === 'missile' ? 45 : front === 'sundog' ? 40 : 42;

    for (const o of world.racers) {
      // quem já terminou está parado e fantasma: não é alvo nem obstáculo
      if (o.id === r.id || !o.alive || o.finishPlace) continue;
      const oc = trackCoords(world, o.car.x, o.car.z, o.car.pieceIndex);
      const ahead = alongDelta(world, me.dist, oc.dist);
      // desvia de quem está logo à frente, na mesma faixa (ultrapassagem pelo lado mais livre)
      if (ahead > 0 && ahead < 14 && Math.abs(oc.lateral - lane) < 2.4) {
        blocked = true;
        // preso há mais de 1 s: sai de lado para a faixa livre e ataca (ultrapassagem de verdade, no
        // lugar do "duelo" roteirizado de antes — rodada 11)
        const side = st.behindTime > 1 ? 3.8 : 3;
        lane = passLane(world, r, me.dist, oc.lateral, side, st.behindTime > 1);
        // colado atrás e sem espaço: os jatos de pulo passam por cima
        if (ahead < 6 && Math.abs(oc.lateral - me.lateral) < 1.8 && speed > 12) hop = true;
      }
      // pilotos agressivos "fecham a porta" em quem vem colado atrás...
      if (ahead < -2 && ahead > -12) {
        threatBehind = true;
        // (o líder não fecha a porta para outra CPU: senão a ponta quase nunca troca de mãos)
        const leaderVsCpu = o.ai && r.place - world.finishedCount === 1;
        if (!blocked && !leaderVsCpu && ai.aggression > 0.55 && world.rng() < ai.aggression * 0.5) lane = lane * 0.4 + oc.lateral * 0.6;
        // o líder defende a faixa de leve: fica na frente de quem vem colado (que então usa o vácuo e
        // sai de lado para passar — rodada 10)
        else if (!blocked && leaderVsCpu && ahead > -10 && world.rng() < 0.35) lane = lane * 0.5 + oc.lateral * 0.5;
      }
      // ...e jogam o carro em cima de quem está emparelhado
      if (Math.abs(ahead) < 3.5 && Math.abs(oc.lateral - me.lateral) < 3.6 && ai.aggression > 0.6 && world.rng() < ai.aggression * 0.6) {
        lane = me.lateral + Math.sign(oc.lateral - me.lateral) * 2;
      }
      // atira em quem está na mira
      if (frontOk && r.frontCharges > 0 && ahead > 3 && ahead < range) {
        const ang = Math.abs(wrapAngle(Math.atan2(o.car.x - car.x, o.car.z - car.z) - car.heading));
        // como no original, a CPU só atira no que está em linha reta à frente (o sundog persegue sozinho)
        // (plasma: de perto, mira o carro inteiro — cerca de 2 m para cada lado)
        const cone = front === 'missile' ? 0.5 : front === 'sundog' ? 1.2 : Math.max(0.17, Math.atan2(2, ahead));
        // o sundog só sai com o alvo perto (senão vira "spam" de bolas de fogo)
        const near = front !== 'sundog' || ahead < 25;
        if (near && ang < cone && world.rng() < 0.35 + ai.aggression * 0.6) st.wantFire = true;
      }
      // o sundog persegue para qualquer lado: também vale contra quem vem colado atrás
      if (front === 'sundog' && frontOk && r.frontCharges > 0 && ahead < -3 && ahead > -18 && world.rng() < ai.aggression * 0.12) st.wantFire = true;
      // solta mina/óleo em quem vem colado atrás
      // (óleo só com o perseguidor bem alinhado e perto: mancha solta a esmo só enche a pista)
      const oil = r.spec.rear === 'oil';
      // (mina só com ele na mesma linha — rodada 11: com 3 m de folga ela caía fora do caminho dele)
      const spread = r.spec.rear === 'scatter' ? 6 : oil ? 1.5 : 1.4;
      // óleo só com o perseguidor a 12–25 m: longe o bastante para ele ver a mancha e poder desviar;
      // minas/scatter com ele a 8–16 m (antes 3–16: colado, não havia como desviar — rodada 10)
      if (rearOk && r.rearCharges > 0 && ahead < (oil ? -12 : -8) && ahead > (oil ? -25 : -16) && Math.abs(oc.lateral - me.lateral) < spread) {
        if (world.rng() < 0.2 + ai.aggression * 0.5) st.wantDrop = true;
      }
    }
    // desvia de minas e óleo (pilotos melhores enxergam mais longe; rodada 11: a mina arma em 0,2 s,
    // então o desvio começa bem antes — ~1 s à frente)
    const see = Math.max(20 + ai.skill * 18, speed * (0.8 + ai.skill * 0.5));
    for (const h of world.hazards) {
      if (h.kind !== 'mine' && h.kind !== 'oil' && h.kind !== 'scatter') continue;
      if (!noticed(h, ai.skill)) continue;
      const hc = trackCoords(world, h.x, h.z, car.pieceIndex);
      const ahead = alongDelta(world, me.dist, hc.dist);
      // perigo logo à frente na faixa atual: pula por cima (só minas/óleo; poças fixas não valem o pulo)
      if (ahead > 2 && ahead < 4 + speed * 0.3 && Math.abs(hc.lateral - me.lateral) < hazardRadius(h.kind)) hop = true;
    }
    lane = avoidHazards(world, r, me, lane, see, ai.skill, steerLook(world, r, me, speed), st.lane);
    st.lane = clamp(lane, -track.halfWidth + 1.6, track.halfWidth - 1.6);
    st.behindTime = blocked ? st.behindTime + 0.3 : Math.max(0, st.behindTime - 0.6);

    // nitro em reta, se não estiver na frente com folga
    const straight = Math.abs(wrapAngle(track.pointAtDist(me.dist + 40).heading - track.pointAtDist(me.dist).heading)) < 0.15;
    // pulo só com trecho reto durante o voo e longe da mureta: pular perto de curva joga o carro para fora
    const flight = 6 + speed * 1.1;
    const straightJump = Math.abs(wrapAngle(track.pointAtDist(me.dist + flight).heading - track.pointAtDist(me.dist).heading)) < 0.12;
    const safeLane = Math.abs(me.lateral) < track.halfWidth - 2.2;
    if (r.spec.assist === 'jump') st.wantNitro = hop && straightJump && safeLane && world.rng() < 0.4 + ai.skill * 0.5;
    else st.wantNitro = straight && speed > r.spec.maxSpeed * 0.6 && (r.place > 1 || threatBehind) && world.rng() < 0.15 + ai.skill * 0.2 + (leaderDuel(world, r) === 'chaser' ? 0.3 : 0);
  }

  // perigo novo ou mal desviado bem perto: corrige a faixa já (sem esperar a próxima "pensada")
  const look = steerLook(world, r, me, speed);
  const close = 6 + Math.max(0, speed) * 0.45;
  const dodge = avoidHazards(world, r, me, st.lane, close, ai.skill, look, st.lane);
  if (dodge !== st.lane) st.lane = clamp(dodge, -track.halfWidth + 1.6, track.halfWidth - 1.6);

  // Direção: mira num ponto à frente na faixa escolhida
  const target = track.pointAtDist(me.dist + look);
  const tx = target.x + Math.cos(target.heading) * st.lane;
  const tz = target.z - Math.sin(target.heading) * st.lane;
  const desired = Math.atan2(tx - car.x, tz - car.z);
  input.steer = clamp(-wrapAngle(desired - car.heading) * 2.6, -1, 1);

  // Velocidade: fração da final pela habilidade (AI_TUNING.basePace) e redução só onde a curva à frente pede,
  // pelo raio real da pista e pelo quanto o carro vira (giro, aderência, DERRAPAR); freia tarde
  // (avaliadores, rodada 11: um piloto trivial de acelerador cheio vencia 32 de 36 no Normal)
  const now = track.pointAtDist(me.dist).heading;
  const later = track.pointAtDist(me.dist + 10 + Math.max(0, speed) * 0.5).heading;
  const bend = Math.abs(wrapAngle(later - now));
  const pace = AI_TUNING.basePace + (1 - AI_TUNING.basePace) * ai.skill;
  let targetSpeed = r.spec.maxSpeed * pace;
  const corner = cornerSpeed(world, r, me.dist, speed) * (1 - AI_TUNING.cornerSkill * (1 - ai.skill));
  let brakeHard = false;
  if (corner < targetSpeed) {
    targetSpeed = corner;
    brakeHard = speed > corner + 3;
  }
  // preso atrás de alguém há mais de 1 s: arrisca mais para passar (corridas menos "em fila")
  if (st.behindTime > 1) targetSpeed *= 1.05;
  // e aproveita a velocidade a mais do vácuo (o carro anda mais ali: ver draftFactor)
  targetSpeed *= 1 + DRAFT_SPEED * draftFactor(world, r);

  // "Elástico" leve em relação ao humano mais adiantado (que ainda corre), para a corrida ficar disputada
  const humans = world.racers.filter((o) => !o.ai && !o.finishPlace);
  if (humans.length) {
    const lead = Math.max(...humans.map((h) => raceDistance(world, h)));
    const gap = raceDistance(world, r) - lead;
    // no Fácil/Normal o elástico age antes (50 m): a liderança troca mais de mãos
    const band = world.difficulty === 'hard' ? 80 : 50;
    targetSpeed *= gap > band ? diff.aheadSlow : gap < -band ? diff.behindBoost : 1;
  }

  if (speed < targetSpeed) input.throttle = 1;
  else if (brakeHard) input.brake = clamp((speed - targetSpeed) / 6, 0.3, 1);
  else if (speed > targetSpeed + 4) input.brake = 0.4;
  // curva fechada embalado: usa o DERRAPAR como o jogador (vira mais e perde menos que frear; rodada 10)
  if (bend > AI_SHARP_BEND && speed > r.spec.maxSpeed * AI_SHARP_SPEED && Math.abs(input.steer) > 0.4) input.sharp = true;

  input.fire = st.wantFire;
  input.drop = st.wantDrop;
  input.nitro = st.wantNitro;
  // o botão precisa "soltar" entre disparos (a simulação usa borda de subida)
  if (r.prevFire || st.fireCooldown > 0) input.fire = false;
  if (r.prevDrop) input.drop = false;
  if (car.prevNitro) input.nitro = false;
  // apontar a direção evita atirar na mureta durante curvas fechadas
  if (bend > 0.8 && r.spec.front === 'laser') input.fire = false;
  // cada decisão vale um disparo só
  if (input.fire) {
    st.wantFire = false;
    st.fireCooldown = r.spec.front === 'sundog' ? 1.5 : r.spec.front === 'missile' ? 0.8 : 0.3;
  }
  if (input.drop) st.wantDrop = false;
  if (input.nitro) st.wantNitro = false;
  return input;
}

/**
 * Piloto de referência "humano" (avaliadores, rodada 11): o jeito mais simples de jogar — segue o
 * centro da pista, acelera sempre, usa só o botão DERRAPAR nas curvas fechadas e não atira. Serve de
 * régua para a CPU e a dificuldade (testes e scripts/evidencias.mjs): no Normal ele deve vencer só
 * parte das corridas contra 3 CPUs. Preso (bateu, rodou), dá ré até alinhar, como qualquer jogador.
 */
export function referenceInput(world: World, r: Racer, dt = 1 / 60): ControlInput {
  return world.track.withRoute(r.car.pieceIndex, () => false, () => referenceInputOnRoute(world, r, dt));
}

function referenceInputOnRoute(world: World, r: Racer, dt: number): ControlInput {
  const track = world.track;
  const car = r.car;
  const input = emptyInput();
  const st = r.aiState;
  const q = track.query(car.x, car.z, car.pieceIndex);
  const v = forwardSpeed(car);
  const tangent = track.pointAtDist(q.dist).heading;
  const err = wrapAngle(tangent - car.heading);
  if (st.reverseTime > 0) {
    st.reverseTime -= dt;
    if (Math.abs(err) < 0.4) st.reverseTime = 0;
    input.brake = 1;
    input.steer = clamp(err * 3, -1, 1);
    return input;
  }
  st.stuckTime = world.started && Math.abs(v) < 2 ? st.stuckTime + dt : 0;
  if (st.stuckTime > 1) {
    st.stuckTime = 0;
    st.reverseTime = 1.5;
  }
  const p = track.pointAtDist(q.dist + 6 + Math.max(0, v) * 0.3);
  const d = wrapAngle(Math.atan2(p.x - car.x, p.z - car.z) - car.heading);
  const bend = Math.abs(wrapAngle(track.pointAtDist(q.dist + 8 + Math.max(0, v) * 0.45).heading - tangent));
  input.throttle = 1;
  input.steer = clamp(-d * 2.5, -1, 1);
  input.sharp = bend > REF_SHARP_BEND && v > r.spec.maxSpeed * 0.6;
  return input;
}
/** Curva à frente (rad) a partir da qual o piloto de referência usa o DERRAPAR. */
const REF_SHARP_BEND = 0.9;
