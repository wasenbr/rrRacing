import type { VehicleSpec } from './vehicle';

/** Pilotos jogáveis do original. Os bônus são definidos por este remake. */
export interface Character {
  id: string;
  name: string;
  bonus: { accel?: number; topSpeed?: number; cornering?: number; jumping?: number };
  description: string;
}

export const CHARACTERS: Character[] = [
  { id: 'tarquinn', name: 'Tarquinn', bonus: { cornering: 2, jumping: 1 }, description: 'Faz curvas como ninguém.' },
  { id: 'jake', name: 'Jake Badlands', bonus: { accel: 1, topSpeed: 1, cornering: 1 }, description: 'Equilibrado em tudo.' },
  { id: 'cyberhawk', name: 'Cyberhawk', bonus: { topSpeed: 2, accel: 1 }, description: 'Velocidade máxima alta.' },
  { id: 'katarina', name: 'Katarina Lyons', bonus: { accel: 2, cornering: 1 }, description: 'Arranque explosivo.' },
  { id: 'snake', name: 'Snake Sanders', bonus: { jumping: 2, accel: 1 }, description: 'Pousa saltos sem perder embalo.' },
  { id: 'ivan', name: 'Ivan Zypher', bonus: { topSpeed: 1, jumping: 1, cornering: 1 }, description: 'Veterano versátil.' },
];

export type UpgradeKind = 'engine' | 'tires' | 'shocks' | 'armor';
export type ChargeKind = 'front' | 'rear' | 'nitro';

export const UPGRADE_KINDS: UpgradeKind[] = ['engine', 'tires', 'shocks', 'armor'];
export const CHARGE_KINDS: ChargeKind[] = ['front', 'rear', 'nitro'];
export const MAX_UPGRADE = 3;
export const MAX_EXTRA_CHARGES = 3;

export const UPGRADE_LABEL: Record<UpgradeKind, string> = { engine: 'Motor', tires: 'Pneus', shocks: 'Suspensão', armor: 'Blindagem' };
export const UPGRADE_HELP: Record<UpgradeKind, string> = {
  engine: 'Mais velocidade máxima e aceleração',
  tires: 'Mais aderência nas curvas',
  shocks: 'Perde menos embalo nos saltos e roda menos no óleo',
  armor: 'Aguenta mais tiros e minas',
};

/** Preço de cada carro e fator que multiplica o preço das melhorias. */
export const CAR_PRICES: Record<string, { price: number; upgradeFactor: number }> = {
  dirtdevil: { price: 0, upgradeFactor: 1 },
  marauder: { price: 45000, upgradeFactor: 1.5 },
  airblade: { price: 90000, upgradeFactor: 2 },
  battletrak: { price: 140000, upgradeFactor: 2.5 },
  havac: { price: 220000, upgradeFactor: 3.2 },
};

const UPGRADE_BASE = [8000, 16000, 28000];
const CHARGE_BASE = [5000, 9000, 15000];

export interface CarSetup {
  vehicleId: string;
  upgrades: Record<UpgradeKind, number>;
  charges: Record<ChargeKind, number>;
}

export function newCarSetup(vehicleId: string): CarSetup {
  return { vehicleId, upgrades: { engine: 0, tires: 0, shocks: 0, armor: 0 }, charges: { front: 0, rear: 0, nitro: 0 } };
}

export function upgradePrice(setup: CarSetup, kind: UpgradeKind): number | null {
  const level = setup.upgrades[kind];
  if (level >= MAX_UPGRADE) return null;
  return Math.round((UPGRADE_BASE[level] * CAR_PRICES[setup.vehicleId].upgradeFactor) / 500) * 500;
}

export function chargePrice(setup: CarSetup, kind: ChargeKind): number | null {
  const n = setup.charges[kind];
  if (n >= MAX_EXTRA_CHARGES) return null;
  return Math.round((CHARGE_BASE[n] * CAR_PRICES[setup.vehicleId].upgradeFactor) / 500) * 500;
}

/** Valor de revenda: metade do que foi investido no carro (como uma troca na concessionária). */
export function tradeInValue(setup: CarSetup): number {
  let spent = CAR_PRICES[setup.vehicleId].price;
  const f = CAR_PRICES[setup.vehicleId].upgradeFactor;
  for (const k of UPGRADE_KINDS) for (let i = 0; i < setup.upgrades[k]; i++) spent += UPGRADE_BASE[i] * f;
  for (const k of CHARGE_KINDS) for (let i = 0; i < setup.charges[k]; i++) spent += CHARGE_BASE[i] * f;
  return Math.round(spent / 2 / 500) * 500;
}

/** Ficha final do carro: base + melhorias + bônus do piloto. */
export function buildSpec(base: VehicleSpec, setup: CarSetup, character?: Character): VehicleSpec {
  const u = setup.upgrades;
  const b = character?.bonus ?? {};
  return {
    ...base,
    maxSpeed: base.maxSpeed * (1 + 0.06 * u.engine + 0.025 * (b.topSpeed ?? 0)),
    accel: base.accel * (1 + 0.08 * u.engine + 0.04 * (b.accel ?? 0)),
    nitroAccel: base.nitroAccel * (1 + 0.05 * u.engine),
    grip: base.grip * (1 + 0.12 * u.tires + 0.05 * (b.cornering ?? 0)),
    steerRate: base.steerRate * (1 + 0.04 * u.tires + 0.02 * (b.cornering ?? 0)),
    armor: Math.round(base.armor * (1 + 0.2 * u.armor)),
    landingLoss: Math.max(0.04, 0.25 - 0.06 * u.shocks - 0.03 * (b.jumping ?? 0)),
    spinResist: Math.min(0.75, 0.2 * u.shocks + 0.05 * (b.jumping ?? 0)),
    frontCharges: base.frontCharges + setup.charges.front,
    rearCharges: base.rearCharges + setup.charges.rear,
    nitroCharges: base.nitroCharges + setup.charges.nitro,
  };
}
