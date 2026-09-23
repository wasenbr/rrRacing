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
    const v = createVehicleState(spec, 0, 4, 0);
    const input = { ...emptyInput(), throttle: 1 };
    let maxAir = 0;
    for (let i = 0; i < 240; i++) {
      stepVehicle(v, spec, input, track, DT);
      maxAir = Math.max(maxAir, v.airTime);
    }
    expect(maxAir).toBeGreaterThan(0.3);
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
