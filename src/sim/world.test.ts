import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { newCampaign, opponentsFor } from './campaign';
import { emptyInput } from './input';
import { Track } from './track';
import { createWorld, KILL_BOUNTY, stepWorld, type RacerEntry } from './world';

const DT = 1 / 60;
const track = new Track(TRACKS[0]);

function aiEntries(): RacerEntry[] {
  return opponentsFor(newCampaign('jake', 0), VEHICLES);
}

describe('mundo da corrida', () => {
  it('3 pilotos da CPU completam uma corrida de 2 voltas', () => {
    const world = createWorld(track, aiEntries(), 2, 42);
    world.started = true;
    for (let i = 0; i < 60 * 240 && world.finishedCount < 3; i++) stepWorld(world, {}, DT);
    expect(world.finishedCount).toBe(3);
    const places = world.racers.map((r) => r.finishPlace).sort();
    expect(places).toEqual([1, 2, 3]);
    // o vencedor leva o prêmio
    const winner = world.racers.find((r) => r.finishPlace === 1)!;
    expect(winner.money).toBeGreaterThanOrEqual(20000);
  });

  for (const def of TRACKS) {
    it(`a CPU completa 2 voltas em ${def.id}`, () => {
      const w = createWorld(new Track(def), aiEntries(), 2, 3);
      w.started = true;
      for (let i = 0; i < 60 * 300 && w.finishedCount < 3; i++) stepWorld(w, {}, DT);
      expect(w.finishedCount).toBe(3);
    });
  }

  it('é determinístico: mesma semente, mesmo resultado', () => {
    const run = () => {
      const w = createWorld(track, aiEntries(), 1, 7);
      w.started = true;
      for (let i = 0; i < 60 * 30; i++) stepWorld(w, {}, DT);
      return w.racers.map((r) => [r.car.x.toFixed(6), r.car.z.toFixed(6), r.armor]);
    };
    expect(run()).toEqual(run());
  });

  it('míssil acerta o carro da frente e causa dano', () => {
    const entries: RacerEntry[] = [
      { name: 'Alvo', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'Atirador', color: 0, spec: VEHICLES.havac, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    // coloca o atirador logo atrás do alvo, na mesma faixa
    const shooter = world.racers[1];
    const target = world.racers[0];
    shooter.car.x = target.car.x - Math.sin(target.car.heading) * 10;
    shooter.car.z = target.car.z - Math.cos(target.car.heading) * 10;
    shooter.car.heading = target.car.heading;
    world.started = true;
    stepWorld(world, { 1: { ...emptyInput(), fire: true } }, DT);
    expect(world.projectiles.length).toBe(1);
    for (let i = 0; i < 60; i++) stepWorld(world, {}, DT);
    expect(target.armor).toBeLessThan(target.spec.armor);
  });

  it('carro sem blindagem explode e reaparece', () => {
    const entries: RacerEntry[] = [
      { name: 'A', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'B', color: 0, spec: VEHICLES.havac, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    const target = world.racers[0];
    target.armor = 5;
    world.hazards.push({ id: 99, kind: 'mine', owner: 1, x: target.car.x, y: target.car.y, z: target.car.z, age: 10 });
    world.started = true;
    stepWorld(world, {}, DT);
    expect(target.alive).toBe(false);
    expect(world.events.some((e) => e.type === 'explode')).toBe(true);
    for (let i = 0; i < 60 * 3; i++) stepWorld(world, {}, DT);
    expect(target.alive).toBe(true);
    expect(target.armor).toBe(target.spec.armor);
    // quem plantou a mina leva a destruição, mas (como no original) mina não dá "attack bonus"
    expect(world.racers[1].kills).toBe(1);
    expect(world.racers[1].money).toBe(0);
  });

  it('scatterpack dá o "attack bonus" pela destruição', () => {
    const entries: RacerEntry[] = [
      { name: 'A', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'B', color: 0, spec: VEHICLES.havac, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    const target = world.racers[0];
    target.armor = 5;
    world.hazards.push({ id: 99, kind: 'scatter', owner: 1, x: target.car.x, y: target.car.y, z: target.car.z, age: 10 });
    world.started = true;
    stepWorld(world, {}, DT);
    expect(target.alive).toBe(false);
    expect(world.racers[1].money).toBe(KILL_BOUNTY);
  });

  it('scatterpack solta um leque de minas', () => {
    const world = createWorld(track, [{ name: 'A', color: 0, spec: VEHICLES.havac, ai: null }], 4, 1);
    world.started = true;
    stepWorld(world, { 0: { ...emptyInput(), drop: true } }, DT);
    expect(world.hazards.filter((h) => h.kind === 'scatter').length).toBeGreaterThanOrEqual(3);
  });

  it('Battle Trak e Havac são imunes ao óleo', () => {
    for (const id of ['battletrak', 'havac']) {
      const world = createWorld(track, [{ name: 'A', color: 0, spec: VEHICLES[id], ai: null }], 4, 1);
      const car = world.racers[0].car;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      world.hazards.push({ id: 98, kind: 'oil', owner: -1, x: car.x + fx * 20, y: car.y, z: car.z + fz * 20, age: 5 });
      world.started = true;
      let spins = 0;
      for (let i = 0; i < 60 * 3; i++) {
        stepWorld(world, { 0: { ...emptyInput(), throttle: 1 } }, DT);
        spins += world.events.filter((e) => e.type === 'spin').length;
      }
      expect(spins).toBe(0);
    }
  });

  it('jatos de pulo tiram o carro do chão; turbo acelera', () => {
    const world = createWorld(track, [{ name: 'A', color: 0, spec: VEHICLES.dirtdevil, ai: null }], 4, 1);
    world.started = true;
    for (let i = 0; i < 30; i++) stepWorld(world, { 0: { ...emptyInput(), throttle: 1 } }, DT);
    stepWorld(world, { 0: { ...emptyInput(), throttle: 1, nitro: true } }, DT);
    expect(world.events.some((e) => e.type === 'assist' && e.kind === 'jump')).toBe(true);
    for (let i = 0; i < 6; i++) stepWorld(world, { 0: { ...emptyInput(), throttle: 1 } }, DT);
    expect(world.racers[0].car.grounded).toBe(false);
  });

  it('batida forte fere os dois carros', () => {
    const entries: RacerEntry[] = [
      { name: 'A', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'B', color: 0, spec: VEHICLES.marauder, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    world.started = true;
    const [a, b] = world.racers;
    b.car.x = a.car.x + Math.sin(a.car.heading) * 2.2;
    b.car.z = a.car.z + Math.cos(a.car.heading) * 2.2;
    a.car.vx = Math.sin(a.car.heading) * 30;
    a.car.vz = Math.cos(a.car.heading) * 30;
    stepWorld(world, {}, DT);
    expect(a.armor).toBeLessThan(a.spec.armor);
    expect(b.armor).toBeLessThan(b.spec.armor);
  });

  it('dificuldade muda o dano que o jogador sofre', () => {
    const hurt = (d: 'easy' | 'hard') => {
      const entries: RacerEntry[] = [
        { name: 'P', color: 0, spec: VEHICLES.marauder, ai: null },
        { name: 'C', color: 0, spec: VEHICLES.havac, ai: { skill: 0.5, aggression: 0, lane: 0 } },
      ];
      const world = createWorld(track, entries, 4, 1, undefined, d);
      const p = world.racers[0];
      world.hazards.push({ id: 99, kind: 'mine', owner: 1, x: p.car.x, y: p.car.y, z: p.car.z, age: 10 });
      stepWorld(world, {}, DT);
      return p.spec.armor - p.armor;
    };
    expect(hurt('hard')).toBeGreaterThan(hurt('easy'));
  });

  it('óleo faz o carro rodar uma vez e não de novo na mesma mancha', () => {
    const entries: RacerEntry[] = [{ name: 'A', color: 0, spec: VEHICLES.marauder, ai: null }];
    const world = createWorld(track, entries, 4, 1);
    const car = world.racers[0].car;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    world.hazards.push({ id: 98, kind: 'oil', owner: -1, x: car.x + fx * 20, y: car.y, z: car.z + fz * 20, age: 5 });
    world.started = true;
    let spins = 0;
    for (let i = 0; i < 60 * 3; i++) {
      stepWorld(world, { 0: { ...emptyInput(), throttle: 1 } }, DT);
      spins += world.events.filter((e) => e.type === 'spin').length;
    }
    expect(spins).toBe(1);
  });
});
