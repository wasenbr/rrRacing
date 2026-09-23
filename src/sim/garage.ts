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
 * Como no original: esteiras (Battle Trak) não usam pneus; o aerodeslizador (Havac)
 * não usa pneus nem amortecedores.
 */
export function upgradeAvailable(vehicleId: string, kind: UpgradeKind): boolean {
  if (kind === 'tires') return vehicleId !== 'battletrak' && vehicleId !== 'havac';
  if (kind === 'shocks') return vehicleId !== 'havac';
  return true;
}

export function upgradePrice(setup: CarSetup, kind: UpgradeKind): number | null {
  const level = setup.upgrades[kind];
  if (level >= MAX_UPGRADE || !upgradeAvailable(setup.vehicleId, kind)) return null;
  return UPGRADE_PRICES[kind][level];
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

/**
 * Valor de troca do carro atual. No original não dava para vender nada e as melhorias se
 * perdem ao trocar de carro; aqui a concessionária aceita o carro por metade do preço
 * (as melhorias e cargas continuam perdidas).
 */
export function tradeInValue(setup: CarSetup, _base?: VehicleSpec): number {
  return Math.round(CAR_PRICES[setup.vehicleId].price / 2 / 500) * 500;
}

/** Ficha final do carro: base + melhorias + bônus do piloto. */
export function buildSpec(base: VehicleSpec, setup: CarSetup, character?: Character): VehicleSpec {
  const u = setup.upgrades;
  const b = character?.bonus ?? {};
  return {
    ...base,
    maxSpeed: base.maxSpeed * (1 + 0.05 * u.engine + 0.04 * (b.topSpeed ?? 0)),
    accel: base.accel * (1 + 0.07 * u.engine + 0.08 * (b.accel ?? 0)),
    nitroAccel: base.nitroAccel * (1 + 0.05 * u.engine),
    // como no original, motor mais forte deixa o carro mais arisco (o Battle Trak turbinado derrapa)
    grip: base.grip * (1 + 0.12 * u.tires + 0.1 * (b.cornering ?? 0) - 0.05 * u.engine),
    steerRate: base.steerRate * (1 + 0.04 * u.tires + 0.05 * (b.cornering ?? 0)),
    armor: Math.round(base.armor * (1 + 0.2 * u.armor)),
    landingLoss: Math.max(0.04, 0.25 - 0.06 * u.shocks - 0.07 * (b.jumping ?? 0)),
    spinResist: Math.min(0.75, 0.2 * u.shocks + 0.12 * (b.jumping ?? 0)),
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

/** Valor bruto de cada atributo. Curvas: o giro pesa mais que a aderência (a esteira gruda, mas vira devagar). */
function rawAttributes(s: VehicleSpec): CarAttributes {
  return {
    accel: s.accel,
    speed: s.maxSpeed,
    handling: s.steerRate * s.steerRate * Math.sqrt(s.grip),
    armor: s.armor,
    firepower: firepowerRaw(s),
  };
}

/** Barra do pior carro de fábrica em cada atributo e do melhor (acima disso só com melhorias). */
const BAR_LO = 0.2;
const BAR_HI = 0.7;
let factory: Record<keyof CarAttributes, [number, number]> | null = null;

/**
 * Faixa de cada atributo entre os carros de fábrica: as barras vão de 0,2 (o pior deles) a 0,7
 * (o melhor), e as melhorias enchem o resto. Assim cada carro mostra forças e fraquezas claras em
 * relação aos outros, e a garagem ainda mostra o ganho das peças.
 */
function factoryRanges(): Record<keyof CarAttributes, [number, number]> {
  if (factory) return factory;
  const raws = Object.values(VEHICLES).map(rawAttributes);
  const keys = Object.keys(ATTRIBUTE_LABEL) as (keyof CarAttributes)[];
  factory = Object.fromEntries(keys.map((k) => [k, [Math.min(...raws.map((r) => r[k])), Math.max(...raws.map((r) => r[k]))]])) as Record<keyof CarAttributes, [number, number]>;
  return factory;
}

export function carAttributes(spec: VehicleSpec): CarAttributes {
  const raw = rawAttributes(spec);
  const ranges = factoryRanges();
  const out = {} as CarAttributes;
  for (const k of Object.keys(raw) as (keyof CarAttributes)[]) {
    const [lo, hi] = ranges[k];
    const t = hi > lo ? (raw[k] - lo) / (hi - lo) : 0.5;
    out[k] = Math.max(0.05, Math.min(1, BAR_LO + (BAR_HI - BAR_LO) * t));
  }
  return out;
}

/** Descrição curta das armas de um carro (nomes do original). */
export function armamentText(spec: VehicleSpec): string {
  return `${WEAPON_NAMES[spec.front].name} · ${WEAPON_NAMES[spec.rear].name} · ${WEAPON_NAMES[spec.assist].name}`;
}
