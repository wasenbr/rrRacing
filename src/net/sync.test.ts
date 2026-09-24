import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { newCampaign, opponentsFor } from '../sim/campaign';
import { Track } from '../sim/track';
import { createWorld, stepWorld } from '../sim/world';
import { applySnapshot, cleanName, parseHello, parseLobbyPlayers, parseStart, pickColor, sanitizeInput, takeSnapshot, validateSnap } from './sync';

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

  it('o estado de uma corrida de 4 carros cabe num pacote pequeno', () => {
    const track = new Track(TRACKS[0]);
    const w = createWorld(track, opponentsFor(newCampaign('jake', 0), VEHICLES), 2, 3);
    w.started = true;
    for (let i = 0; i < 60 * 10; i++) stepWorld(w, {}, DT);
    expect(JSON.stringify(takeSnapshot(w, [])).length).toBeLessThan(8000);
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
