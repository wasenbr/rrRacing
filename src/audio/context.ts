/**
 * AudioContext compartilhado — só pode ser criado/retomado após um gesto do usuário.
 *
 * Mixagem:
 *   efeitos (sfxBus) ─────────────┐
 *   motor   (engineBus) ──────────┤
 *   locutor (voiceBus) ───────────┼─► mixBus ─► compressor ("cola") ─► limitador ─► master ─► saída
 *   música  (musicBus) ─► duck ───┘
 * A música fica uns 8 dB abaixo dos efeitos e ainda abaixa um pouco (ducking) em explosões,
 * para os tiros e batidas aparecerem, e enquanto o locutor fala. O limitador no fim impede clipping.
 */
import { preloadSfx } from './samples';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let engineBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let voiceBus: GainNode | null = null;
let musicDuck: GainNode | null = null;
let muted = false;
let sfxOn = true;

/** Nível fixo da música na mixagem (o volume do jogador multiplica isto). */
const MUSIC_TRIM = 0.42;
const SFX_TRIM = 1;
const ENGINE_TRIM = 0.22;
const VOICE_TRIM = 1.1;

export interface AudioOut {
  ctx: AudioContext;
  /** efeitos sonoros */
  out: GainNode;
  /** motor e pneus */
  engine: GainNode;
  /** música */
  music: GainNode;
  /** locutor */
  voice: GainNode;
}

export function audio(): AudioOut | null {
  return ctx && sfxBus && musicBus && engineBus && voiceBus ? { ctx, out: sfxBus, engine: engineBus, music: musicBus, voice: voiceBus } : null;
}

function buildGraph(c: BaseAudioContext): void {
  ctx = c as AudioContext;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  // limitador: segura os picos em ~-1 dBFS
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  // compressor de "cola": junta tudo e dá pressão
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 8;
  glue.ratio.value = 3;
  glue.attack.value = 0.004;
  glue.release.value = 0.18;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.5;
  const mix = ctx.createGain();
  // corta o infrassom antes do compressor: não se ouve e só faria a mixagem "bombear"
  const rumbleCut = ctx.createBiquadFilter();
  rumbleCut.type = 'highpass';
  rumbleCut.frequency.value = 30;
  rumbleCut.Q.value = 0.7;
  mix.connect(rumbleCut);
  rumbleCut.connect(glue);
  glue.connect(makeup);
  makeup.connect(limiter);
  // soft clip final: o compressor do navegador não é um limitador perfeito
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(new ArrayBuffer(2048 * 4));
  for (let i = 0; i < 2048; i++) {
    const x = (i / 2047) * 2 - 1;
    curve[i] = Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + 0.28 * Math.tanh((Math.abs(x) - 0.7) / 0.28));
  }
  clip.curve = curve;
  limiter.connect(clip);
  clip.connect(master);
  master.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxOn ? SFX_TRIM : 0;
  sfxBus.connect(mix);
  engineBus = ctx.createGain();
  engineBus.gain.value = sfxOn ? ENGINE_TRIM : 0;
  engineBus.connect(mix);
  musicDuck = ctx.createGain();
  musicDuck.gain.value = MUSIC_TRIM;
  musicDuck.connect(mix);
  musicBus = ctx.createGain();
  musicBus.connect(musicDuck);
  voiceBus = ctx.createGain();
  voiceBus.gain.value = VOICE_TRIM;
  voiceBus.connect(mix);
  void preloadSfx(ctx);
}

export function unlockAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  buildGraph(new AC());
}

/**
 * Abaixa a música por um instante (explosões, destruição do jogador).
 * `amount` 0..1 = quanto abaixa; volta ao normal em `recover` segundos.
 */
export function duck(amount: number, recover = 0.8): void {
  if (!ctx || !musicDuck) return;
  const t = ctx.currentTime;
  const g = musicDuck.gain;
  const low = MUSIC_TRIM * (1 - Math.min(0.85, Math.max(0, amount)));
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.min(g.value, MUSIC_TRIM), t);
  g.linearRampToValueAtTime(low, t + 0.03);
  g.setTargetAtTime(MUSIC_TRIM, t + 0.12, recover / 3);
}

/** Abaixa a música enquanto o locutor fala (`seconds` de fala). */
export function duckFor(amount: number, seconds: number): void {
  if (!ctx || !musicDuck) return;
  const t = ctx.currentTime;
  const g = musicDuck.gain;
  const low = MUSIC_TRIM * (1 - Math.min(0.85, Math.max(0, amount)));
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(low, t + 0.06);
  g.setValueAtTime(low, t + seconds);
  g.setTargetAtTime(MUSIC_TRIM, t + seconds, 0.25);
}

export function toggleMute(): boolean {
  muted = !muted;
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  if (muted) window.speechSynthesis?.cancel();
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

export function setSfxEnabled(on: boolean): void {
  sfxOn = on;
  if (ctx && sfxBus && engineBus) {
    sfxBus.gain.setTargetAtTime(on ? SFX_TRIM : 0, ctx.currentTime, 0.05);
    engineBus.gain.setTargetAtTime(on ? ENGINE_TRIM : 0, ctx.currentTime, 0.05);
  }
}

/**
 * Só para gravação offline (scripts/evidencias.mjs): passa a usar um contexto já criado,
 * por exemplo um OfflineAudioContext, para renderizar efeitos, motor e música em arquivo.
 */
export function useAudioContextForTest(c: BaseAudioContext): Promise<void> {
  buildGraph(c);
  return preloadSfx(c);
}
