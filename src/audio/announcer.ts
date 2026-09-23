import { isMuted } from './context';

/**
 * Locutor no estilo do "Loudmouth" Larry do original, usando a voz sintética do navegador.
 * Evita falar demais: uma frase por vez, com intervalo mínimo; frases importantes furam a fila.
 */
export class Announcer {
  private lastSpoke = -Infinity;
  private voice: SpeechSynthesisVoice | null = null;
  enabled = true;

  constructor() {
    const pick = () => {
      const voices = window.speechSynthesis?.getVoices() ?? [];
      this.voice = voices.find((v) => /en[-_]US/i.test(v.lang) && /male|david|alex|daniel|fred/i.test(v.name)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
    };
    pick();
    window.speechSynthesis?.addEventListener?.('voiceschanged', pick);
  }

  say(text: string, important = false): void {
    const synth = window.speechSynthesis;
    if (!synth || !this.enabled || isMuted()) return;
    const now = performance.now() / 1000;
    if (!important && (now - this.lastSpoke < 3 || synth.speaking)) return;
    if (important) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? 'en-US';
    u.rate = 1.15;
    u.pitch = 0.75;
    u.volume = 1;
    synth.speak(u);
    this.lastSpoke = now;
  }
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Falas; `name` vazio = o jogador ("you"). */
export const LINES = {
  start: () => pick(['Let the carnage begin!', 'Gentlemen, start your engines... and your weapons!']),
  explode: (name: string) =>
    name ? pick([`${name} has been blasted!`, `${name} is toast!`, `${name} goes up in flames!`]) : pick(['You have been blasted!', "You're toast!"]),
  lowArmor: (name: string) => (name ? pick([`${name} is about to blow!`, `${name} is smoking!`]) : "You're about to blow!"),
  lead: (name: string) => (name ? pick([`${name} takes the lead!`, `${name} is out in front!`]) : 'You take the lead!'),
  finalLap: () => 'Final lap!',
  winner: (name: string) => (name ? `${name} wins the race!` : 'You win the race!'),
};
