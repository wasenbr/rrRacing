import { describe, expect, it } from 'vitest';
import { CEIL, ceilingCurve } from './context';

describe('teto do master', () => {
  it('nenhuma amostra passa de -1 dBFS e é linear até o joelho', () => {
    const c = ceilingCurve(0.8, CEIL);
    let peak = 0;
    for (const v of c) peak = Math.max(peak, Math.abs(v));
    expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-1);
    // linear abaixo do joelho (0,5 -> 0,5)
    const i = Math.round(((0.5 + 1) / 2) * (c.length - 1));
    const x = (i / (c.length - 1)) * 2 - 1;
    expect(c[i]).toBeCloseTo(x, 6);
    // monotônica
    for (let k = 1; k < c.length; k++) expect(c[k]).toBeGreaterThanOrEqual(c[k - 1]);
  });
});
