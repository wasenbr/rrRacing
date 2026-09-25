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

/**
 * Saída de um efeito: ganho → passa-baixa de distância → pan estéreo → barramento de efeitos.
 * `near` (0..1, o volume já atenuado pela distância) fecha o passa-baixa de 18 kHz (colado no
 * jogador) até 1,5 kHz (longe): sons distantes ficam abafados, como no ar de verdade.
 */
function voice(a: AudioOut, vol: number, pan: number, near = 1, thin = 0): GainNode {
  const g = a.ctx.createGain();
  g.gain.value = vol;
  const p = a.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  const n = Math.max(0, Math.min(1, near));
  // `thin` (dB, negativo): prateleira abaixo de 140 Hz. Nas batidas o sub-grave das amostras comia a
  // folga do limitador e o estalo (o que se ouve no celular) ficava baixo (rodada 11)
  let head: AudioNode = p;
  if (thin < 0) {
    const ls = a.ctx.createBiquadFilter();
    ls.type = 'lowshelf';
    ls.frequency.value = 140;
    ls.gain.value = thin;
    ls.connect(p);
    head = ls;
  }
  if (n < 0.98) {
    const lp = a.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.value = 1500 * Math.pow(12, n);
    g.connect(lp);
    lp.connect(head);
  } else g.connect(head);
  p.connect(a.out);
  return g;
}

/**
 * Abaixa música e motor por um instante quando o efeito está perto (o impacto salta na mixagem).
 * Os efeitos grandes (explosão, míssil) também ganham um realce transitório de +1,5–3 dB.
 */
function punch(vol: number, amount: number, recover = 0.4): void {
  if (vol < 0.25) return;
  const v = Math.min(1, vol);
  duck(amount * v, recover, amount >= 0.6 ? 4 * v : amount >= 0.45 ? 3 * v : amount >= 0.3 ? 2 * v : 0);
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
const dirtCurves = new Map<number, Float32Array<ArrayBuffer>>();
function dirt(ctx: BaseAudioContext, out: AudioNode, amount = 2.5): WaveShaperNode {
  const w = ctx.createWaveShaper();
  let c = dirtCurves.get(amount);
  if (!c) {
    c = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = (i / 511) * 2 - 1;
      c[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    dirtCurves.set(amount, c);
  }
  w.curve = c;
  w.connect(out);
  return w;
}

/**
 * Soco sub-grave (50–70 Hz, ~150 ms): o "peso" de batidas, impactos e pousos, que as amostras
 * (gravadas com microfone perto de chapa) não têm. Senoide caindo levemente, saturada de leve para
 * o harmônico de 2ª ordem aparecer em caixas pequenas (celular).
 */
function subThump(ctx: BaseAudioContext, out: AudioNode, peak: number, t = ctx.currentTime, f = 64): void {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  g.gain.setValueAtTime(peak, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  g.connect(dirt(ctx, out, 1.6));
  osc(ctx, 'sine', f * vary(0.06), f * 0.78, 0.16, g, t);
}

/**
 * Estalo de lataria (1,5–6 kHz): é o que se ouve de uma batida em alto-falante de celular/notebook,
 * que não reproduz abaixo de ~150 Hz (rodada 11: os golpes tinham 77–94% da energia abaixo de
 * 120 Hz e sumiam). Ruído saturado em duas bandas + ressonância metálica aguda e curta.
 * Pré-gravado (synthLayer 'estalo'): as batidas são frequentes.
 */
function crackSynth(ctx: BaseAudioContext, out: AudioNode, t: number, p = 1): void {
  noiseSrc(ctx, filter(ctx, 'bandpass', 2600 * p, 0.7, env(ctx, dirt(ctx, out, 3), 0.9, 0.0008, 0.16, t)), 0.2, t);
  noiseSrc(ctx, filter(ctx, 'bandpass', 4800 * p, 0.9, env(ctx, out, 0.45, 0.0005, 0.06, t)), 0.1, t);
  metalRing(ctx, out, 1500 * p * vary(0.1), 0.5, 0.28, t);
}

/**
 * Passa-altas de 80 Hz para a parte grave de um golpe (soco, baque, amostra grave): o peso fica em
 * 80–200 Hz, que caixa pequena ainda reproduz, sem o sub-grave que comia a folga do limitador
 * (rodada 12: 45–61% da energia abaixo de 120 Hz em batidas, nitro e jump jets).
 */
function grave(ctx: BaseAudioContext, out: AudioNode): BiquadFilterNode {
  return filter(ctx, 'highpass', 80, 0.7, out);
}

/**
 * Transiente metálico de 1–4 kHz (~40 ms): o "clang" de chapa que faz o golpe atravessar o motor e a
 * música (rodada 12: mina e impacto ficavam ~+5 dB acima de 200 Hz, meta +6).
 */
function clank(ctx: BaseAudioContext, out: AudioNode, peak: number, p = 1, t = ctx.currentTime): void {
  noiseSrc(ctx, filter(ctx, 'bandpass', 1700 * p, 1.4, env(ctx, dirt(ctx, out, 2), peak, 0.0008, 0.045, t)), 0.06, t);
  noiseSrc(ctx, filter(ctx, 'bandpass', 3300 * p, 1.6, env(ctx, out, peak * 0.7, 0.0005, 0.03, t)), 0.05, t);
  metalRing(ctx, out, 1900 * p * vary(0.08), peak * 0.35, 0.09, t);
}

/** Estalo de lataria com volume próprio (`peak`) e afinação `p`. */
function crack(ctx: BaseAudioContext, out: AudioNode, peak: number, p = 1): void {
  const g = ctx.createGain();
  g.gain.value = peak;
  g.connect(out);
  synthLayer(ctx, g, 'estalo', 0.3, crackSynth, p);
}

type SampleOpts ={ vol?: number; rate?: number; offset?: number; duration?: number; t?: number; fadeOut?: number };

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

/**
 * VK Plasma Rifle: canhão de plasma sujo, não "pew" de ficção científica. A amostra de plasma toca
 * pouco abaixo do tom (~0,85x) e passa por distorção e passa-baixa em ~5 kHz; um estalo seco marca
 * o disparo e a cauda é crepitação (estalos de ruído aleatórios decaindo), sem tom que "canta".
 * Rodada 11: sem o soco sub-grave (150→50 Hz) e com a descarga uma oitava acima: em 0,6x a amostra
 * e o soco viravam um rosnado grave que sumia em alto-falante pequeno.
 */
export function sfxLaser(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol, pan, vol);
  const p = vary(0.07);
  punch(vol, 0.3, 0.25);
  // corpo: amostra grave → distorção → passa-baixa (tira o brilho de "pew")
  // passa-alta em 150 Hz: as amostras de plasma têm um ronco sub-grave que não é do disparo
  const body = filter(ctx, 'highpass', 150, 0.7, filter(ctx, 'lowpass', 5000, 0.6, out));
  const has = sample(a, dirt(ctx, body, 3.5), ['plasma_a', 'plasma_b', 'plasma_c'], { vol: 0.8, rate: (0.8 + Math.random() * 0.1) * p, duration: 0.15, fadeOut: 0.07 });
  if (!has) {
    const bp = filter(ctx, 'bandpass', 900 * p, 0.8, env(ctx, dirt(ctx, out, 3.5), 0.7, 0.003, 0.16));
    osc(ctx, 'sawtooth', 700 * p, 260 * p, 0.16, bp);
    osc(ctx, 'square', 660 * p, 240 * p, 0.16, bp);
  }
  sample(a, filter(ctx, 'highpass', 180, 0.7, out), 'batida_soco', { vol: 0.5, rate: 1.4 * p, duration: 0.12, fadeOut: 0.07 });
  // camadas sintéticas: pré-gravadas (os inimigos atiram muito; montar ~60 nós de áudio por tiro
  // custava ~3,5 ms e causava travadas e som picotado). Enquanto a gravação não fica pronta, ao vivo.
  synthLayer(ctx, out, 'plasma', 0.4, laserSynth, p);
}

/** Parte sintética do plasma: estalo seco, descarga descendente e crepitação (sem sub-grave). */
function laserSynth(ctx: BaseAudioContext, out: AudioNode, t: number, p = 1): void {
  // estalo do disparo: ruído curtíssimo saturado (o "crack" seco da descarga)
  noiseSrc(ctx, filter(ctx, 'bandpass', 3000, 0.8, env(ctx, dirt(ctx, out, 4), 1.1, 0.0005, 0.02, t)), 0.04, t);
  noiseSrc(ctx, filter(ctx, 'highpass', 5000, 0.7, env(ctx, out, 0.4, 0.0005, 0.012, t)), 0.02, t);
  // descarga: dente de serra varrendo de ~520 para ~140 Hz em 0,2 s, distorcida (desce sem virar
  // rosnado sub-grave nem "pew" agudo)
  const growlEnv = ctx.createGain();
  growlEnv.gain.setValueAtTime(0.0001, t);
  growlEnv.gain.exponentialRampToValueAtTime(0.8, t + 0.005);
  growlEnv.gain.setValueAtTime(0.8, t + 0.09);
  growlEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  growlEnv.connect(out);
  const growl = ctx.createBiquadFilter();
  growl.type = 'lowpass';
  growl.Q.value = 1.2;
  growl.frequency.setValueAtTime(3200, t);
  growl.frequency.exponentialRampToValueAtTime(700, t + 0.2);
  growl.connect(growlEnv);
  const gd = dirt(ctx, filter(ctx, 'highpass', 160, 0.7, growl), 6);
  osc(ctx, 'sawtooth', 520 * p, 140 * p, 0.2, gd, t);
  osc(ctx, 'square', 260 * p, 90 * p, 0.2, gd, t).detune.value = 12;
  // crepitação: estalos aleatórios cada vez mais fracos e mais graves (~130 ms), por cima do rosnado
  const n = 6 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const tt = t + 0.02 + k * 0.11 + Math.random() * 0.012;
    const f = (1800 - k * 1100) * (0.8 + Math.random() * 0.4);
    noiseSrc(ctx, filter(ctx, 'bandpass', f, 1.2, env(ctx, dirt(ctx, out, 3), (0.32 - k * 0.26) * (0.6 + Math.random() * 0.6), 0.0005, 0.008 + Math.random() * 0.012, tt)), 0.03, tt);
  }
}

/* Camadas sintéticas pré-gravadas (OfflineAudioContext): algumas variações sorteadas por disparo. */
type Synth = (ctx: BaseAudioContext, out: AudioNode, t: number, p?: number) => void;
const BAKE_VARIANTS = 4;
const bakes = new Map<string, AudioBuffer[]>();

/**
 * Toca uma camada sintética pré-gravada (variação de afinação `p` pela velocidade de reprodução).
 * Tiros, impactos e explosões são frequentes: montar dezenas de nós de áudio por disparo pesava na
 * thread principal (travadas) e na de áudio (som picotado). Até a gravação ficar pronta, toca ao vivo.
 */
function synthLayer(ctx: BaseAudioContext, out: AudioNode, name: string, len: number, synth: Synth, p: number): void {
  const list = bakes.get(name) ?? bake(name, len, synth);
  if (list.length) playBuffer(ctx, list[Math.floor(Math.random() * list.length)], out, { rate: p });
  else synth(ctx, out, ctx.currentTime, p);
}

function bake(name: string, len: number, synth: Synth): AudioBuffer[] {
  const done: AudioBuffer[] = [];
  const a = audio();
  if (!a || typeof OfflineAudioContext === 'undefined') return done;
  bakes.set(name, done);
  const rate = a.ctx.sampleRate;
  for (let i = 0; i < BAKE_VARIANTS; i++) {
    const off = new OfflineAudioContext(1, Math.ceil(len * rate), rate);
    synth(off, off.destination, 0);
    off.startRendering().then((b) => done.push(b), () => {});
  }
  return done;
}

/** Pré-grava as camadas sintéticas dos efeitos frequentes (chamar com o áudio já criado). */
export function prepareSfx(): void {
  const all: [string, number, Synth][] = [
    ['plasma', 0.4, laserSynth], ['missil', 0.3, missileSynth], ['sundog', 0.55, sundogSynth], ['impacto', 0.2, hitSynth], ['estalo', 0.3, crackSynth],
    ['explosao_g', 2.4, explosionBigSynth], ['explosao_p', 1, explosionSmallSynth],
  ];
  for (const [name, len, synth] of all) if (!bakes.has(name)) bake(name, len, synth);
}

/** Rogue Missile: estouro do lançamento + foguete rasgando o ar. */
export function sfxMissile(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol * 1.3, pan, vol);
  const p = vary(0.06);
  const t = ctx.currentTime;
  punch(vol, 0.45, 0.45);
  // estouro do tubo: soco + ruído curto saturado
  synthLayer(ctx, out, 'missil', 0.3, missileSynth, p);
  sample(a, out, 'batida_soco', { vol: 0.7, rate: 0.9 * p });
  // foguete: ronco + jato
  const rocket = sample(a, out, 'missil_lancamento', { vol: 0.7, rate: 1.25 * p, duration: 0.7, fadeOut: 0.45 });
  sample(a, out, 'jato', { vol: 0.35, rate: 1.3 * p, duration: 0.55, fadeOut: 0.35 });
  if (!rocket) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500 * p, t);
    f.frequency.exponentialRampToValueAtTime(2800 * p, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    f.connect(g);
    g.connect(out);
    noiseSrc(ctx, f, 1.15);
  }
}

function missileSynth(ctx: BaseAudioContext, out: AudioNode, t: number, p = 1): void {
  osc(ctx, 'sine', 120 * p, 40, 0.2, env(ctx, out, 1.3, 0.002, 0.22, t), t);
  noiseSrc(ctx, filter(ctx, 'lowpass', 3000, 0.7, env(ctx, dirt(ctx, out, 3), 1.2, 0.001, 0.12, t)), 0.14, t);
}

/** Sundog Beam: esfera de energia teleguiada (zumbido pulsante subindo). */
export function sfxSundog(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol, pan, vol);
  const p = vary(0.06);
  punch(vol, 0.25, 0.3);
  sample(a, out, 'sundog', { vol: 0.9, rate: 1.35 * p, duration: 0.7, fadeOut: 0.3 });
  synthLayer(ctx, out, 'sundog', 0.55, sundogSynth, p);
}

function sundogSynth(ctx: BaseAudioContext, out: AudioNode, t: number, p = 1): void {
  const o = osc(ctx, 'sawtooth', 220 * p, 880 * p, 0.45, filter(ctx, 'lowpass', 2400, 4, env(ctx, dirt(ctx, out), 0.45, 0.01, 0.45, t)), t);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 28;
  const depth = ctx.createGain();
  depth.gain.value = 60;
  lfo.connect(depth);
  depth.connect(o.frequency);
  lfo.start(t);
  lfo.stop(t + 0.5);
  osc(ctx, 'sine', 150 * p, 60, 0.12, env(ctx, out, 0.7, 0.002, 0.12, t), t);
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
  const out = voice(a, vol * (big ? 1.8 : 2.2), pan, vol, -6);
  const t = ctx.currentTime;
  const p = vary(0.08);
  const len = big ? 2.2 : 0.8;
  // camadas de amostra: estouro "crunch", sub-grave e (na grande) cauda longa
  const crunch = big
    ? sample(a, out, ['explosao_crunch_a', 'explosao_crunch_b'], { vol: 1, rate: 0.9 * p })
    : sample(a, out, ['explosao_curta_a', 'explosao_curta_b'], { vol: 0.9, rate: 1.05 * p });
  // estalo de ataque: a explosão chega de uma vez (sem ele a pequena demora a "abrir")
  sample(a, out, 'batida_soco', { vol: big ? 0.6 : 0.9, rate: 0.75 * p });
  // rodada 11: sub-grave mais baixo (dominava: 87% da energia abaixo de 120 Hz) e estalo de 1,5–6 kHz
  sample(a, out, 'explosao_sub', { vol: big ? 0.65 : 0.4, rate: big ? 0.9 : 1.2, duration: big ? 2 : 0.8, fadeOut: 0.4 });
  if (big) sample(a, out, 'explosao_cauda', { vol: 0.6, rate: 0.85 * p, t: t + 0.05 });
  if (big) rumbleTail(ctx, out, t, p);
  // corpo médio do estouro (a amostra "curta b" é quase toda 120–1500 Hz)
  if (big) sample(a, out, 'explosao_curta_b', { vol: 0.7, rate: 0.9 * p });
  crack(ctx, out, big ? 2 : 1.6, 0.9 * p);
  // estalo, corpo de ruído e soco grave (o corpo fica mais baixo quando há amostra)
  if (big) synthLayer(ctx, out, crunch ? 'explosao_g' : 'explosao_g_so', len + 0.2, crunch ? explosionBigSynth : explosionBigAlone, p);
  else synthLayer(ctx, out, crunch ? 'explosao_p' : 'explosao_p_so', len + 0.2, crunch ? explosionSmallSynth : explosionSmallAlone, p);
  // detritos metálicos caindo
  const debris = big ? 6 : 2;
  for (let i = 0; i < debris; i++) {
    const tt = t + 0.15 + Math.random() * len * 0.6;
    if (!sample(a, out, ['impacto_metal_a', 'impacto_metal_b'], { vol: 0.2 + Math.random() * 0.2, rate: 1 + Math.random() * 0.8, t: tt })) {
      noiseSrc(ctx, filter(ctx, 'highpass', 2000 + Math.random() * 3000, 0.8, env(ctx, out, 0.2, 0.001, 0.05, tt)), 0.1, tt);
    }
  }
  if (big) punch(vol, 0.85, 1.4);
  else punch(vol, 0.65, 0.5);
}

/**
 * Cauda da explosão grande (rodada 12: acabava seca em ~1 s): estrondo de ruído que entra logo depois
 * do estouro e decai em ~1,5 s com o passa-baixa descendo de ~1,8 kHz a ~120 Hz (o fogo "rolando"
 * e se afastando), mais a cauda gravada uma oitava abaixo pelo mesmo filtro.
 */
function rumbleTail(ctx: BaseAudioContext, out: AudioNode, t: number, p: number): void {
  const t0 = t + 0.18;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(1800 * p, t0);
  lp.frequency.exponentialRampToValueAtTime(160, t0 + 2.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(2.2, t0 + 0.3);
  g.gain.setTargetAtTime(0.0001, t0 + 0.7, 0.6);
  lp.connect(g);
  g.connect(filter(ctx, 'highpass', 60, 0.7, out));
  // ruído em loop (o buffer de 2 s a 0,5x acabava antes da cauda)
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  n.loop = true;
  n.playbackRate.value = 0.5;
  n.connect(lp);
  n.start(t0, Math.random() * 1.5);
  n.stop(t0 + 2.9);
  const s = sfxBuffer('explosao_cauda');
  if (s) playBuffer(ctx, s, lp, { vol: 0.5, rate: 0.5 * p, t: t0 + 0.1 });
}

function explosionSynth(ctx: BaseAudioContext, out: AudioNode, t: number, p: number, big: boolean, crunch: boolean): void {
  const len = big ? 2.2 : 0.8;
  noiseSrc(ctx, filter(ctx, 'lowpass', 5000, 0.7, env(ctx, dirt(ctx, out, 3), big ? 0.6 : 0.9, 0.001, 0.08, t)), 0.1, t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.9;
  lp.frequency.setValueAtTime(big ? 3200 : 3800, t);
  lp.frequency.exponentialRampToValueAtTime(big ? 120 : 220, t + len * 0.8);
  lp.connect(env(ctx, dirt(ctx, out, 2), (big ? 1 : 0.7) * (crunch ? 0.45 : 1), 0.004, len, t));
  noiseSrc(ctx, lp, len + 0.1, t, 0.7);
  osc(ctx, 'sine', (big ? 85 : 140) * p, 28, big ? 0.7 : 0.3, env(ctx, out, big ? 0.7 : 0.45, 0.003, big ? 0.8 : 0.35, t), t);
}
const explosionBigSynth: Synth = (c, o, t, p = 1) => explosionSynth(c, o, t, p, true, true);
const explosionBigAlone: Synth = (c, o, t, p = 1) => explosionSynth(c, o, t, p, true, false);
const explosionSmallSynth: Synth = (c, o, t, p = 1) => explosionSynth(c, o, t, p, false, true);
const explosionSmallAlone: Synth = (c, o, t, p = 1) => explosionSynth(c, o, t, p, false, false);

/** Tiro acertando o carro: pancada metálica pesada. */
export function sfxHit(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  const out = voice(a, vol * 7, pan, vol, -9);
  punch(vol, 0.45, 0.35);
  const p = vary(0.12);
  // metal +4 dB e mais agudo (rodada 11: 94% da energia abaixo de 120 Hz, sumia no celular)
  const has = sample(a, out, ['impacto_metal_a', 'impacto_metal_b', 'impacto_placa'], { vol: 1.6, rate: 1.05 * p });
  const low = grave(ctx, out);
  sample(a, low, 'batida_grave', { vol: 0.35, rate: 0.8 * p }); // corpo grave do impacto
  if (!has) metalRing(ctx, out, 430 * p, 0.55, 0.35);
  synthLayer(ctx, low, 'impacto', 0.2, hitSynth, p);
  crack(ctx, out, 0.9, 1.2 * p);
  clank(ctx, out, 0.5, p);
  subThump(ctx, low, 0.08);
}

function hitSynth(ctx: BaseAudioContext, out: AudioNode, t: number, p = 1): void {
  // estalo/metal de 1,5–6 kHz na frente; o soco grave fica por baixo
  noiseSrc(ctx, filter(ctx, 'bandpass', 2500 * p, 0.8, env(ctx, dirt(ctx, out, 2.5), 1, 0.001, 0.06, t)), 0.08, t);
  noiseSrc(ctx, filter(ctx, 'bandpass', 5000 * p, 1, env(ctx, out, 0.5, 0.0005, 0.03, t)), 0.05, t);
  metalRing(ctx, out, 1250 * p, 0.3, 0.16, t);
  osc(ctx, 'sine', 170 * p, 55, 0.12, env(ctx, out, 0.35, 0.002, 0.12, t), t);
}

/** Arma traseira: mina (Bear Claw), leque de minas (KO Scatterpack) ou óleo (BF's Slipsauce). */
export function sfxDrop(vol = 1, kind: string = 'mine', pan = 0): void {
  const a = audio();
  if (!a || vol < 0.02) return;
  const { ctx } = a;
  // subido na rodada 10 (mina RMS -27 dB): carga caindo tem que se ouvir no meio da corrida
  const out = voice(a, vol * (kind === 'oil' ? 3.4 : 5), pan, vol, -6);
  const t = ctx.currentTime;
  punch(vol, 0.4, 0.35);
  const low = grave(ctx, out);
  sample(a, low, 'batida_grave', { vol: 0.5, rate: 0.8 * vary(0.1) }); // baque da carga caindo
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
    osc(ctx, 'sine', 300, 70, 0.22, env(ctx, low, 0.5, 0.004, 0.22));
    return;
  }
  const scatter = kind === 'scatter';
  const drops = scatter ? [0, 0.07, 0.13] : [0];
  for (const dt of drops) {
    const r = vary(0.1) * (scatter ? 1.15 : 1);
    if (!sample(a, out, 'mina_clunk', { vol: 0.95, rate: r, t: t + dt })) metalRing(ctx, out, 620 * r, 0.3, 0.18, t + dt);
    crack(ctx, out, 1.9, 1.2 * r);
    clank(ctx, out, scatter ? 0.45 : 0.6, r, t + dt);
    osc(ctx, 'sine', 150 * r, 60, 0.14, env(ctx, low, scatter ? 0.3 : 0.4, 0.002, 0.15, t + dt), t + dt);
    subThump(ctx, low, scatter ? 0.12 : 0.18, t + dt, 62);
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
  // prateleira -6 dB abaixo de 140 Hz e passa-altas de 80 Hz nos baques (rodada 12: 52–62% da energia
  // abaixo de 120 Hz; o jato é sopro, não soco)
  const out = voice(a, vol * 1.3, pan, vol, -6);
  const low = grave(ctx, out);
  const t = ctx.currentTime;
  punch(vol, 0.3, 0.4);
  if (kind === 'jump') {
    sample(a, filter(ctx, 'highpass', 110, 0.6, out), 'jato', { vol: 1, rate: 0.9, duration: 0.9, fadeOut: 0.4 });
    osc(ctx, 'sawtooth', 110, 420, 0.35, filter(ctx, 'lowpass', 1600, 3, env(ctx, dirt(ctx, out), 0.35, 0.01, 0.35)));
    osc(ctx, 'sine', 140, 80, 0.12, env(ctx, low, 0.45, 0.002, 0.12));
    return;
  }
  // jato do nitro com os agudos cortados (sopro encorpado, não chiado)
  sample(a, filter(ctx, 'lowpass', 2200, 0.6, filter(ctx, 'highpass', 110, 0.6, out)), 'nitro', { vol: 1.1, rate: 0.9, duration: 1.6, fadeOut: 0.6 });
  // "whoosh" grave subindo (250 → 1100 Hz) + estalo de ignição
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1;
  f.frequency.setValueAtTime(250, t);
  f.frequency.exponentialRampToValueAtTime(1100, t + 0.5);
  f.connect(env(ctx, dirt(ctx, out, 2), 0.8, 0.03, 0.7));
  noiseSrc(ctx, f, 0.8);
  sample(a, low, 'batida_grave', { vol: 0.45, rate: 0.7 });
  osc(ctx, 'sine', 130, 80, 0.15, env(ctx, low, 0.5, 0.002, 0.15));
}

/* ------------------------------------------------------------------ */
/* Pista                                                                */
/* ------------------------------------------------------------------ */

export function sfxPickup(kind: 'money' | 'armor', vol = 1, pan = 0): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  // subidos na avaliação de som (estavam -28 e -33 dB RMS, somiam na mixagem)
  const out = voice(a, vol * (kind === 'money' ? 2.7 : 3.4), pan);
  const t0 = ctx.currentTime;
  if (kind === 'money') {
    // caixa registradora: "ka" metálico + sino "ching" com parciais inarmônicos
    sample(a, out, 'impacto_placa', { vol: 0.2, rate: 1.8 });
    noiseSrc(ctx, filter(ctx, 'highpass', 3000, 0.7, env(ctx, out, 0.25, 0.001, 0.05)), 0.06);
    const t = t0 + 0.06;
    // sino "ching" sujo: parciais inarmônicos com leve saturação (não soa senoide de videogame)
    const bell = dirt(ctx, filter(ctx, 'lowpass', 7000, 0.7, out), 2.2);
    [1568, 2093, 2637, 3321, 4186].forEach((f, i) => {
      const o = osc(ctx, i % 2 ? 'triangle' : 'sine', f, f * 0.997, 0.85, env(ctx, bell, 0.3 / (1 + i * 0.35), 0.002, 0.8 - i * 0.1, t), t);
      o.detune.value = (Math.random() * 2 - 1) * 12;
    });
    metalRing(ctx, out, 1175, 0.14, 0.4, t);
    // moedas caindo na gaveta
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.05 + i * 0.045 + Math.random() * 0.02;
      sample(a, out, 'impacto_metal_a', { vol: 0.12, rate: 2.2 + Math.random() * 0.6, t: tt });
    }
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
  const out = voice(a, vol * 3.2, pan, 1, -9);
  const p = vary(0.15);
  punch(vol, 0.55, 0.4);
  const low = grave(ctx, out);
  const has = sample(a, low, 'batida_soco', { vol: 1, rate: 0.8 * p });
  sample(a, low, 'batida_grave', { vol: 0.45, rate: 1.1 * p });
  // lataria amassando: metal e estalo de 1,5–6 kHz (o que se ouve em alto-falante pequeno)
  sample(a, out, ['impacto_metal_a', 'impacto_metal_b'], { vol: 0.9, rate: 0.9 * p });
  crack(ctx, out, 2.6, p);
  clank(ctx, out, 0.45, p);
  if (!has) {
    noiseSrc(ctx, filter(ctx, 'lowpass', 1400 * p, 0.8, env(ctx, out, 0.9, 0.002, 0.14)), 0.18, ctx.currentTime, 0.8);
    metalRing(ctx, out, 240 * p, 0.45, 0.28);
  }
  osc(ctx, 'sine', 100 * p, 42, 0.12, env(ctx, low, 0.4, 0.002, 0.13));
  subThump(ctx, low, 0.3, ctx.currentTime, 58);
}

/** Batida na mureta (raspão metálico). */
export function sfxWall(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 5, pan, 1, -9);
  const p = vary(0.15);
  punch(vol, 0.55, 0.4);
  const has = sample(a, out, 'mureta', { vol: 1, rate: 0.95 * p });
  const low = grave(ctx, out);
  sample(a, out, 'batida_soco', { vol: 0.6, rate: 1.1 * p }); // estalo seco do contato
  sample(a, low, 'batida_grave', { vol: 0.3, rate: 0.8 * p });
  sample(a, out, ['impacto_metal_a', 'impacto_metal_b'], { vol: 0.7, rate: 1.1 * p });
  crack(ctx, out, 2.8, 1.1 * p);
  clank(ctx, out, 0.65, 1.1 * p);
  // raspão de chapa 1–4 kHz sustentado (~0,25 s; rodada 12: +5,5 dB acima de 200 Hz, meta 6)
  noiseSrc(ctx, filter(ctx, 'bandpass', 1900 * p, 0.7, env(ctx, dirt(ctx, out, 2), has ? 0.9 : 1.2, 0.002, 0.26)), 0.3);
  osc(ctx, 'sine', 90 * p, 40, 0.15, env(ctx, low, 0.3, 0.002, 0.15));
  if (!has) metalRing(ctx, out, 310 * p, 0.3, 0.25);
}

/** Pouso de um salto: baque surdo da suspensão. */
export function sfxLand(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 3.2, pan, 1, -6);
  punch(vol, 0.4, 0.35);
  sample(a, out, 'batida_grave', { vol: 0.6, rate: 0.7 * vary(0.1) });
  // clunk da suspensão (médios/agudos: o pouso também se ouve em alto-falante pequeno)
  sample(a, out, 'mina_clunk', { vol: 0.6, rate: 0.8 * vary(0.1) });
  crack(ctx, out, 1.6, 0.7);
  osc(ctx, 'sine', 95 * vary(0.1), 38, 0.2, env(ctx, out, 0.6, 0.003, 0.22));
  noiseSrc(ctx, filter(ctx, 'lowpass', 500, 0.7, env(ctx, out, 0.6, 0.003, 0.12)), 0.15);
  osc(ctx, 'sawtooth', 260, 180, 0.18, filter(ctx, 'bandpass', 700, 6, env(ctx, out, 0.12, 0.02, 0.16)));
  subThump(ctx, out, 0.3, ctx.currentTime, 55);
}

/** Carro caindo da pista: assobio descendo e baque distante. */
export function sfxFall(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  // subido na rodada 10 (pico -10,6 dB): assobio encorpado e baque grave no fim
  const out = voice(a, vol * 2.4, pan, vol);
  const t = ctx.currentTime;
  osc(ctx, 'sine', 1400, 250, 1.1, env(ctx, out, 0.25, 0.05, 1.05));
  osc(ctx, 'triangle', 700, 125, 1.1, filter(ctx, 'lowpass', 1800, 0.7, env(ctx, out, 0.1, 0.05, 1.05)));
  sample(a, out, 'explosao_curta_b', { vol: 0.6, rate: 0.7, t: t + 1.1 });
  sample(a, out, 'batida_grave', { vol: 0.5, rate: 0.6, t: t + 1.1 });
  subThump(ctx, out, 0.5, t + 1.1, 52);
}

/**
 * Rodada no óleo: derrapagem longa de pneu (~0,7 s). Ruído em duas bandas largas (corpo ~1,3 kHz e
 * chiado ~2,6 kHz) com tremor rápido (a borracha "pulando" no asfalto), um tom de pneu cantando
 * que cai de afinação, o "splash" do óleo no começo e um baque grave do carro girando.
 */
export function sfxSkid(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  // subido na avaliação de som (estava -38 dB RMS, sumia na mixagem)
  // rodada 10: pico -12,4 dB → ~-3 dB (x3) e chiado mais longo (~1,3 s, o carro rodando inteiro)
  const out = voice(a, vol * 1.35, pan, vol);
  const t = ctx.currentTime;
  const p = vary(0.06);
  const hold = 0.9;
  const tail = 0.4;
  // envelope com sustentação: sobe rápido, segura ~0,45 s e cai
  const sus = ctx.createGain();
  sus.gain.setValueAtTime(0.0001, t);
  sus.gain.exponentialRampToValueAtTime(1, t + 0.03);
  sus.gain.setValueAtTime(1, t + hold);
  sus.gain.exponentialRampToValueAtTime(0.0001, t + hold + tail);
  sus.connect(dirt(ctx, out, 1.8));
  // tremor da borracha
  const wob = ctx.createGain();
  wob.gain.value = 0.75;
  wob.connect(sus);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 17 + Math.random() * 6;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.25;
  lfo.connect(lfoDepth);
  lfoDepth.connect(wob.gain);
  lfo.start(t);
  lfo.stop(t + hold + tail + 0.05);
  const body = ctx.createBiquadFilter();
  body.type = 'bandpass';
  body.Q.value = 2.2;
  body.frequency.setValueAtTime(1450 * p, t);
  body.frequency.linearRampToValueAtTime(1050 * p, t + hold + tail);
  body.connect(wob);
  noiseSrc(ctx, body, hold + tail + 0.05);
  const hiss = ctx.createBiquadFilter();
  hiss.type = 'bandpass';
  hiss.Q.value = 3;
  hiss.frequency.setValueAtTime(2700 * p, t);
  hiss.frequency.linearRampToValueAtTime(2200 * p, t + hold + tail);
  const hg = ctx.createGain();
  hg.gain.value = 0.55;
  hiss.connect(hg);
  hg.connect(wob);
  noiseSrc(ctx, hiss, hold + tail + 0.05);
  // pneu cantando: tom que cai, com vibrato rápido
  const tone = ctx.createGain();
  tone.gain.value = 0.16;
  tone.connect(sus);
  const o = osc(ctx, 'triangle', 1250 * p, 900 * p, hold + tail, tone, t);
  const vib = ctx.createOscillator();
  vib.frequency.value = 23;
  const depth = ctx.createGain();
  depth.gain.value = 40;
  vib.connect(depth);
  depth.connect(o.frequency);
  vib.start(t);
  vib.stop(t + hold + tail + 0.05);
  // óleo espirrando + baque grave do carro rodando
  sample(a, out, 'oleo', { vol: 0.5, rate: 0.9 * p });
  osc(ctx, 'sine', 85 * p, 45, 0.25, env(ctx, out, 0.45, 0.005, 0.25, t), t);
}

/* ------------------------------------------------------------------ */
/* Interface                                                            */
/* ------------------------------------------------------------------ */

/**
 * Caixa de guitarra: distorção forte → corte de graves embolados → presença em 1,4 kHz →
 * passa-baixa de alto-falante (o "fuzz" some acima de ~4 kHz, como num amplificador de verdade).
 */
function amp(ctx: BaseAudioContext, out: AudioNode, drive = 8): WaveShaperNode {
  const cab = filter(ctx, 'lowpass', 3800, 0.9, out);
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 1400;
  presence.Q.value = 1;
  presence.gain.value = 5;
  presence.connect(cab);
  const hp = filter(ctx, 'highpass', 110, 0.7, presence);
  return dirt(ctx, hp, drive);
}

/**
 * Bipe da contagem (3-2-1) e largada ("VAI!"): sirene de largada suja, com "clunk" do semáforo
 * acendendo; no VAI, acorde distorcido mais longo com pancada grave e prato.
 */
export function sfxCountdown(go: boolean): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  const out = voice(a, go ? 0.6 : 3.2, 0);
  const t = ctx.currentTime;
  const f = go ? 880 : 440;
  const dur = go ? 0.7 : 0.3;
  // clunk do relé do semáforo
  sample(a, out, 'mina_clunk', { vol: 0.8, rate: go ? 1.2 : 1.5 });
  // tom: duas ondas quadradas desafinadas pela "caixa"
  const g = env(ctx, out, 0.9, 0.004, dur, t);
  const cab = amp(ctx, g, go ? 6 : 4);
  for (const [m, det] of [[1, -8], [1, 9], [0.5, 0]] as const) {
    const o = osc(ctx, 'square', f * m, f * m, dur, cab, t);
    o.detune.value = det;
  }
  if (go) {
    for (const m of [1.5, 2]) osc(ctx, 'sawtooth', 440 * m, 440 * m, dur, cab, t);
    osc(ctx, 'sine', 90, 38, 0.35, env(ctx, out, 1.2, 0.002, 0.35, t), t);
    sample(a, out, 'batida_soco', { vol: 0.9, rate: 0.8 });
    // prato: ruído agudo com cauda
    noiseSrc(ctx, filter(ctx, 'bandpass', 5500, 0.8, env(ctx, out, 0.12, 0.002, 0.7, t)), 0.8, t);
  }
}

/** Nova volta: power chord de guitarra distorcida (quinta + oitava) com bumbo e prato. */
export function sfxLap(final: boolean): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  const out = voice(a, 0.6, 0);
  const t = ctx.currentTime;
  const root = final ? 164.8 : 146.8; // E3 / D3
  const len = final ? 1.1 : 0.55;
  const cab = amp(ctx, env(ctx, out, 0.9, 0.004, len, t), 12);
  for (const m of [1, 1.5, 2]) {
    for (const det of [-7, 6]) {
      const o = osc(ctx, 'sawtooth', root * m, root * m, len, cab, t);
      o.detune.value = det;
    }
  }
  if (final) {
    // segundo golpe (rock: "tan-TAAAN")
    const cab2 = amp(ctx, env(ctx, out, 0.9, 0.004, 0.9, t + 0.18), 12);
    for (const m of [1.335, 2, 2.67]) osc(ctx, 'sawtooth', root * m, root * m, 0.9, cab2, t + 0.18);
  }
  osc(ctx, 'sine', 110, 40, 0.25, env(ctx, out, 1, 0.002, 0.25, t), t);
  noiseSrc(ctx, filter(ctx, 'bandpass', 5000, 0.8, env(ctx, out, final ? 0.12 : 0.08, 0.002, final ? 0.9 : 0.45, t)), 1, t);
}

/** Queimando na lava: fogo rugindo (ruído grave-médio pulsando) com estalos de brasa. */
export function sfxBurn(vol = 1, pan = 0): void {
  const a = audio();
  if (!a || vol < 0.05) return;
  const { ctx } = a;
  const out = voice(a, vol * 3.5, pan);
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

/* ------------------------------------------------------------------ */
/* Final da campanha: fogos, multidão                                   */
/* ------------------------------------------------------------------ */

/**
 * Crepitar dos fogos (~0,8 s, estéreo): centenas de cliques de ruído agudo (0,3–2 ms) espalhados
 * em volta do `pan`, cada vez mais esparsos e fracos. Um buffer só por estouro (barato no celular).
 */
function crackleBuffer(ctx: BaseAudioContext, pan: number, len = 0.85): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.ceil(sr * len);
  const buf = ctx.createBuffer(2, n, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const clicks = 260 + Math.floor(Math.random() * 120);
  for (let i = 0; i < clicks; i++) {
    // mais cliques no começo (a estrela se abre e vai apagando)
    const u = Math.pow(Math.random(), 1.6);
    const start = Math.floor(u * (n - sr * 0.004));
    const w = Math.floor(sr * (0.0003 + Math.random() * 0.0017));
    const amp = (1 - u * 0.85) * (0.3 + Math.random() * 0.7);
    const p = Math.max(-1, Math.min(1, pan + (Math.random() * 2 - 1) * 0.6));
    const gl = Math.cos(((p + 1) * Math.PI) / 4);
    const gr = Math.sin(((p + 1) * Math.PI) / 4);
    let prev = 0;
    for (let k = 0; k < w; k++) {
      // ruído "diferenciado" (agudo) com queda exponencial
      const r = Math.random() * 2 - 1;
      const v = (r - prev) * 0.5 * amp * Math.exp((-4 * k) / w);
      prev = r;
      L[start + k] += v * gl;
      R[start + k] += v * gr;
    }
  }
  return buf;
}

function panned(ctx: BaseAudioContext, out: AudioNode, pan: number, vol: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = vol;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p);
  p.connect(out);
  return g;
}

/**
 * Foguete de fogos subindo: assobio (tom subindo com vibrato) + chiado do propelente.
 * Devolve quanto tempo (s) até o estouro.
 */
export function sfxFireworkLaunch(vol = 1, pan = 0, out?: AudioNode): number {
  const a = audio();
  if (!a) return 0.8;
  const { ctx } = a;
  const t = ctx.currentTime;
  const rise = 0.7 + Math.random() * 0.45;
  const dest = panned(ctx, out ?? a.out, pan * 0.6, vol);
  const f0 = 700 + Math.random() * 300;
  const whistle = ctx.createGain();
  whistle.gain.setValueAtTime(0.0001, t);
  whistle.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
  whistle.gain.setValueAtTime(0.16, t + rise - 0.15);
  whistle.gain.exponentialRampToValueAtTime(0.0001, t + rise);
  whistle.connect(dest);
  const o = osc(ctx, 'sine', f0, f0 * (2.6 + Math.random() * 0.6), rise, whistle, t);
  const vib = ctx.createOscillator();
  vib.frequency.value = 9 + Math.random() * 4;
  const depth = ctx.createGain();
  depth.gain.value = f0 * 0.03;
  vib.connect(depth);
  depth.connect(o.frequency);
  vib.start(t);
  vib.stop(t + rise);
  // chiado do foguete: ruído em banda subindo
  const hiss = ctx.createBiquadFilter();
  hiss.type = 'bandpass';
  hiss.Q.value = 1.4;
  hiss.frequency.setValueAtTime(1800, t);
  hiss.frequency.exponentialRampToValueAtTime(5200, t + rise);
  hiss.connect(env(ctx, dest, 0.22, 0.05, rise, t));
  noiseSrc(ctx, hiss, rise, t);
  return rise;
}

/**
 * Estouro de fogos: baque grave (soco 45–70 Hz + ruído abafado), estalo, a amostra de explosão
 * curta por baixo e o crepitar agudo (~0,8 s) espalhado no estéreo. Abaixa a música a cada estouro.
 */
export function sfxFireworkBurst(vol = 1, pan = 0, out?: AudioNode): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  const t = ctx.currentTime;
  const dest = panned(ctx, out ?? a.out, pan, vol);
  duck(0.7 * Math.min(1, vol), 0.9, 3 * Math.min(1, vol));
  // baque grave
  subThump(ctx, dest, 1.1, t, 68);
  osc(ctx, 'sine', 110 * vary(0.08), 38, 0.6, env(ctx, dest, 1, 0.003, 0.7, t), t);
  // estrondo grave (rodada 11: os fogos soavam só estalo); o crepitar agudo continua por cima
  sample(a, dest, 'explosao_sub', { vol: 0.5, rate: 1.1 * vary(0.08), duration: 0.9, fadeOut: 0.45 });
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(2600, t);
  lp.frequency.exponentialRampToValueAtTime(160, t + 0.6);
  lp.connect(env(ctx, dirt(ctx, dest, 2.5), 0.9, 0.002, 0.7, t));
  noiseSrc(ctx, lp, 0.75, t, 0.6);
  // estalo seco do estouro
  noiseSrc(ctx, filter(ctx, 'highpass', 1800, 0.7, env(ctx, dirt(ctx, dest, 3), 0.8, 0.0005, 0.03, t)), 0.05, t);
  sample(a, dest, ['explosao_curta_a', 'explosao_curta_b'], { vol: 0.55, rate: 0.8 * vary(0.1) });
  // crepitar: começa logo depois do estouro
  const src = ctx.createBufferSource();
  src.buffer = crackleBuffer(ctx, pan);
  const cg = ctx.createGain();
  cg.gain.value = 0.9 * vol;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  src.connect(hp);
  hp.connect(cg);
  cg.connect(out ?? a.out);
  src.start(t + 0.08 + Math.random() * 0.05);
}

/**
 * Multidão: aplauso (cliques de palmas densos, 1–3 kHz, estéreo largo) + rugido de torcida (ruído
 * em formantes de "ahh" ~720/1150 Hz com ondas lentas de volume) + assobios. Sobe em ~1 s, fica
 * `seconds` e some em ~2 s. Tudo em buffers e poucos nós (leve no celular).
 */
export function sfxCrowd(seconds = 9, vol = 1, out?: AudioNode): void {
  const a = audio();
  if (!a) return;
  const { ctx } = a;
  const t = ctx.currentTime;
  const sr = ctx.sampleRate;
  const end = t + seconds + 2;
  const dest = ctx.createGain();
  dest.gain.setValueAtTime(0.0001, t);
  dest.gain.exponentialRampToValueAtTime(vol, t + 1);
  dest.gain.setValueAtTime(vol, t + seconds);
  dest.gain.exponentialRampToValueAtTime(0.0001, end);
  dest.connect(out ?? a.out);
  // palmas: loop de 2,5 s estéreo
  const n = Math.ceil(sr * 2.5);
  const clap = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = clap.getChannelData(ch);
    for (let i = 0; i < 1400; i++) {
      const s = Math.floor(Math.random() * n);
      const w = Math.floor(sr * (0.004 + Math.random() * 0.008));
      const amp = 0.2 + Math.random() * 0.5;
      for (let k = 0; k < w; k++) d[(s + k) % n] += (Math.random() * 2 - 1) * amp * Math.exp((-5 * k) / w);
    }
  }
  const cs = ctx.createBufferSource();
  cs.buffer = clap;
  cs.loop = true;
  const cgain = ctx.createGain();
  cgain.gain.value = 0.5;
  cgain.connect(dest);
  cs.connect(filter(ctx, 'bandpass', 1800, 0.6, cgain));
  cs.start(t);
  cs.stop(end + 0.1);
  // rugido: formantes sobre ruído, com ondas lentas (a torcida "puxando" o grito)
  const roar = ctx.createGain();
  roar.gain.value = 0.55;
  roar.connect(dest);
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.35;
  const sd = ctx.createGain();
  sd.gain.value = 0.2;
  swell.connect(sd);
  sd.connect(roar.gain);
  swell.start(t);
  swell.stop(end + 0.1);
  for (const [f, q, g] of [[720, 3, 1], [1150, 4, 0.7], [320, 1.5, 0.5]] as const) {
    const s = ctx.createBufferSource();
    s.buffer = noise(ctx);
    s.loop = true;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const gg = ctx.createGain();
    gg.gain.value = g;
    gg.connect(roar);
    s.connect(filter(ctx, 'bandpass', f, q, gg));
    s.start(t, Math.random());
    s.stop(end + 0.1);
  }
  // assobios de torcida espalhados
  for (let i = 0; i < 5; i++) {
    const tt = t + 0.6 + Math.random() * seconds * 0.8;
    const f = 1700 + Math.random() * 900;
    const w = panned(ctx, dest, Math.random() * 1.6 - 0.8, 1);
    osc(ctx, 'sine', f, f * (Math.random() < 0.5 ? 1.35 : 0.8), 0.45, env(ctx, w, 0.06, 0.05, 0.45, tt), tt);
  }
}

/** Fogos do final: roteiro [segundos, ação] (o jogo agenda em tempo real; a evidência, no relógio offline). */
export interface FinaleShow {
  cues: [number, () => void][];
  /** cala o que ainda estiver tocando (saiu da tela) */
  stop: () => void;
}

/**
 * Final da campanha (item 58): 10 salvas de fogos com volume alto (a última tripla, algumas
 * duplas), pan aleatório e a multidão por baixo. Cada estouro abaixa a música (duck) e realça os
 * efeitos para saltar na mixagem. `later(s, fn)` agenda o estouro depois da subida do foguete
 * (padrão: setTimeout; a gravação offline passa o próprio agendador).
 */
export function finaleShow(later: (seconds: number, fn: () => void) => void = (s, fn) => window.setTimeout(fn, s * 1000)): FinaleShow {
  const a = audio();
  if (!a) return { cues: [], stop: () => {} };
  const bus = a.ctx.createGain();
  bus.connect(a.out);
  // fogos -3,5 dB e corte suave acima de 8 kHz (rodada 12: o final soava brilhante demais); a
  // multidão vai direto ao barramento
  const fireworks = a.ctx.createGain();
  fireworks.gain.value = 0.67;
  const soft = a.ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 8000;
  soft.Q.value = 0.5;
  fireworks.connect(soft);
  soft.connect(bus);
  let live = true;
  const cues: [number, () => void][] = [[0, () => sfxCrowd(10, 0.55, bus)]];
  let at = 0.2;
  for (let i = 0; i < 10; i++) {
    const shots = i === 9 ? 3 : i % 3 === 2 ? 2 : 1;
    for (let k = 0; k < shots; k++) {
      const pan = Math.random() * 1.6 - 0.8;
      const vol = 0.8 + Math.random() * 0.2;
      cues.push([
        at + k * 0.22,
        () => {
          if (!live) return;
          const rise = sfxFireworkLaunch(vol * 0.8, pan, fireworks);
          later(rise, () => {
            if (live) sfxFireworkBurst(vol, pan, fireworks);
          });
        },
      ]);
    }
    at += 0.75 + Math.random() * 0.35;
  }
  return {
    cues,
    stop: () => {
      live = false;
      const t = a.ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + 0.3);
    },
  };
}
