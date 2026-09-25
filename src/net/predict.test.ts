import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { newCampaign, opponentsFor } from '../sim/campaign';
import { emptyInput } from '../sim/input';
import { forwardX, forwardZ } from '../sim/math';
import { Track } from '../sim/track';
import { createWorld, stepDriver, stepWorld, type DriverState, type Hazard, type World } from '../sim/world';
import { applySnapshot, takeSnapshot } from './sync';

const DT = 1 / 60;

/** Mundo com um piloto humano só, largado, e uma poça bem à frente dele. */
function soloWorld(kind: Hazard['kind'], ahead: number): World {
  const track = new Track(TRACKS[0]);
  const entry = { ...opponentsFor(newCampaign('jake', 0), VEHICLES)[0], ai: null };
  const w = createWorld(track, [entry], 3, 5);
  w.started = true;
  w.pickups = [];
  const c = w.racers[0].car;
  w.hazards = [{ id: 900, kind, owner: -1, x: c.x + forwardX(c.heading) * ahead, y: c.y, z: c.z + forwardZ(c.heading) * ahead, age: 1 }];
  return w;
}

/** Mesmo carro pela previsão (stepDriver) e pelo mundo (stepWorld): têm que andar juntos. */
function compare(kind: Hazard['kind'], ahead: number, steps: number): { world: World; pred: DriverState; touched: boolean; spun: boolean; slipped: boolean } {
  const world = soloWorld(kind, ahead);
  const r = world.racers[0];
  const pred: DriverState = { car: { ...r.car }, slipTime: 0, spinTime: 0, spinTotal: 1, oilGrace: 0 };
  const hazards = world.hazards.map((h) => ({ ...h }));
  const input = { ...emptyInput(), throttle: 1 };
  let touched = false;
  let spun = false;
  let slipped = false;
  for (let k = 0; k < steps; k++) {
    stepWorld(world, { 0: input }, DT);
    stepDriver(pred, r.spec, input, 0, true, world.track, hazards, DT);
    touched ||= r.slipTime > 0 || r.spinTime > 0 || Math.hypot(r.car.x - hazards[0].x, r.car.z - hazards[0].z) < 2.3;
    spun ||= r.spinTime > 0;
    slipped ||= r.slipTime > 0;
    expect(pred.car.x).toBeCloseTo(r.car.x, 6);
    expect(pred.car.z).toBeCloseTo(r.car.z, 6);
    expect(pred.car.heading).toBeCloseTo(r.car.heading, 6);
    expect(pred.slipTime).toBeCloseTo(r.slipTime, 6);
    expect(pred.spinTime).toBeCloseTo(r.spinTime, 6);
  }
  return { world, pred, touched, spun, slipped };
}

describe('previsão do convidado: mesmas regras do host', () => {
  it('poça que derrapa: freia e tira aderência igual ao mundo', () => {
    expect(compare('puddle', 14, 150).slipped).toBe(true);
  });

  it('gosma, neve e lava freiam igual ao mundo', () => {
    for (const k of ['slime', 'snow', 'lava'] as const) expect(compare(k, 14, 120).touched).toBe(true);
  });

  it('mancha de óleo: gira igual ao mundo', () => {
    expect(compare('oil', 30, 160).spun).toBe(true);
  });

  it('sem poça no caminho, a previsão é o carro puro', () => {
    expect(compare('slime', -40, 60).touched).toBe(false);
  });

  it('estado do host leva derrapagem e giro (a previsão parte deles)', () => {
    const w = soloWorld('puddle', 0);
    const r = w.racers[0];
    r.slipTime = 0.3;
    r.spinTime = 0.2;
    r.spinTotal = 0.5;
    r.oilGrace = 1;
    const g = soloWorld('puddle', 0);
    applySnapshot(g, JSON.parse(JSON.stringify(takeSnapshot(w, []))));
    expect(g.racers[0].slipTime).toBeCloseTo(0.3);
    expect(g.racers[0].spinTotal).toBeCloseTo(0.5);
    expect(g.racers[0].oilGrace).toBeCloseTo(1);
    // host antigo (sem os campos) ou divisor zerado: nunca divide por zero
    const s = JSON.parse(JSON.stringify(takeSnapshot(w, [])));
    s.racers[0].spinTotal = 0;
    delete s.racers[0].slipTime;
    applySnapshot(g, s);
    expect(g.racers[0].spinTotal).toBeGreaterThan(0);
    expect(g.racers[0].slipTime).toBe(0);
  });
});
