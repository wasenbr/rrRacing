import { connectedPads, padSetupActive, readPadMenu, type PadMenuState } from './gamepad';

/**
 * Navegação dos menus pelo controle: direcional (D-pad ou analógico) move o foco para o botão mais
 * próximo naquele sentido, Confirmar clica, Voltar aciona o "← Voltar" da tela e Start fecha a pausa.
 * Só roda com um controle conectado e com o menu na tela.
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

export function startPadNav(root: HTMLElement, hooks: { onSecret: () => void }): void {
  let raf = 0;
  let prev: PadMenuState = { x: 0, y: 0, confirm: true, back: true, pause: true, secret: true };
  let holdDir = '';
  let holdT = 0;
  let last = 0;

  const active = () => root.style.display !== 'none' && !padSetupActive;
  const current = (): HTMLElement | null => {
    const f = document.activeElement as HTMLElement | null;
    return f && root.contains(f) && visible(f) ? f : null;
  };
  const focus = (el: HTMLElement) => {
    document.body.classList.add('pad-nav');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const initial = (list: HTMLElement[]) => list.find((el) => el.classList.contains('go')) ?? list[0];

  const move = (dx: number, dy: number) => {
    const list = candidates(root);
    if (!list.length) return;
    const cur = current();
    if (!cur) return focus(initial(list));
    // controles deslizantes e listas: esquerda/direita mudam o valor
    if (dx && cur instanceof HTMLInputElement && cur.type === 'range') {
      const step = (Number(cur.max) - Number(cur.min)) / 20;
      cur.value = String(Number(cur.value) + dx * step);
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (dx && cur instanceof HTMLSelectElement) {
      const i = Math.max(0, Math.min(cur.options.length - 1, cur.selectedIndex + dx));
      if (i !== cur.selectedIndex) {
        cur.selectedIndex = i;
        cur.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    const next = nearest(cur, list, dx, dy);
    if (next) focus(next);
  };

  const press = (el: HTMLElement) => {
    const sig = signature(el);
    el.click();
    // a tela foi redesenhada: devolve o foco ao mesmo botão, se ele ainda existir
    if (!current()) {
      const same = candidates(root).find((c) => signature(c) === sig);
      if (same) focus(same);
    }
  };

  const confirm = () => {
    const cur = current();
    if (cur) return press(cur);
    const list = candidates(root);
    if (list.length) return focus(initial(list));
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

  const tick = (t: number) => {
    raf = 0;
    if (!connectedPads().length) return;
    raf = requestAnimationFrame(tick);
    const s = readPadMenu();
    if (!s) return;
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
    last = t;
    if (active()) {
      const dir = s.x || s.y ? `${s.x},${s.y}` : '';
      if (dir && dir !== holdDir) {
        // diagonal: vale o eixo vertical (listas são verticais)
        if (s.y) move(0, s.y);
        else move(s.x, 0);
        holdT = REPEAT_FIRST;
      } else if (dir) {
        holdT -= dt;
        if (holdT <= 0) {
          if (s.y) move(0, s.y);
          else move(s.x, 0);
          holdT = REPEAT_NEXT;
        }
      }
      holdDir = dir;
      // tela nova com o controle em uso: já foca o botão principal
      if (!dir && document.body.classList.contains('pad-nav') && !current()) {
        const list = candidates(root);
        if (list.length) focus(initial(list));
      }
      if (s.confirm && !prev.confirm) confirm();
      else if (s.back && !prev.back) back();
      else if (s.pause && !prev.pause) {
        const resume = root.querySelector<HTMLElement>('[data-act="resume"]');
        if (resume && visible(resume)) press(resume);
      }
      if (s.secret && !prev.secret) hooks.onSecret();
    } else holdDir = '';
    prev = s;
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
