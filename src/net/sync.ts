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
  /** `inst`: id desta aba (a mesma ficha em duas abas: o host recusa a nova se a antiga responde) */
  | { t: 'hello'; name: string; color: number; vehicleId: string; rejoin?: string; inst?: string }
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
  /** a mesma ficha já está em uso por outra aba que ainda responde */
  | { t: 'dup' }
  /**
   * `k`: sequência do primeiro estado desta corrida (os anteriores são descartados); `re`: volta a
   * uma corrida já largada (sem contagem); `ev`: primeiro id de evento importante que vale
   */
  | { t: 'start'; race: OnlineRace; you: number; token?: string; k?: number; re?: boolean; ev?: number }
  /** estado (vai em binário pelo canal rápido: ver encodeSnapMsg) */
  | SnapMsg
  /** volta, tempos, dinheiro e abates (canal confiável, só quando mudam) */
  | ProgMsg
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
export function parseHello(m: unknown, vehicleIds: readonly string[]): { name: string; color: unknown; vehicleId: string; rejoin: unknown; inst: string } | null {
  if (!isObj(m) || m.t !== 'hello') return null;
  const vehicleId = typeof m.vehicleId === 'string' && vehicleIds.includes(m.vehicleId) ? m.vehicleId : vehicleIds[0];
  const inst = typeof m.inst === 'string' && /^[a-z0-9]{8,16}$/.test(m.inst) ? m.inst : '';
  return { name: cleanName(m.name), color: m.color, vehicleId, rejoin: m.rejoin, inst };
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
  /** progresso, dinheiro e abates: no estado completo (fim da corrida); no binário vêm à parte (ProgMsg) */
  progress?: RacerProgress;
  /** do progresso, o que muda a todo passo (vai no estado binário) */
  dist?: number;
  wrong?: number;
  armor: number;
  frontCharges: number;
  rearCharges: number;
  money?: number;
  kills?: number;
  alive: boolean;
  invuln: number;
  spinTime: number;
  /** derrapagem/giro/proteção do óleo (a previsão do convidado parte deles; ausentes em host antigo) */
  spinTotal?: number;
  slipTime?: number;
  oilGrace?: number;
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
      spinTotal: r.spinTotal,
      slipTime: r.slipTime,
      oilGrace: r.oilGrace,
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
    if (rs.progress) Object.assign(r.progress, rs.progress);
    if (rs.dist !== undefined) r.progress.lastDist = rs.dist;
    if (rs.wrong !== undefined) r.progress.wrongWayTime = rs.wrong;
    r.armor = rs.armor;
    r.frontCharges = rs.frontCharges;
    r.rearCharges = rs.rearCharges;
    if (rs.money !== undefined) r.money = rs.money;
    if (rs.kills !== undefined) r.kills = rs.kills;
    r.alive = rs.alive;
    r.invuln = rs.invuln;
    r.spinTime = rs.spinTime;
    r.spinTotal = Math.max(0.05, fin(rs.spinTotal, r.spinTotal || 1)); // divisor do giro: nunca zero
    r.slipTime = fin(rs.slipTime, 0);
    r.oilGrace = fin(rs.oilGrace, 0);
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

/* ------------------------------------------------------------------ */
/* Estado em binário (canal rápido, 20x por segundo)                   */
/* ------------------------------------------------------------------ */

/** Evento importante (chegada, volta, explosão...) com id: vai repetido por ~1 s, o convidado deduplica. */
export interface IdEvent {
  i: number;
  e: WorldEvent;
}

export interface SnapMsg {
  t: 'snap';
  s: WorldSnap;
  /** sequência do estado */
  k: number;
  /** último comando (`n`) aplicado de cada carro (-1 = nenhum) */
  a: number[];
  /** contagem */
  cd: number;
  /** eventos do estado anterior (o canal rápido pode perder um) */
  pe?: WorldEvent[];
  /** carros de quem está fora da tela / de quem caiu e o host espera voltar */
  aw?: number[];
  dc?: number[];
  /** eventos importantes recentes, repetidos por ~1 s (ver IdEvent) */
  ie?: IdEvent[];
}

export interface ProgEntry {
  i: number;
  progress: RacerProgress;
  money: number;
  kills: number;
}

/** `k`: vale a partir do estado `k` (o convidado aplica junto com ele). */
export interface ProgMsg {
  t: 'prog';
  k: number;
  r: ProgEntry[];
}

/** Eventos que não podem se perder (vão com id em vários estados seguidos). */
const IMPORTANT = new Set<string>(['finish', 'lap', 'explode', 'lapped', 'fall', 'respawn']);
export const isImportant = (e: WorldEvent): boolean => IMPORTANT.has(e.type);

/** Progresso de um carro para a ProgMsg (sem o que muda a todo passo, que vai no binário). */
export function progEntry(i: number, r: { progress: RacerProgress; money: number; kills: number }): ProgEntry {
  return { i, progress: { ...r.progress, lapTimes: [...r.progress.lapTimes], lastDist: 0, wrongWayTime: 0 }, money: r.money, kills: r.kills };
}

/** Chave para saber se o progresso mudou desde o último envio. */
export function progKey(e: ProgEntry): string {
  const p = e.progress;
  return `${p.lap}|${p.lapStart}|${p.lapTimes.join(',')}|${+p.halfwayReached}|${+p.beforeLine}|${+p.finished}|${p.finishTime}|${e.money}|${e.kills}`;
}

/** ProgMsg vinda do host, conferida. */
export function parseProg(m: unknown, nRacers: number): ProgMsg | null {
  if (!isObj(m) || m.t !== 'prog' || !Number.isSafeInteger(m.k) || !Array.isArray(m.r) || m.r.length > MAX_RACERS) return null;
  const r: ProgEntry[] = [];
  for (const e of m.r) {
    if (!isObj(e) || !isInt(e.i, 0, nRacers - 1) || !isObj(e.progress)) return null;
    const p = e.progress;
    if (!Array.isArray(p.lapTimes) || p.lapTimes.length > 40 || !p.lapTimes.every((t) => typeof t === 'number' && Number.isFinite(t))) return null;
    if (!isInt(p.lap, 0, 64)) return null;
    r.push({
      i: e.i as number,
      progress: {
        lap: p.lap as number,
        lapStart: fin(p.lapStart),
        lapTimes: p.lapTimes as number[],
        lastDist: 0,
        halfwayReached: p.halfwayReached === true,
        beforeLine: p.beforeLine === true,
        wrongWayTime: 0,
        finished: p.finished === true,
        finishTime: fin(p.finishTime),
      },
      money: Math.round(clampN(e.money, -1e9, 1e9)),
      kills: isInt(e.kills, 0, 999) ? (e.kills as number) : 0,
    });
  }
  return { t: 'prog', k: m.k as number, r };
}

/** Aplica o progresso (sem mexer no que o estado binário traz: distância e contramão). */
export function applyProg(world: World, m: ProgMsg): void {
  for (const e of m.r) {
    const r = world.racers[e.i];
    if (!r) continue;
    const { lastDist, wrongWayTime } = r.progress;
    Object.assign(r.progress, e.progress, { lastDist, wrongWayTime });
    r.money = e.money;
    r.kills = e.kills;
  }
}

const WIRE_VER = 0x52;
const KINDS = ['laser', 'missile', 'sundog', 'mine', 'oil', 'scatter', 'nitro', 'jump', 'money', 'armor'];
type FieldKind = 'r' | 'f' | 'k' | 'n';
/** Campos de cada tipo de evento, na ordem do binário. */
const EVENT_FIELDS: Record<string, [string, FieldKind][]> = {
  fire: [['racer', 'r'], ['kind', 'k'], ['x', 'f'], ['y', 'f'], ['z', 'f']],
  drop: [['racer', 'r'], ['kind', 'k']],
  hit: [['target', 'r'], ['by', 'r'], ['kind', 'k'], ['x', 'f'], ['y', 'f'], ['z', 'f']],
  impact: [['kind', 'k'], ['x', 'f'], ['y', 'f'], ['z', 'f']],
  assist: [['racer', 'r'], ['kind', 'k']],
  fall: [['racer', 'r'], ['x', 'f'], ['y', 'f'], ['z', 'f']],
  lapped: [['racer', 'r'], ['victim', 'r'], ['bonus', 'n']],
  burn: [['racer', 'r']],
  spin: [['racer', 'r']],
  explode: [['racer', 'r'], ['by', 'r'], ['x', 'f'], ['y', 'f'], ['z', 'f'], ['bounty', 'n']],
  respawn: [['racer', 'r']],
  pickup: [['racer', 'r'], ['kind', 'k'], ['x', 'f'], ['y', 'f'], ['z', 'f']],
  lap: [['racer', 'r'], ['lap', 'n']],
  finish: [['racer', 'r'], ['place', 'n']],
  bump: [['a', 'r'], ['b', 'r'], ['strength', 'f']],
};
const EVENT_TYPES = Object.keys(EVENT_FIELDS);

/** Escritor com buffer que cresce; valores fora da faixa do campo são cortados. */
class Writer {
  private buf = new ArrayBuffer(1024);
  private dv = new DataView(this.buf);
  private o = 0;
  private need(n: number): void {
    if (this.o + n <= this.buf.byteLength) return;
    const b = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(b).set(new Uint8Array(this.buf));
    this.buf = b;
    this.dv = new DataView(b);
  }
  private int(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, Math.round(v) || 0));
  }
  u8(v: number): void {
    this.need(1);
    this.dv.setUint8(this.o++, this.int(v, 0, 255));
  }
  i8(v: number): void {
    this.need(1);
    this.dv.setInt8(this.o++, this.int(v, -128, 127));
  }
  u16(v: number): void {
    this.need(2);
    this.dv.setUint16(this.o, this.int(v, 0, 65535), true);
    this.o += 2;
  }
  i16(v: number): void {
    this.need(2);
    this.dv.setInt16(this.o, this.int(v, -32768, 32767), true);
    this.o += 2;
  }
  i32(v: number): void {
    this.need(4);
    this.dv.setInt32(this.o, this.int(v, -2147483648, 2147483647), true);
    this.o += 4;
  }
  f32(v: number): void {
    this.need(4);
    this.dv.setFloat32(this.o, Number.isFinite(v) ? v : 0, true);
    this.o += 4;
  }
  done(): ArrayBuffer {
    return this.buf.slice(0, this.o);
  }
}

/** Leitor: passar do fim ou número não finito lança (a mensagem inteira é recusada). */
class Reader {
  private dv: DataView;
  private o = 0;
  constructor(buf: ArrayBuffer) {
    this.dv = new DataView(buf);
  }
  u8(): number {
    return this.dv.getUint8(this.o++);
  }
  i8(): number {
    return this.dv.getInt8(this.o++);
  }
  u16(): number {
    const v = this.dv.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  i16(): number {
    const v = this.dv.getInt16(this.o, true);
    this.o += 2;
    return v;
  }
  i32(): number {
    const v = this.dv.getInt32(this.o, true);
    this.o += 4;
    return v;
  }
  f32(): number {
    const v = this.dv.getFloat32(this.o, true);
    this.o += 4;
    if (!Number.isFinite(v)) throw new Error('número inválido');
    return v;
  }
  get end(): boolean {
    return this.o === this.dv.byteLength;
  }
}

function writeEvents(w: Writer, list: readonly WorldEvent[], ids?: readonly number[]): void {
  const ok: [WorldEvent, number][] = [];
  list.forEach((e, j) => {
    if (EVENT_FIELDS[e.type] && ok.length < 255) ok.push([e, ids?.[j] ?? 0]);
  });
  w.u8(ok.length);
  for (const [e, id] of ok) {
    if (ids) w.i32(id);
    w.u8(EVENT_TYPES.indexOf(e.type));
    const o = e as unknown as Record<string, unknown>;
    for (const [k, t] of EVENT_FIELDS[e.type]) {
      const v = o[k] as number;
      if (t === 'r') w.i8(v);
      else if (t === 'k') w.u8(KINDS.indexOf(o[k] as string));
      else if (t === 'n') w.i32(v);
      else w.f32(v);
    }
  }
}

function readEvents(rd: Reader, n: number, withIds: boolean): IdEvent[] {
  const out: IdEvent[] = [];
  for (let j = rd.u8(); j > 0; j--) {
    const i = withIds ? rd.i32() : 0;
    const type = EVENT_TYPES[rd.u8()];
    if (!type) throw new Error('evento desconhecido');
    const e: Record<string, unknown> = { type };
    for (const [k, t] of EVENT_FIELDS[type]) {
      if (t === 'r') e[k] = rd.i8();
      else if (t === 'k') e[k] = KINDS[rd.u8()];
      else if (t === 'n') e[k] = rd.i32();
      else e[k] = rd.f32();
    }
    // tipo conhecido com índices de carro válidos (senão, descartado)
    if (validEvent(e, n)) out.push({ i, e: e as unknown as WorldEvent });
  }
  return out;
}

const toBits = (list: readonly number[] | undefined): number => (list ?? []).reduce((m, i) => (i >= 0 && i < 8 ? m | (1 << i) : m), 0);
const fromBits = (m: number, n: number): number[] => Array.from({ length: n }, (_, i) => i).filter((i) => m & (1 << i));

/**
 * Estado do host em binário (canal rápido): só os campos que o convidado usa, quantizados. Progresso,
 * dinheiro e abates não vão (ProgMsg, pelo canal confiável, quando mudam).
 */
export function encodeSnapMsg(m: SnapMsg): ArrayBuffer {
  const w = new Writer();
  const s = m.s;
  w.u8(WIRE_VER);
  w.i32(m.k);
  w.f32(m.cd);
  w.f32(s.time);
  w.u8(s.started ? 1 : 0);
  w.u8(s.finishedCount);
  w.u8(s.racers.length);
  s.racers.forEach((r, i) => {
    const c = r.car;
    w.f32(c.x);
    w.f32(c.y);
    w.f32(c.z);
    w.f32(c.heading);
    w.f32(c.vx);
    w.f32(c.vy);
    w.f32(c.vz);
    w.i16(c.pitch * 1e4);
    w.i16(c.roll * 1e4);
    w.i16(c.steer * 1e4);
    w.i16(c.steerHold * 1000);
    w.u16((((c.wheelSpin % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 1e4);
    w.u8(c.nitroCharges);
    w.u16(c.nitroTime * 1000);
    w.u16(c.jumpBuffer * 1000);
    w.u16(c.airTime * 1000);
    w.u16(c.landingImpact * 100);
    w.u16(c.wallImpact * 100);
    w.u8(c.drift * 255);
    w.u16(c.pieceIndex);
    w.u8((c.grounded ? 1 : 0) | (c.prevNitro ? 2 : 0) | (c.jumped ? 4 : 0) | (c.fell ? 8 : 0) | (c.assistFired ? 16 : 0) | (r.alive ? 32 : 0));
    w.f32(r.armor);
    w.u8(r.frontCharges);
    w.u8(r.rearCharges);
    w.u16(r.invuln * 1000);
    w.i16(r.spinTime * 1000);
    w.u16((r.spinTotal ?? 1) * 1000);
    w.u16((r.slipTime ?? 0) * 1000);
    w.u16((r.oilGrace ?? 0) * 1000);
    w.u8(r.place);
    w.u8(r.finishPlace);
    w.u8(r.throttle * 255);
    w.i32(m.a[i] ?? -1);
    w.f32(r.dist ?? r.progress?.lastDist ?? 0);
    w.u16((r.wrong ?? r.progress?.wrongWayTime ?? 0) * 100);
  });
  const pr = s.projectiles.slice(0, 255);
  w.u8(pr.length);
  for (const p of pr) {
    w.i32(p.id);
    w.u8(KINDS.indexOf(p.kind));
    w.i8(p.owner);
    w.f32(p.x);
    w.f32(p.y);
    w.f32(p.z);
    w.f32(p.heading);
    w.f32(p.speed);
    w.u16(p.life * 1000);
    w.u16(p.pieceIndex);
    w.u8(p.aim === undefined ? 0 : 1);
    if (p.aim !== undefined) w.f32(p.aim);
  }
  const hz = s.hazards.slice(0, 255);
  w.u8(hz.length);
  for (const h of hz) {
    w.i32(h.id);
    w.u8(HAZARDS.indexOf(h.kind));
    w.i8(h.owner);
    w.f32(h.x);
    w.f32(h.y);
    w.f32(h.z);
    w.u16(h.age * 100);
    w.u8((h.group !== undefined ? 1 : 0) | (h.spared !== undefined ? 2 : 0) | (h.spins !== undefined ? 4 : 0));
    if (h.group !== undefined) w.i32(h.group);
    if (h.spared !== undefined) w.i32(h.spared);
    if (h.spins !== undefined) w.u8(h.spins);
  }
  const tk = s.taken.slice(0, 255);
  w.u8(tk.length);
  for (const t of tk) w.u16(t);
  writeEvents(w, s.events);
  writeEvents(w, m.pe ?? []);
  const ie = m.ie ?? [];
  writeEvents(
    w,
    ie.map((x) => x.e),
    ie.map((x) => x.i),
  );
  w.u8(toBits(m.aw));
  w.u8(toBits(m.dc));
  return w.done();
}

/**
 * Estado binário vindo do host: confere versão, tamanho exato, número de carros, números finitos,
 * índices de peça e de carro, tipos conhecidos. Qualquer erro (curto demais, sobra, lixo): null.
 */
export function decodeSnapMsg(buf: unknown, nRacers: number, nPieces: number): SnapMsg | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength > 65536) return null;
  try {
    const rd = new Reader(buf);
    if (rd.u8() !== WIRE_VER) return null;
    const k = rd.i32();
    const cd = rd.f32();
    const time = rd.f32();
    const started = rd.u8() === 1;
    const finishedCount = rd.u8();
    if (rd.u8() !== nRacers || k < 0 || finishedCount > nRacers) return null;
    const racers: RacerSnap[] = [];
    const a: number[] = [];
    for (let i = 0; i < nRacers; i++) {
      const x = rd.f32(), y = rd.f32(), z = rd.f32(), heading = rd.f32(), vx = rd.f32(), vy = rd.f32(), vz = rd.f32();
      const pitch = rd.i16() / 1e4, roll = rd.i16() / 1e4, steer = rd.i16() / 1e4, steerHold = rd.i16() / 1000, wheelSpin = rd.u16() / 1e4;
      const nitroCharges = rd.u8(), nitroTime = rd.u16() / 1000, jumpBuffer = rd.u16() / 1000, airTime = rd.u16() / 1000;
      const landingImpact = rd.u16() / 100, wallImpact = rd.u16() / 100, drift = rd.u8() / 255, pieceIndex = rd.u16();
      const f = rd.u8();
      if (pieceIndex >= nPieces) return null;
      const car: VehicleState = {
        x, y, z, heading, vx, vy, vz, grounded: !!(f & 1), pieceIndex, pitch, roll, steer, steerHold, wheelSpin, nitroCharges, nitroTime,
        prevNitro: !!(f & 2), jumpBuffer, jumped: !!(f & 4), airTime, landingImpact, wallImpact, drift, fell: !!(f & 8), assistFired: !!(f & 16),
      };
      const rs: RacerSnap = {
        car, alive: !!(f & 32), armor: rd.f32(), frontCharges: rd.u8(), rearCharges: rd.u8(), invuln: rd.u16() / 1000, spinTime: rd.i16() / 1000,
        spinTotal: Math.max(0.05, rd.u16() / 1000), slipTime: rd.u16() / 1000, oilGrace: rd.u16() / 1000, place: rd.u8(), finishPlace: rd.u8(), throttle: rd.u8() / 255,
      };
      a.push(rd.i32());
      rs.dist = rd.f32();
      rs.wrong = rd.u16() / 100;
      racers.push(rs);
    }
    const projectiles: Projectile[] = [];
    for (let j = rd.u8(); j > 0; j--) {
      const p: Projectile = {
        id: rd.i32(), kind: KINDS[rd.u8()] as Projectile['kind'], owner: rd.i8(), x: rd.f32(), y: rd.f32(), z: rd.f32(),
        heading: rd.f32(), speed: rd.f32(), life: rd.u16() / 1000, pieceIndex: rd.u16(),
      };
      if (rd.u8() & 1) p.aim = rd.f32();
      if (FRONT.includes(p.kind) && p.owner >= -1 && p.owner < nRacers && p.pieceIndex < nPieces) projectiles.push(p);
    }
    const hazards: Hazard[] = [];
    for (let j = rd.u8(); j > 0; j--) {
      const h: Hazard = { id: rd.i32(), kind: HAZARDS[rd.u8()] as Hazard['kind'], owner: rd.i8(), x: rd.f32(), y: rd.f32(), z: rd.f32(), age: rd.u16() / 100 };
      const f = rd.u8();
      if (f & 1) h.group = rd.i32();
      if (f & 2) h.spared = rd.i32();
      if (f & 4) h.spins = rd.u8();
      if (h.kind && h.owner >= -1 && h.owner < nRacers) hazards.push(h);
    }
    const taken: number[] = [];
    for (let j = rd.u8(); j > 0; j--) taken.push(rd.u16());
    const events = readEvents(rd, nRacers, false).map((x) => x.e);
    const pe = readEvents(rd, nRacers, false).map((x) => x.e);
    const ie = readEvents(rd, nRacers, true);
    const aw = fromBits(rd.u8(), nRacers);
    const dc = fromBits(rd.u8(), nRacers);
    if (!rd.end) return null;
    const s: WorldSnap = { time, started, finishedCount, racers, projectiles, hazards, taken, events };
    return { t: 'snap', s, k, a, cd: Math.min(10, Math.max(0, cd)), pe, aw, dc, ie };
  } catch {
    return null;
  }
}
