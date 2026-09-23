import { describe, expect, it } from 'vitest';
import { trackById } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  advanceEarly, applyRaceResult, canAdvanceEarly, currentTrackId, decodeSave, encodeSave, newCampaign, opponentsFor, PLANETS, planetTracks, playerSpec, prizesFor,
} from './campaign';
import { buildSpec, carAttributes, chargePrice, maxExtraCharges, newCarSetup, tradeInValue, upgradeAvailable, upgradePrice } from './garage';
import { MAX_CHARGES } from './vehicle';

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
    expect(chargePrice(setup, 'front', VEHICLES.marauder)).toBeGreaterThan(0);
    expect(tradeInValue(setup)).toBeGreaterThan(0);
  });

  it('cargas vão até 7 por arma, como no original', () => {
    const setup = newCarSetup('havac');
    const extra = maxExtraCharges(VEHICLES.havac, 'rear');
    setup.charges.rear = extra;
    expect(buildSpec(VEHICLES.havac, setup).rearCharges).toBe(MAX_CHARGES);
    expect(chargePrice(setup, 'rear', VEHICLES.havac)).toBeNull();
  });

  it('esteiras e aerodeslizador não usam pneus; Havac também não usa amortecedores', () => {
    expect(upgradeAvailable('battletrak', 'tires')).toBe(false);
    expect(upgradeAvailable('havac', 'tires')).toBe(false);
    expect(upgradeAvailable('havac', 'shocks')).toBe(false);
    expect(upgradeAvailable('marauder', 'tires')).toBe(true);
    expect(upgradePrice(newCarSetup('havac'), 'tires')).toBeNull();
  });

  it('atributos diferenciam os carros (forças e fraquezas visíveis nas barras)', () => {
    const a = Object.fromEntries(Object.keys(VEHICLES).map((id) => [id, carAttributes(VEHICLES[id])]));
    for (const k of ['accel', 'speed', 'handling', 'armor', 'firepower'] as const) {
      const vals = Object.values(a).map((x) => x[k]);
      expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.18);
      for (const v of vals) expect(v).toBeGreaterThan(0);
    }
    expect(a.battletrak.armor).toBeGreaterThan(a.airblade.armor);
    expect(a.havac.speed).toBeGreaterThan(a.dirtdevil.speed);
    expect(a.dirtdevil.handling).toBeGreaterThan(a.havac.handling);
    // a marca de cada carro é o seu atributo mais forte
    const top = (id: string) => (Object.keys(a[id]) as (keyof (typeof a)[string])[]).reduce((x, y) => (a[id][y] > a[id][x] ? y : x));
    expect(top('battletrak')).toBe('armor');
    expect(top('havac')).toBe('speed');
    expect(top('dirtdevil')).toBe('handling');
    expect(a.marauder.handling).toBeLessThan(a.dirtdevil.handling); // Marauder é solto nas curvas
    // os caros não parecem piores que o carro inicial na soma das barras
    const sum = (id: string) => Object.values(a[id]).reduce((x, y) => x + y, 0);
    for (const id of ['airblade', 'battletrak', 'havac']) expect(sum(id)).toBeGreaterThanOrEqual(sum('dirtdevil') - 0.05);
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
    for (const p of PLANETS) {
      expect(planetTracks(p).length).toBeGreaterThan(0);
      for (const t of planetTracks(p)) expect(() => trackById(t)).not.toThrow();
    }
  });

  it('Rip e Shred correm em todos os planetas, com o piloto local', () => {
    const s = newCampaign('jake', 0);
    for (let i = 0; i < PLANETS.length; i++) {
      s.planet = i;
      const names = opponentsFor(s, VEHICLES).map((o) => o.name);
      expect(names).toEqual(['Rip', 'Shred', PLANETS[i].local]);
    }
  });

  it('pontos e prêmios do original; a divisão vai até o fim e então sobe', () => {
    const s = newCampaign('jake', 0);
    expect(prizesFor(s).slice(0, 3)).toEqual([10000, 7000, 4000]);
    const races = PLANETS[0].races;
    for (let i = 0; i < 3; i++) expect(applyRaceResult(s, 1, 10000, 0).pointsEarned).toBe(400);
    // 1200 pontos ainda não bastam (Chem VI pede 1600)
    expect(canAdvanceEarly(s)).toBe(false);
    applyRaceResult(s, 1, 10000, 0);
    expect(canAdvanceEarly(s)).toBe(true);
    let last = applyRaceResult(s, 2, 7000, 0);
    for (let i = 5; i < races; i++) last = applyRaceResult(s, 3, 4000, 0);
    expect(last.outcome).toBe('promoted');
    expect(s.division).toBe(1);
    expect(s.points).toBe(0);
    expect(s.stats.wins).toBe(4);
  });

  it('promoção antecipada quando já tem os pontos', () => {
    const s = newCampaign('jake', 0);
    for (let i = 0; i < 4; i++) applyRaceResult(s, 1, 0, 0);
    expect(advanceEarly(s)).toBe('promoted');
    expect(s.division).toBe(1);
    expect(s.race).toBe(0);
  });

  it('sem pontos suficientes a divisão recomeça', () => {
    const s = newCampaign('jake', 0);
    let last = applyRaceResult(s, 4, 0, 0);
    for (let i = 1; i < PLANETS[0].races; i++) last = applyRaceResult(s, 4, 0, 0);
    expect(last.outcome).toBe('retry');
    expect(s.race).toBe(0);
    expect(s.division).toBe(0);
  });

  it('percorre os 6 planetas até o título', () => {
    const s = newCampaign('jake', 0);
    let outcome = '';
    let guard = 0;
    while (!s.champion && guard++ < 400) {
      const r = applyRaceResult(s, 1, 0, 0);
      outcome = r.outcome;
      if (s.points === 0 && r.outcome === 'promoted') expect(prizesFor(s)[0]).toBeGreaterThan(0);
    }
    expect(outcome).toBe('champion');
    expect(s.planet).toBe(PLANETS.length - 1);
    expect(PLANETS.every((p) => p.promote > 0)).toBe(true);
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
