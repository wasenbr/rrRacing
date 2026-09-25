import { CAR_SCALE, type VehicleSpec } from '../sim/vehicle';

/**
 * Os 5 carros do original, com as armas de cada um (ver referencias/original.md).
 * As cargas recarregam a cada volta, como no jogo de 1993 (máx. 7 com compras).
 *
 * Equilíbrio deste remake: estilos bem diferentes e, como no original, o carro mais caro é melhor.
 * De fábrica cada um tem o seu jeito (final de 151 a 164 km/h, 0–100 de 0,67 a 0,92 s), com a volta
 * solo parecida dentro do mesmo degrau de preço; com todas as melhorias a volta de cada carro supera a
 * do anterior (Dirt Devil < Marauder < Air Blade < Battle Trak < Havac) — ver CAR_POTENTIAL em
 * sim/garage.ts e o teste "progressão dos carros".
 * - Dirt Devil: buggy — o melhor nas curvas (giro e aderência altos); final baixa. Plasma, óleo, pulo.
 * - Marauder: muscle car — mais final que o Dirt Devil, pesado e solto nas curvas. Plasma, óleo, pulo.
 * - Air Blade: esportivo leve — de longe o melhor arranque e ágil, mas a blindagem é a mais baixa.
 *   Mísseis, minas, turbo.
 * - Battle Trak: tanque de esteiras — pesado, arranca devagar, mas gruda no chão, freia forte e
 *   aguenta tudo. Mísseis, scatter, turbo.
 * - Havac: aerodeslizador — a maior velocidade final e freio forte (empuxo reverso), desliza nas
 *   curvas (Estabilizadores ajudam). Sundog, scatter, turbo.
 */
const base = { halfWidth: 1.1 * CAR_SCALE, halfLength: 2.1 * CAR_SCALE, drag: 0.12, brake: 44, reverseMax: 12, mass: 1 };

export const VEHICLES: Record<string, VehicleSpec> = {
  dirtdevil: {
    ...base, id: 'dirtdevil', name: 'Dirt Devil', maxSpeed: 42, accel: 40, steerRate: 4.0, grip: 15, nitroAccel: 0,
    armor: 90, front: 'laser', frontCharges: 5, rear: 'oil', rearCharges: 2, assist: 'jump', nitroCharges: 2, mass: 0.95,
  },
  marauder: {
    ...base, id: 'marauder', name: 'Marauder', maxSpeed: 44, accel: 37, steerRate: 3.0, grip: 10.5, nitroAccel: 0,
    armor: 100, front: 'laser', frontCharges: 5, rear: 'oil', rearCharges: 2, assist: 'jump', nitroCharges: 2, mass: 1.1,
  },
  airblade: {
    ...base, id: 'airblade', name: 'Air Blade', maxSpeed: 44, accel: 45, steerRate: 3.5, grip: 7.5, nitroAccel: 28,
    armor: 78, front: 'missile', frontCharges: 2, rear: 'mine', rearCharges: 2, assist: 'nitro', nitroCharges: 2, mass: 0.75,
  },
  battletrak: {
    ...base, id: 'battletrak', name: 'Battle Trak', maxSpeed: 44, accel: 34.5, steerRate: 3.2, grip: 17, nitroAccel: 30,
    armor: 108, front: 'missile', frontCharges: 2, rear: 'scatter', rearCharges: 1, assist: 'nitro', nitroCharges: 2, traction: 'treads',
    // esteiras pesadas: mais resistência ao rolar (final efetiva um pouco abaixo da nominal)
    halfWidth: 1.25 * CAR_SCALE, mass: 1.15, brake: 52, drag: 0.18,
  },
  havac: {
    ...base, id: 'havac', name: 'Havac', maxSpeed: 45.5, accel: 36, steerRate: 2.7, grip: 6.2, nitroAccel: 32,
    armor: 100, front: 'sundog', frontCharges: 3, rear: 'scatter', rearCharges: 2, assist: 'nitro', nitroCharges: 2, traction: 'hover', mass: 1.1, brake: 56,
  },
};
