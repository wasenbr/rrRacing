/**
 * Amostras de áudio (efeitos CC0 em public/audio/sfx e falas do locutor em public/audio/locutor).
 * Carregadas em segundo plano; enquanto não chegam (ou se falharem), cada efeito usa só a síntese.
 */

export const SFX_FILES = [
  'explosao_crunch_a', 'explosao_crunch_b', 'explosao_curta_a', 'explosao_curta_b', 'explosao_sub', 'explosao_cauda',
  'plasma_a', 'plasma_b', 'plasma_c', 'sundog', 'missil_lancamento', 'nitro', 'jato',
  'impacto_metal_a', 'impacto_metal_b', 'impacto_placa', 'batida_soco', 'batida_grave', 'mureta', 'mina_clunk', 'oleo',
] as const;
export type SfxName = (typeof SFX_FILES)[number];

/** Loops de motor gravado (public/audio/motor), do mais lento ao mais rápido. */
export const ENGINE_LOOPS = ['motor_lenta', 'motor_0', 'motor_1'] as const;

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

/** Endereço de um arquivo em public/ (funciona no dev e no build com base relativa). */
export function publicUrl(path: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base.endsWith('/') ? base : base + '/'}${path}`;
}

/**
 * Decodifica e apara o silêncio inicial (MP3 tem ~25 ms de atraso do codificador),
 * para o tiro sair no mesmo quadro do evento.
 */
function trimStart(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const d = b.getChannelData(0);
  let first = 0;
  while (first < d.length && Math.abs(d[first]) < 0.004) first++;
  first = Math.max(0, first - 32);
  if (first < 64) return b;
  const out = ctx.createBuffer(b.numberOfChannels, b.length - first, b.sampleRate);
  for (let ch = 0; ch < b.numberOfChannels; ch++) out.copyToChannel(b.getChannelData(ch).subarray(first), ch);
  return out;
}

/** `trim = false` para loops (aparar o começo quebraria a emenda do loop). */
export function loadBuffer(ctx: BaseAudioContext, path: string, trim = true): Promise<AudioBuffer | null> {
  const key = path;
  const have = buffers.get(key);
  if (have) return Promise.resolve(have);
  let p = pending.get(key);
  if (!p) {
    p = fetch(publicUrl(path))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((b) => {
        const t = trim ? trimStart(ctx, b) : b;
        buffers.set(key, t);
        return t;
      })
      .catch(() => null);
    pending.set(key, p);
  }
  return p;
}

/** Buffer já carregado (ou null se ainda não chegou). */
export function getBuffer(path: string): AudioBuffer | null {
  return buffers.get(path) ?? null;
}

export function sfxPath(name: SfxName): string {
  return `audio/sfx/${name}.mp3`;
}

/** Começa a baixar todos os efeitos. Chamado ao destravar o áudio. */
export function preloadSfx(ctx: BaseAudioContext): Promise<void> {
  return Promise.all([
    ...SFX_FILES.map((n) => loadBuffer(ctx, sfxPath(n))),
    ...ENGINE_LOOPS.map((n) => loadBuffer(ctx, `audio/motor/${n}.mp3`, false)),
  ]).then(() => undefined);
}

export function sfxBuffer(name: SfxName): AudioBuffer | null {
  return getBuffer(sfxPath(name));
}

/** Toca um buffer: volume, velocidade (afinação), trecho e início. */
export function playBuffer(
  ctx: BaseAudioContext,
  buf: AudioBuffer,
  out: AudioNode,
  o: { vol?: number; rate?: number; offset?: number; duration?: number; t?: number; fadeOut?: number } = {},
): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = o.rate ?? 1;
  const g = ctx.createGain();
  const t = o.t ?? ctx.currentTime;
  g.gain.value = o.vol ?? 1;
  if (o.duration && o.fadeOut) {
    g.gain.setValueAtTime(o.vol ?? 1, t + Math.max(0, o.duration - o.fadeOut));
    g.gain.linearRampToValueAtTime(0.0001, t + o.duration);
  }
  s.connect(g);
  g.connect(out);
  if (o.duration) s.start(t, o.offset ?? 0, o.duration);
  else s.start(t, o.offset ?? 0);
  return s;
}
