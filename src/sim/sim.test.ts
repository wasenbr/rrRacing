import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { emptyInput } from './input';
import { createProgress, updateProgress } from './race';
import { JUMP_HEIGHT, TILE, Track } from './track';
import { createVehicleState, forwardSpeed, stepVehicle } from './vehicle';
import { createWorld, raceDistance } from './world';

const DT = 1 / 60;

describe('pistas', () => {
  for (const def of TRACKS) {
    it(`${def.id} fecha o circuito`, () => {
      const track = new Track(def);
      expect(track.isClosed).toBe(true);
    });

    it(`${def.id}: pontos da linha central projetam com lateral ~0`, () => {
      const track = new Track(def);
      for (const pt of track.sampleCenterline(1)) {
        const q = track.query(pt.x, pt.z, pt.pieceIndex);
        expect(Math.abs(q.lateral)).toBeLessThan(1e-6);
        expect(q.height).toBeCloseTo(pt.h, 6);
      }
    });
  }
});

describe('veículo', () => {
  const track = new Track(TRACKS[0]);
  const spec = VEHICLES.marauder;
  // chão plano e largo, sem mureta: só a física da curva
  const flat = {
    halfWidth: 1000, surface: 'asphalt', pieces: [{ code: 'S', length: 1e9 }], heightOn: () => 0,
    query: () => ({ height: 0, lateral: 0, heading: 0, pieceIndex: 0, void: false, warp: 0, dist: 0, s: 0 }),
  } as unknown as Track;

  it('acelera na reta', () => {
    const v = createVehicleState(spec, 0, 4, 0);
    const input = { ...emptyInput(), throttle: 1 };
    for (let i = 0; i < 60; i++) stepVehicle(v, spec, input, track, DT);
    expect(forwardSpeed(v)).toBeGreaterThan(15);
    expect(v.z).toBeGreaterThan(10);
  });

  it('esterço forte seguro em alta velocidade derrapa; devagar não', () => {
    const slip = (speed: number, steps = 45, throttle = 1) => {
      const v = createVehicleState(spec, 0, 4, 0);
      v.vz = speed;
      let max = 0;
      for (let i = 0; i < steps; i++) {
        stepVehicle(v, spec, { ...emptyInput(), throttle, steer: 1 }, flat, DT);
        max = Math.max(max, v.drift);
      }
      return max;
    };
    expect(slip(spec.maxSpeed * 0.95)).toBeGreaterThan(0.5);
    expect(slip(spec.maxSpeed * 0.3, 45, 0)).toBe(0);
    // curva comum (esterço solto antes de ~0,4 s) não derrapa (itens 38/41)
    expect(slip(spec.maxSpeed * 0.95, 22)).toBe(0);
  });

  it('curva de 90° com esterço total perde pouca velocidade (itens 38/41)', () => {
    for (const id of Object.keys(VEHICLES)) {
      const s = VEHICLES[id];
      const v = createVehicleState(s, 0, 0, 0);
      for (let i = 0; i < 600; i++) stepVehicle(v, s, { ...emptyInput(), throttle: 1 }, flat, DT);
      const s0 = Math.hypot(v.vx, v.vz);
      let min = s0;
      for (let i = 0; i < 300 && Math.atan2(v.vx, v.vz) > -Math.PI / 2; i++) {
        stepVehicle(v, s, { ...emptyInput(), throttle: 1, steer: 1 }, flat, DT);
        min = Math.min(min, Math.hypot(v.vx, v.vz));
      }
      expect(Math.atan2(v.vx, v.vz), id).toBeLessThanOrEqual(-Math.PI / 2 + 0.05);
      expect(1 - min / s0, id).toBeLessThanOrEqual(0.08);
    }
  });

  it('grampo de 180° com o botão derrapar: perde no máximo 25% e fecha mais que sem o botão', () => {
    for (const id of Object.keys(VEHICLES)) {
      const s = VEHICLES[id];
      const hairpin = (sharp: boolean) => {
        const v = createVehicleState(s, 0, 0, 0);
        for (let i = 0; i < 600; i++) stepVehicle(v, s, { ...emptyInput(), throttle: 1 }, flat, DT);
        const s0 = Math.hypot(v.vx, v.vz);
        const x0 = v.x;
        let prev = Math.atan2(v.vx, v.vz);
        let turned = 0;
        let width = 0;
        for (let i = 0; i < 600 && turned < Math.PI; i++) {
          stepVehicle(v, s, { ...emptyInput(), throttle: 1, steer: 1, sharp }, flat, DT);
          const a = Math.atan2(v.vx, v.vz);
          turned -= Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
          prev = a;
          width = Math.max(width, Math.abs(v.x - x0));
        }
        expect(turned, id).toBeGreaterThanOrEqual(Math.PI);
        return { exit: Math.hypot(v.vx, v.vz) / s0, width };
      };
      const norm = hairpin(false);
      const drift = hairpin(true);
      expect(drift.exit, id).toBeGreaterThanOrEqual(0.75);
      expect(drift.width, id).toBeLessThan(norm.width * 0.75);
    }
  });

  it('nunca atravessa o guard-rail', () => {
    const v = createVehicleState(spec, 0, 4, 0);
    const input = { ...emptyInput(), throttle: 1, steer: -1 };
    for (let i = 0; i < 600; i++) {
      stepVehicle(v, spec, input, track, DT);
      const q = track.query(v.x, v.z, v.pieceIndex);
      expect(Math.abs(q.lateral)).toBeLessThanOrEqual(track.halfWidth - spec.halfWidth + 1e-6);
    }
  });

  it('raspão na mureta custa pouco; pancada custa mais', () => {
    const reta = new Track({ id: 'reta', name: 'reta', planet: 'x', theme: 'chem6', laps: 1, layout: 'F ' + 'S '.repeat(20) + 'R S S S R ' + 'S '.repeat(20) + 'R S S S R' });
    const loss = (ang: number) => {
      const s = VEHICLES.dirtdevil;
      const v = createVehicleState(s, 0, 4, 0);
      v.vz = 40;
      for (let i = 0; i < 60; i++) stepVehicle(v, s, { ...emptyInput(), throttle: 1 }, reta, DT);
      v.heading = reta.query(v.x, v.z, v.pieceIndex).heading + ang;
      const s0 = Math.hypot(v.vx, v.vz);
      v.vx = Math.sin(v.heading) * s0;
      v.vz = Math.cos(v.heading) * s0;
      let min = s0;
      let hit = false;
      for (let i = 0; i < 90; i++) {
        stepVehicle(v, s, { ...emptyInput(), throttle: 1 }, reta, DT);
        hit ||= v.wallImpact > 0;
        min = Math.min(min, Math.hypot(v.vx, v.vz));
      }
      expect(hit).toBe(true);
      return 1 - min / s0;
    };
    expect(loss(0.12)).toBeLessThan(0.07); // raspão de ~7°
    expect(loss(0.5)).toBeGreaterThan(0.15); // pancada de ~30°
  });

  it('decola no salto', () => {
    // pista própria com salto na primeira reta (o relevo das pistas originais é gerado por regras)
    const track = new Track({ id: 'salto', name: 'salto', planet: 'x', theme: 'chem6', laps: 1, layout: 'F S S J S S S R S S S S S S S R S S S S S S S R S S S S S S S R' });
    const v = createVehicleState(spec, 0, 4, 0);
    const input = { ...emptyInput(), throttle: 1 };
    let maxAir = 0;
    for (let i = 0; i < 240; i++) {
      stepVehicle(v, spec, input, track, DT);
      maxAir = Math.max(maxAir, v.airTime);
    }
    expect(maxAir).toBeGreaterThan(0.3);
  });

  it('vão (G): sem chão invisível; quem chega rápido pousa no sólido, o lento cai', () => {
    // (a última: vão com queda, o pouso fica um nível abaixo da decolagem)
    for (const layout of ['F S S J G S S S R S S S S S S S R S S S S S S S R S S S S S S S R', 'F S S J G J G S S R S S S S S S R S S S S S S S R S S S S S S R', 'F S S J Gv S S S R S S S S S S S R S S S S S S S R S S S S S S S R']) {
      const tr = new Track({ id: 'vao', name: 'vao', planet: 'x', theme: 'chem6', laps: 1, layout });
      for (const sp of [17, 25, 30, 35, 40, 45, 50, 58]) {
        const sSpec = { ...spec, maxSpeed: 70, accel: 0, drag: 0 };
        const v = createVehicleState(sSpec, 0, 4, 0);
        v.vz = sp;
        let landedOnVoid = false;
        let landings = 0;
        for (let i = 0; i < 60 * 7 && !v.fell; i++) {
          stepVehicle(v, sSpec, { ...emptyInput(), throttle: 1 }, tr, DT);
          if (v.landingImpact > 0) {
            landings++;
            if (tr.pieces[v.pieceIndex].code === 'G') landedOnVoid = true;
          }
        }
        expect(landedOnVoid, `${layout.slice(0, 13)} ${sp}`).toBe(false);
        if (sp < 20) expect(v.fell, `${sp} deveria cair`).toBe(true);
        else {
          expect(v.fell, `${layout.slice(0, 13)} ${sp} caiu`).toBe(false);
          expect(landings, `${sp}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('salto curto e baixo (itens 22/35): ápice até 1,5 m acima do lábio e pouso até 10 m depois do vão', () => {
    for (const mid of ['J G', 'J Gv', 'J G J G']) {
      const tr = new Track({ id: 'salto', name: 'salto', planet: 'x', theme: 'chem6', laps: 1, layout: `F S S S ${mid} S S S R S S S S S S S R S S S S S S S R S S S S S S S R` });
      const jumps = mid.split(' ').filter((c) => c === 'J').length;
      for (const sp of [25, 35, 45, 55]) {
        const sSpec = { ...spec, maxSpeed: 70, accel: 0, drag: 0 };
        const v = createVehicleState(sSpec, 0, 0, 0);
        // 2 casas antes da primeira rampa J (casa 4)
        const pt = tr.pointAtDist(2 * TILE);
        Object.assign(v, { x: pt.x, z: pt.z, heading: pt.heading, pieceIndex: pt.pieceIndex, vx: Math.sin(pt.heading) * sp, vz: Math.cos(pt.heading) * sp });
        let apex = -Infinity;
        let lip = 0;
        let flying = false;
        let landed = 0;
        for (let i = 0; i < 60 * 5 && landed < jumps && !v.fell; i++) {
          const from = tr.pieces[v.pieceIndex];
          stepVehicle(v, sSpec, { ...emptyInput(), throttle: 1 }, tr, DT);
          if (!v.grounded && !flying) {
            flying = true;
            lip = from.h0 + JUMP_HEIGHT;
            apex = v.y;
          }
          if (flying) apex = Math.max(apex, v.y);
          if (flying && v.grounded) {
            flying = false;
            landed++;
            const q = tr.query(v.x, v.z, v.pieceIndex);
            let g = q.pieceIndex;
            while (tr.pieces[g].code !== 'G') g--;
            const after = q.dist - (tr.pieces[g].startDist + tr.pieces[g].length);
            const tag = `${mid} ${sp} m/s salto ${landed}`;
            expect(apex - lip, `${tag}: ápice`).toBeLessThanOrEqual(1.5);
            expect(after, `${tag}: pouso antes do fim do vão`).toBeGreaterThan(0);
            expect(after, `${tag}: pouso longe`).toBeLessThanOrEqual(10);
          }
        }
        expect(v.fell, `${mid} ${sp} caiu`).toBe(false);
        expect(landed, `${mid} ${sp}`).toBe(jumps);
      }
    }
  });

  it('completa voltas seguindo a linha central', () => {
    // piloto automático simples: mira num ponto à frente na linha central
    const pts = track.sampleCenterline(1);
    const v = createVehicleState(spec, 0, 4, 0);
    const p = createProgress(track, v);
    let time = 0;
    let laps = 0;
    for (let i = 0; i < 60 * 180 && laps < 2; i++) {
      const q = track.query(v.x, v.z, v.pieceIndex);
      const target = pts[Math.floor(q.dist + 10) % pts.length];
      const desired = Math.atan2(target.x - v.x, target.z - v.z);
      let diff = desired - v.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const input = { ...emptyInput(), throttle: 0.8, steer: Math.max(-1, Math.min(1, -diff * 3)) };
      stepVehicle(v, spec, input, track, DT);
      time += DT;
      const e = updateProgress(p, track, v, time, 4, DT);
      if (e?.type === 'lap') laps++;
    }
    expect(laps).toBe(2);
    expect(p.lapTimes[0]).toBeGreaterThan(5);
  });
});

describe('regras de volta', () => {
  const track = new Track(TRACKS[0]);
  const spec = VEHICLES.marauder;
  const T = track.totalLength;

  /** Põe o carro na linha central a `dist` metros da chegada, andando no sentido `dir`. */
  function place(v: ReturnType<typeof createVehicleState>, dist: number, dir = 1): void {
    const pt = track.pointAtDist(dist);
    v.x = pt.x;
    v.z = pt.z;
    v.heading = pt.heading;
    v.pieceIndex = pt.pieceIndex;
    v.vx = Math.sin(pt.heading) * 10 * dir;
    v.vz = Math.cos(pt.heading) * 10 * dir;
  }

  /** Leva o carro de `from` a `to` (metros, podem passar de T ou ficar negativos) em passos de 2 m. */
  function drive(v: ReturnType<typeof createVehicleState>, p: ReturnType<typeof createProgress>, from: number, to: number, laps = 3) {
    const events: string[] = [];
    const dir = Math.sign(to - from) || 1;
    const n = Math.ceil(Math.abs(to - from) / 2);
    for (let i = 1; i <= n; i++) {
      place(v, from + ((to - from) * i) / n, dir);
      const e = updateProgress(p, track, v, i * 0.1, laps, 0.1);
      if (e) events.push(e.type === 'lap' ? `lap${e.lap}` : 'finish');
    }
    return events;
  }

  it('largada atrás da linha: a primeira passagem não conta volta (item 45)', () => {
    const v = createVehicleState(spec, 0, 0, 0);
    place(v, -11);
    const p = createProgress(track, v);
    expect(p.beforeLine).toBe(true);
    expect(drive(v, p, -11, 20)).toEqual([]);
    expect(p.lap).toBe(1);
    expect(p.beforeLine).toBe(false);
    // uma volta inteira depois, conta a volta 2
    expect(drive(v, p, 20, T + 10)).toEqual(['lap2']);
    expect(p.lapTimes.length).toBe(1);
  });

  it('cruzar a linha de ré e voltar não conta volta', () => {
    const v = createVehicleState(spec, 0, 0, 0);
    place(v, 10);
    const p = createProgress(track, v);
    expect(p.beforeLine).toBe(false);
    expect(drive(v, p, 10, -20)).toEqual([]);
    expect(drive(v, p, -20, 20)).toEqual([]);
    expect(p.lap).toBe(1);
    // depois de uma volta válida, dar ré na linha e cruzar de novo também não soma
    expect(drive(v, p, 20, T + 10)).toEqual(['lap2']);
    expect(drive(v, p, T + 10, T - 20)).toEqual([]);
    expect(drive(v, p, T - 20, T + 20)).toEqual([]);
    expect(p.lap).toBe(2);
    expect(p.lapTimes.length).toBe(1);
  });

  it('ordem de posições com o grid atrás da linha e ao cruzá-la', () => {
    const entries = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, color: 0, spec, ai: null }));
    const world = createWorld(track, entries, 3, 1);
    // grid atrás da linha: fileira da frente (slots 0/1) à frente da de trás (2/3)
    for (const r of world.racers) expect(r.progress.beforeLine).toBe(true);
    const front = world.racers.slice(0, 2).map((r) => r.place).sort();
    const back = world.racers.slice(2).map((r) => r.place).sort();
    expect(front).toEqual([1, 2]);
    expect(back).toEqual([3, 4]);
    // quem ainda está atrás da linha (beforeLine) fica atrás de quem já a cruzou
    const [a, b] = world.racers;
    drive(a.car, a.progress, -4, 6);
    expect(a.progress.beforeLine).toBe(false);
    expect(raceDistance(world, a)).toBeGreaterThan(raceDistance(world, b));
    expect(raceDistance(world, b)).toBeLessThan(0);
    // continuidade: cruzar a linha não salta uma volta na distância
    expect(raceDistance(world, a)).toBeLessThan(10);
  });

  it('dar ré sobre a linha depois da 1ª volta não infla a distância da classificação', () => {
    const entries = [0, 1].map((i) => ({ name: `P${i}`, color: 0, spec, ai: null }));
    const world = createWorld(track, entries, 3, 1);
    const [a] = world.racers;
    drive(a.car, a.progress, -4, T + 10);
    expect(a.progress.lap).toBe(2);
    const before = raceDistance(world, a);
    drive(a.car, a.progress, T + 10, T - 10);
    // voltou ~20 m: a distância cai ~20 m, não sobe quase uma volta
    expect(raceDistance(world, a)).toBeLessThan(before);
    expect(raceDistance(world, a)).toBeGreaterThan(before - 40);
  });
});
