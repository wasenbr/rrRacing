import { emptyInput, type ControlInput } from '../sim/input';
import type { RacerProgress } from '../sim/race';
import type { VehicleState } from '../sim/vehicle';
import type { Hazard, Projectile, RacerEntry, World, WorldEvent } from '../sim/world';

/* ------------------------------------------------------------------ */
/* Mensagens da sala                                                   */
/* ------------------------------------------------------------------ */

export const MAX_PLAYERS = 4;

export interface LobbyPlayer {
  /** id do peer (o host usa 'host') */
  id: string;
  name: string;
  color: number;
  vehicleId: string;
}

/** Tudo que o convidado precisa para montar a mesma corrida do host. */
export interface OnlineRace {
  trackId: string;
  laps: number;
  seed: number;
  entries: RacerEntry[];
}

export type ClientMsg =
  | { t: 'hello'; name: string; color: number; vehicleId: string }
  | { t: 'input'; i: ControlInput };

export type HostMsg =
  | { t: 'lobby'; players: LobbyPlayer[]; racing: boolean; you: string }
  | { t: 'full' }
  | { t: 'start'; race: OnlineRace; you: number }
  | { t: 'snap'; s: WorldSnap }
  | { t: 'end' };

/* ------------------------------------------------------------------ */
/* Estado do mundo enviado pelo host                                   */
/* ------------------------------------------------------------------ */

interface RacerSnap {
  car: VehicleState;
  progress: RacerProgress;
  armor: number;
  frontCharges: number;
  rearCharges: number;
  money: number;
  kills: number;
  alive: boolean;
  invuln: number;
  spinTime: number;
  place: number;
  finishPlace: number;
  throttle: number;
}

export interface WorldSnap {
  time: number;
  started: boolean;
  finishedCount: number;
  racers: RacerSnap[];
  projectiles: Projectile[];
  /** só as poças/minas que mudam; as fixas do planeta o convidado já tem */
  hazards: Hazard[];
  /** pickups desativados (ids) */
  taken: number[];
  events: WorldEvent[];
}

/** Arredonda números (3 casas) para a mensagem ficar menor. */
function round<T>(v: T): T {
  if (typeof v === 'number') return (Math.round(v * 1000) / 1000) as T;
  if (Array.isArray(v)) return v.map(round) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = round(x);
    return o as T;
  }
  return v;
}

export function takeSnapshot(world: World, events: WorldEvent[]): WorldSnap {
  return round({
    time: world.raceTime,
    started: world.started,
    finishedCount: world.finishedCount,
    racers: world.racers.map((r) => ({
      car: r.car,
      progress: r.progress,
      armor: r.armor,
      frontCharges: r.frontCharges,
      rearCharges: r.rearCharges,
      money: r.money,
      kills: r.kills,
      alive: r.alive,
      invuln: r.invuln,
      spinTime: r.spinTime,
      place: r.place,
      finishPlace: r.finishPlace,
      throttle: r.lastInput.throttle,
    })),
    projectiles: world.projectiles,
    hazards: world.hazards.filter((h) => h.owner >= 0),
    taken: world.pickups.filter((p) => !p.active).map((p) => p.id),
    events,
  });
}

/** Aplica no mundo do convidado o estado vindo do host. */
export function applySnapshot(world: World, s: WorldSnap): void {
  world.raceTime = s.time;
  world.started = s.started;
  world.finishedCount = s.finishedCount;
  s.racers.forEach((rs, i) => {
    const r = world.racers[i];
    if (!r) return;
    Object.assign(r.car, rs.car);
    Object.assign(r.progress, rs.progress);
    r.armor = rs.armor;
    r.frontCharges = rs.frontCharges;
    r.rearCharges = rs.rearCharges;
    r.money = rs.money;
    r.kills = rs.kills;
    r.alive = rs.alive;
    r.invuln = rs.invuln;
    r.spinTime = rs.spinTime;
    r.place = rs.place;
    r.finishPlace = rs.finishPlace;
    r.lastInput = { ...emptyInput(), throttle: rs.throttle };
  });
  world.projectiles = s.projectiles;
  world.hazards = [...world.hazards.filter((h) => h.owner < 0), ...s.hazards];
  const taken = new Set(s.taken);
  for (const p of world.pickups) p.active = !taken.has(p.id);
  world.events = s.events;
}
