import { emptyInput, type ControlInput } from '../sim/input';
import type { RacerProgress } from '../sim/race';
import type { VehicleSpec, VehicleState } from '../sim/vehicle';
import type { Hazard, Projectile, RacerEntry, World, WorldEvent } from '../sim/world';
import type { NetCmd } from './inputs';

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
  /** ping (ms) medido pelo host; ausente = ainda sem medida (o host não tem) */
  ping?: number;
  /** caiu e o host guarda a vaga por alguns segundos */
  away?: boolean;
}

/** Tudo que o convidado precisa para montar a mesma corrida do host. */
export interface OnlineRace {
  trackId: string;
  laps: number;
  seed: number;
  entries: RacerEntry[];
}

export type ClientMsg =
  /** `rejoin`: ficha de sessão de quem caiu e está voltando (recebe o mesmo carro) */
  | { t: 'hello'; name: string; color: number; vehicleId: string; rejoin?: string }
  /** comandos dos últimos passos (ver `NetCmd`); o host aplica na ordem de `n` e devolve em `snap.a` */
  | { t: 'input'; c: NetCmd[] }
  /** o convidado montou a corrida e pode largar */
  | { t: 'ready' }
  /** aba oculta (celular): o host espera mais antes de dar como caído; `back`: voltou */
  | { t: 'away' }
  | { t: 'back' }
  /** saiu de propósito (o host não guarda a vaga) */
  | { t: 'leave' };

export type HostMsg =
  /** `token`: ficha de sessão deste convidado (para voltar se cair) */
  | { t: 'lobby'; players: LobbyPlayer[]; racing: boolean; you: string; token?: string }
  | { t: 'full' }
  /** `k`: sequência do primeiro estado desta corrida (os anteriores são descartados) */
  | { t: 'start'; race: OnlineRace; you: number; token?: string; k?: number }
  /**
   * `k`: sequência do estado; `a`: último comando (`n`) aplicado de cada carro (-1 = nenhum);
   * `cd`: contagem; `pe`: eventos do estado anterior (o canal rápido pode perder um); `aw`: carros
   * de quem está fora da tela; `dc`: de quem caiu e o host espera voltar
   */
  | { t: 'snap'; s: WorldSnap; k: number; a: number[]; cd: number; pe?: WorldEvent[]; aw?: number[]; dc?: number[] }
  /** fim da corrida: `s` é o estado final oficial; `bye`: o host saiu (a sala acabou) */
  | { t: 'end'; s?: WorldSnap; bye?: boolean }
  /** o host está com a aba oculta (ou voltou) */
  | { t: 'hostAway'; away: boolean };

/* ------------------------------------------------------------------ */
/* Validação do que chega pela rede (nada vindo de outro navegador é   */
/* confiável: vai para a simulação e para o HTML dos menus)            */
/* ------------------------------------------------------------------ */

/** Tamanho máximo (JSON) de uma mensagem do convidado. */
export const MAX_CLIENT_MSG = 1024;
export const MAX_NAME = 12;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampN = (v: unknown, lo: number, hi: number): number => Math.min(hi, Math.max(lo, fin(v)));
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Nome de piloto: texto curto, sem marcação HTML nem caracteres de controle. */
export function cleanName(v: unknown, fallback = 'Piloto'): string {
  if (typeof v !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f<>&"'`\\/=]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return s || fallback;
}

/** Cor da paleta: só aceita um valor exato da lista; senão a primeira livre. */
export function pickColor(want: unknown, used: ReadonlySet<number>, palette: readonly number[]): number {
  if (Number.isInteger(want) && palette.includes(want as number) && !used.has(want as number)) return want as number;
  return palette.find((c) => !used.has(c)) ?? palette[0];
}

/** Comando do convidado: faixas válidas, booleanos estritos, NaN vira 0. */
export function sanitizeInput(v: unknown): ControlInput {
  if (!isObj(v)) return emptyInput();
  return {
    throttle: clampN(v.throttle, 0, 1),
    brake: clampN(v.brake, 0, 1),
    steer: clampN(v.steer, -1, 1),
    fire: v.fire === true,
    drop: v.drop === true,
    nitro: v.nitro === true,
    sharp: v.sharp === true,
  };
}

/** Primeira mensagem do convidado. Devolve null se não for um `hello` válido. */
export function parseHello(m: unknown, vehicleIds: readonly string[]): { name: string; color: unknown; vehicleId: string; rejoin: unknown } | null {
  if (!isObj(m) || m.t !== 'hello') return null;
  const vehicleId = typeof m.vehicleId === 'string' && vehicleIds.includes(m.vehicleId) ? m.vehicleId : vehicleIds[0];
  return { name: cleanName(m.name), color: m.color, vehicleId, rejoin: m.rejoin };
}

/** Eventos soltos vindos do host (os de um estado anterior): só os válidos. */
export function validateEvents(v: unknown, nRacers: number): WorldEvent[] {
  if (!Array.isArray(v) || v.length > 400 || !plain(v)) return [];
  return v.filter((e) => validEvent(e, nRacers)) as WorldEvent[];
}

/** Lista de índices de carro (ex.: quem está fora da tela). */
export function parseRacerList(v: unknown, nRacers: number): number[] {
  if (!Array.isArray(v) || v.length > MAX_RACERS) return [];
  return v.filter((x) => isInt(x, 0, nRacers - 1)) as number[];
}

/** Lista de pilotos vinda do host. */
export function parseLobbyPlayers(v: unknown, palette: readonly number[], vehicleIds: readonly string[]): LobbyPlayer[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PLAYERS) return null;
  const out: LobbyPlayer[] = [];
  for (const p of v) {
    if (!isObj(p) || typeof p.id !== 'string' || p.id.length > 64) return null;
    out.push({
      id: p.id,
      name: cleanName(p.name),
      color: Number.isInteger(p.color) && palette.includes(p.color as number) ? (p.color as number) : palette[0],
      vehicleId: typeof p.vehicleId === 'string' && vehicleIds.includes(p.vehicleId) ? p.vehicleId : vehicleIds[0],
      ...(typeof p.ping === 'number' && Number.isFinite(p.ping) && p.ping >= 0 && p.ping <= 10000 && { ping: Math.round(p.ping) }),
      ...(p.away === true && { away: true }),
    });
  }
  return out;
}

const FRONT = ['laser', 'missile', 'sundog'];
const REAR = ['mine', 'oil', 'scatter'];
const ASSIST = ['nitro', 'jump'];
const TRACTION = ['wheels', 'treads', 'hover'];
const HAZARDS = ['mine', 'oil', 'scatter', 'slime', 'puddle', 'snow', 'lava'];
const SPEC_NUMS = [
  'maxSpeed', 'accel', 'brake', 'reverseMax', 'steerRate', 'grip', 'drag', 'nitroAccel', 'nitroCharges',
  'halfWidth', 'halfLength', 'armor', 'mass', 'frontCharges', 'rearCharges',
] as const;
const MAX_RACERS = 8;

function parseSpec(v: unknown, vehicleIds: readonly string[]): VehicleSpec | null {
  if (!isObj(v) || typeof v.id !== 'string' || !vehicleIds.includes(v.id)) return null;
  if (!FRONT.includes(v.front as string) || !REAR.includes(v.rear as string) || !ASSIST.includes(v.assist as string)) return null;
  if (v.traction !== undefined && !TRACTION.includes(v.traction as string)) return null;
  const spec: Record<string, unknown> = { id: v.id, name: cleanName(v.name, v.id), front: v.front, rear: v.rear, assist: v.assist };
  for (const k of SPEC_NUMS) {
    if (typeof v[k] !== 'number' || !Number.isFinite(v[k]) || Math.abs(v[k] as number) > 1e4) return null;
    spec[k] = v[k];
  }
  if (v.traction !== undefined) spec.traction = v.traction;
  if (v.landingLoss !== undefined) spec.landingLoss = clampN(v.landingLoss, 0, 1);
  if (v.spinResist !== undefined) spec.spinResist = clampN(v.spinResist, 0, 1);
  return spec as unknown as VehicleSpec;
}

/** Mensagem de largada vinda do host (grid, pista, voltas e o carro deste convidado). */
export function parseStart(m: unknown, vehicleIds: readonly string[], trackIds: readonly string[]): { race: OnlineRace; you: number } | null {
  if (!isObj(m) || !isObj(m.race)) return null;
  const r = m.race;
  if (typeof r.trackId !== 'string' || !trackIds.includes(r.trackId)) return null;
  if (!isInt(r.laps, 1, 20) || !isInt(r.seed, 0, 0x7fffffff)) return null;
  if (!Array.isArray(r.entries) || r.entries.length < 1 || r.entries.length > MAX_RACERS) return null;
  const entries: RacerEntry[] = [];
  for (const e of r.entries) {
    if (!isObj(e) || !isInt(e.color, 0, 0xffffff)) return null;
    const spec = parseSpec(e.spec, vehicleIds);
    if (!spec) return null;
    let ai: RacerEntry['ai'] = null;
    if (e.ai !== null) {
      if (!isObj(e.ai)) return null;
      ai = { skill: clampN(e.ai.skill, 0, 2), aggression: clampN(e.ai.aggression, 0, 2), lane: clampN(e.ai.lane, -20, 20) };
    }
    entries.push({ name: cleanName(e.name), color: e.color as number, spec, ai });
  }
  if (!isInt(m.you, 0, entries.length - 1)) return null;
  return { race: { trackId: r.trackId, laps: r.laps as number, seed: r.seed as number, entries }, you: m.you as number };
}

/** Todos os números finitos, textos curtos, listas e profundidade limitadas. */
function plain(v: unknown, depth = 0): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean' || v === null || v === undefined) return true;
  if (typeof v === 'string') return v.length <= 16;
  if (depth > 5) return false;
  if (Array.isArray(v)) return v.length <= 400 && v.every((x) => plain(x, depth + 1));
  if (isObj(v)) {
    const vals = Object.values(v);
    return vals.length <= 40 && vals.every((x) => plain(x, depth + 1));
  }
  return false;
}

/** Objeto só com números e booleanos (exceto a chave `skip`). */
function numBool(o: Record<string, unknown>, skip = ''): boolean {
  for (const [k, v] of Object.entries(o)) if (k !== skip && typeof v !== 'number' && typeof v !== 'boolean') return false;
  return true;
}

/** Evento com índices de carro válidos e tipos conhecidos (os outros são descartados). */
function validEvent(e: unknown, n: number): boolean {
  if (!isObj(e)) return false;
  const idx = (k: string) => isInt(e[k], 0, n - 1);
  switch (e.type) {
    case 'fire':
      return idx('racer') && FRONT.includes(e.kind as string);
    case 'drop':
      return idx('racer') && REAR.includes(e.kind as string);
    case 'hit':
      return idx('target') && isInt(e.by, -1, n - 1) && (FRONT.includes(e.kind as string) || e.kind === 'mine' || e.kind === 'scatter');
    case 'impact':
      return FRONT.includes(e.kind as string);
    case 'assist':
      return idx('racer') && ASSIST.includes(e.kind as string);
    case 'explode':
      return idx('racer') && isInt(e.by, -1, n - 1);
    case 'lapped':
      return idx('racer') && idx('victim');
    case 'pickup':
      return idx('racer') && (e.kind === 'money' || e.kind === 'armor');
    case 'bump':
      return idx('a') && idx('b');
    case 'fall':
    case 'burn':
    case 'spin':
    case 'respawn':
    case 'lap':
    case 'finish':
      return idx('racer');
    default:
      return false;
  }
}

/**
 * Estado vindo do host: confere a forma (mesmo número de carros, números finitos, tipos
 * conhecidos, índices de peça dentro da pista). Devolve null se não servir.
 */
export function validateSnap(s: unknown, nRacers: number, nPieces: number): WorldSnap | null {
  if (!isObj(s) || !plain(s)) return null;
  if (!Array.isArray(s.racers) || s.racers.length !== nRacers) return null;
  if (!Array.isArray(s.projectiles) || !Array.isArray(s.hazards) || !Array.isArray(s.taken) || !Array.isArray(s.events)) return null;
  const piece = (v: unknown) => isInt(v, 0, nPieces - 1);
  for (const r of s.racers) {
    if (!isObj(r) || !isObj(r.car) || !isObj(r.progress) || !piece(r.car.pieceIndex)) return null;
    const { car, progress, ...rest } = r;
    const { lapTimes, ...prog } = progress;
    if (!numBool(car) || !numBool(prog) || !numBool(rest) || !Array.isArray(lapTimes) || !lapTimes.every((t) => typeof t === 'number')) return null;
  }
  const projectiles = s.projectiles.filter((p) => isObj(p) && FRONT.includes(p.kind as string) && piece(p.pieceIndex) && isInt(p.owner, -1, nRacers - 1) && numBool(p, 'kind'));
  const hazards = s.hazards.filter((h) => isObj(h) && HAZARDS.includes(h.kind as string) && numBool(h, 'kind'));
  return {
    time: fin(s.time),
    started: s.started === true,
    finishedCount: isInt(s.finishedCount, 0, nRacers) ? s.finishedCount : 0,
    racers: s.racers as RacerSnap[],
    projectiles: projectiles as Projectile[],
    hazards: hazards as Hazard[],
    taken: s.taken.filter((x) => Number.isInteger(x)) as number[],
    events: s.events.filter((e) => validEvent(e, nRacers)) as WorldEvent[],
  };
}

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
