/**
 * AudioContext compartilhado — só pode ser criado/retomado após um gesto do usuário.
 *
 * Mixagem:
 *   motor   (engineBus) ─► duck de impacto ─────────────┐
 *   locutor (voiceBus) ─────────────────────────────────┼─► cama ─► cola ─┐
 *   música  (musicBus) ─► duck do locutor ─► duck de impacto ┘             ├─► pré-limitador ─► limitador ─► soft clip ─► master
 *   efeitos (sfxBus) ───────────────────────────────────────────────────┘
 * Os efeitos NÃO passam pelo compressor de cola: se passassem, cada explosão abaixaria a própria
 * mixagem e o impacto sumiria. A "cama" (música, motor, locutor) fica bem abaixo do limitador e
 * ainda abaixa por um instante (ducking) a cada tiro, batida e explosão, para eles saltarem
 * (meta: +4 dB na janela de 150 ms). O pré-limitador deixa folga; o soft clip é só rede de segurança.
 */
import { preloadSfx } from './samples';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let engineBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let voiceBus: GainNode | null = null;
let musicDuck: GainNode | null = null;
let impactDuck: GainNode | null = null;
let engineDuck: GainNode | null = null;
let muted = false;
let sfxOn = true;

/** Nível fixo da música na mixagem (o volume do jogador multiplica isto). */
const MUSIC_TRIM = 0.3;
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
  // limitador: segura os picos em ~-2 dBFS (o soft clip acima de -0,9 dBFS quase nunca atua)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  // compressor de "cola" só para a cama (música, motor, locutor): junta sem esmagar
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -10;
  glue.knee.value = 8;
  glue.ratio.value = 3;
  glue.attack.value = 0.004;
  glue.release.value = 0.18;
  const bed = ctx.createGain();
  // corta o infrassom antes do compressor: não se ouve e só faria a mixagem "bombear"
  const rumbleCut = ctx.createBiquadFilter();
  rumbleCut.type = 'highpass';
  rumbleCut.frequency.value = 30;
  rumbleCut.Q.value = 0.7;
  bed.connect(rumbleCut);
  rumbleCut.connect(glue);
  // pré-limitador: ~1 dB de folga (volume geral agradável), o limitador só segura picos raros
  const preLimit = ctx.createGain();
  preLimit.gain.value = 0.89;
  glue.connect(preLimit);
  preLimit.connect(limiter);
  // soft clip final: rede de segurança (linear até 0,9)
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(new ArrayBuffer(2048 * 4));
  const knee = 0.9;
  for (let i = 0; i < 2048; i++) {
    const x = (i / 2047) * 2 - 1;
    const ax = Math.abs(x);
    curve[i] = ax < knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((ax - knee) / (1 - knee)));
  }
  clip.curve = curve;
  // o compressor do navegador aplica ganho de compensação automático (~+1,5 dB aqui): desconta
  const postLimit = ctx.createGain();
  postLimit.gain.value = 0.84;
  limiter.connect(postLimit);
  postLimit.connect(clip);
  clip.connect(master);
  master.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxOn ? SFX_TRIM : 0;
  const sfxCut = ctx.createBiquadFilter();
  sfxCut.type = 'highpass';
  sfxCut.frequency.value = 25;
  sfxCut.Q.value = 0.7;
  sfxBus.connect(sfxCut);
  sfxCut.connect(preLimit);
  engineDuck = ctx.createGain();
  engineDuck.connect(bed);
  engineBus = ctx.createGain();
  engineBus.gain.value = sfxOn ? ENGINE_TRIM : 0;
  engineBus.connect(engineDuck);
  impactDuck = ctx.createGain();
  impactDuck.connect(bed);
  musicDuck = ctx.createGain();
  musicDuck.gain.value = MUSIC_TRIM;
  musicDuck.connect(impactDuck);
  musicBus = ctx.createGain();
  musicBus.connect(musicDuck);
  voiceBus = ctx.createGain();
  voiceBus.gain.value = VOICE_TRIM;
  voiceBus.connect(bed);
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
 * Abaixa a música (e um pouco o motor) por um instante, para um efeito saltar na mixagem.
 * `amount` 0..1 = quanto abaixa; volta ao normal em `recover` segundos. Usa um ganho próprio,
 * separado do ducking do locutor, para um tiro não cancelar a fala abaixando a música.
 */
export function duck(amount: number, recover = 0.8): void {
  if (!ctx || !impactDuck || !engineDuck) return;
  const t = ctx.currentTime;
  const k = Math.min(0.85, Math.max(0, amount));
  for (const [g, depth] of [[impactDuck.gain, k], [engineDuck.gain, k * 0.6]] as const) {
    const low = 1 - depth;
    const cur = g.value;
    if (cur < low - 0.02) continue; // já está mais abaixado por outro efeito
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(low, t + 0.012);
    g.setTargetAtTime(1, t + 0.1, recover / 3);
  }
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
