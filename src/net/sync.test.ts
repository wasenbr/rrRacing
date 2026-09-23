import { describe, expect, it } from 'vitest';
import { TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import { newCampaign, opponentsFor } from '../sim/campaign';
import { Track } from '../sim/track';
import { createWorld, stepWorld } from '../sim/world';
import { applySnapshot, takeSnapshot } from './sync';

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
