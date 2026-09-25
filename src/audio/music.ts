import type { ThemeId } from '../sim/track';
import { audio } from './context';
import { addTracks, clearTracks, loadTracks } from './musicStore';
import { SONGS, SynthRock, type Song } from './synthrock';

/**
 * Músicas colocadas na pasta `music/` do projeto (PC). São incluídas no build automaticamente.
 * Só a raiz da pasta entra (subpastas como `music/_duplicadas/` são ignoradas).
 * A pasta fica fora do git — as músicas são suas e não vão para o repositório.
 */
const BUNDLED = Object.entries(
  import.meta.glob('/music/*.{mp3,ogg,m4a,wav,flac,opus,webm,aac}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
)
  .map(([path, url]) => ({ name: prettyName(path.split('/').pop()!), url }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** "born-to-be-wild.mp3" -> "Born To Be Wild". */
function prettyName(file: string): string {
  return decodeURIComponent(file)
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[\s._-]*/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Faixa preferida para o menu (como a abertura do original), se o jogador a tiver. */
const MENU_PREFERENCE = /peter\s*gunn/i;

/** Trilha sintetizada de cada planeta. */
const THEME_SONG: Record<ThemeId | 'menu', number> = {
  menu: 6,
  chem6: 0,
  drakonis: 1,
  bogmire: 2,
  newmojave: 3,
  nho: 5,
  inferno: 4,
};

/**
 * Hino do final da campanha (item 58): a faixa do menu/abertura do jogador (a preferida, "Peter
 * Gunn", ou a primeira) ou, sem faixas, a trilha sintetizada do menu. Usado pelo jogo e pela
 * gravação da evidência (scripts/evidencias.mjs), para as duas tocarem o mesmo caminho.
 */
export function anthemSource(tracks: { name: string; url: string }[] = BUNDLED): { kind: 'file'; index: number; name: string; url: string } | { kind: 'synth'; song: Song } {
  if (tracks.length) {
    const i = Math.max(0, tracks.findIndex((t) => MENU_PREFERENCE.test(t.name)));
    return { kind: 'file', index: i, name: tracks[i].name, url: tracks[i].url };
  }
  return { kind: 'synth', song: SONGS[THEME_SONG.menu] };
}

export type MusicMood = 'race' | 'menu' | 'pause';
const MOOD_LEVEL: Record<MusicMood, number> = { race: 1, menu: 0.6, pause: 0.25 };

/**
 * Nível-alvo das faixas de arquivo (RMS). As gravações variam muito de volume (masters antigos
 * ficam ~15 dB abaixo da trilha sintetizada); um controle automático lento iguala tudo.
 */
const FILE_TARGET_RMS = 0.2;
const FILE_GAIN_MIN = 0.4;
const FILE_GAIN_MAX = 4;
const CROSSFADE = 1.4;

interface Deck {
  el: HTMLAudioElement;
  /** crossfade */
  fade: GainNode;
  /** nivelamento automático */
  level: GainNode;
  analyser: AnalyserNode;
}

/**
 * Toca as músicas do jogador (pasta `music/` ou arquivos escolhidos no aparelho): uma faixa
 * fixa no menu e as demais em ordem aleatória nas corridas, sem repetir a mesma seguida e com
 * crossfade. Sem nenhuma música, toca a trilha de rock sintetizada, uma por planeta.
 */
export class Music {
  enabled = true;
  volume = 0.7;
  private synth: SynthRock | null = null;
  private gain: GainNode | null = null;
  private decks: Deck[] = [];
  private active = 0;
  private userTracks: { name: string; url: string }[] = [];
  private queue: number[] = [];
  private lastRace = -1;
  private current: { index: number; menu: boolean } | null = null;
  private mood: MusicMood = 'menu';
  private currentTheme: ThemeId | 'menu' | null = null;
  private levelTimer: number | null = null;
  onTrackChange: ((name: string) => void) | null = null;

  async init(): Promise<void> {
    const stored = await loadTracks();
    this.userTracks = stored.map((t) => ({ name: t.name, url: URL.createObjectURL(t.blob) }));
    this.queue = [];
  }

  get tracks(): { name: string; url: string }[] {
    return [...BUNDLED, ...this.userTracks];
  }

  get bundledCount(): number {
    return BUNDLED.length;
  }

  get userCount(): number {
    return this.userTracks.length;
  }

  /** Índice da faixa do menu (a preferida, ou a primeira). */
  private menuIndex(): number {
    const i = this.tracks.findIndex((t) => MENU_PREFERENCE.test(t.name));
    return i >= 0 ? i : 0;
  }

  /** Próxima faixa de corrida: ordem aleatória, sem a do menu (se houver outras) e sem repetir a última. */
  private nextRaceIndex(): number {
    const n = this.tracks.length;
    const menu = this.menuIndex();
    const pool = Array.from({ length: n }, (_, i) => i).filter((i) => n < 2 || i !== menu);
    if (!this.queue.length) {
      this.queue = pool.sort(() => Math.random() - 0.5);
      if (this.queue.length > 1 && this.queue[0] === this.lastRace) this.queue.push(this.queue.shift()!);
    }
    const i = this.queue.shift()!;
    this.lastRace = i;
    return i;
  }

  /** Conecta ao AudioContext (só depois de um gesto do usuário). */
  private ensure(): boolean {
    const a = audio();
    if (!a) return false;
    if (!this.gain) {
      this.gain = a.ctx.createGain();
      this.gain.connect(a.music);
      for (let k = 0; k < 2; k++) {
        const el = new Audio();
        el.preload = 'auto';
        const fade = a.ctx.createGain();
        fade.gain.value = 0;
        const level = a.ctx.createGain();
        level.gain.value = 1.5;
        const analyser = a.ctx.createAnalyser();
        analyser.fftSize = 2048;
        a.ctx.createMediaElementSource(el).connect(level);
        level.connect(analyser);
        level.connect(fade);
        fade.connect(this.gain);
        el.addEventListener('ended', () => {
          if (this.decks[this.active]?.el === el) this.advance();
        });
        el.addEventListener('error', () => {
          if (this.decks[this.active]?.el === el) this.advance();
        });
        this.decks.push({ el, fade, level, analyser });
      }
    }
    this.applyVolume();
    return true;
  }

  private applyVolume(): void {
    const a = audio();
    if (!a || !this.gain) return;
    const v = this.enabled ? this.volume * MOOD_LEVEL[this.mood] : 0;
    this.gain.gain.setTargetAtTime(v, a.ctx.currentTime, 0.25);
  }

  /** Começa (ou continua) a música adequada: `theme` escolhe a trilha sintetizada do planeta. */
  play(theme: ThemeId | 'menu', mood: MusicMood): void {
    this.mood = mood;
    if (!this.ensure()) return;
    if (!this.enabled) {
      this.stopAll();
      return;
    }
    if (this.tracks.length) {
      this.synth?.stop();
      const wantMenu = mood !== 'race';
      const deck = this.decks[this.active];
      // na pausa continua a faixa da corrida; troca só entre menu e corrida
      if (mood === 'pause' && this.current && !deck.el.paused) return;
      if (!this.current || this.current.menu !== wantMenu || deck.el.ended || deck.el.paused) {
        this.start(wantMenu ? this.menuIndex() : this.nextRaceIndex(), wantMenu);
      }
      return;
    }
    // trilha sintetizada: troca de música só quando muda de planeta. Criada só quando é usada: o
    // grafo dela (com reverb de convolução) consumia CPU de áudio mesmo calado
    this.synth ??= new SynthRock(audio()!.ctx, this.gain!);
    if (this.currentTheme !== theme || !this.synth.playing) {
      this.currentTheme = theme;
      const song = SONGS[THEME_SONG[theme]];
      this.synth.play(song);
      this.onTrackChange?.(`${song.name} (trilha sintetizada)`);
    }
  }

  /**
   * Final da campanha: o hino (faixa do menu/abertura ou trilha do menu) no volume cheio de corrida.
   * Antes usava play('menu', 'race'), que com faixas do jogador tocava a PRÓXIMA faixa de corrida.
   */
  playAnthem(): void {
    this.mood = 'race';
    if (!this.ensure()) return;
    if (!this.enabled) {
      this.stopAll();
      return;
    }
    const src = anthemSource(this.tracks);
    if (src.kind === 'file') {
      this.synth?.stop();
      const deck = this.decks[this.active];
      // já tocando a faixa do menu (veio da garagem): só sobe o volume; senão troca com crossfade
      if (!this.current || this.current.index !== src.index || deck.el.paused || deck.el.ended) this.start(src.index, true);
      return;
    }
    this.synth ??= new SynthRock(audio()!.ctx, this.gain!);
    if (this.currentTheme !== 'menu' || !this.synth.playing) {
      this.currentTheme = 'menu';
      this.synth.play(src.song);
      this.onTrackChange?.(`${src.song.name} (trilha sintetizada)`);
    }
  }

  setMood(mood: MusicMood): void {
    this.mood = mood;
    this.applyVolume();
  }

  /** Troca de faixa com crossfade entre os dois "decks". */
  private start(index: number, menu: boolean): void {
    const a = audio();
    const t = this.tracks[index];
    if (!a || !t || !this.decks.length) return;
    const now = a.ctx.currentTime;
    const old = this.decks[this.active];
    old.fade.gain.cancelScheduledValues(now);
    old.fade.gain.setValueAtTime(old.fade.gain.value, now);
    old.fade.gain.linearRampToValueAtTime(0, now + CROSSFADE);
    const oldEl = old.el;
    window.setTimeout(() => {
      if (this.decks[this.active].el !== oldEl) oldEl.pause();
    }, CROSSFADE * 1000 + 100);

    this.active = 1 - this.active;
    const d = this.decks[this.active];
    d.el.src = t.url;
    d.el.currentTime = 0;
    d.level.gain.value = 1.5;
    d.fade.gain.cancelScheduledValues(now);
    d.fade.gain.setValueAtTime(0, now);
    d.fade.gain.linearRampToValueAtTime(1, now + (this.current ? CROSSFADE : 0.3));
    void d.el.play().catch(() => {});
    this.current = { index, menu };
    this.onTrackChange?.(t.name);
    this.startLeveling();
  }

  /** Fim da faixa (ou erro): próxima conforme o momento. */
  private advance(): void {
    if (!this.current) return;
    this.start(this.current.menu ? this.menuIndex() : this.nextRaceIndex(), this.current.menu);
  }

  /** Nivelamento automático lento (±1 dB por passo) para faixas de volumes diferentes. */
  private startLeveling(): void {
    if (this.levelTimer !== null) return;
    const buf = new Float32Array(2048);
    this.levelTimer = window.setInterval(() => {
      const a = audio();
      const d = this.decks[this.active];
      if (!a || !d || d.el.paused) return;
      d.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (rms < 0.005) return; // silêncio/intro: não mexe
      const g = d.level.gain.value;
      const step = rms < FILE_TARGET_RMS * 0.85 ? 1.12 : rms > FILE_TARGET_RMS * 1.18 ? 0.9 : 1;
      const next = Math.min(FILE_GAIN_MAX, Math.max(FILE_GAIN_MIN, g * step));
      d.level.gain.setTargetAtTime(next, a.ctx.currentTime, 0.4);
    }, 400);
  }

  skip(): void {
    if (this.tracks.length && this.current) this.start(this.current.menu ? this.menuIndex() : this.nextRaceIndex(), this.current.menu);
  }

  private stopAll(): void {
    this.synth?.stop();
    for (const d of this.decks) d.el.pause();
    this.current = null;
    this.currentTheme = null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopAll();
    this.applyVolume();
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }

  async addFiles(files: File[]): Promise<void> {
    await addTracks(files);
    for (const t of this.userTracks) URL.revokeObjectURL(t.url);
    await this.init();
    this.stopAll();
  }

  async clearFiles(): Promise<void> {
    await clearTracks();
    for (const t of this.userTracks) URL.revokeObjectURL(t.url);
    this.userTracks = [];
    this.queue = [];
    this.stopAll();
    for (const d of this.decks) d.el.removeAttribute('src');
  }
}

/** Para scripts/evidencias.mjs: lista das faixas da pasta music/. */
export function bundledTracks(): { name: string; url: string }[] {
  return BUNDLED;
}
