import { CAR_SCALE, type VehicleSpec } from '../sim/vehicle';

/**
 * Os 5 carros do original, com as armas de cada um (ver referencias/original.md).
 * As cargas recarregam a cada volta, como no jogo de 1993 (máx. 7 com compras).
 *
 * Equilíbrio deste remake: estilos bem diferentes, mas todos competitivos (a volta solo de cada
 * carro base fica perto das outras). A evolução vem das melhorias, não de um carro "obrigatório".
 * - Dirt Devil: buggy — arranque forte e o melhor nas curvas; velocidade final baixa. Plasma, óleo, pulo.
 * - Marauder: muscle car — rápido e bom de arranque, mas solto nas curvas. Plasma, óleo, pulo.
 * - Air Blade: esportivo espinhoso — o melhor arranque, frágil. Mísseis, minas, turbo.
 * - Battle Trak: esteiras — gruda no chão e aguenta tudo; arranque e final medianos. Mísseis, scatter, turbo.
 * - Havac: aerodeslizador — a maior velocidade final, desliza nas curvas. Sundog, scatter, turbo.
 */
const base = { halfWidth: 1.1 * CAR_SCALE, halfLength: 2.1 * CAR_SCALE, drag: 0.12, brake: 44, reverseMax: 12, mass: 1 };

export const VEHICLES: Record<string, VehicleSpec> = {
  dirtdevil: {
    ...base, id: 'dirtdevil', name: 'Dirt Devil', maxSpeed: 41.5, accel: 37.5, steerRate: 3.35, grip: 12.5, nitroAccel: 0,
    armor: 105, front: 'laser', frontCharges: 5, rear: 'oil', rearCharges: 2, assist: 'jump', nitroCharges: 2, mass: 0.95,
  },
  marauder: {
    ...base, id: 'marauder', name: 'Marauder', maxSpeed: 43.5, accel: 36, steerRate: 3.1, grip: 10, nitroAccel: 0,
    armor: 110, front: 'laser', frontCharges: 5, rear: 'oil', rearCharges: 2, assist: 'jump', nitroCharges: 2, mass: 1.05,
  },
  airblade: {
    ...base, id: 'airblade', name: 'Air Blade', maxSpeed: 42, accel: 39, steerRate: 3.2, grip: 8, nitroAccel: 28,
    armor: 85, front: 'missile', frontCharges: 2, rear: 'mine', rearCharges: 2, assist: 'nitro', nitroCharges: 2, mass: 0.85,
  },
  battletrak: {
    ...base, id: 'battletrak', name: 'Battle Trak', maxSpeed: 41.5, accel: 36, steerRate: 3.0, grip: 16, nitroAccel: 28,
    armor: 140, front: 'missile', frontCharges: 2, rear: 'scatter', rearCharges: 1, assist: 'nitro', nitroCharges: 2, traction: 'treads',
    halfWidth: 1.25 * CAR_SCALE, mass: 1.4, brake: 50,
  },
  havac: {
    ...base, id: 'havac', name: 'Havac', maxSpeed: 45, accel: 33, steerRate: 2.9, grip: 6.5, nitroAccel: 30,
    armor: 120, front: 'sundog', frontCharges: 3, rear: 'scatter', rearCharges: 2, assist: 'nitro', nitroCharges: 2, traction: 'hover', mass: 1.1, brake: 36,
  },
};
