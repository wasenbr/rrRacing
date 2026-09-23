import { describe, expect, it } from 'vitest';
import { trackById } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  applyRaceResult, currentTrackId, decodeSave, encodeSave, newCampaign, opponentsFor, PLANETS, playerSpec, prizesFor, PROMOTE_POINTS, RACES_PER_SEASON,
} from './campaign';
import { buildSpec, chargePrice, newCarSetup, tradeInValue, upgradePrice } from './garage';

describe('garagem', () => {
  it('melhorias deixam o carro melhor e ficam mais caras', () => {
    const setup = newCarSetup('marauder');
    const base = buildSpec(VEHICLES.marauder, setup);
    const p1 = upgradePrice(setup, 'engine')!;
    setup.upgrades.engine = 1;
    setup.upgrades.armor = 2;
    setup.charges.front = 1;
    const better = buildSpec(VEHICLES.marauder, setup);
    expect(better.maxSpeed).toBeGreaterThan(base.maxSpeed);
    expect(better.armor).toBeGreaterThan(base.armor);
    expect(better.frontCharges).toBe(base.frontCharges + 1);
    expect(upgradePrice(setup, 'engine')!).toBeGreaterThan(p1);
    setup.upgrades.engine = 3;
    expect(upgradePrice(setup, 'engine')).toBeNull();
    expect(chargePrice(setup, 'front')).toBeGreaterThan(0);
    expect(tradeInValue(setup)).toBeGreaterThan(0);
  });
});

describe('campanha', () => {
  it('começa em Chem VI, Divisão B, com o Dirt Devil', () => {
    const s = newCampaign('jake', 0x2f7bff);
    expect(PLANETS[s.planet].name).toBe('Chem VI');
    expect(s.division).toBe(0);
    expect(s.car.vehicleId).toBe('dirtdevil');
    expect(() => trackById(currentTrackId(s))).not.toThrow();
    expect(opponentsFor(s, VEHICLES)).toHaveLength(3);
    expect(playerSpec(s, VEHICLES).maxSpeed).toBeGreaterThan(0);
  });

  it('todas as pistas dos planetas existem', () => {
    for (const p of PLANETS) for (const t of p.tracks) expect(() => trackById(t)).not.toThrow();
  });

  it('vencer 3 corridas promove para a Divisão A', () => {
    const s = newCampaign('jake', 0);
    expect(applyRaceResult(s, 1, 20000, 0).outcome).toBe('continue');
    expect(applyRaceResult(s, 1, 20000, 0).outcome).toBe('continue');
    const r = applyRaceResult(s, 1, 20000, 2);
    expect(r.outcome).toBe('promoted');
    expect(s.division).toBe(1);
    expect(s.points).toBe(0);
    expect(s.stats.wins).toBe(3);
  });

  it('sem pontos suficientes a temporada recomeça', () => {
    const s = newCampaign('jake', 0);
    let last = applyRaceResult(s, 4, 0, 0);
    for (let i = 1; i < RACES_PER_SEASON; i++) last = applyRaceResult(s, 4, 0, 0);
    expect(last.outcome).toBe('retry');
    expect(s.race).toBe(0);
    expect(s.division).toBe(0);
  });

  it('percorre os 6 planetas até o título', () => {
    const s = newCampaign('jake', 0);
    let outcome = '';
    let guard = 0;
    while (!s.champion && guard++ < 100) {
      const r = applyRaceResult(s, 1, 0, 0);
      outcome = r.outcome;
      if (s.points === 0 && r.outcome === 'promoted') expect(prizesFor(s)[0]).toBeGreaterThan(0);
    }
    expect(outcome).toBe('champion');
    expect(s.planet).toBe(PLANETS.length - 1);
    expect(PROMOTE_POINTS).toBeGreaterThan(0);
  });

  it('senha salva e restaura a campanha; senha adulterada é rejeitada', () => {
    const s = newCampaign('katarina', 0xe02828);
    s.money = 123456;
    s.car.upgrades.tires = 2;
    const code = encodeSave(s);
    expect(decodeSave(code)).toEqual(s);
    expect(decodeSave(code.replace(/.$/, (c) => (c === '1' ? '2' : '1')))).toBeNull();
    expect(decodeSave('lixo')).toBeNull();
  });
});
