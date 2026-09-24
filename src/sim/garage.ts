import { MAX_CHARGES, WEAPON_NAMES, type VehicleSpec } from './vehicle';
import { WEAPONS } from './world';
import { VEHICLES } from '../data/vehicles';

/**
 * Pilotos do original. Cada um tem duas habilidades (+1 cada); Olaf (secreto) tem as quatro.
 * O efeito de cada nível está em buildSpec.
 */
export interface Character {
  id: string;
  name: string;
  homeworld: string;
  bonus: { accel?: number; topSpeed?: number; cornering?: number; jumping?: number };
  description: string;
  secret?: boolean;
}

export const CHARACTERS: Character[] = [
  { id: 'tarquinn', name: 'Tarquinn', homeworld: 'Aurora', bonus: { topSpeed: 1, cornering: 1 }, description: 'Velocidade e curvas: ótimo para quem erra pouco.' },
  { id: 'jake', name: 'Jake Badlands', homeworld: 'Xeno Prime', bonus: { accel: 1, cornering: 1 }, description: 'Arranque e curvas: o mais fácil para começar.' },
  { id: 'snake', name: 'Snake Sanders', homeworld: 'Terra', bonus: { accel: 1, topSpeed: 1 }, description: 'O demônio da velocidade, mas sofre nas curvas.' },
  { id: 'katarina', name: 'Katarina Lyons', homeworld: 'Panteros V', bonus: { jumping: 1, cornering: 1 }, description: 'Controle impecável e pousos macios.' },
  { id: 'cyberhawk', name: 'Cyberhawk', homeworld: 'Serpentis', bonus: { accel: 1, jumping: 1 }, description: 'Arranque forte e pousos macios.' },
  { id: 'ivan', name: 'Ivanzypher', homeworld: 'Fleagull', bonus: { jumping: 1, topSpeed: 1 }, description: 'Voa baixo em pistas cheias de saltos.' },
  { id: 'olaf', name: 'Olaf', homeworld: 'Valhalla', bonus: { accel: 1, topSpeed: 1, cornering: 1, jumping: 1 }, description: 'O viking secreto: bom em tudo.', secret: true },
];

export type UpgradeKind = 'engine' | 'tires' | 'shocks' | 'armor';
export type ChargeKind = 'front' | 'rear' | 'nitro';

export const UPGRADE_KINDS: UpgradeKind[] = ['engine', 'tires', 'shocks', 'armor'];
export const CHARGE_KINDS: ChargeKind[] = ['front', 'rear', 'nitro'];
export const MAX_UPGRADE = 3;

export const UPGRADE_LABEL: Record<UpgradeKind, string> = { engine: 'Motor', tires: 'Pneus', shocks: 'Amortecedores', armor: 'Blindagem' };
export const UPGRADE_HELP: Record<UpgradeKind, string> = {
  engine: 'Mais velocidade máxima e aceleração',
  tires: 'Mais aderência nas curvas',
  shocks: 'Perde menos embalo nos saltos e roda menos no óleo',
  armor: 'Aguenta mais tiros e minas',
};
/** Nomes das peças do original, do nível 0 (de fábrica) ao 3. */
export const UPGRADE_NAMES: Record<UpgradeKind, string[]> = {
  armor: ['Defender', 'Rhino Skin', 'Saber Tooth', 'Atlas Powerplate'],
  engine: ['Cobra Mark VII', 'War Hammer', 'Super Charger', 'Atlas Power Boss'],
  shocks: ['Grasshoppers', 'Hydrosprings', 'Hydro Twinpacks', 'Atlas Power Lifts'],
  tires: ['Track Masters', 'Road Warriors', 'Super Mudwhumpers', 'Atlas Power Claws'],
};
/** Preço de cada nível (1..3), como no original. */
const UPGRADE_PRICES: Record<UpgradeKind, number[]> = {
  armor: [24000, 48000, 64000],
  engine: [40000, 70000, 110000],
  shocks: [20000, 40000, 60000],
  tires: [30000, 50000, 70000],
};

/** Preço de cada carro (original). */
export const CAR_PRICES: Record<string, { price: number }> = {
  dirtdevil: { price: 18000 },
  marauder: { price: 18000 },
  airblade: { price: 70000 },
  battletrak: { price: 110000 },
  havac: { price: 130000 },
};

/** Preço de uma carga extra de cada arma/assistência (original). */
const CHARGE_PRICE: Record<string, number> = {
  laser: 14000, jump: 6000, oil: 20000, missile: 20000, nitro: 24000, mine: 20000, scatter: 24000, sundog: 20000,
};

export interface CarSetup {
  vehicleId: string;
  upgrades: Record<UpgradeKind, number>;
  charges: Record<ChargeKind, number>;
}

export function newCarSetup(vehicleId: string): CarSetup {
  return { vehicleId, upgrades: { engine: 0, tires: 0, shocks: 0, armor: 0 }, charges: { front: 0, rear: 0, nitro: 0 } };
}

/**
 * Como no original: esteiras (Battle Trak) não usam pneus; o aerodeslizador (Havac) não usa pneus
 * nem amortecedores — no lugar deles vêm os Estabilizadores (ocupam o espaço dos amortecedores no save).
 */
export function upgradeAvailable(vehicleId: string, kind: UpgradeKind): boolean {
  if (kind === 'tires') return vehicleId !== 'battletrak' && vehicleId !== 'havac';
  return true;
}

/** O Havac troca os amortecedores pelos Estabilizadores (aderência, giro e pouso). */
function isStabilizer(vehicleId: string, kind: UpgradeKind): boolean {
  return vehicleId === 'havac' && kind === 'shocks';
}

const STABILIZER_NAMES = ['Hover Skirts', 'Gyro Stabs', 'Vector Fins', 'Atlas Power Gyros'];
/** Custam como os pneus (fazem o papel de pneus e amortecedores juntos). */
const STABILIZER_PRICES = [30000, 50000, 70000];

/** Nome do tipo de melhoria para este carro ("Estabilizadores" no Havac). */
export function upgradeLabel(vehicleId: string, kind: UpgradeKind): string {
  return isStabilizer(vehicleId, kind) ? 'Estabilizadores' : UPGRADE_LABEL[kind];
}

export function upgradeHelp(vehicleId: string, kind: UpgradeKind): string {
  return isStabilizer(vehicleId, kind) ? 'Mais aderência e giro nas curvas, pouso mais firme e menos rodadas no óleo' : UPGRADE_HELP[kind];
}

/** Nome da peça de cada nível (0 = de fábrica) para este carro. */
export function upgradeName(vehicleId: string, kind: UpgradeKind, level: number): string | undefined {
  return (isStabilizer(vehicleId, kind) ? STABILIZER_NAMES : UPGRADE_NAMES[kind])[level];
}

/**
 * Classe de cada carro: quanto motor e blindagem rendem nele (um chassi melhor aguenta peças maiores).
 * Assim o máximo de cada carro supera o do anterior (Dirt Devil < Marauder ≈ Air Blade < Battle Trak
 * < Havac), como no original. Os preços das peças são os do original para todos.
 */
export interface CarPotential {
  /** quanto o motor rende em velocidade final */
  speed: number;
  /** quanto o motor rende em arranque (e no turbo) */
  accel: number;
  armor: number;
}

export const CAR_POTENTIAL: Record<string, CarPotential> = {
  dirtdevil: { speed: 0.55, accel: 0.55, armor: 0.7 },
  marauder: { speed: 0.85, accel: 0.85, armor: 0.85 },
  // o Air Blade já sai de fábrica com o melhor arranque: o motor rende mais em final que em arranque
  airblade: { speed: 0.8, accel: 0.3, armor: 0.8 },
  battletrak: { speed: 1.1, accel: 1.1, armor: 1.1 },
  havac: { speed: 1.3, accel: 1.3, armor: 1.3 },
};

function carClass(vehicleId: string): CarPotential {
  return CAR_POTENTIAL[vehicleId] ?? { speed: 1, accel: 1, armor: 1 };
}

export function upgradePrice(setup: CarSetup, kind: UpgradeKind): number | null {
  const level = setup.upgrades[kind];
  if (level >= MAX_UPGRADE || !upgradeAvailable(setup.vehicleId, kind)) return null;
  return isStabilizer(setup.vehicleId, kind) ? STABILIZER_PRICES[level] : UPGRADE_PRICES[kind][level];
}

/** Custo total para levar um carro de fábrica ao máximo (todas as peças que ele aceita). */
export function maxUpgradeCost(vehicleId: string): number {
  const setup = newCarSetup(vehicleId);
  let sum = 0;
  for (const k of UPGRADE_KINDS) {
    for (let p = upgradePrice(setup, k); p !== null; p = upgradePrice(setup, k)) {
      sum += p;
      setup.upgrades[k]++;
    }
  }
  return sum;
}

/** Carro com todas as melhorias que ele aceita no nível máximo. */
export function maxedSetup(vehicleId: string): CarSetup {
  const setup = newCarSetup(vehicleId);
  for (const k of UPGRADE_KINDS) if (upgradeAvailable(vehicleId, k)) setup.upgrades[k] = MAX_UPGRADE;
  return setup;
}

/** Arma/assistência de cada slot de carga. */
export function chargeWeapon(base: VehicleSpec, kind: ChargeKind): string {
  return kind === 'front' ? base.front : kind === 'rear' ? base.rear : base.assist;
}

function baseCharges(base: VehicleSpec, kind: ChargeKind): number {
  return kind === 'front' ? base.frontCharges : kind === 'rear' ? base.rearCharges : base.nitroCharges;
}

/** Cargas extras que ainda dá para comprar (total máximo 7 por arma). */
export function maxExtraCharges(base: VehicleSpec, kind: ChargeKind): number {
  return Math.max(0, MAX_CHARGES - baseCharges(base, kind));
}

/** Preço da próxima carga extra (null = já no máximo). Precisa da ficha base do carro. */
export function chargePrice(setup: CarSetup, kind: ChargeKind, base?: VehicleSpec): number | null {
  if (base && setup.charges[kind] >= maxExtraCharges(base, kind)) return null;
  if (!base && setup.charges[kind] >= MAX_CHARGES - 1) return null;
  const weapon = base ? chargeWeapon(base, kind) : kind === 'front' ? 'laser' : kind === 'rear' ? 'oil' : 'nitro';
  return CHARGE_PRICE[weapon] ?? 20000;
}

/** Quanto já foi gasto em melhorias neste carro. */
export function upgradesSpent(setup: CarSetup): number {
  const probe = newCarSetup(setup.vehicleId);
  let sum = 0;
  for (const k of UPGRADE_KINDS) {
    for (let lv = 0; lv < setup.upgrades[k]; lv++) {
      probe.upgrades[k] = lv;
      sum += upgradePrice(probe, k) ?? 0;
    }
  }
  return sum;
}

/** Parte do preço das peças que a concessionária devolve na troca. */
export const UPGRADE_RESALE = 0.25;

/**
 * Valor de troca (revenda) do carro atual. No original não dava para vender nada; aqui a
 * concessionária fica com o carro por metade do preço mais 1/4 do que foi gasto em peças
 * (as peças e as cargas extras ficam com o carro velho).
 */
export function tradeInValue(setup: CarSetup, _base?: VehicleSpec): number {
  const value = CAR_PRICES[setup.vehicleId].price / 2 + UPGRADE_RESALE * upgradesSpent(setup);
  return Math.round(value / 500) * 500;
}

/**
 * Quanto custa trocar o carro atual por outro: preço do novo menos a revenda do atual.
 * Negativo = a revenda passa do preço e a diferença volta para o jogador.
 */
export function carSwapCost(setup: CarSetup, vehicleId: string): number {
  return CAR_PRICES[vehicleId].price - tradeInValue(setup);
}

/**
 * Ficha final do carro: base + melhorias + bônus do piloto. Motor e blindagem rendem conforme a classe
 * do carro (CAR_CLASS); peças que o carro não aceita (pneus no Battle Trak/Havac) não contam.
 */
export function buildSpec(base: VehicleSpec, setup: CarSetup, character?: Character): VehicleSpec {
  const lv = (k: UpgradeKind) => (upgradeAvailable(base.id, k) ? setup.upgrades[k] : 0);
  const pot = carClass(base.id);
  const speed = lv('engine') * pot.speed;
  const engine = lv('engine') * pot.accel;
  const armor = lv('armor') * pot.armor;
  const tires = lv('tires');
  // no Havac o espaço dos amortecedores são os Estabilizadores: seguram o casco nas curvas e no pouso
  const stab = isStabilizer(base.id, 'shocks') ? lv('shocks') : 0;
  const shocks = lv('shocks');
  const b = character?.bonus ?? {};
  return {
    ...base,
    maxSpeed: base.maxSpeed * (1 + 0.05 * speed + 0.04 * (b.topSpeed ?? 0)),
    accel: base.accel * (1 + 0.07 * engine + 0.08 * (b.accel ?? 0)),
    nitroAccel: base.nitroAccel * (1 + 0.05 * engine),
    // como no original, motor mais forte deixa o carro mais arisco (o Battle Trak turbinado derrapa)
    grip: base.grip * (1 + 0.12 * tires + 0.14 * stab + 0.1 * (b.cornering ?? 0) - 0.05 * lv('engine')),
    steerRate: base.steerRate * (1 + 0.04 * tires + 0.05 * stab + 0.05 * (b.cornering ?? 0)),
    armor: Math.round(base.armor * (1 + 0.2 * armor)),
    landingLoss: Math.max(0.04, 0.25 - 0.06 * shocks - 0.07 * (b.jumping ?? 0)),
    spinResist: Math.min(0.75, 0.2 * shocks + 0.12 * (b.jumping ?? 0)),
    frontCharges: Math.min(MAX_CHARGES, base.frontCharges + setup.charges.front),
    rearCharges: Math.min(MAX_CHARGES, base.rearCharges + setup.charges.rear),
    nitroCharges: Math.min(MAX_CHARGES, base.nitroCharges + setup.charges.nitro),
  };
}

/** Atributos de um carro, normalizados 0..1, para as barras da loja e da garagem. */
export interface CarAttributes {
  accel: number;
  speed: number;
  handling: number;
  armor: number;
  firepower: number;
}

export const ATTRIBUTE_LABEL: Record<keyof CarAttributes, string> = {
  accel: 'Aceleração',
  speed: 'Velocidade',
  handling: 'Curvas',
  armor: 'Blindagem',
  firepower: 'Poder de fogo',
};

/** Chance típica de acerto de cada arma frontal (o sundog persegue; o plasma vai reto). */
const HIT_RATE: Record<string, number> = { laser: 0.55, missile: 0.8, sundog: 1 };

/** Dano esperado por volta das armas (cargas × dano × acerto), usado no poder de fogo. */
function firepowerRaw(s: VehicleSpec): number {
  const front = WEAPONS[s.front].damage * s.frontCharges * (HIT_RATE[s.front] ?? 0.7);
  const rear = s.rear === 'scatter' ? WEAPONS.scatter.damage * 2.2 * s.rearCharges : s.rear === 'mine' ? WEAPONS.mine.damage * s.rearCharges : 14 * s.rearCharges;
  return front + rear;
}

/** Parte do empurrão do turbo que conta no arranque (2 cargas de 1,3 s por volta, gastas nas saídas de curva). */
const TURBO_SHARE = 0.15;

/**
 * Valor bruto de cada atributo. Aceleração: motor + parte do turbo (quem tem turbo sai mais forte das
 * curvas). Curvas: giro × aderência^0,15 (o giro pesa mais: a esteira gruda, mas vira devagar).
 */
function rawAttributes(s: VehicleSpec): CarAttributes {
  return {
    accel: s.accel + TURBO_SHARE * s.nitroAccel,
    speed: s.maxSpeed,
    handling: s.steerRate * Math.pow(s.grip, 0.15),
    armor: s.armor,
    firepower: firepowerRaw(s),
  };
}

/**
 * Escala ABSOLUTA de cada atributo (piso → barra vazia, teto → barra cheia), igual para todos os carros.
 * Antes a barra ia do pior ao melhor carro de fábrica, e 3 % de diferença virava meia barra (o Havac
 * saía "forte" em velocidade com a mesma final do Marauder). Agora a barra é proporcional ao valor real:
 * carros iguais têm barras iguais, e o que muda pouco muda pouco. Os tetos ficam acima dos carros de
 * fábrica (~0,4–0,6) para que as melhorias e o piloto ainda encham a barra.
 * - velocidade: 35–51 m/s (≈ 126–184 km/h)
 * - aceleração: 20–56 m/s² (0–100 km/h de ≈ 1,4 s a ≈ 0,5 s)
 * - curvas: giro × aderência^0,15 de 2,2 a 7
 * - blindagem: 50–140 pontos
 * - poder de fogo: 30–170 de dano esperado por volta
 */
const ATTRIBUTE_SCALE: Record<keyof CarAttributes, [number, number]> = {
  speed: [35, 51],
  accel: [20, 56],
  handling: [2.2, 7],
  armor: [50, 140],
  firepower: [30, 170],
};

export function carAttributes(spec: VehicleSpec): CarAttributes {
  const raw = rawAttributes(spec);
  const out = {} as CarAttributes;
  for (const k of Object.keys(raw) as (keyof CarAttributes)[]) {
    const [lo, hi] = ATTRIBUTE_SCALE[k];
    out[k] = Math.max(0.05, Math.min(1, (raw[k] - lo) / (hi - lo)));
  }
  return out;
}

/**
 * Quanto um atributo precisa passar da média dos outros carros de fábrica para ganhar "forte"/"fraco"
 * (relativo). Diferenças menores que isso existem, mas não são marca do carro.
 */
const STANDOUT: Record<keyof CarAttributes, number> = { speed: 0.05, accel: 0.08, handling: 0.1, armor: 0.07, firepower: 0.2 };

export type AttributeTag = 'good' | 'bad';

/**
 * Marca "forte"/"fraco" só quando o carro se destaca de fato: compara o valor com a média dos outros
 * carros de fábrica. No máximo um "forte" (o maior destaque) e um "fraco" (a maior falta).
 */
export function attributeTags(spec: VehicleSpec): Partial<Record<keyof CarAttributes, AttributeTag>> {
  const raw = rawAttributes(spec);
  const others = Object.values(VEHICLES).filter((v) => v.id !== spec.id).map(rawAttributes);
  let good: [keyof CarAttributes, number] | null = null;
  let bad: [keyof CarAttributes, number] | null = null;
  for (const k of Object.keys(raw) as (keyof CarAttributes)[]) {
    const mean = others.reduce((a, r) => a + r[k], 0) / Math.max(1, others.length);
    const d = mean > 0 ? (raw[k] - mean) / mean / STANDOUT[k] : 0;
    if (d >= 1 && (!good || d > good[1])) good = [k, d];
    if (d <= -1 && (!bad || d < bad[1])) bad = [k, d];
  }
  const out: Partial<Record<keyof CarAttributes, AttributeTag>> = {};
  if (good) out[good[0]] = 'good';
  if (bad) out[bad[0]] = 'bad';
  return out;
}

/** Descrição curta das armas de um carro (nomes do original). */
export function armamentText(spec: VehicleSpec): string {
  return `${WEAPON_NAMES[spec.front].name} · ${WEAPON_NAMES[spec.rear].name} · ${WEAPON_NAMES[spec.assist].name}`;
}
