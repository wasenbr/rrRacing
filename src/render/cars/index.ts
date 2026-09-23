import { createAirBlade } from './airblade';
import { createBattleTrak } from './battletrak';
import type { CarVisual } from './common';
import { createDirtDevil } from './dirtdevil';
import { createHavac } from './havac';
import { createMarauder } from './marauder';
import { CAR_SCALE } from '../../sim/vehicle';

export type { CarAnim, CarVisual } from './common';

const BUILDERS: Record<string, (color: number, shadows: boolean) => CarVisual> = {
  dirtdevil: createDirtDevil,
  marauder: createMarauder,
  airblade: createAirBlade,
  battletrak: createBattleTrak,
  havac: createHavac,
};

/** Modelo 3D de cada carro, gerado por código. */
export function createCarMesh(vehicleId: string, color: number, shadows: boolean): CarVisual {
  const v = (BUILDERS[vehicleId] ?? createMarauder)(color, shadows);
  // os modelos são feitos em tamanho "real"; o jogo usa carros menores em relação à pista
  v.root.scale.setScalar(CAR_SCALE);
  v.eye.multiplyScalar(CAR_SCALE);
  return v;
}
