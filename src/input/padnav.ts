import { sfxMenuMove } from '../audio/sfx';
import { connectedPads, padSetupActive, readPadMenu, splitAssignment, type PadMenuState } from './gamepad';

/**
 * Navegação dos menus pelo controle: direcional (D-pad ou analógico) move o foco para o botão mais
 * próximo naquele sentido, Confirmar clica, Voltar aciona o "← Voltar" da tela e Start fecha a pausa.
 * Só roda com um controle conectado e com o menu na tela.
 * Com dois controles (modo de 2 jogadores) cada um tem o seu cursor: o do jogador 1 é o foco da
 * página (azul) e o do jogador 2 é a marca `.pad-cur2` (vermelho), nas cores das colunas da tela
 * dividida. Quem é o jogador 1 segue a troca de controles da tela dividida.
 */

const FOCUSABLE = 'button, input:not([type="hidden"]), select, summary, a[href]';
const REPEAT_FIRST = 0.4;
const REPEAT_NEXT = 0.14;

function visible(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function candidates(root: HTMLElement): HTMLElement[] {
  // detalhes fechados: só o resumo conta
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (!visible(el)) return false;
    const det = el.closest('details');
    return !det || det.open || el.tagName === 'SUMMARY';
  });
}

/** Elemento mais próximo no sentido (dx, dy) a partir do atual. */
function nearest(from: HTMLElement, list: HTMLElement[], dx: number, dy: number): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    // avanço no sentido pedido (pelas bordas, para linhas de alturas diferentes) e desvio lateral
    const along = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : dy > 0 ? b.top - a.bottom : a.top - b.bottom;
    const center = dx ? (bx - ax) * dx : (by - ay) * dy;
    if (center <= 4 || along < -Math.min(a.width, a.height, b.width, b.height) / 2) continue;
    const side = dx ? Math.abs(by - ay) : Math.abs(bx - ax);
    const score = Math.max(along, 0) + side * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Assinatura para achar "o mesmo botão" depois que a tela é redesenhada. */
function signature(el: HTMLElement): string {
  return el.tagName + JSON.stringify(el.dataset) + (el.dataset && Object.keys(el.dataset).length ? '' : el.textContent?.trim());
}

/** Um cursor: o foco da página (jogador 1 ou controle único) ou a marca do jogador 2. */
interface Cursor {
  get(): HTMLElement | null;
  set(el: HTMLElement): void;
  prev: PadMenuState;
  holdDir: string;
  holdT: number;
}

const RELEASED: PadMenuState = { x: 0, y: 0, confirm: true, back: true, pause: true, secret: true };

export function startPadNav(root: HTMLElement, hooks: { onSecret: () => void; swap: () => boolean }): void {
  let raf = 0;
  let last = 0;

  const active = () => root.style.display !== 'none' && !padSetupActive;
  const show = (el: HTMLElement) => {
    document.body.classList.add('pad-nav');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const p1: Cursor = {
    get() {
      const f = document.activeElement as HTMLElement | null;
      return f && root.contains(f) && visible(f) ? f : null;
    },
    set(el) {
      el.focus({ preventScroll: true });
      show(el);
    },
    prev: RELEASED,
    holdDir: '',
    holdT: 0,
  };
  let mark2: HTMLElement | null = null;
  const clear2 = () => {
    mark2?.classList.remove('pad-cur2');
    mark2 = null;
  };
  const p2: Cursor = {
    get: () => (mark2 && root.contains(mark2) && visible(mark2) ? mark2 : null),
    set(el) {
      clear2();
      mark2 = el;
      el.classList.add('pad-cur2');
      show(el);
    },
    prev: RELEASED,
    holdDir: '',
    holdT: 0,
  };
  const initial = (list: HTMLElement[]) => list.find((el) => el.classList.contains('go')) ?? list[0];

  const move = (c: Cursor, dx: number, dy: number) => {
    const list = candidates(root);
    if (!list.length) return;
    const cur = c.get();
    if (!cur) return c.set(initial(list));
    // controles deslizantes e listas: esquerda/direita mudam o valor
    if (dx && cur instanceof HTMLInputElement && cur.type === 'range') {
      const step = (Number(cur.max) - Number(cur.min)) / 20;
      cur.value = String(Number(cur.value) + dx * step);
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      sfxMenuMove();
      return;
    }
    if (dx && cur instanceof HTMLSelectElement) {
      const i = Math.max(0, Math.min(cur.options.length - 1, cur.selectedIndex + dx));
      if (i !== cur.selectedIndex) {
        cur.selectedIndex = i;
        cur.dispatchEvent(new Event('change', { bubbles: true }));
        sfxMenuMove();
      }
      return;
    }
    const next = nearest(cur, list, dx, dy);
    if (next) {
      c.set(next);
      sfxMenuMove();
    }
  };

  const press = (el: HTMLElement) => {
    // a tela pode ser redesenhada: guarda onde estava cada cursor para devolvê-lo ao mesmo botão
    const at = [p1, p2].map((c) => {
      const cur = c.get();
      return cur ? signature(cur) : '';
    });
    el.click();
    [p1, p2].forEach((c, k) => {
      if (!at[k] || c.get()) return;
      const same = candidates(root).find((e) => signature(e) === at[k]);
      if (same) c.set(same);
    });
  };

  const confirm = (c: Cursor) => {
    const cur = c.get();
    if (cur) return press(cur);
    const list = candidates(root);
    if (list.length) return c.set(initial(list));
    // telas sem botões (viagem entre planetas, final): um toque avança
    (root.firstElementChild as HTMLElement | null)?.click();
  };

  const back = () => {
    // pausa: Voltar continua a corrida; nas outras telas, o botão "← ..." (Voltar, Sair da sala...)
    const resume = root.querySelector<HTMLElement>('[data-act="resume"]');
    const btn =
      resume && visible(resume) ? resume : Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.trim().startsWith('←') && visible(b));
    if (btn) press(btn);
  };

  /** Direção, confirmar, voltar e pausa de um cursor; `s` é o estado do controle dele. */
  const drive = (c: Cursor, s: PadMenuState, dt: number) => {
    const dir = s.x || s.y ? `${s.x},${s.y}` : '';
    // diagonal: vale o eixo vertical (listas são verticais)
    const step = () => (s.y ? move(c, 0, s.y) : move(c, s.x, 0));
    if (dir && dir !== c.holdDir) {
      step();
      c.holdT = REPEAT_FIRST;
    } else if (dir) {
      c.holdT -= dt;
      if (c.holdT <= 0) {
        step();
        c.holdT = REPEAT_NEXT;
      }
    }
    c.holdDir = dir;
    // tela nova com o controle em uso: já põe o cursor no botão principal
    if (!dir && document.body.classList.contains('pad-nav') && !c.get()) {
      const list = candidates(root);
      if (list.length) c.set(initial(list));
    }
    if (s.confirm && !c.prev.confirm) confirm(c);
    else if (s.back && !c.prev.back) back();
    else if (s.pause && !c.prev.pause) {
      const resume = root.querySelector<HTMLElement>('[data-act="resume"]');
      if (resume && visible(resume)) press(resume);
    }
    if (s.secret && !c.prev.secret) hooks.onSecret();
    c.prev = s;
  };

  const tick = (t: number) => {
    raf = 0;
    const pads = connectedPads();
    if (!pads.length) {
      clear2();
      document.body.classList.remove('pad-duo');
      return;
    }
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
    last = t;
    const duo = pads.length >= 2;
    document.body.classList.toggle('pad-duo', duo);
    if (!duo) clear2();
    const own = duo ? splitAssignment(hooks.swap()) : null;
    const s1 = readPadMenu(own?.p1 ? [own.p1] : pads);
    const s2 = own?.p2 ? readPadMenu([own.p2]) : null;
    if (!active()) {
      p1.holdDir = p2.holdDir = '';
      if (s1) p1.prev = s1;
      if (s2) p2.prev = s2;
      return;
    }
    if (s1) drive(p1, s1, dt);
    if (s2) drive(p2, s2, dt);
  };

  const wake = () => {
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  window.addEventListener('gamepadconnected', wake);
  // mouse ou toque: some o destaque do controle
  window.addEventListener('pointerdown', () => document.body.classList.remove('pad-nav'), true);
  wake();
}
