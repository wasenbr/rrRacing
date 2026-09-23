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

  it('acelera na reta', () => {
    const v = createVehicleState(spec, 0, 4, 0);
    const input = { ...emptyInput(), throttle: 1 };
    for (let i = 0; i < 60; i++) stepVehicle(v, spec, input, track, DT);
    expect(forwardSpeed(v)).toBeGreaterThan(15);
    expect(v.z).toBeGreaterThan(10);
  });

  it('esterço forte em alta velocidade derrapa; devagar não', () => {
    const slip = (speed: number) => {
      const v = createVehicleState(spec, 0, 4, 0);
      v.vz = speed;
      let max = 0;
      for (let i = 0; i < 20; i++) {
        stepVehicle(v, spec, { ...emptyInput(), throttle: 1, steer: 1 }, track, DT);
        max = Math.max(max, v.drift);
      }
      return max;
    };
    expect(slip(spec.maxSpeed * 0.95)).toBeGreaterThan(0.5);
    expect(slip(spec.maxSpeed * 0.3)).toBe(0);
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
