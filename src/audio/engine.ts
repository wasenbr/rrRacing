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

/**
 * Motor sintetizado: ronco grave de V8 (duas ondas levemente desafinadas, saturação leve e
 * filtro sem ressonância), com trocas de marcha, admissão discreta, turbina no nitro, pneus
 * cantando só em derrapagem de verdade e vento em alta. Pensado para ouvir a corrida inteira sem
 * cansar: pouca energia acima de 2 kHz e volume que cai quando o pé sai do acelerador.
 */
export class EngineSound {
  private started = false;
  private rumbleA!: OscillatorNode;
  private rumbleB!: OscillatorNode;
  private lope!: OscillatorNode;
  private lopeDepth!: GainNode;
  private tone!: BiquadFilterNode;
  private body!: GainNode;
  private intake!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private whine!: BiquadFilterNode;
  private whineGain!: GainNode;
  private hissGain!: GainNode;
  private squeal!: BiquadFilterNode;
  private squealGain!: GainNode;
  private windGain!: GainNode;
  private out!: GainNode;
  private rpm = 0.15;
  private gear = 0;
  private lastT = 0;
  private shiftUntil = 0;

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

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loopNoise = () => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.start(t, Math.random());
      return s;
    };

    // ronco: duas ondas de V8 desafinadas (encorpa sem zumbir), saturação leve, passa-baixa suave
    this.body = ctx.createGain();
    this.body.gain.value = 0.8;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(1.5);
    shaper.oversample = '2x';
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    this.tone.frequency.value = 400;
    // segundo filtro fixo: corta o chiado que a saturação cria nos agudos
    const tone2 = ctx.createBiquadFilter();
    tone2.type = 'lowpass';
    tone2.Q.value = 0.5;
    tone2.frequency.value = 2200;
    // corpo na faixa que o alto-falante do celular reproduz (150–400 Hz) e nada de infrassom
    const chest = ctx.createBiquadFilter();
    chest.type = 'peaking';
    chest.frequency.value = 240;
    chest.Q.value = 0.8;
    chest.gain.value = 4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 38;
    hp.Q.value = 0.7;
    this.body.connect(shaper);
    shaper.connect(this.tone);
    this.tone.connect(tone2);
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
    this.rumbleA = osc(engineWave(ctx, 1), 0.5, -6);
    this.rumbleB = osc(engineWave(ctx, 2), 0.42, 7);
    // modulação de amplitude lenta: explosões levemente irregulares (burburinho)
    this.lope = ctx.createOscillator();
    this.lope.type = 'sine';
    this.lopeDepth = ctx.createGain();
    this.lopeDepth.gain.value = 0.15;
    this.lope.connect(this.lopeDepth);
    this.lopeDepth.connect(this.body.gain);

    // admissão: sopro grave que sobe com a rotação e com o acelerador (bem discreto)
    this.intake = ctx.createBiquadFilter();
    this.intake.type = 'bandpass';
    this.intake.Q.value = 0.7;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    loopNoise().connect(this.intake);
    this.intake.connect(this.intakeGain);
    this.intakeGain.connect(this.out);

    // nitro: turbina como sopro em banda que sobe com a rotação (sem tom puro, não apita)
    this.whine = ctx.createBiquadFilter();
    this.whine.type = 'bandpass';
    this.whine.Q.value = 5;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    loopNoise().connect(this.whine);
    this.whine.connect(this.whineGain);
    this.whineGain.connect(this.out);
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 2400;
    hiss.Q.value = 0.6;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    loopNoise().connect(hiss);
    hiss.connect(this.hissGain);
    this.hissGain.connect(this.out);

    // pneus cantando: ruído em banda média, sem tom puro (não "apita")
    this.squeal = ctx.createBiquadFilter();
    this.squeal.type = 'bandpass';
    this.squeal.Q.value = 3.5;
    this.squeal.frequency.value = 1000;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    loopNoise().connect(this.squeal);
    this.squeal.connect(this.squealGain);
    this.squealGain.connect(this.out);

    // vento em alta velocidade
    const wind = ctx.createBiquadFilter();
    wind.type = 'lowpass';
    wind.frequency.value = 600;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loopNoise().connect(wind);
    wind.connect(this.windGain);
    this.windGain.connect(this.out);

    for (const o of [this.rumbleA, this.rumbleB, this.lope]) o.start(t);
    this.lastT = t;
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
    if (g > this.gear) this.shiftUntil = t + 0.12; // troca: corta a aceleração por um instante
    this.gear = g;
    const inGear = (s - GEARS[g]) / (GEARS[g + 1] - GEARS[g]);
    let target = s < 0.03 ? 0.1 + throttle * 0.45 : 0.3 + inGear * 0.55 + (g === 0 ? throttle * 0.1 : 0);
    if (boosting) target += 0.08;
    const rate = target > this.rpm ? 4 : 6;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
    const rpm = this.rpm;
    const shifting = t < this.shiftUntil;
    const load = shifting ? 0.15 : throttle;

    // frequência de explosão: 55 Hz na lenta a ~230 Hz no corte; o ciclo do V8 fica uma oitava abaixo
    const f = 55 + rpm * 200;
    const k = 0.05;
    this.rumbleA.frequency.setTargetAtTime(f / 2, t, k);
    this.rumbleB.frequency.setTargetAtTime(f / 2, t, k);
    this.lope.frequency.setTargetAtTime(f / 8, t, k);
    this.lopeDepth.gain.setTargetAtTime(0.2 - rpm * 0.14, t, 0.1);
    // o som abre com carga (acelerador) e fecha ao soltar: dá o "vrum" sem ficar estridente
    this.tone.frequency.setTargetAtTime(480 + rpm * 1300 + load * 500 + (boosting ? 300 : 0), t, k);
    this.intake.frequency.setTargetAtTime(400 + rpm * 1200, t, k);
    this.intakeGain.gain.setTargetAtTime(load * (0.03 + rpm * 0.06), t, 0.06);
    this.out.gain.setTargetAtTime(0.3 + load * 0.22 + rpm * 0.1, t, shifting ? 0.03 : 0.08);

    this.whine.frequency.setTargetAtTime(1100 + rpm * 1100, t, 0.1);
    this.whineGain.gain.setTargetAtTime(boosting ? 0.18 : 0, t, boosting ? 0.08 : 0.25);
    this.hissGain.gain.setTargetAtTime(boosting ? 0.09 : 0, t, boosting ? 0.05 : 0.2);

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
    for (const g of [this.out, this.squealGain, this.whineGain, this.hissGain, this.windGain]) g.gain.setTargetAtTime(0, t, 0.1);
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
 * Motores dos rivais mais próximos: uma voz barata por rival (um oscilador de V8 + filtro + pan),
 * sem vento nem pneus. O ganho cai com a distância e o tom sobe/desce com a aproximação (Doppler),
 * então dá para ouvir alguém chegando por trás ou passando ao lado.
 */
export class RivalEngines {
  private voices: { osc: OscillatorNode; tone: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; rpm: number }[] = [];
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
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(engineWave(ctx, 3 + i));
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.Q.value = 0.5;
      tone.frequency.value = 600;
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
      this.voices.push({ osc, tone, gain, pan, rpm: 0.3 });
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
      const inGear = (s - GEARS[g]) / (GEARS[g + 1] - GEARS[g]);
      const target = 0.3 + inGear * 0.55;
      v.rpm += (target - v.rpm) * Math.min(1, dt * 5);
      const doppler = Math.max(0.93, Math.min(1.07, 343 / (343 - r.closing)));
      const f = (55 + v.rpm * 200) * doppler;
      v.osc.frequency.setTargetAtTime(f / 2, t, 0.06);
      v.tone.frequency.setTargetAtTime(420 + v.rpm * 1000 + r.throttle * 300, t, 0.06);
      const near = Math.max(0, 1 - r.dist / 45);
      v.gain.gain.setTargetAtTime(near * near * (0.25 + r.throttle * 0.15), t, 0.08);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.05);
    });
  }

  silence(): void {
    const a = audio();
    if (!a || !this.started) return;
    for (const v of this.voices) v.gain.gain.setTargetAtTime(0, a.ctx.currentTime, 0.1);
  }
}
