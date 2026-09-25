import { clamp } from '../sim/math';

/**
 * Leitura de controles pela Gamepad API: Xbox e PlayStation (mapeamento "standard" do navegador),
 * controles USB genéricos (mapeamento próprio, com D-pad em eixo "hat") e botões configurados pelo
 * jogador. Todos os controles conectados valem ao mesmo tempo (um controle virtual ou um fone que o
 * Windows lista como controle não esconde mais o controle de verdade).
 */

/** Ações que o jogador pode configurar. */
export const PAD_ACTIONS = ['confirm', 'back', 'throttle', 'brake', 'fire', 'drop', 'sharp', 'nitro', 'camera', 'pause'] as const;
export type PadAction = (typeof PAD_ACTIONS)[number];

export const PAD_ACTION_LABELS: Record<PadAction, string> = {
  confirm: 'Confirmar (menus)',
  back: 'Voltar (menus)',
  throttle: 'Acelerar',
  brake: 'Freio / ré',
  fire: 'Atirar',
  drop: 'Arma traseira',
  sharp: 'Derrapar',
  nitro: 'Nitro / pulo',
  camera: 'Câmera',
  pause: 'Pausa',
};

/** Botão (índice) ou eixo com sentido e valor de repouso. */
export type PadBind = { b: number } | { a: number; s: 1 | -1; rest: number };
type PadMap = Record<PadAction, PadBind[]>;

const btns = (...i: number[]): PadBind[] => i.map((b) => ({ b }));

/** Xbox, PlayStation e todo controle que o navegador reconhece ("standard"). */
const STANDARD: PadMap = {
  confirm: btns(0),
  back: btns(1),
  throttle: btns(7, 0),
  brake: btns(6),
  fire: btns(2, 5),
  drop: btns(1),
  sharp: btns(4),
  nitro: btns(10, 11),
  camera: btns(3),
  pause: btns(9),
};

/**
 * PlayStation (DualSense/DualShock) no mapeamento "standard": R2 acelera, L2 freia, R1 câmera,
 * ✕ atira, □ turbo, ○ arma traseira, L1 derrapar.
 */
const PLAYSTATION: PadMap = {
  confirm: btns(0),
  back: btns(1),
  throttle: btns(7),
  brake: btns(6),
  fire: btns(0),
  drop: btns(1),
  sharp: btns(4),
  nitro: btns(2, 10, 11),
  camera: btns(5),
  pause: btns(9),
};

/**
 * Controle genérico (DirectInput, e PlayStation no Firefox): o layout varia de fabricante para
 * fabricante; este é o mais comum (2 = botão de baixo, 1 = da direita, 4..7 = ombros e gatilhos,
 * 8/9 = Select/Start). Se não bater, o jogador configura em "Som e opções".
 */
const GENERIC: PadMap = {
  confirm: btns(2),
  back: btns(1),
  throttle: btns(2, 7),
  brake: btns(6),
  fire: btns(0, 5),
  drop: btns(1),
  sharp: btns(4),
  nitro: btns(3, 10, 11),
  camera: btns(8),
  pause: btns(9),
};

const STORE_KEY = 'rnrr3d-pad-map';

let custom: Record<string, Partial<PadMap>> = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
})();

function saveCustom(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(custom));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

/** Todos os controles conectados agora. */
export function connectedPads(): Gamepad[] {
  const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  return list.filter((p): p is Gamepad => !!p && p.connected);
}

export function padKind(pad: Gamepad): 'xbox' | 'ps' | 'generic' {
  const id = pad.id.toLowerCase();
  if (/054c|playstation|dualshock|dualsense|wireless controller/.test(id)) return 'ps';
  if (pad.mapping === 'standard') return 'xbox';
  return 'generic';
}

function mapFor(pad: Gamepad): PadMap {
  const base = pad.mapping !== 'standard' ? GENERIC : padKind(pad) === 'ps' ? PLAYSTATION : STANDARD;
  const own = custom[pad.id];
  return own ? { ...base, ...own } : base;
}

export function hasCustomMap(pad: Gamepad): boolean {
  return !!custom[pad.id];
}

export function setCustomMap(pad: Gamepad, map: Partial<PadMap>): void {
  custom[pad.id] = map;
  saveCustom();
}

export function clearCustomMap(pad: Gamepad): void {
  delete custom[pad.id];
  saveCustom();
}

function bindValue(pad: Gamepad, bind: PadBind): number {
  if ('b' in bind) {
    const b = pad.buttons[bind.b];
    if (!b) return 0;
    return b.pressed ? Math.max(b.value, 1) : b.value > 0.1 ? b.value : 0;
  }
  const v = pad.axes[bind.a];
  if (v === undefined) return 0;
  // gatilho em eixo: repousa em -1 (ou 0) e vai até +1
  const span = bind.s > 0 ? 1 - bind.rest : 1 + bind.rest;
  const x = clamp(((v - bind.rest) * bind.s) / Math.max(span, 0.01), 0, 1);
  return x > 0.15 ? x : 0;
}

/** Valor (0..1) da ação somando todos os controles. */
function actionValue(pads: Gamepad[], action: PadAction): number {
  let best = 0;
  for (const pad of pads) for (const bind of mapFor(pad)[action]) best = Math.max(best, bindValue(pad, bind));
  return best;
}

/** D-pad em eixo "hat" (controles genéricos): -1 = cima e sobe de 2/7 em 2/7 no sentido horário; >1 = solto. */
function hat(pad: Gamepad): { x: number; y: number } {
  if (pad.mapping === 'standard' || pad.axes.length < 10) return { x: 0, y: 0 };
  const v = pad.axes[9];
  if (v === undefined || Math.abs(v) > 1.05) return { x: 0, y: 0 };
  const step = Math.round(((v + 1) * 7) / 2) & 7;
  const dirs = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  return { x: dirs[step][0], y: dirs[step][1] };
}

/** Direção digital (D-pad ou hat) de um controle. */
function dpad(pad: Gamepad): { x: number; y: number } {
  if (pad.mapping === 'standard') {
    const p = (i: number) => (pad.buttons[i]?.pressed ? 1 : 0);
    return { x: p(15) - p(14), y: p(13) - p(12) };
  }
  return hat(pad);
}

export interface PadState {
  /** direção (-1..1): analógico, com D-pad por cima */
  steer: number;
  throttle: number;
  brake: number;
  fire: boolean;
  drop: boolean;
  sharp: boolean;
  nitro: boolean;
  camera: boolean;
  pause: boolean;
}

/** Estado de corrida de todos os controles juntos (null = nenhum controle). */
export function readPads(): PadState | null {
  const pads = connectedPads();
  if (!pads.length) return null;
  let steer = 0;
  let digital = 0;
  for (const pad of pads) {
    const x = pad.axes[0] ?? 0;
    if (Math.abs(x) > 0.15 && Math.abs(x) > Math.abs(steer)) steer = x;
    const d = dpad(pad).x;
    if (d) digital = d;
  }
  if (digital) steer = digital;
  return {
    steer: clamp(steer, -1, 1),
    throttle: actionValue(pads, 'throttle'),
    brake: actionValue(pads, 'brake'),
    fire: actionValue(pads, 'fire') > 0.5,
    drop: actionValue(pads, 'drop') > 0.5,
    sharp: actionValue(pads, 'sharp') > 0.5,
    nitro: actionValue(pads, 'nitro') > 0.5,
    camera: actionValue(pads, 'camera') > 0.5,
    pause: actionValue(pads, 'pause') > 0.5,
  };
}

export interface PadMenuState {
  x: number;
  y: number;
  confirm: boolean;
  back: boolean;
  pause: boolean;
  /** L + R + Select (segredo da campanha) */
  secret: boolean;
}

/** Estado para os menus: direção (analógico ou D-pad) e confirmar/voltar. */
export function readPadMenu(): PadMenuState | null {
  const pads = connectedPads();
  if (!pads.length) return null;
  let x = 0;
  let y = 0;
  let secret = false;
  for (const pad of pads) {
    const d = dpad(pad);
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    x ||= d.x || (Math.abs(ax) > 0.55 ? Math.sign(ax) : 0);
    y ||= d.y || (Math.abs(ay) > 0.55 ? Math.sign(ay) : 0);
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    secret ||= b(4) && b(5) && b(8);
  }
  return {
    x,
    y,
    confirm: actionValue(pads, 'confirm') > 0.5,
    back: actionValue(pads, 'back') > 0.5,
    pause: actionValue(pads, 'pause') > 0.5,
    secret,
  };
}

/* ---------------- configuração de botões ---------------- */

/** Tela de configuração aberta: os menus e a corrida ignoram o controle. */
export let padSetupActive = false;

/**
 * Configura os botões do primeiro controle em uso: pede cada ação e grava o próximo botão (ou eixo,
 * para gatilhos analógicos) apertado. Fica salvo por modelo de controle neste aparelho.
 */
export function openPadSetup(host: HTMLElement, onDone: (msg: string) => void): void {
  const pads = connectedPads();
  if (!pads.length) {
    onDone('Nenhum controle encontrado. Conecte o controle e aperte um botão dele.');
    return;
  }
  // o controle que tem algum botão apertado agora, senão o primeiro
  const pad = pads.find((p) => p.buttons.some((b) => b.pressed)) ?? pads[0];
  const index = pad.index;
  const padId = pad.id;
  padSetupActive = true;
  const map: Partial<PadMap> = {};
  let step = 0;
  let raf = 0;
  const el = document.createElement('div');
  el.className = 'pad-setup';
  host.appendChild(el);

  const current = (): Gamepad | null => connectedPads().find((p) => p.index === index && p.id === padId) ?? null;
  const snapshot = (p: Gamepad) => ({ buttons: p.buttons.map((b) => b.pressed || b.value > 0.5), axes: [...p.axes] });
  let rest = snapshot(pad);
  // espera soltar tudo antes de aceitar o próximo botão
  let waitRelease = true;

  const finish = (save: boolean) => {
    cancelAnimationFrame(raf);
    el.remove();
    // só volta a valer no menu depois de soltar o botão (senão o último aperto "clicava" o menu)
    setTimeout(() => (padSetupActive = false), 250);
    if (save) {
      setCustomMap(pad, map);
      onDone('Controle configurado.');
    } else onDone('');
  };

  const render = () => {
    const action = PAD_ACTIONS[step];
    el.innerHTML = `<div class="pad-setup-card" role="dialog" aria-label="Configurar controle">
      <h3>CONFIGURAR CONTROLE</h3>
      <small class="pad-name">${padId.replace(/[<>&]/g, '')}</small>
      <p>Aperte o botão para</p>
      <b class="pad-action">${PAD_ACTION_LABELS[action]}</b>
      <small>${step + 1} de ${PAD_ACTIONS.length}</small>
      <div class="row-buttons"><button data-ps="skip">Pular</button><button data-ps="cancel">Cancelar</button></div>
    </div>`;
  };

  const assign = (bind: PadBind) => {
    map[PAD_ACTIONS[step]] = [bind];
    step++;
    waitRelease = true;
    if (step >= PAD_ACTIONS.length) finish(true);
    else render();
  };

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-ps]')?.dataset.ps;
    if (act === 'cancel') finish(false);
    if (act === 'skip') {
      step++;
      if (step >= PAD_ACTIONS.length) finish(true);
      else render();
    }
  });

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const p = current();
    if (!p) return;
    const now = snapshot(p);
    if (waitRelease) {
      const busy = now.buttons.some((b, i) => b && !rest.buttons[i]) || now.axes.some((v, i) => Math.abs(v - (rest.axes[i] ?? v)) > 0.5);
      if (!busy) waitRelease = false;
      return;
    }
    const bi = now.buttons.findIndex((b) => b);
    if (bi >= 0) return assign({ b: bi });
    for (let i = 0; i < now.axes.length; i++) {
      // o hat do D-pad genérico não é gatilho: fica de fora
      if (i === 9 && p.mapping !== 'standard' && p.axes.length >= 10) continue;
      const d = now.axes[i] - (rest.axes[i] ?? 0);
      if (Math.abs(d) > 0.6) return assign({ a: i, s: d > 0 ? 1 : -1, rest: rest.axes[i] ?? 0 });
    }
  };

  render();
  // repouso dos eixos medido com o controle solto (gatilhos em eixo repousam em -1)
  requestAnimationFrame(() => {
    const p = current();
    if (p) rest = snapshot(p);
    rest.buttons = rest.buttons.map(() => false);
    tick();
  });
}
