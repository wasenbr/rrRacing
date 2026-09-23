/**
 * AudioContext compartilhado — só pode ser criado/retomado após um gesto do usuário.
 * Mixagem: efeitos (sfx) e música têm volumes próprios e passam por um volume geral (master).
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let muted = false;
let sfxOn = true;

export function audio(): { ctx: AudioContext; out: GainNode; music: GainNode } | null {
  return ctx && sfxBus && musicBus ? { ctx, out: sfxBus, music: musicBus } : null;
}

export function unlockAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxOn ? 1 : 0;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.connect(master);
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
  if (ctx && sfxBus) sfxBus.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05);
}
