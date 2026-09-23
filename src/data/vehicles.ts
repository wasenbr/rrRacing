import { CAR_SCALE, type VehicleSpec } from '../sim/vehicle';

/**
 * Os 5 carros do original. Cada um tem uma arma frontal e uma traseira; as cargas
 * recarregam a cada volta, como no jogo de 1993. Valores serão ajustados com a loja/upgrades.
 */
const base = { halfWidth: 1.1 * CAR_SCALE, halfLength: 2.1 * CAR_SCALE, nitroCharges: 3, drag: 0.12, brake: 40, reverseMax: 11, mass: 1 };

export const VEHICLES: Record<string, VehicleSpec> = {
  dirtdevil: {
    ...base, id: 'dirtdevil', name: 'Dirt Devil', maxSpeed: 32, accel: 20, steerRate: 2.5, grip: 7, nitroAccel: 22,
    armor: 80, front: 'laser', frontCharges: 4, rear: 'oil', rearCharges: 2, mass: 0.9,
  },
  marauder: {
    ...base, id: 'marauder', name: 'Marauder', maxSpeed: 36, accel: 23, steerRate: 2.7, grip: 9, nitroAccel: 26,
    armor: 100, front: 'laser', frontCharges: 5, rear: 'mine', rearCharges: 2,
  },
  airblade: {
    ...base, id: 'airblade', name: 'Air Blade', maxSpeed: 40, accel: 25, steerRate: 2.6, grip: 3.5, nitroAccel: 28,
    armor: 90, front: 'missile', frontCharges: 3, rear: 'oil', rearCharges: 3, mass: 0.85,
  },
  battletrak: {
    ...base, id: 'battletrak', name: 'Battle Trak', maxSpeed: 33, accel: 19, steerRate: 2.3, grip: 12, nitroAccel: 24,
    armor: 140, front: 'missile', frontCharges: 3, rear: 'mine', rearCharges: 3, halfWidth: 1.25 * CAR_SCALE, mass: 1.5,
  },
  havac: {
    ...base, id: 'havac', name: 'Havac', maxSpeed: 42, accel: 27, steerRate: 2.8, grip: 9.5, nitroAccel: 30,
    armor: 120, front: 'missile', frontCharges: 4, rear: 'mine', rearCharges: 3, mass: 1.1,
  },
};
