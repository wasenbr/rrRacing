import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { newCampaign, opponentsFor } from '../sim/campaign';
import { emptyInput, type ControlInput } from '../sim/input';
import { Track } from '../sim/track';
import { carContact, createWorld, stepWorld } from '../sim/world';
import { CMDS_PER_MSG, InputQueue, parseInputMsg, TapCounter, type NetCmd } from './inputs';
import { MAX_CLIENT_MSG } from './sync';

const DT = 1 / 60;
const inp = (o: Partial<ControlInput> = {}): ControlInput => ({ ...emptyInput(), ...o });

/** Convidado: gera os comandos de uma sequência de entradas, como o jogo faz a cada passo. */
function guestCmds(inputs: ControlInput[]): NetCmd[] {
  const taps = new TapCounter();
  return inputs.map((i, k) => ({ n: k + 1, i, b: taps.update(i) }));
}

/** Pacotes como o convidado manda: a cada 2 passos, os últimos CMDS_PER_MSG comandos. */
function packets(cmds: NetCmd[]): NetCmd[][] {
  const out: NetCmd[][] = [];
  for (let k = 1; k < cmds.length; k += 2) out.push(cmds.slice(Math.max(0, k + 1 - CMDS_PER_MSG), k + 1));
  return out;
}

describe('comandos do convidado', () => {
  it('conta só as bordas de subida dos toques', () => {
    const t = new TapCounter();
    expect(t.update(inp({ fire: true }))).toEqual([1, 0, 0]);
    expect(t.update(inp({ fire: true }))).toEqual([1, 0, 0]);
    expect(t.update(inp())).toEqual([1, 0, 0]);
    expect(t.update(inp({ fire: true, drop: true, nitro: true }))).toEqual([2, 1, 1]);
  });

  it('toque de um passo entre dois pacotes não se perde (e vira um tiro só)', () => {
    // toque curto no passo 3 (os pacotes saem nos passos 2, 4, 6…)
    const inputs = Array.from({ length: 12 }, (_, k) => inp({ throttle: 1, fire: k === 2 }));
    const q = new InputQueue();
    let shots = 0;
    for (const p of packets(guestCmds(inputs))) {
      q.push(p);
      for (let s = 0; s < 2; s++) if (q.next().fire) shots++;
    }
    expect(shots).toBe(1);
  });

  it('pacote perdido: o contador maior no seguinte ainda dispara', () => {
    const inputs = Array.from({ length: 16 }, (_, k) => inp({ drop: k === 2 || k === 3 }));
    const all = packets(guestCmds(inputs));
    const q = new InputQueue();
    let drops = 0;
    // perde os 3 primeiros pacotes inteiros (inclusive as cópias do toque)
    all.forEach((p, k) => {
      if (k >= 1 && k <= 3) return;
      q.push(p);
      for (let s = 0; s < 2; s++) if (q.next().drop) drops++;
    });
    expect(drops).toBe(1);
  });

  it('dois toques seguidos viram dois pulsos separados (a simulação só dispara na borda)', () => {
    const inputs = [inp(), inp({ nitro: true }), inp(), inp({ nitro: true }), inp(), inp()];
    const q = new InputQueue();
    q.push(guestCmds(inputs));
    const seq = Array.from({ length: 8 }, () => q.next().nitro);
    expect(seq.filter(Boolean).length).toBe(2);
    for (let k = 1; k < seq.length; k++) expect(seq[k] && seq[k - 1]).toBe(false);
  });

  it('aplica na ordem de n, sem repetir, mesmo chegando fora de ordem', () => {
    const cmds = guestCmds(Array.from({ length: 8 }, (_, k) => inp({ steer: k / 10 })));
    const q = new InputQueue();
    q.push([cmds[3], cmds[1]]);
    q.push([cmds[0], cmds[2], cmds[1]]);
    const seen: number[] = [];
    for (let s = 0; s < 4; s++) seen.push(q.next().steer);
    expect(seen).toEqual([0, 0.1, 0.2, 0.3]);
    expect(q.acked).toBe(4);
    // já aplicado: ignora
    q.push([cmds[2]]);
    expect(q.size).toBe(0);
    // sem comando novo: repete o último (sem toques)
    expect(q.next().steer).toBe(0.3);
    expect(q.acked).toBe(4);
  });

  it('fila atrasada descarta os mais velhos sem perder toques', () => {
    const inputs = Array.from({ length: 20 }, (_, k) => inp({ fire: k === 1 }));
    const q = new InputQueue();
    q.push(guestCmds(inputs).slice(0, 4));
    q.push(guestCmds(inputs).slice(4, 8));
    q.push(guestCmds(inputs).slice(8, 12));
    let fired = 0;
    const first = q.next();
    if (first.fire) fired++;
    expect(q.size).toBeLessThanOrEqual(4);
    for (let s = 0; s < 10; s++) if (q.next().fire) fired++;
    // o toque do passo 2 ficou num comando descartado, mas o contador somou: dispara igual
    expect(fired).toBe(1);
    // (o primeiro comando só marca a referência: toque junto com ele não conta)
    const q2 = new InputQueue();
    const c = guestCmds(inputs);
    q2.push([c[0]]);
    q2.next();
    q2.push(c.slice(1, 12));
    let f2 = 0;
    for (let s = 0; s < 12; s++) if (q2.next().fire) f2++;
    expect(f2).toBe(1);
  });

  it('release solta os controles e descarta toques pendentes', () => {
    const q = new InputQueue();
    const c = guestCmds([inp({ throttle: 1 }), inp(), inp({ throttle: 1, fire: true }), inp({ fire: true }), inp(), inp({ fire: true })]);
    q.push(c.slice(0, 1));
    q.next();
    // dois toques chegam juntos: um pulso agora, o outro ficaria pendente
    q.push(c.slice(1));
    while (q.size) q.next();
    q.release();
    const i = q.next();
    expect(i.throttle).toBe(0);
    expect(i.fire).toBe(false);
    expect(q.next().fire).toBe(false);
  });

  it('valida a mensagem: números, faixas e no máximo 4 comandos', () => {
    expect(parseInputMsg(null)).toEqual([]);
    expect(parseInputMsg({ t: 'input', c: 'x' })).toEqual([]);
    const bad = parseInputMsg({
      c: [
        { n: 1, i: { throttle: 9, steer: NaN, fire: 'sim' }, b: [0, 0, 0] },
        { n: -1, i: {}, b: [0, 0, 0] },
        { n: 2, i: {}, b: [0, 0] },
        { n: 3, i: {}, b: [0, -1, 0] },
        { n: 1.5, i: {}, b: [0, 0, 0] },
      ],
    });
    expect(bad.length).toBe(1);
    expect(bad[0].i.throttle).toBe(1);
    expect(bad[0].i.steer).toBe(0);
    expect(bad[0].i.fire).toBe(false);
    const many = parseInputMsg({ c: Array.from({ length: 9 }, (_, k) => ({ n: k, i: {}, b: [0, 0, 0] })) });
    expect(many.length).toBe(CMDS_PER_MSG);
  });

  it('um pacote cheio cabe no limite de tamanho do host', () => {
    const cmds = guestCmds(Array.from({ length: 4 }, () => inp({ throttle: 0.123, brake: 0.456, steer: -0.789, sharp: true })));
    cmds.forEach((c) => (c.n = 123456789));
    expect(JSON.stringify({ t: 'input', c: cmds }).length).toBeLessThan(MAX_CLIENT_MSG);
  });

  it('no host, um toque curto do convidado dispara uma arma de verdade', () => {
    const track = new Track(TRACKS[0]);
    const entries = opponentsFor(newCampaign('jake', 0), VEHICLES).map((e, k) => (k === 1 ? { ...e, ai: null } : e));
    const w = createWorld(track, entries, 2, 5);
    w.started = true;
    const guest = 1;
    const before = w.racers[guest].frontCharges;
    const inputs = Array.from({ length: 30 }, (_, k) => inp({ throttle: 1, fire: k === 9 }));
    const q = new InputQueue();
    let fired = 0;
    for (const p of packets(guestCmds(inputs))) {
      q.push(p);
      for (let s = 0; s < 2; s++) {
        stepWorld(w, { [guest]: q.next() }, DT);
        fired += w.events.filter((e) => e.type === 'fire' && e.racer === guest).length;
      }
    }
    expect(fired).toBe(1);
    expect(w.racers[guest].frontCharges).toBe(before - 1);
  });
});

describe('colisão na previsão do convidado', () => {
  it('carContact empurra os carros para fora e troca velocidade', () => {
    const track = new Track(TRACKS[0]);
    const w = createWorld(track, opponentsFor(newCampaign('jake', 0), VEHICLES), 2, 1);
    const a = { ...w.racers[0].car, x: 0, z: 0, vx: 0, vz: 10, y: 0 };
    const b = { ...w.racers[1].car, x: 0, z: 1, vx: 0, vz: 0, y: 0 };
    const hit = carContact(a, 1, b, 1);
    expect(hit).toBeGreaterThan(0);
    expect(b.z - a.z).toBeGreaterThan(1);
    expect(a.vz).toBeLessThan(10);
    expect(b.vz).toBeGreaterThan(0);
    // longe: nada muda
    const c = { ...a, x: 50 };
    expect(carContact(c, 1, b, 1)).toBe(-1);
  });

  it('a regra das batidas não mudou: mesma corrida, mesmo resultado', () => {
    const track = new Track(TRACKS[0]);
    const run = () => {
      const w = createWorld(track, opponentsFor(newCampaign('jake', 0), VEHICLES), 2, 11);
      w.started = true;
      let bumps = 0;
      for (let i = 0; i < 60 * 15; i++) {
        stepWorld(w, {}, DT);
        bumps += w.events.filter((e) => e.type === 'bump').length;
      }
      return { bumps, pos: w.racers.map((r) => [r.car.x, r.car.z, r.armor]) };
    };
    expect(run()).toEqual(run());
  });
});
