import { computeAiInput, createAiState, type AiProfile, type AiState } from './ai';
import { emptyInput, type ControlInput } from './input';
import { clamp, createRng, forwardX, forwardZ, leftX, leftZ, wrapAngle } from './math';
import { createProgress, updateProgress, type RacerProgress } from './race';
import type { Track } from './track';
import { CAR_SCALE, createVehicleState, forwardSpeed, stepVehicle, type VehicleSpec, type VehicleState } from './vehicle';

/** Parâmetros das armas (dano em pontos de blindagem). */
export const WEAPONS = {
  laser: { speed: 95, life: 0.7, damage: 11, knock: 3, hop: 0 },
  missile: { speed: 60, life: 2.4, damage: 30, knock: 9, hop: 7, turnRate: 1.8 },
  mine: { damage: 32, hop: 9, radius: 1.7, armTime: 0.6, life: 45 },
  oil: { radius: 2.4, life: 25, spinTime: 1.0 },
  slime: { radius: 2.3, drag: 2.6 },
} as const;

export const PRIZES = [20000, 12000, 6000, 2000];
export const PICKUP_MONEY = 1000;
export const PICKUP_ARMOR = 40;
const RESPAWN_TIME = 2.5;
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
  prevFire: boolean;
  prevDrop: boolean;
  cooldown: number;
  place: number;
  finishPlace: number;
  lastInput: ControlInput;
}

export interface Projectile {
  id: number;
  kind: 'laser' | 'missile';
  owner: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  life: number;
  pieceIndex: number;
}

export interface Hazard {
  id: number;
  kind: 'mine' | 'oil' | 'slime';
  owner: number;
  x: number;
  y: number;
  z: number;
  age: number;
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
  | { type: 'fire'; racer: number; kind: 'laser' | 'missile'; x: number; y: number; z: number }
  | { type: 'drop'; racer: number; kind: 'mine' | 'oil' }
  | { type: 'hit'; target: number; by: number; kind: 'laser' | 'missile' | 'mine'; x: number; y: number; z: number }
  | { type: 'impact'; x: number; y: number; z: number; kind: 'laser' | 'missile' }
  | { type: 'spin'; racer: number }
  | { type: 'explode'; racer: number; by: number; x: number; y: number; z: number }
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
}

/** Posições do grid: duas filas logo depois da linha, os primeiros da lista largam na frente. */
function gridSlot(track: Track, slot: number): { x: number; z: number; heading: number; h: number } {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? 1 : -1;
  const p = track.pointAtDist(3 + (3 - row) * 7);
  const lat = track.halfWidth * 0.45;
  return { x: p.x + leftX(p.heading) * side * lat, z: p.z + leftZ(p.heading) * side * lat, heading: p.heading, h: p.h };
}

export function createWorld(track: Track, entries: RacerEntry[], laps: number, seed = 1, prizes: number[] = PRIZES): World {
  const racers: Racer[] = entries.map((e, i) => {
    const g = gridSlot(track, i);
    const car = createVehicleState(e.spec, g.x, g.z, g.heading, g.h);
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
      prevFire: false,
      prevDrop: false,
      cooldown: 0,
      place: i + 1,
      finishPlace: 0,
      lastInput: emptyInput(),
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
  const spots = track.pieces.filter((p) => (p.code === 'S' || p.code === 'B') && p.index > 1);
  const count = Math.min(track.def.slime ?? 0, spots.length);
  for (let i = 0; i < count; i++) {
    const p = spots[Math.floor(((i + 0.5) * spots.length) / count)];
    const side = i % 2 === 0 ? 1 : -1;
    const pt = track.pointAtDist(p.startDist + p.length / 2);
    hazards.push({ id: id++, kind: 'slime', owner: -1, x: pt.x + leftX(pt.heading) * side * track.halfWidth * 0.4, y: pt.h, z: pt.z + leftZ(pt.heading) * side * track.halfWidth * 0.4, age: 0 });
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
  };
  updatePlaces(world);
  return world;
}

/** Distância total percorrida (para classificar). */
export function raceDistance(world: World, r: Racer): number {
  return (r.progress.lap - 1) * world.track.totalLength + r.progress.lastDist;
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

function damage(world: World, target: Racer, by: number, amount: number): void {
  if (!target.alive || target.invuln > 0) return;
  target.armor -= amount;
  if (target.armor <= 0) {
    target.armor = 0;
    target.alive = false;
    target.respawnTimer = RESPAWN_TIME;
    target.car.vx = target.car.vz = 0;
    const killer = world.racers[by];
    if (killer && by !== target.id) killer.kills++;
    world.events.push({ type: 'explode', racer: target.id, by, x: target.car.x, y: target.car.y, z: target.car.z });
  }
}

function respawn(world: World, r: Racer): void {
  const track = world.track;
  // volta um pouco na pista, no centro, virado para frente
  const p = track.pointAtDist(r.progress.lastDist - 6);
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
  world.projectiles.push({ id: world.nextId++, kind, owner: r.id, x, y, z, heading: car.heading, speed: w.speed + base, life: w.life, pieceIndex: car.pieceIndex });
  world.events.push({ type: 'fire', racer: r.id, kind, x, y, z });
}

function drop(world: World, r: Racer): void {
  const car = r.car;
  const kind = r.spec.rear;
  const back = (kind === 'oil' ? 3.8 : 3.2) * CAR_SCALE;
  const x = car.x - forwardX(car.heading) * back;
  const z = car.z - forwardZ(car.heading) * back;
  const q = world.track.query(x, z, car.pieceIndex);
  world.hazards.push({ id: world.nextId++, kind, owner: r.id, x, y: q.height, z, age: 0 });
  world.events.push({ type: 'drop', racer: r.id, kind });
}

function stepProjectiles(world: World, dt: number): void {
  const track = world.track;
  const alive: Projectile[] = [];
  for (const p of world.projectiles) {
    p.life -= dt;
    if (p.kind === 'missile') {
      // teleguiado suave: mira no carro mais próximo à frente, dentro de um cone
      let best: Racer | null = null;
      let bestD = 45;
      for (const r of world.racers) {
        if (r.id === p.owner || !r.alive) continue;
        const dx = r.car.x - p.x;
        const dz = r.car.z - p.z;
        const d = Math.hypot(dx, dz);
        const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - p.heading));
        if (d < bestD && ang < 0.6) {
          best = r;
          bestD = d;
        }
      }
      if (best) {
        const want = Math.atan2(best.car.x - p.x, best.car.z - p.z);
        const diff = wrapAngle(want - p.heading);
        p.heading += clamp(diff, -WEAPONS.missile.turnRate * dt, WEAPONS.missile.turnRate * dt);
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
        if (r.id === p.owner || !r.alive) continue;
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
    if (h.kind === 'mine') {
      if (h.age > WEAPONS.mine.life) dead = true;
      else if (h.age > WEAPONS.mine.armTime) {
        for (const r of world.racers) {
          if (!r.alive || !r.car.grounded) continue;
          if (Math.hypot(r.car.x - h.x, r.car.z - h.z) < WEAPONS.mine.radius) {
            if (r.invuln <= 0) {
              r.car.grounded = false;
              r.car.vy = WEAPONS.mine.hop;
              r.car.vx *= 0.5;
              r.car.vz *= 0.5;
            }
            world.events.push({ type: 'hit', target: r.id, by: h.owner, kind: 'mine', x: h.x, y: h.y, z: h.z });
            damage(world, r, h.owner, WEAPONS.mine.damage);
            dead = true;
            break;
          }
        }
      }
    } else if (h.kind === 'slime') {
      for (const r of world.racers) {
        if (!r.alive || !r.car.grounded) continue;
        if (Math.hypot(r.car.x - h.x, r.car.z - h.z) < WEAPONS.slime.radius) {
          const k = Math.exp(-WEAPONS.slime.drag * dt);
          r.car.vx *= k;
          r.car.vz *= k;
        }
      }
    } else {
      if (h.age > WEAPONS.oil.life) dead = true;
      else {
        for (const r of world.racers) {
          if (!r.alive || !r.car.grounded || r.spinTime > 0 || r.oilGrace > 0 || (r.id === h.owner && h.age < 1.5)) continue;
          if (Math.hypot(r.car.x - h.x, r.car.z - h.z) < WEAPONS.oil.radius && forwardSpeed(r.car) > 8) {
            r.spinTime = WEAPONS.oil.spinTime * (1 - (r.spec.spinResist ?? 0));
            r.spinTotal = r.spinTime;
            r.oilGrace = r.spinTime + 1.2;
            world.events.push({ type: 'spin', racer: r.id });
          }
        }
      }
    }
    if (!dead) keep.push(h);
  }
  world.hazards = keep;
}

function stepPickups(world: World, dt: number): void {
  for (const p of world.pickups) {
    if (!p.active) {
      p.respawn -= dt;
      if (p.respawn <= 0) p.active = true;
      continue;
    }
    for (const r of world.racers) {
      if (!r.alive) continue;
      if (Math.hypot(r.car.x - p.x, r.car.z - p.z) < 1.9 && Math.abs(r.car.y - p.y) < 2) {
        if (p.kind === 'money') r.money += PICKUP_MONEY;
        else r.armor = Math.min(r.spec.armor, r.armor + PICKUP_ARMOR);
        p.active = false;
        p.respawn = 15;
        world.events.push({ type: 'pickup', racer: r.id, kind: p.kind, x: p.x, y: p.y, z: p.z });
        break;
      }
    }
  }
}

/** Batidas entre carros: empurra para fora e troca velocidade na direção do contato. */
function collideCars(world: World): void {
  const rs = world.racers;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.car.x - a.car.x;
      const dz = b.car.z - a.car.z;
      const d = Math.hypot(dx, dz);
      const min = CAR_RADIUS * 2;
      if (d >= min || d < 1e-6 || Math.abs(a.car.y - b.car.y) > 1.5) continue;
      const nx = dx / d;
      const nz = dz / d;
      const ma = a.spec.mass;
      const mb = b.spec.mass;
      const pen = min - d;
      a.car.x -= nx * pen * (mb / (ma + mb));
      a.car.z -= nz * pen * (mb / (ma + mb));
      b.car.x += nx * pen * (ma / (ma + mb));
      b.car.z += nz * pen * (ma / (ma + mb));
      const rel = (b.car.vx - a.car.vx) * nx + (b.car.vz - a.car.vz) * nz;
      if (rel < 0) {
        const j = (-(1 + 0.35) * rel) / (1 / ma + 1 / mb);
        a.car.vx -= (j / ma) * nx;
        a.car.vz -= (j / ma) * nz;
        b.car.vx += (j / mb) * nx;
        b.car.vz += (j / mb) * nz;
        if (-rel > 3) world.events.push({ type: 'bump', a: a.id, b: b.id, strength: -rel });
      }
    }
}

/**
 * Avança o mundo um passo fixo. `humanInputs[id]` traz os comandos dos jogadores humanos;
 * os demais são decididos pela IA. Tudo determinístico (mesma semente + mesmos comandos = mesma corrida).
 */
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
    if (!world.started) input = emptyInput();
    else if (r.progress.finished && !r.ai) input = { ...emptyInput(), brake: 0.3 };
    else if (r.ai) input = computeAiInput(world, r, dt);
    else input = humanInputs[r.id] ?? emptyInput();

    let spec = r.spec;
    if (r.spinTime > 0) {
      // derrapando no óleo: perde aderência e gira
      r.spinTime -= dt;
      spec = { ...spec, grip: 0.6 };
      r.car.heading += ((Math.PI * 2) / r.spinTotal) * dt * (r.id % 2 === 0 ? 1 : -1);
      input = { ...input, throttle: 0, steer: 0, nitro: false };
    }
    r.lastInput = input;
    stepVehicle(r.car, spec, input, world.track, dt);

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
      if (ev?.type === 'lap') {
        // como no original, armas e nitro recarregam a cada volta
        r.frontCharges = r.spec.frontCharges;
        r.rearCharges = r.spec.rearCharges;
        r.car.nitroCharges = r.spec.nitroCharges;
        world.events.push({ type: 'lap', racer: r.id, lap: ev.lap });
      } else if (ev?.type === 'finish') {
        r.finishPlace = ++world.finishedCount;
        r.money += world.prizes[r.finishPlace - 1] ?? 0;
        world.events.push({ type: 'finish', racer: r.id, place: r.finishPlace });
      }
    }
  }

  collideCars(world);
  stepProjectiles(world, dt);
  stepHazards(world, dt);
  stepPickups(world, dt);
  updatePlaces(world);
}
