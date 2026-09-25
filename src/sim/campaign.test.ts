import { describe, expect, it } from 'vitest';
import { trackById, TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  advanceEarly, applyRaceResult, bossBonus, CAMPAIGN_RULES, canAdvanceEarly, carsForSale, CHAMPION_BONUS, currentTrackId, decodeSave, encodeSave, moneyScale, newCampaign,
  opponentsFor, PLANET_MONEY, planetCount, planetForLevel, PLANETS, planetTracks, playerSpec, POINTS, prizesFor, raceKind, RIVAL_LEVEL, rivalAggression, rivalExtraCharges, rivalLevel, RIVALS,
  seasonInfo, seasonSchedule, shopLevel, START_MONEY, tier,
} from './campaign';
import {
  attributeTags, buildSpec, CAR_PRICES, carAttributes, carSwapCost, chargePrice, maxedSetup, maxExtraCharges, newCarSetup, tradeInValue, UPGRADE_KINDS, upgradeAvailable, upgradeLabel, upgradeName,
  upgradePrice, upgradesSpent,
} from './garage';
import { Track } from './track';
import { MAX_CHARGES, type VehicleSpec } from './vehicle';
import { createWorld, PRIZES, stepWorld, type Difficulty } from './world';

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

  it('revenda: metade do carro + 1/4 das peças; a troca pode devolver dinheiro', () => {
    const s = newCarSetup('battletrak');
    expect(tradeInValue(s)).toBe(55000);
    s.upgrades.engine = 2;
    expect(tradeInValue(s)).toBe(55000 + (40000 + 70000) / 4);
    expect(carSwapCost(s, 'havac')).toBe(130000 - tradeInValue(s));
    s.upgrades = { engine: 3, tires: 0, shocks: 3, armor: 3 };
    expect(carSwapCost(s, 'havac')).toBeLessThan(0);
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
    // só marca quem se afasta de verdade da média dos outros carros
    const others = (id: string, f: (v: (typeof VEHICLES)[string]) => number) => {
      const o = Object.values(VEHICLES).filter((v) => v.id !== id).map(f);
      return o.reduce((x, y) => x + y, 0) / o.length;
    };
    for (const id of Object.keys(t)) {
      const sp = VEHICLES[id].maxSpeed / others(id, (v) => v.maxSpeed) - 1;
      if (t[id].speed) expect(Math.abs(sp)).toBeGreaterThanOrEqual(0.05);
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
    expect(prizesFor(s)[0]).toBe(22500); // Inferno no Difícil: ×3 × 0,75
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
    // o dinheiro rende mais a cada planeta
    for (let p = 1; p < PLANETS.length; p++) expect(PLANET_MONEY[p]).toBeGreaterThan(PLANET_MONEY[p - 1]);
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

  /** Dirt Devil < Marauder ≈ Air Blade < Battle Trak < Havac (Marauder e Air Blade no mesmo degrau). */
  function expectLadder(f: (id: string) => number, higherIsBetter = true) {
    const v = Object.fromEntries(CAR_ORDER.map((id) => [id, higherIsBetter ? f(id) : -f(id)]));
    const mid = [v.marauder, v.airblade];
    for (const m of mid) expect(m).toBeGreaterThan(v.dirtdevil);
    expect(v.battletrak).toBeGreaterThan(Math.max(...mid));
    expect(v.havac).toBeGreaterThan(v.battletrak);
  }

  it('com todas as melhorias, cada carro supera o anterior em velocidade, aceleração e blindagem', () => {
    expectLadder((id) => maxed(id).maxSpeed);
    expectLadder((id) => accel(maxed(id)));
    expectLadder((id) => maxed(id).armor);
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
    expectLadder((id) => times[id], false);
  }, 60000);
});

describe('rivais e economia da campanha', () => {
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

  /**
   * Jogador mediano (2º, 1º, 3º, 2º, 2º, 1º… e ~$4.000 por corrida em dinheiro da pista e abates, com
   * o multiplicador do planeta): troca de carro na ordem do original assim que o próximo está à venda e
   * cabe no bolso (guarda dinheiro para ele), e no resto do tempo compra a peça mais barata que a loja
   * do planeta vende. Mede o dinheiro e o carro ao fim de cada planeta.
   */
  function simulate(d: Difficulty) {
    const places = [2, 1, 3, 2, 2, 1];
    const s = newCampaign('jake', 0, d);
    const bought: { id: string; planet: number }[] = [];
    /** valor investido (carro + peças) ao entrar em cada planeta */
    const worth: number[] = [];
    let havacMax = -1;
    for (let i = 0; !s.champion && i < 400; i++) {
      for (;;) {
        const next = CAR_ORDER[CAR_ORDER.indexOf(s.car.vehicleId) + 1];
        if (next && carsForSale(s).includes(next)) {
          const cost = carSwapCost(s.car, next);
          if (cost > s.money) break; // guardando para o próximo carro
          s.money -= cost;
          s.car = newCarSetup(next);
          bought.push({ id: next, planet: s.planet });
          continue;
        }
        const opts = UPGRADE_KINDS.map((k) => ({ k, p: s.car.upgrades[k] < shopLevel(s) ? upgradePrice(s.car, k) : null })).filter((o) => o.p !== null && o.p <= s.money);
        if (!opts.length) break;
        const o = opts.reduce((a, b) => (b.p! < a.p! ? b : a));
        s.money -= o.p!;
        s.car.upgrades[o.k]++;
      }
      if (havacMax < 0 && s.car.vehicleId === 'havac' && UPGRADE_KINDS.every((k) => upgradePrice(s.car, k) === null)) havacMax = tier(s);
      worth[s.planet] ??= s.money + CAR_PRICES[s.car.vehicleId].price + upgradesSpent(s.car);
      const place = places[i % places.length];
      const prize = prizesFor(s)[Math.min(place, prizesFor(s).length) - 1];
      applyRaceResult(s, place, prize + Math.round(4000 * moneyScale(s)), 1);
    }
    return { s, bought, worth, havacMax };
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
      // Havac no máximo só na reta final: Nho A (tier 9) ou depois
      expect(havacMax).toBeGreaterThanOrEqual(9);
    }
  });

  it('orçamento do Normal: cada compra pesa no começo e o dinheiro rende no fim', () => {
    const { worth } = simulate('normal');
    // patrimônio (dinheiro + carro + peças) na 1ª corrida de cada planeta
    expect(worth[1]).toBeGreaterThan(90000);
    expect(worth[1]).toBeLessThan(170000);
    expect(worth[2]).toBeGreaterThan(180000);
    expect(worth[2]).toBeLessThan(320000);
    expect(worth[3]).toBeGreaterThan(300000);
    expect(worth[3]).toBeLessThan(480000);
    // em Nho, já com o Havac
    expect(worth[4]).toBeGreaterThan(280000);
    expect(worth[4]).toBeLessThan(500000);
  });
});
