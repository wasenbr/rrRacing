/**
 * Trilha de rock sintetizada em tempo real (Web Audio): bateria, baixo e guitarra distorcida.
 * Os riffs são originais, no espírito do hard rock que embala o jogo de 1993.
 *
 * Notação dos riffs (uma letra por colcheia):
 *   número  acorde de quinta (power chord) N semitons acima da tônica
 *   x       "chug" abafado na tônica (palm mute)
 *   -       sustenta a nota anterior
 *   .       silêncio
 */
export interface Song {
  name: string;
  bpm: number;
  /** nota MIDI da tônica (40 = Mi grave) */
  root: number;
  /** riffs de 16 colcheias (2 compassos) */
  riffs: string[][];
  /** ordem das seções: índices em `riffs`, cada seção dura 4 compassos (riff tocado 2x) */
  form: number[];
  /** 'straight' = rock reto; 'shuffle' = boogie com swing */
  feel: 'straight' | 'shuffle';
}

const r = (s: string) => s.trim().split(/\s+/);

export const SONGS: Song[] = [
  {
    name: 'Chem Overdrive',
    bpm: 150,
    root: 40,
    feel: 'straight',
    riffs: [
      r('x x x x 3 - 5 - x x x x 7 - 5 3'),
      r('0 - . 0 3 - 0 5 - 3 0 - . 7 5 3'),
      r('0 - - - 8 - - - 10 - - - 5 - 7 -'),
    ],
    form: [0, 0, 1, 2, 0, 1, 2, 2],
  },
  {
    name: 'Drakonis Night',
    bpm: 138,
    root: 42,
    feel: 'straight',
    riffs: [
      r('0 - 0 - 3 - 1 - 0 - 0 - 6 - 5 -'),
      r('x x 0 x x 3 x x 5 x 3 x 1 - 0 -'),
      r('0 - - - 3 - - - 8 - - - 7 - 5 -'),
    ],
    form: [0, 1, 0, 2, 1, 1, 2, 0],
  },
  {
    name: 'Bogmire Boogie',
    bpm: 126,
    root: 45,
    feel: 'shuffle',
    riffs: [
      r('0 . 0 . 4 . 4 . 5 . 5 . 4 . 4 .'),
      r('5 . 5 . 9 . 9 . 10 . 10 . 9 . 9 .'),
      r('7 - - - 5 - - - 0 - 3 - 0 - x x'),
    ],
    form: [0, 0, 1, 0, 2, 0, 1, 2],
  },
  {
    name: 'Mojave Highway',
    bpm: 160,
    root: 43,
    feel: 'straight',
    riffs: [
      r('0 0 0 0 0 0 5 5 3 3 3 3 3 3 0 0'),
      r('x x x x 5 - 3 - x x x x 7 - 8 -'),
      r('10 - - - 8 - - - 7 - - - 5 - 3 -'),
    ],
    form: [0, 1, 0, 1, 2, 2, 0, 1],
  },
  {
    name: 'Inferno Riot',
    bpm: 172,
    root: 38,
    feel: 'straight',
    riffs: [
      r('x x 0 x x 1 x x 0 x x 6 - 5 - x'),
      r('0 - 1 - 0 - 6 5 0 - 1 - 3 - 1 -'),
      r('0 - - - 1 - - - 5 - - - 6 - 7 -'),
    ],
    form: [0, 0, 1, 1, 2, 0, 1, 2],
  },
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

export class SynthRock {
  private out: GainNode;
  private guitarBus: GainNode;
  private noise: AudioBuffer;
  private timer: number | null = null;
  private song: Song = SONGS[0];
  private step = 0;
  private nextTime = 0;
  private chordVoices: { osc: OscillatorNode[]; gain: GainNode } | null = null;

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
  ) {
    // mixagem: volume baixo + compressor para nunca saturar
    this.out = ctx.createGain();
    this.out.gain.value = 0.3;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.out.connect(comp);
    comp.connect(destination);
    // guitarra: distorção + "caixa" (passa-baixa e realce de médios)
    this.guitarBus = ctx.createGain();
    this.guitarBus.gain.value = 0.22;
    const pre = ctx.createBiquadFilter();
    pre.type = 'highpass';
    pre.frequency.value = 90;
    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(60);
    dist.oversample = '2x';
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3200;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 900;
    mid.gain.value = 4;
    this.guitarBus.connect(pre);
    pre.connect(dist);
    dist.connect(cab);
    cab.connect(mid);
    mid.connect(this.out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  play(song: Song): void {
    this.stop();
    this.song = song;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.releaseChord(this.ctx.currentTime);
  }

  /* ---------------- sequenciador ---------------- */

  private eighth(): number {
    return 60 / this.song.bpm / 2;
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.stepTime(this.nextTime));
      this.nextTime += this.eighth();
      this.step++;
    }
  }

  /** swing: no "boogie", a segunda colcheia de cada tempo atrasa */
  private stepTime(t: number): number {
    return this.song.feel === 'shuffle' && this.step % 2 === 1 ? t + this.eighth() / 3 : t;
  }

  private playStep(step: number, t: number): void {
    const s = this.song;
    const sectionSteps = 32; // 4 compassos
    const section = Math.floor(step / sectionSteps) % s.form.length;
    const inSection = step % sectionSteps;
    const riff = s.riffs[s.form[section]];
    const tok = riff[inSection % riff.length];
    const e = this.eighth();

    // bateria
    const beat = inSection % 8;
    const lastBar = inSection >= 24;
    if (inSection === 0) this.crash(t);
    if (lastBar && section % 2 === 1 && inSection >= 28) {
      // virada: caixa em semicolcheias
      this.snare(t, 0.7);
      this.snare(t + e / 2, 0.5);
    } else {
      if (beat === 0 || beat === 4 || (beat === 5 && s.feel === 'straight') || (beat === 3 && section % 2 === 1)) this.kick(t);
      if (beat === 2 || beat === 6) this.snare(t, 1);
      this.hat(t, beat % 2 === 0 ? 0.35 : 0.2, false);
    }

    // guitarra e baixo
    if (tok === '-') return;
    if (tok === '.') {
      this.releaseChord(t);
      return;
    }
    if (tok === 'x') {
      this.releaseChord(t);
      this.chug(s.root, t);
      this.bass(s.root, t, e * 0.9);
      return;
    }
    const n = Number(tok);
    // quanto tempo sustenta (conta os "-")
    let hold = 1;
    for (let i = inSection + 1; i < inSection + 16 && riff[i % riff.length] === '-'; i++) hold++;
    this.chord(s.root + n, t, e * hold);
    this.bass(s.root + n - 12, t, e * Math.min(hold, 2) * 0.95);
    if (hold > 2) for (let i = 2; i < hold; i += 2) this.bass(s.root + n - 12, t + e * i, e * 1.8);
  }

  /* ---------------- instrumentos ---------------- */

  private env(t: number, peak: number, attack: number, decay: number, dest: AudioNode = this.out): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(this.env(t, 0.9, 0.002, 0.28));
    o.start(t);
    o.stop(t + 0.32);
  }

  private snare(t: number, vol: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    n.connect(bp);
    bp.connect(this.env(t, 0.55 * vol, 0.001, 0.16));
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.2);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(this.env(t, 0.3 * vol, 0.001, 0.09));
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, vol: number, open: boolean): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    n.connect(hp);
    hp.connect(this.env(t, 0.18 * vol, 0.001, open ? 0.3 : 0.04));
    n.start(t, Math.random() * 0.5);
    n.stop(t + (open ? 0.35 : 0.06));
  }

  private crash(t: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4500;
    n.connect(hp);
    hp.connect(this.env(t, 0.22, 0.002, 1.4));
    n.start(t);
    n.stop(t + 1.5);
  }

  private bass(note: number, t: number, dur: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(note);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    o.connect(lp);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.008);
    g.gain.setValueAtTime(0.28, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** acorde de quinta sustentado (tônica, quinta, oitava) */
  private chord(note: number, t: number, dur: number): void {
    this.releaseChord(t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.01);
    g.gain.setTargetAtTime(0.7, t + 0.05, 0.3);
    g.connect(this.guitarBus);
    const osc = [0, 7, 12].flatMap((iv) =>
      [-6, 6].map((det) => {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(note + iv);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        return o;
      }),
    );
    this.chordVoices = { osc, gain: g };
    // corta no fim da duração, a menos que outro evento corte antes
    const end = t + dur;
    g.gain.setValueAtTime(0.7, end - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.04);
    for (const o of osc) o.stop(end + 0.06);
  }

  private releaseChord(t: number): void {
    if (!this.chordVoices) return;
    const { osc, gain } = this.chordVoices;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.0001, t, 0.015);
      for (const o of osc) o.stop(t + 0.08);
    } catch {
      /* já parou */
    }
    this.chordVoices = null;
  }

  /** nota abafada curta (palm mute) */
  private chug(note: number, t: number): void {
    const g = this.env(t, 0.9, 0.004, 0.09, this.guitarBus);
    for (const iv of [0, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(note + iv);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.12);
    }
  }
}
