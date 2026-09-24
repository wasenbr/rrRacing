import { audio } from './context';
import { ENGINE_LOOPS, getBuffer, loadBuffer } from './samples';

/**
 * Loops de motor GRAVADO (V8 de um Chevrolet Caprice, romanholtwick, CC0; ver CREDITOS.md) e a
 * frequência de queima de cada um. A gravação só tem rotações baixas (~44 e ~58 Hz) e motor_1 é o
 * loop de ~58 Hz 1,4x acima (rubberband, formantes preservados). Nenhum loop toca mais que ±25%
 * fora do próprio tom (REC_MAX_SHIFT): acima de ~100 Hz de queima a gravação sai e a síntese de
 * ciclos de V8 assume (esticar a marcha lenta até 5x soava artificial).
 */
const REC_LOOP_F: Record<(typeof ENGINE_LOOPS)[number], number> = {
  motor_lenta: 44,
  motor_0: 58,
  motor_1: 58 * 1.4,
};
const REC_MAX_SHIFT = 1.25;
/** Intervalo mínimo (s) entre atualizações dos parâmetros dos motores. */
const AUDIO_TICK = 1 / 30;
/** Faixa de queima (Hz) em que a gravação cede lugar à síntese (motor_1 x 1,25 = ~101 Hz). */
const REC_FADE: [number, number] = [80, 100];

/** Peso da gravação (0..1) para a frequência de queima `f`. */
export function recWeight(f: number): number {
  const x = (f - REC_FADE[0]) / (REC_FADE[1] - REC_FADE[0]);
  return x <= 0 ? 1 : x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
}

/** Taxa de reprodução de um loop gravado de frequência `loopF` para soar em `f` (±25% no máximo). */
function recRate(f: number, loopF: number): number {
  return Math.max(1 / REC_MAX_SHIFT, Math.min(REC_MAX_SHIFT, f / loopF));
}

/** Limites de velocidade (fração da máxima) de cada marcha. */
const GEARS = [0, 0.22, 0.42, 0.62, 0.82, 1.45];

function distortion(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

/** Curva que transforma uma senoide em pulsos estreitos positivos (uma "explosão" por ciclo). */
function pulseCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.pow(Math.max(0, x), 3);
  }
  return c;
}

/** Nível dos loops gravados em relação à síntese. */
const REC_LEVEL = 4;

/** Frequência de queima em que os ciclos gravados no buffer foram gerados (playbackRate = f / BASE). */
const CYCLE_BASE = 100;

/** Gerador pseudoaleatório determinístico (o mesmo motor soa igual a cada partida). */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const cycleCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/**
 * Ciclos de queima de um V8 "gravados" num buffer em loop (2 s, 200 explosões a 100 Hz), tocado
 * com playbackRate = rotação. Diferente do pente harmônico fixo de um oscilador, cada explosão é
 * um evento próprio:
 *  - irregularidade de cilindro: cada um dos 8 cilindros tem força e defasagem próprias (padrão
 *    fixo, como num V8 de verdade: é o "burburinho") + jitter aleatório de período e amplitude;
 *  - cada explosão = pulso de pressão (clique largo) + duas ressonâncias amortecidas do escapamento
 *    + rajada de ruído de queima, com ressonâncias levemente diferentes a cada vez;
 *  - `heavy` (carga alta): pulsos mais secos, mais ruído e ressonância alta mais forte: os
 *    harmônicos mudam com a carga (crossfade entre os dois buffers).
 * O loop fecha sem clique: a posição das explosões é reescalada para caber exatamente em 2 s e a
 * cauda que passa do fim é somada no começo.
 */
function cycleBuffer(ctx: BaseAudioContext, heavy: boolean, seed: number): AudioBuffer {
  const key = `${heavy ? 'h' : 'l'}${seed}`;
  let cache = cycleCache.get(ctx);
  if (!cache) cycleCache.set(ctx, (cache = new Map()));
  const have = cache.get(key);
  if (have) return have;
  const sr = ctx.sampleRate;
  const len = sr * 2;
  const n = CYCLE_BASE * 2;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rnd = rng(seed * 7919 + (heavy ? 13 : 1));
  // força e defasagem de cada cilindro (fixas) + jitter por explosão
  const cylAmp = [1, 0.78, 0.93, 0.7, 0.97, 0.74, 0.88, 0.8];
  const cylLag = [0, 0.07, -0.04, 0.09, 0.02, -0.06, 0.05, -0.08];
  const pos: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    pos.push(acc + cylLag[i % 8] + (rnd() * 2 - 1) * 0.035);
    acc += 1;
  }
  const tau1 = heavy ? 0.0035 : 0.005;
  const tau2 = heavy ? 0.0022 : 0.0028;
  const tauN = heavy ? 0.004 : 0.0028;
  const tail = Math.floor(sr * 0.03);
  for (let i = 0; i < n; i++) {
    const start = Math.floor((pos[i] / n) * len + len) % len;
    const amp = cylAmp[i % 8] * (0.85 + rnd() * 0.3);
    const f1 = (heavy ? 240 : 200) * (0.94 + rnd() * 0.12);
    const f2 = (heavy ? 760 : 560) * (0.9 + rnd() * 0.2);
    const r2 = heavy ? 0.65 : 0.35;
    const nz = (heavy ? 0.55 : 0.3) * (0.7 + rnd() * 0.6);
    const pw = sr * (heavy ? 0.0012 : 0.0018); // largura do pulso de pressão
    for (let k = 0; k < tail; k++) {
      const t = k / sr;
      const press = k < pw * 2 ? Math.sin((Math.PI * k) / (pw * 2)) : 0;
      const v =
        press * 0.9 +
        Math.exp(-t / tau1) * Math.sin(2 * Math.PI * f1 * t) +
        r2 * Math.exp(-t / tau2) * Math.sin(2 * Math.PI * f2 * t) +
        nz * Math.exp(-t / tauN) * (rnd() * 2 - 1);
      d[(start + k) % len] += amp * v;
    }
  }
  // tira o nível DC (o pulso de pressão é só positivo) e normaliza
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs((d[i] -= mean)));
  for (let i = 0; i < len; i++) d[i] *= 0.9 / peak;
  cache.set(key, buf);
  return buf;
}

/**
 * Motor sintetizado em camadas:
 *  - ronco: ciclos de queima do V8 em buffer (`cycleBuffer`: cada explosão com força e tempo
 *    próprios, nada de pente harmônico fixo), um buffer de carga leve e outro de carga alta em
 *    crossfade pelo acelerador, instabilidade lenta de rotação, saturação leve e passa-baixa que
 *    ABRE com a rotação e com a carga;
 *  - formantes: dois picos de ressonância (escapamento ~200–450 Hz e coletor ~650–1600 Hz) que
 *    sobem com a rotação: o timbre muda de "burburinho" na lenta para "rasgado" no alto giro;
 *  - explosões: ruído em banda modulado por pulsos na frequência de queima (textura de
 *    escapamento de verdade), mais forte com o pé embaixo;
 *  - admissão: sopro filtrado que cresce com a carga;
 *  - sub: senoide na meia-ordem, só para dar peso;
 *  - nitro: sopro grave (300–900 Hz) e "whoosh" de ignição ao acionar, sem chiado agudo.
 * A frequência de queima vai de ~50 Hz (lenta) a ~310 Hz (corte): a subida de giro é clara.
 * (Amostras CC0 de motor testadas — OpenGameArt/Freesound — eram só rumor sub-grave ou vento de
 * microfone; a síntese em camadas soou melhor.)
 */
export class EngineSound {
  private started = false;
  private cycLight!: AudioBufferSourceNode;
  private cycHeavy!: AudioBufferSourceNode;
  private lightGain!: GainNode;
  private heavyGain!: GainNode;
  private sub!: OscillatorNode;
  private subGain!: GainNode;
  private fire!: OscillatorNode;
  private fireBand!: BiquadFilterNode;
  private fireGain!: GainNode;
  private lope!: OscillatorNode;
  private lopeDepth!: GainNode;
  private tone!: BiquadFilterNode;
  private formant1!: BiquadFilterNode;
  private formant2!: BiquadFilterNode;
  private body!: GainNode;
  private intake!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private blow!: BiquadFilterNode;
  private blowGain!: GainNode;
  private hissGain!: GainNode;
  private squeal!: BiquadFilterNode;
  private squealGain!: GainNode;
  private windGain!: GainNode;
  private out!: GainNode;
  /** loops gravados (quando carregados): fonte, ganho e frequência de queima original */
  private rec: { src: AudioBufferSourceNode; gain: GainNode; f: number }[] = [];
  private recBus!: GainNode;
  private recTone!: BiquadFilterNode;
  /** quanto da síntese fica onde a gravação domina (pouco: duas fontes no mesmo tom batem) */
  private synthUnderRec = 1;
  /** instabilidade lenta de rotação, ligada ao detune de TODAS as fontes com tom */
  private drift!: GainNode;
  private noiseBuf!: AudioBuffer;
  private rpm = 0.15;
  private gear = 0;
  private lastT = 0;
  private shiftUntil = 0;
  private wasBoosting = false;

  /** Precisa ser chamado depois de unlockAudio() (gesto do usuário). */
  start(): void {
    const a = audio();
    if (!a || this.started) return;
    this.started = true;
    const { ctx } = a;
    const t = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(a.engine);
    // loops gravados: passa-baixa suave que abre com a rotação e a carga
    this.recTone = ctx.createBiquadFilter();
    this.recTone.type = 'lowpass';
    this.recTone.frequency.value = 2000;
    this.recTone.Q.value = 0.5;
    this.recBus = ctx.createGain();
    this.recBus.gain.value = 0;
    this.recTone.connect(this.recBus);
    this.recBus.connect(this.out);
    // os loops já vêm pré-carregados ao destravar o áudio (preloadSfx); se não, entram quando chegarem
    const attach = (bufs: (AudioBuffer | null)[]) => {
      if (bufs.some((b) => !b) || this.rec.length) return; // sem gravação: fica só a síntese
      const t0 = ctx.currentTime;
      this.rec = bufs.map((b, i) => {
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(this.recTone);
        src.start(t0, Math.random() * (b as AudioBuffer).duration);
        // mesma instabilidade lenta de rotação da síntese: as camadas andam juntas, sem batimento
        this.drift.connect(src.detune);
        return { src, gain, f: REC_LOOP_F[ENGINE_LOOPS[i]] };
      });
      this.synthUnderRec = 0.12;
    };

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loopNoise = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      s.start(t, Math.random());
      return s;
    };
    const biquad = (type: BiquadFilterType, f: number, q: number, gain = 0) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      b.gain.value = gain;
      return b;
    };
    // instabilidade de rotação (lenta, poucos cents): o motor "respira" em vez de zumbir. Vai para
    // TODAS as fontes com tom (ciclos, queima, sub e gravação): se só uma oscilasse, as camadas
    // desafinariam entre si e a periodicidade "batia"
    const driftLp = biquad('lowpass', 9, 0.5);
    this.drift = ctx.createGain();
    this.drift.gain.value = 260;
    loopNoise().connect(driftLp);
    driftLp.connect(this.drift);
    const ready = ENGINE_LOOPS.map((n) => getBuffer(`audio/motor/${n}.mp3`));
    if (ready.every((b) => b)) attach(ready);
    else void Promise.all(ENGINE_LOOPS.map((n) => loadBuffer(ctx, `audio/motor/${n}.mp3`, false))).then(attach);

    // ronco → saturação → passa-baixa móvel → formantes → corte fixo de agudos → corpo → sem infrassom
    this.body = ctx.createGain();
    this.body.gain.value = 0.8;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(1.8);
    shaper.oversample = '2x';
    this.tone = biquad('lowpass', 400, 0.6);
    this.formant1 = biquad('peaking', 220, 1.2, 5);
    this.formant2 = biquad('peaking', 800, 1.6, 3);
    const tone2 = biquad('lowpass', 3200, 0.5);
    const chest = biquad('peaking', 150, 0.9, 3);
    const hp = biquad('highpass', 40, 0.7);
    this.body.connect(shaper);
    shaper.connect(this.tone);
    this.tone.connect(this.formant1);
    this.formant1.connect(this.formant2);
    this.formant2.connect(tone2);
    tone2.connect(chest);
    chest.connect(hp);
    hp.connect(this.out);

    const cycle = (heavy: boolean) => {
      const src = ctx.createBufferSource();
      src.buffer = cycleBuffer(ctx, heavy, 1);
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = heavy ? 0 : 0.9;
      src.connect(g);
      g.connect(this.body);
      return [src, g] as const;
    };
    [this.cycLight, this.lightGain] = cycle(false);
    [this.cycHeavy, this.heavyGain] = cycle(true);
    this.drift.connect(this.cycLight.detune);
    this.drift.connect(this.cycHeavy.detune);
    // modulação de amplitude na meia-ordem lenta: explosões levemente irregulares (burburinho)
    this.lope = ctx.createOscillator();
    this.lope.type = 'sine';
    this.lopeDepth = ctx.createGain();
    this.lopeDepth.gain.value = 0.15;
    this.lope.connect(this.lopeDepth);
    this.lopeDepth.connect(this.body.gain);

    // explosões: ruído em banda, com volume pulsando na frequência de queima
    this.fire = ctx.createOscillator();
    this.fire.type = 'sine';
    const pulses = ctx.createWaveShaper();
    pulses.curve = pulseCurve();
    this.fire.connect(pulses);
    const fireAm = ctx.createGain();
    fireAm.gain.value = 0;
    pulses.connect(fireAm.gain);
    this.fireBand = biquad('bandpass', 600, 0.9);
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    loopNoise().connect(this.fireBand);
    this.fireBand.connect(fireAm);
    fireAm.connect(this.fireGain);
    this.fireGain.connect(this.tone);

    // sub: meia-ordem em senoide, só peso
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.12;
    const subHp = biquad('highpass', 38, 0.7);
    this.sub.connect(this.subGain);
    this.subGain.connect(subHp);
    subHp.connect(this.out);

    // admissão: sopro médio que cresce com a carga
    this.intake = biquad('bandpass', 500, 0.8);
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    loopNoise().connect(this.intake);
    this.intake.connect(this.intakeGain);
    this.intakeGain.connect(this.out);

    // nitro: sopro grave (300–900 Hz) e um fio de ar bem baixo (sem chiado de 2,4 kHz)
    this.blow = biquad('bandpass', 400, 1.1);
    this.blowGain = ctx.createGain();
    this.blowGain.gain.value = 0;
    loopNoise().connect(this.blow);
    this.blow.connect(this.blowGain);
    this.blowGain.connect(this.out);
    const hiss = biquad('lowpass', 1400, 0.5);
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    loopNoise().connect(hiss);
    hiss.connect(this.hissGain);
    this.hissGain.connect(this.out);

    // pneus cantando: ruído em banda média, sem tom puro (não "apita")
    this.squeal = biquad('bandpass', 1000, 3.5);
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    loopNoise().connect(this.squeal);
    this.squeal.connect(this.squealGain);
    this.squealGain.connect(this.out);

    // vento em alta velocidade
    const wind = biquad('lowpass', 600, 0.7);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loopNoise().connect(wind);
    wind.connect(this.windGain);
    this.windGain.connect(this.out);

    for (const o of [this.lope, this.fire, this.sub]) {
      this.drift.connect(o.detune);
      o.start(t);
    }
    this.cycLight.start(t, Math.random() * 2);
    this.cycHeavy.start(t, Math.random() * 2);
    this.lastT = t;
  }

  /** "Whoosh" de ignição do nitro: sopro subindo de grave para médio e um baque surdo. */
  private ignite(t: number): void {
    const a = audio();
    if (!a) return;
    const { ctx } = a;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(950, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.6);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(og);
    og.connect(this.out);
    o.start(t);
    o.stop(t + 0.25);
  }

  /**
   * @param speedRatio velocidade / velocidade máxima (0..~1.3)
   * @param throttle acelerador 0..1
   * @param boosting nitro ligado
   * @param slip derrapagem 0..1 (pneus cantando)
   */
  update(speedRatio: number, throttle: number, boosting: boolean, slip = 0): void {
    const a = audio();
    if (!a || !this.started) return;
    const t = a.ctx.currentTime;
    // ~30 atualizações por segundo bastam (as constantes de tempo são de 40 a 250 ms). Reagendar
    // dezenas de parâmetros a cada quadro (120 Hz no iPad) disputava com a thread de áudio e picotava o som
    if (t - this.lastT < AUDIO_TICK) return;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const s = Math.max(0, speedRatio);

    // marcha e rotação
    let g = 0;
    while (g < GEARS.length - 2 && s >= GEARS[g + 1]) g++;
    if (g > this.gear) this.shiftUntil = t + 0.1; // troca: corta a aceleração por um instante
    this.gear = g;
    const inGear = Math.min(1, (s - GEARS[g]) / (GEARS[g + 1] - GEARS[g]));
    // cada marcha sobe o giro de ~25% a ~90%; marchas altas começam um pouco mais alto
    let target = s < 0.03 ? 0.08 + throttle * 0.5 : 0.25 + g * 0.03 + inGear * 0.62 + (g === 0 ? throttle * 0.08 : 0);
    if (throttle < 0.1 && s >= 0.03) target -= 0.08; // pé fora: o giro cai um pouco (freio-motor)
    if (boosting) target += 0.1;
    const rate = target > this.rpm ? 5 : 6;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
    const rpm = Math.max(0, Math.min(1.1, this.rpm));
    const shifting = t < this.shiftUntil;
    const load = shifting ? 0.1 : throttle;

    if (boosting && !this.wasBoosting) this.ignite(t);
    this.wasBoosting = boosting;

    // frequência de queima: ~50 Hz na lenta a ~310 Hz no corte; o ciclo do V8 fica uma oitava abaixo
    const f = 50 + rpm * 260;
    const k = 0.04;
    this.cycLight.playbackRate.setTargetAtTime(f / CYCLE_BASE, t, k);
    this.cycHeavy.playbackRate.setTargetAtTime(f / CYCLE_BASE, t, k);
    // gravação na lenta e no giro baixo; a síntese assume no alto giro (a camada dominante troca)
    const recW = this.rec.length ? recWeight(f) : 0;
    const synthMix = recW * this.synthUnderRec + (1 - recW);
    // harmônicos mudam com a carga: pé embaixo = explosões mais secas e ruidosas
    this.lightGain.gain.setTargetAtTime((0.95 - load * 0.55) * synthMix, t, 0.06);
    this.heavyGain.gain.setTargetAtTime((0.15 + load * 0.75) * synthMix, t, 0.06);
    // gravação: os dois loops vizinhos da rotação atual em crossfade de potência igual, cada um no
    // máximo ±25% fora do próprio tom
    if (this.rec.length) {
      const n = this.rec.length;
      let i = 0;
      while (i < n - 2 && f >= this.rec[i + 1].f) i++;
      const x = Math.max(0, Math.min(1, Math.log(f / this.rec[i].f) / Math.log(this.rec[i + 1].f / this.rec[i].f)));
      this.rec.forEach((r, j) => {
        const w = j === i ? Math.cos((x * Math.PI) / 2) : j === i + 1 ? Math.sin((x * Math.PI) / 2) : 0;
        r.gain.gain.setTargetAtTime(w, t, 0.04);
        r.src.playbackRate.setTargetAtTime(recRate(f, r.f), t, k);
      });
      this.recTone.frequency.setTargetAtTime(700 + Math.min(1, rpm) * 2000 + load * 800, t, k);
      this.recBus.gain.setTargetAtTime(recW * REC_LEVEL * (0.75 + load * 0.35), t, 0.06);
    }
    this.sub.frequency.setTargetAtTime(f / 2, t, k);
    this.fire.frequency.setTargetAtTime(f, t, k);
    this.lope.frequency.setTargetAtTime(f / 8, t, k);
    this.lopeDepth.gain.setTargetAtTime(0.22 - rpm * 0.16, t, 0.1);
    // o timbre abre com rotação e carga: grave e redondo na lenta, rasgado no alto giro
    this.tone.frequency.setTargetAtTime(380 + rpm * 1700 + load * 600 + (boosting ? 300 : 0), t, k);
    this.formant1.frequency.setTargetAtTime(190 + rpm * 260, t, k);
    this.formant1.gain.setTargetAtTime(4 + load * 3, t, 0.08);
    this.formant2.frequency.setTargetAtTime(650 + rpm * 950, t, k);
    this.formant2.gain.setTargetAtTime(1 + load * 5 + rpm * 2, t, 0.08);
    this.fireBand.frequency.setTargetAtTime(350 + rpm * 900, t, k);
    // queima: dominante na síntese pura; com a gravação vira só textura por cima
    this.fireGain.gain.setTargetAtTime((0.55 + load * 1.1) * (1 - recW * 0.55), t, 0.05);
    // sub: a gravação já tem o grave; outra fonte no mesmo tom por baixo só criaria batimento
    this.subGain.gain.setTargetAtTime((0.14 - Math.min(1, rpm) * 0.05) * (1 - recW * 0.8), t, 0.1);
    this.intake.frequency.setTargetAtTime(350 + rpm * 900, t, k);
    this.intakeGain.gain.setTargetAtTime(load * (0.02 + rpm * 0.07), t, 0.06);
    this.out.gain.setTargetAtTime(0.3 + load * 0.2 + rpm * 0.14, t, shifting ? 0.03 : 0.08);

    this.blow.frequency.setTargetAtTime(300 + Math.min(1, rpm) * 600, t, 0.1);
    this.blowGain.gain.setTargetAtTime(boosting ? 0.3 : 0, t, boosting ? 0.08 : 0.25);
    this.hissGain.gain.setTargetAtTime(boosting ? 0.035 : 0, t, boosting ? 0.05 : 0.2);

    // pneus: só a derrapagem forte canta (curvas normais ficam em silêncio)
    const sq = Math.max(0, Math.min(1, (slip - 0.3) / 0.7));
    this.squealGain.gain.setTargetAtTime(sq * 0.45, t, 0.06);
    this.squeal.frequency.setTargetAtTime(900 + sq * 250, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.max(0, s - 0.5) * 0.14, t, 0.2);
  }

  silence(): void {
    const a = audio();
    if (!a || !this.started) return;
    const t = a.ctx.currentTime;
    for (const g of [this.out, this.squealGain, this.blowGain, this.hissGain, this.windGain]) g.gain.setTargetAtTime(0, t, 0.1);
    this.wasBoosting = false;
  }
}

/** Um rival audível: dados do carro mais próximo que ocupa esta voz. */
export interface RivalEngineInput {
  /** velocidade / velocidade máxima */
  speedRatio: number;
  throttle: number;
  /** distância até o jogador (m) */
  dist: number;
  /** -1 (esquerda) .. +1 (direita) */
  pan: number;
  /** velocidade de aproximação (m/s, positiva = chegando): Doppler */
  closing: number;
}

/**
 * Motores dos rivais mais próximos: uma voz barata por rival, sem vento nem pneus:
 *  - ciclos de queima em buffer (o mesmo gerador do motor do jogador, com semente própria: cada
 *    rival tem a sua irregularidade de cilindros);
 *  - camada de ruído de queima pulsado na frequência das explosões (textura de escapamento);
 *  - filtro + pan. O ganho cai com a distância e o tom sobe/desce com a aproximação (Doppler),
 *    então dá para ouvir alguém chegando por trás ou passando ao lado.
 */
export class RivalEngines {
  private voices: {
    cyc: AudioBufferSourceNode;
    cycGain: GainNode;
    /** loops gravados (os mesmos do jogador), um por faixa de rotação */
    rec: { src: AudioBufferSourceNode; gain: GainNode; f: number }[];
    fire: OscillatorNode;
    fireBand: BiquadFilterNode;
    fireGain: GainNode;
    tone: BiquadFilterNode;
    gain: GainNode;
    pan: StereoPannerNode;
    rpm: number;
    /** ligada ao barramento; calada há um tempo, sai do grafo e para de gastar CPU de áudio */
    on: boolean;
    quietSince: number;
  }[] = [];
  private started = false;
  private lastT = 0;

  constructor(private readonly count: number) {}

  start(): void {
    const a = audio();
    if (!a || this.started) return;
    this.started = true;
    const { ctx } = a;
    const t = ctx.currentTime;
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const pulses = pulseCurve();
    for (let i = 0; i < this.count; i++) {
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.Q.value = 0.5;
      tone.frequency.value = 600;
      const cyc = ctx.createBufferSource();
      cyc.buffer = cycleBuffer(ctx, true, 11 + i);
      cyc.loop = true;
      const cg = ctx.createGain();
      cg.gain.value = 0.9;
      cyc.connect(cg);
      cg.connect(tone);
      // queima: ruído em banda, volume pulsando na frequência de explosão
      const fire = ctx.createOscillator();
      fire.type = 'sine';
      const shaper = ctx.createWaveShaper();
      shaper.curve = pulses;
      fire.connect(shaper);
      const am = ctx.createGain();
      am.gain.value = 0;
      shaper.connect(am.gain);
      const fireBand = ctx.createBiquadFilter();
      fireBand.type = 'bandpass';
      fireBand.Q.value = 0.9;
      fireBand.frequency.value = 600;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.connect(fireBand);
      fireBand.connect(am);
      const fireGain = ctx.createGain();
      fireGain.gain.value = 0.5;
      am.connect(fireGain);
      fireGain.connect(tone);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 45;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      tone.connect(hp);
      hp.connect(gain);
      gain.connect(pan);
      pan.connect(a.engine);
      cyc.start(t, Math.random() * 2);
      fire.start(t);
      src.start(t, Math.random());
      this.voices.push({ cyc, cycGain: cg, rec: [], fire, fireBand, fireGain, tone, gain, pan, rpm: 0.3, on: true, quietSince: -1 });
    }
    // gravação: os mesmos loops do motor do jogador (timbre igual de perto), passando pelo mesmo
    // filtro de distância e pan de cada voz
    const attach = (bufs: (AudioBuffer | null)[]) => {
      if (bufs.some((b) => !b) || this.voices.some((v) => v.rec.length)) return;
      const t0 = ctx.currentTime;
      for (const v of this.voices) {
        v.rec = bufs.map((b, i) => {
          const src = ctx.createBufferSource();
          src.buffer = b;
          src.loop = true;
          const g = ctx.createGain();
          g.gain.value = 0;
          src.connect(g);
          g.connect(v.tone);
          src.start(t0, Math.random() * (b as AudioBuffer).duration);
          return { src, gain: g, f: REC_LOOP_F[ENGINE_LOOPS[i]] };
        });
      }
    };
    const ready = ENGINE_LOOPS.map((n) => getBuffer(`audio/motor/${n}.mp3`));
    if (ready.every((b) => b)) attach(ready);
    else void Promise.all(ENGINE_LOOPS.map((n) => loadBuffer(ctx, `audio/motor/${n}.mp3`, false))).then(attach);
    this.lastT = t;
  }

  /** `rivals` já ordenados do mais próximo ao mais distante (usa os primeiros). */
  update(rivals: RivalEngineInput[]): void {
    const a = audio();
    if (!a || !this.started) return;
    const t = a.ctx.currentTime;
    // ~30 atualizações por segundo bastam (as constantes de tempo são de 40 a 250 ms). Reagendar
    // dezenas de parâmetros a cada quadro (120 Hz no iPad) disputava com a thread de áudio e picotava o som
    if (t - this.lastT < AUDIO_TICK) return;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.voices.forEach((v, i) => {
      const r = rivals[i];
      if (!r) {
        v.gain.gain.setTargetAtTime(0, t, 0.15);
        this.park(v, t, a.engine, 0);
        return;
      }
      const s = Math.max(0, r.speedRatio);
      let g = 0;
      while (g < GEARS.length - 2 && s >= GEARS[g + 1]) g++;
      const inGear = Math.min(1, (s - GEARS[g]) / (GEARS[g + 1] - GEARS[g]));
      // parado (largada): lenta como a do jogador, na faixa em que a gravação toca
      const target = s < 0.03 ? 0.08 + r.throttle * 0.5 : 0.25 + g * 0.03 + inGear * 0.62;
      v.rpm += (target - v.rpm) * Math.min(1, dt * 5);
      const doppler = Math.max(0.93, Math.min(1.07, 343 / (343 - r.closing)));
      const f = (50 + v.rpm * 260) * doppler;
      v.cyc.playbackRate.setTargetAtTime(f / CYCLE_BASE, t, 0.06);
      // mesma troca de camada do jogador: gravação no giro baixo, síntese no alto
      const recW = v.rec.length ? recWeight(f) : 0;
      v.cycGain.gain.setTargetAtTime(0.9 * (1 - recW * 0.88), t, 0.06);
      if (v.rec.length) {
        let i = 0;
        while (i < v.rec.length - 2 && f >= v.rec[i + 1].f) i++;
        const x = Math.max(0, Math.min(1, Math.log(f / v.rec[i].f) / Math.log(v.rec[i + 1].f / v.rec[i].f)));
        v.rec.forEach((rr, j) => {
          const w = j === i ? Math.cos((x * Math.PI) / 2) : j === i + 1 ? Math.sin((x * Math.PI) / 2) : 0;
          rr.gain.gain.setTargetAtTime(recW * w * REC_LEVEL * 0.8, t, 0.05);
          rr.src.playbackRate.setTargetAtTime(recRate(f, rr.f), t, 0.06);
        });
      }
      v.fire.frequency.setTargetAtTime(f, t, 0.06);
      v.fireBand.frequency.setTargetAtTime(350 + v.rpm * 900, t, 0.06);
      v.fireGain.gain.setTargetAtTime((0.35 + r.throttle * 0.6) * (1 - recW * 0.55), t, 0.06);
      // longe, abafado; perto, abre (distância também soa pelo timbre, não só pelo volume)
      const near = Math.max(0, 1 - r.dist / 45);
      v.tone.frequency.setTargetAtTime(300 + near * 500 + v.rpm * 1000 + r.throttle * 300, t, 0.06);
      const level = near * near * (0.2 + r.throttle * 0.12);
      v.gain.gain.setTargetAtTime(level, t, 0.08);
      this.park(v, t, a.engine, level);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.05);
    });
  }

  silence(): void {
    const a = audio();
    if (!a || !this.started) return;
    for (const v of this.voices) {
      v.gain.gain.setTargetAtTime(0, a.ctx.currentTime, 0.1);
      if (v.quietSince < 0) v.quietSince = a.ctx.currentTime;
    }
    // sem update (menu): desliga as vozes depois que o volume já caiu
    setTimeout(() => {
      for (const v of this.voices) this.park(v, a.ctx.currentTime, a.engine, 0);
    }, 800);
  }

  /** Tira do grafo a voz calada há mais de 0,6 s; volta quando precisa soar (o ganho já está em ~0, sem estalo). */
  private park(v: RivalEngines['voices'][number], t: number, bus: AudioNode, level: number): void {
    if (level > 1e-4) {
      v.quietSince = -1;
      if (!v.on) {
        v.pan.connect(bus);
        v.on = true;
      }
      return;
    }
    if (v.quietSince < 0) v.quietSince = t;
    else if (v.on && t - v.quietSince > 0.6) {
      v.pan.disconnect();
      v.on = false;
    }
  }
}
