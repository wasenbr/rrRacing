import { applyRaceResult, currentPlanet, encodeSave, forfeitCosts, promoteGoal, type CampaignState, type RaceReport } from './campaign';

/**
 * Fluxos da campanha em volta de uma corrida (chegada, pausa, sair/reiniciar, vídeo perdido, carregar),
 * sem DOM: o jogo (core/game.ts) só executa o que estas regras decidem, e os testes cobrem as transições.
 */

/** Corrida já contada na campanha (na chegada do jogador), guardada para a tela de resultados. */
export interface SettledRace {
  report: RaceReport;
  /** planeta em que a corrida foi disputada */
  fromPlanet: number;
  /** pontos para subir e chefe da divisão em que a corrida foi disputada */
  promote: number;
  boss: string;
}

/**
 * O jogador cruzou a chegada: o resultado vale na hora (antes valia só na tela de resultados, 3 s
 * depois; recarregar ou fechar nesse meio contava como último). Muta a campanha; salvar é do chamador.
 */
export function settleFinish(c: CampaignState, place: number, money: number, kills: number): SettledRace {
  const fromPlanet = c.planet;
  const promote = promoteGoal(c);
  const boss = currentPlanet(c).local;
  return { report: applyRaceResult(c, place, money, kills), fromPlanet, promote, boss };
}

/** Cena que vem depois de uma corrida contada: o final (título), a viagem (subiu de planeta) ou nenhuma. */
export function sceneAfter(c: CampaignState, fromPlanet: number, r: RaceReport): 'champion' | 'warp' | null {
  if (r.outcome === 'champion') return 'champion';
  if (r.outcome === 'promoted' && c.planet !== fromPlanet) return 'warp';
  return null;
}

/** Estado da corrida da campanha no momento em que o jogador sai ou reinicia. */
export interface RaceFlags {
  /** a largada aconteceu (world.started) */
  started: boolean;
  /** o jogador já cruzou a chegada (o resultado já foi contado: settleFinish) */
  finished: boolean;
  /** a tela de resultados já apareceu (ou a corrida já foi resolvida por uma saída anterior) */
  resolved: boolean;
  /** o vídeo caiu em algum momento desta corrida (mesmo que já tenha voltado) */
  videoLostThisRace: boolean;
}

/**
 * O que sair ou reiniciar faz com a corrida:
 * - 'none': nada a contar (não largou, ou já foi resolvida);
 * - 'counted': já contou na chegada (vale a colocação; nada é aplicado de novo);
 * - 'video': o vídeo caiu nesta corrida: não conta para a temporada;
 * - 'forfeit': desistência (conta como último);
 * - 'free': sair não custa (Fácil, depois do título).
 */
export type LeaveKind = 'none' | 'counted' | 'video' | 'forfeit' | 'free';

export function leaveRace(c: CampaignState, f: RaceFlags): LeaveKind {
  if (f.resolved || !f.started) return 'none';
  if (f.finished) return 'counted';
  if (!forfeitCosts(c)) return 'free';
  return f.videoLostThisRace ? 'video' : 'forfeit';
}

/** O que o menu de pausa mostra; a cobrança segue exatamente leaveRace (texto e regra não se contradizem). */
export interface PauseView {
  /** sair/reiniciar conta como último */
  costs: boolean;
  /** "Reiniciar"/"Desistir e ir para a próxima" disponível (sem vídeo a corrida largaria às cegas) */
  restartEnabled: boolean;
  /** aviso de que sair agora não conta */
  note: '' | 'video' | 'not-started';
}

export function pauseView(o: { campaign: CampaignState | null; online: boolean; started: boolean; videoLostThisRace: boolean; videoLostNow: boolean }): PauseView {
  const restartEnabled = !o.videoLostNow;
  if (o.online || !o.campaign) return { costs: false, restartEnabled: o.online ? false : restartEnabled, note: '' };
  const leave = leaveRace(o.campaign, { started: o.started, finished: false, resolved: false, videoLostThisRace: o.videoLostThisRace });
  const canCost = forfeitCosts(o.campaign);
  const note = !canCost ? '' : leave === 'video' ? 'video' : !o.started ? 'not-started' : '';
  return { costs: leave === 'forfeit', restartEnabled, note };
}

/**
 * Depois de desistir com "ir para a próxima": larga a corrida seguinte direto só quando a temporada
 * segue igual; se ela mudou (repescagem, divisão recomeçou, promoção, título), vai à garagem com o aviso.
 */
export function nextAfterForfeit(r: RaceReport | null): 'race' | 'hub' {
  return !r || r.outcome === 'continue' ? 'race' : 'hub';
}

/** Senha exportável: sem a marca de corrida em andamento (quem digita a senha não está no meio de uma). */
export function exportSave(s: CampaignState): string {
  const copy: CampaignState = { ...s };
  delete copy.raceInProgress;
  return encodeSave(copy);
}

/** Progresso para comparar dois saves da mesma campanha (corridas disputadas; empate: planeta/divisão). */
function progressOf(s: CampaignState): number {
  return s.stats.races * 1000 + s.planet * 10 + s.division;
}

/**
 * Carregar outro slot ou uma senha da mesma campanha que está atrás da que está em jogo: devolve o
 * aviso (progresso perdido), ou '' quando não volta atrás ou é outra campanha.
 */
export function behindNotice(current: CampaignState | null, loaded: CampaignState): string {
  if (!current || current === loaded) return '';
  const same = current.id && loaded.id ? current.id === loaded.id : current.characterId === loaded.characterId && (current.difficulty ?? 'normal') === (loaded.difficulty ?? 'normal');
  if (!same) return '';
  const lost = current.stats.races - loaded.stats.races;
  if (progressOf(loaded) >= progressOf(current) || lost <= 0) return '';
  return `Atenção: este save está ${lost === 1 ? '1 corrida' : `${lost} corridas`} atrás do jogo que estava aberto — o progresso seguinte não está nele.`;
}
