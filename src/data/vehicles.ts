import { CAR_SCALE, type VehicleSpec } from '../sim/vehicle';

/**
 * Os 5 carros do original, com as armas de cada um (ver referencias/original.md).
 * As cargas recarregam a cada volta, como no jogo de 1993 (máx. 7 com compras).
 *
 * Equilíbrio deste remake: estilos bem diferentes e, como no original, o carro mais caro é melhor.
 * De fábrica a diferença é pequena (volta solo perto das outras, mas nenhum caro é mais lento que um
 * barato); com todas as melhorias cada carro supera o anterior (Dirt Devil < Marauder ≈ Air Blade <
 * Battle Trak < Havac) — ver CAR_POTENTIAL em sim/garage.ts e o teste "progressão dos carros".
 * - Dirt Devil: buggy — o melhor nas curvas; final e arranque baixos. Plasma, óleo, pulo.
 * - Marauder: muscle car — mais final que o Dirt Devil, mas solto nas curvas. Plasma, óleo, pulo.
 * - Air Blade: esportivo espinhoso — o melhor arranque de fábrica, frágil. Mísseis, minas, turbo.
 * - Battle Trak: esteiras — gruda no chão e aguenta tudo. Mísseis, scatter, turbo.
 * - Havac: aerodeslizador — a maior velocidade final, desliza nas curvas (Estabilizadores ajudam). Sundog, scatter, turbo.
 */
const base = { halfWidth: 1.1 * CAR_SCALE, halfLength: 2.1 * CAR_SCALE, drag: 0.12, brake: 44, reverseMax: 12, mass: 1 };

export const VEHICLES: Record<string, VehicleSpec> = {
  dirtdevil: {
    ...base, id: 'dirtdevil', name: 'Dirt Devil', maxSpeed: 42.5, accel: 38, steerRate: 3.5, grip: 12.5, nitroAccel: 0,
    armor: 92, front: 'laser', frontCharges: 5, rear: 'oil', rearCharges: 2, assist: 'jump', nitroCharges: 2, mass: 1.0,
  },
  marauder: {
    ...base, id: 'marauder', name: 'Marauder', maxSpeed: 43.5, accel: 37, steerRate: 3.2, grip: 10, nitroAccel: 0,
    armor: 96, front: 'laser', frontCharges: 5, rear: 'oil', rearCharges: 2, assist: 'jump', nitroCharges: 2, mass: 1.05,
  },
  airblade: {
    ...base, id: 'airblade', name: 'Air Blade', maxSpeed: 43.5, accel: 42, steerRate: 3.2, grip: 7.5, nitroAccel: 28,
    armor: 92, front: 'missile', frontCharges: 2, rear: 'mine', rearCharges: 2, assist: 'nitro', nitroCharges: 2, mass: 0.85,
  },
  battletrak: {
    ...base, id: 'battletrak', name: 'Battle Trak', maxSpeed: 43.5, accel: 37, steerRate: 3.0, grip: 19, nitroAccel: 30,
    armor: 106, front: 'missile', frontCharges: 2, rear: 'scatter', rearCharges: 1, assist: 'nitro', nitroCharges: 2, traction: 'treads',
    halfWidth: 1.25 * CAR_SCALE, mass: 1.1, brake: 50,
  },
  havac: {
    ...base, id: 'havac', name: 'Havac', maxSpeed: 45, accel: 36.5, steerRate: 2.65, grip: 6.5, nitroAccel: 32,
    armor: 100, front: 'sundog', frontCharges: 3, rear: 'scatter', rearCharges: 2, assist: 'nitro', nitroCharges: 2, traction: 'hover', mass: 1.1, brake: 36,
  },
};
