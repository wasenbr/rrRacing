import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave, forfeitRace, markRaceStarted, newCampaign, promoteGoal, racesIn, raceKind, resolveAbandonedRace, type CampaignState } from './campaign';
import { behindNotice, exportSave, leaveRace, nextAfterForfeit, pauseView, sceneAfter, settleFinish } from './campaignFlow';

/** Recarregar a página: o save passa pela senha (como no slot) e volta. */
const reload = (s: CampaignState) => decodeSave(encodeSave(s))!;

const racing = { started: true, finished: false, resolved: false, videoLostThisRace: false };

describe('fluxo da campanha: chegada e recarregar', () => {
  it('terminar e recarregar antes dos resultados vale a colocação (não conta como último)', () => {
    const c = newCampaign('jake', 0, 'normal');
    markRaceStarted(c);
    expect(c.raceInProgress).toBe(true);
    // cruzou em 1º: aplica e salva na hora
    const settled = settleFinish(c, 1, 12000, 2);
    expect(settled.report.pointsEarned).toBe(400);
    const back = reload(c);
    // ao voltar não há corrida pendente: nada de desistência por cima
    expect(resolveAbandonedRace(back)).toBeNull();
    expect(back.points).toBe(400);
    expect(back.race).toBe(1);
    expect(back.stats.races).toBe(1);
    // sair durante os 3 s entre a chegada e os resultados: já contou, nada é aplicado de novo
    expect(leaveRace(c, { ...racing, finished: true })).toBe('counted');
  });

  it('sem chegada, recarregar no meio da corrida continua contando como desistência', () => {
    const c = newCampaign('jake', 0, 'normal');
    markRaceStarted(c);
    const back = reload(c);
    const r = resolveAbandonedRace(back);
    expect(r?.pointsEarned).toBe(0);
    expect(back.race).toBe(1);
  });

  it('a chegada que sobe de planeta deixa a viagem pendente no save; a do título, o final', () => {
    const c = newCampaign('jake', 0, 'easy');
    c.division = 1;
    c.race = racesIn(c) - 1;
    c.points = promoteGoal(c);
    expect(raceKind(c)).toBe('boss');
    const s = settleFinish(c, 1, 0, 0);
    expect(sceneAfter(c, s.fromPlanet, s.report)).toBe('warp');
    expect(reload(c).warpFrom).toBe(0);

    const f = newCampaign('jake', 0, 'easy');
    f.planet = 2;
    f.division = 1;
    f.race = racesIn(f) - 1;
    f.points = promoteGoal(f);
    const fs = settleFinish(f, 1, 0, 0);
    expect(sceneAfter(f, fs.fromPlanet, fs.report)).toBe('champion');
    expect(reload(f).finalePending).toBe(true);
  });
});

describe('fluxo da campanha: vídeo cai e volta', () => {
  it('a pausa e a cobrança seguem a mesma regra por corrida (mesmo depois de o vídeo voltar)', () => {
    const c = newCampaign('jake', 0, 'normal');
    markRaceStarted(c);
    // sem queda: pausa cobra, reiniciar disponível
    expect(pauseView({ campaign: c, online: false, started: true, videoLostThisRace: false, videoLostNow: false })).toEqual({ costs: true, restartEnabled: true, note: '' });
    // vídeo caiu: não cobra e não deixa reiniciar às cegas
    expect(pauseView({ campaign: c, online: false, started: true, videoLostThisRace: true, videoLostNow: true })).toEqual({ costs: false, restartEnabled: false, note: 'video' });
    // voltou: reiniciar volta, e a corrida continua sem contar (texto e cobrança iguais)
    const back = pauseView({ campaign: c, online: false, started: true, videoLostThisRace: true, videoLostNow: false });
    expect(back).toEqual({ costs: false, restartEnabled: true, note: 'video' });
    expect(leaveRace(c, { ...racing, videoLostThisRace: true })).toBe('video');
    expect(leaveRace(c, racing)).toBe('forfeit');
  });

  it('antes da largada e no Fácil sair não conta', () => {
    const c = newCampaign('jake', 0, 'normal');
    expect(pauseView({ campaign: c, online: false, started: false, videoLostThisRace: false, videoLostNow: false }).note).toBe('not-started');
    expect(leaveRace(c, { ...racing, started: false })).toBe('none');
    const easy = newCampaign('jake', 0, 'easy');
    expect(leaveRace(easy, racing)).toBe('free');
    expect(pauseView({ campaign: easy, online: false, started: true, videoLostThisRace: false, videoLostNow: false }).costs).toBe(false);
    // corrida já resolvida (resultados na tela) não conta de novo
    expect(leaveRace(c, { ...racing, resolved: true })).toBe('none');
  });
});

describe('fluxo da campanha: desistir e ir para a próxima', () => {
  it('temporada igual: larga a próxima; duelo, repescagem ou recomeço: vai à garagem', () => {
    const c = newCampaign('jake', 0, 'normal');
    expect(nextAfterForfeit(forfeitRace(c))).toBe('race');

    // última corrida da Divisão B sem pontos: vira repescagem
    const p = newCampaign('jake', 0, 'normal');
    p.race = racesIn(p) - 1;
    const rp = forfeitRace(p)!;
    expect(rp.outcome).toBe('playoff');
    expect(nextAfterForfeit(rp)).toBe('hub');

    // repescagem: desistir gasta a tentativa (última: a divisão recomeça)
    const last = reload(p);
    last.playoff = 1;
    const rr = forfeitRace(last)!;
    expect(rr.outcome).toBe('retry');
    expect(nextAfterForfeit(rr)).toBe('hub');

    // duelo do chefe com os pontos: desistir leva à repescagem
    const b = newCampaign('jake', 0, 'normal');
    b.division = 1;
    b.race = racesIn(b) - 1;
    b.points = promoteGoal(b);
    const rb = forfeitRace(b)!;
    expect(rb.outcome).toBe('playoff');
    expect(nextAfterForfeit(rb)).toBe('hub');
    // de graça (Fácil): larga direto
    expect(nextAfterForfeit(null)).toBe('race');
  });
});

describe('fluxo da campanha: carregar e senha', () => {
  it('senha exportada não leva a marca de corrida em andamento', () => {
    const c = newCampaign('jake', 0, 'normal');
    markRaceStarted(c);
    expect(decodeSave(exportSave(c))!.raceInProgress).toBeUndefined();
    expect(c.raceInProgress).toBe(true);
  });

  it('carregar um save mais antigo da mesma campanha avisa; outra campanha não', () => {
    const now = newCampaign('jake', 0, 'normal');
    const old = reload(now);
    expect(old.id).toBe(now.id);
    now.stats.races = 5;
    now.race = 5;
    expect(behindNotice(now, old)).toContain('5 corridas');
    expect(behindNotice(old, now)).toBe('');
    expect(behindNotice(null, old)).toBe('');
    const other = newCampaign('jake', 0, 'normal');
    expect(behindNotice(now, other)).toBe('');
    // saves antigos sem id: mesmo piloto e dificuldade contam como a mesma campanha
    const a = { ...now, id: undefined };
    const b = { ...old, id: undefined };
    expect(behindNotice(a, b)).toContain('corridas');
  });
});
