import { createAirBlade } from './airblade';
import { createBattleTrak } from './battletrak';
import type { CarVisual } from './common';
import { createDirtDevil } from './dirtdevil';
import { createHavac } from './havac';
import { createMarauder } from './marauder';
import { CAR_SCALE } from '../../sim/vehicle';
import { freezeStatic, mergeStatic } from '../merge';

export type { CarAnim, CarVisual } from './common';

const BUILDERS: Record<string, (color: number, shadows: boolean) => CarVisual> = {
  dirtdevil: createDirtDevil,
  marauder: createMarauder,
  airblade: createAirBlade,
  battletrak: createBattleTrak,
  havac: createHavac,
};

/**
 * Escala visual por carro contra o Havac (2,59 x 4,08 m, ~1,0 m de altura média), que é o tamanho
 * certo para a pista e bate com a caixa de colisão da física (pedido do usuário, item 34).
 * Igualar só a área no chão deixava os carros altos (rodas de monster truck, cúpula) com mais volume
 * na tela que o Havac. Agora o fator é a média geométrica entre:
 * - sA = raiz(área do Havac / área da caixa no chão do modelo)       — o "tamanho no chão";
 * - sV = raiz cúbica(volume do Havac / volume do modelo)             — o "corpo", com a altura.
 * O volume é o do mapa de alturas visto de cima (soma de altura x célula de 10 cm, raios verticais):
 * antenas, barbatana e faróis finos quase não pesam; rodas, casco e cabine pesam. Nenhum carro fica
 * maior que a escala só pela área (o usuário pediu os quatro menores, nunca maiores). Medidas no
 * tamanho do modelo (largura x comprimento; volume em m³):
 */
const VISUAL_SCALE: Record<string, number> = {
  dirtdevil: 0.797, // 2,76 x 5,10; vol 24,1 → sA 0,866 · sV 0,734
  marauder: 0.777, // 2,82 x 5,40; vol 25,1 → sA 0,833 · sV 0,725
  // Air Blade da rodada 11 (bandeja por cima dos pneus, barbatana alta, asas em diedro negativo),
  // medido com o mesmo mapa de alturas (Havac na mesma medição: 2,59 x 4,07; vol 10,2): 4,06 x 5,82;
  // vol 45,6 → sA 0,668 · sV 0,607 → 0,637. Fica em 0,66 (um pouco acima da média para não sumir
  // perto dos outros, mas abaixo de sA: nunca maior que a escala só pela área)
  airblade: 0.66,
  battletrak: 0.755, // 3,36 x 5,52; vol 19,4 → sA 0,755 · sV 0,789 (baixo: fica em sA)
  havac: 1, // 2,59 x 4,08; vol 9,6
};

/** Modelo 3D de cada carro, gerado por código. */
export function createCarMesh(vehicleId: string, color: number, shadows: boolean): CarVisual {
  const v = (BUILDERS[vehicleId] ?? createMarauder)(color, shadows);
  // ~90 malhas por carro caem para ~50 (uma por material em cada parte móvel); o que o jogo ou a
  // animação mexem fica separado, e o resto tem a matriz congelada
  const moving = mergeStatic(v.root, {
    // cabine e cockpit só trocam de visibilidade e o volante gira: juntam o que têm dentro
    anchors: [v.body, v.cockpit, v.steeringWheel, ...v.cabin],
    keep: v.flames,
    probe: [
      () => v.animate({ spin: 1.3, steer: 0.8, speed: 30, time: 1.7, grounded: false, roll: 0.05, pitch: 0.03 }),
      () => v.animate({ spin: 2.9, steer: -1, speed: -6, time: 3.4, grounded: true, roll: -0.04, pitch: -0.02 }),
    ],
  });
  freezeStatic(v.root, moving);
  // os modelos são feitos em tamanho "real"; o jogo usa carros menores em relação à pista
  const k = CAR_SCALE * (VISUAL_SCALE[vehicleId] ?? 1);
  v.root.scale.setScalar(k);
  v.eye.multiplyScalar(k);
  return v;
}
