import { audio } from './context';

/** Limites de velocidade (fração da máxima) de cada marcha. */
const GEARS = [0, 0.22, 0.42, 0.62, 0.82, 1.45];

/**
 * Onda do motor: ciclo de um V8 (duas explosões por período). A fundamental fica na meia-ordem,
 * que dá o "burburinho" grave; os harmônicos caem rápido para não virar zumbido.
 */
function engineWave(ctx: BaseAudioContext, seed: number): PeriodicWave {
  const amps = [0, 0.5, 1, 0.3, 0.55, 0.16, 0.26, 0.08, 0.12, 0.04, 0.05, 0.02];
  const real = new Float32Array(amps.length);
  const imag = new Float32Array(amps.length);
  for (let i = 1; i < amps.length; i++) {
    const ph = ((i * seed * 2.39) % (Math.PI * 2)) - Math.PI; // fases diferentes por oscilador
    real[i] = amps[i] * Math.cos(ph);
    imag[i] = amps[i] * Math.sin(ph);
  }
  return ctx.createPeriodicWave(real, imag);
}

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

/**
 * Motor sintetizado em camadas:
 *  - ronco: duas ondas de V8 desafinadas, com instabilidade lenta de afinação (não fica um tom
 *    fixo de zumbido), saturação leve e passa-baixa que ABRE com a rotação e com a carga;
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
  private rumbleA!: OscillatorNode;
  private rumbleB!: OscillatorNode;
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

    const osc = (wave: PeriodicWave, gain: number, detune: number) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(this.body);
      return o;
    };
    this.rumbleA = osc(engineWave(ctx, 1), 0.5, -7);
    this.rumbleB = osc(engineWave(ctx, 2), 0.42, 8);
    // instabilidade de afinação (lenta, poucos cents): o motor "respira" em vez de zumbir
    const drift = biquad('lowpass', 9, 0.5);
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 260;
    loopNoise().connect(drift);
    drift.connect(driftDepth);
    driftDepth.connect(this.rumbleA.detune);
    driftDepth.connect(this.rumbleB.detune);
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

    for (const o of [this.rumbleA, this.rumbleB, this.lope, this.fire, this.sub]) o.start(t);
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
    this.rumbleA.frequency.setTargetAtTime(f / 2, t, k);
    this.rumbleB.frequency.setTargetAtTime(f / 2, t, k);
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
    this.fireGain.gain.setTargetAtTime(0.35 + load * 0.9, t, 0.05);
    this.subGain.gain.setTargetAtTime(0.14 - Math.min(1, rpm) * 0.05, t, 0.1);
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
 * Motores dos rivais mais próximos: uma voz barata por rival (dois osciladores de V8 desafinados
 * + filtro + pan), sem vento nem pneus. O ganho cai com a distância e o tom sobe/desce com a
 * aproximação (Doppler), então dá para ouvir alguém chegando por trás ou passando ao lado.
 */
export class RivalEngines {
  private voices: { osc: OscillatorNode; osc2: OscillatorNode; tone: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; rpm: number }[] = [];
  private started = false;
  private lastT = 0;

  constructor(private readonly count: number) {}

  start(): void {
    const a = audio();
    if (!a || this.started) return;
    this.started = true;
    const { ctx } = a;
    const t = ctx.currentTime;
    for (let i = 0; i < this.count; i++) {
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.Q.value = 0.5;
      tone.frequency.value = 600;
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(engineWave(ctx, 3 + i));
      osc.detune.value = -9;
      const osc2 = ctx.createOscillator();
      osc2.setPeriodicWave(engineWave(ctx, 7 + i));
      osc2.detune.value = 11;
      const g2 = ctx.createGain();
      g2.gain.value = 0.8;
      osc2.connect(g2);
      g2.connect(tone);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 45;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(tone);
      tone.connect(hp);
      hp.connect(gain);
      gain.connect(pan);
      pan.connect(a.engine);
      osc.start(t);
      osc2.start(t);
      this.voices.push({ osc, osc2, tone, gain, pan, rpm: 0.3 });
    }
    this.lastT = t;
  }

  /** `rivals` já ordenados do mais próximo ao mais distante (usa os primeiros). */
  update(rivals: RivalEngineInput[]): void {
    const a = audio();
    if (!a || !this.started) return;
    const t = a.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.voices.forEach((v, i) => {
      const r = rivals[i];
      if (!r) {
        v.gain.gain.setTargetAtTime(0, t, 0.15);
        return;
      }
      const s = Math.max(0, r.speedRatio);
      let g = 0;
      while (g < GEARS.length - 2 && s >= GEARS[g + 1]) g++;
      const inGear = Math.min(1, (s - GEARS[g]) / (GEARS[g + 1] - GEARS[g]));
      const target = 0.25 + g * 0.03 + inGear * 0.62;
      v.rpm += (target - v.rpm) * Math.min(1, dt * 5);
      const doppler = Math.max(0.93, Math.min(1.07, 343 / (343 - r.closing)));
      const f = (50 + v.rpm * 260) * doppler;
      v.osc.frequency.setTargetAtTime(f / 2, t, 0.06);
      v.osc2.frequency.setTargetAtTime(f / 2, t, 0.06);
      // longe, abafado; perto, abre (distância também soa pelo timbre, não só pelo volume)
      const near = Math.max(0, 1 - r.dist / 45);
      v.tone.frequency.setTargetAtTime(300 + near * 500 + v.rpm * 1000 + r.throttle * 300, t, 0.06);
      v.gain.gain.setTargetAtTime(near * near * (0.2 + r.throttle * 0.12), t, 0.08);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.05);
    });
  }

  silence(): void {
    const a = audio();
    if (!a || !this.started) return;
    for (const v of this.voices) v.gain.gain.setTargetAtTime(0, a.ctx.currentTime, 0.1);
  }
}
