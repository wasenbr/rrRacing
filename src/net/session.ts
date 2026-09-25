/**
 * Peças do online sem rede nem DOM (testáveis): medição de ping, fichas de reconexão, espera
 * entre tentativas e o prazo para o host voltar à sala.
 */

/** Tempo que o host guarda o carro de quem caiu (e a espera máxima de quem está fora da tela). */
export const REJOIN_MS = 30000;

/** Ping (ida e volta) com média móvel; ignora respostas absurdas. */
export class Rtt {
  value: number | null = null;

  add(sample: number): void {
    if (!Number.isFinite(sample) || sample < 0 || sample > 10000) return;
    this.value = this.value === null ? sample : this.value + (sample - this.value) * 0.25;
  }
}

/** Cor do indicador de ping. */
export function pingTone(ms: number | null): 'good' | 'ok' | 'bad' | 'none' {
  if (ms === null) return 'none';
  return ms < 90 ? 'good' : ms < 180 ? 'ok' : 'bad';
}

/** Ficha de sessão: 16 caracteres aleatórios. */
export function newToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{16}$/.test(v);

/** Espera antes da tentativa `k` (0, 1, 2…): 1 s, 2 s, 4 s, 5 s, 5 s… */
export function backoffMs(k: number): number {
  return Math.min(5000, 1000 * 2 ** k);
}

export interface Seat<P> {
  peerId: string;
  player: P;
  /** carro na corrida em andamento (se houver) */
  racer?: number;
  /** quando saiu (null = conectado) */
  leftAt: number | null;
}

/**
 * Host: quem é quem pela ficha de sessão. Quem cai guarda a vaga (e o carro) por REJOIN_MS;
 * voltando com a mesma ficha, recebe tudo de volta.
 */
export class RejoinBook<P> {
  private seats = new Map<string, Seat<P>>();

  add(token: string, peerId: string, player: P, racer?: number): void {
    this.seats.set(token, { peerId, player, racer, leftAt: null });
  }

  tokenOf(peerId: string): string | undefined {
    for (const [t, s] of this.seats) if (s.peerId === peerId && s.leftAt === null) return t;
    return undefined;
  }

  setRacer(peerId: string, racer: number | undefined): void {
    const t = this.tokenOf(peerId);
    if (t) this.seats.get(t)!.racer = racer;
  }

  /** O convidado caiu: guarda a vaga. */
  left(peerId: string, now: number): Seat<P> | undefined {
    const t = this.tokenOf(peerId);
    if (!t) return undefined;
    const s = this.seats.get(t)!;
    s.leftAt = now;
    return s;
  }

  /** Voltou com a ficha: devolve a vaga (se ainda vale) e passa a usar o novo id. */
  rejoin(token: unknown, peerId: string, now: number): Seat<P> | undefined {
    if (!isToken(token)) return undefined;
    const s = this.seats.get(token);
    if (!s) return undefined;
    if (s.leftAt !== null && now - s.leftAt > REJOIN_MS) {
      this.seats.delete(token);
      return undefined;
    }
    const old = s.peerId;
    s.peerId = peerId;
    s.leftAt = null;
    return { ...s, peerId: old };
  }

  /** Vagas vencidas saem (devolve as que venceram agora). */
  expire(now: number): Seat<P>[] {
    const out: Seat<P>[] = [];
    for (const [t, s] of this.seats) {
      if (s.leftAt !== null && now - s.leftAt > REJOIN_MS) {
        this.seats.delete(t);
        out.push(s);
      }
    }
    return out;
  }

  /** Vagas guardadas de quem caiu (ainda válidas). */
  waiting(): Seat<P>[] {
    return [...this.seats.values()].filter((s) => s.leftAt !== null);
  }

  /** Nova corrida: esquece os carros da anterior. */
  clearRacers(): void {
    for (const s of this.seats.values()) s.racer = undefined;
  }

  remove(peerId: string): void {
    const t = this.tokenOf(peerId);
    if (t) this.seats.delete(t);
  }
}

/** Prazo para os humanos terminarem depois que o primeiro cruza a linha. */
export const FINISH_GRACE_MS = 30000;

/**
 * Host: pode voltar à sala sem perguntar? Sim quando todos os humanos terminaram ou o prazo depois
 * do primeiro acabou.
 */
export function canCloseRace(humansFinished: boolean[], firstFinishAt: number | null, now: number): boolean {
  if (humansFinished.every(Boolean)) return true;
  return firstFinishAt !== null && now - firstFinishAt >= FINISH_GRACE_MS;
}

/* ------------------------------------------------------------------ */
/* Ficha guardada (recarregar a página volta para a mesma sala)        */
/* ------------------------------------------------------------------ */

/** Sala, ficha e apresentação do convidado: recarregando a aba, entra de novo sem perguntar. */
export interface SavedSession {
  code: string;
  token: string;
  name: string;
  color: number;
  vehicleId: string;
}

export const SESSION_KEY = 'rnrr3d-rejoin';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Guarda (ou apaga, com null) a ficha. Sem armazenamento: não faz nada. */
export function saveSession(store: Store | null | undefined, s: SavedSession | null): void {
  try {
    if (s) store?.setItem(SESSION_KEY, JSON.stringify(s));
    else store?.removeItem(SESSION_KEY);
  } catch {
    /* sem armazenamento */
  }
}

/** Ficha guardada, conferida (o armazenamento também não é confiável: pode ter sido editado). */
export function loadSession(store: Store | null | undefined): SavedSession | null {
  try {
    const v = JSON.parse(store?.getItem(SESSION_KEY) ?? 'null') as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || typeof v.code !== 'string' || !/^[A-Z0-9]{4}$/.test(v.code) || !isToken(v.token)) return null;
    return {
      code: v.code,
      token: v.token,
      name: typeof v.name === 'string' ? v.name.slice(0, 12) : 'Piloto',
      color: Number.isInteger(v.color) ? (v.color as number) : 0,
      vehicleId: typeof v.vehicleId === 'string' ? v.vehicleId.slice(0, 32) : '',
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Decisões da sessão (sem rede nem DOM: o jogo só executa)            */
/* ------------------------------------------------------------------ */

/**
 * Esc/pausa no online (a corrida não para, o menu abre por cima). Com o placar na tela não abre:
 * o "Continuar" do menu esconderia o placar (e o "Voltar à sala" do host) de vez.
 */
export function onlineMenuToggle(phase: string, resultsShown: boolean, menuOpen: boolean): 'open' | 'close' | 'ignore' {
  if (menuOpen) return 'close';
  if (phase === 'menu' || (phase === 'finished' && resultsShown)) return 'ignore';
  return 'open';
}

/**
 * Convidado: a conexão com o host acabou. `gone`: o host avisou que fechou a sala; `token`: tem
 * ficha para voltar; `racing`: corrida na tela (sem placar); `resultsOpen`: placar na tela.
 * - close: fecha a rede e deixa o placar final como está
 * - giveUp: mostra o último placar conhecido com um aviso
 * - lost: volta ao menu com um aviso
 * - retry: tenta reconectar com a ficha (~30 s)
 * - none: já está tentando
 */
export function guestDropPlan(s: { gone: boolean; token: boolean; racing: boolean; resultsOpen: boolean; reconnecting: boolean }): 'close' | 'giveUp' | 'lost' | 'retry' | 'none' {
  if (s.gone) return s.resultsOpen ? 'close' : s.racing ? 'giveUp' : 'lost';
  if (!s.token) return s.racing || s.resultsOpen ? 'giveUp' : 'lost';
  return s.reconnecting ? 'none' : 'retry';
}

/** Sem estado do host por esse tempo: "Conexão instável…" e a previsão para de avançar sozinha. */
export const STALL_MS = 500;
/** Passos de previsão depois de travar (~250 ms à frente do último estado): depois disso o carro espera. */
export const STALL_STEPS = 15;

/** Convidado: limita a previsão do próprio carro quando os estados do host param de chegar. */
export class StallGuard {
  private extra = 0;
  stalled = false;

  /** `sinceSnapMs`: tempo desde o último estado. Devolve se a previsão pode andar mais um passo. */
  step(sinceSnapMs: number): boolean {
    this.stalled = sinceSnapMs > STALL_MS;
    if (!this.stalled) {
      this.extra = 0;
      return true;
    }
    return this.extra++ < STALL_STEPS;
  }
}

/** Host: sem comando do convidado por esse tempo (ou com a aba dele oculta), a CPU pilota o carro. */
export const CPU_TAKEOVER_MS = 1500;

export function cpuTakesOver(now: number, inputAt: number | undefined, away: boolean): boolean {
  return away || now - (inputAt ?? -Infinity) > CPU_TAKEOVER_MS;
}

/** Quanto o convidado espera, depois de mandar o "saí", para fechar a conexão (a mensagem precisa sair). */
export const LEAVE_FLUSH_MS = 400;

/**
 * Convidado: tiro, bomba e turbo soam e brilham na hora do toque; o mesmo evento vindo depois do
 * host é engolido (um por toque, até 1,5 s depois). Índices: 0 tiro, 1 bomba, 2 turbo/pulo.
 */
export class LocalEcho {
  private pending: number[][] = [[], [], []];

  played(k: 0 | 1 | 2, now: number): void {
    const q = this.pending[k];
    q.push(now);
    if (q.length > 4) q.shift();
  }

  /** O evento do host é o eco de um toque já mostrado? (consome o toque) */
  echo(k: 0 | 1 | 2, now: number): boolean {
    const q = this.pending[k];
    while (q.length && now - q[0] > 1500) q.shift();
    if (!q.length) return false;
    q.shift();
    return true;
  }

  /** Toques mostrados que o host ainda não confirmou. */
  count(k: 0 | 1 | 2, now: number): number {
    const q = this.pending[k];
    while (q.length && now - q[0] > 1500) q.shift();
    return q.length;
  }

  clear(): void {
    this.pending = [[], [], []];
  }
}
