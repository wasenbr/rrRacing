/**
 * Comandos de um piloto em um passo de simulação.
 * É tudo o que a simulação precisa saber de um jogador — no modo online (v2)
 * será exatamente isto que cada cliente envia ao servidor.
 */
export interface ControlInput {
  throttle: number;
  brake: number;
  /** -1 = esquerda, +1 = direita */
  steer: number;
  fire: boolean;
  drop: boolean;
  nitro: boolean;
}

export function emptyInput(): ControlInput {
  return { throttle: 0, brake: 0, steer: 0, fire: false, drop: false, nitro: false };
}
