import { clamp } from '../sim/math';
import { emptyInput, type ControlInput } from '../sim/input';

/** Ações de interface (não vão para a simulação). */
export type UiAction = 'camera' | 'pause' | 'mute';

/**
 * Junta teclado, controle (Gamepad API) e botões de toque num único ControlInput.
 */
export class Controls {
  private keys = new Set<string>();
  private touch = new Map<string, number>(); // ação -> quantidade de dedos pressionando
  private listeners: ((a: UiAction) => void)[] = [];
  private prevPadButtons: boolean[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.emit('camera');
      if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause');
      if (e.code === 'KeyM') this.emit('mute');
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touch.clear();
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

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private t(action: string): boolean {
    return this.touch.has(action);
  }

  read(): ControlInput {
    const input = emptyInput();
    input.throttle = this.key('ArrowUp', 'KeyW') || this.t('gas') ? 1 : 0;
    input.brake = this.key('ArrowDown', 'KeyS') || this.t('brake') ? 1 : 0;
    input.steer = (this.key('ArrowRight', 'KeyD') || this.t('right') ? 1 : 0) - (this.key('ArrowLeft', 'KeyA') || this.t('left') ? 1 : 0);
    input.fire = this.key('Space', 'KeyJ') || this.t('fire');
    input.drop = this.key('KeyX', 'KeyK', 'ControlLeft') || this.t('drop');
    input.nitro = this.key('ShiftLeft', 'ShiftRight', 'KeyL') || this.t('nitro');
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
    input.drop ||= b(1) || b(4);
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

/** Cria os botões na tela para celular/tablet. */
export function createTouchControls(root: HTMLElement, controls: Controls): HTMLElement {
  const el = document.createElement('div');
  el.className = 'touch';
  el.innerHTML = `
    <div class="touch-left">
      <button data-a="left" aria-label="Esquerda">◀</button>
      <button data-a="right" aria-label="Direita">▶</button>
    </div>
    <div class="touch-right">
      <button data-a="drop" class="small" aria-label="Arma traseira">MINA</button>
      <button data-a="fire" class="small" aria-label="Atirar">TIRO</button>
      <button data-a="nitro" class="small" aria-label="Nitro">NITRO</button>
      <button data-a="brake" aria-label="Freio">FREIO</button>
      <button data-a="gas" class="gas" aria-label="Acelerar">ACEL</button>
    </div>
    <div class="touch-top">
      <button data-ui="camera" aria-label="Trocar câmera">🎥</button>
      <button data-ui="pause" aria-label="Pausar">❚❚</button>
    </div>`;
  root.appendChild(el);

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
  el.querySelectorAll<HTMLButtonElement>('button[data-ui]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      controls.emit(btn.dataset.ui as UiAction);
    });
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}
