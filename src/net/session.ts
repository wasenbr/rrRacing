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
