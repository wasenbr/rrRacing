import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { AI_TUNING, computeAiInput } from './ai';
import { newCampaign, opponentsFor } from './campaign';
import { emptyInput } from './input';
import { Track } from './track';
import { createVehicleState } from './vehicle';
import { createWorld, draftBehind, KILL_BOUNTY, stepWorld, WEAPONS, type RacerEntry } from './world';

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

  it('em todas as pistas, com 4 carros, quem termina estaciona encostado na beira, sem sobrepor outro', () => {
    const ids = Object.keys(VEHICLES);
    const lanes = [0.5, -1, 1.5, -2];
    const fails: string[] = [];
    for (const seed of [1, 42])
      for (const def of TRACKS) {
        const t = new Track(def);
        const entries: RacerEntry[] = lanes.map((lane, i) => ({ name: `C${i}`, color: 0, spec: VEHICLES[ids[i % ids.length]], ai: { skill: 0.95 - i * 0.1, aggression: 0.6, lane } }));
        const world = createWorld(t, entries, 1, seed);
        world.started = true;
        for (let i = 0; i < 60 * 300 && world.finishedCount < 4; i++) stepWorld(world, {}, DT);
        for (let i = 0; i < 60 * 8; i++) stepWorld(world, {}, DT);
        const done = world.racers.filter((r) => r.finishPlace);
        if (done.length < 4) fails.push(`${def.id}/${seed}: só ${done.length} terminaram`);
        for (const r of done) {
          const lat = Math.abs(t.query(r.car.x, r.car.z, r.car.pieceIndex).lateral);
          const v = Math.hypot(r.car.vx, r.car.vz);
          if (!(lat > t.halfWidth - 2.5 && v < 0.3)) fails.push(`${def.id}/${seed} P${r.finishPlace}: lateral ${lat.toFixed(1)}, v ${v.toFixed(1)}`);
          for (const o of done) if (o.id > r.id && Math.hypot(o.car.x - r.car.x, o.car.z - r.car.z) < 3) fails.push(`${def.id}/${seed}: P${r.finishPlace} e P${o.finishPlace} sobrepostos`);
        }
      }
    expect(fails).toEqual([]);
  }, 120000);

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

  it('cooperativa: tiro, mina e óleo do parceiro não pegam; os do rival pegam', () => {
    const hitBy = (team: number | undefined) => {
      const entries: RacerEntry[] = [
        { name: 'Alvo', color: 0, spec: VEHICLES.marauder, ai: null, team: 1 },
        { name: 'Atirador', color: 0, spec: VEHICLES.havac, ai: null, team },
      ];
      const world = createWorld(track, entries, 4, 1);
      const [target] = world.racers;
      const fx = Math.sin(target.car.heading), fz = Math.cos(target.car.heading);
      world.projectiles.push({ id: 90, kind: 'laser', owner: 1, x: target.car.x - fx * 1, y: target.car.y + 0.7, z: target.car.z - fz * 1, heading: target.car.heading, speed: 1, life: 2, pieceIndex: target.car.pieceIndex });
      world.hazards.push({ id: 98, kind: 'oil', owner: 1, x: target.car.x, y: target.car.y, z: target.car.z, age: 5 });
      target.car.vx = fx * 20;
      target.car.vz = fz * 20;
      world.started = true;
      stepWorld(world, {}, DT);
      return { armor: target.armor < target.spec.armor, spin: target.spinTime > 0 };
    };
    expect(hitBy(1)).toEqual({ armor: false, spin: false });
    expect(hitBy(undefined)).toEqual({ armor: true, spin: true });
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
      const sp = cpu.spec.maxSpeed * (AI_TUNING.basePace + (1 - AI_TUNING.basePace) * 0.5) * 1.02; // acima do alvo normal, abaixo do alvo com elástico
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
      const n = tr.loop;
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

  it('mancha de óleo some depois de 2 giros ou do tempo de vida', () => {
    const entries: RacerEntry[] = [0, 1, 2].map((i) => ({ name: `C${i}`, color: 0, spec: VEHICLES.marauder, ai: null }));
    const world = createWorld(track, entries, 4, 1);
    world.started = true;
    const oil = { id: 98, kind: 'oil' as const, owner: -1, x: 0, y: 0, z: 0, age: 5 };
    world.hazards.push(oil);
    const [a, b, c] = world.racers;
    for (const r of [a, b]) {
      Object.assign(r.car, { x: oil.x, z: oil.z, vx: Math.sin(r.car.heading) * 20, vz: Math.cos(r.car.heading) * 20 });
      stepWorld(world, {}, DT);
      expect(r.spinTime).toBeGreaterThan(0);
      r.car.x = r.car.z = 500; // sai da mancha
    }
    expect(world.hazards.includes(oil)).toBe(false);
    // tempo de vida: sem ninguém passar, some ao fim de WEAPONS.oil.life
    const old = { ...oil, id: 99, x: 300, z: 300, age: WEAPONS.oil.life - 0.01, spins: 0 };
    world.hazards.push(old);
    c.car.x = c.car.z = 600;
    for (let i = 0; i < 3; i++) stepWorld(world, {}, DT);
    expect(world.hazards.includes(old)).toBe(false);
  });

  it('míssil só curva num cone em torno do disparo e o sundog para de perseguir', () => {
    const entries: RacerEntry[] = [
      { name: 'Alvo', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'Atirador', color: 0, spec: VEHICLES.havac, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    world.started = true;
    const [target] = world.racers;
    const t = target.car;
    const lx = Math.cos(t.heading), lz = -Math.sin(t.heading);
    const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
    // alvo 20 m à frente e 6 m ao lado (~0,29 rad): o míssil vira até o limite do cone e para ali
    const aim = t.heading;
    world.projectiles.push({ id: 90, kind: 'missile', owner: 1, x: t.x - fx * 20 - lx * 6, y: t.y + 1, z: t.z - fz * 20 - lz * 6, heading: aim, speed: 0.01, life: 2, pieceIndex: t.pieceIndex, aim });
    let turned = 0;
    for (let i = 0; i < 60; i++) {
      stepWorld(world, {}, DT);
      const m = world.projectiles.find((p) => p.id === 90)!;
      turned = Math.abs(m.heading - aim);
      expect(turned).toBeLessThanOrEqual(WEAPONS.missile.maxTurn + 1e-9);
    }
    expect(turned).toBeCloseTo(WEAPONS.missile.maxTurn, 6);
    // sundog já velho (passou do tempo de perseguição): não curva mais
    world.projectiles = [];
    world.projectiles.push({ id: 91, kind: 'sundog', owner: 1, x: t.x - lx * 6, y: t.y + 1, z: t.z - lz * 6, heading: aim, speed: 0.01, life: WEAPONS.sundog.life - WEAPONS.sundog.chase - 0.05, pieceIndex: t.pieceIndex });
    // (um sundog novo, no mesmo lugar, curva para o alvo)
    world.projectiles.push({ id: 92, kind: 'sundog', owner: 1, x: t.x - lx * 6, y: t.y + 1, z: t.z - lz * 6, heading: aim, speed: 0.01, life: WEAPONS.sundog.life, pieceIndex: t.pieceIndex });
    stepWorld(world, {}, DT);
    expect(world.projectiles.find((p) => p.id === 91)!.heading).toBeCloseTo(aim, 9);
    expect(Math.abs(world.projectiles.find((p) => p.id === 92)!.heading - aim)).toBeGreaterThan(0.01);
  });
  it('corridas mistas (um carro de cada, mesma CPU): nenhum modelo domina nem fica para trás', () => {
    // versão rápida do cenário "mixed" das evidências: 2 pistas por planeta, 2 sementes, grid girando
    const ids = Object.keys(VEHICLES);
    const wins: Record<string, number> = {};
    const place: Record<string, number> = {};
    let races = 0;
    const themes = [...new Set(TRACKS.map((t) => t.theme))];
    for (const theme of themes)
      for (const def of TRACKS.filter((t) => t.theme === theme).slice(0, 2))
        for (const seed of [3, 9]) {
          const order = ids.map((_, i) => ids[(i + seed) % ids.length]);
          const entries: RacerEntry[] = order.map((id, i) => ({ name: id, color: 0, spec: VEHICLES[id], ai: { skill: 0.8, aggression: 0.6, lane: [-1.5, -0.5, 0.5, 1.5, 0][i] } }));
          const w = createWorld(new Track(def), entries, 3, seed);
          w.started = true;
          for (let k = 0; k < 60 * 600 && w.finishedCount < entries.length; k++) stepWorld(w, {}, DT);
          races++;
          for (const r of w.racers) {
            if (r.finishPlace === 1) wins[r.name] = (wins[r.name] ?? 0) + 1;
            place[r.name] = (place[r.name] ?? 0) + (r.finishPlace || entries.length);
          }
        }
    const fmt = ids.map((id) => `${id} ${wins[id] ?? 0}v ${(place[id] / races).toFixed(2)}`).join(' · ');
    for (const id of ids) {
      // amostra pequena: limites largos (nas 432 corridas das evidências: 15–27% de vitórias, média 2,6–3,3)
      expect((wins[id] ?? 0) / races, fmt).toBeLessThan(0.45);
      expect((wins[id] ?? 0) / races, fmt).toBeGreaterThan(0.04);
      expect(place[id] / races, fmt).toBeGreaterThan(2.2);
      expect(place[id] / races, fmt).toBeLessThan(3.8);
    }
  }, 180000);

  it('vácuo só atrás de quem vai na mesma direção e no mesmo nível', () => {
    const spec = VEHICLES.marauder;
    // carro de trás em (0,0) rumo +z a 30 m/s; o da frente 8 m adiante
    const car = (x: number, z: number, heading: number, y = 0) => {
      const c = createVehicleState(spec, x, z, heading, y);
      c.vx = Math.sin(heading) * 30;
      c.vz = Math.cos(heading) * 30;
      return c;
    };
    const me = car(0, 0, 0);
    expect(draftBehind(me, car(0, 8, 0))).toBeGreaterThan(0.5);
    // cruzando por cima (X) ou em sentido oposto: nada
    expect(draftBehind(me, car(0, 8, Math.PI / 2))).toBe(0);
    expect(draftBehind(me, car(0, 8, Math.PI))).toBe(0);
    // num viaduto acima: nada
    expect(draftBehind(me, car(0, 8, 0, 3))).toBe(0);
    // de viés leve (cos > 0,7) ainda vale
    expect(draftBehind(me, car(0, 8, 0.2))).toBeGreaterThan(0);
  });

  it('tiros e minas que chegam perto de quem já terminou somem sem explodir', () => {
    const entries: RacerEntry[] = [
      { name: 'Parado', color: 0, spec: VEHICLES.marauder, ai: null },
      { name: 'Outro', color: 0, spec: VEHICLES.havac, ai: null },
    ];
    const world = createWorld(track, entries, 4, 1);
    const [done] = world.racers;
    done.finishPlace = 1;
    world.finishedCount = 1;
    world.started = true;
    const c = done.car;
    world.projectiles.push({ id: 90, kind: 'laser', owner: 1, x: c.x + 1, y: c.y + 1, z: c.z, heading: c.heading, speed: 0, life: 1, pieceIndex: c.pieceIndex });
    world.hazards.push({ id: 91, kind: 'mine', owner: 1, x: c.x - 1.5, y: c.y, z: c.z, age: 2 });
    stepWorld(world, {}, DT);
    expect(world.projectiles.length).toBe(0);
    expect(world.hazards.some((h) => h.id === 91)).toBe(false);
    expect(world.events.some((e) => e.type === 'impact' || e.type === 'hit')).toBe(false);
    expect(done.armor).toBe(done.spec.armor);
  });

  it('mina e scatter: arma depois de um tempo; o leque some antes da volta seguinte', () => {
    // (rodada 11: a mina arma rápido; quem desvia ou não é a reação da CPU — ver AI_REACTION)
    expect(WEAPONS.mine.armTime).toBeLessThanOrEqual(0.3);
    expect(WEAPONS.scatter.radius).toBeLessThanOrEqual(0.9);
    expect(WEAPONS.scatter.life).toBeLessThan(15);
  });
});
