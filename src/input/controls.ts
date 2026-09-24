import { clamp } from '../sim/math';
import { emptyInput, type ControlInput } from '../sim/input';
import { icon } from '../ui/icons';

const TILT_KEY = 'rnrr3d-tilt';
/** Graus de inclinação para esterçar tudo. */
const TILT_FULL = 22;
const TILT_DEAD = 2.5;

let tiltOn = (() => {
  try {
    return localStorage.getItem(TILT_KEY) === '1';
  } catch {
    return false;
  }
})();
/** direção atual pela inclinação (-1..1) */
let tiltSteer = 0;
let tiltListening = false;

function onOrientation(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return;
  // celular deitado: girar como volante muda o beta; o sinal depende de para que lado ele deitou
  const angle = screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
  const tilt = angle === 90 ? e.beta : angle === 270 || angle === -90 ? -e.beta : e.gamma;
  const a = Math.abs(tilt) < TILT_DEAD ? 0 : (Math.abs(tilt) - TILT_DEAD) / (TILT_FULL - TILT_DEAD);
  // mesma resposta progressiva do volante de toque: inclinações pequenas corrigem de leve
  tiltSteer = Math.sign(tilt) * Math.pow(clamp(a, 0, 1), 1.5);
}

function listenTilt(): void {
  if (tiltListening) return;
  tiltListening = true;
  window.addEventListener('deviceorientation', onOrientation);
}

/** Direção por inclinação ligada? (celular) */
export function tiltSteeringEnabled(): boolean {
  return tiltOn;
}

/** O aparelho tem sensor de inclinação? */
export function tiltSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/**
 * Liga/desliga a direção por inclinação. No iPhone a permissão só pode ser pedida durante um toque
 * do usuário (chame a partir do clique no botão). Com ela ligada, o volante de toque some e o
 * polegar esquerdo fica livre para as armas.
 */
export async function setTiltSteering(on: boolean): Promise<boolean> {
  if (on) {
    const req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (req) {
      try {
        if ((await req()) !== 'granted') on = false;
      } catch {
        on = false;
      }
    }
  }
  tiltOn = on;
  if (on) listenTilt();
  else tiltSteer = 0;
  try {
    localStorage.setItem(TILT_KEY, on ? '1' : '0');
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
  document.querySelectorAll('.touch').forEach((el) => el.classList.toggle('tilt', on));
  return on;
}

/** Ações de interface (não vão para a simulação). */
export type UiAction = 'camera' | 'pause' | 'mute' | 'fullscreen';

/**
 * Junta teclado, controle (Gamepad API) e botões de toque num único ControlInput.
 */
export class Controls {
  private keys = new Set<string>();
  private touch = new Map<string, number>(); // ação -> quantidade de dedos pressionando
  private listeners: ((a: UiAction) => void)[] = [];
  private prevPadButtons: boolean[] = [];
  /** direção analógica do volante de toque (-1..1), 0 = solto */
  private touchSteer = 0;
  /** volante de toque arrastado até o fim da faixa: curva fechada */
  private touchSharp = false;
  /** celular: acelera sozinho (freio/ré continuam no botão) */
  autoThrottle = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      // Ctrl esquerdo é o tiro: bloqueia os atalhos do navegador (Ctrl+S, Ctrl+D...) enquanto atira
      if (!typing && (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'ControlLeft' || e.ctrlKey)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.emit('camera');
      if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause');
      if (e.code === 'KeyM') this.emit('mute');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touch.clear();
      this.touchSteer = 0;
      this.touchSharp = false;
    });
  }

  onUiAction(fn: (a: UiAction) => void): void {
    this.listeners.push(fn);
  }

  emit(a: UiAction): void {
    for (const fn of this.listeners) fn(a);
  }

  setTouch(action: string, pressed: boolean): void {
    const n = (this.touch.get(action) ?? 0) + (pressed ? 1 : -1);
    if (n <= 0) this.touch.delete(action);
    else this.touch.set(action, n);
  }

  /** Volante de toque: -1 (esquerda) .. 1 (direita). */
  setTouchSteer(v: number, sharp = false): void {
    this.touchSteer = clamp(v, -1, 1);
    this.touchSharp = sharp;
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private t(action: string): boolean {
    return this.touch.has(action);
  }

  read(): ControlInput {
    const input = emptyInput();
    input.brake = this.key('ArrowDown', 'KeyS') || this.t('brake') ? 1 : 0;
    input.throttle = this.key('ArrowUp', 'KeyW') || this.t('gas') || (this.autoThrottle && !input.brake) ? 1 : 0;
    input.steer = (this.key('ArrowRight', 'KeyD') ? 1 : 0) - (this.key('ArrowLeft', 'KeyA') ? 1 : 0);
    if (input.steer === 0) input.steer = this.touchSteer;
    if (input.steer === 0 && tiltOn) input.steer = tiltSteer;
    input.fire = this.key('ControlLeft', 'Space', 'KeyJ') || this.t('fire');
    // "\": Backslash no teclado americano, IntlBackslash (ao lado do Z) no ABNT2
    input.drop = this.key('Backslash', 'IntlBackslash', 'KeyX', 'KeyK') || this.t('drop');
    input.nitro = this.key('ShiftLeft', 'ShiftRight', 'KeyL') || this.t('nitro');
    input.sharp = this.key('KeyQ', 'KeyE', 'KeyU', 'AltLeft') || this.t('sharp') || this.touchSharp;
    this.readGamepad(input);
    return input;
  }

  private readGamepad(input: ControlInput): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) return;
    const b = (i: number) => pad.buttons[i]?.pressed ?? false;
    const v = (i: number) => pad.buttons[i]?.value ?? 0;
    const axis = pad.axes[0] ?? 0;
    if (Math.abs(axis) > 0.15) input.steer = clamp(input.steer + axis, -1, 1);
    if (b(14)) input.steer = -1;
    if (b(15)) input.steer = 1;
    input.throttle = Math.max(input.throttle, v(7), b(0) ? 1 : 0);
    input.brake = Math.max(input.brake, v(6));
    input.fire ||= b(2) || b(5);
    input.drop ||= b(1);
    // LB: curva fechada (freio de mão)
    input.sharp ||= b(4);
    input.nitro ||= b(10) || b(11);
    // borda de subida para ações de interface
    const cam = b(3);
    const pause = b(9);
    if (cam && !this.prevPadButtons[3]) this.emit('camera');
    if (pause && !this.prevPadButtons[9]) this.emit('pause');
    this.prevPadButtons[3] = cam;
    this.prevPadButtons[9] = pause;
  }
}

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

/**
 * Cria os controles de toque para celular/tablet.
 * Polegar esquerdo: volante (arrastar para os lados) e, logo acima, TIRO / ARMA TRASEIRA / NITRO.
 * Arrastando o volante para cima, o mesmo polegar atira sem soltar a direção. Com a direção por
 * inclinação, o volante some; com a aceleração automática, aparece um TIRO também à direita.
 * Polegar direito: ACELERAR (grande) e FREIO/RÉ — assim nunca é preciso soltar o acelerador para atirar.
 */
export function createTouchControls(root: HTMLElement, controls: Controls): HTMLElement {
  const el = document.createElement('div');
  el.className = 'touch';
  el.innerHTML = `
    <div class="touch-left">
      <div class="touch-actions">
        <button data-a="drop" class="act drop" aria-label="Arma traseira"><i class="t-ic"></i><span>MINA</span></button>
        <button data-a="fire" class="act fire" aria-label="Atirar"><i class="t-ic"></i><span>TIRO</span></button>
        <button data-a="nitro" class="act nitro" aria-label="Nitro"><i class="t-ic"></i><span>NITRO</span></button>
      </div>
      <div class="steer" aria-label="Volante: toque à esquerda ou à direita">
        <span class="arrow l">◀</span><span class="knob"></span><span class="arrow r">▶</span>
      </div>
    </div>
    <div class="touch-right">
      <div class="touch-rcol">
        <button data-a="sharp" class="sharp" aria-label="Derrapar (freio de mão)"><i class="t-ic">${icon('drift')}</i><span>DERRAPAR</span></button>
        <button data-a="brake" class="brake" aria-label="Freio e ré"><i class="t-ic">${icon('brake')}</i><span>FREIO</span></button>
      </div>
      <button data-a="gas" class="gas" aria-label="Acelerar">ACEL</button>
      <button data-a="fire" class="fire2" aria-label="Atirar"><i class="t-ic"></i><span>TIRO</span></button>
    </div>
    <div class="rotate-hint" aria-live="polite"><div><span class="rot-phone">${icon('phone')}</span><b>Gire o celular</b><small>O jogo é na horizontal. A corrida fica pausada.</small></div></div>
    <div class="touch-top">
      <button data-ui="pause" aria-label="Pausar">${icon('pause')}</button>
      <button data-ui="camera" aria-label="Trocar câmera">${icon('camera')}</button>
      <button data-ui="fullscreen" class="fs-btn" aria-label="Tela cheia">${icon('fullscreen')}</button>
    </div>`;
  root.appendChild(el);
  if (tiltOn) {
    el.classList.add('tilt');
    listenTilt();
  }

  // em pé: aviso para girar o aparelho e pausa a corrida (só se ela estiver rodando)
  const portrait = window.matchMedia('(orientation: portrait)');
  let pausedByRotate = false;
  const checkOrientation = () => {
    const overlay = root.querySelector<HTMLElement>('.overlay');
    const racing = !!overlay && overlay.style.display === 'none' && el.offsetParent !== null;
    if (portrait.matches) {
      if (racing) {
        pausedByRotate = true;
        controls.emit('pause');
      }
      el.classList.toggle('portrait', pausedByRotate || racing);
    } else {
      pausedByRotate = false;
      el.classList.remove('portrait');
    }
  };
  portrait.addEventListener('change', checkOrientation);
  window.addEventListener('resize', checkOrientation);

  el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((btn) => {
    const action = btn.dataset.a!;
    const active = new Set<number>();
    const down = (e: PointerEvent) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      if (!active.has(e.pointerId)) {
        active.add(e.pointerId);
        controls.setTouch(action, true);
        btn.classList.add('on');
        navigator.vibrate?.(action === 'fire' ? 12 : 6);
      }
    };
    const up = (e: PointerEvent) => {
      if (active.delete(e.pointerId)) {
        controls.setTouch(action, false);
        if (active.size === 0) btn.classList.remove('on');
      }
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
  });

  // volante: o dedo pousa em qualquer ponto e arrasta; o lado em que está define a direção
  const steer = el.querySelector<HTMLElement>('.steer')!;
  const knob = steer.querySelector<HTMLElement>('.knob')!;
  let steerPointer = -1;
  // o mesmo polegar que esterça pode subir até a fileira das armas e ATIRAR sem soltar o volante
  let slideFire = false;
  const setSlideFire = (on: boolean) => {
    if (on === slideFire) return;
    slideFire = on;
    controls.setTouch('fire', on);
    el.querySelector('.touch-actions .fire')?.classList.toggle('on', on);
    if (on) navigator.vibrate?.(12);
  };
  // retângulo lido só no toque inicial: ler a cada movimento, logo depois de mexer nas classes e no
  // transform do botão, forçava recálculo de layout (até 120x por segundo no iPad)
  let r = steer.getBoundingClientRect();
  const fireBtn = el.querySelector<HTMLElement>('.touch-actions .fire')!;
  // linha acima da qual o polegar do volante atira: 70% para dentro do botão TIRO (item 55: em tela
  // pequena, a tremida do polegar para cima disparava a arma e tirava a atenção da direção)
  let fireLine = -Infinity;
  // volante digital e relativo ao dedo (itens 46/47): o ponto onde o polegar pousa é o apoio.
  // Pousou longe do meio da faixa (> 25% da largura)? Já esterça total para aquele lado. Depois,
  // arrastar além de ±10 px do apoio escolhe o lado (esquerda/direita totais, como as setas do PC);
  // o apoio acompanha o dedo, então inverter pede só um arrasto curto de volta. Soltar = reto.
  const LAND_SIDE = 0.25; // fração da largura a partir do meio
  const FLIP_PX = 10;
  const LEASH_PX = 14; // folga do apoio atrás do dedo (tremida pequena não inverte)
  let anchor = 0;
  let side = 0;
  const setSide = (v: number) => {
    if (v === side) return;
    if (v !== 0) navigator.vibrate?.(8);
    side = v;
    controls.setTouchSteer(v);
    knob.style.transform = v ? `translateX(${v * r.width * 0.32}px)` : '';
    if (steer.classList.contains('l') !== v < 0) steer.classList.toggle('l', v < 0);
    if (steer.classList.contains('r') !== v > 0) steer.classList.toggle('r', v > 0);
  };
  const setFrom = (e: PointerEvent) => {
    // atirar deslizando: só com o polegar já dentro do botão TIRO
    setSlideFire(e.clientY < fireLine);
    const x = e.clientX;
    if (x > anchor + FLIP_PX) setSide(1);
    else if (x < anchor - FLIP_PX) setSide(-1);
    // o apoio segue o dedo no sentido em que ele esterça
    if (side > 0) anchor = Math.max(anchor, x - LEASH_PX);
    else if (side < 0) anchor = Math.min(anchor, x + LEASH_PX);
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== steerPointer) return;
    steerPointer = -1;
    setSlideFire(false);
    setSide(0);
    controls.setTouchSteer(0);
    knob.style.transform = '';
    steer.classList.remove('l', 'r', 'sharp', 'held');
  };
  steer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (steerPointer !== -1) return;
    steerPointer = e.pointerId;
    r = steer.getBoundingClientRect();
    const f = fireBtn.getBoundingClientRect();
    fireLine = f.height ? f.bottom - f.height * 0.7 : -Infinity;
    steer.classList.add('held');
    steer.setPointerCapture(e.pointerId);
    anchor = e.clientX;
    const rel = (e.clientX - (r.left + r.width / 2)) / r.width;
    setSide(rel > LAND_SIDE ? 1 : rel < -LAND_SIDE ? -1 : 0);
    setFrom(e);
  });
  steer.addEventListener('pointermove', (e) => {
    if (e.pointerId === steerPointer) setFrom(e);
  });
  steer.addEventListener('pointerup', release);
  steer.addEventListener('pointercancel', release);
  steer.addEventListener('lostpointercapture', release);

  el.querySelectorAll<HTMLButtonElement>('button[data-ui]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      controls.emit(btn.dataset.ui as UiAction);
    });
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

/** Arma/assistência atual de um botão de toque: ícone (SVG) + nome curto. */
export interface TouchItem {
  svg: string;
  label: string;
}

/**
 * Mostra nos botões de ação o ícone e o nome das armas do carro atual (dianteira no TIRO,
 * traseira no botão de mina/óleo, assistência no de nitro/pulo).
 */
export function setTouchWeapons(el: HTMLElement | null, items: { fire: TouchItem; drop: TouchItem; nitro: TouchItem }): void {
  if (!el) return;
  for (const [a, it] of Object.entries(items) as [keyof typeof items, TouchItem][]) {
    el.querySelectorAll<HTMLButtonElement>(`button[data-a="${a}"]`).forEach((btn) => {
      const ic = btn.querySelector('.t-ic');
      const tx = btn.querySelector('span');
      if (ic) ic.innerHTML = it.svg;
      // o TIRO segue escrito "TIRO" (ação), com o ícone da arma dianteira
      if (tx && a !== 'fire') tx.textContent = it.label.toUpperCase();
      btn.dataset.item = it.label;
    });
  }
}

/** Mostra/esconde o botão de acelerar (com aceleração automática ele some e o freio cresce). */
export function setTouchAutoThrottle(el: HTMLElement | null, on: boolean): void {
  el?.classList.toggle('auto-gas', on);
}
