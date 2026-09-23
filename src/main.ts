import './style.css';
import { Game } from './core/game';

const game = new Game(document.getElementById('game')!);
// acesso para depuração no console durante o desenvolvimento
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
