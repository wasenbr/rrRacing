import { TRACKS } from '../data/tracks';
import type { AiProfile } from './ai';
import { buildSpec, CHARACTERS, CHARGE_KINDS, MAX_UPGRADE, maxExtraCharges, newCarSetup, UPGRADE_KINDS, type CarSetup } from './garage';
import { VEHICLES } from '../data/vehicles';
import { MAX_CHARGES } from './vehicle';
import { clamp } from './math';
import type { ThemeId } from './track';
import type { VehicleSpec } from './vehicle';
import { DIFFICULTY, type Difficulty } from './world';

/**
 * Campanha no formato do original (ver referencias/original.md): 6 planetas, cada um com
 * Divisão B e Divisão A. Cada divisão tem um número fixo de corridas; somando os pontos
 * necessários você sobe (B -> A -> próximo planeta). Rip e Shred correm em todos os planetas,
 * junto com o piloto local.
 */
export interface PlanetDef {
  id: string;
  name: string;
  theme: ThemeId;
  /** corridas por divisão */
  races: number;
  /** pontos para subir de divisão */
  promote: number;
  /** piloto local deste planeta */
  local: string;
  /** carros de Rip, Shred e do piloto local neste planeta */
  cars: [string, string, string];
}

export const PLANETS: PlanetDef[] = [
  { id: 'chem6', name: 'Chem VI', theme: 'chem6', races: 8, promote: 1600, local: 'Viper Mackay', cars: ['dirtdevil', 'dirtdevil', 'marauder'] },
  { id: 'drakonis', name: 'Drakonis', theme: 'drakonis', races: 10, promote: 2000, local: 'Grinder X19', cars: ['marauder', 'marauder', 'airblade'] },
  { id: 'bogmire', name: 'Bogmire', theme: 'bogmire', races: 12, promote: 2900, local: 'Ragewortt', cars: ['airblade', 'marauder', 'battletrak'] },
  { id: 'newmojave', name: 'New Mojave', theme: 'newmojave', races: 14, promote: 3200, local: 'Roadkill Kelly', cars: ['airblade', 'airblade', 'battletrak'] },
  { id: 'nho', name: 'Nho', theme: 'nho', races: 14, promote: 3200, local: 'Butcher Icebone', cars: ['battletrak', 'airblade', 'havac'] },
  { id: 'inferno', name: 'Inferno', theme: 'inferno', races: 14, promote: 3200, local: 'J. B. Slash', cars: ['havac', 'havac', 'havac'] },
];

export const DIVISIONS = ['B', 'A'] as const;
/** pontos por colocação (1º..4º), como no original */
export const POINTS = [400, 200, 100, 0];
/** prêmio em dinheiro por colocação na campanha (original) */
export const CAMPAIGN_PRIZES = [10000, 7000, 4000, 0];
export const START_MONEY = 10000;
const SKILL_BASE = 0.62;
const SKILL_STEP = 0.028;

/** Pistas de um planeta (as que existirem em TRACKS com o tema do planeta). */
export function planetTracks(p: PlanetDef): string[] {
  const ids = TRACKS.filter((t) => t.theme === p.theme).map((t) => t.id);
  return ids.length ? ids : [TRACKS[0].id];
}

const LOCAL_PURPLE = 0x5a1f8a;

/** Personalidade e cor de cada piloto rival (nomes do original). */
export const RIVALS: Record<string, { color: number; aggression: number; lane: number }> = {
  Rip: { color: 0xc8c8c8, aggression: 0.7, lane: 1.5 },
  Shred: { color: 0x8a5a2a, aggression: 0.5, lane: -1.5 },
  // como no original, o piloto local corre com o carro mais novo pintado de roxo escuro ("deep purple")
  'Viper Mackay': { color: LOCAL_PURPLE, aggression: 0.8, lane: 0 },
  'Grinder X19': { color: LOCAL_PURPLE, aggression: 0.65, lane: 1 },
  Ragewortt: { color: LOCAL_PURPLE, aggression: 0.85, lane: -0.5 },
  'Roadkill Kelly': { color: LOCAL_PURPLE, aggression: 0.75, lane: 0.5 },
  'Butcher Icebone': { color: LOCAL_PURPLE, aggression: 0.9, lane: -1 },
  'J. B. Slash': { color: LOCAL_PURPLE, aggression: 0.95, lane: 0 },
};

/** Carros à venda em cada planeta (original). */
const FOR_SALE: Record<string, string[]> = {
  chem6: ['dirtdevil', 'marauder', 'airblade'],
  drakonis: ['dirtdevil', 'marauder', 'airblade'],
  bogmire: ['marauder', 'battletrak'],
  newmojave: ['marauder', 'airblade', 'battletrak'],
  nho: ['airblade', 'battletrak', 'havac'],
  inferno: ['airblade', 'battletrak', 'havac'],
};

export function carsForSale(s: CampaignState): string[] {
  return FOR_SALE[currentPlanet(s).id] ?? Object.keys(FOR_SALE.chem6);
}

export interface CampaignState {
  version: 1;
  characterId: string;
  color: number;
  money: number;
  car: CarSetup;
  planet: number;
  division: number;
  /** corrida atual dentro da divisão (0..races-1) */
  race: number;
  points: number;
  champion: boolean;
  stats: { races: number; wins: number; kills: number; earnings: number };
  /** dificuldade escolhida no início (saves antigos: normal) */
  difficulty?: Difficulty;
}

export function newCampaign(characterId: string, color: number, difficulty: Difficulty = 'normal'): CampaignState {
  return {
    version: 1,
    characterId,
    color,
    money: START_MONEY,
    car: newCarSetup('dirtdevil'),
    planet: 0,
    division: 0,
    race: 0,
    points: 0,
    champion: false,
    stats: { races: 0, wins: 0, kills: 0, earnings: 0 },
    difficulty,
  };
}

export function difficultyOf(s: CampaignState): Difficulty {
  return s.difficulty ?? 'normal';
}

/** Nível de dificuldade 0..11 (planeta × divisão). */
export function tier(s: CampaignState): number {
  return s.planet * 2 + s.division;
}

export function currentPlanet(s: CampaignState): PlanetDef {
  return PLANETS[s.planet];
}

/** Corridas desta divisão e pontos para subir. */
export function seasonInfo(s: CampaignState): { races: number; promote: number; racesLeft: number } {
  const p = currentPlanet(s);
  return { races: p.races, promote: p.promote, racesLeft: p.races - s.race };
}

export function currentTrackId(s: CampaignState): string {
  const ids = planetTracks(currentPlanet(s));
  return ids[s.race % ids.length];
}

/** Prêmios da campanha (original): $10.000 / $7.000 / $4.000. */
export function prizesFor(_s: CampaignState): number[] {
  return [...CAMPAIGN_PRIZES];
}

export function playerSpec(s: CampaignState, vehicles: Record<string, VehicleSpec>): VehicleSpec {
  return buildSpec(vehicles[s.car.vehicleId], s.car, CHARACTERS.find((c) => c.id === s.characterId));
}

export interface OpponentSetup {
  name: string;
  color: number;
  spec: VehicleSpec;
  ai: AiProfile;
}

/** Nível das peças dos rivais em cada tier (planeta × divisão: Chem VI B = 0 … Inferno A = 11). */
export const RIVAL_LEVEL = [0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3];
/** Peça nível 3 só a partir de Bogmire (piloto local) — Rip e Shred chegam lá em Nho. */
const LEVEL3_FROM_TIER = 4;

/** Nível de melhoria de cada rival (0 = Rip, 1 = Shred, 2 = piloto local) neste tier. */
export function rivalLevel(t: number, index: number, difficulty: Difficulty = 'normal'): number {
  const cap = t < LEVEL3_FROM_TIER ? 2 : 3;
  // o piloto local tem um nível a mais (é o mais difícil de bater, como no original)
  return clamp(RIVAL_LEVEL[clamp(t, 0, RIVAL_LEVEL.length - 1)] + DIFFICULTY[difficulty].rivalUpgrade + (index === 2 ? 1 : 0), 0, cap);
}

/** Cargas extras de cada arma dos rivais: crescem a cada planeta (o local ganha uma a mais a partir de Bogmire). */
export function rivalExtraCharges(t: number, index: number): number {
  return Math.floor(t / 3) + (index === 2 && t >= LEVEL3_FROM_TIER ? 1 : 0);
}

/** Agressividade (vontade de atirar) cresce por planeta: Chem VI ~70 % da personalidade, Inferno no máximo. */
export function rivalAggression(base: number, t: number): number {
  return clamp(base * (0.7 + 0.06 * t), 0, 1);
}

/**
 * Rip, Shred e o piloto local. A cada divisão os rivais ficam mais hábeis, com carros mais melhorados,
 * mais cargas e mais agressivos; a dificuldade soma/subtrai um nível de melhoria.
 */
export function opponentsFor(s: CampaignState, vehicles: Record<string, VehicleSpec>, difficulty: Difficulty = difficultyOf(s)): OpponentSetup[] {
  const t = tier(s);
  const p = currentPlanet(s);
  const names = ['Rip', 'Shred', p.local];
  return names.map((name, i) => {
    const r = RIVALS[name];
    // na Divisão A, Rip troca o "modelo do ano passado" pelo carro atual do planeta
    const setup = newCarSetup(i === 0 && s.division === 1 ? p.cars[2] : p.cars[i]);
    const lv = rivalLevel(t, i, difficulty);
    setup.upgrades = { engine: lv, tires: lv, shocks: lv, armor: lv };
    const base = vehicles[setup.vehicleId];
    const extra = rivalExtraCharges(t, i);
    for (const k of CHARGE_KINDS) setup.charges[k] = Math.min(extra, maxExtraCharges(base, k));
    return {
      name,
      color: r.color,
      spec: buildSpec(base, setup),
      ai: { skill: clamp(SKILL_BASE + t * SKILL_STEP + (i === 2 ? 0.05 : i * 0.02), 0, 0.97), aggression: rivalAggression(r.aggression, t), lane: r.lane },
    };
  });
}

export type RaceOutcome = 'continue' | 'promoted' | 'retry' | 'champion';

export interface RaceReport {
  outcome: RaceOutcome;
  pointsEarned: number;
  moneyEarned: number;
}

/** Aplica o resultado de uma corrida à campanha (muta o estado). */
export function applyRaceResult(s: CampaignState, place: number, moneyEarned: number, kills: number): RaceReport {
  const pointsEarned = POINTS[place - 1] ?? 0;
  const planet = currentPlanet(s);
  s.points += pointsEarned;
  s.money += moneyEarned;
  s.race++;
  s.stats.races++;
  s.stats.kills += kills;
  s.stats.earnings += moneyEarned;
  if (place === 1) s.stats.wins++;

  let outcome: RaceOutcome = 'continue';
  if (s.race >= planet.races) {
    // campeão: as temporadas seguintes no Inferno são de exibição (dinheiro, sem nova promoção)
    if (s.champion) outcome = 'continue';
    // como no original, a divisão vai até a última corrida (dinheiro extra) e só então sobe
    else if (s.points >= planet.promote) outcome = promote(s);
    else outcome = 'retry'; // não somou pontos: a divisão recomeça (dinheiro e carro continuam)
    s.race = 0;
    s.points = 0;
  }
  return { outcome, pointsEarned, moneyEarned };
}

/** Prêmio de campeão da galáxia (entra no dinheiro e nos ganhos). */
export const CHAMPION_BONUS = 100000;

/** Sobe de divisão/planeta; na última divisão do Inferno vira campeão e leva o prêmio. */
function promote(s: CampaignState): RaceOutcome {
  if (s.division < DIVISIONS.length - 1) s.division++;
  else if (s.planet < PLANETS.length - 1) {
    s.planet++;
    s.division = 0;
  } else {
    s.champion = true;
    s.money += CHAMPION_BONUS;
    s.stats.earnings += CHAMPION_BONUS;
    return 'champion';
  }
  return 'promoted';
}

/** Promoção antecipada (o "Captain Braddock" do original): já tem os pontos, pode subir agora. */
export function canAdvanceEarly(s: CampaignState): boolean {
  return s.points >= currentPlanet(s).promote && !s.champion;
}

export function advanceEarly(s: CampaignState): RaceOutcome {
  if (!canAdvanceEarly(s)) return 'continue';
  const out = promote(s);
  s.race = 0;
  s.points = 0;
  return out;
}

/** Calendário da divisão atual: pista de cada corrida e quais já foram disputadas. */
export function seasonSchedule(s: CampaignState): { trackId: string; done: boolean; current: boolean }[] {
  const p = currentPlanet(s);
  const ids = planetTracks(p);
  return Array.from({ length: p.races }, (_, i) => ({ trackId: ids[i % ids.length], done: i < s.race, current: i === s.race }));
}

/* ---------- senha (save exportável), como as senhas do original ---------- */

function checksum(str: string): number {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 9973;
}

export function encodeSave(s: CampaignState): string {
  const json = JSON.stringify(s);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return `${b64}.${checksum(json)}`;
}

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Save coerente: piloto, carro, planeta, divisão, melhorias e cargas dentro do que o jogo aceita. */
export function validSave(s: CampaignState): boolean {
  if (!s || typeof s !== 'object' || s.version !== 1) return false;
  if (!CHARACTERS.some((c) => c.id === s.characterId)) return false;
  if (!isInt(s.color, 0, 0xffffff) || typeof s.money !== 'number' || !Number.isFinite(s.money) || s.money < 0) return false;
  if (!isInt(s.planet, 0, PLANETS.length - 1) || !isInt(s.division, 0, DIVISIONS.length - 1)) return false;
  if (!isInt(s.race, 0, PLANETS[s.planet].races) || typeof s.points !== 'number' || !Number.isFinite(s.points)) return false;
  if (s.difficulty !== undefined && !(s.difficulty in DIFFICULTY)) return false;
  const car = s.car;
  if (!car || typeof car !== 'object' || !VEHICLES[car.vehicleId] || !car.upgrades || !car.charges) return false;
  if (!UPGRADE_KINDS.every((k) => isInt(car.upgrades[k], 0, MAX_UPGRADE))) return false;
  if (!CHARGE_KINDS.every((k) => isInt(car.charges[k], 0, MAX_CHARGES))) return false;
  if (typeof s.champion !== 'boolean') return false;
  // estatísticas faltando (save antigo) não invalidam: decodeSave completa com zeros
  const st = s.stats;
  return st === undefined || (!!st && typeof st === 'object' && ['races', 'wins', 'kills', 'earnings'].every((k) => Number.isFinite((st as Record<string, unknown>)[k])));
}

export function decodeSave(code: string): CampaignState | null {
  try {
    const [b64, sum] = code.trim().split('.');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    if (checksum(json) !== Number(sum)) return null;
    const s = JSON.parse(json) as CampaignState;
    if (!validSave(s)) return null;
    s.stats ??= { races: 0, wins: 0, kills: 0, earnings: 0 };
    return s;
  } catch {
    return null;
  }
}
