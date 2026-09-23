import { audio, duck, type AudioOut } from './context';
import { playBuffer, sfxBuffer, type SfxName } from './samples';

/**
 * Efeitos sonoros: amostras CC0 (public/audio/sfx, ver public/audio/CREDITOS.md) em camadas com
 * síntese. Sem as amostras (ainda carregando ou offline), cada efeito toca só a parte sintetizada.
 * `vol` já vem atenuado pela distância até o jogador; `pan` (-1 esquerda .. +1 direita) vem da
 * posição do som na tela. Cada disparo tem uma leve variação de afinação para não soar repetido.
 */
let noiseBuf: AudioBuffer | null = null;

function noise(ctx: BaseAudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Variação aleatória de afinação (±k). */
const vary = (k = 0.06) => 1 + (Math.random() * 2 - 1) * k;

/** Saída de um efeito: ganho → pan estéreo → barramento de efeitos. */
function voice(a: AudioOut, vol: number, pan: number): GainNode {
  const g = a.ctx.createGain();
  g.gain.value = vol;
  const p = a.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p);
  p.connect(a.out);
  return g;
}

/** Envelope percussivo (ataque exponencial curto, queda exponencial). */
function env(ctx: BaseAudioContext, out: AudioNode, peak: number, attack: number, decay: number, t = ctx.currentTime): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, f0: number, f1: number, dur: number, out: AudioNode, t = ctx.currentTime): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function noiseSrc(ctx: BaseAudioContext, out: AudioNode, dur: number, t = ctx.currentTime, rate = 1): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  s.playbackRate.value = rate;
  s.connect(out);
  s.start(t, Math.random() * 1.2);
  s.stop(t + dur + 0.05);
  return s;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q: number, out: AudioNode): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  b.connect(out);
  return b;
}

/** Ressonâncias inarmônicas de metal (chapa, lataria). */
function metalRing(ctx: BaseAudioContext, out: AudioNode, base: number, peak: number, decay: number, t = ctx.currentTime): void {
  const ratios = [1, 2.76, 5.4, 8.93];
  ratios.forEach((r, i) => {
    const g = env(ctx, out, peak / (i + 1.2), 0.002, decay / (1 + i * 0.5), t);
    osc(ctx, i === 0 ? 'triangle' : 'sine', base * r, base * r * 0.985, decay, g, t);
  });
}

/** Saturação leve para "sujar" camadas sintéticas (soa menos videogame de 8 bits). */
function dirt(ctx: BaseAudioContext, out: AudioNode, amount = 2.5): WaveShaperNode {
  const w = ctx.createWaveShaper();
  const c = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const x = (i / 511) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  w.curve = c;
  w.connect(out);
  return w;
}

type SampleOpts = { vol?: number; rate?: number; offset?: number; duration?: number; t?: number; fadeOut?: number };

/** Toca uma amostra (sorteia se vier uma lista). Retorna false se ainda não estiver carregada. */
function sample(a: AudioOut, out: AudioNode, name: SfxName | SfxName[], o: SampleOpts = {}): boolean {
  const n = Array.isArray(name) ? name[Math.floor(Math.random() * name.length)] : name;
  const buf = sfxBuffer(n);
  if (!buf) return false;
  playBuffer(a.ctx, buf, out, o);
  return true;
}

/* ------------------------------------------------------------------ */
/* Armas                                                                */
/* ------------------------------------------------------------------ */

/** VK Plasma Rifle: disparo de plasma grosso (amostra) + estalo e soco grave. */
export function sfxLaser(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol, pan);
  const p = vary(0.07);
  const has = sample(a, out, ['plasma_a', 'plasma_b', 'plasma_c'], { vol: 0.95, rate: 0.82 * p });
  if (!has) {
    const bp = filter(ctx, 'bandpass', 1500 * p, 0.9, env(ctx, dirt(ctx, out), 0.9, 0.003, 0.22));
    osc(ctx, 'sawtooth', 1900 * p, 180 * p, 0.22, bp);
    osc(ctx, 'square', 1780 * p, 170 * p, 0.22, bp);
  }
  // ataque grave (soco + camada suja) e estalo do disparo: dão peso à amostra
  sample(a, out, 'batida_soco', { vol: 0.55, rate: 1.5 * p });
  osc(ctx, 'sine', 180 * p, 55, 0.16, env(ctx, dirt(ctx, out, 3), 0.9, 0.002, 0.16));
  noiseSrc(ctx, filter(ctx, 'highpass', 4500, 0.7, env(ctx, out, 0.3, 0.001, 0.04)), 0.05);
  // cauda de plasma crepitando (~250 ms), caindo de agudo para médio
  const t = ctx.currentTime;
  const tail = ctx.createBiquadFilter();
  tail.type = 'bandpass';
  tail.Q.value = 2.5;
  tail.frequency.setValueAtTime(2600 * p, t);
  tail.frequency.exponentialRampToValueAtTime(700 * p, t + 0.26);
  tail.connect(env(ctx, out, 0.35, 0.01, 0.25));
  noiseSrc(ctx, tail, 0.3);
}

/** Rogue Missile: estouro do lançamento + foguete rasgando o ar. */
export function sfxMissile(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol, pan);
  const p = vary(0.06);
  const t = ctx.currentTime;
  // estouro do tubo: soco + ruído curto saturado
  osc(ctx, 'sine', 120 * p, 40, 0.2, env(ctx, out, 1.1, 0.002, 0.22));
  noiseSrc(ctx, filter(ctx, 'lowpass', 2500, 0.7, env(ctx, dirt(ctx, out, 3), 0.8, 0.001, 0.1)), 0.12);
  // foguete: ronco + jato
  const rocket = sample(a, out, 'missil_lancamento', { vol: 0.9, rate: 1.25 * p, duration: 1.2, fadeOut: 0.5 });
  sample(a, out, 'jato', { vol: 0.55, rate: 1.3 * p, duration: 0.8, fadeOut: 0.4 });
  if (!rocket) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500 * p, t);
    f.frequency.exponentialRampToValueAtTime(2800 * p, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    f.connect(g);
    g.connect(out);
    noiseSrc(ctx, f, 1.15);
  }
}

/** Sundog Beam: esfera de energia teleguiada (zumbido pulsante subindo). */
export function sfxSundog(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol, pan);
  const p = vary(0.06);
  const t = ctx.currentTime;
  sample(a, out, 'sundog', { vol: 0.9, rate: 1.35 * p, duration: 0.7, fadeOut: 0.3 });
  const o = osc(ctx, 'sawtooth', 220 * p, 880 * p, 0.45, filter(ctx, 'lowpass', 2400, 4, env(ctx, dirt(ctx, out), 0.45, 0.01, 0.45)));
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 28;
  const depth = ctx.createGain();
  depth.gain.value = 60;
  lfo.connect(depth);
  depth.connect(o.frequency);
  lfo.start(t);
  lfo.stop(t + 0.5);
  osc(ctx, 'sine', 150 * p, 60, 0.12, env(ctx, out, 0.7, 0.002, 0.12));
}

/** Disparo frontal conforme a arma do carro. */
export function sfxFire(kind: string, vol = 1, pan = 0): void {
  if (kind === 'missile') sfxMissile(vol, pan);
  else if (kind === 'sundog') sfxSundog(vol, pan);
  else sfxLaser(vol, pan);
}

export function sfxExplosion(vol = 1, big = true, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol, pan);
  const t = ctx.currentTime;
  const p = vary(0.08);
  const len = big ? 2.2 : 0.8;
  // camadas de amostra: estouro "crunch", sub-grave e (na grande) cauda longa
  const crunch = big
    ? sample(a, out, ['explosao_crunch_a', 'explosao_crunch_b'], { vol: 1, rate: 0.9 * p })
    : sample(a, out, ['explosao_curta_a', 'explosao_curta_b'], { vol: 0.9, rate: 1.05 * p });
  sample(a, out, 'explosao_sub', { vol: big ? 1 : 0.55, rate: big ? 0.9 : 1.2, duration: big ? 2 : 0.8, fadeOut: 0.4 });
  if (big) sample(a, out, 'explosao_cauda', { vol: 0.6, rate: 0.85 * p, t: t + 0.05 });
  // corpo sintético: ruído com passa-baixa fechando (mais baixo quando há amostra)
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.9;
  lp.frequency.setValueAtTime(big ? 3200 : 3800, t);
  lp.frequency.exponentialRampToValueAtTime(big ? 120 : 220, t + len * 0.8);
  lp.connect(env(ctx, dirt(ctx, out, 2), (big ? 1 : 0.7) * (crunch ? 0.45 : 1), 0.004, len));
  noiseSrc(ctx, lp, len + 0.1, t, 0.7);
  // soco grave
  osc(ctx, 'sine', (big ? 85 : 140) * p, 28, big ? 0.7 : 0.3, env(ctx, out, big ? 1.1 : 0.7, 0.003, big ? 0.8 : 0.35));
  // detritos metálicos caindo
  const debris = big ? 6 : 2;
  for (let i = 0; i < debris; i++) {
    const tt = t + 0.15 + Math.random() * len * 0.6;
    if (!sample(a, out, ['impacto_metal_a', 'impacto_metal_b'], { vol: 0.12 + Math.random() * 0.15, rate: 0.8 + Math.random() * 0.8, t: tt })) {
      noiseSrc(ctx, filter(ctx, 'highpass', 2000 + Math.random() * 3000, 0.8, env(ctx, out, 0.2, 0.001, 0.05, tt)), 0.1, tt);
    }
  }
  if (big) duck(0.65, 1.6);
  else duck(0.3, 0.6);
}

/** Tiro acertando o carro: pancada metálica pesada. */
export function sfxHit(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol * 4.8, pan);
  const p = vary(0.12);
  const has = sample(a, out, ['impacto_metal_a', 'impacto_metal_b', 'impacto_placa'], { vol: 1, rate: 0.85 * p });
  sample(a, out, 'batida_grave', { vol: 0.7, rate: 0.8 * p }); // corpo grave do impacto
  if (!has) metalRing(ctx, out, 430 * p, 0.55, 0.35);
  noiseSrc(ctx, filter(ctx, 'bandpass', 2500 * p, 0.8, env(ctx, out, 0.6, 0.001, 0.06)), 0.08);
  osc(ctx, 'sine', 170 * p, 55, 0.12, env(ctx, out, 0.8, 0.002, 0.12));
}

/** Arma traseira: mina (Bear Claw), leque de minas (KO Scatterpack) ou óleo (BF's Slipsauce). */
export function sfxDrop(vol = 1, kind: string = 'mine', pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol * 2, pan);
  const t = ctx.currentTime;
  sample(a, out, 'batida_grave', { vol: 0.5, rate: 0.8 * vary(0.1) }); // baque da carga caindo
  if (kind === 'oil') {
    if (!sample(a, out, 'oleo', { vol: 1, rate: 0.75 * vary(0.1) })) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(900, t);
      for (let i = 1; i <= 6; i++) bp.frequency.setValueAtTime(350 + Math.random() * 900, t + i * 0.04);
      bp.connect(env(ctx, out, 1.6, 0.005, 0.32));
      noiseSrc(ctx, bp, 0.4);
    }
    // lata esguichando (glub grave)
    osc(ctx, 'sine', 300, 70, 0.22, env(ctx, out, 0.5, 0.004, 0.22));
    return;
  }
  const scatter = kind === 'scatter';
  const drops = scatter ? [0, 0.07, 0.13] : [0];
  for (const dt of drops) {
    const r = vary(0.1) * (scatter ? 1.15 : 1);
    if (!sample(a, out, 'mina_clunk', { vol: 0.95, rate: r, t: t + dt })) metalRing(ctx, out, 620 * r, 0.3, 0.18, t + dt);
    osc(ctx, 'sine', 150 * r, 50, 0.14, env(ctx, out, 0.8, 0.002, 0.15, t + dt), t + dt);
  }
  // bipes de armar (sinal de perigo)
  const base = scatter ? 0.3 : 0.25;
  for (const dt of [base, base + 0.16]) osc(ctx, 'square', 1480, 1480, 0.05, filter(ctx, 'lowpass', 3500, 0.7, env(ctx, out, 0.18, 0.002, 0.05, t + dt)), t + dt);
}

/** Assistência: Lightning Nitros (jato de turbina) ou Locust Jump Jets (propulsores para cima). */
export function sfxAssist(kind: string, vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol, pan);
  const t = ctx.currentTime;
  if (kind === 'jump') {
    sample(a, out, 'jato', { vol: 1, rate: 0.9, duration: 0.9, fadeOut: 0.4 });
    osc(ctx, 'sawtooth', 110, 420, 0.35, filter(ctx, 'lowpass', 1600, 3, env(ctx, dirt(ctx, out), 0.35, 0.01, 0.35)));
    osc(ctx, 'sine', 110, 50, 0.12, env(ctx, out, 0.8, 0.002, 0.12));
    return;
  }
  sample(a, out, 'nitro', { vol: 0.85, rate: 1.1, duration: 1.6, fadeOut: 0.6 });
  // "whoosh" subindo + estalo de ignição
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
  f.connect(env(ctx, out, 0.6, 0.02, 0.7));
  noiseSrc(ctx, f, 0.8);
  osc(ctx, 'sine', 90, 45, 0.15, env(ctx, out, 0.8, 0.002, 0.15));
}

/* ------------------------------------------------------------------ */
/* Pista                                                                */
/* ------------------------------------------------------------------ */

export function sfxPickup(kind: 'money' | 'armor', vol = 1, pan = 0): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  const out = voice(a, vol * 0.9, pan);
  const t0 = ctx.currentTime;
  if (kind === 'money') {
    // caixa registradora: "ka" metálico + sino "ching" com parciais inarmônicos
    sample(a, out, 'impacto_placa', { vol: 0.35, rate: 1.8 });
    noiseSrc(ctx, filter(ctx, 'highpass', 3000, 0.7, env(ctx, out, 0.35, 0.001, 0.05)), 0.06);
    const t = t0 + 0.06;
    [2093, 2637, 3136, 4186].forEach((f, i) => {
      osc(ctx, 'sine', f, f, 0.6, env(ctx, out, 0.22 / (1 + i * 0.4), 0.002, 0.55 - i * 0.08, t), t);
    });
    metalRing(ctx, out, 1568, 0.12, 0.5, t);
  } else {
    // blindagem: placa sendo aparafusada + zumbido de energia subindo
    sample(a, out, 'impacto_metal_b', { vol: 0.7, rate: 0.9 });
    sample(a, out, 'impacto_metal_a', { vol: 0.5, rate: 1.1, t: t0 + 0.12 });
    osc(ctx, 'sawtooth', 180, 720, 0.4, filter(ctx, 'lowpass', 2200, 3, env(ctx, dirt(ctx, out), 0.3, 0.02, 0.4)));
    osc(ctx, 'sine', 360, 1440, 0.4, env(ctx, out, 0.2, 0.02, 0.4));
  }
}

/** Batida carro com carro: lataria amassando. */
export function sfxBump(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 1.2, pan);
  const p = vary(0.15);
  const has = sample(a, out, 'batida_soco', { vol: 1, rate: 0.8 * p });
  sample(a, out, 'batida_grave', { vol: 0.8, rate: 1.1 * p });
  if (!has) {
    noiseSrc(ctx, filter(ctx, 'lowpass', 1400 * p, 0.8, env(ctx, out, 0.9, 0.002, 0.14)), 0.18, ctx.currentTime, 0.8);
    metalRing(ctx, out, 240 * p, 0.45, 0.28);
  }
  osc(ctx, 'sine', 100 * p, 42, 0.12, env(ctx, out, 0.8, 0.002, 0.13));
}

/** Batida na mureta (raspão metálico). */
export function sfxWall(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 2.4, pan);
  const p = vary(0.15);
  const has = sample(a, out, 'mureta', { vol: 1, rate: 0.85 * p });
  sample(a, out, 'batida_grave', { vol: 0.6, rate: 0.8 * p });
  noiseSrc(ctx, filter(ctx, 'bandpass', 900 * p, 0.6, env(ctx, out, has ? 0.5 : 0.9, 0.002, 0.22)), 0.26);
  osc(ctx, 'sine', 90 * p, 40, 0.15, env(ctx, out, 0.7, 0.002, 0.15));
  if (!has) metalRing(ctx, out, 310 * p, 0.3, 0.25);
}

/** Pouso de um salto: baque surdo da suspensão. */
export function sfxLand(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 1.3, pan);
  sample(a, out, 'batida_grave', { vol: 0.9, rate: 0.7 * vary(0.1) });
  osc(ctx, 'sine', 95 * vary(0.1), 38, 0.2, env(ctx, out, 1, 0.003, 0.22));
  noiseSrc(ctx, filter(ctx, 'lowpass', 500, 0.7, env(ctx, out, 0.6, 0.003, 0.12)), 0.15);
  osc(ctx, 'sawtooth', 260, 180, 0.18, filter(ctx, 'bandpass', 700, 6, env(ctx, out, 0.12, 0.02, 0.16)));
}

/** Carro caindo da pista: assobio descendo e baque distante. */
export function sfxFall(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol, pan);
  const t = ctx.currentTime;
  osc(ctx, 'sine', 1400, 250, 1.1, env(ctx, out, 0.25, 0.05, 1.05));
  sample(a, out, 'explosao_curta_b', { vol: 0.5, rate: 0.7, t: t + 1.1 });
}

/** Rodada no óleo: pneus cantando. */
export function sfxSkid(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 1.6, pan);
  const t = ctx.currentTime;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 9;
  bp.frequency.setValueAtTime(1500, t);
  bp.frequency.linearRampToValueAtTime(1100, t + 0.9);
  bp.connect(env(ctx, out, 0.9, 0.03, 0.9));
  noiseSrc(ctx, bp, 1);
  const o = osc(ctx, 'triangle', 1250, 950, 0.9, env(ctx, out, 0.12, 0.03, 0.85));
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 23;
  const depth = ctx.createGain();
  depth.gain.value = 40;
  lfo.connect(depth);
  depth.connect(o.frequency);
  lfo.start(t);
  lfo.stop(t + 1);
}

/* ------------------------------------------------------------------ */
/* Interface                                                            */
/* ------------------------------------------------------------------ */

/** Bipe da contagem regressiva (grave em 3-2-1, agudo e longo no "VAI!"), como semáforo de largada. */
export function sfxCountdown(go: boolean): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  const out = voice(a, go ? 1.6 : 3.2, 0);
  const f = go ? 1320 : 660;
  const dur = go ? 0.6 : 0.2;
  const g = env(ctx, out, 0.4, 0.003, dur);
  osc(ctx, 'sawtooth', f, f, dur, filter(ctx, 'lowpass', 3200, 0.7, g));
  osc(ctx, 'sine', f * 1.005, f * 1.005, dur, g);
  if (go) {
    osc(ctx, 'sawtooth', f / 2, f / 2, dur, filter(ctx, 'lowpass', 2500, 0.7, env(ctx, out, 0.25, 0.003, dur)));
    osc(ctx, 'sine', 70, 40, 0.3, env(ctx, out, 0.7, 0.003, 0.3));
  }
}

/** Nova volta: acorde curto de guitarra sintética (quinta com oitava). */
export function sfxLap(final: boolean): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  const out = voice(a, 0.8, 0);
  const t = ctx.currentTime;
  const root = final ? 330 : 294;
  const g = env(ctx, dirt(ctx, out, 4), 0.35, 0.004, final ? 0.9 : 0.45, t);
  const lp = filter(ctx, 'lowpass', 2800, 0.8, g);
  for (const m of [1, 1.5, 2]) osc(ctx, 'sawtooth', root * m, root * m, final ? 0.9 : 0.45, lp, t);
}

/** Queimando na lava: fogo rugindo (ruído grave-médio pulsando) com estalos de brasa. */
export function sfxBurn(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 1.4, pan);
  const t = ctx.currentTime;
  // rugido: banda 300 Hz–3 kHz com tremor lento (chamas)
  const roar = env(ctx, out, 0.7, 0.03, 0.45);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 9 + Math.random() * 5;
  const depth = ctx.createGain();
  depth.gain.value = 0.25;
  lfo.connect(depth);
  depth.connect(roar.gain);
  lfo.start(t);
  lfo.stop(t + 0.55);
  noiseSrc(ctx, filter(ctx, 'lowpass', 3000, 0.6, filter(ctx, 'highpass', 300, 0.6, roar)), 0.5);
  osc(ctx, 'sine', 90, 60, 0.4, env(ctx, out, 0.35, 0.02, 0.38));
  // estalos de brasa
  for (let i = 0; i < 7; i++) {
    const tt = t + Math.random() * 0.4;
    noiseSrc(ctx, filter(ctx, 'bandpass', 600 + Math.random() * 2200, 3, env(ctx, out, 0.5, 0.001, 0.015, tt)), 0.03, tt);
  }
}
