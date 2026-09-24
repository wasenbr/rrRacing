import { isAudioLite } from './context';

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
  /**
   * Levada da bateria (cada planeta tem a sua): 'rock' reto, 'gallop' (galope de metal),
   * 'punk' (bumbo em todo tempo), 'heavy' (meio-tempo arrastado), 'boogie' (shuffle).
   */
  groove: 'rock' | 'gallop' | 'punk' | 'heavy' | 'boogie';
  /** seção do `form` tocada como ponte (bateria em meio-tempo, guitarra rarefeita) */
  bridge: number;
  /**
   * Timbre de cada planeta: `drive` (distorção da guitarra), `cab` (corte da caixa, Hz: mais baixo =
   * mais escuro), `bass` (onda do baixo) e `room` (quanto de sala).
   */
  tone: { drive: number; cab: number; bass: OscillatorType; room: number };
}

/** Papel de cada seção: muda densidade e dinâmica (intro → riff → refrão → ponte). */
type Role = 'intro' | 'riff' | 'chorus' | 'bridge';
const ROLE_VEL: Record<Role, number> = { intro: 0.45, riff: 0.72, chorus: 1, bridge: 0.55 };
const BRIDGE_MOVE = [0, 0, 5, 3];
/** Volume de cada seção depois do compressor (intro e ponte recuam, refrão abre). */
const SECTION_GAIN: Record<Role, number> = { intro: 0.55, riff: 0.8, chorus: 1.12, bridge: 0.62 };

const r = (s: string) => s.trim().split(/\s+/);

export const SONGS: Song[] = [
  {
    name: 'Chem Overdrive',
    tone: { drive: 60, cab: 3600, bass: 'sawtooth', room: 0.35 },
    bpm: 150,
    root: 40,
    feel: 'straight',
    groove: 'rock',
    bridge: 5,
    riffs: [
      r('x x x x 3 - 5 - x x x x 7 - 5 3'),
      r('0 - . 0 3 - 0 5 - 3 0 - . 7 5 3'),
      r('0 - - - 8 - - - 10 - - - 5 - 7 -'),
    ],
    form: [0, 0, 1, 2, 0, 1, 2, 2],
  },
  {
    name: 'Drakonis Night',
    tone: { drive: 85, cab: 3000, bass: 'square', room: 0.5 },
    bpm: 138,
    root: 42,
    feel: 'straight',
    groove: 'gallop',
    bridge: 4,
    riffs: [
      r('0 - 0 - 3 - 1 - 0 - 0 - 6 - 5 -'),
      r('x x 0 x x 3 x x 5 x 3 x 1 - 0 -'),
      r('0 - - - 3 - - - 8 - - - 7 - 5 -'),
    ],
    form: [0, 1, 0, 2, 1, 1, 2, 0],
  },
  {
    name: 'Bogmire Boogie',
    tone: { drive: 18, cab: 2600, bass: 'triangle', room: 0.3 },
    bpm: 126,
    root: 45,
    feel: 'shuffle',
    groove: 'boogie',
    bridge: 5,
    riffs: [
      r('0 . 0 . 4 . 4 . 5 . 5 . 4 . 4 .'),
      r('5 . 5 . 9 . 9 . 10 . 10 . 9 . 9 .'),
      r('7 - - - 5 - - - 0 - 3 - 0 - x x'),
    ],
    form: [0, 0, 1, 0, 2, 0, 1, 2],
  },
  {
    name: 'Mojave Highway',
    tone: { drive: 40, cab: 4400, bass: 'sawtooth', room: 0.25 },
    bpm: 160,
    root: 43,
    feel: 'straight',
    groove: 'punk',
    bridge: 5,
    riffs: [
      r('0 0 0 0 0 0 5 5 3 3 3 3 3 3 0 0'),
      r('x x x x 5 - 3 - x x x x 7 - 8 -'),
      r('10 - - - 8 - - - 7 - - - 5 - 3 -'),
    ],
    form: [0, 1, 0, 1, 2, 2, 0, 1],
  },
  {
    name: 'Inferno Riot',
    tone: { drive: 120, cab: 3300, bass: 'square', room: 0.3 },
    bpm: 172,
    root: 38,
    feel: 'straight',
    groove: 'punk',
    bridge: 4,
    riffs: [
      r('x x 0 x x 1 x x 0 x x 6 - 5 - x'),
      r('0 - 1 - 0 - 6 5 0 - 1 - 3 - 1 -'),
      r('0 - - - 1 - - - 5 - - - 6 - 7 -'),
    ],
    form: [0, 0, 1, 1, 2, 0, 1, 2],
  },
  {
    name: 'Nho Descent',
    tone: { drive: 70, cab: 2400, bass: 'sawtooth', room: 0.6 },
    bpm: 132,
    root: 38,
    feel: 'straight',
    groove: 'heavy',
    bridge: 5,
    riffs: [
      r('x . x x 0 - x . x x 3 - x 1 - x'),
      r('0 - 0 - 5 - 3 - 0 - 0 - 6 - 7 -'),
      r('0 - - - 10 - - - 8 - - - 7 - 6 -'),
    ],
    form: [0, 0, 1, 0, 2, 2, 1, 2],
  },
  {
    name: 'Garage Grind',
    tone: { drive: 25, cab: 3900, bass: 'triangle', room: 0.2 },
    bpm: 112,
    root: 40,
    feel: 'shuffle',
    groove: 'boogie',
    bridge: 4,
    riffs: [
      r('0 . 0 . 5 . 0 . 7 . 5 . 3 . 0 .'),
      r('x x 0 . x x 3 . x x 5 . 3 - 0 -'),
      r('5 - - - 3 - - - 0 - - - x x x x'),
    ],
    form: [0, 1, 0, 2, 0, 1, 2, 2],
  },
];

/** Escala pentatônica menor (semitons) usada nos solos. */
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

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

/** Resposta ao impulso de uma sala pequena (reverb gerado por código). */
function roomImpulse(ctx: BaseAudioContext, seconds: number, decay: number, channels = 2): AudioBuffer {
  const n = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(channels, n, ctx.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return buf;
}

/** Um lado da guitarra dobrada: distorção + "caixa" + pan. */
interface GuitarSide {
  input: GainNode;
  dist: WaveShaperNode;
  cab: BiquadFilterNode;
}

function guitarSide(ctx: BaseAudioContext, dest: AudioNode, pan: number, delay: number, drive: number, lite = false): GuitarSide {
  const input = ctx.createGain();
  const pre = ctx.createBiquadFilter();
  pre.type = 'highpass';
  pre.frequency.value = 100;
  const dist = ctx.createWaveShaper();
  dist.curve = distortionCurve(drive);
  // modo leve: sem oversampling (o 2x dobra o custo de CPU de cada guitarra)
  dist.oversample = lite ? 'none' : '2x';
  const cab = ctx.createBiquadFilter();
  cab.type = 'lowpass';
  cab.frequency.value = 3600;
  cab.Q.value = 0.9;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1100;
  mid.gain.value = 5;
  const scoop = ctx.createBiquadFilter();
  scoop.type = 'peaking';
  scoop.frequency.value = 400;
  scoop.gain.value = -3;
  const d = ctx.createDelay(0.05);
  d.delayTime.value = delay;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  input.connect(pre);
  pre.connect(dist);
  dist.connect(cab);
  cab.connect(mid);
  mid.connect(scoop);
  scoop.connect(d);
  d.connect(p);
  p.connect(dest);
  return { input, dist, cab };
}

export class SynthRock {
  private out: GainNode;
  /** guitarra base dobrada: esquerda e direita tocam a mesma parte, levemente diferentes */
  private guitarL: GainNode;
  private guitarR: GainNode;
  private lead: GainNode;
  private sides: GuitarSide[] = [];
  private guitarBus: GainNode;
  private section: GainNode;
  private reverb: GainNode;
  /** dinâmica da seção atual (intro mais baixa, refrão cheio): guitarra e baixo seguem a bateria */
  private roleLevel = 1;
  private noise: AudioBuffer;
  private timer: number | null = null;
  private song: Song = SONGS[0];
  private step = 0;
  private nextTime = 0;
  private chordVoices: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private seed = 1;
  /** porta de saída: com a antecipação longa do agendador, o stop() precisa calar o que já foi agendado */
  private gate: GainNode;

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
  ) {
    // modo leve (toque / qualidade baixa): sem compressor próprio (fica só o limitador do master),
    // reverb de 0,4 s mono no lugar da sala estéreo de 1,4 s e distorção sem oversampling
    const lite = isAudioLite();
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    const makeup = ctx.createGain();
    if (lite) {
      makeup.gain.value = 1.1;
      this.out.connect(makeup);
    } else {
      const comp = ctx.createDynamicsCompressor();
      // compressão leve: segura os picos sem achatar a dinâmica entre seções (intro → refrão)
      comp.threshold.value = -12;
      comp.knee.value = 8;
      comp.ratio.value = 2.2;
      comp.attack.value = 0.015;
      comp.release.value = 0.25;
      makeup.gain.value = 1.25;
      this.out.connect(comp);
      comp.connect(makeup);
    }
    // volume da seção DEPOIS do compressor (como um técnico subindo o fader no refrão): a
    // compressão não desfaz a diferença entre intro, riff, refrão e ponte
    this.section = ctx.createGain();
    makeup.connect(this.section);
    this.gate = ctx.createGain();
    this.section.connect(this.gate);
    this.gate.connect(destination);
    // reverb de sala (caixa, solos e um pouco da guitarra)
    const conv = ctx.createConvolver();
    conv.buffer = lite ? roomImpulse(ctx, 0.4, 2.5, 1) : roomImpulse(ctx, 1.4, 3);
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.35;
    this.reverb.connect(conv);
    conv.connect(this.out);

    // barramento da guitarra base DEPOIS da distorção: a dinâmica da seção muda o volume de verdade
    // (antes da distorção só mudaria a saturação)
    this.guitarBus = ctx.createGain();
    this.guitarBus.connect(this.out);
    const gl = guitarSide(ctx, this.guitarBus, -0.75, 0, 60, lite);
    const gr = guitarSide(ctx, this.guitarBus, 0.75, 0.013, 45, lite);
    this.sides = [gl, gr];
    this.guitarL = gl.input;
    this.guitarR = gr.input;
    this.guitarL.gain.value = 0.17;
    this.guitarR.gain.value = 0.17;
    const gSend = ctx.createGain();
    gSend.gain.value = 0.02;
    this.guitarL.connect(gSend);
    gSend.connect(this.reverb);
    // guitarra solo: centro, mais aguda, com eco
    this.lead = guitarSide(ctx, this.out, 0.1, 0, 90, lite).input;
    this.lead.gain.value = 0.11;
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const echoLevel = ctx.createGain();
    echoLevel.gain.value = 0.35;
    this.lead.connect(echo);
    echo.connect(fb);
    fb.connect(echo);
    echo.connect(echoLevel);
    echoLevel.connect(this.reverb);

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
    this.seed = song.bpm * 7 + song.root;
    const now = this.ctx.currentTime;
    // timbre do planeta: distorção, caixa e sala próprias
    this.sides.forEach((sd, i) => {
      sd.dist.curve = distortionCurve(song.tone.drive * (i ? 0.75 : 1));
      sd.cab.frequency.setValueAtTime(song.tone.cab * (i ? 1.06 : 1), now);
    });
    this.reverb.gain.setValueAtTime(song.tone.room, now);
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setValueAtTime(1, now);
    this.nextTime = now + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.releaseChord(now);
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setTargetAtTime(0, now, 0.03);
  }

  /* ---------------- sequenciador ---------------- */

  private eighth(): number {
    return 60 / this.song.bpm / 2;
  }

  /**
   * Agenda as notas dos próximos ~400 ms (chamado por timer). Antecipação folgada: um quadro
   * pesado ou o timer atrasado (aba em segundo plano) não deixa buraco na música.
   */
  schedule(): void {
    while (this.nextTime < this.ctx.currentTime + 0.4) {
      this.playStep(this.step, this.stepTime(this.nextTime));
      this.nextTime += this.eighth();
      this.step++;
    }
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** swing: no "boogie", a segunda colcheia de cada tempo atrasa */
  private stepTime(t: number): number {
    return this.song.feel === 'shuffle' && this.step % 2 === 1 ? t + this.eighth() / 3 : t;
  }

  private playStep(step: number, t: number): void {
    const s = this.song;
    const sectionSteps = 32; // 4 compassos
    const sectionIndex = Math.floor(step / sectionSteps);
    const section = sectionIndex % s.form.length;
    const inSection = step % sectionSteps;
    const riffIndex = s.form[section];
    const riff = s.riffs[riffIndex];
    const tok = riff[inSection % riff.length];
    const e = this.eighth();
    // introdução: os primeiros 2 compassos sem baixo e com bateria leve
    const intro = sectionIndex === 0 && inSection < 16;
    const role: Role = sectionIndex === 0 ? 'intro' : section === s.bridge ? 'bridge' : riffIndex === 2 ? 'chorus' : 'riff';
    const chorus = role === 'chorus';
    const bridge = role === 'bridge';
    if (inSection === 0 || step === 0) {
      this.roleLevel = ROLE_VEL[role];
      this.guitarBus.gain.setTargetAtTime(0.35 + 0.65 * this.roleLevel, t, 0.08);
      this.section.gain.setTargetAtTime(SECTION_GAIN[role], t, 0.15);
    }
    // antes do refrão a virada começa mais cedo (a música "cresce")
    const toChorus = s.form[(section + 1) % s.form.length] === 2;

    // bateria: acentos no tempo forte, leve variação humana e dinâmica por seção
    const beat = inSection % 8;
    const lastBar = inSection >= 24;
    const vel = ROLE_VEL[role] * (beat % 4 === 0 ? 1 : 0.82) * (0.9 + this.rand() * 0.2);
    if (inSection === 0 && !intro) this.crash(t, chorus ? 1 : 0.75);
    if (chorus && inSection === 16) this.crash(t, 0.7);
    if (inSection === 16 && sectionIndex === 0) this.crash(t, 0.8);
    if (lastBar && bridge) {
      // fim da ponte: rufo de caixa em crescendo até o próximo riff
      const k = inSection - 24;
      this.snare(t, 0.25 + k * 0.1);
      this.snare(t + e / 2, 0.3 + k * 0.1);
      if (k === 7) this.kick(t, 1);
    } else if (lastBar && (section % 2 === 1 || toChorus) && inSection >= (toChorus ? 26 : 28)) {
      // virada: tons descendo + caixa
      const k = inSection - 28;
      this.tom(t, 220 - k * 30, vel);
      this.snare(t + e / 2, 0.6 * vel);
    } else if (bridge) {
      // meio-tempo: bumbo no 1, caixa no 3, prato de condução em semínimas
      if (beat === 0 || (beat === 3 && inSection % 16 >= 8)) this.kick(t, vel);
      if (beat === 4) this.snare(t, vel);
      if (beat % 2 === 0) this.ride(t, 0.35 * vel);
    } else if (!intro || inSection >= 8) {
      if (this.kickAt(beat, section, chorus)) this.kick(t, vel);
      const halfTime = s.groove === 'heavy' && !chorus;
      if (halfTime ? beat === 4 : beat === 2 || beat === 6) this.snare(t, vel);
      else if (role === 'riff' && (beat === 7 || beat === 3) && this.rand() < 0.3) this.snare(t, 0.18); // nota fantasma
      if (chorus) this.ride(t, (beat % 2 === 0 ? 0.55 : 0.32) * vel);
      else this.hat(t, (beat % 2 === 0 ? 0.42 : 0.2) * vel, beat === 7 && section % 2 === 0);
    } else {
      this.hat(t, 0.3, false);
    }

    if (chorus) this.solo(s, inSection, t, e);

    // guitarra e baixo
    if (bridge) {
      // ponte: guitarra só sustenta um acorde por compasso; baixo pulsa em semínimas
      const move = BRIDGE_MOVE[Math.floor(inSection / 8) % 4];
      if (inSection % 8 === 0) {
        const first = riff.find((x) => /^[0-9]+$/.test(x));
        this.chord(s.root + (first ? Number(first) : 0) + move, t, e * 7.5, 0.55);
      }
      if (inSection % 2 === 0) this.bass(s.root + move - 12, t, e * 1.6);
      return;
    }
    if (tok === '-') return;
    // pausas: a guitarra abafa com um release curto (não corta seco), o baixo segue soando por
    // cima da pausa e um chimbal aberto baixinho preenche o agudo: sem buraco no espectro todo
    const restAfter = (i: number) => riff[(i + 1) % riff.length] === '.';
    if (tok === '.') {
      this.releaseChord(t);
      if (!intro && !bridge) this.hat(t, 0.16, true);
      return;
    }
    if (tok === 'x') {
      this.releaseChord(t);
      this.chug(s.root, t);
      if (!intro) this.bass(s.root, t, e * (restAfter(inSection) ? 1.8 : 1.02));
      return;
    }
    const n = Number(tok);
    // quanto tempo sustenta (conta os "-")
    let hold = 1;
    for (let i = inSection + 1; i < inSection + 16 && riff[i % riff.length] === '-'; i++) hold++;
    this.chord(s.root + n, t, e * hold);
    if (intro) return;
    this.bass(s.root + n - 12, t, e * (hold === 1 && restAfter(inSection) ? 1.8 : Math.min(hold, 2) * 0.98));
    if (hold > 2) for (let i = 2; i < hold; i += 2) this.bass(s.root + n - 12, t + e * i, e * 1.8);
  }

  /** Bumbo conforme a levada da música (colcheia `beat` 0..7 do compasso). */
  private kickAt(beat: number, section: number, chorus: boolean): boolean {
    switch (this.song.groove) {
      case 'punk':
        return beat % 2 === 0 || (chorus && beat === 5);
      case 'gallop':
        return beat === 0 || beat === 3 || beat === 4 || beat === 7 || (chorus && beat === 1);
      case 'heavy':
        return beat === 0 || beat === 3 || (chorus && beat === 5);
      case 'boogie':
        return beat === 0 || beat === 4 || (beat === 3 && section % 2 === 1) || (chorus && beat === 7);
      default:
        return beat === 0 || beat === 4 || beat === 5 || (beat === 3 && section % 2 === 1) || (chorus && beat === 7);
    }
  }

  /** Solo improvisado na pentatônica (determinístico por música). */
  private solo(s: Song, inSection: number, t: number, e: number): void {
    if (inSection % 2 === 1 && this.rand() < 0.6) return;
    if (this.rand() < 0.15) return;
    const idx = Math.floor(this.rand() * PENTA.length);
    const note = s.root + 24 + PENTA[idx];
    const long = inSection % 8 === 6 || this.rand() < 0.2;
    this.leadNote(note, t, long ? e * 1.9 : e * 0.95, long);
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

  private kick(t: number, vel = 1): void {
    // corpo com queda de afinação + estalo do batedor
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    o.connect(this.env(t, 1.1 * vel, 0.001, 0.32));
    o.start(t);
    o.stop(t + 0.36);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    n.connect(bp);
    bp.connect(this.env(t, 0.35 * vel * vel, 0.0005, 0.012));
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.03);
  }

  private snare(t: number, vol: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    // mais forte = mais brilho (a caixa abre com a força da baqueta)
    bp.frequency.value = 1500 + 1100 * Math.min(1, vol);
    bp.Q.value = 0.6;
    n.connect(bp);
    const g = this.env(t, 0.7 * vol, 0.001, 0.19);
    bp.connect(g);
    const send = this.ctx.createGain();
    send.gain.value = 0.9;
    g.connect(send);
    send.connect(this.reverb);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.22);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(230, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.07);
    o.connect(this.env(t, 0.45 * vol, 0.001, 0.1));
    o.start(t);
    o.stop(t + 0.14);
  }

  private tom(t: number, f: number, vel = 1): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.18);
    o.connect(this.env(t, 0.6 * vel, 0.001, 0.2));
    o.start(t);
    o.stop(t + 0.24);
  }

  private hat(t: number, vol: number, open: boolean): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const p = this.ctx.createStereoPanner();
    p.pan.value = 0.35;
    n.connect(hp);
    hp.connect(p);
    p.connect(this.env(t, 0.2 * vol, 0.001, open ? 0.3 : 0.04));
    n.start(t, Math.random() * 0.5);
    n.stop(t + (open ? 0.35 : 0.06));
  }

  private ride(t: number, vol: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 1.5;
    n.connect(bp);
    bp.connect(this.env(t, 0.22 * vol, 0.001, 0.35));
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.4);
  }

  private crash(t: number, vol = 1): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    n.connect(hp);
    const g = this.env(t, 0.26 * vol, 0.002, 1.6);
    hp.connect(g);
    g.connect(this.reverb);
    n.start(t);
    n.stop(t + 1.7);
  }

  private bass(note: number, t: number, dur: number): void {
    const f = midi(note);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    lp.Q.value = 2;
    const g = this.ctx.createGain();
    const lvl = 0.4 * (0.55 + 0.45 * this.roleLevel);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lvl, t + 0.006);
    g.gain.setTargetAtTime(lvl * 0.8, t + 0.03, dur * 0.5);
    // release de ~40 ms DEPOIS do fim: a nota seguinte entra por cima, sem micro-silêncio entre elas
    g.gain.setTargetAtTime(0.0001, t + dur, 0.012);
    lp.connect(g);
    g.connect(this.out);
    const layers: [OscillatorType, number, number][] = [
      [this.song.tone.bass, 1, 1],
      ['sine', 0.5, 0.8],
    ];
    for (const [type, mul, lvl] of layers) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = this.ctx.createGain();
      og.gain.value = lvl;
      o.connect(og);
      og.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.08);
    }
  }

  /** acorde de quinta sustentado (tônica, quinta, oitava), dobrado em estéreo */
  private chord(note: number, t: number, dur: number, level = 1): void {
    this.releaseChord(t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.setTargetAtTime(0.72 * level, t + 0.05, 0.3);
    const gl = this.ctx.createGain();
    const gr = this.ctx.createGain();
    g.connect(gl);
    g.connect(gr);
    gl.connect(this.guitarL);
    gr.connect(this.guitarR);
    const voices: [number, GainNode][] = [
      [-7, gl],
      [5, gr],
      [11, gl],
      [-3, gr],
    ];
    const osc: OscillatorNode[] = [];
    for (const iv of [0, 7, 12]) {
      for (const [det, dest] of voices) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(note + iv);
        o.detune.value = det;
        o.connect(dest);
        o.start(t);
        osc.push(o);
      }
    }
    this.chordVoices = { osc, gain: g };
    // corta no fim da duração, a menos que outro evento corte antes
    const end = t + dur;
    g.gain.setValueAtTime(0.72 * level, end - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.1);
    for (const o of osc) o.stop(end + 0.12);
  }

  private releaseChord(t: number): void {
    if (!this.chordVoices) return;
    const { osc, gain } = this.chordVoices;
    try {
      gain.gain.cancelScheduledValues(t);
      // release de ~120 ms: a nota morre como corda abafada, sem "buraco" seco na mixagem
      gain.gain.setTargetAtTime(0.0001, t, 0.035);
      for (const o of osc) o.stop(t + 0.2);
    } catch {
      /* já parou */
    }
    this.chordVoices = null;
  }

  /** nota abafada curta (palm mute), nos dois lados */
  private chug(note: number, t: number): void {
    const sides: [GainNode, number][] = [
      [this.guitarL, -4],
      [this.guitarR, 6],
    ];
    for (const [side, det] of sides) {
      const g = this.ctx.createGain();
      const peak = 0.95 * (0.6 + 0.4 * this.roleLevel);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
      g.gain.setTargetAtTime(peak * 0.35, t + 0.01, 0.03);
      g.gain.setTargetAtTime(0.0001, t + 0.09, 0.013);
      g.connect(side);
      for (const iv of [0, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(note + iv);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + 0.16);
      }
    }
  }

  /** nota do solo, com vibrato nas longas e "bend" de entrada */
  private leadNote(note: number, t: number, dur: number, vibrato: boolean): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const f = midi(note);
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    if (vibrato) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 6;
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.6);
      lfo.connect(depth);
      depth.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.01);
    g.gain.setTargetAtTime(0.6, t + 0.03, 0.15);
    g.gain.setValueAtTime(0.6, t + dur - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(g);
    g.connect(this.lead);
    o.start(t);
    o.stop(t + dur + 0.08);
  }
}
