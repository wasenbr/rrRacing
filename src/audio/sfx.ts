import { audio } from './context';

/** Efeitos sonoros sintetizados. `vol` já vem atenuado pela distância até o jogador. */
let noiseBuf: AudioBuffer | null = null;

function noise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function env(ctx: AudioContext, out: AudioNode, vol: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

export function sfxLaser(vol = 1): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx, out } = a;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(1800, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.18);
  o.connect(env(ctx, out, 0.12 * vol, 0.005, 0.2));
  o.start();
  o.stop(ctx.currentTime + 0.25);
}

export function sfxMissile(vol = 1): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx, out } = a;
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(600, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.5);
  src.connect(f);
  f.connect(env(ctx, out, 0.35 * vol, 0.02, 0.6));
  src.start();
  src.stop(ctx.currentTime + 0.7);
}

export function sfxExplosion(vol = 1, big = true): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx, out } = a;
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(big ? 1600 : 2400, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + (big ? 1.2 : 0.4));
  src.connect(f);
  f.connect(env(ctx, out, (big ? 0.9 : 0.4) * vol, 0.005, big ? 1.3 : 0.45));
  src.start();
  src.stop(ctx.currentTime + 1.5);
  // "soco" grave
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(big ? 90 : 140, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.4);
  o.connect(env(ctx, out, 0.6 * vol, 0.005, 0.45));
  o.start();
  o.stop(ctx.currentTime + 0.5);
}

export function sfxHit(vol = 1): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx, out } = a;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(320, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.15);
  o.connect(env(ctx, out, 0.3 * vol, 0.003, 0.18));
  o.start();
  o.stop(ctx.currentTime + 0.2);
}

export function sfxDrop(vol = 1): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx, out } = a;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.12);
  o.connect(env(ctx, out, 0.35 * vol, 0.003, 0.15));
  o.start();
  o.stop(ctx.currentTime + 0.2);
}

export function sfxPickup(kind: 'money' | 'armor'): void {
  const a = audio();
  if (!a) return;
  const { ctx, out } = a;
  const notes = kind === 'money' ? [988, 1319] : [523, 659, 784];
  notes.forEach((freq, i) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + i * 0.07;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.14);
  });
}

export function sfxBump(vol = 1): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx, out } = a;
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 500;
  src.connect(f);
  f.connect(env(ctx, out, 0.3 * vol, 0.003, 0.12));
  src.start();
  src.stop(ctx.currentTime + 0.15);
}
