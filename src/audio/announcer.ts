import { raceDistance, type Racer, type World, type WorldEvent } from '../sim/world';
import { audio, duckFor, isMuted } from './context';
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
}

/** Falas de euforia: tocadas um pouco mais rápidas e agudas (empolgação de narrador de arena). */
const HYPE = new Set<string>(['ouch', 'wow', 'holyToledo', 'hotFury', 'jamsFirst', 'finishFirst', 'wipedOut', 'lightsUp', 'dominating', 'lastLap', 'start']);

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
        const files = Object.values(m.lines).flat();
        await Promise.all(files.map((f) => loadBuffer(a.ctx, `audio/locutor/${f}`)));
      })
      .catch(() => {
        this.manifest = null;
      });
  }

  private buffer(key: string): AudioBuffer | null {
    const list = this.manifest?.lines[key];
    if (!list?.length) return null;
    const opts = list.length > 1 ? list.filter((f) => f !== this.lastPick.get(key)) : list;
    const file = opts[Math.floor(Math.random() * opts.length)];
    this.lastPick.set(key, file);
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
    const nameBuf = slug ? this.buffer(`name:${slug}`) : null;
    const lineBuf = this.buffer(key);
    const a = audio();
    if (a && lineBuf && (!slug || nameBuf)) {
      this.stop();
      const t = a.ctx.currentTime + 0.02;
      let at = t;
      // cada fala sai um pouco diferente; as de euforia, mais rápidas e agudas
      const hype = HYPE.has(key);
      const rate = (hype ? 1.05 : 1) + (Math.random() * 2 - 1) * 0.025;
      if (nameBuf) {
        this.play(nameBuf, at, rate);
        // a fala entra logo depois do nome (encaixe como no original)
        at += Math.max(0.15, nameBuf.duration / rate - 0.22);
      }
      this.play(lineBuf, at, hype ? rate + 0.02 : rate);
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

  private play(buf: AudioBuffer, t: number, rate = 1): void {
    const a = audio();
    if (!a) return;
    const s = a.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.connect(a.voice);
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
