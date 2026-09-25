import { emptyInput, type ControlInput } from '../sim/input';
import { sanitizeInput } from './sync';

/**
 * Comandos do convidado pela rede. Tiro, bomba e turbo viajam como contadores de toques que só
 * aumentam (`b`: [tiros, bombas, turbos]): um toque curto entre dois pacotes (ou num pacote
 * perdido) não se perde, porque o host vê o contador maior no próximo que chegar.
 */
export interface NetCmd {
  /** número do passo local do convidado */
  n: number;
  i: ControlInput;
  b: [number, number, number];
}

/** Comandos por pacote: os 2 novos e os 2 anteriores de novo (o canal rápido pode perder pacotes). */
export const CMDS_PER_MSG = 4;
/** Toques acumulados no máximo por botão (o host não dispara uma rajada atrasada sem fim). */
const MAX_PENDING = 3;
/** Fila máxima no host: acima disso descarta os mais velhos (os contadores não perdem toques). */
export const QUEUE_MAX = 4;

const MAX_COUNT = 0x3fffffff;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_COUNT;

/** Convidado: conta as bordas de subida de tiro, bomba e turbo. */
export class TapCounter {
  readonly count: [number, number, number] = [0, 0, 0];
  private prev = [false, false, false];

  update(i: ControlInput): [number, number, number] {
    const now = [i.fire, i.drop, i.nitro];
    for (let k = 0; k < 3; k++) {
      if (now[k] && !this.prev[k]) this.count[k] = (this.count[k] + 1) % MAX_COUNT;
      this.prev[k] = now[k];
    }
    return [this.count[0], this.count[1], this.count[2]];
  }
}

/** Mensagem `input` vinda do convidado: até CMDS_PER_MSG comandos válidos (os inválidos são descartados). */
export function parseInputMsg(m: unknown): NetCmd[] {
  const c = (m as { c?: unknown } | null)?.c;
  if (!Array.isArray(c)) return [];
  const out: NetCmd[] = [];
  for (const x of c.slice(0, CMDS_PER_MSG)) {
    const o = x as { n?: unknown; i?: unknown; b?: unknown } | null;
    if (!o || typeof o !== 'object' || !Number.isSafeInteger(o.n) || (o.n as number) < 0) continue;
    const b = Array.isArray(o.b) && o.b.length === 3 && o.b.every(isCount) ? (o.b as [number, number, number]) : null;
    if (!b) continue;
    out.push({ n: o.n as number, i: sanitizeInput(o.i), b: [b[0], b[1], b[2]] });
  }
  return out;
}

/**
 * Host: fila de comandos de um carro. Aplica um comando por passo, na ordem de `n` (o canal rápido
 * entrega fora de ordem); `acked` é o último `n` aplicado (volta ao convidado para a previsão).
 * Tiro/bomba/turbo viram pulsos de um passo quando o contador aumenta (com um passo solto entre
 * dois pulsos, porque a simulação só dispara na borda de subida).
 */
export class InputQueue {
  acked = -1;
  private q: NetCmd[] = [];
  private last: ControlInput = emptyInput();
  private seen: [number, number, number] | null = null;
  private pending = [0, 0, 0];
  private pulsed = [false, false, false];

  push(cmds: NetCmd[]): void {
    for (const c of cmds) {
      if (c.n <= this.acked || this.q.some((x) => x.n === c.n)) continue;
      const at = this.q.findIndex((x) => x.n > c.n);
      if (at < 0) this.q.push(c);
      else this.q.splice(at, 0, c);
    }
    if (this.q.length > QUEUE_MAX * 4) this.q.splice(0, this.q.length - QUEUE_MAX * 4);
  }

  get size(): number {
    return this.q.length;
  }

  /** Comando do próximo passo (sem comando novo, repete o último sem os toques). */
  next(): ControlInput {
    // atrasou (rajada de pacotes): pula os mais velhos, sem perder toques (os contadores somam)
    while (this.q.length > QUEUE_MAX) this.take(this.q.shift()!);
    const c = this.q.shift();
    if (c) this.take(c);
    const out: ControlInput = { ...this.last, fire: false, drop: false, nitro: false };
    const keys = ['fire', 'drop', 'nitro'] as const;
    for (let k = 0; k < 3; k++) {
      if (this.pending[k] > 0 && !this.pulsed[k]) {
        out[keys[k]] = true;
        this.pending[k]--;
        this.pulsed[k] = true;
      } else this.pulsed[k] = false;
    }
    return out;
  }

  /** Solta os controles (convidado sem mandar nada há um tempo); os toques pendentes são descartados. */
  release(): void {
    this.last = emptyInput();
    this.pending = [0, 0, 0];
  }

  private take(c: NetCmd): void {
    this.acked = Math.max(this.acked, c.n);
    this.last = c.i;
    if (!this.seen) {
      // primeiro comando: só marca a referência (toques anteriores já não valem)
      this.seen = [...c.b];
      return;
    }
    for (let k = 0; k < 3; k++) {
      const d = c.b[k] - this.seen[k];
      if (d > 0) {
        this.pending[k] = Math.min(MAX_PENDING, this.pending[k] + d);
        this.seen[k] = c.b[k];
      } else if (d < -MAX_COUNT / 2) this.seen[k] = c.b[k]; // deu a volta
    }
  }
}
