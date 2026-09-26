import { describe, expect, it } from 'vitest';
import { AutoDegrade, DynamicResolution, type DegradeCaps } from './quality';

const run = (d: DynamicResolution, secs: number, cost: number) => {
  let changes = 0;
  for (let t = 0; t < secs; t += 1 / 60) if (d.update(1 / 60, cost)) changes++;
  return changes;
};

describe('DynamicResolution.update', () => {
  it('desce até o piso quando o custo passa do orçamento (dois degraus de uma vez quando está bem atrás)', () => {
    const d = new DynamicResolution(0.6);
    run(d, 20, 1 / 30);
    expect(d.scale).toBeCloseTo(0.6, 5);
    // 1/30 s por quadro é bem pior que o orçamento: desce 0,2 por vez (cada troca custa um engasgo)
    expect(d.history.map((h) => h[1])).toEqual([0.8, 0.6]);
  });

  it('desce 0,1 por degrau quando está só um pouco atrás do orçamento', () => {
    const d = new DynamicResolution(0.6);
    run(d, 20, 1 / 45);
    expect(d.history.map((h) => h[1])).toEqual([0.9, 0.8, 0.7, 0.6]);
  });

  it('não muda nada na espera inicial (2 s) nem com folga no teto', () => {
    const d = new DynamicResolution(0.6);
    expect(run(d, 1.9, 1 / 20)).toBe(0);
    const ok = new DynamicResolution(0.6);
    expect(run(ok, 10, 1 / 60)).toBe(0);
    expect(ok.scale).toBe(1);
  });

  it('sobe devagar com folga e trava o degrau que não se sustentou', () => {
    const d = new DynamicResolution(0.6);
    d.scale = 0.8;
    run(d, 8, 1 / 90);
    expect(d.scale).toBeGreaterThan(0.8);
    const up = d.scale;
    // logo depois da subida o custo estoura: desce e aquele degrau vira teto
    run(d, 6, 1 / 30);
    expect(d.scale).toBeLessThan(up);
    run(d, 30, 1 / 90);
    expect(d.scale).toBeLessThan(up);
  });

  it('perto do limite, cada subida que volta atrás dobra a espera pela próxima', () => {
    const d = new DynamicResolution(0.3);
    d.scale = 0.5;
    // sobe com folga, e 10 s depois (fora da trava do teto) o custo estoura e desce
    run(d, 3, 1 / 90);
    expect(d.scale).toBeCloseTo(0.55, 5);
    run(d, 10, 1 / 55);
    run(d, 0.1, 1 / 30);
    const down = d.scale;
    expect(down).toBeLessThan(0.55);
    // a espera dobrou (9 → 18 s): com folga de novo, 15 s ainda não bastam para subir
    run(d, 15, 1 / 90);
    expect(d.scale).toBe(down);
    run(d, 5, 1 / 90);
    expect(d.scale).toBeGreaterThan(down);
  });

  it('degraus proporcionais à unidade (tela grande)', () => {
    const d = new DynamicResolution(0.2);
    d.unit = 0.5;
    d.scale = 0.5;
    run(d, 4, 1 / 45);
    expect(d.history[0][1]).toBeCloseTo(0.45, 5);
  });

  it('ignora quadros com intervalo absurdo e respeita enabled', () => {
    const d = new DynamicResolution(0.6);
    expect(d.update(0.5, 0.5)).toBe(false);
    d.enabled = false;
    expect(run(d, 10, 1 / 20)).toBe(0);
  });

  it('restore limita ao piso', () => {
    const d = new DynamicResolution(0.85);
    d.restore(0.5);
    expect(d.scale).toBe(0.85);
    d.restore(0.9);
    expect(d.scale).toBe(0.9);
  });
});

describe('AutoDegrade', () => {
  const all: DegradeCaps = { flashLights: true, bloom: true, shadow: true, particles: true };
  const seq = (caps: DegradeCaps, atFloor = true) => {
    const a = new AutoDegrade();
    const out: string[][] = [];
    for (let t = 0; t < 30; t += 1 / 30) {
      const r = a.update(1 / 30, 1 / 20, atFloor, caps);
      if (r) out.push(r);
    }
    return { out, level: a.level };
  };

  it('segue a ordem: luzes (sem gastar espera) + bloom, sombra, partículas, 30 qps', () => {
    const { out, level } = seq(all);
    expect(out).toEqual([['flash', 'bloom'], ['shadow'], ['particles'], ['cap30']]);
    expect(level).toBe(5);
  });

  it('pula o que não existe (sem bloom nem luzes: sombra primeiro)', () => {
    const { out } = seq({ flashLights: false, bloom: false, shadow: true, particles: false });
    expect(out).toEqual([['shadow'], ['cap30']]);
  });

  it('bloom desligado sem nenhum degrau que troque programas no meio da corrida', () => {
    // as luzes e a sombra só ficam pendentes (o jogo aplica na próxima largada): nenhuma ação
    // diferente destas existe, e "flash" nunca vem sozinho sem o degrau seguinte
    const { out } = seq(all);
    for (const r of out) for (const a of r) expect(['flash', 'bloom', 'shadow', 'particles', 'cap30']).toContain(a);
    expect(out[0]).toContain('bloom');
  });

  it('espera a resolução chegar ao piso e 3 s entre degraus', () => {
    expect(seq(all, false).out).toEqual([]);
    const a = new AutoDegrade();
    let first = -1;
    let second = -1;
    for (let k = 0; k < 600 && second < 0; k++) {
      if (a.update(1 / 30, 1 / 20, true, all)) {
        if (first < 0) first = k;
        else second = k;
      }
    }
    // a média lenta leva alguns quadros para passar de 1/42 s; depois, ≥ 3 s (90 quadros) de espera
    expect(first).toBeGreaterThan(0);
    expect(second - first).toBeGreaterThanOrEqual(90);
  });

  it('não cai com o jogo rápido', () => {
    const a = new AutoDegrade();
    for (let t = 0; t < 30; t += 1 / 60) expect(a.update(1 / 60, 1 / 60, true, all)).toBeNull();
  });
});
