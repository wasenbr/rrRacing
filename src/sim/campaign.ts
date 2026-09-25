import { TRACKS } from '../data/tracks';
import type { AiProfile } from './ai';
import { buildSpec, CAR_PRICES, carSwapCost, CHARACTERS, CHARGE_KINDS, chargePrice, MAX_UPGRADE, maxExtraCharges, newCarSetup, UPGRADE_KINDS, upgradePrice, type CarSetup, type ChargeKind } from './garage';
import { VEHICLES } from '../data/vehicles';
import { MAX_CHARGES } from './vehicle';
import { clamp } from './math';
import type { ThemeId } from './track';
import type { VehicleSpec } from './vehicle';
import { DIFFICULTY, type Difficulty } from './world';

/**
 * Campanha no formato do original (ver referencias/original.md): planetas com Divisão B e Divisão A;
 * somando os pontos necessários você sobe (B -> A -> próximo planeta). Rip e Shred correm em todos
 * os planetas, junto com o piloto local. Como no original, a dificuldade decide até onde vai a
 * campanha (Fácil: 3 planetas, Normal: 5, Difícil: os 6); o tamanho das divisões, a meta de pontos,
 * a repescagem e o dinheiro também mudam com ela (CAMPAIGN_RULES).
 */
export interface PlanetDef {
  id: string;
  name: string;
  theme: ThemeId;
  /** piloto local deste planeta (o chefe do duelo no fim da Divisão A) */
  local: string;
  /** carros de Rip, Shred e do piloto local neste planeta */
  cars: [string, string, string];
}

export const PLANETS: PlanetDef[] = [
  { id: 'chem6', name: 'Chem VI', theme: 'chem6', local: 'Viper Mackay', cars: ['dirtdevil', 'dirtdevil', 'marauder'] },
  { id: 'drakonis', name: 'Drakonis', theme: 'drakonis', local: 'Grinder X19', cars: ['marauder', 'marauder', 'airblade'] },
  { id: 'bogmire', name: 'Bogmire', theme: 'bogmire', local: 'Ragewortt', cars: ['airblade', 'marauder', 'battletrak'] },
  { id: 'newmojave', name: 'New Mojave', theme: 'newmojave', local: 'Roadkill Kelly', cars: ['airblade', 'airblade', 'battletrak'] },
  { id: 'nho', name: 'Nho', theme: 'nho', local: 'Butcher Icebone', cars: ['battletrak', 'airblade', 'havac'] },
  { id: 'inferno', name: 'Inferno', theme: 'inferno', local: 'J. B. Slash', cars: ['havac', 'havac', 'havac'] },
];

export const DIVISIONS = ['B', 'A'] as const;
/** pontos por colocação (1º..4º), como no original */
export const POINTS = [400, 200, 100, 0];
/** prêmio em dinheiro por colocação na campanha (original), antes do multiplicador de dinheiro */
export const CAMPAIGN_PRIZES = [10000, 7000, 4000, 0];
export const START_MONEY = 10000;
const SKILL_BASE = 0.62;
const SKILL_STEP = 0.028;

/** Regras da campanha em cada dificuldade. */
export interface CampaignRules {
  /** planetas da campanha (o título sai na Divisão A do último) */
  planets: number;
  /** corridas por divisão em cada planeta */
  races: number[];
  /** fração dos pontos possíveis (400 por corrida) exigida para subir */
  goal: number;
  /** duelos de repescagem contra o piloto local antes de a divisão recomeçar */
  playoffTries: number;
  /** multiplicador de todo o dinheiro ganho (prêmios, pista, abates, bônus) */
  money: number;
}

export const CAMPAIGN_RULES: Record<Difficulty, CampaignRules> = {
  // Rookie do original: até Bogmire
  easy: { planets: 3, races: [5, 5, 6], goal: 0.4, playoffTries: 3, money: 1.2 },
  // Veteran: até Nho
  normal: { planets: 5, races: [6, 6, 7, 7, 8], goal: 0.5, playoffTries: 2, money: 1 },
  // Warrior: a galáxia inteira, divisões longas, meta alta e dinheiro curto
  hard: { planets: 6, races: [8, 8, 9, 9, 10, 10], goal: 0.6, playoffTries: 1, money: 0.65 },
};

/**
 * O dinheiro rende mais a cada planeta até Nho (onde chega o Havac): no começo cada compra pesa, no fim
 * o prêmio é grande. No Inferno a loja é a mesma de Nho: o prêmio fica igual ao de Nho (o último
 * planeta nunca paga menos que o anterior) e a sobra é segurada pelo teto relativo à loja (hoardFactor).
 */
export const PLANET_MONEY = [0.7, 1, 1.4, 1.9, 2.1, 2.1];

/**
 * Teto relativo à loja: com mais dinheiro no bolso do que tudo o que a loja ainda pode vender (ver
 * shopHeadroom), o dinheiro da pista (coletas, abates, voltas) e os prêmios de 2º/3º rendem só esta
 * fração. Sem isso quem repetia divisões juntava $1–3 milhões sem ter onde gastar. O prêmio do 1º
 * lugar, os prêmios dos duelos e o bônus do chefe nunca caem (o clímax paga cheio).
 */
export const HOARD_MONEY = 0.25;
export const HOARD_CAP = 0.05;

/** Nível máximo das peças à venda em cada planeta (acompanha o nível dos rivais). */
export const SHOP_LEVEL = [1, 2, 3, 3, 3, 3];

/** Bônus por vencer o duelo contra o chefe do planeta (antes do multiplicador de dinheiro). */
export const BOSS_BONUS = 20000;

/**
 * Pintura de campeão: gasto opcional no último planeta da campanha, para o dinheiro que sobra depois
 * das peças e cargas (preço antes do multiplicador do planeta × dificuldade). Troca a cor do carro por
 * laranja-brasa, que nenhum outro piloto usa.
 */
export const CHAMPION_PAINT = { price: 50000, color: 0xff5a00 };

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

/**
 * Carros à venda em cada planeta: cada carro chega junto com o nível dos rivais (o Air Blade em
 * Drakonis, o Battle Trak em Bogmire, o Havac em Nho).
 */
const FOR_SALE: Record<string, string[]> = {
  chem6: ['dirtdevil', 'marauder'],
  drakonis: ['dirtdevil', 'marauder', 'airblade'],
  bogmire: ['marauder', 'airblade', 'battletrak'],
  newmojave: ['marauder', 'airblade', 'battletrak'],
  nho: ['airblade', 'battletrak', 'havac'],
  inferno: ['airblade', 'battletrak', 'havac'],
};

/**
 * Tier (planeta × divisão) em que cada carro chega à loja dentro do planeta que o vende. O Marauder
 * (o carro do Viper Mackay) só aparece na Divisão A da Chem VI: a Divisão B é do Dirt Devil, e o
 * dinheiro das primeiras corridas vai para as peças dele (que agora rendem, ver CAR_POTENTIAL).
 */
const CAR_FROM_TIER: Record<string, number> = { marauder: 1 };

export function carsForSale(s: CampaignState): string[] {
  const ids = FOR_SALE[currentPlanet(s).id] ?? FOR_SALE.chem6;
  return ids.filter((id) => tier(s) >= (CAR_FROM_TIER[id] ?? 0));
}

/** Carro vendido neste planeta mas só numa divisão seguinte ("Chega na Divisão A"); senão vazio. */
export function carComingSoon(s: CampaignState, vehicleId: string): string {
  const ids = FOR_SALE[currentPlanet(s).id] ?? [];
  if (!ids.includes(vehicleId) || carsForSale(s).includes(vehicleId)) return '';
  return `Chega na Divisão ${DIVISIONS[(CAR_FROM_TIER[vehicleId] ?? 0) % 2]}`;
}

/** Nível máximo de peça que a loja vende neste planeta. */
export function shopLevel(s: CampaignState): number {
  return SHOP_LEVEL[s.planet] ?? SHOP_LEVEL[SHOP_LEVEL.length - 1];
}

/** Planeta em que a loja passa a vender a peça de um nível (para avisar na loja). */
export function planetForLevel(level: number): PlanetDef | undefined {
  const i = SHOP_LEVEL.findIndex((l) => l >= level);
  return i >= 0 ? PLANETS[i] : undefined;
}

export interface CampaignState {
  version: 1;
  /** identidade da campanha (a mesma em todos os saves dela; saves antigos não têm) */
  id?: string;
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
  /** em repescagem: duelos que ainda restam contra o piloto local */
  playoff?: number;
  /** viagem para o planeta novo ainda não mostrada (índice do planeta de onde saiu) */
  warpFrom?: number;
  /** final da campanha ainda não mostrado (fechou o jogo na tela de resultados) */
  finalePending?: boolean;
  /**
   * corrida em andamento (largou e desistir custa): se o jogo for fechado ou recarregado no meio dela,
   * ao voltar conta como desistência (resolveAbandonedRace)
   */
  raceInProgress?: boolean;
  /** pintura especial comprada no último planeta (CHAMPION_PAINT) */
  paint?: 'champion';
}

export function newCampaign(characterId: string, color: number, difficulty: Difficulty = 'normal'): CampaignState {
  return {
    version: 1,
    id: Math.random().toString(36).slice(2, 10),
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

export function rulesOf(s: CampaignState): CampaignRules {
  return CAMPAIGN_RULES[difficultyOf(s)];
}

/** Nível de dificuldade 0..11 (planeta × divisão). */
export function tier(s: CampaignState): number {
  return s.planet * 2 + s.division;
}

export function currentPlanet(s: CampaignState): PlanetDef {
  return PLANETS[s.planet];
}

/** Planetas da campanha nesta dificuldade. */
export function planetCount(s: CampaignState): number {
  return rulesOf(s).planets;
}

/** Corridas de uma divisão no planeta dado. */
export function racesIn(s: CampaignState, planet = s.planet): number {
  const r = rulesOf(s).races;
  return r[Math.min(planet, r.length - 1)];
}

/** Pontos para subir: fração dos pontos possíveis (arredondada a 100). */
export function promoteGoal(s: CampaignState, planet = s.planet): number {
  return Math.round((racesIn(s, planet) * POINTS[0] * rulesOf(s).goal) / 100) * 100;
}

/** Corridas desta divisão e pontos para subir. */
export function seasonInfo(s: CampaignState): { races: number; promote: number; racesLeft: number } {
  const races = racesIn(s);
  return { races, promote: promoteGoal(s), racesLeft: Math.max(0, races - s.race) };
}

/**
 * Tipo da próxima corrida: normal (4 carros), duelo contra o chefe (última da Divisão A) ou
 * repescagem (duelo contra o piloto local depois de não somar os pontos).
 */
export type RaceKind = 'normal' | 'boss' | 'playoff';

export function raceKind(s: CampaignState): RaceKind {
  if (s.champion) return 'normal';
  if (s.playoff) return 'playoff';
  if (s.division === 1 && s.race === racesIn(s) - 1) return 'boss';
  return 'normal';
}

/** Pista de cada corrida da divisão: os duelos são na última pista do planeta (a "arena" do chefe). */
function trackOfRace(s: CampaignState, race: number, kind: RaceKind): string {
  const ids = planetTracks(currentPlanet(s));
  return kind === 'normal' ? ids[race % ids.length] : ids[ids.length - 1];
}

export function currentTrackId(s: CampaignState): string {
  return trackOfRace(s, s.race, raceKind(s));
}

const roundMoney = (n: number) => Math.round(n / 500) * 500;

/** Custo para levar um carro do setup dado às peças no nível `level` (as que ele aceita). */
function upgradesTo(setup: CarSetup, level: number): number {
  const probe = structuredClone(setup);
  let sum = 0;
  for (const k of UPGRADE_KINDS) {
    for (let p = upgradePrice(probe, k); p !== null && probe.upgrades[k] < level; p = upgradePrice(probe, k)) {
      sum += p;
      probe.upgrades[k]++;
    }
  }
  return sum;
}

/**
 * Escala dos preços das cargas: o mesmo multiplicador do dinheiro (planeta × dificuldade), sem o teto
 * (guardar dinheiro não barateia a loja). Assim uma carga pesa igual no começo e no fim da campanha.
 */
export function chargeScale(s: CampaignState): number {
  return prizeScale(s);
}

/** Preço da próxima carga extra na loja da campanha (null = já no máximo). */
export function campaignChargePrice(s: CampaignState, kind: ChargeKind, setup: CarSetup = s.car): number | null {
  const base = VEHICLES[setup.vehicleId];
  const p = chargePrice(setup, kind, base);
  return p === null ? null : Math.max(500, roundMoney(p * chargeScale(s)));
}

/**
 * Cargas extras por arma que contam no que a loja ainda vende (o jogador típico compra 1–2 por planeta;
 * contar até o máximo de 7 afrouxava o teto demais).
 */
export const CHARGE_ROOM = 2;

/** Custo das cargas que ainda faltam no carro (até CHARGE_ROOM extras por arma), com os preços deste planeta. */
function chargesTo(s: CampaignState, setup: CarSetup): number {
  const probe = structuredClone(setup);
  let sum = 0;
  for (const k of CHARGE_KINDS) {
    for (let p = campaignChargePrice(s, k, probe); p !== null && probe.charges[k] < CHARGE_ROOM; p = campaignChargePrice(s, k, probe)) {
      sum += p;
      probe.charges[k]++;
    }
  }
  return sum;
}

/**
 * Tudo o que a loja ainda pode vender de útil, neste planeta e, na Divisão A, também no próximo (para
 * quem guarda dinheiro para o próximo carro): o carro mais caro com as peças no nível da loja, já descontada a
 * revenda do atual; ou as peças que faltam no carro atual.
 */
export function shopHeadroom(s: CampaignState): number {
  const last = Math.min(s.planet + s.division, planetCount(s) - 1);
  let level = 0;
  const ids = new Set<string>();
  for (let p = s.planet; p <= last; p++) {
    level = Math.max(level, SHOP_LEVEL[p] ?? MAX_UPGRADE);
    for (const id of FOR_SALE[PLANETS[p].id] ?? []) ids.add(id);
  }
  const here = new Set(FOR_SALE[currentPlanet(s).id] ?? []);
  // só carros acima do atual na escada (CAR_PRICES segue a ordem do original)
  const order = Object.keys(CAR_PRICES);
  const mine = order.indexOf(s.car.vehicleId);
  // as cargas faltantes também contam (são compras de verdade na loja), mas só as dos carros deste
  // planeta: ninguém junta dinheiro para as cargas de um carro que ainda nem está à venda
  let most = upgradesTo(s.car, level) + chargesTo(s, s.car);
  // no último planeta, a pintura de campeão também é compra de verdade (o sobrante tem onde ir)
  const paint = paintPrice(s) ?? 0;
  for (const id of ids)
    if (order.indexOf(id) > mine)
      most = Math.max(most, carSwapCost(s.car, id) + upgradesTo(newCarSetup(id), level) + (here.has(id) ? chargesTo(s, newCarSetup(id)) : 0));
  return most + paint;
}

/**
 * Multiplicador do dinheiro no ponto atual da campanha (planeta × dificuldade); com mais no bolso do
 * que a loja tem para vender, só HOARD_MONEY disso.
 */
export function moneyScale(s: CampaignState): number {
  return prizeScale(s) * hoardFactor(s);
}

/** Multiplicador sem o teto (planeta × dificuldade): 1º lugar, duelos, bônus do chefe e preços da loja. */
export function prizeScale(s: CampaignState): number {
  return PLANET_MONEY[s.planet] * rulesOf(s).money;
}

/**
 * Fração do dinheiro que ainda rende: 1 enquanto houver o que comprar; HOARD_MONEY acima de tudo o
 * que a loja vende; HOARD_CAP bem acima disso (o dobro mais $100 mil), um teto na prática.
 */
export function hoardFactor(s: CampaignState): number {
  const room = shopHeadroom(s);
  if (s.money <= room) return 1;
  return s.money <= room * 2 + 100000 ? HOARD_MONEY : HOARD_CAP;
}

/** Dinheiro acima de tudo o que a loja ainda vende: pista e 2º/3º rendem menos (hoardFactor). */
export function moneyCapped(s: CampaignState): boolean {
  return hoardFactor(s) < 1;
}


/**
 * Prêmios da campanha: os do original ($10.000 / $7.000 / $4.000) × planeta × dificuldade. O teto
 * (hoardFactor) só reduz o 2º e o 3º lugar (e o prêmio de consolação do duelo); o 1º, o vencedor do
 * duelo e o bônus do chefe pagam sempre cheio.
 */
export function prizesFor(s: CampaignState): number[] {
  const k = prizeScale(s);
  const hoard = hoardFactor(s);
  const prizes = CAMPAIGN_PRIZES.map((p, i) => roundMoney(p * k * (i === 0 ? 1 : hoard)));
  // duelo: o vencedor leva o 1º prêmio (cheio), o perdedor o do 3º
  return raceKind(s) === 'normal' ? prizes : [prizes[0], prizes[2]];
}

/** Bônus por derrotar o chefe (ou vencer a repescagem): sem o teto, é o clímax do planeta. */
export function bossBonus(s: CampaignState): number {
  return roundMoney(BOSS_BONUS * prizeScale(s));
}

/** Pintura de campeão à venda: só no último planeta da campanha e enquanto não comprada. */
export function paintForSale(s: CampaignState): boolean {
  return s.planet === planetCount(s) - 1 && s.paint !== 'champion';
}

/** Preço da pintura de campeão (null: não está à venda aqui). */
export function paintPrice(s: CampaignState): number | null {
  return paintForSale(s) ? roundMoney(CHAMPION_PAINT.price * prizeScale(s)) : null;
}

/** Compra a pintura (muta o estado); devolve se comprou. */
export function buyPaint(s: CampaignState): boolean {
  const price = paintPrice(s);
  if (price === null || price > s.money) return false;
  s.money -= price;
  s.paint = 'champion';
  s.color = CHAMPION_PAINT.color;
  return true;
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
/**
 * Motor do piloto local por tier (o resto das peças dele vai um nível acima de Rip e Shred). O motor é
 * o que mais pesa na volta (~0,6 s por nível): na chegada a um planeta com carro novo e caro (Bogmire,
 * Nho) o local ainda não vem com o motor no talo, para o jogador ter tempo de juntar dinheiro.
 */
export const LOCAL_ENGINE = [0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 3, 3];
/**
 * Ritmo dos rivais (multiplica velocidade final e arranque) por tier e dificuldade: o ajuste fino que o
 * nível inteiro das peças não dá. Rodada 11: calibrado contra o piloto de referência (`referenceInput`:
 * centro da pista, acelera sempre, só DERRAPAR, sem tiro) com o carro do jogador mediano, em corridas
 * completas contra os 3 rivais: ele vence ~1/3 no Normal, bem mais no Fácil e pouco no Difícil. Em cada
 * tier Fácil ≤ Normal ≤ Difícil (antes o Difícil tinha rivais mais lentos que o Normal em Bogmire, Nho
 * e New Mojave) — o resto da dificuldade vem de habilidade, agressividade, peças e dano.
 */
export const LOCAL_PACE: Record<Difficulty, number[]> = {
  easy: [0.9, 0.86, 0.79, 0.8, 0.825, 0.82],
  normal: [0.915, 0.875, 0.805, 0.815, 0.86, 0.855, 0.855, 0.855, 0.85, 0.83],
  hard: [0.925, 0.885, 0.815, 0.825, 0.87, 0.865, 0.865, 0.865, 0.86, 0.84, 0.837, 0.849],
};
/** Na Divisão A do Inferno todos vêm com a preparação máxima (peças no 3 não bastam para evoluir). */
const INFERNO_PACE = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.01, 1.025];
/** J. B. Slash, o chefe final: motor e blindagem de campeão além do nível 3. */
const FINAL_BOSS = { pace: 1.03, armor: 1.25, skill: 0.99 };

const tierIndex = (t: number) => clamp(t, 0, RIVAL_LEVEL.length - 1);

/** Nível de melhoria de cada rival (0 = Rip, 1 = Shred, 2 = piloto local) neste tier. */
export function rivalLevel(t: number, index: number, difficulty: Difficulty = 'normal'): number {
  const cap = t < LEVEL3_FROM_TIER ? 2 : 3;
  // o piloto local tem um nível a mais (é o mais difícil de bater, como no original)
  return clamp(RIVAL_LEVEL[tierIndex(t)] + DIFFICULTY[difficulty].rivalUpgrade + (index === 2 ? 1 : 0), 0, cap);
}

/**
 * Nível do motor de cada rival neste tier. No Difícil o nível a mais vale para pneus, amortecedores e
 * blindagem (rivais mais duros de derrubar); a velocidade a mais vem do ritmo (LOCAL_PACE).
 */
export function rivalEngine(t: number, index: number, difficulty: Difficulty = 'normal'): number {
  const tt = tierIndex(t);
  // Rip e Shred nunca com motor acima do piloto local
  const base = index === 2 ? LOCAL_ENGINE[tt] : Math.min(RIVAL_LEVEL[tt], LOCAL_ENGINE[tt]);
  // (rodada 11: o Fácil não tira mais um nível de motor — com ele o piloto de referência vencia 96%)
  return clamp(base, 0, rivalLevel(t, index, difficulty));
}

/** Ritmo (velocidade final e arranque) de cada rival: o local segue LOCAL_PACE; no Inferno A todos aceleram. */
export function rivalPace(t: number, _index: number, difficulty: Difficulty = 'normal'): number {
  const tt = tierIndex(t);
  const local = LOCAL_PACE[difficulty][Math.min(tt, LOCAL_PACE[difficulty].length - 1)];
  // o mesmo ritmo para os três (Rip e Shred já vêm com carro e peças abaixo do local)
  return local * INFERNO_PACE[tt];
}

/** Cargas extras de cada arma dos rivais: crescem a cada divisão e meia (o local ganha uma a mais a partir de Bogmire). */
export function rivalExtraCharges(t: number, index: number): number {
  return Math.floor((t + 1) / 3) + (index === 2 && t >= LEVEL3_FROM_TIER ? 1 : 0);
}

/** Agressividade (vontade de atirar) cresce por planeta: Chem VI ~70 % da personalidade, Inferno no máximo. */
export function rivalAggression(base: number, t: number): number {
  return clamp(base * (0.7 + 0.06 * t), 0, 1);
}

/** Aplica o ritmo à ficha (velocidade final, arranque e turbo). */
function withPace(spec: VehicleSpec, pace: number): VehicleSpec {
  return pace === 1 ? spec : { ...spec, maxSpeed: spec.maxSpeed * pace, accel: spec.accel * pace, nitroAccel: spec.nitroAccel * pace };
}

/**
 * Rip, Shred e o piloto local. A cada divisão os rivais ficam mais hábeis, com carros mais melhorados,
 * mais cargas e mais agressivos; a dificuldade soma/subtrai um nível de melhoria. Nos duelos (chefe e
 * repescagem) corre só o piloto local, turbinado.
 */
export function opponentsFor(s: CampaignState, vehicles: Record<string, VehicleSpec>, difficulty: Difficulty = difficultyOf(s)): OpponentSetup[] {
  if (raceKind(s) !== 'normal') return [bossOf(s, vehicles, difficulty)];
  const t = tier(s);
  const p = currentPlanet(s);
  const names = ['Rip', 'Shred', p.local];
  return names.map((name, i) => {
    const r = RIVALS[name];
    // na Divisão A, Rip troca o "modelo do ano passado" pelo carro atual do planeta
    const setup = newCarSetup(i === 0 && s.division === 1 ? p.cars[2] : p.cars[i]);
    const lv = rivalLevel(t, i, difficulty);
    setup.upgrades = { engine: rivalEngine(t, i, difficulty), tires: lv, shocks: lv, armor: lv };
    const base = vehicles[setup.vehicleId];
    const extra = rivalExtraCharges(t, i);
    for (const k of CHARGE_KINDS) setup.charges[k] = Math.min(extra, maxExtraCharges(base, k));
    return {
      name,
      color: r.color,
      spec: withPace(buildSpec(base, setup), rivalPace(t, i, difficulty)),
      ai: { skill: clamp(SKILL_BASE + t * SKILL_STEP + (i === 2 ? 0.05 : i * 0.02), 0, 0.97), aggression: rivalAggression(r.aggression, t), lane: r.lane },
    };
  });
}

/**
 * O chefe do planeta (o piloto local) no duelo: peças um nível acima do normal dele (até o 3 em
 * qualquer planeta), duas cargas a mais em cada arma, mais hábil e sem medo de atirar. J. B. Slash, o
 * chefe do último planeta, ainda tem motor e blindagem de campeão (FINAL_BOSS).
 */
export function bossOf(s: CampaignState, vehicles: Record<string, VehicleSpec>, difficulty: Difficulty = difficultyOf(s)): OpponentSetup {
  const t = tier(s);
  const p = currentPlanet(s);
  const setup = newCarSetup(p.cars[2]);
  const lv = clamp(rivalLevel(t, 2, difficulty) + 1, 0, MAX_UPGRADE);
  setup.upgrades = { engine: clamp(rivalEngine(t, 2, difficulty) + 1, 0, MAX_UPGRADE), tires: lv, shocks: lv, armor: lv };
  const base = vehicles[setup.vehicleId];
  for (const k of CHARGE_KINDS) setup.charges[k] = Math.min(rivalExtraCharges(t, 2) + 2, maxExtraCharges(base, k));
  const r = RIVALS[p.local];
  const final = p === PLANETS[PLANETS.length - 1];
  let spec = withPace(buildSpec(base, setup), rivalPace(t, 2, difficulty) * (final ? FINAL_BOSS.pace : 1));
  if (final) spec = { ...spec, armor: Math.round(spec.armor * FINAL_BOSS.armor) };
  return {
    name: p.local,
    color: r.color,
    spec,
    ai: { skill: final ? FINAL_BOSS.skill : clamp(SKILL_BASE + t * SKILL_STEP + 0.1, 0, 0.98), aggression: 1, lane: r.lane },
  };
}

export type RaceOutcome = 'continue' | 'promoted' | 'retry' | 'champion' | 'playoff';

export interface RaceReport {
  outcome: RaceOutcome;
  /** tipo da corrida que acabou de ser disputada */
  kind: RaceKind;
  pointsEarned: number;
  /** dinheiro da corrida mais o bônus do chefe */
  moneyEarned: number;
  /** bônus por derrotar o chefe (já somado em moneyEarned) */
  bonus: number;
  /** repescagem: duelos que ainda restam */
  playoffLeft: number;
}

/** Aplica o resultado de uma corrida à campanha (muta o estado). `moneyEarned`: prêmio + pista. */
export function applyRaceResult(s: CampaignState, place: number, moneyEarned: number, kills: number): RaceReport {
  const kind = raceKind(s);
  const won = place === 1;
  // duelo contra o chefe: só a vitória pontua; a repescagem não soma pontos (decide sozinha)
  const pointsEarned = kind === 'playoff' ? 0 : kind === 'boss' ? (won ? POINTS[0] : 0) : (POINTS[place - 1] ?? 0);
  const bonus = kind !== 'normal' && won ? bossBonus(s) : 0;
  const earned = moneyEarned + bonus;
  delete s.raceInProgress; // a corrida foi contada
  s.money += earned;
  s.stats.races++;
  s.stats.kills += kills;
  s.stats.earnings += earned;
  if (won) s.stats.wins++;
  const report = (outcome: RaceOutcome): RaceReport => ({ outcome, kind, pointsEarned, moneyEarned: earned, bonus, playoffLeft: s.playoff ?? 0 });

  if (kind === 'playoff') {
    if (won) {
      endSeason(s);
      return report(promote(s));
    }
    s.playoff = (s.playoff ?? 1) - 1;
    if (s.playoff > 0) return report('playoff');
    endSeason(s);
    return report('retry');
  }

  s.points += pointsEarned;
  s.race++;
  if (s.race < racesIn(s)) return report('continue');
  // campeão: as temporadas seguintes no último planeta são de exibição (dinheiro, sem nova promoção)
  if (s.champion) {
    endSeason(s);
    return report('continue');
  }
  // como no original, a divisão vai até a última corrida (dinheiro extra) e só então sobe;
  // na Divisão A também é preciso derrotar o chefe no duelo final
  if (s.points >= promoteGoal(s) && (s.division === 0 || (kind === 'boss' && won))) {
    endSeason(s);
    return report(promote(s));
  }
  // faltou: repescagem contra o piloto local (a divisão só recomeça se perder todos os duelos)
  const tries = rulesOf(s).playoffTries;
  if (tries > 0) {
    s.playoff = tries;
    return report('playoff');
  }
  endSeason(s);
  return report('retry'); // a divisão recomeça (dinheiro e carro continuam)
}

function endSeason(s: CampaignState): void {
  s.race = 0;
  s.points = 0;
  delete s.playoff;
}

/** Prêmio de campeão da galáxia (entra no dinheiro e nos ganhos). */
export const CHAMPION_BONUS = 100000;

/** Sobe de divisão/planeta; na Divisão A do último planeta da dificuldade vira campeão e leva o prêmio. */
function promote(s: CampaignState): RaceOutcome {
  if (s.division < DIVISIONS.length - 1) s.division++;
  else if (s.planet < planetCount(s) - 1) {
    // a viagem fica pendente no save até ser mostrada (recarregar a página não a perde)
    s.warpFrom = s.planet;
    s.planet++;
    s.division = 0;
  } else {
    s.champion = true;
    s.finalePending = true;
    s.money += CHAMPION_BONUS;
    s.stats.earnings += CHAMPION_BONUS;
    return 'champion';
  }
  return 'promoted';
}

/** Na Campanha, desistir de uma corrida custa (conta como último); no Fácil e depois do título é de graça. */
export function forfeitCosts(s: CampaignState): boolean {
  return difficultyOf(s) !== 'easy' && !s.champion;
}

/**
 * Desistir (sair ou reiniciar no meio da corrida): conta como último lugar, sem o dinheiro da corrida.
 * Num duelo (chefe ou repescagem) é derrota: gasta a tentativa. Devolve null quando sai de graça.
 */
export function forfeitRace(s: CampaignState): RaceReport | null {
  if (!forfeitCosts(s)) return null;
  const last = raceKind(s) === 'normal' ? POINTS.length : 2;
  return applyRaceResult(s, last, 0, 0);
}

/**
 * Largou (world.started): se desistir custa, marca a corrida em andamento no save. Fechar ou recarregar
 * o jogo no meio dela não escapa da desistência (ver resolveAbandonedRace). Devolve se marcou.
 */
export function markRaceStarted(s: CampaignState): boolean {
  if (!forfeitCosts(s)) return false;
  s.raceInProgress = true;
  return true;
}

/**
 * Save com corrida em andamento (o jogo foi fechado ou recarregado no meio dela): aplica a desistência
 * (último lugar) e limpa a marca. Devolve o relatório, ou null quando não havia corrida pendente ou
 * ela sai de graça.
 */
export function resolveAbandonedRace(s: CampaignState): RaceReport | null {
  if (!s.raceInProgress) return null;
  delete s.raceInProgress;
  return forfeitRace(s);
}

/**
 * Promoção antecipada (o "Captain Braddock" do original): já tem os pontos, pode subir agora.
 * Na Divisão A o atalho leva direto ao duelo contra o chefe.
 */
export function canAdvanceEarly(s: CampaignState): boolean {
  return s.points >= promoteGoal(s) && !s.champion && raceKind(s) === 'normal';
}

export function advanceEarly(s: CampaignState): RaceOutcome {
  if (!canAdvanceEarly(s)) return 'continue';
  if (s.division === 1) {
    s.race = racesIn(s) - 1;
    return 'continue';
  }
  endSeason(s);
  return promote(s);
}

/** Calendário da divisão atual: pista de cada corrida, quais já foram disputadas e o duelo do chefe. */
export function seasonSchedule(s: CampaignState): { trackId: string; done: boolean; current: boolean; boss: boolean }[] {
  const n = racesIn(s);
  return Array.from({ length: n }, (_, i) => {
    const boss = !s.champion && s.division === 1 && i === n - 1;
    return { trackId: trackOfRace(s, i, boss ? 'boss' : 'normal'), done: i < s.race, current: i === s.race && !s.playoff, boss };
  });
}

/** Novidades do planeta novo (quadro final da viagem): carros à venda, nível das peças, rivais e prêmio. */
export interface PlanetNews {
  /** carros que passam a ser vendidos (agora ou na Divisão A deste planeta) */
  newCars: { id: string; when: string }[];
  /** nível máximo das peças na loja e se subiu na chegada */
  shopLevel: number;
  levelUp: boolean;
  /** Rip, Shred e o piloto local, com os carros deste planeta */
  rivals: { name: string; vehicleId: string; color: number }[];
  /** prêmio do 1º lugar aqui */
  firstPrize: number;
}

export function planetNews(s: CampaignState, vehicles: Record<string, VehicleSpec>): PlanetNews {
  const prev: CampaignState = { ...s, planet: Math.max(0, s.planet - 1), division: 1, playoff: undefined };
  const before = new Set(carsForSale(prev));
  const here = FOR_SALE[currentPlanet(s).id] ?? [];
  const newCars = here.filter((id) => !before.has(id)).map((id) => ({ id, when: carComingSoon(s, id) || 'À venda já' }));
  return {
    newCars,
    shopLevel: shopLevel(s),
    levelUp: s.planet > 0 && shopLevel(s) > shopLevel(prev),
    rivals: opponentsFor({ ...s, race: 0, playoff: undefined }, vehicles).map((o) => ({ name: o.name, vehicleId: o.spec.id, color: o.color })),
    firstPrize: prizesFor({ ...s, race: 0, playoff: undefined })[0],
  };
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
  // (saves de antes das regras por dificuldade tinham divisões de até 14 corridas: fitRules ajusta)
  if (!isInt(s.race, 0, 14) || typeof s.points !== 'number' || !Number.isFinite(s.points)) return false;
  if (s.difficulty !== undefined && !(s.difficulty in DIFFICULTY)) return false;
  if (s.playoff !== undefined && !isInt(s.playoff, 1, 9)) return false;
  const car = s.car;
  if (!car || typeof car !== 'object' || !VEHICLES[car.vehicleId] || !car.upgrades || !car.charges) return false;
  if (!UPGRADE_KINDS.every((k) => isInt(car.upgrades[k], 0, MAX_UPGRADE))) return false;
  if (!CHARGE_KINDS.every((k) => isInt(car.charges[k], 0, MAX_CHARGES))) return false;
  if (typeof s.champion !== 'boolean') return false;
  // campeão só na Divisão A do último planeta da dificuldade (saves antigos além do fim: fitRules ajusta)
  if (s.champion && (s.division !== 1 || s.planet < CAMPAIGN_RULES[s.difficulty ?? 'normal'].planets - 1)) return false;
  if (s.warpFrom !== undefined && !isInt(s.warpFrom, 0, s.planet - 1)) return false;
  if (s.finalePending !== undefined && (typeof s.finalePending !== 'boolean' || (s.finalePending && !s.champion))) return false;
  if (s.raceInProgress !== undefined && typeof s.raceInProgress !== 'boolean') return false;
  if (s.paint !== undefined && s.paint !== 'champion') return false;
  if (s.id !== undefined && (typeof s.id !== 'string' || s.id.length > 32)) return false;
  // estatísticas faltando (save antigo) não invalidam: decodeSave completa com zeros
  const st = s.stats;
  return st === undefined || (!!st && typeof st === 'object' && ['races', 'wins', 'kills', 'earnings'].every((k) => Number.isFinite((st as Record<string, unknown>)[k])));
}

/**
 * Encaixa um save nas regras atuais (saves de antes das regras por dificuldade): planeta além do
 * fim da campanha fica na Divisão A do último; corrida além do fim da divisão vai para a última.
 */
function fitRules(s: CampaignState): CampaignState {
  if (s.planet >= planetCount(s)) {
    s.planet = planetCount(s) - 1;
    s.division = 1;
  }
  if (s.warpFrom !== undefined && s.warpFrom >= s.planet) delete s.warpFrom;
  // repescagem: no máximo as tentativas da dificuldade
  if (s.playoff) s.playoff = Math.min(s.playoff, rulesOf(s).playoffTries);
  if (s.playoff) s.race = racesIn(s);
  else s.race = Math.min(s.race, racesIn(s) - 1);
  return s;
}

export function decodeSave(code: string): CampaignState | null {
  try {
    const [b64, sum] = code.trim().split('.');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    if (checksum(json) !== Number(sum)) return null;
    const s = JSON.parse(json) as CampaignState;
    if (!validSave(s)) return null;
    s.stats ??= { races: 0, wins: 0, kills: 0, earnings: 0 };
    return fitRules(s);
  } catch {
    return null;
  }
}
