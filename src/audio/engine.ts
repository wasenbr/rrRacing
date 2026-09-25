import { audio, isAudioLite } from './context';
import { ENGINE_LOOPS, getBuffer, loadBuffer, loopBounds } from './samples';

/**
 * Loops de motor GRAVADO (V8 de um Chevrolet Caprice, romanholtwick, CC0; ver CREDITOS.md) e a
 * frequência de queima de cada um. A gravação só tem rotações baixas (~44 e ~58 Hz); motor_1,
 * motor_2, motor_3 e motor_4 são o loop de ~58 Hz levado a ~81, ~120, ~170 e ~240 Hz (rubberband,
 * formantes preservados: o corpo grave do escapamento continua no giro de corrida). Nenhum loop toca
 * mais que ±30% fora do próprio tom (REC_MAX_SHIFT): acima de ~290 Hz de queima (nitro) a
 * gravação sai e a síntese de ciclos de V8 assume.
 */
const REC_LOOP_F: Record<(typeof ENGINE_LOOPS)[number], number> = {
  motor_lenta: 44,
  motor_0: 58,
  motor_1: 58 * 1.4,
  motor_2: 120,
  motor_3: 170,
  motor_4: 240,
};
const REC_MAX_SHIFT = 1.3;
/** Intervalo mínimo (s) entre atualizações dos parâmetros dos motores. */
const AUDIO_TICK = 1 / 30;
/** Faixa de queima (Hz) em que a gravação cede lugar à síntese (motor_4 x 1,3 = 312 Hz): só o nitro é síntese pura. */
const REC_FADE: [number, number] = [285, 312];

/** Peso da gravação (0..1) para a frequência de queima `f`. */
export function recWeight(f: number): number {
  const x = (f - REC_FADE[0]) / (REC_FADE[1] - REC_FADE[0]);
  return x <= 0 ? 1 : x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
}

/** Taxa de reprodução de um loop gravado de frequência `loopF` para soar em `f` (±30% no máximo). */
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

/**
 * Liga/desliga uma camada do grafo pelo peso: calada (peso ~0) há mais de `QUIET_OFF` s, a saída
 * é desconectada (os nós acima deixam de ser processados pela thread de áudio); volta a ligar
 * assim que o peso sobe. O ganho já está em ~0 quando desliga, então não estala.
 */
const QUIET_OFF = 1.2;
const QUIET_LEVEL = 1e-3;
class LayerGate {
  private on = true;
  private quietSince = -1;
  constructor(
    private readonly node: AudioNode,
    private readonly dest: AudioNode,
  ) {}
  set(level: number, t: number): void {
    if (level > QUIET_LEVEL) {
      this.quietSince = -1;
      if (!this.on) {
        this.node.connect(this.dest);
        this.on = true;
      }
      return;
    }
    if (this.quietSince < 0) this.quietSince = t;
    else if (this.on && t - this.quietSince > QUIET_OFF) {
      try {
        this.node.disconnect(this.dest);
      } catch {
        /* já desconectado */
      }
      this.on = false;
    }
  }
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
  // rodada 11: defasagem e jitter maiores (o giro de corrida soava como zumbido regular)
  const cylLag = [0, 0.1, -0.06, 0.13, 0.03, -0.09, 0.07, -0.11];
  const pos: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    pos.push(acc + cylLag[i % 8] + (rnd() * 2 - 1) * 0.07);
    acc += 1;
  }
  const tau1 = heavy ? 0.0035 : 0.005;
  const tau2 = heavy ? 0.0022 : 0.0028;
  const tauN = heavy ? 0.004 : 0.0028;
  const tail = Math.floor(sr * 0.03);
  for (let i = 0; i < n; i++) {
    const start = Math.floor((pos[i] / n) * len + len) % len;
    const amp = cylAmp[i % 8] * (0.7 + rnd() * 0.6);
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
 *  - grave: pilha de harmônicos da meia-ordem que sobe com a rotação e cresce com a carga;
 *  - nitro: +15% de giro, mais drive e formante alto aberto, sopro grave (300–900 Hz), "whoosh"
 *    e estalos de escape na ignição, sem chiado agudo.
 * A frequência de queima vai de ~50 Hz (lenta) a ~310 Hz (corte): a subida de giro é clara.
 * (Amostras CC0 de motor testadas — OpenGameArt/Freesound — eram só rumor sub-grave ou vento de
 * microfone; a síntese em camadas soou melhor.)
 */
export class EngineSound {
  private started = false;
  /** já ligado uma vez (depois do gesto do usuário): update() religa sozinho depois de um stop() */
  private armed = false;
  /** geração do grafo (um carregamento atrasado da gravação não entra num grafo já parado) */
  private gen = 0;
  /** fontes em execução (paradas em stop()) */
  private srcs: AudioScheduledSourceNode[] = [];
  private cycLight!: AudioBufferSourceNode;
  private cycHeavy!: AudioBufferSourceNode;
  private lightGain!: GainNode;
  private heavyGain!: GainNode;
  private sub!: OscillatorNode;
  private subGain!: GainNode;
  private subTone!: BiquadFilterNode;
  /** ordem de rotação do virabrequim (f/4): o "corpo" abaixo de 100 Hz no giro de corrida */
  private crank!: OscillatorNode;
  private crankGain!: GainNode;
  /** peito do ronco (~110–170 Hz): +4 dB no nitro para ele não afinar */
  private chest!: BiquadFilterNode;
  /** AM de combustão: ruído lento acompanhando a rotação, explosões de força irregular */
  private combLp!: BiquadFilterNode;
  /** ganho antes da saturação do ronco: o nitro "abre" o drive */
  private drive!: GainNode;
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
  /** corte de 800–1500 Hz que cresce com a rotação (o giro de corrida soava "médio", sem corpo) */
  private midCut!: BiquadFilterNode;
  /** loops gravados (quando carregados): fonte, ganho e frequência de queima original */
  private rec: { src: AudioBufferSourceNode; gain: GainNode; f: number; gate: LayerGate }[] = [];
  /** camadas que passam a maior parte do tempo caladas (nitro, pneus, vento, admissão, gravação) */
  private gates = new Map<GainNode, LayerGate>();
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
    this.armed = true;
    const gen = ++this.gen;
    this.srcs = [];
    const { ctx } = a;
    const t = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.midCut = ctx.createBiquadFilter();
    this.midCut.type = 'peaking';
    this.midCut.frequency.value = 1100;
    this.midCut.Q.value = 0.7;
    this.midCut.gain.value = 0;
    this.out.connect(this.midCut);
    this.midCut.connect(a.engine);
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
      if (gen !== this.gen || bufs.some((b) => !b) || this.rec.length) return; // sem gravação: fica só a síntese
      const t0 = ctx.currentTime;
      this.rec = bufs.map((b, i) => {
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const [l0, l1] = loopBounds(b as AudioBuffer);
        src.loopStart = l0;
        src.loopEnd = l1;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(this.recTone);
        src.start(t0, l0 + Math.random() * (l1 - l0));
        this.srcs.push(src);
        // mesma instabilidade lenta de rotação da síntese: as camadas andam juntas, sem batimento
        this.drift.connect(src.detune);
        return { src, gain, f: REC_LOOP_F[ENGINE_LOOPS[i]], gate: new LayerGate(gain, this.recTone) };
      });
      this.synthUnderRec = 0.12;
    };

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // UM loop de ruído compartilhado por todas as camadas (antes eram 7 fontes iguais tocando em
    // paralelo): cada camada tem o próprio filtro, então o ruído correlacionado não se percebe
    const sharedNoise = ctx.createBufferSource();
    sharedNoise.buffer = this.noiseBuf;
    sharedNoise.loop = true;
    sharedNoise.start(t, Math.random());
    const loopNoise = () => sharedNoise;
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
    shaper.oversample = isAudioLite() ? 'none' : '2x';
    this.tone = biquad('lowpass', 400, 0.6);
    this.formant1 = biquad('peaking', 220, 1.2, 5);
    this.formant2 = biquad('peaking', 800, 1.6, 3);
    const tone2 = biquad('lowpass', 3200, 0.5);
    this.chest = biquad('peaking', 150, 0.9, 3);
    const chest = this.chest;
    const hp = biquad('highpass', 40, 0.7);
    this.drive = ctx.createGain();
    this.drive.gain.value = 1;
    this.body.connect(this.drive);
    this.drive.connect(shaper);
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

    // grave com tom: pilha de harmônicos da meia-ordem (f/2, f, 3f/2, 2f...) que SOBE com a
    // rotação (antes era uma senoide só, e no giro médio/alto o grave parecia parado). Passa-baixa
    // que acompanha a rotação (~3,5 f) e ainda entra de leve no ronco (ganha os formantes e o lope)
    this.sub = ctx.createOscillator();
    const re = new Float32Array([0, 1, 0.75, 0.45, 0.4, 0.22, 0.18, 0.1, 0.08]);
    this.sub.setPeriodicWave(ctx.createPeriodicWave(re, new Float32Array(re.length), { disableNormalization: false }));
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.12;
    this.subTone = biquad('lowpass', 300, 0.6);
    const subHp = biquad('highpass', 38, 0.7);
    this.sub.connect(this.subGain);
    this.subGain.connect(this.subTone);
    this.subTone.connect(subHp);
    subHp.connect(this.out);
    const subIntoBody = ctx.createGain();
    subIntoBody.gain.value = 0.25;
    this.subTone.connect(subIntoBody);
    subIntoBody.connect(this.body);
    // virabrequim (f/4): senoide que cresce com a rotação; no giro de corrida cai em 50–90 Hz e
    // devolve o corpo que faltava (graves 17–26 dB abaixo dos médios)
    this.crank = ctx.createOscillator();
    this.crank.type = 'sine';
    this.crankGain = ctx.createGain();
    this.crankGain.gain.value = 0;
    const crankHp = biquad('highpass', 35, 0.7);
    this.crank.connect(this.crankGain);
    this.crankGain.connect(crankHp);
    crankHp.connect(this.out);
    // AM de combustão: ruído passa-baixa (~f/4) somado ao ganho do ronco (cada explosão com força
    // diferente, sem a regularidade de um oscilador)
    this.combLp = biquad('lowpass', 20, 0.7);
    const combDepth = ctx.createGain();
    combDepth.gain.value = isAudioLite() ? 0 : 7;
    loopNoise().connect(this.combLp);
    this.combLp.connect(combDepth);
    combDepth.connect(this.body.gain);

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

    for (const o of [this.lope, this.fire, this.sub, this.crank]) {
      this.drift.connect(o.detune);
      o.start(t);
    }
    for (const g of [this.intakeGain, this.blowGain, this.hissGain, this.squealGain, this.windGain]) this.gates.set(g, new LayerGate(g, this.out));
    this.cycLight.start(t, Math.random() * 2);
    this.cycHeavy.start(t, Math.random() * 2);
    this.srcs.push(sharedNoise, this.cycLight, this.cycHeavy, this.lope, this.fire, this.sub);
    this.srcs.push(this.crank);
    this.lastT = t;
  }

  /**
   * Desliga o motor de verdade (menu, resultados, pausa): o volume cai em ~0,3 s, as fontes param
   * depois da rampa e o grafo sai do barramento — a thread de áudio deixa de processar o motor
   * (antes ele seguia rodando calado por trás dos menus). O próximo update() (corrida) religa.
   */
  stop(): void {
    const a = audio();
    if (!a || !this.started) return;
    this.started = false;
    this.gen++;
    const t = a.ctx.currentTime;
    const out = this.out;
    const midCut = this.midCut;
    out.gain.setTargetAtTime(0, t, 0.08);
    const srcs = this.srcs;
    this.srcs = [];
    for (const s of srcs) {
      try {
        s.stop(t + 0.6);
      } catch {
        /* já parada */
      }
    }
    const release = () => {
      try {
        out.disconnect();
        midCut.disconnect();
      } catch {
        /* já desconectado */
      }
    };
    if (srcs.length) srcs[0].onended = release;
    else release();
    this.rec = [];
    this.gates.clear();
    this.synthUnderRec = 1;
    this.wasBoosting = false;
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
    // estalos de escape (backfire): 4–6 pipocos secos e graves nos primeiros ~0,6 s
    const pops = 4 + Math.floor(Math.random() * 3);
    let tt = t + 0.03;
    for (let i = 0; i < pops; i++) {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const pb = ctx.createBiquadFilter();
      pb.type = 'bandpass';
      pb.frequency.value = 280 + Math.random() * 450;
      pb.Q.value = 0.9;
      const pg = ctx.createGain();
      const peak = (0.9 - i * 0.1) * (0.7 + Math.random() * 0.3);
      pg.gain.setValueAtTime(0.0001, tt);
      pg.gain.exponentialRampToValueAtTime(peak, tt + 0.002);
      pg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.035 + Math.random() * 0.03);
      s.connect(pb);
      pb.connect(pg);
      pg.connect(this.drive);
      s.start(tt, Math.random() * 1.5);
      s.stop(tt + 0.08);
      tt += 0.06 + Math.random() * 0.1;
    }
  }

  /**
   * @param speedRatio velocidade / velocidade máxima (0..~1.3)
   * @param throttle acelerador 0..1
   * @param boosting nitro ligado
   * @param slip derrapagem 0..1 (pneus cantando)
   */
  update(speedRatio: number, throttle: number, boosting: boolean, slip = 0): void {
    const a = audio();
    if (!a) return;
    if (!this.started) {
      // parado por stop(): volta a soar ao retomar a corrida
      if (!this.armed) return;
      this.start();
    }
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
    if (boosting) target += 0.15; // nitro: +15% de giro (ruge acima do corte normal)
    const rate = target > this.rpm ? 5 : 6;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
    const rpm = Math.max(0, Math.min(1.15, this.rpm));
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
        r.gate.set(w * recW, t);
      });
      this.recTone.frequency.setTargetAtTime(700 + Math.min(1, rpm) * 2000 + load * 800, t, k);
      // giro alto e nitro mais fortes (a gravação aguda é mais magra que a lenta; o nitro precisa rugir por cima)
      const up = Math.max(0, Math.min(1, (rpm - 0.4) / 0.3));
      this.recBus.gain.setTargetAtTime(recW * REC_LEVEL * (0.75 + load * 0.35) * (1 + 0.35 * up) * (boosting ? 1.35 : 1), t, 0.06);
    }
    this.sub.frequency.setTargetAtTime(f / 2, t, k);
    this.subTone.frequency.setTargetAtTime(f * 3.5, t, k);
    this.crank.frequency.setTargetAtTime(f / 4, t, k);
    this.combLp.frequency.setTargetAtTime(Math.max(12, f / 4), t, k);
    // nitro: mais drive na saturação (o ronco rasga), sem exagero (drive alto afinava o timbre)
    this.drive.gain.setTargetAtTime(boosting ? 1.5 : 1, t, boosting ? 0.06 : 0.25);
    // peito: acompanha a meia-ordem e ganha +4 dB no nitro (o nitro não pode "afinar")
    this.chest.frequency.setTargetAtTime(Math.max(110, Math.min(170, f / 2)), t, k);
    // rodada 12: +4 dB também no giro alto (piso de corpo onde a gravação já saiu)
    const high = Math.max(0, Math.min(1, (rpm - 0.4) / 0.3));
    this.chest.gain.setTargetAtTime(Math.min(9, 3 + high * 4 + (boosting ? 4 : 0)), t, 0.08);
    this.midCut.gain.setTargetAtTime(-7 * high, t, 0.1);
    this.fire.frequency.setTargetAtTime(f, t, k);
    this.lope.frequency.setTargetAtTime(f / 8, t, k);
    this.lopeDepth.gain.setTargetAtTime(0.22 - rpm * 0.16, t, 0.1);
    // o timbre abre com rotação e carga: grave e redondo na lenta, rasgado no alto giro
    this.tone.frequency.setTargetAtTime(380 + rpm * 1700 + load * 600 + (boosting ? 300 : 0), t, k);
    this.formant1.frequency.setTargetAtTime(190 + rpm * 260, t, k);
    this.formant1.gain.setTargetAtTime(4 + load * 3, t, 0.08);
    this.formant2.frequency.setTargetAtTime(650 + rpm * 950, t, k);
    // formante alto limitado (no nitro subia +4 dB e o ronco virava chiado de médios)
    this.formant2.gain.setTargetAtTime(Math.min(boosting ? 5 : 6, 1 + load * 4 + rpm * 2) - 3 * high, t, 0.08);
    this.fireBand.frequency.setTargetAtTime(350 + rpm * 900, t, k);
    // queima: dominante na síntese pura; com a gravação vira só textura por cima
    this.fireGain.gain.setTargetAtTime((0.55 + load * 1.1) * (1 - recW * 0.55) * (1 - 0.35 * high), t, 0.05);
    // sub: a gravação já tem o grave; outra fonte no mesmo tom por baixo só criaria batimento
    // o grave cresce com a rotação e a carga (antes caía: o giro alto ficava sem peso)
    // rodada 11: cresce bem mais com a rotação (o giro de corrida ficava sem corpo abaixo de 150 Hz)
    const rr = Math.min(1, rpm);
    // piso de corpo no giro alto: sem a gravação, o sub nunca fica abaixo de 0,35
    this.subGain.gain.setTargetAtTime(Math.max(0.35 * high, (0.1 + rr * 0.2 + load * 0.05) * (1 - recW * 0.8)), t, 0.1);
    this.crankGain.gain.setTargetAtTime(Math.max(0, rr - 0.2) * (0.35 + load * 0.15) * (1 - recW * 0.8), t, 0.1);
    this.intake.frequency.setTargetAtTime(350 + rpm * 900, t, k);
    const intakeLevel = load * (0.02 + rpm * 0.07);
    this.intakeGain.gain.setTargetAtTime(intakeLevel, t, 0.06);
    this.out.gain.setTargetAtTime(0.3 + load * 0.2 + rpm * 0.14, t, shifting ? 0.03 : 0.08);

    this.blow.frequency.setTargetAtTime(300 + Math.min(1, rpm) * 600, t, 0.1);
    this.blowGain.gain.setTargetAtTime(boosting ? 0.3 : 0, t, boosting ? 0.08 : 0.25);
    this.hissGain.gain.setTargetAtTime(boosting ? 0.035 : 0, t, boosting ? 0.05 : 0.2);

    // pneus: só a derrapagem forte canta (curvas normais ficam em silêncio)
    const sq = Math.max(0, Math.min(1, (slip - 0.3) / 0.7));
    this.squealGain.gain.setTargetAtTime(sq * 0.45, t, 0.06);
    this.squeal.frequency.setTargetAtTime(900 + sq * 250, t, 0.1);
    const windLevel = Math.max(0, s - 0.5) * 0.14;
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.2);
    // camadas caladas saem do grafo (menos trabalho para a thread de áudio)
    this.gates.get(this.intakeGain)?.set(intakeLevel, t);
    this.gates.get(this.blowGain)?.set(boosting ? 1 : 0, t);
    this.gates.get(this.hissGain)?.set(boosting ? 1 : 0, t);
    this.gates.get(this.squealGain)?.set(sq, t);
    this.gates.get(this.windGain)?.set(windLevel, t);
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
    rec: { src: AudioBufferSourceNode; gain: GainNode; f: number; gate: LayerGate }[];
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
  private armed = false;
  private gen = 0;
  /** loop de ruído compartilhado pelas vozes (parado em stop()) */
  private noiseSrc: AudioBufferSourceNode | null = null;
  private lastT = 0;

  constructor(private readonly count: number) {}

  start(): void {
    const a = audio();
    if (!a || this.started) return;
    this.started = true;
    this.armed = true;
    const gen = ++this.gen;
    const { ctx } = a;
    const t = ctx.currentTime;
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const pulses = pulseCurve();
    // um loop de ruído só para todas as vozes (cada uma filtra o seu)
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noise;
    noiseSrc.loop = true;
    noiseSrc.start(t, Math.random());
    this.noiseSrc = noiseSrc;
    // modo leve (toque / qualidade baixa): só o rival mais próximo tem motor
    const count = isAudioLite() ? Math.min(1, this.count) : this.count;
    for (let i = 0; i < count; i++) {
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
      noiseSrc.connect(fireBand);
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
      this.voices.push({ cyc, cycGain: cg, rec: [], fire, fireBand, fireGain, tone, gain, pan, rpm: 0.3, on: true, quietSince: -1 });
    }
    // gravação: os mesmos loops do motor do jogador (timbre igual de perto), passando pelo mesmo
    // filtro de distância e pan de cada voz
    const attach = (bufs: (AudioBuffer | null)[]) => {
      if (gen !== this.gen || bufs.some((b) => !b) || this.voices.some((v) => v.rec.length)) return;
      const t0 = ctx.currentTime;
      for (const v of this.voices) {
        v.rec = bufs.map((b, i) => {
          const src = ctx.createBufferSource();
          src.buffer = b;
          src.loop = true;
          const [l0, l1] = loopBounds(b as AudioBuffer);
          src.loopStart = l0;
          src.loopEnd = l1;
          const g = ctx.createGain();
          g.gain.value = 0;
          src.connect(g);
          g.connect(v.tone);
          src.start(t0, l0 + Math.random() * (l1 - l0));
          // loop calado sai do grafo (5 loops por voz: só os 2 vizinhos da rotação tocam)
          return { src, gain: g, f: REC_LOOP_F[ENGINE_LOOPS[i]], gate: new LayerGate(g, v.tone) };
        });
      }
    };
    const ready = ENGINE_LOOPS.map((n) => getBuffer(`audio/motor/${n}.mp3`));
    if (ready.every((b) => b)) attach(ready);
    else void Promise.all(ENGINE_LOOPS.map((n) => loadBuffer(ctx, `audio/motor/${n}.mp3`, false))).then(attach);
    this.lastT = t;
  }

  /**
   * Desliga as vozes de verdade (menu, resultados, pausa): volume a zero, fontes paradas depois da
   * rampa e fora do barramento. O próximo update() (corrida) religa.
   */
  stop(): void {
    const a = audio();
    if (!a || !this.started) return;
    this.started = false;
    this.gen++;
    const t = a.ctx.currentTime;
    const voices = this.voices;
    this.voices = [];
    const srcs: AudioScheduledSourceNode[] = this.noiseSrc ? [this.noiseSrc] : [];
    this.noiseSrc = null;
    for (const v of voices) {
      v.gain.gain.setTargetAtTime(0, t, 0.08);
      srcs.push(v.cyc, v.fire, ...v.rec.map((r) => r.src));
    }
    for (const s of srcs) {
      try {
        s.stop(t + 0.6);
      } catch {
        /* já parada */
      }
    }
    const release = () => {
      for (const v of voices) {
        try {
          v.pan.disconnect();
        } catch {
          /* já desconectado */
        }
      }
    };
    if (srcs.length) srcs[0].onended = release;
    else release();
  }

  /** `rivals` já ordenados do mais próximo ao mais distante (usa os primeiros). */
  update(rivals: RivalEngineInput[]): void {
    const a = audio();
    if (!a) return;
    if (!this.started) {
      if (!this.armed) return;
      this.start();
    }
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
          rr.gate.set(recW * w, t);
        });
      }
      v.fire.frequency.setTargetAtTime(f, t, 0.06);
      v.fireBand.frequency.setTargetAtTime(350 + v.rpm * 900, t, 0.06);
      v.fireGain.gain.setTargetAtTime((0.35 + r.throttle * 0.6) * (1 - recW * 0.55), t, 0.06);
      // longe, abafado; perto, abre (distância também soa pelo timbre, não só pelo volume)
      const near = Math.max(0, 1 - r.dist / 45);
      v.tone.frequency.setTargetAtTime(300 + near * 500 + v.rpm * 1000 + r.throttle * 300, t, 0.06);
      // rodada 11: estava -20 dB a 3 m (inaudível); +13 dB (a voz do rival não tem o corpo nem os
      // formantes do motor do jogador: x2 de compensação) e o acelerador pesa mais
      const level = near * near * (0.45 + r.throttle * 0.25) * 2;
      v.gain.gain.setTargetAtTime(level, t, 0.08);
      this.park(v, t, a.engine, level);
      // pan até ±0,8: em ±1 o outro canal ficava em silêncio (soava "furado" no fone)
      v.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, r.pan)), t, 0.05);
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
