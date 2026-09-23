import type { AiProfile } from './ai';
import { buildSpec, CHARACTERS, newCarSetup, type CarSetup } from './garage';
import { clamp } from './math';
import type { ThemeId } from './track';
import type { VehicleSpec } from './vehicle';
import { PRIZES } from './world';

/**
 * Campanha no formato do original: 6 planetas, cada um com Divisão B e Divisão A.
 * Cada divisão é uma temporada de corridas; somando pontos suficientes você é promovido.
 */
export interface PlanetDef {
  id: string;
  name: string;
  theme: ThemeId;
  tracks: string[];
  /** rivais que correm neste planeta */
  rivals: string[];
}

export const PLANETS: PlanetDef[] = [
  { id: 'chem6', name: 'Chem VI', theme: 'chem6', tracks: ['chem6-1', 'chem6-2'], rivals: ['Rip', 'Shred', 'Viper Mackay'] },
  { id: 'drakonis', name: 'Drakonis', theme: 'drakonis', tracks: ['drakonis-1', 'drakonis-2'], rivals: ['Rip', 'Shred', 'Grinder X19'] },
  { id: 'bogmire', name: 'Bogmire', theme: 'bogmire', tracks: ['bogmire-1', 'bogmire-2'], rivals: ['Viper Mackay', 'Grinder X19', 'Butcher'] },
  { id: 'newmojave', name: 'New Mojave', theme: 'newmojave', tracks: ['newmojave-1', 'newmojave-2'], rivals: ['Shred', 'Butcher', 'Grinder X19'] },
  { id: 'nho', name: 'Nho', theme: 'nho', tracks: ['nho-1', 'nho-2'], rivals: ['Rip', 'Viper Mackay', 'Butcher'] },
  { id: 'inferno', name: 'Inferno', theme: 'inferno', tracks: ['inferno-1', 'inferno-2'], rivals: ['Grinder X19', 'Butcher', 'Viper Mackay'] },
];

export const DIVISIONS = ['B', 'A'] as const;
export const RACES_PER_SEASON = 4;
/** pontos por colocação (1º..4º) */
export const POINTS = [10, 6, 3, 0];
/** pontos para subir de divisão */
export const PROMOTE_POINTS = 24;
export const START_MONEY = 10000;
const SKILL_BASE = 0.6;
const SKILL_STEP = 0.03;

/** Personalidade e cor de cada rival (nomes do original). */
export const RIVALS: Record<string, { color: number; aggression: number; lane: number }> = {
  Rip: { color: 0xd8d8d8, aggression: 0.7, lane: 1.5 },
  Shred: { color: 0xe07a1a, aggression: 0.45, lane: -1.5 },
  'Viper Mackay': { color: 0x2fc840, aggression: 0.85, lane: 0 },
  'Grinder X19': { color: 0x8a8f9c, aggression: 0.6, lane: 1 },
  Butcher: { color: 0xa01818, aggression: 0.95, lane: -1 },
};

export interface CampaignState {
  version: 1;
  characterId: string;
  color: number;
  money: number;
  car: CarSetup;
  planet: number;
  division: number;
  /** corrida atual dentro da temporada (0..RACES_PER_SEASON-1) */
  race: number;
  points: number;
  champion: boolean;
  stats: { races: number; wins: number; kills: number; earnings: number };
}

export function newCampaign(characterId: string, color: number): CampaignState {
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
  };
}

/** Nível de dificuldade 0..11 (planeta × divisão). */
export function tier(s: CampaignState): number {
  return s.planet * 2 + s.division;
}

export function currentPlanet(s: CampaignState): PlanetDef {
  return PLANETS[s.planet];
}

export function currentTrackId(s: CampaignState): string {
  const p = currentPlanet(s);
  return p.tracks[s.race % p.tracks.length];
}

/** Prêmios crescem a cada planeta e divisão. */
export function prizesFor(s: CampaignState): number[] {
  const k = 1 + tier(s) * 0.3;
  return PRIZES.map((p) => Math.round((p * k) / 500) * 500);
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

/** Rivais ficam mais rápidos, mais armados e com carros melhores a cada divisão. */
export function opponentsFor(s: CampaignState, vehicles: Record<string, VehicleSpec>): OpponentSetup[] {
  const t = tier(s);
  // carros dos rivais por nível (o primeiro rival usa o melhor dos dois)
  const ladder: [string, string][] = [
    ['dirtdevil', 'dirtdevil'], ['dirtdevil', 'dirtdevil'], ['marauder', 'dirtdevil'], ['marauder', 'marauder'],
    ['airblade', 'marauder'], ['airblade', 'airblade'], ['battletrak', 'airblade'], ['battletrak', 'airblade'],
    ['havac', 'battletrak'], ['havac', 'battletrak'], ['havac', 'havac'], ['havac', 'havac'],
  ];
  const cars = ladder[Math.min(t, ladder.length - 1)];
  const level = Math.min(3, Math.floor((t + 1) / 3));
  return currentPlanet(s).rivals.map((name, i) => {
    const r = RIVALS[name];
    const setup = newCarSetup(cars[i === 0 ? 0 : i % 2]);
    setup.upgrades = { engine: level, tires: level, shocks: level, armor: level };
    return {
      name,
      color: r.color,
      spec: buildSpec(vehicles[setup.vehicleId], setup),
      ai: { skill: clamp(SKILL_BASE + t * SKILL_STEP + i * 0.03, 0, 0.97), aggression: r.aggression, lane: r.lane },
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
  s.points += pointsEarned;
  s.money += moneyEarned;
  s.race++;
  s.stats.races++;
  s.stats.kills += kills;
  s.stats.earnings += moneyEarned;
  if (place === 1) s.stats.wins++;

  let outcome: RaceOutcome = 'continue';
  if (s.points >= PROMOTE_POINTS) {
    if (s.division < DIVISIONS.length - 1) s.division++;
    else if (s.planet < PLANETS.length - 1) {
      s.planet++;
      s.division = 0;
    } else s.champion = true;
    outcome = s.champion ? 'champion' : 'promoted';
    s.race = 0;
    s.points = 0;
  } else if (s.race >= RACES_PER_SEASON) {
    // não somou pontos: a temporada recomeça (dinheiro e carro continuam)
    outcome = 'retry';
    s.race = 0;
    s.points = 0;
  }
  return { outcome, pointsEarned, moneyEarned };
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

export function decodeSave(code: string): CampaignState | null {
  try {
    const [b64, sum] = code.trim().split('.');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    if (checksum(json) !== Number(sum)) return null;
    const s = JSON.parse(json) as CampaignState;
    if (s.version !== 1 || !s.car || typeof s.money !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}
