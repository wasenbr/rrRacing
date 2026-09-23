import './style.css';
import { Game } from './core/game';

const game = new Game(document.getElementById('game')!);
if (import.meta.env.DEV) {
  // acesso para depuração no console durante o desenvolvimento
  (window as unknown as { game: Game }).game = game;
  // módulos do mesmo grafo do jogo, usados por scripts/evidencias.mjs (evita cópias duplicadas pelo HMR)
  (window as unknown as { devModules: () => Promise<unknown> }).devModules = async () => ({
    ...(await import('./audio/context')),
    ...(await import('./audio/sfx')),
    ...(await import('./audio/engine')),
    ...(await import('./audio/synthrock')),
    ...(await import('./audio/announcer')),
    ...(await import('./audio/music')),
    ...(await import('./audio/samples')),
    ...(await import('./data/tracks')),
    ...(await import('./data/vehicles')),
    ...(await import('./sim/track')),
    ...(await import('./sim/world')),
    ...(await import('./sim/vehicle')),
    ...(await import('./sim/garage')),
  });
}
