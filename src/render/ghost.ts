/**
 * Transparência "fantasma" de um rival na câmera de perseguição (1 = visível, 0 = escondido).
 * Fora da perseguição vale sempre 1. `want` 1 = pode aparecer; 0 = colado na câmera/tapando o
 * jogador. Aparece em 0,25 s e some em 0,1 s. (Antes, com want = g = 1, caía para o ramo de
 * sumir: num quadro lento o rival sumia até na câmera isométrica.)
 */
export function nextGhost(g: number | undefined, want: number, dt: number, chase: boolean): number {
  if (!chase) return 1;
  const cur = g ?? 1;
  const step = Math.max(0, dt);
  if (want >= cur) return Math.min(1, cur + step / 0.25);
  return Math.max(0, cur - step / 0.1);
}

/** Rival visível pelo critério do fantasma. */
export const ghostVisible = (g: number | undefined): boolean => (g ?? 1) >= 0.5;
