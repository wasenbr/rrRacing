import { raceDistance, type Racer, type World, type WorldEvent } from '../sim/world';
import { audio, duckFor, isAudioLite, isMuted } from './context';
import { getBuffer, loadBuffer, publicUrl } from './samples';

/**
 * Locutor no estilo do "Loudmouth" Larry do original: a fala é montada como NOME + FRASE
 * ("Viper jams into first!"). As falas são gravadas por TTS neural (Chatterbox, com exagero
 * emocional alto; ver public/audio/CREDITOS.md, scripts/locutor/gerar.py e o pós-tratamento
 * scripts/locutor/tratar.py, que iguala o loudness e apara as falas); sem elas, usa a voz do navegador.
 */

/** Frases (chave -> texto usado no fallback com voz do navegador). */
const TEXT: Record<string, string> = {
  start: 'Let the carnage begin!',
  lastLap: 'Last lap!',
  ouch: 'Ouch!',
  wow: 'Wow!',
  holyToledo: 'Holy Toledo!',
  jamsFirst: 'jams into first!',
  fadesLast: 'fades into last!',
  dominating: 'is dominating the race!',
  finishFirst: 'scores a first place knock-out!',
  finishSecond: 'finishes second!',
  finishThird: 'takes a weak third!',
  hotFury: 'unleashes hot fury!',
  lightsUp: 'lights him up!',
  hammered: 'gets hammered!',
  aboutToBlow: 'is about to blow!',
  avoidMines: 'should avoid mines!',
  wipedOut: 'wiped out!',
  launches: 'launches himself!',
  warp: 'hits the warp!',
  powersUp: 'powers up!',
  spinOut: 'spins out!',
  wrongWay: 'is headed the wrong way!',
  lost: 'looks lost out there!',
  powerOff: 'is out of ammo!',
};
export type LineKey = keyof typeof TEXT;

/** Apelidos que o locutor usa (como no original). */
const PILOT_SLUG: Record<string, string> = {
  tarquinn: 'tarquinn', jake: 'jake', cyberhawk: 'hawk', katarina: 'kat', snake: 'snake', ivan: 'ivan', ivanzypher: 'ivan', olaf: 'olaf',
};
const NICK: Record<string, string> = { hawk: 'Hawk', kat: 'Kat', rage: 'Rage' };

/** Nome de piloto ou rival -> apelido gravado ("Viper Mackay" -> "viper", "Ragewortt" -> "rage"). */
export function voiceSlug(name: string): string {
  const n = name.toLowerCase().trim();
  if (PILOT_SLUG[n]) return PILOT_SLUG[n];
  if (n.includes('slash')) return 'slash';
  if (n.startsWith('rage')) return 'rage';
  if (n.includes('hawk')) return 'hawk';
  if (n.startsWith('katarina')) return 'kat';
  if (n.startsWith('ivan')) return 'ivan';
  return n.split(/[^a-z0-9]+/)[0] ?? n;
}

interface Manifest {
  names: string[];
  lines: Record<string, string[]>;
  /** bordões gravados inteiros com o nome ("Viper jams into first!"): frase -> apelido -> arquivos */
  combos?: Record<string, Record<string, string[]>>;
}

/**
 * Falas de largada e de ataque: passam pela cadeia de "arena" (ver arenaChain). As demais
 * (colocação, avisos) vão direto ao barramento do locutor.
 */
export const ARENA_LINES = new Set<string>(['start', 'hotFury', 'lightsUp', 'hammered', 'wow', 'holyToledo', 'jamsFirst', 'finishFirst', 'launches', 'wipedOut', 'ouch', 'dominating', 'lastLap']);

const arenaCache = new WeakMap<BaseAudioContext, AudioNode>();

/**
 * Cadeia de "arena" do locutor (itens 32/53: as falas medidas tinham loudness de pico 2–4 dB abaixo
 * da referência de locutor de luta; ver som() em scripts/evidencias.mjs): saturação bem leve,
 * corte de grave, presença em 3 kHz e corpo em 1,2 kHz, compressão (a fala inteira no mesmo nível
 * de grito) e reverb curto de ginásio (~0,2 s; fora no modo leve). Rodada 12: presença +2 dB (era
 * +5) e saturação menor — o esforço passava do grito real da referência (−10 dB) e soava
 * artificial; a emoção agora vem dos takes gritados (scripts/locutor/gerar.py refazer).
 */
export function arenaChain(ctx: BaseAudioContext, dest: AudioNode): AudioNode {
  const have = arenaCache.get(ctx);
  if (have) return have;
  const input = ctx.createGain();
  input.gain.value = 1.4;
  const sat = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 0.8) / Math.tanh(0.8);
  }
  sat.curve = curve;
  sat.oversample = isAudioLite() ? 'none' : '2x';
  const biquad = (type: BiquadFilterType, f: number, q: number, gain = 0) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = gain;
    return b;
  };
  const hp = biquad('highpass', 140, 0.7);
  const presence = biquad('peaking', 3000, 0.9, 2);
  const body = biquad('peaking', 1200, 1, 2);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 6;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  // o compressor do navegador já soma ganho de compensação (~+10 dB com estes ajustes): o resultado
  // fica ~+4 dB de loudness sobre a fala crua, com picos abaixo dela (a fala inteira "no grito")
  const makeup = ctx.createGain();
  makeup.gain.value = 0.85;
  input.connect(sat);
  sat.connect(hp);
  hp.connect(presence);
  presence.connect(body);
  body.connect(comp);
  comp.connect(makeup);
  makeup.connect(dest);
  if (!isAudioLite()) {
    // reverb curto de ginásio: ruído estéreo decaindo em ~0,2 s, bem baixo (rodada 11: com ~0,4 s
    // a cauda borrava as sílabas do grito e a taxa de sílabas medida caía)
    const len = Math.floor(ctx.sampleRate * 0.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 1; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.035));
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.1;
    makeup.connect(verb);
    verb.connect(wet);
    wet.connect(dest);
  }
  arenaCache.set(ctx, input);
  return input;
}

/** Prioridades: 3 = fura a fila e corta o que estiver falando. */
type Priority = 1 | 2 | 3;

export class Announcer {
  enabled = true;
  private manifest: Manifest | null = null;
  private loading: Promise<void> | null = null;
  private busyUntil = 0;
  private busyPriority: Priority = 1;
  private lastSpoke = -Infinity;
  private playing: AudioBufferSourceNode[] = [];
  private lastPick = new Map<string, string>();
  private fallbackVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    const pick = () => {
      const voices = window.speechSynthesis?.getVoices() ?? [];
      this.fallbackVoice =
        voices.find((v) => /en[-_]US/i.test(v.lang) && /natural|neural|online/i.test(v.name)) ??
        voices.find((v) => /en[-_]US/i.test(v.lang) && /male|david|guy|mark|alex|daniel|fred/i.test(v.name)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
    };
    pick();
    window.speechSynthesis?.addEventListener?.('voiceschanged', pick);
  }

  /** Baixa o roteiro e as falas (depois do primeiro gesto, quando o áudio existe). */
  private ensureLoaded(): void {
    const a = audio();
    if (!a || this.loading) return;
    this.loading = fetch(publicUrl('audio/locutor/manifest.json'))
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error('sem locutor'))))
      .then(async (m) => {
        this.manifest = m;
        const combos = Object.values(m.combos ?? {}).flatMap((bySlug) => Object.values(bySlug).flat());
        const files = [...Object.values(m.lines).flat(), ...combos];
        await Promise.all(files.map((f) => loadBuffer(a.ctx, `audio/locutor/${f}`)));
      })
      .catch(() => {
        this.manifest = null;
      });
  }

  private buffer(key: string, combo: string | null = null): AudioBuffer | null {
    const list = combo ? this.manifest?.combos?.[key]?.[combo] : this.manifest?.lines[key];
    if (!list?.length) return null;
    const pickKey = combo ? `${key}@${combo}` : key;
    const opts = list.length > 1 ? list.filter((f) => f !== this.lastPick.get(pickKey)) : list;
    const file = opts[Math.floor(Math.random() * opts.length)];
    this.lastPick.set(pickKey, file);
    return getBuffer(`audio/locutor/${file}`);
  }

  private now(): number {
    return performance.now() / 1000;
  }

  /**
   * Fala uma frase, opcionalmente precedida de um nome (apelido gravado).
   * Não fala por cima de algo mais importante; prioridade 3 corta a fala atual.
   */
  say(key: LineKey, name: string | null = null, priority: Priority = 2): void {
    if (!this.enabled || isMuted()) return;
    this.ensureLoaded();
    const now = this.now();
    const speaking = now < this.busyUntil;
    if (speaking && priority <= this.busyPriority && priority < 3) return;
    if (!speaking && priority < 3 && now - this.lastSpoke < (priority === 1 ? 4 : 1.8)) return;

    const slug = name ? voiceSlug(name) : null;
    // bordão gravado inteiro ("Viper jams into first!") soa melhor que nome + frase emendados;
    // de vez em quando usa a versão emendada, só para não repetir sempre o mesmo take
    const comboBuf = slug && Math.random() < 0.9 ? this.buffer(key, slug) : null;
    const nameBuf = slug && !comboBuf ? this.buffer(`name:${slug}`) : null;
    const lineBuf = comboBuf ?? this.buffer(key);
    const a = audio();
    if (a && lineBuf && (!slug || comboBuf || nameBuf)) {
      this.stop();
      const t = a.ctx.currentTime + 0.02;
      let at = t;
      // velocidade natural: acelerar afinava a voz (soava esquilo); a energia vem da gravação
      const rate = 1;
      const arena = ARENA_LINES.has(key);
      if (nameBuf) {
        this.play(nameBuf, at, rate, arena);
        // a fala entra logo depois do nome (encaixe como no original)
        at += Math.max(0.15, nameBuf.duration / rate - 0.22);
      }
      this.play(lineBuf, at, rate, arena);
      const dur = at - t + lineBuf.duration / rate;
      duckFor(0.5, dur);
      this.busyUntil = now + dur;
    } else {
      // voz do navegador (sem as gravações)
      const synth = window.speechSynthesis;
      if (!synth) return;
      if (priority === 3) synth.cancel();
      else if (synth.speaking) return;
      const nick = slug ? (NICK[slug] ?? slug[0].toUpperCase() + slug.slice(1)) : '';
      const u = new SpeechSynthesisUtterance(nick ? `${nick} ${TEXT[key]}` : TEXT[key]);
      if (this.fallbackVoice) u.voice = this.fallbackVoice;
      u.lang = this.fallbackVoice?.lang ?? 'en-US';
      u.rate = 1.2;
      u.pitch = 0.75;
      synth.speak(u);
      this.busyUntil = now + 1.6;
    }
    this.busyPriority = priority;
    this.lastSpoke = now;
  }

  /**
   * Cria a cadeia de "arena" antes da contagem (no preparo da largada): criada na primeira fala de
   * largada, custava ~190 ms no passo da simulação logo depois do "VAI!".
   */
  prepare(): void {
    const a = audio();
    if (a) arenaChain(a.ctx, a.voice);
  }

  private play(buf: AudioBuffer, t: number, rate = 1, arena = false): void {
    const a = audio();
    if (!a) return;
    const s = a.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.connect(arena ? arenaChain(a.ctx, a.voice) : a.voice);
    s.start(t);
    this.playing.push(s);
    s.onended = () => (this.playing = this.playing.filter((x) => x !== s));
  }

  /** Cala o locutor (pausa, menu). */
  stop(): void {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        /* já parou */
      }
    }
    this.playing = [];
    window.speechSynthesis?.cancel();
    this.busyUntil = 0;
  }
}

/**
 * Decide o que o locutor fala a cada passo da corrida, a partir dos eventos e do estado do mundo.
 * Gatilhos seguem o original: liderança, último lugar, domínio, "hot fury" (rajada de tiros),
 * abates, minas, pirueta no óleo, pulo, contramão, perdido lá atrás, sem munição, pódio.
 */
export class Commentary {
  private leader = -1;
  private wasLast = false;
  private dominated = false;
  private lostSaid = false;
  private low = new Set<number>();
  private shots = new Map<number, number[]>();
  private lastHitKind = new Map<number, string>();
  private cool = new Map<string, number>();
  private explosions: number[] = [];
  private playerKills: number[] = [];
  private fast = 0;
  private prevFire = false;
  private started = false;

  constructor(
    private announcer: Announcer,
    private nameOf: (r: Racer) => string,
  ) {}

  reset(): void {
    this.leader = -1;
    this.wasLast = false;
    this.dominated = false;
    this.lostSaid = false;
    this.low.clear();
    this.shots.clear();
    this.lastHitKind.clear();
    this.cool.clear();
    this.explosions = [];
    this.playerKills = [];
    this.fast = 0;
    this.prevFire = false;
    this.started = false;
  }

  /** Largada ("The stage is set, the green flag drops!" / "Let the carnage begin!"). */
  start(): void {
    this.started = true;
    this.announcer.say('start', null, 3);
  }

  private ready(key: string, t: number, every: number): boolean {
    const last = this.cool.get(key) ?? -Infinity;
    if (t - last < every) return false;
    this.cool.set(key, t);
    return true;
  }

  update(world: World, me: number, dt: number): void {
    if (!this.started) return;
    const t = world.raceTime;
    const say = (k: LineKey, r: Racer | null, p: 1 | 2 | 3 = 2) => this.announcer.say(k, r ? this.nameOf(r) : null, p);
    const R = world.racers;
    const player = R[me];

    for (const e of world.events) this.onEvent(e, world, me, say);

    // liderança
    const leader = R.find((r) => r.place === 1);
    if (leader && leader.id !== this.leader) {
      if (this.leader !== -1 && t > 4 && this.ready('lead', t, 5)) say('jamsFirst', leader, leader.id === me ? 3 : 2);
      this.leader = leader.id;
    }
    // jogador caiu para último
    const isLast = player.place === R.length && !player.finishPlace;
    if (isLast && !this.wasLast && t > 8 && this.ready('last', t, 12)) say('fadesLast', player, 2);
    this.wasLast = isLast;
    // domínio: líder com mais de 1/3 de volta de vantagem sobre o 2º
    const second = R.find((r) => r.place === 2);
    if (leader && second && !this.dominated && !leader.finishPlace) {
      const gap = raceDistance(world, leader) - raceDistance(world, second);
      if (gap > world.track.totalLength * 0.33) {
        this.dominated = true;
        say('dominating', leader, 2);
      }
    }
    // perdido lá atrás: mais de 60% de volta atrás do líder
    if (leader && leader.id !== me && !this.lostSaid && !player.finishPlace) {
      if (raceDistance(world, leader) - raceDistance(world, player) > world.track.totalLength * 0.6) {
        this.lostSaid = true;
        say('lost', player, 2);
      }
    }
    // blindagem baixa
    for (const r of R) {
      const ratio = r.armor / r.spec.armor;
      if (r.alive && ratio < 0.3 && !this.low.has(r.id)) {
        this.low.add(r.id);
        say('aboutToBlow', r, r.id === me ? 3 : 2);
      } else if (ratio > 0.6) this.low.delete(r.id);
    }
    // contramão
    if (player.progress.wrongWayTime > 1.5 && this.ready('wrong', t, 8)) say('wrongWay', player, 3);
    // "powers up": 4 s colado na velocidade máxima sem bater
    const speed = Math.hypot(player.car.vx, player.car.vz);
    this.fast = speed > player.spec.maxSpeed * 0.93 && player.car.wallImpact === 0 ? this.fast + dt : 0;
    if (this.fast > 4 && this.ready('powers', t, 30)) {
      this.fast = 0;
      say('powersUp', player, 1);
    }
    // sem munição: apertou tiro com zero cargas
    const fire = player.lastInput.fire;
    if (fire && !this.prevFire && player.frontCharges <= 0 && player.alive && this.ready('ammo', t, 15)) say('powerOff', player, 1);
    this.prevFire = fire;
  }

  private onEvent(e: WorldEvent, world: World, me: number, say: (k: LineKey, r: Racer | null, p?: 1 | 2 | 3) => void): void {
    const R = world.racers;
    const t = world.raceTime;
    switch (e.type) {
      case 'fire': {
        const list = (this.shots.get(e.racer) ?? []).filter((x) => t - x < 2.2);
        list.push(t);
        this.shots.set(e.racer, list);
        if (list.length >= 3 && this.ready(`fury${e.racer}`, t, 10)) say('hotFury', R[e.racer], 2);
        break;
      }
      case 'hit':
        this.lastHitKind.set(e.target, e.kind);
        if (e.target === me && e.kind === 'missile' && Math.random() < 0.35 && this.ready('ouch', t, 6)) say('ouch', null, 1);
        break;
      case 'explode': {
        this.explosions = this.explosions.filter((x) => t - x < 1.5);
        this.explosions.push(t);
        if (this.explosions.length >= 2 && this.ready('toledo', t, 10)) {
          say('holyToledo', null, 3);
          break;
        }
        const kind = this.lastHitKind.get(e.racer);
        if (e.racer === me) say('hammered', R[me], 3);
        else if (e.by === me) {
          this.playerKills = this.playerKills.filter((x) => t - x < 6);
          this.playerKills.push(t);
          if (this.playerKills.length >= 2) say('wow', null, 3);
          else say('lightsUp', R[me], 3);
        } else if (kind === 'mine' || kind === 'scatter') say('avoidMines', R[e.racer], 2);
        else say('wipedOut', R[e.racer], 2);
        break;
      }
      case 'fall':
        if (this.ready(`fall${e.racer}`, t, 6)) say('wipedOut', R[e.racer], e.racer === me ? 3 : 2);
        break;
      case 'spin':
        if (this.ready('spin', t, 5)) say('spinOut', R[e.racer], e.racer === me ? 2 : 1);
        break;
      case 'assist':
        if (e.racer === me && e.kind === 'jump' && this.ready('launch', t, 12)) say('launches', R[me], 1);
        break;
      case 'lap':
        if (e.racer === me && e.lap === world.laps) say('lastLap', null, 3);
        break;
      case 'finish':
        if (e.place === 1) say('finishFirst', R[e.racer], 3);
        else if (e.racer === me && e.place === 2) say('finishSecond', R[me], 3);
        else if (e.racer === me && e.place === 3) say('finishThird', R[me], 3);
        break;
      default:
        // eventos de "warp" (setas de impulso), se a pista tiver
        if ((e as { type: string }).type === 'warp' && (e as { racer?: number }).racer === me && this.ready('warp', t, 8)) say('warp', R[me], 1);
    }
  }
}
