import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { computeAiInput } from './ai';
import { newCampaign, opponentsFor } from './campaign';
import { emptyInput } from './input';
import { Track } from './track';
import { createWorld, KILL_BOUNTY, stepWorld, WEAPONS, type RacerEntry } from './world';

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

  it('quem cruza a chegada para, não recua e fica fora da disputa (como no original)', () => {
    const world = createWorld(track, aiEntries(), 1, 42);
    world.started = true;
    for (let i = 0; i < 60 * 240 && world.finishedCount < 1; i++) stepWorld(world, {}, DT);
    const done = world.racers.find((r) => r.finishPlace === 1)!;
    expect(done).toBeDefined();
    for (let i = 0; i < 60 * 6; i++) stepWorld(world, {}, DT);
    expect(Math.hypot(done.car.vx, done.car.vz)).toBeLessThan(0.3);
    // parado: nem dano nem empurrão de quem passa
    const armor = done.armor;
    const other = world.racers.find((r) => r !== done)!;
    other.car.x = done.car.x;
    other.car.z = done.car.z;
    const x = done.car.x;
    stepWorld(world, {}, DT);
    expect(done.car.x).toBeCloseTo(x, 3);
    expect(done.armor).toBe(armor);
  });

  it('quem termina estaciona na beira da pista, sem sobrepor o outro terminado', () => {
    const world = createWorld(track, aiEntries(), 1, 42);
    world.started = true;
    for (let i = 0; i < 60 * 240 && world.finishedCount < 2; i++) stepWorld(world, {}, DT);
    expect(world.finishedCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 60 * 8; i++) stepWorld(world, {}, DT);
    const [a, b] = [1, 2].map((p) => world.racers.find((r) => r.finishPlace === p)!);
    for (const r of [a, b]) {
      expect(Math.hypot(r.car.vx, r.car.vz)).toBeLessThan(0.3);
      expect(Math.abs(track.query(r.car.x, r.car.z, r.car.pieceIndex).lateral)).toBeGreaterThan(2.5);
    }
    expect(Math.hypot(a.car.x - b.car.x, a.car.z - b.car.z)).toBeGreaterThan(4);
  });

  it('terminado parado numa rampa não recua', () => {
    const ramp = new Track({ id: 'rampa', name: 'rampa', planet: 'x', theme: 'chem6', laps: 1, layout: 'F U S S S R S S S S S S S R S S D S S S S R S S S S S S S R' });
    const world = createWorld(ramp, [{ name: 'A', color: 0, spec: VEHICLES.marauder, ai: null }], 1, 1);
    world.started = true;
    const r = world.racers[0];
    const p = ramp.pointAtDist(27);
    Object.assign(r.car, { x: p.x, z: p.z, y: p.h, heading: p.heading, pieceIndex: p.pieceIndex, vx: Math.sin(p.heading) * 3, vz: Math.cos(p.heading) * 3 });
    r.finishPlace = 1;
    r.progress.finished = true;
    world.finishedCount = 1;
    let last = 27;
    for (let i = 0; i < 60 * 6; i++) {
      stepWorld(world, {}, DT);
      const d = ramp.query(r.car.x, r.car.z, r.car.pieceIndex).dist;
      expect(d).toBeGreaterThanOrEqual(last - 1e-6);
      last = d;
    }
    const x = r.car.x;
    const z = r.car.z;
    for (let i = 0; i < 60 * 3; i++) stepWorld(world, {}, DT);
    expect(Math.hypot(r.car.x - x, r.car.z - z)).toBeLessThan(1e-6);
  });

  it('quem terminou não é alvo: míssil, sundog, óleo e elástico da CPU o ignoram', () => {
    const entries: RacerEntry[] = [
      { name: 'Alvo', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'Atirador', color: 0, spec: VEHICLES.havac, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    const [target, shooter] = world.racers;
    target.finishPlace = 1;
    const fx = Math.sin(target.car.heading), fz = Math.cos(target.car.heading);
    // sundog atrás, apontado de viés: com alvo válido ele curvaria para o carro
    world.projectiles.push({ id: 90, kind: 'sundog', owner: 1, x: target.car.x - fx * 10, y: target.car.y + 1, z: target.car.z - fz * 10, heading: target.car.heading + 0.4, speed: 42, life: 2, pieceIndex: target.car.pieceIndex });
    world.hazards.push({ id: 98, kind: 'oil', owner: 1, x: target.car.x, y: target.car.y, z: target.car.z, age: 5 });
    target.car.vx = fx * 20;
    target.car.vz = fz * 20;
    world.started = true;
    const h0 = world.projectiles[0].heading;
    stepWorld(world, {}, DT);
    expect(world.projectiles.length).toBe(1);
    expect(world.projectiles[0].heading).toBeCloseTo(h0, 6);
    expect(target.spinTime).toBe(0);
    expect(shooter.armor).toBe(shooter.spec.armor);
  });

  it('elástico da CPU ignora o humano que já terminou', () => {
    const reta = new Track({ id: 'reta', name: 'reta', planet: 'x', theme: 'chem6', laps: 1, layout: 'F ' + 'S '.repeat(20) + 'R S S S R ' + 'S '.repeat(20) + 'R S S S R' });
    const throttleWith = (humanFinished: boolean) => {
      const entries: RacerEntry[] = [
        { name: 'P', color: 0, spec: VEHICLES.marauder, ai: null },
        { name: 'C', color: 0, spec: VEHICLES.marauder, ai: { skill: 0.5, aggression: 0, lane: 0 } },
      ];
      const world = createWorld(reta, entries, 1, 1);
      world.started = true;
      const [human, cpu] = world.racers;
      // humano uma volta à frente (elástico acelera a CPU enquanto ele corre)
      human.progress.lap = 2;
      if (humanFinished) {
        human.finishPlace = 1;
        world.finishedCount = 1;
      }
      const p = reta.pointAtDist(100);
      const sp = cpu.spec.maxSpeed * (0.72 + 0.5 * 0.28) * 1.02; // acima do alvo normal, abaixo do alvo com elástico
      Object.assign(cpu.car, { x: p.x, z: p.z, heading: p.heading, pieceIndex: p.pieceIndex, vx: Math.sin(p.heading) * sp, vz: Math.cos(p.heading) * sp });
      cpu.progress.lastDist = 100;
      cpu.aiState.thinkTimer = 1;
      return computeAiInput(world, cpu, DT).throttle;
    };
    expect(throttleWith(false)).toBe(1);
    expect(throttleWith(true)).toBe(0);
  });

  it('scatterpack: só uma mina do leque acerta cada carro', () => {
    const entries: RacerEntry[] = [
      { name: 'A', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'B', color: 0, spec: VEHICLES.havac, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    const target = world.racers[0];
    for (let i = 0; i < 3; i++) world.hazards.push({ id: 90 + i, kind: 'scatter', owner: 1, x: target.car.x, y: target.car.y, z: target.car.z, age: 10, group: 90, spared: 0 });
    world.started = true;
    stepWorld(world, {}, DT);
    target.car.grounded = true;
    target.invuln = 0;
    stepWorld(world, {}, DT);
    expect(target.spec.armor - target.armor).toBeCloseTo(WEAPONS.scatter.damage, 6);
    expect(world.hazards.filter((h) => h.kind === 'scatter').length).toBe(2);
  });

  for (const def of TRACKS) {
    it(`a CPU completa 2 voltas em ${def.id}`, () => {
      const w = createWorld(new Track(def), aiEntries(), 2, 3);
      w.started = true;
      for (let i = 0; i < 60 * 300 && w.finishedCount < 3; i++) stepWorld(w, {}, DT);
      expect(w.finishedCount).toBe(3);
    });
  }

  it('todo o grid larga na passagem certa, mesmo em cima de um cruzamento (X)', () => {
    const four = [...aiEntries(), { name: 'Humano', color: 0, spec: VEHICLES.marauder, ai: null }];
    for (const def of TRACKS) {
      const tr = new Track(def);
      const w = createWorld(tr, four, 1, 1);
      const n = tr.pieces.length;
      for (const r of w.racers) expect([0, n - 1, n - 2], `${def.id} vaga ${r.id}`).toContain(r.car.pieceIndex);
      // acelerando reto por 4 s, ninguém fica preso atrás da largada
      w.started = true;
      const go = { ...emptyInput(), throttle: 1 };
      for (let i = 0; i < 240; i++) stepWorld(w, { [w.racers.length - 1]: go }, DT);
      const me = w.racers[w.racers.length - 1].car.pieceIndex;
      expect(me > 0 && me < n / 2, `${def.id} humano na peça ${me}`).toBe(true);
    }
  });

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

  it('Battle Trak e Havac resistem ao óleo (giram metade do tempo)', () => {
    for (const id of ['battletrak', 'havac']) {
      const world = createWorld(track, [{ name: 'A', color: 0, spec: VEHICLES[id], ai: null }], 4, 1);
      const car = world.racers[0].car;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      world.hazards.push({ id: 98, kind: 'oil', owner: -1, x: car.x + fx * 20, y: car.y, z: car.z + fz * 20, age: 5 });
      world.started = true;
      let spin = 0;
      for (let i = 0; i < 60 * 3; i++) {
        stepWorld(world, { 0: { ...emptyInput(), throttle: 1 } }, DT);
        if (world.events.some((e) => e.type === 'spin')) spin = world.racers[0].spinTime;
      }
      expect(spin).toBeGreaterThan(0);
      expect(spin).toBeLessThanOrEqual(WEAPONS.oil.spinTime * 0.5 + 1e-9);
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
