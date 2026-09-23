import type { ThemeId } from '../sim/track';
import { audio } from './context';
import { addTracks, clearTracks, loadTracks } from './musicStore';
import { SONGS, SynthRock } from './synthrock';

/**
 * Músicas colocadas na pasta `music/` do projeto (PC). São incluídas no build automaticamente.
 * A pasta fica fora do git — as músicas são suas e não vão para o repositório.
 */
const BUNDLED = Object.entries(
  import.meta.glob('/music/*.{mp3,ogg,m4a,wav,flac,opus,webm,aac}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
).map(([path, url]) => ({ name: decodeURIComponent(path.split('/').pop()!.replace(/\.[^.]+$/, '')), url }));

/** Trilha sintetizada de cada planeta. */
const THEME_SONG: Record<ThemeId | 'menu', number> = {
  menu: 0,
  chem6: 0,
  drakonis: 1,
  bogmire: 2,
  newmojave: 3,
  nho: 1,
  inferno: 4,
};

export type MusicMood = 'race' | 'menu' | 'pause';
const MOOD_LEVEL: Record<MusicMood, number> = { race: 1, menu: 0.5, pause: 0.25 };

/**
 * Toca as músicas do jogador (pasta `music/` ou arquivos escolhidos no aparelho) em ordem
 * aleatória; sem nenhuma, toca a trilha de rock sintetizada, com uma música por planeta.
 */
export class Music {
  enabled = true;
  volume = 0.7;
  private synth: SynthRock | null = null;
  private el: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private userTracks: { name: string; url: string }[] = [];
  private order: number[] = [];
  private index = -1;
  private mood: MusicMood = 'menu';
  private currentTheme: ThemeId | 'menu' | null = null;
  onTrackChange: ((name: string) => void) | null = null;

  async init(): Promise<void> {
    const stored = await loadTracks();
    this.userTracks = stored.map((t) => ({ name: t.name, url: URL.createObjectURL(t.blob) }));
    this.shuffle();
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

  private shuffle(): void {
    const n = this.tracks.length;
    this.order = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
    this.index = -1;
  }

  /** Conecta ao AudioContext (só depois de um gesto do usuário). */
  private ensure(): boolean {
    const a = audio();
    if (!a) return false;
    if (!this.gain) {
      this.gain = a.ctx.createGain();
      this.gain.connect(a.music);
      this.el = new Audio();
      this.el.preload = 'auto';
      a.ctx.createMediaElementSource(this.el).connect(this.gain);
      this.el.addEventListener('ended', () => this.nextFile());
      this.el.addEventListener('error', () => this.nextFile());
      this.synth = new SynthRock(a.ctx, this.gain);
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
      if (!this.el!.src || this.el!.ended || this.index < 0) this.nextFile();
      else if (this.el!.paused) void this.el!.play().catch(() => {});
      return;
    }
    // trilha sintetizada: troca de música só quando muda de planeta
    if (this.currentTheme !== theme || !this.synth!.playing) {
      this.currentTheme = theme;
      const song = SONGS[THEME_SONG[theme]];
      this.synth!.play(song);
      this.onTrackChange?.(`${song.name} (trilha sintetizada)`);
    }
  }

  setMood(mood: MusicMood): void {
    this.mood = mood;
    this.applyVolume();
  }

  private nextFile(): void {
    const list = this.tracks;
    if (!list.length || !this.el) return;
    this.index = (this.index + 1) % this.order.length;
    const t = list[this.order[this.index]] ?? list[0];
    this.el.src = t.url;
    void this.el.play().catch(() => {});
    this.onTrackChange?.(t.name);
  }

  skip(): void {
    if (this.tracks.length) this.nextFile();
  }

  private stopAll(): void {
    this.synth?.stop();
    this.el?.pause();
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
    this.el?.pause();
    this.index = -1;
    this.currentTheme = null;
  }

  async clearFiles(): Promise<void> {
    await clearTracks();
    for (const t of this.userTracks) URL.revokeObjectURL(t.url);
    this.userTracks = [];
    this.shuffle();
    this.el?.pause();
    if (this.el) this.el.removeAttribute('src');
    this.currentTheme = null;
  }
}
