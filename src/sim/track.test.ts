import { describe, expect, it } from 'vitest';
import { TRACKS, tracksOfPlanet } from '../data/tracks';
import { leftX, leftZ } from './math';
import { parsePieces, RAMP_HEIGHT, reverseWarpSide, surfaceEffect, Track, type ThemeId } from './track';

describe('pistas do original', () => {
  it('36 pistas, na quantidade de cada planeta do jogo de 1993', () => {
    const count: Record<ThemeId, number> = { chem6: 4, drakonis: 5, bogmire: 6, newmojave: 7, nho: 7, inferno: 7 };
    expect(TRACKS.length).toBe(36);
    for (const [theme, n] of Object.entries(count)) {
      const list = tracksOfPlanet(theme as ThemeId);
      expect(list.length).toBe(n);
      expect(list.map((d) => d.order)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it('ids únicos e todas fecham o circuito', () => {
    expect(new Set(TRACKS.map((d) => d.id)).size).toBe(TRACKS.length);
    for (const def of TRACKS) expect(new Track(def).isClosed, def.id).toBe(true);
  });

  it('todo vão (G) vem depois de uma rampa de salto e tem pouso', () => {
    for (const def of TRACKS) {
      const codes = parsePieces(def.layout).map((p) => p.code);
      codes.forEach((c, i) => {
        if (c !== 'G') return;
        let k = i;
        while (codes[(k - 1 + codes.length) % codes.length] === 'G') k--;
        const before = codes[(k - 1 + codes.length) % codes.length];
        expect(before === 'J' || before === 'X' || before === 'S', `${def.id} peça ${i}`).toBe(true);
        let e = i;
        while (codes[(e + 1) % codes.length] === 'G' || codes[(e + 1) % codes.length] === 'J') e++;
        expect(codes[(e + 1) % codes.length], `${def.id} pouso ${i}`).not.toBe('G');
      });
      // a primeira peça de cada grupo de vãos vem logo depois de um J
      codes.forEach((c, i) => {
        if (c === 'G' && codes[(i - 1 + codes.length) % codes.length] !== 'G') expect(codes[(i - 1 + codes.length) % codes.length], `${def.id} ${i}`).toBe('J');
      });
    }
  });

  it('cruzamentos (X) ficam no mesmo ponto e na mesma altura nas duas passagens', () => {
    for (const def of TRACKS) {
      const tr = new Track(def);
      const xs = tr.pieces.filter((p) => p.code === 'X');
      expect(xs.length % 2, def.id).toBe(0);
      for (const a of xs) {
        const ma = tr.pointOn(a, a.length / 2);
        const b = xs.find((o) => o !== a && Math.hypot(tr.pointOn(o, o.length / 2).x - ma.x, tr.pointOn(o, o.length / 2).z - ma.z) < 1e-6);
        expect(b, `${def.id} X ${a.index} sem par`).toBeTruthy();
        expect(Math.abs(tr.heightOn(a, 0) - tr.heightOn(b!, 0)), def.id).toBeLessThan(1e-6);
      }
    }
  });

  it('vão com queda (Gv): pouso um nível abaixo, borda da malha no nível da decolagem', () => {
    const tr = new Track({ id: 'queda', name: 'queda', planet: 'x', theme: 'chem6', laps: 1, layout: 'F S U J Gv S R S S R S S S S S S R S S R' });
    expect(tr.isClosed).toBe(true);
    const j = tr.pieces[3];
    const g = tr.pieces[4];
    const land = tr.pieces[5];
    expect(land.h0).toBeCloseTo(j.h0 - RAMP_HEIGHT);
    expect(tr.heightOn(g, 0)).toBeCloseTo(land.h0);
    const mid = tr.pointOn(g, g.length / 2);
    expect(tr.query(mid.x, mid.z, g.index).void).toBe(true);
    const run = tr.meshRuns(1).find((r) => r.some((p) => p.pieceIndex === 3))!;
    expect(run[run.length - 1].h).toBeCloseTo(tr.heightOn(j, j.length));
    expect(() => new Track({ ...tr.def, layout: 'F S Sv' })).toThrow();
  });

  it('vão não tem chão; fora dele a pista tem', () => {
    const def = TRACKS.find((d) => d.layout.includes('G'))!;
    const tr = new Track(def);
    const g = tr.pieces.find((p) => p.code === 'G')!;
    const mid = tr.pointOn(g, g.length / 2);
    expect(tr.query(mid.x, mid.z, g.index).void).toBe(true);
    const s = tr.pieces.find((p) => p.code === 'S')!;
    const ms = tr.pointOn(s, s.length / 2);
    expect(tr.query(ms.x, ms.z, s.index).void).toBe(false);
  });

  it('trechos de malha param nos vãos e cruzamentos e cobrem o resto da pista', () => {
    for (const def of TRACKS) {
      const tr = new Track(def);
      const runs = tr.meshRuns(1);
      const breaks = tr.pieces.filter((_, i) => tr.isBreak(i)).length;
      if (!breaks) {
        expect(runs.length).toBe(1);
        continue;
      }
      const covered = new Set(runs.flatMap((r) => r.slice(0, -1).map((p) => p.pieceIndex)));
      for (let i = 0; i < tr.pieces.length; i++) expect(covered.has(i), `${def.id} peça ${i}`).toBe(!tr.isBreak(i));
      // distâncias crescentes dentro de cada trecho (texturas contínuas)
      for (const r of runs) for (let k = 1; k < r.length; k++) expect(r[k].dist).toBeGreaterThan(r[k - 1].dist);
    }
  });

  it('warp: para a frente em toda a largura; reverso só num lado', () => {
    const tr = new Track({ id: 'w', name: 'w', planet: 'x', theme: 'inferno', laps: 1, layout: 'F S> S< S R S S R S S S S R S S R S' });
    const fwd = tr.pieces[1];
    const rev = tr.pieces[2];
    const at = (p: typeof fwd, lateral: number) => {
      const c = tr.pointOn(p, p.length / 2);
      const x = c.x + leftX(c.heading) * lateral;
      const z = c.z + leftZ(c.heading) * lateral;
      return tr.query(x, z, p.index);
    };
    expect(at(fwd, 3).warp).toBe(1);
    expect(at(fwd, -3).warp).toBe(1);
    const side = reverseWarpSide(rev.index);
    const onSide = [at(rev, 3), at(rev, -3)].find((q) => Math.sign(q.lateral) === side)!;
    const offSide = [at(rev, 3), at(rev, -3)].find((q) => Math.sign(q.lateral) === -side)!;
    expect(onSide.warp).toBe(-1);
    expect(offSide.warp).toBe(0);
  });

  it('piso: lama e gelo não afetam o Havac; lama não afeta o Battle Trak', () => {
    expect(surfaceEffect('mud', 'havac').grip).toBe(1);
    expect(surfaceEffect('ice', 'havac').grip).toBe(1);
    expect(surfaceEffect('mud', 'battletrak').grip).toBe(1);
    expect(surfaceEffect('mud', 'marauder').grip).toBeLessThan(1);
    expect(surfaceEffect('ice', 'marauder').grip).toBeLessThan(surfaceEffect('mud', 'marauder').grip);
    expect(new Track(tracksOfPlanet('bogmire')[0]).surface).toBe('mud');
    expect(new Track(tracksOfPlanet('nho')[0]).surface).toBe('ice');
  });
});
