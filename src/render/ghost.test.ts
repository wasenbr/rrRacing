import { describe, expect, it } from 'vitest';
import { ghostVisible, nextGhost } from './ghost';

describe('nextGhost', () => {
  it('fora da perseguição o rival fica sempre visível', () => {
    expect(nextGhost(0, 0, 0, false)).toBe(1);
    expect(nextGhost(undefined, 0, 0.5, false)).toBe(1);
  });

  it('visível e querendo aparecer não some num quadro lento', () => {
    let g: number | undefined;
    for (const dt of [0.016, 0.2, 0.5, 0]) {
      g = nextGhost(g, 1, dt, true);
      expect(ghostVisible(g)).toBe(true);
    }
    expect(g).toBe(1);
  });

  it('some rápido quando tapa o jogador e volta depois', () => {
    let g = nextGhost(1, 0, 0.1, true);
    expect(ghostVisible(g)).toBe(false);
    g = nextGhost(g, 1, 0.1, true);
    expect(ghostVisible(g)).toBe(false);
    g = nextGhost(g, 1, 0.2, true);
    expect(ghostVisible(g)).toBe(true);
  });

  it('dt zero (preparo da largada) não altera', () => {
    expect(nextGhost(0.3, 1, 0, true)).toBe(0.3);
    expect(nextGhost(undefined, 1, 0, true)).toBe(1);
  });
});
