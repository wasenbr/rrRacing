import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { emptyInput } from './input';
import { createProgress, updateProgress } from './race';
import { Track } from './track';
import { createVehicleState, forwardSpeed, stepVehicle } from './vehicle';

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
    for (const layout of ['F S S J G S S S R S S S S S S S R S S S S S S S R S S S S S S S R', 'F S S J G J G S S R S S S S S S R S S S S S S S R S S S S S S R']) {
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
