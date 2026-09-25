import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { newCampaign, opponentsFor } from '../sim/campaign';
import { Track } from '../sim/track';
import { createWorld, stepWorld } from '../sim/world';
import { applyProg, applySnapshot, cleanName, decodeSnapMsg, encodeSnapMsg, parseHello, parseLobbyPlayers, parseProg, parseStart, pickColor, progEntry, sanitizeInput, takeSnapshot, validateSnap, type SnapMsg } from './sync';

const DT = 1 / 60;

describe('sincronização online', () => {
  it('o convidado fica igual ao host depois de aplicar o estado', () => {
    const track = new Track(TRACKS[0]);
    const entries = opponentsFor(newCampaign('jake', 0), VEHICLES);
    const host = createWorld(track, entries, 2, 9);
    const guest = createWorld(track, entries.map((e) => ({ ...e })), 2, 9);
    host.started = true;
    for (let i = 0; i < 60 * 20; i++) stepWorld(host, {}, DT);
    // passa por JSON como na rede
    applySnapshot(guest, JSON.parse(JSON.stringify(takeSnapshot(host, host.events))));
    host.racers.forEach((r, i) => {
      const g = guest.racers[i];
      expect(g.car.x).toBeCloseTo(r.car.x, 2);
      expect(g.car.z).toBeCloseTo(r.car.z, 2);
      expect(g.progress.lap).toBe(r.progress.lap);
      expect(g.place).toBe(r.place);
      expect(g.armor).toBeCloseTo(r.armor, 2);
    });
    expect(guest.projectiles.length).toBe(host.projectiles.length);
    expect(guest.hazards.length).toBe(host.hazards.length);
    expect(guest.pickups.map((p) => p.active)).toEqual(host.pickups.map((p) => p.active));
    expect(guest.started).toBe(true);
  });

  it('o estado binário de uma corrida de 4 carros cabe em menos de 1200 bytes', () => {
    const track = new Track(TRACKS[0]);
    const w = createWorld(track, opponentsFor(newCampaign('jake', 0), VEHICLES), 2, 3);
    w.started = true;
    let worst = 0;
    for (let i = 0; i < 60 * 30; i++) {
      stepWorld(w, {}, DT);
      if (i % 3 === 0) {
        const msg: SnapMsg = { t: 'snap', s: takeSnapshot(w, w.events), k: i, a: [1, 2, 3, 4], cd: 0, pe: w.events };
        worst = Math.max(worst, encodeSnapMsg(msg).byteLength);
      }
    }
    expect(worst).toBeLessThan(1200);
  });

  it('estado binário: o convidado fica igual ao host (quantizado) e o progresso vem à parte', () => {
    const track = new Track(TRACKS[0]);
    const entries = opponentsFor(newCampaign('jake', 0), VEHICLES);
    const host = createWorld(track, entries, 2, 9);
    const guest = createWorld(track, entries.map((e) => ({ ...e })), 2, 9);
    host.started = true;
    for (let i = 0; i < 60 * 40; i++) stepWorld(host, {}, DT);
    const ev = [{ type: 'lap' as const, racer: 1, lap: 2 }];
    const buf = encodeSnapMsg({ t: 'snap', s: takeSnapshot(host, host.events), k: 7, a: [3, -1, 5, 9].slice(0, host.racers.length), cd: 0, aw: [2], dc: [0], ie: [{ i: 4, e: ev[0] }] });
    const m = decodeSnapMsg(buf, host.racers.length, track.pieces.length)!;
    expect(m.k).toBe(7);
    expect(m.a).toEqual([3, -1, 5, 9].slice(0, host.racers.length));
    expect(m.aw).toEqual([2]);
    expect(m.dc).toEqual([0]);
    expect(m.ie).toEqual([{ i: 4, e: ev[0] }]);
    applySnapshot(guest, m.s);
    const prog = parseProg(JSON.parse(JSON.stringify({ t: 'prog', k: 7, r: host.racers.map((r, i) => progEntry(i, r)) })), host.racers.length)!;
    applyProg(guest, prog);
    host.racers.forEach((r, i) => {
      const g = guest.racers[i];
      expect(g.car.x).toBeCloseTo(r.car.x, 2);
      expect(g.car.z).toBeCloseTo(r.car.z, 2);
      expect(g.car.heading).toBeCloseTo(r.car.heading, 3);
      expect(g.car.vx).toBeCloseTo(r.car.vx, 2);
      expect(g.progress.lap).toBe(r.progress.lap);
      expect(g.progress.lastDist).toBeCloseTo(r.progress.lastDist, 1);
      expect(g.money).toBe(r.money);
      expect(g.place).toBe(r.place);
      expect(g.armor).toBeCloseTo(r.armor, 2);
    });
    expect(guest.projectiles.length).toBe(host.projectiles.length);
    expect(guest.hazards.length).toBe(host.hazards.length);
    expect(guest.pickups.map((p) => p.active)).toEqual(host.pickups.map((p) => p.active));
  });

  it('estado binário inválido é recusado inteiro', () => {
    const track = new Track(TRACKS[0]);
    const w = createWorld(track, opponentsFor(newCampaign('jake', 0), VEHICLES), 2, 3);
    w.started = true;
    for (let i = 0; i < 60 * 5; i++) stepWorld(w, {}, DT);
    const n = w.racers.length;
    const np = track.pieces.length;
    const buf = encodeSnapMsg({ t: 'snap', s: takeSnapshot(w, [{ type: 'spin', racer: 1 }]), k: 1, a: [], cd: 0 });
    expect(decodeSnapMsg(buf, n, np)).not.toBeNull();
    expect(decodeSnapMsg(buf.slice(0, buf.byteLength - 3), n, np)).toBeNull(); // cortado
    const extra = new Uint8Array(buf.byteLength + 1);
    extra.set(new Uint8Array(buf));
    expect(decodeSnapMsg(extra.buffer, n, np)).toBeNull(); // sobra
    expect(decodeSnapMsg(buf, n - 1, np)).toBeNull(); // outro número de carros
    expect(decodeSnapMsg(buf, n, 1)).toBeNull(); // peça fora da pista
    expect(decodeSnapMsg('lixo', n, np)).toBeNull();
    expect(decodeSnapMsg(new ArrayBuffer(0), n, np)).toBeNull();
    const nan = new DataView(buf.slice(0));
    nan.setFloat32(1 + 4 + 4 + 4 + 3, NaN, true); // x do primeiro carro
    expect(decodeSnapMsg(nan.buffer, n, np)).toBeNull();
    // evento com carro inexistente é descartado (o resto vale)
    const bad = encodeSnapMsg({ t: 'snap', s: takeSnapshot(w, [{ type: 'spin', racer: 99 }]), k: 1, a: [], cd: 0 });
    expect(decodeSnapMsg(bad, n, np)?.s.events).toEqual([]);
    // progresso: forma conferida
    expect(parseProg({ t: 'prog', k: 1, r: [{ i: 9, progress: {} }] }, n)).toBeNull();
    expect(parseProg({ t: 'prog', k: 1, r: [{ i: 0, progress: { lap: 1, lapTimes: ['x'] } }] }, n)).toBeNull();
    expect(parseProg({ t: 'prog', k: 1, r: [{ i: 0, progress: { lap: 2, lapTimes: [30.5] }, money: 'x', kills: 2 }] }, n)?.r[0].money).toBe(0);
  });
});

const PALETTE = [0x2f7bff, 0xe02828, 0x2fc840, 0xf2c318, 0xb040e0, 0xf0f0f0];
const IDS = ['marauder', ...Object.keys(VEHICLES).filter((k) => k !== 'marauder')];

describe('validação do que chega pela rede', () => {
  it('cor do convidado só da paleta (bloqueia injeção de HTML pela cor)', () => {
    const used = new Set([PALETTE[0]]);
    expect(pickColor('red" onerror="alert(1)', used, PALETTE)).toBe(PALETTE[1]);
    expect(pickColor(0x123456, used, PALETTE)).toBe(PALETTE[1]);
    expect(pickColor(PALETTE[0], used, PALETTE)).toBe(PALETTE[1]);
    expect(pickColor(PALETTE[3], used, PALETTE)).toBe(PALETTE[3]);
    expect(pickColor(PALETTE[2] + 0.5, used, PALETTE)).toBe(PALETTE[1]);
  });

  it('nome sem HTML, curto e com padrão', () => {
    expect(cleanName('<img src=x onerror=alert(1)>')).not.toMatch(/[<>"'&]/);
    expect(cleanName('a'.repeat(50)).length).toBeLessThanOrEqual(12);
    expect(cleanName(42)).toBe('Piloto');
    expect(cleanName('   ')).toBe('Piloto');
    expect(cleanName('Zé Ninguém')).toBe('Zé Ninguém');
  });

  it('hello inválido é recusado; carro desconhecido vira o padrão', () => {
    expect(parseHello(null, IDS)).toBeNull();
    expect(parseHello({ t: 'input' }, IDS)).toBeNull();
    const h = parseHello({ t: 'hello', name: '<b>x</b>', color: 'x', vehicleId: '../../etc' }, IDS)!;
    expect(h.vehicleId).toBe('marauder');
    expect(h.name).not.toMatch(/[<>]/);
  });

  it('comando do convidado é limitado às faixas e booleanos estritos', () => {
    const i = sanitizeInput({ throttle: 5, brake: -3, steer: NaN, fire: 'true', drop: 1, nitro: true, sharp: {} });
    expect(i).toEqual({ throttle: 1, brake: 0, steer: 0, fire: false, drop: false, nitro: true, sharp: false });
    expect(sanitizeInput({ steer: -9, throttle: Infinity }).steer).toBe(-1);
    expect(sanitizeInput({ throttle: Infinity }).throttle).toBe(0);
    expect(sanitizeInput('lixo')).toEqual({ throttle: 0, brake: 0, steer: 0, fire: false, drop: false, nitro: false });
  });

  it('lista de pilotos do host é conferida', () => {
    expect(parseLobbyPlayers('x', PALETTE, IDS)).toBeNull();
    expect(parseLobbyPlayers(new Array(9).fill({ id: 'a' }), PALETTE, IDS)).toBeNull();
    const [p] = parseLobbyPlayers([{ id: 'host', name: '"><script>', color: '#fff;background:url(x)', vehicleId: 'x' }], PALETTE, IDS)!;
    expect(p.color).toBe(PALETTE[0]);
    expect(p.name).not.toMatch(/[<>"]/);
    expect(p.vehicleId).toBe('marauder');
  });

  it('largada do host: pista, voltas, grid e índice conferidos', () => {
    const entries = opponentsFor(newCampaign('jake', 0), VEHICLES);
    const trackIds = TRACKS.map((t) => t.id);
    const ok = JSON.parse(JSON.stringify({ t: 'start', race: { trackId: TRACKS[0].id, laps: 3, seed: 7, entries }, you: 1 }));
    const parsed = parseStart(ok, IDS, trackIds)!;
    expect(parsed.you).toBe(1);
    expect(parsed.race.entries.length).toBe(entries.length);
    expect(parsed.race.entries[0].spec.maxSpeed).toBe(entries[0].spec.maxSpeed);
    expect(parseStart({ ...ok, you: 99 }, IDS, trackIds)).toBeNull();
    expect(parseStart({ ...ok, race: { ...ok.race, trackId: 'nada' } }, IDS, trackIds)).toBeNull();
    expect(parseStart({ ...ok, race: { ...ok.race, laps: 1e9 } }, IDS, trackIds)).toBeNull();
    const bad = JSON.parse(JSON.stringify(ok));
    bad.race.entries[0].spec.maxSpeed = 'rápido';
    expect(parseStart(bad, IDS, trackIds)).toBeNull();
  });

  it('estado do host: forma conferida, eventos com índices inválidos descartados', () => {
    const track = new Track(TRACKS[0]);
    const entries = opponentsFor(newCampaign('jake', 0), VEHICLES);
    const w = createWorld(track, entries, 2, 5);
    w.started = true;
    for (let i = 0; i < 60 * 5; i++) stepWorld(w, {}, DT);
    const s = JSON.parse(JSON.stringify(takeSnapshot(w, [{ type: 'spin', racer: 0 }])));
    const n = w.racers.length;
    const np = track.pieces.length;
    expect(validateSnap(s, n, np)).not.toBeNull();
    expect(validateSnap({ ...s, racers: s.racers.slice(1) }, n, np)).toBeNull();
    const nan = JSON.parse(JSON.stringify(s));
    nan.racers[0].car.x = 'NaN';
    expect(validateSnap(nan, n, np)).toBeNull();
    const far = JSON.parse(JSON.stringify(s));
    far.racers[0].car.pieceIndex = np + 5;
    expect(validateSnap(far, n, np)).toBeNull();
    const ev = validateSnap({ ...s, events: [{ type: 'spin', racer: 99 }, { type: 'xss', racer: 0 }, { type: 'spin', racer: 1 }] }, n, np)!;
    expect(ev.events).toEqual([{ type: 'spin', racer: 1 }]);
  });
});
