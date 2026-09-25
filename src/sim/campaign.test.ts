import { describe, expect, it } from 'vitest';
import { trackById, TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  advanceEarly, applyRaceResult, bossBonus, bossOf, campaignChargePrice, CAMPAIGN_RULES, CHARGE_ROOM, chargeScale, canAdvanceEarly, carComingSoon, carsForSale, CHAMPION_BONUS, currentPlanet, currentTrackId, decodeSave, encodeSave,
  forfeitCosts, forfeitRace, HOARD_CAP, HOARD_MONEY, hoardFactor, BOSS_BONUS, buyPaint, CAMPAIGN_PRIZES, CHAMPION_PAINT, paintPrice, prizeScale, racesIn, markRaceStarted, moneyScale, resolveAbandonedRace, shopHeadroom, newCampaign, opponentsFor, PLANET_MONEY, planetCount, planetForLevel, PLANETS, planetTracks, playerSpec, POINTS, prizesFor, raceKind, RIVAL_LEVEL,
  coopOwner, coopView, rivalAggression, rivalEngine, rivalExtraCharges, rivalLevel, rivalPace, RIVALS, seasonInfo, seasonSchedule, shopLevel, START_MONEY, tier, type CampaignState,
} from './campaign';
import {
  attributeTags, buildSpec, CAR_PRICES, carAttributes, carSwapCost, CHARGE_KINDS, chargePrice, maxedSetup, maxExtraCharges, newCarSetup, tradeInFor, tradeInValue, UPGRADE_KINDS, upgradeAvailable, upgradeLabel, upgradeName,
  upgradePrice, upgradesSpent,
} from './garage';
import { Track } from './track';
import { emptyInput } from './input';
import { createVehicleState, forwardSpeed, MAX_CHARGES, stepVehicle, type VehicleSpec } from './vehicle';

/** Chão plano e sem fim (mesmo do teste de veículo): só a física do carro. */
const FLAT = {
  halfWidth: 1000, surface: 'asphalt', pieces: [{ code: 'S', length: 1e9 }], heightOn: () => 0,
  query: () => ({ height: 0, lateral: 0, heading: 0, pieceIndex: 0, void: false, warp: 0, dist: 0, s: 0 }),
} as unknown as Track;
import { createWorld, PRIZES, referenceInput, stepWorld, type Difficulty } from './world';

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

  it('esteiras e aerodeslizador não usam pneus; o Havac tem Estabilizadores no lugar dos amortecedores', () => {
    expect(upgradeAvailable('battletrak', 'tires')).toBe(false);
    expect(upgradeAvailable('havac', 'tires')).toBe(false);
    expect(upgradeAvailable('marauder', 'tires')).toBe(true);
    expect(upgradePrice(newCarSetup('havac'), 'tires')).toBeNull();
    expect(upgradeLabel('havac', 'shocks')).toBe('Estabilizadores');
    expect(upgradeLabel('marauder', 'shocks')).toBe('Amortecedores');
    expect(upgradeName('havac', 'shocks', 3)).not.toBe(upgradeName('marauder', 'shocks', 3));
    // estabilizadores seguram o casco: mais aderência e giro, pouso melhor
    const h0 = buildSpec(VEHICLES.havac, newCarSetup('havac'));
    const st = newCarSetup('havac');
    st.upgrades.shocks = 3;
    const h3 = buildSpec(VEHICLES.havac, st);
    expect(h3.grip).toBeGreaterThan(h0.grip);
    expect(h3.steerRate).toBeGreaterThan(h0.steerRate);
    expect(h3.landingLoss!).toBeLessThan(h0.landingLoss!);
    // pneus que o carro não aceita (setup de rival) não contam
    st.upgrades.tires = 3;
    expect(buildSpec(VEHICLES.havac, st).grip).toBe(h3.grip);
  });

  it('revenda: 30 % do carro + 1/4 das peças, no máximo 80 % do carro novo (nunca sai de graça)', () => {
    const s = newCarSetup('battletrak');
    expect(tradeInValue(s)).toBe(33000);
    s.upgrades.engine = 2;
    expect(tradeInValue(s)).toBe(33000 + (40000 + 70000) / 4);
    expect(carSwapCost(s, 'havac')).toBe(130000 - tradeInValue(s));
    // Battle Trak no máximo: a revenda passa do preço do Havac, mas a troca paga só 80 % dele
    s.upgrades = { engine: 3, tires: 0, shocks: 3, armor: 3 };
    expect(tradeInValue(s)).toBeGreaterThan(130000);
    expect(tradeInFor(s, 'havac')).toBe(104000);
    expect(carSwapCost(s, 'havac')).toBe(26000);
    // nenhuma troca para carro melhor sai de graça, em qualquer preparação
    const order = Object.keys(CAR_PRICES);
    for (let i = 0; i < order.length - 1; i++)
      for (let j = i + 1; j < order.length; j++) expect(carSwapCost(maxedSetup(order[i]), order[j])).toBeGreaterThanOrEqual(CAR_PRICES[order[j]].price * 0.2 - 500);
  });

  it('atributos mostram a personalidade de cada carro sem exagerar diferenças pequenas', () => {
    const a = Object.fromEntries(Object.keys(VEHICLES).map((id) => [id, carAttributes(VEHICLES[id])]));
    for (const k of ['accel', 'speed', 'handling', 'armor', 'firepower'] as const) {
      const vals = Object.values(a).map((x) => x[k]);
      for (const v of vals) expect(v).toBeGreaterThan(0);
    }
    // onde os carros diferem muito, a barra mostra (forças e fraquezas visíveis)
    for (const k of ['accel', 'handling', 'firepower'] as const) {
      const vals = Object.values(a).map((x) => x[k]);
      expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.18);
    }
    // escala absoluta: a diferença de barra é proporcional à diferença real (sem esticar 3 % em meia barra)
    const ids = Object.keys(VEHICLES);
    for (const x of ids) for (const y of ids) {
      const dv = Math.abs(VEHICLES[x].maxSpeed - VEHICLES[y].maxSpeed) / VEHICLES[y].maxSpeed;
      expect(Math.abs(a[x].speed - a[y].speed)).toBeLessThanOrEqual(dv * 3 + 1e-9);
      const da = Math.abs(VEHICLES[x].armor - VEHICLES[y].armor) / VEHICLES[y].armor;
      expect(Math.abs(a[x].armor - a[y].armor)).toBeLessThanOrEqual(da * 1.5 + 1e-9);
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
    // os caros não parecem piores que o carro inicial na soma dos segmentos (tolerância de 2 de 50 segmentos)
    const segs = (id: string) => Object.values(a[id]).reduce((x, y) => x + Math.round(y * 10), 0);
    for (const id of ['airblade', 'battletrak', 'havac']) expect(segs(id)).toBeGreaterThanOrEqual(segs('dirtdevil') - 2);
  });

  it('forte/fraco só quando o carro se destaca de fato', () => {
    const t = Object.fromEntries(Object.keys(VEHICLES).map((id) => [id, attributeTags(VEHICLES[id])]));
    expect(t.dirtdevil.handling).toBe('good');
    expect(t.airblade.accel).toBe('good');
    // o Havac é o mais rápido; mísseis + Scatter não são poder de fogo fraco; o Marauder arranca na média
    expect(t.havac.speed).toBe('good');
    expect(t.battletrak.firepower).toBeUndefined();
    expect(t.marauder.accel).toBeUndefined();
    // a barra manda: nunca "fraco" no atributo de barra mais cheia, nem "forte" com barra abaixo do meio
    for (const id of Object.keys(t)) {
      const bar = carAttributes(VEHICLES[id]);
      for (const [k, tag] of Object.entries(t[id]) as [keyof typeof bar, string][]) {
        if (tag === 'bad') expect(bar[k]).toBeLessThan(Math.max(...Object.values(bar)));
        if (tag === 'good') expect(bar[k]).toBeGreaterThanOrEqual(0.5);
      }
    }
    // só marca quem se afasta de verdade da média dos outros carros
    const others = (id: string, f: (v: (typeof VEHICLES)[string]) => number) => {
      const o = Object.values(VEHICLES).filter((v) => v.id !== id).map(f);
      return o.reduce((x, y) => x + y, 0) / o.length;
    };
    for (const id of Object.keys(t)) {
      const sp = VEHICLES[id].maxSpeed / others(id, (v) => v.maxSpeed) - 1;
      if (t[id].speed) expect(Math.abs(sp)).toBeGreaterThanOrEqual(0.04);
      const ar = VEHICLES[id].armor / others(id, (v) => v.armor) - 1;
      if (t[id].armor) expect(Math.abs(ar)).toBeGreaterThanOrEqual(0.07);
    }
    for (const id of Object.keys(t)) {
      const v = Object.values(t[id]);
      expect(v.filter((x) => x === 'good').length).toBeLessThanOrEqual(1);
      expect(v.filter((x) => x === 'bad').length).toBeLessThanOrEqual(1);
    }
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

  it('pontos do original; prêmios crescem com o planeta; a divisão vai até o fim e então sobe', () => {
    const s = newCampaign('jake', 0);
    // Chem VI no Normal: 70 % dos prêmios do original
    expect(prizesFor(s).slice(0, 3)).toEqual([7000, 5000, 3000]);
    s.planet = 5;
    s.difficulty = 'hard';
    expect(prizesFor(s)[0]).toBe(13500); // Inferno no Difícil: ×2,1 × 0,65
    // o último planeta nunca paga menos que o anterior (a sobra é segurada pelo teto da loja)
    for (let i = 1; i < PLANET_MONEY.length; i++) expect(PLANET_MONEY[i]).toBeGreaterThanOrEqual(PLANET_MONEY[i - 1]);
    s.planet = 0;
    s.difficulty = 'normal';
    const { races, promote } = seasonInfo(s);
    expect([races, promote]).toEqual([6, 1200]);
    for (let i = 0; i < 2; i++) expect(applyRaceResult(s, 1, 7000, 0).pointsEarned).toBe(400);
    expect(canAdvanceEarly(s)).toBe(false);
    applyRaceResult(s, 1, 7000, 0);
    expect(canAdvanceEarly(s)).toBe(true);
    let last = applyRaceResult(s, 2, 5000, 0);
    for (let i = 4; i < races; i++) last = applyRaceResult(s, 3, 3000, 0);
    expect(last.outcome).toBe('promoted');
    expect(s.division).toBe(1);
    expect(s.points).toBe(0);
    expect(s.stats.wins).toBe(3);
  });

  it('a dificuldade decide o tamanho da campanha, a meta e o dinheiro', () => {
    const at = (d: Difficulty) => newCampaign('jake', 0, d);
    expect([planetCount(at('easy')), planetCount(at('normal')), planetCount(at('hard'))]).toEqual([3, 5, 6]);
    // meta cresce com a dificuldade (fração dos pontos possíveis)
    const goal = (d: Difficulty) => seasonInfo(at(d)).promote / (seasonInfo(at(d)).races * POINTS[0]);
    expect(goal('easy')).toBeLessThan(goal('normal'));
    expect(goal('normal')).toBeLessThan(goal('hard'));
    expect(moneyScale(at('easy'))).toBeGreaterThan(moneyScale(at('normal')));
    expect(moneyScale(at('hard'))).toBeLessThan(moneyScale(at('normal')));
    // o dinheiro rende mais a cada planeta até Nho (o Havac); no Inferno, com a mesma loja, não sobe mais
    for (let p = 1; p < PLANETS.length - 1; p++) expect(PLANET_MONEY[p]).toBeGreaterThan(PLANET_MONEY[p - 1]);
    expect(PLANET_MONEY[PLANETS.length - 1]).toBeLessThanOrEqual(PLANET_MONEY[PLANETS.length - 2]);
    // campanha inteira: Fácil curto, Difícil longo
    const total = (d: Difficulty) => CAMPAIGN_RULES[d].races.reduce((a, r) => a + 2 * r, 0);
    expect(total('easy')).toBeLessThan(40);
    expect(total('normal')).toBeLessThan(80);
    expect(total('hard')).toBeGreaterThan(total('normal'));
  });

  it('promoção antecipada: na Divisão B sobe; na Divisão A leva ao duelo do chefe', () => {
    const s = newCampaign('jake', 0);
    for (let i = 0; i < 3; i++) applyRaceResult(s, 1, 0, 0);
    expect(advanceEarly(s)).toBe('promoted');
    expect(s.division).toBe(1);
    expect(s.race).toBe(0);
    for (let i = 0; i < 3; i++) applyRaceResult(s, 1, 0, 0);
    expect(advanceEarly(s)).toBe('continue');
    expect(raceKind(s)).toBe('boss');
    expect(canAdvanceEarly(s)).toBe(false);
    expect(applyRaceResult(s, 1, 0, 0).outcome).toBe('promoted');
    expect(s.planet).toBe(1);
  });

  it('duelo do chefe: só o piloto local, turbinado, na última pista do planeta', () => {
    const s = newCampaign('jake', 0);
    s.division = 1;
    const normal = opponentsFor(s, VEHICLES);
    s.race = seasonInfo(s).races - 1;
    expect(raceKind(s)).toBe('boss');
    const boss = opponentsFor(s, VEHICLES);
    expect(boss).toHaveLength(1);
    expect(boss[0].name).toBe(PLANETS[0].local);
    expect(boss[0].ai.skill).toBeGreaterThan(normal[2].ai.skill);
    expect(boss[0].spec.maxSpeed).toBeGreaterThanOrEqual(normal[2].spec.maxSpeed);
    expect(boss[0].spec.frontCharges).toBeGreaterThan(normal[2].spec.frontCharges);
    const ids = planetTracks(PLANETS[0]);
    expect(currentTrackId(s)).toBe(ids[ids.length - 1]);
    expect(seasonSchedule(s).at(-1)!.boss).toBe(true);
    expect(prizesFor(s)).toHaveLength(2);
  });

  it('vencer o chefe dá bônus; perder o duelo com os pontos leva à repescagem', () => {
    const s = newCampaign('jake', 0);
    s.division = 1;
    for (let i = 0; i < seasonInfo(s).races - 1; i++) applyRaceResult(s, 1, 0, 0);
    const lost = applyRaceResult(s, 2, 0, 0);
    expect(lost.outcome).toBe('playoff');
    expect(lost.pointsEarned).toBe(0);
    expect(raceKind(s)).toBe('playoff');
    const money = s.money;
    const won = applyRaceResult(s, 1, 0, 0);
    expect(won.outcome).toBe('promoted');
    expect(won.bonus).toBe(bossBonus({ ...s, planet: 0 }));
    expect(s.money).toBe(money + won.bonus);
    expect([s.planet, s.division, s.race, s.playoff]).toEqual([1, 0, 0, undefined]);
  });

  it('sem pontos: repescagem contra o piloto local; perdendo todas, a divisão recomeça', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const s = newCampaign('jake', 0, d);
      let last = applyRaceResult(s, 4, 0, 0);
      for (let i = 1; i < seasonInfo(s).races; i++) last = applyRaceResult(s, 4, 0, 0);
      expect(last.outcome).toBe('playoff');
      expect(opponentsFor(s, VEHICLES).map((o) => o.name)).toEqual([PLANETS[0].local]);
      for (let t = 1; t < CAMPAIGN_RULES[d].playoffTries; t++) expect(applyRaceResult(s, 2, 0, 0).outcome).toBe('playoff');
      expect(applyRaceResult(s, 2, 0, 0).outcome).toBe('retry');
      expect([s.race, s.points, s.division, s.playoff]).toEqual([0, 0, 0, undefined]);
    }
    // vencer a repescagem sobe mesmo sem os pontos
    const s = newCampaign('jake', 0);
    for (let i = 0; i < seasonInfo(s).races; i++) applyRaceResult(s, 4, 0, 0);
    expect(applyRaceResult(s, 1, 0, 0).outcome).toBe('promoted');
    expect(s.division).toBe(1);
  });

  it('percorre os planetas de cada dificuldade até o título', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const s = newCampaign('jake', 0, d);
      let outcome = '';
      let guard = 0;
      let bonuses = 0;
      while (!s.champion && guard++ < 400) {
        const r = applyRaceResult(s, 1, 0, 0);
        outcome = r.outcome;
        bonuses += r.bonus;
      }
      expect(outcome).toBe('champion');
      expect(s.planet).toBe(CAMPAIGN_RULES[d].planets - 1);
      // um chefe por planeta
      expect(bonuses).toBeGreaterThan(0);
      expect(s.money).toBe(START_MONEY + CHAMPION_BONUS + bonuses);
      // depois do título as temporadas são de exibição (sem chefe, sem novo título)
      const money = s.money;
      for (let i = 0; i < seasonInfo(s).races; i++) outcome = applyRaceResult(s, 1, 0, 0).outcome;
      expect(outcome).toBe('continue');
      expect(s.money).toBe(money);
      expect(canAdvanceEarly(s)).toBe(false);
      expect(opponentsFor(s, VEHICLES)).toHaveLength(3);
    }
  });

  it('calendário da divisão marca as corridas feitas e a próxima', () => {
    const s = newCampaign('jake', 0);
    applyRaceResult(s, 2, 0, 0);
    const cal = seasonSchedule(s);
    expect(cal).toHaveLength(seasonInfo(s).races);
    expect(cal[0].done).toBe(true);
    expect(cal[1].current).toBe(true);
    expect(cal[1].trackId).toBe(currentTrackId(s));
    expect(cal.some((r) => r.boss)).toBe(false);
  });

  it('loja: carros e peças chegam junto com o nível dos rivais', () => {
    const s = newCampaign('jake', 0);
    expect(carsForSale(s)).not.toContain('airblade');
    expect(shopLevel(s)).toBe(1);
    s.planet = 1;
    expect(carsForSale(s)).toContain('airblade');
    expect(shopLevel(s)).toBe(2);
    s.planet = 2;
    expect(carsForSale(s)).toContain('battletrak');
    expect(shopLevel(s)).toBe(3);
    s.planet = 4;
    expect(carsForSale(s)).toContain('havac');
    expect(planetForLevel(3)!.id).toBe('bogmire');
  });

  it('save de antes das regras por dificuldade é encaixado na campanha', () => {
    const s = newCampaign('jake', 0, 'normal');
    s.planet = 5; // Inferno não faz parte do Normal
    s.race = 12;
    const fit = decodeSave(encodeSave(s))!;
    expect([fit.planet, fit.division, fit.race]).toEqual([4, 1, seasonInfo(fit).races - 1]);
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

  it('senha com checksum válido mas conteúdo impossível é rejeitada', () => {
    const bad: ((s: ReturnType<typeof newCampaign>) => void)[] = [
      (s) => (s.characterId = 'ninguem'),
      (s) => (s.car.vehicleId = 'tanque'),
      (s) => (s.planet = PLANETS.length),
      (s) => (s.planet = -1),
      (s) => (s.division = 2),
      (s) => (s.car.upgrades.engine = 4),
      (s) => (s.car.upgrades.armor = 1.5),
      (s) => (s.car.charges.front = 99),
      (s) => (s.car.charges.nitro = -1),
      (s) => (s.money = Number.NaN),
      (s) => ((s as { difficulty?: string }).difficulty = 'impossivel'),
      (s) => (s.playoff = 0),
      (s) => (s.race = 15),
    ];
    for (const change of bad) {
      const s = newCampaign('jake', 0x2f7bff);
      change(s);
      expect(decodeSave(encodeSave(s))).toBeNull();
    }
    const ok = newCampaign('jake', 0x2f7bff, 'hard');
    ok.planet = PLANETS.length - 1;
    ok.division = 1;
    ok.car = { vehicleId: 'havac', upgrades: { engine: 3, tires: 3, shocks: 3, armor: 3 }, charges: { front: 2, rear: 1, nitro: 0 } };
    expect(decodeSave(encodeSave(ok))).toEqual(ok);
  });
});

/** Ordem de compra do original: cada carro novo é melhor que o anterior. */
const CAR_ORDER = ['dirtdevil', 'marauder', 'airblade', 'battletrak', 'havac'];

describe('progressão dos carros', () => {
  const maxed = (id: string) => buildSpec(VEHICLES[id], maxedSetup(id));
  const accel = (s: VehicleSpec) => s.accel + 0.15 * s.nitroAccel; // mesma conta das barras (parte do turbo)

  /** Dirt Devil < Marauder < Air Blade < Battle Trak < Havac, ordem estrita. */
  function expectLadder(f: (id: string) => number, higherIsBetter = true, margin = 0) {
    const v = CAR_ORDER.map((id) => (higherIsBetter ? f(id) : -f(id)));
    const all = v.map((x) => Math.abs(x).toFixed(2)).join(' ');
    for (let i = 1; i < v.length; i++) expect(v[i] - v[i - 1], `${CAR_ORDER[i]}: ${all}`).toBeGreaterThan(margin);
  }

  it('com todas as melhorias, cada carro supera o anterior em final; blindagem e arranque seguem o estilo', () => {
    expectLadder((id) => maxed(id).maxSpeed);
    // o estilo continua no máximo: o Air Blade é o mais frágil e o que mais arranca entre os três
    // primeiros; o tanque (Battle Trak) é o mais blindado; as melhorias sempre rendem
    const m = Object.fromEntries(CAR_ORDER.map((id) => [id, maxed(id)]));
    for (const id of ['dirtdevil', 'marauder']) {
      expect(m.airblade.armor).toBeLessThan(m[id].armor);
      expect(accel(m.airblade)).toBeGreaterThan(accel(m[id]));
    }
    for (const id of CAR_ORDER) {
      if (id !== 'battletrak') expect(m.battletrak.armor).toBeGreaterThan(m[id].armor);
      expect(accel(m[id])).toBeGreaterThan(accel(VEHICLES[id]));
      expect(m[id].armor).toBeGreaterThan(VEHICLES[id].armor);
    }
    expect(m.havac.armor).toBeGreaterThan(m.marauder.armor);
  });

  it('de fábrica cada carro tem o seu estilo (não são quase iguais)', () => {
    const v = VEHICLES;
    // tanque arranca menos e gruda mais; Havac rápido e com freio forte; Air Blade leve, ágil e frágil;
    // Dirt Devil vira melhor
    for (const id of CAR_ORDER.filter((x) => x !== 'battletrak')) {
      expect(v.battletrak.accel).toBeLessThan(v[id].accel);
      expect(v.battletrak.grip).toBeGreaterThan(v[id].grip);
    }
    for (const id of CAR_ORDER.filter((x) => x !== 'havac')) {
      expect(v.havac.maxSpeed).toBeGreaterThan(v[id].maxSpeed);
      expect(v.havac.brake).toBeGreaterThan(v[id].brake);
    }
    for (const id of CAR_ORDER.filter((x) => x !== 'airblade')) {
      expect(v.airblade.accel).toBeGreaterThan(v[id].accel);
      expect(v.airblade.armor).toBeLessThan(v[id].armor);
      expect(v.airblade.mass).toBeLessThan(v[id].mass);
    }
    for (const id of CAR_ORDER.filter((x) => x !== 'dirtdevil')) expect(v.dirtdevil.steerRate).toBeGreaterThan(v[id].steerRate);
    // final de fábrica varia pelo menos 8 %; o 0–100 km/h no chão plano ideal varia pelo menos 25 %
    // (rodada 11: na reta de teste das evidências, de 1,37 a 1,8 s — antes todos entre 0,85 e 1,22 s)
    const sp = CAR_ORDER.map((id) => v[id].maxSpeed);
    expect(Math.max(...sp) / Math.min(...sp)).toBeGreaterThan(1.08);
    const zeroTo100 = (s: VehicleSpec) => {
      const c = createVehicleState(s, 0, 0, 0);
      let t = 0;
      for (; forwardSpeed(c) * 3.6 < 100 && t < 5; t += 1 / 60) stepVehicle(c, s, { ...emptyInput(), throttle: 1 }, FLAT, 1 / 60);
      return t;
    };
    const t100 = CAR_ORDER.map((id) => zeroTo100(v[id]));
    const all = t100.map((x) => x.toFixed(2)).join(' ');
    for (const x of t100) {
      expect(x, all).toBeGreaterThan(1);
      expect(x, all).toBeLessThan(1.8);
    }
    expect(Math.max(...t100) / Math.min(...t100), all).toBeGreaterThan(1.25);
  });

  it('carros caros não são mais lentos que os baratos (de fábrica)', () => {
    for (let i = 1; i < CAR_ORDER.length; i++) expect(VEHICLES[CAR_ORDER[i]].maxSpeed).toBeGreaterThanOrEqual(VEHICLES[CAR_ORDER[i - 1]].maxSpeed);
  });

  it('velocidade efetiva: com todas as melhorias, a volta de cada carro é mais rápida que a do anterior', () => {
    // uma pista de cada planeta, CPU habilidosa sozinha na pista; média da 2ª volta
    const defs = PLANETS.map((p) => TRACKS.find((t) => t.theme === p.theme)!).filter(Boolean);
    const lap = (id: string) => {
      const spec = maxed(id);
      let sum = 0;
      for (const def of defs) {
        const w = createWorld(new Track(def), [{ name: 'P', color: 0, spec, ai: { skill: 0.9, aggression: 0, lane: 0 } }], 2, 7, PRIZES);
        w.started = true;
        const r = w.racers[0];
        for (let t = 0; r.progress.lapTimes.length < 2 && t < 120; t += 1 / 60) stepWorld(w, {}, 1 / 60);
        expect(r.progress.lapTimes.length).toBe(2);
        sum += r.progress.lapTimes[1];
      }
      return sum / defs.length;
    };
    const times = Object.fromEntries(CAR_ORDER.map((id) => [id, lap(id)]));
    // degrau que se sente: pelo menos 0,15 s por volta entre um carro e o próximo
    expectLadder((id) => times[id], false, 0.15);
  }, 60000);

  it('volta solo do piloto simples (cenário "handling" das evidências): cada degrau abre 0,15 s', () => {
    // mesmo piloto de scripts/evidencias.mjs: segue a linha central com acelerador cheio e freia só nas
    // curvas fechadas; 1ª volta na primeira pista, sem nitro
    const lap = (id: string) => {
      const spec = maxed(id);
      const track = new Track(TRACKS[0]);
      const w = createWorld(track, [{ name: 'P', color: 0, spec, ai: null }], 99, 1, PRIZES);
      w.started = true;
      const r = w.racers[0];
      const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
      for (let t = 0; !r.progress.lapTimes.length && t < 40; t += 1 / 60) {
        const q = track.query(r.car.x, r.car.z, r.car.pieceIndex);
        const v = forwardSpeed(r.car);
        const p = track.pointAtDist(q.dist + 6 + Math.max(0, v) * 0.3);
        const d = wrap(Math.atan2(p.x - r.car.x, p.z - r.car.z) - r.car.heading);
        const bend = wrap(track.pointAtDist(q.dist + 8 + v * 0.45).heading - track.pointAtDist(q.dist).heading);
        const brake = Math.abs(bend) > 0.9 && v > spec.maxSpeed * 0.7;
        const input = { throttle: brake ? 0 : 1, brake: brake ? 0.6 : 0, steer: Math.max(-1, Math.min(1, -d * 2.5)), fire: false, drop: false, nitro: false };
        stepWorld(w, { 0: input }, 1 / 60);
      }
      expect(r.progress.lapTimes.length, id).toBe(1);
      return r.progress.lapTimes[0];
    };
    const times = Object.fromEntries(CAR_ORDER.map((id) => [id, lap(id)]));
    expectLadder((id) => times[id], false, 0.15);
  }, 30000);
});

/** Degrau de dificuldade (volta solo): teto da diferença e maior salto de uma divisão para a outra (s). */
const DEGRAU_MAX = 3.2;
const DEGRAU_JUMP = 1.2;

describe('rivais e economia da campanha', () => {
  it('ritmo dos rivais: Fácil ≤ Normal ≤ Difícil em cada tier e rival; motor não cai de um tier para o outro', () => {
    // (só nos tiers que cada dificuldade tem: o Fácil vai até New Mojave, o Normal até Nho)
    const tiers = (d: Difficulty) => CAMPAIGN_RULES[d].planets * 2;
    for (let t = 0; t < 12; t++)
      for (let i = 0; i < 3; i++) {
        if (t < tiers('easy')) expect(rivalPace(t, i, 'easy'), `t${t} r${i}`).toBeLessThanOrEqual(rivalPace(t, i, 'normal'));
        if (t < tiers('normal')) expect(rivalPace(t, i, 'normal'), `t${t} r${i}`).toBeLessThanOrEqual(rivalPace(t, i, 'hard'));
        for (const d of ['easy', 'normal', 'hard'] as const) {
          expect(rivalEngine(t, i, 'easy')).toBeLessThanOrEqual(rivalEngine(t, i, d));
          if (t > 0) expect(rivalEngine(t, i, d), `${d} t${t} r${i}`).toBeGreaterThanOrEqual(rivalEngine(t - 1, i, d));
        }
      }
  });

  it('nível dos rivais por tier; peça nível 3 só a partir de Bogmire (local) e Nho (todos)', () => {
    expect(RIVAL_LEVEL).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
    const bogmire = PLANETS.findIndex((p) => p.id === 'bogmire') * 2;
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let t = 0; t < 12; t++) {
        for (let i = 0; i < 3; i++) {
          const lv = rivalLevel(t, i, d);
          if (t < bogmire) expect(lv).toBeLessThan(3);
          if (t > 0) expect(lv).toBeGreaterThanOrEqual(rivalLevel(t - 1, i, d));
        }
      }
    }
    expect(rivalLevel(8, 0)).toBe(2); // New Mojave A: Rip e Shred ainda no 2
    expect(rivalLevel(9, 0)).toBe(3); // Nho A
  });

  it('cargas, agressividade e habilidade dos rivais crescem por planeta', () => {
    const s = newCampaign('jake', 0);
    let prev: ReturnType<typeof opponentsFor> | null = null;
    for (let p = 0; p < PLANETS.length; p++) {
      for (let d = 0; d < 2; d++) {
        s.planet = p;
        s.division = d;
        const ops = opponentsFor(s, VEHICLES);
        if (prev) {
          for (let i = 0; i < 3; i++) {
            expect(ops[i].ai.skill).toBeGreaterThanOrEqual(prev[i].ai.skill);
            if (ops[i].name === prev[i].name) expect(ops[i].ai.aggression).toBeGreaterThanOrEqual(prev[i].ai.aggression);
          }
        }
        prev = ops;
      }
    }
    expect(rivalExtraCharges(11, 0)).toBeGreaterThan(rivalExtraCharges(0, 0));
    expect(rivalAggression(RIVALS.Rip.aggression, 11)).toBeGreaterThan(rivalAggression(RIVALS.Rip.aggression, 0));
    // no Inferno os rivais correm com mais cargas que o carro de fábrica
    s.planet = PLANETS.length - 1;
    const inferno = opponentsFor(s, VEHICLES)[0];
    expect(inferno.spec.frontCharges).toBeGreaterThan(VEHICLES[inferno.spec.id].frontCharges);
  });

  it('Inferno evolui da Divisão B para a A; J. B. Slash tem bônus próprio', () => {
    for (const d of ['normal', 'hard'] as const) {
      const s = newCampaign('jake', 0, d);
      s.planet = PLANETS.length - 1;
      const b = opponentsFor(s, VEHICLES, d);
      s.division = 1;
      const a = opponentsFor(s, VEHICLES, d);
      for (let i = 0; i < 3; i++) {
        expect(a[i].spec.maxSpeed).toBeGreaterThan(b[i].spec.maxSpeed);
        expect(a[i].ai.skill).toBeGreaterThanOrEqual(b[i].ai.skill);
        expect(a[i].ai.aggression).toBeGreaterThanOrEqual(b[i].ai.aggression);
      }
      expect(a[0].spec.frontCharges).toBeGreaterThan(b[0].spec.frontCharges);
      // o chefe final corre mais e aguenta mais que o local na corrida normal e que o chefe de Nho
      s.race = seasonInfo(s).races - 1;
      const slash = bossOf(s, VEHICLES, d);
      expect(slash.spec.maxSpeed).toBeGreaterThan(a[2].spec.maxSpeed);
      expect(slash.spec.armor).toBeGreaterThan(a[2].spec.armor);
      const nho = { ...s, planet: PLANETS.length - 2 };
      expect(slash.spec.armor).toBeGreaterThan(bossOf(nho, VEHICLES, d).spec.armor);
      expect(slash.ai.skill).toBeGreaterThan(bossOf(nho, VEHICLES, d).ai.skill);
    }
    // motor do local nunca abaixo do de Rip e Shred; no Difícil o nível a mais não vai para o motor
    for (let t = 0; t < 12; t++) {
      for (const d of ['easy', 'normal', 'hard'] as const) expect(rivalEngine(t, 2, d)).toBeGreaterThanOrEqual(rivalEngine(t, 0, d));
      expect(rivalEngine(t, 2, 'hard')).toBe(rivalEngine(t, 2, 'normal'));
    }
  });

  /** Ordem de preferência de peças do jogador mediano: motor primeiro, depois pneus, amortecedores e blindagem. */
  const PART_ORDER = ['engine', 'tires', 'shocks', 'armor'] as const;

  /**
   * Na Divisão A do planeta antes de Nho, o jogador guarda o dinheiro da troca pelo Havac (a troca paga
   * no máximo 80 % do carro novo: o Havac não sai mais de graça).
   */
  function reserveForNext(s: CampaignState): number {
    if (s.division !== 1 || s.planet + 1 >= planetCount(s) || s.car.vehicleId === 'havac') return 0;
    const there = { ...s, planet: s.planet + 1, division: 0 };
    return !carsForSale(s).includes('havac') && carsForSale(there).includes('havac') ? carSwapCost(s.car, 'havac') : 0;
  }

  /**
   * Jogador mediano (2º, 1º, 3º, 2º, 2º, 1º… e ~$4.000 por corrida em dinheiro da pista e abates, com
   * o multiplicador do planeta): troca de carro na ordem do original assim que o próximo está à venda e
   * cabe no bolso (guarda dinheiro para ele), e no resto do tempo compra a peça que a loja do planeta
   * vende e cabe no bolso, motor primeiro. Mede o dinheiro e o carro ao fim de cada planeta.
   */
  function simulate(d: Difficulty, opts: { charges?: boolean } = {}) {
    const places = [2, 1, 3, 2, 2, 1];
    /** cargas compradas em cada planeta (opts.charges: depois das peças, até 2 por planeta) */
    const chargesBought: number[] = [];
    const s = newCampaign('jake', 0, d);
    const bought: { id: string; planet: number; tier: number; race: number; cost: number }[] = [];
    /** valor investido (carro + peças) ao entrar em cada planeta */
    const worth: number[] = [];
    /** dinheiro no bolso ao entrar em cada tier (depois das compras) e o carro com que corre */
    const cash: number[] = [];
    const cars: CampaignState['car'][] = [];
    let havacMax = -1;
    for (let i = 0; !s.champion && i < 400; i++) {
      for (;;) {
        const next = CAR_ORDER[CAR_ORDER.indexOf(s.car.vehicleId) + 1];
        if (next && carsForSale(s).includes(next)) {
          const cost = carSwapCost(s.car, next);
          if (cost > s.money) break; // guardando para o próximo carro
          s.money -= cost;
          s.car = newCarSetup(next);
          bought.push({ id: next, planet: s.planet, tier: tier(s), race: s.race, cost });
          continue;
        }
        // antes de Nho, guarda o dinheiro da troca pelo Havac
        const k = PART_ORDER.find((k) => {
          const p = s.car.upgrades[k] < shopLevel(s) ? upgradePrice(s.car, k) : null;
          return p !== null && p <= s.money - reserveForNext(s);
        });
        if (!k) {
          // com as peças em dia (nada mais cabe), uma carga extra por vez: até 2 por planeta
          if (!opts.charges || (chargesBought[s.planet] ?? 0) >= 2) break;
          const ck = CHARGE_KINDS.find((c) => {
            const p = campaignChargePrice(s, c);
            return p !== null && p <= s.money - reserveForNext(s);
          });
          if (!ck) break;
          s.money -= campaignChargePrice(s, ck)!;
          s.car.charges[ck]++;
          chargesBought[s.planet] = (chargesBought[s.planet] ?? 0) + 1;
          continue;
        }
        s.money -= upgradePrice(s.car, k)!;
        s.car.upgrades[k]++;
      }
      if (havacMax < 0 && s.car.vehicleId === 'havac' && UPGRADE_KINDS.every((k) => upgradePrice(s.car, k) === null)) havacMax = tier(s);
      worth[s.planet] ??= s.money + CAR_PRICES[s.car.vehicleId].price + upgradesSpent(s.car);
      if (s.race === 0 && !s.playoff && cash[tier(s)] === undefined) {
        cash[tier(s)] = s.money;
        cars[tier(s)] = structuredClone(s.car);
      }
      const place = places[i % places.length];
      const prize = prizesFor(s)[Math.min(place, prizesFor(s).length) - 1];
      applyRaceResult(s, place, prize + Math.round(4000 * moneyScale(s)), 1);
    }
    return { s, bought, worth, havacMax, cash, cars, chargesBought };
  }

  it('jogador mediano troca de carro na ordem do original, planeta a planeta, em cada dificuldade', () => {
    const planetOf = (b: { id: string; planet: number }[], id: string) => PLANETS[b.find((x) => x.id === id)?.planet ?? -1]?.id;
    const easy = simulate('easy');
    expect(easy.s.champion).toBe(true);
    expect(planetOf(easy.bought, 'airblade')).toBe('drakonis');
    expect(planetOf(easy.bought, 'battletrak')).toBe('bogmire');

    for (const d of ['normal', 'hard'] as const) {
      const { s, bought, havacMax } = simulate(d);
      expect(s.champion).toBe(true);
      expect(bought.map((b) => b.id)).toEqual(CAR_ORDER.slice(1));
      expect(planetOf(bought, 'airblade')).toBe('drakonis');
      expect(['bogmire', 'newmojave']).toContain(planetOf(bought, 'battletrak'));
      expect(planetOf(bought, 'havac')).toBe('nho');
      // Havac no máximo só na reta final (Nho A ou depois), se chegar lá
      if (havacMax >= 0) expect(havacMax).toBeGreaterThanOrEqual(9);
    }
  });

  it('começo: a Divisão B da Chem VI é do Dirt Devil; o Marauder chega na Divisão A e custa correr por ele', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const s = newCampaign('jake', 0, d);
      expect(carsForSale(s)).toEqual(['dirtdevil']);
      expect(carComingSoon(s, 'marauder')).toContain('Divisão A');
      expect(carComingSoon(s, 'airblade')).toBe('');
      s.division = 1;
      expect(carsForSale(s)).toContain('marauder');
      expect(carComingSoon(s, 'marauder')).toBe('');
      // revenda de 30 %: trocar o Dirt Devil custa mais que o dinheiro inicial
      expect(carSwapCost(newCarSetup('dirtdevil'), 'marauder')).toBeGreaterThan(START_MONEY);
      const { bought } = simulate(d);
      expect(bought[0]).toMatchObject({ id: 'marauder', tier: 1 });
    }
    // peças do Dirt Devil valem a compra: nível 1 pela metade e rendendo mais que antes (+3 %)
    const dd = newCarSetup('dirtdevil');
    expect(upgradePrice(dd, 'engine')).toBe(20000);
    expect(upgradePrice(newCarSetup('marauder'), 'engine')).toBe(40000);
    const base = buildSpec(VEHICLES.dirtdevil, dd).maxSpeed;
    dd.upgrades.engine = 1;
    expect(buildSpec(VEHICLES.dirtdevil, dd).maxSpeed / base).toBeGreaterThan(1.035);
    expect(upgradePrice(dd, 'engine')).toBe(70000); // do nível 2 em diante, preço cheio
  });

  it('orçamento do Normal: cada compra pesa no começo e o dinheiro rende no fim', () => {
    const { worth } = simulate('normal');
    // patrimônio (dinheiro + carro + peças) na 1ª corrida de cada planeta
    expect(worth[1]).toBeGreaterThan(80000);
    expect(worth[1]).toBeLessThan(170000);
    expect(worth[2]).toBeGreaterThan(160000);
    expect(worth[2]).toBeLessThan(320000);
    expect(worth[3]).toBeGreaterThan(260000);
    expect(worth[3]).toBeLessThan(480000);
    // em Nho, já com o Havac (que agora custa na troca: TRADE_CAP)
    expect(worth[4]).toBeGreaterThan(230000);
    expect(worth[4]).toBeLessThan(500000);
  });

  it('cargas de arma na economia: preço acompanha planeta e dificuldade; o mediano compra 1–2 por planeta', () => {
    // preço escala com o multiplicador do dinheiro (sem o teto: guardar não barateia a loja)
    const s = newCampaign('jake', 0, 'normal');
    const base = chargePrice(s.car, 'front', VEHICLES.dirtdevil)!;
    expect(campaignChargePrice(s, 'front')).toBe(Math.round((base * chargeScale(s)) / 500) * 500);
    const hard = newCampaign('jake', 0, 'hard');
    expect(campaignChargePrice(hard, 'front')!).toBeLessThan(campaignChargePrice(s, 'front')!);
    s.planet = 4;
    expect(campaignChargePrice(s, 'front')!).toBeGreaterThan(base);
    s.money = 10_000_000;
    expect(campaignChargePrice(s, 'front')).toBe(Math.round((base * chargeScale(s)) / 500) * 500);
    // o que falta de cargas entra no que a loja ainda vende (antes ficava fora do teto)
    const full = newCampaign('jake', 0, 'hard');
    full.planet = 5;
    full.car = maxedSetup('havac');
    expect(shopHeadroom(full)).toBeGreaterThan(0);
    for (const k of CHARGE_KINDS) full.car.charges[k] = maxExtraCharges(VEHICLES.havac, k);
    // sobra só a pintura de campeão (último planeta)
    expect(shopHeadroom(full)).toBe(paintPrice(full));
    full.paint = 'champion';
    expect(shopHeadroom(full)).toBe(0);
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const { s: end, chargesBought, bought } = simulate(d, { charges: true });
      expect(end.champion, d).toBe(true);
      expect(bought.map((b) => b.id), d).toEqual(d === 'easy' ? CAR_ORDER.slice(1, 4) : CAR_ORDER.slice(1));
      const per = Array.from({ length: CAMPAIGN_RULES[d].planets }, (_, i) => chargesBought[i] ?? 0);
      for (const n of per) expect(n, `${d}: ${per.join(' ')}`).toBeLessThanOrEqual(2);
      // em quase todos os planetas sobra para 1–2 cargas depois das peças
      expect(per.filter((n) => n >= 1).length, `${d}: ${per.join(' ')}`).toBeGreaterThanOrEqual(per.length - 1);
    }
  });

  it('teto de dinheiro no último planeta: não sobra fortuna sem nada para comprar', () => {
    for (const d of ['normal', 'hard'] as const) {
      const { cash } = simulate(d);
      const last = CAMPAIGN_RULES[d].planets - 1;
      // no bolso ao entrar no último planeta e na Divisão A dele (antes: $189 mil e $444 mil no Difícil)
      expect(cash[last * 2]).toBeLessThan(80000);
      expect(cash[last * 2 + 1]).toBeLessThan(150000);
    }
  });

  /**
   * Perfis extremos (mesma compra gananciosa do mediano): o fraco (3º, 2º, 4º… vence 1 duelo em 3 e
   * ~$2.500 por corrida na pista) repete divisões; o forte (quase sempre 1º, ~$6.000 na pista) vence
   * todos os duelos. `limit` corta a campanha (para medir quem fica preso).
   */
  function simulateProfile(d: Difficulty, places: number[], extra: number, duelWin: (n: number) => boolean, limit = 1500) {
    const s = newCampaign('jake', 0, d);
    const cash: number[] = [];
    let most = 0;
    let duels = 0;
    let i = 0;
    for (; !s.champion && i < limit; i++) {
      for (;;) {
        const next = CAR_ORDER[CAR_ORDER.indexOf(s.car.vehicleId) + 1];
        if (next && carsForSale(s).includes(next)) {
          const cost = carSwapCost(s.car, next);
          if (cost > s.money) break;
          s.money -= cost;
          s.car = newCarSetup(next);
          continue;
        }
        const k = PART_ORDER.find((k) => {
          const p = s.car.upgrades[k] < shopLevel(s) ? upgradePrice(s.car, k) : null;
          return p !== null && p <= s.money;
        });
        if (!k) {
          // peças em dia: as cargas que contam no teto (até CHARGE_ROOM por arma)
          const ck = CHARGE_KINDS.find((c) => {
            const p = campaignChargePrice(s, c);
            return p !== null && s.car.charges[c] < CHARGE_ROOM && p <= s.money;
          });
          if (!ck) {
            // tudo comprado no último planeta: a pintura de campeão leva o sobrante
            if (buyPaint(s)) continue;
            break;
          }
          s.money -= campaignChargePrice(s, ck)!;
          s.car.charges[ck]++;
          continue;
        }
        s.money -= upgradePrice(s.car, k)!;
        s.car.upgrades[k]++;
      }
      if (s.race === 0 && !s.playoff) cash[tier(s)] ??= s.money;
      most = Math.max(most, s.money);
      const prizes = prizesFor(s);
      const place = prizes.length === 2 ? (duelWin(duels++) ? 1 : 2) : places[i % places.length];
      applyRaceResult(s, place, prizes[place - 1] + Math.round(extra * moneyScale(s)), 1);
    }
    return { s, cash, most, races: i };
  }

  it('teto relativo à loja: quem repete divisões não junta milhões; o forte não chega rico ao Inferno A', () => {
    const weak = [2, 3, 3, 1, 4, 2];
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const w = simulateProfile(d, weak, 2500, (n) => n % 3 === 2);
      // o fraco termina a campanha (repetindo divisões) sem juntar fortuna (antes: $1–3 milhões)
      expect(w.s.champion, d).toBe(true);
      expect(w.most, d).toBeLessThan(450000);
    }
    // preso para sempre na Chem VI (nunca vence um duelo): em 300 corridas o bolso não vira fortuna
    // (as vitórias pagam o 1º prêmio cheio mesmo com o teto; pista e 2º/3º rendem 5 %)
    const stuck = simulateProfile('hard', weak, 2500, () => false, 300);
    expect(stuck.s.planet).toBe(0);
    expect(stuck.most).toBeLessThan(500000);
    // forte no Difícil: chega ao Inferno A sem sobra (antes: ~$225 mil sem nada para comprar)
    const strong = simulateProfile('hard', [1, 1, 2, 1, 1, 1], 6000, () => true);
    expect(strong.s.champion).toBe(true);
    expect(strong.cash[11]).toBeLessThan(120000);
    // e continua sem teto enquanto há o que comprar: guardar para o próximo carro rende inteiro
    const s = newCampaign('jake', 0, 'normal');
    expect(hoardFactor(s)).toBe(1);
    s.money = shopHeadroom(s) + 1;
    expect(hoardFactor(s)).toBe(HOARD_MONEY);
    // com o teto caem o 2º/3º e a pista; o 1º paga cheio
    expect(prizesFor(s)[1]).toBeLessThan(prizesFor(newCampaign('jake', 0, 'normal'))[1]);
    expect(prizesFor(s)[0]).toBe(prizesFor(newCampaign('jake', 0, 'normal'))[0]);
    s.money = shopHeadroom(s) * 3 + 200000;
    expect(hoardFactor(s)).toBeLessThan(HOARD_MONEY);
    // Havac no máximo no Inferno: nada a comprar
    const inf = newCampaign('jake', 0, 'hard');
    inf.planet = 5;
    inf.car = maxedSetup('havac');
    for (const k of CHARGE_KINDS) inf.car.charges[k] = maxExtraCharges(VEHICLES.havac, k);
    inf.paint = 'champion';
    expect(shopHeadroom(inf)).toBe(0);
  });

  it('o teto não esvazia o clímax: 1º lugar, duelo e bônus do chefe pagam cheio; a pintura leva o sobrante', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      // último planeta, Divisão A, tudo comprado e bolso muito acima do que a loja vende
      const s = newCampaign('jake', 0, d);
      s.planet = planetCount(s) - 1;
      s.division = 1;
      s.car = maxedSetup('havac');
      for (const k of CHARGE_KINDS) s.car.charges[k] = maxExtraCharges(VEHICLES.havac, k);
      s.paint = 'champion';
      s.money = 2_000_000;
      expect(hoardFactor(s), d).toBe(HOARD_CAP);
      const full = (n: number) => Math.round((n * prizeScale(s)) / 500) * 500;
      // corrida normal: o 1º nunca cai; 2º/3º e o dinheiro da pista caem
      expect(prizesFor(s)[0], d).toBe(full(CAMPAIGN_PRIZES[0]));
      expect(prizesFor(s)[1], d).toBeLessThan(full(CAMPAIGN_PRIZES[1]));
      expect(moneyScale(s), d).toBeLessThan(prizeScale(s));
      // duelo do chefe: prêmio e bônus cheios
      s.race = racesIn(s) - 1;
      expect(raceKind(s)).toBe('boss');
      expect(prizesFor(s)[0], d).toBe(full(CAMPAIGN_PRIZES[0]));
      expect(bossBonus(s), d).toBe(full(BOSS_BONUS));
    }
    // Difícil, Inferno A: 1º = $13.500 e bônus do J. B. Slash = $27.500 (antes $3.500 e $7.000 com o teto)
    const inf = newCampaign('jake', 0, 'hard');
    inf.planet = 5;
    inf.division = 1;
    inf.money = 2_000_000;
    expect(prizesFor(inf)[0]).toBe(13500);
    expect(bossBonus(inf)).toBe(27500);
    // pintura de campeão: só no último planeta, uma vez, troca a cor do carro
    const early = newCampaign('jake', 0, 'hard');
    early.money = 1_000_000;
    expect(paintPrice(early)).toBeNull();
    expect(buyPaint(early)).toBe(false);
    const price = paintPrice(inf)!;
    expect(price).toBe(Math.round((CHAMPION_PAINT.price * prizeScale(inf)) / 500) * 500);
    expect(buyPaint(inf)).toBe(true);
    expect(inf.money).toBe(2_000_000 - price);
    expect(inf.color).toBe(CHAMPION_PAINT.color);
    expect(paintPrice(inf)).toBeNull();
    expect(decodeSave(encodeSave(inf))!.paint).toBe('champion');
  });

  /**
   * Degrau de dificuldade (rodada 11: contra o piloto de referência, `referenceInput` — centro da pista,
   * acelera sempre, só DERRAPAR): ele com o carro e as peças do jogador mediano no começo de cada
   * divisão contra o piloto local, sozinhos em duas pistas do planeta; média da 2ª volta (positivo = o
   * local é mais rápido). Sem picos de uma divisão para a outra e com teto; o Difícil nunca mais fácil
   * que o Normal com o mesmo carro do jogador.
   */
  it('degrau de dificuldade: o piloto local contra o piloto de referência, sem picos nem inversão', () => {
    const lap = (spec: VehicleSpec, ai: { skill: number } | null, d: Difficulty, theme: string) => {
      const defs = TRACKS.filter((t) => t.theme === theme).slice(0, 2);
      let sum = 0;
      for (const def of defs) {
        const w = createWorld(new Track(def), [{ name: 'P', color: 0, spec, ai: ai && { skill: ai.skill, aggression: 0, lane: 0 } }], 2, 7, PRIZES, d);
        w.started = true;
        const r = w.racers[0];
        for (let t = 0; r.progress.lapTimes.length < 2 && t < 150; t += 1 / 60) stepWorld(w, ai ? {} : { 0: referenceInput(w, r) }, 1 / 60);
        sum += r.progress.lapTimes[1] ?? 99;
      }
      return sum / defs.length;
    };
    const deltas: Record<string, number[]> = {};
    const { cars } = simulate('normal');
    for (const d of ['easy', 'normal', 'hard'] as const) {
      deltas[d] = [];
      for (let t = 0; t < CAMPAIGN_RULES[d].planets * 2; t++) {
        const s = newCampaign('jake', 0, d);
        s.planet = t >> 1;
        s.division = t & 1;
        // o mesmo carro (o do mediano no Normal) em todas as dificuldades: só os rivais mudam
        s.car = cars[Math.min(t, cars.length - 1)];
        const local = opponentsFor(s, VEHICLES, d)[2];
        const theme = currentPlanet(s).theme;
        deltas[d].push(lap(playerSpec(s, VEHICLES), null, d, theme) - lap(local.spec, local.ai, d, theme));
      }
    }
    const fmt = (d: string) => deltas[d].map((x) => x.toFixed(2)).join(' ');
    const all = `fácil ${fmt('easy')} | normal ${fmt('normal')} | difícil ${fmt('hard')}`;
    for (const d of ['easy', 'normal', 'hard']) {
      const v = deltas[d];
      for (const x of v) expect(Math.abs(x), all).toBeLessThan(DEGRAU_MAX);
      for (let t = 1; t < v.length; t++) expect(Math.abs(v[t] - v[t - 1]), all).toBeLessThan(DEGRAU_JUMP);
    }
    // Fácil ≤ Normal ≤ Difícil em cada divisão (folga de ruído da volta)
    for (let t = 0; t < deltas.easy.length; t++) expect(deltas.normal[t], all).toBeGreaterThan(deltas.easy[t] - 0.05);
    for (let t = 0; t < deltas.normal.length; t++) expect(deltas.hard[t], all).toBeGreaterThan(deltas.normal[t] - 0.05);
  }, 120000);
});

describe('desistir na campanha', () => {
  it('sair ou reiniciar no meio da corrida conta como último, sem dinheiro da corrida', () => {
    const s = newCampaign('jake', 0, 'normal');
    applyRaceResult(s, 1, 0, 0);
    const money = s.money;
    const r = forfeitRace(s)!;
    expect(r.pointsEarned).toBe(0);
    expect(r.moneyEarned).toBe(0);
    expect(s.money).toBe(money);
    expect(s.race).toBe(2);
    expect(s.stats.races).toBe(2);
  });

  it('no duelo do chefe e na repescagem desistir gasta a tentativa', () => {
    const s = newCampaign('jake', 0, 'normal');
    s.division = 1;
    for (let i = 0; i < seasonInfo(s).races - 1; i++) applyRaceResult(s, 1, 0, 0);
    expect(raceKind(s)).toBe('boss');
    expect(forfeitRace(s)!.outcome).toBe('playoff');
    const tries = s.playoff!;
    expect(tries).toBe(CAMPAIGN_RULES.normal.playoffTries);
    forfeitRace(s);
    expect(s.playoff).toBe(tries - 1);
    expect(forfeitRace(s)!.outcome).toBe('retry');
    expect([s.planet, s.division, s.race]).toEqual([0, 1, 0]);
  });

  it('no Fácil (e depois do título) sair é de graça', () => {
    const s = newCampaign('jake', 0, 'easy');
    expect(forfeitCosts(s)).toBe(false);
    expect(forfeitRace(s)).toBeNull();
    expect([s.race, s.stats.races]).toEqual([0, 0]);
    const h = newCampaign('jake', 0, 'hard');
    expect(forfeitCosts(h)).toBe(true);
    h.champion = true;
    expect(forfeitCosts(h)).toBe(false);
  });
});

describe('save: pendências e coerência', () => {
  it('viagem e final pendentes vão no save (recarregar na tela de resultados não perde a cena)', () => {
    const s = newCampaign('jake', 0, 'easy');
    s.division = 1;
    for (let i = 0; i < seasonInfo(s).races; i++) applyRaceResult(s, 1, 0, 0);
    expect(s.planet).toBe(1);
    expect(s.warpFrom).toBe(0);
    expect(decodeSave(encodeSave(s))!.warpFrom).toBe(0);
    let guard = 0;
    while (!s.champion && guard++ < 200) applyRaceResult(s, 1, 0, 0);
    expect(s.finalePending).toBe(true);
    expect(decodeSave(encodeSave(s))!.finalePending).toBe(true);
  });

  it('repescagem além das tentativas da dificuldade é cortada; campeão fora do último planeta é rejeitado', () => {
    const s = newCampaign('jake', 0, 'hard');
    s.playoff = 5;
    s.race = 3;
    const fit = decodeSave(encodeSave(s))!;
    expect(fit.playoff).toBe(CAMPAIGN_RULES.hard.playoffTries);
    const c = newCampaign('jake', 0, 'normal');
    c.champion = true;
    c.planet = 2;
    c.division = 1;
    expect(decodeSave(encodeSave(c))).toBeNull();
    c.planet = CAMPAIGN_RULES.normal.planets - 1;
    expect(decodeSave(encodeSave(c))).not.toBeNull();
    const w = newCampaign('jake', 0, 'normal');
    w.warpFrom = 0; // viagem de um planeta que ainda não foi deixado
    expect(decodeSave(encodeSave(w))).toBeNull();
  });
  it('fechar ou recarregar no meio da corrida conta como desistência ao voltar', () => {
    const s = newCampaign('jake', 0, 'normal');
    applyRaceResult(s, 1, 7000, 0);
    const money = s.money;
    expect(markRaceStarted(s)).toBe(true);
    // o save leva a marca (a página foi recarregada no meio da corrida)
    const back = decodeSave(encodeSave(s))!;
    expect(back.raceInProgress).toBe(true);
    const r = resolveAbandonedRace(back)!;
    expect(r.pointsEarned).toBe(0);
    expect([back.race, back.money, back.stats.races]).toEqual([2, money, 2]);
    expect(back.raceInProgress).toBeUndefined();
    // resolver de novo não conta outra vez
    expect(resolveAbandonedRace(back)).toBeNull();
    expect(back.race).toBe(2);
    // o resultado da corrida limpa a marca (terminou normalmente)
    markRaceStarted(s);
    applyRaceResult(s, 2, 5000, 0);
    expect(s.raceInProgress).toBeUndefined();
    // no Fácil desistir é de graça: nem marca
    const e = newCampaign('jake', 0, 'easy');
    expect(markRaceStarted(e)).toBe(false);
    expect(e.raceInProgress).toBeUndefined();
    // marca com tipo errado invalida o save
    const bad = { ...newCampaign('jake', 0, 'normal'), raceInProgress: 'sim' } as unknown as CampaignState;
    expect(decodeSave(encodeSave(bad))).toBeNull();
  });
});

describe('campanha cooperativa', () => {
  const coop = () => newCampaign('jake', 0xe02828, 'normal', { characterId: 'tarquinn', color: 0x2f7bff });

  it('o jogador 2 começa com carro e dinheiro próprios', () => {
    const c = coop();
    expect(c.coop).toMatchObject({ characterId: 'tarquinn', color: 0x2f7bff, money: START_MONEY });
    expect(c.coop!.car).not.toBe(c.car);
    expect(newCampaign('jake', 0).coop).toBeUndefined();
  });

  it('coopView mostra a campanha pelos olhos do jogador 2 (o carro é o mesmo objeto)', () => {
    const c = coop();
    c.coop!.money = 1234;
    const v = coopView(c, 1);
    expect(v.money).toBe(1234);
    expect(v.characterId).toBe('tarquinn');
    expect(v.car).toBe(c.coop!.car);
    expect(v.planet).toBe(c.planet);
    expect(coopView(c, 0)).toBe(c);
    expect(coopOwner(c, 1)).toBe(c.coop);
    expect(coopOwner(newCampaign('jake', 0), 1)).not.toHaveProperty('characterId', 'tarquinn');
  });

  it('pontos pela melhor colocação da dupla; cada um leva o próprio dinheiro', () => {
    const c = coop();
    const r = applyRaceResult(c, 1, 5000, 3, 2000);
    expect(r.pointsEarned).toBe(POINTS[0]);
    expect(c.money).toBe(START_MONEY + 5000);
    expect(c.coop!.money).toBe(START_MONEY + 2000);
    expect(c.stats.earnings).toBe(7000);
    expect(c.stats.kills).toBe(3);
  });

  it('o bônus do chefe vai para os dois', () => {
    const c = coop();
    c.division = 1;
    c.race = racesIn(c) - 1;
    c.points = 10000;
    expect(raceKind(c)).toBe('boss');
    const bonus = bossBonus(c);
    applyRaceResult(c, 1, 0, 0, 0);
    expect(c.money).toBe(START_MONEY + bonus);
    expect(c.coop!.money).toBe(START_MONEY + bonus);
  });

  it('a senha leva o jogador 2 e recusa um jogador 2 inválido', () => {
    const c = coop();
    c.coop!.car.upgrades.engine = 2;
    expect(decodeSave(encodeSave(c))?.coop).toEqual(c.coop);
    const bad = { ...coop(), coop: { characterId: 'ninguem', color: 0, money: 0, car: newCarSetup('dirtdevil') } } as CampaignState;
    expect(decodeSave(encodeSave(bad))).toBeNull();
  });
});
