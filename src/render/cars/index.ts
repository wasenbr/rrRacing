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

/**
 * Escala visual por carro: todos ocupam no chão a mesma área do Havac (2,6 x 4,1 m), que é o tamanho
 * certo para a pista e bate com a caixa de colisão da física (pedido do usuário). Fator = raiz da razão
 * entre a área do Havac e a área do modelo (largura x comprimento medidos).
 */
const VISUAL_SCALE: Record<string, number> = {
  dirtdevil: 0.865, // 2,76 x 5,10
  marauder: 0.876, // 2,65 x 5,18
  airblade: 0.8, // 3,30 x 4,97 (asas)
  battletrak: 0.754, // 3,36 x 5,52
  havac: 1,
};

/** Modelo 3D de cada carro, gerado por código. */
export function createCarMesh(vehicleId: string, color: number, shadows: boolean): CarVisual {
  const v = (BUILDERS[vehicleId] ?? createMarauder)(color, shadows);
  // os modelos são feitos em tamanho "real"; o jogo usa carros menores em relação à pista
  const k = CAR_SCALE * (VISUAL_SCALE[vehicleId] ?? 1);
  v.root.scale.setScalar(k);
  v.eye.multiplyScalar(k);
  return v;
}
