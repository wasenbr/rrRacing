import { computeAiInput, createAiState, type AiProfile, type AiState } from './ai';
import { emptyInput, type ControlInput } from './input';
import { clamp, createRng, forwardX, forwardZ, leftX, leftZ, wrapAngle } from './math';
import { createProgress, updateProgress, type RacerProgress } from './race';
import type { Track } from './track';
import { CAR_SCALE, createVehicleState, forwardSpeed, stepVehicle, type Assist, type FrontWeapon, type RearWeapon, type VehicleSpec, type VehicleState } from './vehicle';

/** Parâmetros das armas (dano em pontos de blindagem). */
export const WEAPONS = {
  /** VK Plasma Rifles: bola de plasma rápida, reta, dano médio (arma inicial: precisa render tanto quanto as outras) */
  //  (dano 25 → 22 na rodada 10: Dirt Devil e Marauder eram os que mais destruíam, e quem liderava
  //  — Air Blade, Havac — explodia demais nas corridas mistas)
  laser: { speed: 85, life: 1.05, damage: 22, knock: 3.5, hop: 0, turnRate: 0 },
  /** Rogue Missiles: a arma mais forte — teleguiado suave para a frente, joga o alvo para cima.
   *  `maxTurn`: a curva total fica num cone em torno da direção do disparo (dá para desviar) */
  //  (empurrão 9 → 7 e pulo 7 → 5 na rodada 10: um míssil tirava o alvo da disputa)
  missile: { speed: 58, life: 2.4, damage: 30, knock: 7, hop: 5, turnRate: 1.4, maxTurn: 0.12 },
  /** Sundog Beams: lento, persegue o alvo em qualquer direção (até para trás), pouco dano; some na mureta.
   *  `chase`: só persegue nos primeiros segundos, depois segue reto (dá para fugir dele) */
  //  (dano 14 → 22: com 30–57 acertos por corrida ele quase não destruía ninguém — rodada 10)
  sundog: { speed: 42, life: 2.2, damage: 22, knock: 2, hop: 0, turnRate: 1.7, chase: 1.2 },
  /** Bear Claw Mines (arma 0,9 s depois de cair: quem vem colado passa antes; rodada 10, acerto ~80% → ~45%) */
  mine: { damage: 32, hop: 9, radius: 1.6, armTime: 0.9, life: 40 },
  /** KO Scatterpack: leque de minas pequenas atrás do carro (raio 0,9: dá para passar entre elas; dura
   *  12 s — com 25 s o leque da volta anterior cobria a pista toda e ~80% dos leques acertavam alguém) */
  scatter: { count: 4, spread: 3.2, damage: 12, hop: 6, radius: 0.9, armTime: 0.35, life: 12 },
  // óleo (BF's Slipsauce): mancha pequena e desviável; dura 25 s ou some depois de `spins` giros, e
  // cada carro tem no máximo OIL_PER_CAR manchas. Esteiras e aerodeslizador giram metade.
  oil: { radius: 1.35, life: 25, spinTime: 0.8, minSpeed: 12, spins: 2 },
  /** poças fixas por planeta (original): gosma verde freia muito (Drakonis), poça azul/óleo preto
   *  fazem derrapar (Bogmire/New Mojave), neve freia (Nho), lava queima a blindagem (Inferno) */
  slime: { radius: 2.3, drag: 2.6 },
  puddle: { radius: 2.3, drag: 0.4, slip: 0.5 },
  snow: { radius: 2.4, drag: 1.8 },
  lava: { radius: 2.2, drag: 0.8, dps: 18 },
} as const;

/** Manchas de óleo ativas por carro: a mais antiga some quando o carro solta outra. */
export const OIL_PER_CAR = 2;

/** Poça fixa usada em cada planeta (quantidade em `TrackDef.slime`). */
const PLANET_HAZARD: Record<string, 'slime' | 'puddle' | 'snow' | 'lava'> = {
  chem6: 'puddle', drakonis: 'slime', bogmire: 'puddle', newmojave: 'puddle', nho: 'snow', inferno: 'lava',
};
/** batida carro-carro: dano nos dois (original) a partir desta velocidade relativa (m/s) */
const BUMP_DAMAGE_START = 7;
const BUMP_DAMAGE_PER_MS = 0.9;

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
/**
 * Ajustes por dificuldade. `damageToHuman` multiplica o dano que o jogador sofre;
 * `skill`/`aggression` somam/multiplicam o perfil da CPU; `rubber` controla o "elástico"
 * (quanto a CPU alivia quando está na frente e acelera quando está atrás).
 */
export const DIFFICULTY: Record<Difficulty, { damageToHuman: number; skill: number; aggression: number; aheadSlow: number; behindBoost: number; rivalUpgrade: number }> = {
  // elástico leve de propósito (a crítica do original reclamou de rubber-band exagerado)
  easy: { damageToHuman: 0.7, skill: -0.14, aggression: 0.6, aheadSlow: 0.9, behindBoost: 1.02, rivalUpgrade: -1 },
  normal: { damageToHuman: 1, skill: 0, aggression: 1, aheadSlow: 0.95, behindBoost: 1.04, rivalUpgrade: 0 },
  hard: { damageToHuman: 1.25, skill: 0.07, aggression: 1.2, aheadSlow: 1, behindBoost: 1.05, rivalUpgrade: 1 },
};

export const PRIZES = [20000, 12000, 6000, 2000];
export const PICKUP_MONEY = 1000;
export const PICKUP_ARMOR = 40;
/** dinheiro por destruir um rival (recompensa o combate, como os bônus do original) */
/** "attack bonus": golpe final num rival (original: $1.000) */
export const KILL_BOUNTY = 1000;
/** "lapping bonus": abrir uma volta sobre um rival */
export const LAP_BONUS = 5000;
const RESPAWN_TIME = 2.5;

/** Valor em dinheiro com o multiplicador da corrida (arredondado a $100). */
export function scaledMoney(world: World, base: number): number {
  return Math.round((base * world.moneyScale) / 100) * 100;
}
const FALL_RESPAWN = 1.6;
const INVULN_TIME = 2;
const CAR_RADIUS = 1.25 * CAR_SCALE;

export interface RacerEntry {
  name: string;
  color: number;
  spec: VehicleSpec;
  /** null = humano */
  ai: AiProfile | null;
}

export interface Racer extends RacerEntry {
  id: number;
  car: VehicleState;
  progress: RacerProgress;
  aiState: AiState;
  armor: number;
  frontCharges: number;
  rearCharges: number;
  money: number;
  kills: number;
  alive: boolean;
  respawnTimer: number;
  invuln: number;
  spinTime: number;
  /** duração total do giro atual (o carro sempre dá uma volta completa) */
  spinTotal: number;
  /** proteção após rodar no óleo, para não rodar de novo na mesma mancha */
  oilGrace: number;
  /** já ganhou a carga extra de meio de volta nesta volta? */
  halfRefill: boolean;
  /** derrapando numa poça (perde aderência enquanto > 0) */
  slipTime: number;
  prevFire: boolean;
  prevDrop: boolean;
  cooldown: number;
  place: number;
  finishPlace: number;
  lastInput: ControlInput;
  /** quantas voltas de vantagem já foram premiadas sobre cada rival (id -> voltas) */
  lapsOver: Record<number, number>;
}

export interface Projectile {
  id: number;
  kind: FrontWeapon;
  owner: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  life: number;
  pieceIndex: number;
  /** direção do disparo (o míssil só curva num cone em torno dela) */
  aim?: number;
}

export interface Hazard {
  id: number;
  kind: 'mine' | 'oil' | 'scatter' | 'slime' | 'puddle' | 'snow' | 'lava';
  owner: number;
  x: number;
  y: number;
  z: number;
  age: number;
  /** KO Scatterpack: leque de origem (id da primeira mina); só uma mina do leque acerta cada carro */
  group?: number;
  /** máscara de bits (1 << id) dos carros que já levaram uma mina deste leque (as irmãs os ignoram) */
  spared?: number;
  /** óleo: quantos carros já rodaram nesta mancha */
  spins?: number;
}

export interface Pickup {
  id: number;
  kind: 'money' | 'armor';
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawn: number;
}

export type WorldEvent =
  | { type: 'fire'; racer: number; kind: FrontWeapon; x: number; y: number; z: number }
  | { type: 'drop'; racer: number; kind: RearWeapon }
  | { type: 'hit'; target: number; by: number; kind: FrontWeapon | 'mine' | 'scatter'; x: number; y: number; z: number }
  | { type: 'impact'; x: number; y: number; z: number; kind: FrontWeapon }
  | { type: 'assist'; racer: number; kind: Assist }
  | { type: 'fall'; racer: number; x: number; y: number; z: number }
  | { type: 'lapped'; racer: number; victim: number; bonus: number }
  | { type: 'burn'; racer: number }
  | { type: 'spin'; racer: number }
  | { type: 'explode'; racer: number; by: number; x: number; y: number; z: number; bounty: number }
  | { type: 'respawn'; racer: number }
  | { type: 'pickup'; racer: number; kind: 'money' | 'armor'; x: number; y: number; z: number }
  | { type: 'lap'; racer: number; lap: number }
  | { type: 'finish'; racer: number; place: number }
  | { type: 'bump'; a: number; b: number; strength: number };

export interface World {
  track: Track;
  laps: number;
  racers: Racer[];
  projectiles: Projectile[];
  hazards: Hazard[];
  pickups: Pickup[];
  /** false durante a contagem regressiva */
  started: boolean;
  raceTime: number;
  finishedCount: number;
  events: WorldEvent[];
  rng: () => number;
  nextId: number;
  /** prêmio em dinheiro por colocação */
  prizes: number[];
  difficulty: Difficulty;
  /** multiplicador do dinheiro da pista, dos abates e do bônus de volta (campanha: planeta × dificuldade) */
  moneyScale: number;
}

/** Posições do grid: duas filas logo antes da linha, os primeiros da lista largam na frente. */
function gridSlot(track: Track, slot: number): { x: number; z: number; heading: number; h: number; pieceIndex: number } {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? 1 : -1;
  const p = track.pointAtDist(-(4 + row * 7));
  const lat = track.halfWidth * 0.45;
  return { x: p.x + leftX(p.heading) * side * lat, z: p.z + leftZ(p.heading) * side * lat, heading: p.heading, h: p.h, pieceIndex: p.pieceIndex };
}

export function createWorld(track: Track, entries: RacerEntry[], laps: number, seed = 1, prizes: number[] = PRIZES, difficulty: Difficulty = 'normal', moneyScale = 1): World {
  const racers: Racer[] = entries.map((e, i) => {
    const g = gridSlot(track, i);
    const car = createVehicleState(e.spec, g.x, g.z, g.heading, g.h);
    // a peça já vem do grid: largando em cima de um cruzamento (X), a busca sem dica podia
    // escolher a passagem perpendicular e as muretas ficavam atravessadas na frente do carro
    car.pieceIndex = g.pieceIndex;
    return {
      ...e,
      id: i,
      car,
      progress: createProgress(track, car),
      aiState: createAiState(),
      armor: e.spec.armor,
      frontCharges: e.spec.frontCharges,
      rearCharges: e.spec.rearCharges,
      money: 0,
      kills: 0,
      alive: true,
      respawnTimer: 0,
      invuln: 0,
      spinTime: 0,
      spinTotal: 1,
      oilGrace: 0,
      halfRefill: false,
      slipTime: 0,
      prevFire: false,
      prevDrop: false,
      cooldown: 0,
      place: i + 1,
      finishPlace: 0,
      lastInput: emptyInput(),
      lapsOver: {},
    };
  });

  // dinheiro e blindagem espalhados pela pista, alternando de lado
  const pickups: Pickup[] = [];
  let id = 1000;
  const n = Math.floor(track.totalLength / 45);
  for (let i = 1; i < n; i++) {
    const p = track.pointAtDist((i * track.totalLength) / n);
    const side = i % 2 === 0 ? 1 : -1;
    const lat = side * track.halfWidth * 0.5;
    pickups.push({
      id: id++,
      kind: i % 4 === 0 ? 'armor' : 'money',
      x: p.x + leftX(p.heading) * lat,
      y: p.h,
      z: p.z + leftZ(p.heading) * lat,
      active: true,
      respawn: 0,
    });
  }

  // poças de gosma fixas (Drakonis e outros planetas), só em retas e fora da largada
  const hazards: Hazard[] = [];
  // (casas fixas do mapa original quando a pista tem `puddles`)
  const fixed = track.def.puddles?.map((i) => track.pieces[i]).filter((p) => p && p.code !== 'G');
  const spots = fixed ?? track.pieces.filter((p) => (p.code === 'S' || p.code === 'B') && p.index > 1);
  const count = fixed ? fixed.length : Math.min(track.def.slime ?? 0, spots.length);
  for (let i = 0; i < count; i++) {
    const p = fixed ? fixed[i] : spots[Math.floor(((i + 0.5) * spots.length) / count)];
    const side = i % 2 === 0 ? 1 : -1;
    const pt = track.pointAtDist(p.startDist + p.length / 2);
    hazards.push({ id: id++, kind: PLANET_HAZARD[track.def.theme] ?? 'slime', owner: -1, x: pt.x + leftX(pt.heading) * side * track.halfWidth * 0.4, y: pt.h, z: pt.z + leftZ(pt.heading) * side * track.halfWidth * 0.4, age: 0 });
  }

  const world: World = {
    track,
    laps,
    racers,
    projectiles: [],
    hazards,
    pickups,
    started: false,
    raceTime: 0,
    finishedCount: 0,
    events: [],
    rng: createRng(seed),
    nextId: 1,
    prizes,
    difficulty,
    moneyScale,
  };
  updatePlaces(world);
  return world;
}

/** Distância total percorrida (para classificar). */
export function raceDistance(world: World, r: Racer): number {
  const d = r.progress.beforeLine ? r.progress.lastDist - world.track.totalLength : r.progress.lastDist;
  return (r.progress.lap - 1) * world.track.totalLength + d;
}

function updatePlaces(world: World): void {
  const order = [...world.racers].sort((a, b) => {
    if (a.finishPlace && b.finishPlace) return a.finishPlace - b.finishPlace;
    if (a.finishPlace) return -1;
    if (b.finishPlace) return 1;
    return raceDistance(world, b) - raceDistance(world, a);
  });
  order.forEach((r, i) => (r.place = i + 1));
}

function damage(world: World, target: Racer, by: number, amount: number, bountyOk = true): void {
  if (!target.alive || target.invuln > 0 || target.finishPlace) return;
  target.armor -= target.ai ? amount : amount * DIFFICULTY[world.difficulty].damageToHuman;
  if (target.armor <= 0) {
    target.armor = 0;
    target.alive = false;
    target.respawnTimer = RESPAWN_TIME;
    target.car.vx = target.car.vz = 0;
    const killer = world.racers[by];
    let bounty = 0;
    if (killer && by !== target.id) {
      killer.kills++;
      // pelo FAQ do original, matar com Bear Claw Mines não dá "attack bonus"
      bounty = bountyOk ? scaledMoney(world, KILL_BOUNTY) : 0;
      killer.money += bounty;
    }
    world.events.push({ type: 'explode', racer: target.id, by, x: target.car.x, y: target.car.y, z: target.car.z, bounty });
  }
}

function respawn(world: World, r: Racer): void {
  const track = world.track;
  // volta um pouco na pista, no centro, virado para frente
  let p = track.pointAtDist(r.progress.lastDist - 6);
  // nunca renasce sobre um vão (G) nem na rampa que leva a ele: parado ali, cairia de novo.
  // Passa para depois do vão (a demora do resgate já é a punição).
  const n = track.pieces.length;
  // (partindo do zero, não dá para embalar e saltar o vão se ele estiver nas próximas 2 casas)
  const nearGap = (i: number) => [0, 1, 2].some((k) => track.pieces[(i + k) % n].code === 'G');
  for (let guard = 0; guard < 8 && nearGap(p.pieceIndex); guard++) {
    const pc = track.pieces[p.pieceIndex];
    p = track.pointAtDist(pc.startDist + pc.length + 4);
  }
  const car = r.car;
  car.x = p.x;
  car.z = p.z;
  car.y = p.h;
  car.heading = p.heading;
  car.vx = car.vy = car.vz = 0;
  car.grounded = true;
  car.pieceIndex = p.pieceIndex;
  car.pitch = car.roll = 0;
  r.armor = r.spec.armor;
  r.alive = true;
  r.invuln = INVULN_TIME;
  r.spinTime = 0;
  world.events.push({ type: 'respawn', racer: r.id });
}

function fire(world: World, r: Racer): void {
  const car = r.car;
  const kind = r.spec.front;
  const fx = forwardX(car.heading);
  const fz = forwardZ(car.heading);
  const w = WEAPONS[kind];
  const base = Math.max(0, forwardSpeed(car));
  const x = car.x + fx * 2.8 * CAR_SCALE;
  const z = car.z + fz * 2.8 * CAR_SCALE;
  const y = car.y + 1.0;
  // o sundog não herda a velocidade do carro (é lento e persegue)
  const speed = w.speed + (kind === 'sundog' ? base * 0.3 : base);
  world.projectiles.push({ id: world.nextId++, kind, owner: r.id, x, y, z, heading: car.heading, speed, life: w.life, pieceIndex: car.pieceIndex, aim: car.heading });
  world.events.push({ type: 'fire', racer: r.id, kind, x, y, z });
}

function drop(world: World, r: Racer): void {
  const car = r.car;
  const kind = r.spec.rear;
  // o óleo cai mais para trás: quem vem atrás tem tempo de ver a mancha e desviar (item 17)
  const back = (kind === 'oil' ? 6 : 3.2) * CAR_SCALE;
  const fx = forwardX(car.heading);
  const fz = forwardZ(car.heading);
  const group = world.nextId;
  const put = (lat: number, extra: number) => {
    const x = car.x - fx * (back + extra) + leftX(car.heading) * lat;
    const z = car.z - fz * (back + extra) + leftZ(car.heading) * lat;
    const q = world.track.query(x, z, car.pieceIndex);
    if (Math.abs(q.lateral) > world.track.halfWidth - 0.3) return;
    world.hazards.push({ id: world.nextId++, kind, owner: r.id, x, y: q.height, z, age: 0, ...(kind === 'scatter' ? { group, spared: 0 } : {}) });
  };
  if (kind === 'scatter') {
    // leque de minas pequenas cobrindo a pista atrás do carro
    const n = WEAPONS.scatter.count;
    for (let i = 0; i < n; i++) put((i - (n - 1) / 2) * WEAPONS.scatter.spread, Math.abs(i - (n - 1) / 2) * 0.8);
  } else {
    if (kind === 'oil') {
      const mine = world.hazards.filter((h) => h.kind === 'oil' && h.owner === r.id);
      if (mine.length >= OIL_PER_CAR) {
        const oldest = mine.reduce((a, b) => (b.age > a.age ? b : a));
        world.hazards = world.hazards.filter((h) => h !== oldest);
      }
    }
    put(0, 0);
  }
  world.events.push({ type: 'drop', racer: r.id, kind });
}

function stepProjectiles(world: World, dt: number): void {
  const track = world.track;
  const alive: Projectile[] = [];
  for (const p of world.projectiles) {
    p.life -= dt;
    // o sundog persegue só no começo; depois segue reto
    if (p.kind === 'missile' || (p.kind === 'sundog' && WEAPONS.sundog.life - p.life < WEAPONS.sundog.chase)) {
      // míssil: teleguiado suave num cone à frente; sundog: persegue o mais próximo em qualquer direção
      const cone = p.kind === 'missile' ? 0.6 : Math.PI;
      let best: Racer | null = null;
      let bestD = p.kind === 'missile' ? 45 : 60;
      for (const r of world.racers) {
        if (r.id === p.owner || !r.alive || r.finishPlace) continue;
        const dx = r.car.x - p.x;
        const dz = r.car.z - p.z;
        const d = Math.hypot(dx, dz);
        const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - p.heading));
        if (d < bestD && ang <= cone) {
          best = r;
          bestD = d;
        }
      }
      if (best) {
        const turn = WEAPONS[p.kind].turnRate;
        const want = Math.atan2(best.car.x - p.x, best.car.z - p.z);
        const diff = wrapAngle(want - p.heading);
        p.heading += clamp(diff, -turn * dt, turn * dt);
        // o míssil não faz curva maior que o cone em torno do disparo
        if (p.kind === 'missile' && p.aim !== undefined) p.heading = p.aim + clamp(wrapAngle(p.heading - p.aim), -WEAPONS.missile.maxTurn, WEAPONS.missile.maxTurn);
      }
    }
    p.x += forwardX(p.heading) * p.speed * dt;
    p.z += forwardZ(p.heading) * p.speed * dt;
    const q = track.query(p.x, p.z, p.pieceIndex);
    p.pieceIndex = q.pieceIndex;
    p.y += (q.height + 1.0 - p.y) * clamp(dt * 12, 0, 1);

    let dead = p.life <= 0;
    if (Math.abs(q.lateral) > track.halfWidth + 0.1 || q.height + 0.3 > p.y + 0.8) {
      dead = true; // bateu na mureta ou na face de um salto
      world.events.push({ type: 'impact', x: p.x, y: p.y, z: p.z, kind: p.kind });
    }
    if (!dead) {
      for (const r of world.racers) {
        if (r.id === p.owner || !r.alive || r.finishPlace) continue;
        if (Math.hypot(r.car.x - p.x, r.car.z - p.z) < CAR_RADIUS + 0.5 && Math.abs(r.car.y + 0.7 - p.y) < 1.8) {
          const w = WEAPONS[p.kind];
          if (r.invuln <= 0) {
            r.car.vx += forwardX(p.heading) * w.knock;
            r.car.vz += forwardZ(p.heading) * w.knock;
            if (w.hop > 0) {
              r.car.grounded = false;
              r.car.vy = w.hop;
            }
          }
          world.events.push({ type: 'hit', target: r.id, by: p.owner, kind: p.kind, x: p.x, y: p.y, z: p.z });
          damage(world, r, p.owner, w.damage);
          dead = true;
          break;
        }
      }
    }
    if (!dead) alive.push(p);
  }
  world.projectiles = alive;
}

function stepHazards(world: World, dt: number): void {
  const keep: Hazard[] = [];
  for (const h of world.hazards) {
    h.age += dt;
    let dead = false;
    if (h.kind === 'mine' || h.kind === 'scatter') {
      const w = WEAPONS[h.kind];
      if (h.age > w.life) dead = true;
      else if (h.age > w.armTime) {
        for (const r of world.racers) {
          if (!r.alive || !r.car.grounded || r.finishPlace || ((h.spared ?? 0) & (1 << r.id)) !== 0) continue;
          if (Math.hypot(r.car.x - h.x, r.car.z - h.z) < w.radius) {
            if (r.invuln <= 0) {
              r.car.grounded = false;
              r.car.vy = w.hop;
              r.car.vx *= 0.55;
              r.car.vz *= 0.55;
            }
            world.events.push({ type: 'hit', target: r.id, by: h.owner, kind: h.kind, x: h.x, y: h.y, z: h.z });
            damage(world, r, h.owner, w.damage, h.kind !== 'mine');
            // passar pelo leque custa uma mina só: as irmãs deixam este carro passar (avaliadores, rodada 9)
            if (h.group !== undefined) for (const o of world.hazards) if (o.group === h.group && o !== h) o.spared = (o.spared ?? 0) | (1 << r.id);
            dead = true;
            break;
          }
        }
      }
    } else if (h.kind === 'slime' || h.kind === 'puddle' || h.kind === 'snow' || h.kind === 'lava') {
      for (const r of world.racers) {
        if (!r.alive || r.finishPlace || !puddleTouch(r.car, r.spec, h, dt)) continue;
        if (h.kind === 'puddle') r.slipTime = WEAPONS.puddle.slip;
        if (h.kind === 'lava' && r.invuln <= 0) {
          damage(world, r, -1, WEAPONS.lava.dps * dt);
          if (world.rng() < dt * 4) world.events.push({ type: 'burn', racer: r.id });
        }
      }
    } else {
      if (h.age > WEAPONS.oil.life) dead = true;
      else {
        for (const r of world.racers) {
          if (!r.alive || r.finishPlace) continue;
          const spin = oilSpinTime(r, r.spec, r.id, !r.ai && world.difficulty !== 'hard', h);
          if (spin > 0) {
            startSpin(r, spin);
            world.events.push({ type: 'spin', racer: r.id });
            h.spins = (h.spins ?? 0) + 1;
            if (h.spins >= WEAPONS.oil.spins) {
              dead = true;
              break;
            }
          }
        }
      }
    }
    if (!dead) keep.push(h);
  }
  world.hazards = keep;
}

/* Regras de um carro só (poças, óleo, derrapagem): usadas pelo mundo e pela previsão do convidado online. */

/** O que a previsão precisa de um piloto além do carro (os mesmos campos de `Racer`). */
export interface DriverState {
  car: VehicleState;
  slipTime: number;
  spinTime: number;
  spinTotal: number;
  oilGrace: number;
}

/** Poça fixa (gosma, poça, neve, lava) sob o carro no chão: freia e devolve true (a derrapagem e a lava ficam com quem chama). */
export function puddleTouch(car: VehicleState, spec: VehicleSpec, h: Hazard, dt: number): boolean {
  if (h.kind !== 'slime' && h.kind !== 'puddle' && h.kind !== 'snow' && h.kind !== 'lava') return false;
  if (!car.grounded) return false;
  // o aerodeslizador ignora poças que só fazem derrapar
  if (h.kind === 'puddle' && spec.traction === 'hover') return false;
  const w = WEAPONS[h.kind];
  if (Math.hypot(car.x - h.x, car.z - h.z) >= w.radius) return false;
  const k = Math.exp(-w.drag * dt);
  car.vx *= k;
  car.vz *= k;
  return true;
}

/**
 * Mancha de óleo: por quanto tempo este carro gira ao passar nela (0 = não gira). `human`: jogador
 * humano fora do Difícil (roda menos: arcade, perdoa o erro).
 */
export function oilSpinTime(d: DriverState, spec: VehicleSpec, id: number, human: boolean, h: Hazard): number {
  if (h.kind !== 'oil' || h.age > WEAPONS.oil.life) return 0;
  if (!d.car.grounded || d.spinTime > 0 || d.oilGrace > 0 || (id === h.owner && h.age < 1.5)) return 0;
  if (h.age < 0.25) return 0; // a mancha ainda está se espalhando
  if (Math.hypot(d.car.x - h.x, d.car.z - h.z) >= WEAPONS.oil.radius || forwardSpeed(d.car) <= WEAPONS.oil.minSpeed) return 0;
  // esteiras e aerodeslizador resistem ao óleo (giram metade), mas não são imunes: todos competitivos
  const resist = Math.max(spec.spinResist ?? 0, spec.traction === 'treads' || spec.traction === 'hover' ? 0.5 : 0);
  return WEAPONS.oil.spinTime * (1 - resist) * (human ? 0.625 : 1);
}

/** Começa o giro no óleo (com a proteção para não rodar de novo na mesma mancha). */
export function startSpin(d: DriverState, time: number): void {
  d.spinTime = time;
  d.spinTotal = time;
  d.oilGrace = time + 1.2;
}

/**
 * Aderência e comandos do passo: derrapando na poça (perde aderência) ou girando no óleo (gira, sem
 * acelerar nem esterçar). Desconta os tempos.
 */
export function driveTraction(d: DriverState, spec: VehicleSpec, id: number, input: ControlInput, dt: number): { spec: VehicleSpec; input: ControlInput } {
  if (d.slipTime > 0) {
    d.slipTime = Math.max(0, d.slipTime - dt);
    spec = { ...spec, grip: spec.grip * (spec.traction === 'treads' ? 0.5 : 0.25) };
  }
  if (d.spinTime > 0) {
    // derrapando no óleo: perde aderência e gira
    d.spinTime -= dt;
    spec = { ...spec, grip: 0.6 };
    d.car.heading += ((Math.PI * 2) / d.spinTotal) * dt * (id % 2 === 0 ? 1 : -1);
    input = { ...input, throttle: 0, steer: 0, nitro: false };
  }
  return { spec, input };
}

/**
 * Um passo de um carro só, sem o resto do mundo: derrapagem, giro no óleo, poças fixas e manchas de
 * óleo, na mesma ordem de `stepWorld` (as poças agem depois do movimento). Previsão do convidado
 * online: não mexe nas poças (quem conta os giros e o dano é o host). `contacts`: batidas contra os
 * rivais logo depois do movimento, como em `collideCars`.
 */
export function stepDriver(
  d: DriverState,
  spec: VehicleSpec,
  input: ControlInput,
  id: number,
  human: boolean,
  track: Track,
  hazards: readonly Hazard[],
  dt: number,
  contacts?: (car: VehicleState) => void,
): void {
  d.oilGrace = Math.max(0, d.oilGrace - dt);
  const t = driveTraction(d, spec, id, input, dt);
  stepVehicle(d.car, t.spec, t.input, track, dt);
  contacts?.(d.car);
  for (const h of hazards) {
    if (h.kind === 'oil') {
      const spin = oilSpinTime(d, spec, id, human, h);
      if (spin > 0) startSpin(d, spin);
    } else if (puddleTouch(d.car, spec, h, dt) && h.kind === 'puddle') d.slipTime = WEAPONS.puddle.slip;
  }
}

function stepPickups(world: World, dt: number): void {
  for (const p of world.pickups) {
    if (!p.active) {
      p.respawn -= dt;
      if (p.respawn <= 0) p.active = true;
      continue;
    }
    for (const r of world.racers) {
      if (!r.alive || r.finishPlace) continue;
      if (Math.hypot(r.car.x - p.x, r.car.z - p.z) < 1.9 && Math.abs(r.car.y - p.y) < 2) {
        if (p.kind === 'money') r.money += scaledMoney(world, PICKUP_MONEY);
        else r.armor = Math.min(r.spec.armor, r.armor + PICKUP_ARMOR);
        p.active = false;
        p.respawn = 15;
        world.events.push({ type: 'pickup', racer: r.id, kind: p.kind, x: p.x, y: p.y, z: p.z });
        break;
      }
    }
  }
}

/**
 * Contato entre dois carros (a regra das batidas): empurra para fora e troca velocidade na direção
 * do contato, com um giro leve. Devolve a velocidade de impacto (> 0) ou 0 se não houve batida com
 * aproximação, -1 se não se tocam. Exportada para a previsão do convidado online (mesma regra).
 */
export function carContact(a: VehicleState, massA: number, b: VehicleState, massB: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const min = CAR_RADIUS * 2;
  if (d >= min || d < 1e-6 || Math.abs(a.y - b.y) > 1.5) return -1;
  const nx = dx / d;
  const nz = dz / d;
  // razão de massas limitada: o carro pesado empurra, mas não atropela os leves no tráfego
  const ma = massA;
  const mb = clamp(massB, ma / 1.25, ma * 1.25);
  const pen = min - d;
  a.x -= nx * pen * (mb / (ma + mb));
  a.z -= nz * pen * (mb / (ma + mb));
  b.x += nx * pen * (ma / (ma + mb));
  b.z += nz * pen * (ma / (ma + mb));
  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rel >= 0) return 0;
  const j = (-(1 + 0.5) * rel) / (1 / ma + 1 / mb);
  a.vx -= (j / ma) * nx;
  a.vz -= (j / ma) * nz;
  b.vx += (j / mb) * nx;
  b.vz += (j / mb) * nz;
  // pancada lateral faz o carro girar um pouco (quanto mais leve, mais gira)
  const yaw = (c: VehicleState, sign: number, m: number) => {
    const side = (forwardX(c.heading) * nz - forwardZ(c.heading) * nx) * sign;
    c.heading += clamp((side * j) / m, -6, 6) * 0.012;
  };
  yaw(a, 1, ma);
  yaw(b, -1, mb);
  return -rel;
}

/** Batidas entre carros: empurra para fora e troca velocidade na direção do contato. */
function collideCars(world: World): void {
  const rs = world.racers;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      if (!a.alive || !b.alive || a.finishPlace || b.finishPlace) continue;
      const hit = carContact(a.car, a.spec.mass, b.car, b.spec.mass);
      if (hit <= 0) continue;
      if (hit > 3) world.events.push({ type: 'bump', a: a.id, b: b.id, strength: hit });
      // batida forte fere os dois carros (original); o mais pesado sofre menos
      if (hit > BUMP_DAMAGE_START && world.started) {
        const ma = a.spec.mass;
        const mb = clamp(b.spec.mass, ma / 1.25, ma * 1.25);
        const dmg = (hit - BUMP_DAMAGE_START) * BUMP_DAMAGE_PER_MS;
        damage(world, a, b.id, dmg * (mb / (ma + mb)) * 2, false);
        damage(world, b, a.id, dmg * (ma / (ma + mb)) * 2, false);
      }
    }
}

/**
 * Depois da chegada: para a 42 m da linha (+9 m por colocação), na beira da pista, lados alternados.
 * O 1º chega mais rápido e precisa de mais chão para frear e ainda encostar na beira.
 */
const PARK_BASE = 42;
const PARK_GAP = 9;
const PARK_EDGE = 1.4;
/** Passou do ponto sem chegar à beira: segue devagar até encostar (no máximo este tanto além do ponto). */
const PARK_CRAWL = 4;
const PARK_OVERRUN = 35;

/**
 * Quem cruzou a chegada sai do traçado: esterça para a beira desde a linha (1º à esquerda, 2º à direita,
 * ...) e freia para parar a uma distância que cresce com a colocação, sem amontoar logo depois da linha.
 * Só trava (`hold`) já encostado na beira; se chegou ao ponto ainda no meio, segue devagar rumo à beira.
 * Nunca engata ré; `hold` = já parou (o chamador segura o carro no lugar, até em rampa).
 */
function parkInput(world: World, r: Racer): { input: ControlInput; hold: boolean } {
  const track = world.track;
  const car = r.car;
  const speed = forwardSpeed(car);
  const q = track.query(car.x, car.z, car.pieceIndex);
  const T = track.totalLength;
  const signed = (dist: number) => (dist > T / 2 ? dist - T : dist);
  const d = signed(q.dist);
  const side = r.finishPlace % 2 === 1 ? 1 : -1;
  // quem chegou antes do mesmo lado e parou além do previsto empurra a minha vaga para depois dele
  let spot = PARK_BASE + (r.finishPlace - 1) * PARK_GAP;
  for (const o of world.racers)
    if (o.finishPlace && o.finishPlace < r.finishPlace && o.finishPlace % 2 === r.finishPlace % 2)
      spot = Math.max(spot, signed(track.query(o.car.x, o.car.z, o.car.pieceIndex).dist) + PARK_GAP);
  const rem = spot - d;
  const lane = side * (track.halfWidth - PARK_EDGE);
  const atEdge = q.lateral * side >= track.halfWidth - PARK_EDGE - 0.6;
  const input = emptyInput();
  if ((rem <= 0.5 || (speed < 1 && rem < 3)) && (atEdge || rem < -PARK_OVERRUN)) {
    if (speed > 1) input.brake = 1;
    return { input, hold: speed <= 1 };
  }
  // rumo = direção da pista logo à frente + ângulo de aproximação da faixa da beira (mais fechado
  // quanto mais devagar: em marcha lenta o carro ainda encosta, até em curva)
  const tangent = track.pointAtDist(q.dist + Math.max(0, speed) * 0.15).heading;
  const reach = 2 + Math.max(0, speed) * 0.3;
  const want = tangent + clamp(Math.atan2(lane - q.lateral, reach), -0.8, 0.8);
  input.steer = clamp(-wrapAngle(want - car.heading) * 3, -1, 1);
  // velocidade que ainda dá para parar no ponto com uma freada firme (20 m/s²); fora da beira, nunca
  // abaixo do passo lento que leva o carro até ela
  const desired = Math.max(atEdge ? 0 : PARK_CRAWL, Math.sqrt(2 * 20 * Math.max(0, rem)));
  if (speed > desired) input.brake = clamp((speed - desired) / 4, 0.3, 1);
  else if (speed < Math.min(desired, 16) - 1) input.throttle = 0.6;
  return { input, hold: false };
}

/**
 * Avança o mundo um passo fixo. `humanInputs[id]` traz os comandos dos jogadores humanos;
 * os demais são decididos pela IA. Tudo determinístico (mesma semente + mesmos comandos = mesma corrida).
 */
/** Vácuo (rodada 10: corridas "em fila"): até quanto a final cresce colado atrás de outro carro. */
export const DRAFT_SPEED = 0.1;
const DRAFT_MIN = 2.5;
const DRAFT_MAX = 18;
const DRAFT_LATERAL = 1.7;

/**
 * Quanto `r` está no vácuo de alguém (0..1): outro carro à frente, na mesma linha (até DRAFT_LATERAL m
 * de lado, no referencial dele), entre DRAFT_MIN e DRAFT_MAX m; mais forte quanto mais perto. Só em
 * velocidade (acima de 18 m/s os dois).
 */
export function draftFactor(world: World, r: Racer): number {
  const c = r.car;
  if (forwardSpeed(c) < 18) return 0;
  let best = 0;
  for (const o of world.racers) {
    if (o === r || !o.alive || o.finishPlace || forwardSpeed(o.car) < 18) continue;
    const dx = o.car.x - c.x;
    const dz = o.car.z - c.z;
    const fx = forwardX(o.car.heading);
    const fz = forwardZ(o.car.heading);
    const along = dx * fx + dz * fz;
    if (along < DRAFT_MIN || along > DRAFT_MAX) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side > DRAFT_LATERAL || Math.abs(o.car.y - c.y) > 1.5) continue;
    best = Math.max(best, 1 - (along - DRAFT_MIN) / (DRAFT_MAX - DRAFT_MIN) * 0.6);
  }
  return best;
}

export function stepWorld(world: World, humanInputs: Record<number, ControlInput>, dt: number): void {
  world.events = [];
  if (world.started) world.raceTime += dt;

  for (const r of world.racers) {
    r.cooldown = Math.max(0, r.cooldown - dt);
    r.invuln = Math.max(0, r.invuln - dt);
    r.oilGrace = Math.max(0, r.oilGrace - dt);

    if (!r.alive) {
      r.respawnTimer -= dt;
      if (r.respawnTimer <= 0) respawn(world, r);
      continue;
    }

    let input: ControlInput;
    let hold = false;
    if (!world.started) input = emptyInput();
    // como no original: quem cruzou a linha de chegada freia até parar e sai da disputa
    else if (r.finishPlace) ({ input, hold } = parkInput(world, r));
    else if (r.ai) input = computeAiInput(world, r, dt);
    else input = humanInputs[r.id] ?? emptyInput();

    // derrapando na poça ou girando no óleo (mesma regra da previsão online, ver driveTraction)
    const traction = driveTraction(r, r.spec, r.id, input, dt);
    let spec = traction.spec;
    // vácuo: colado atrás de outro carro, anda mais (final e menos arrasto) — é assim que se passa na reta
    const draft = world.started && !r.finishPlace ? draftFactor(world, r) : 0;
    if (draft > 0) spec = { ...spec, maxSpeed: spec.maxSpeed * (1 + DRAFT_SPEED * draft), drag: spec.drag * (1 - 0.6 * draft) };
    input = traction.input;
    r.lastInput = input;
    const px = r.car.x;
    const pz = r.car.z;
    const ph = r.car.heading;
    stepVehicle(r.car, spec, input, world.track, dt);
    if (hold) {
      // estacionado: não desliza nem recua em rampa
      r.car.x = px;
      r.car.z = pz;
      r.car.heading = ph;
      r.car.vx = 0;
      r.car.vz = 0;
    }
    if (r.car.assistFired) world.events.push({ type: 'assist', racer: r.id, kind: r.spec.assist });
    if (r.car.fell) {
      // caiu por cima da mureta: some e reaparece na pista (sem dano, só perde tempo)
      r.car.fell = false;
      r.alive = false;
      r.respawnTimer = FALL_RESPAWN;
      world.events.push({ type: 'fall', racer: r.id, x: r.car.x, y: r.car.y, z: r.car.z });
      continue;
    }

    if (world.started) {
      if (input.fire && !r.prevFire && r.frontCharges > 0 && r.cooldown <= 0) {
        r.frontCharges--;
        r.cooldown = 0.25;
        fire(world, r);
      }
      if (input.drop && !r.prevDrop && r.rearCharges > 0 && r.cooldown <= 0) {
        r.rearCharges--;
        r.cooldown = 0.25;
        drop(world, r);
      }
      r.prevFire = input.fire;
      r.prevDrop = input.drop;

      const ev = updateProgress(r.progress, world.track, r.car, world.raceTime, world.laps, dt);
      // meio da volta: +1 carga da arma da frente (ação constante; o resto recarrega na volta)
      if (r.progress.halfwayReached && !r.halfRefill) {
        r.halfRefill = true;
        if (r.frontCharges < r.spec.frontCharges) r.frontCharges++;
      }
      if (ev?.type === 'lap') {
        r.halfRefill = false;
        // como no original, armas e nitro recarregam a cada volta
        r.frontCharges = r.spec.frontCharges;
        r.rearCharges = r.spec.rearCharges;
        r.car.nitroCharges = r.spec.nitroCharges;
        world.events.push({ type: 'lap', racer: r.id, lap: ev.lap });
      } else if (ev?.type === 'finish') {
        r.finishPlace = ++world.finishedCount;
        r.money += world.prizes[r.finishPlace - 1] ?? 0;
        if (r.finishPlace === 1) r.money += scaledMoney(world, LAP_BONUS) * Object.values(r.lapsOver).reduce((a, b) => a + b, 0);
        world.events.push({ type: 'finish', racer: r.id, place: r.finishPlace });
      }
    }
  }

  collideCars(world);
  stepProjectiles(world, dt);
  stepHazards(world, dt);
  stepPickups(world, dt);
  updatePlaces(world);
  if (world.started) checkLapping(world);
}

/**
 * "Lapping bonus" (original: $5.000): o 1º colocado que abre uma volta sobre o último.
 * Premia uma vez por volta de vantagem, pago só se ele vencer a corrida (como no original).
 */
function checkLapping(world: World): void {
  const T = world.track.totalLength;
  const running = world.racers.filter((r) => !r.finishPlace);
  if (running.length < 2) return;
  const a = world.racers.find((r) => r.place === 1);
  const last = [...running].sort((x, y) => y.place - x.place)[0];
  if (!a || a.finishPlace || last.id === a.id) return;
  const da = raceDistance(world, a);
  for (const b of [last]) {
    {
      const laps = Math.floor((da - raceDistance(world, b)) / T);
      if (laps > (a.lapsOver[b.id] ?? 0)) {
        // o dinheiro só entra se ele vencer a corrida (ver 'finish')
        a.lapsOver[b.id] = laps;
        world.events.push({ type: 'lapped', racer: a.id, victim: b.id, bonus: scaledMoney(world, LAP_BONUS) });
      }
    }
  }
}
