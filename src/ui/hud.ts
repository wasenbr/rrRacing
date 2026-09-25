import type { Track } from '../sim/track';
import './hud.css';
import { drawTrack, trackTransform } from './trackMap';
import { withIcons } from './icons';
import { THEMES } from '../render/themes';

/** Esferas de blindagem (como o medidor do original, sob o contador de voltas). */
const ARMOR_DOTS = 10;

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Ícones das armas e assistências (SVG, herdam a cor do texto). */
export const ICONS: Record<string, string> = {
  // VK Plasma Rifles: bola de plasma com rastro
  laser:
    '<svg viewBox="0 0 24 24"><path d="M2 14c4-1 7-2 9-4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".55"/><circle cx="15" cy="9" r="5.5" fill="currentColor"/><circle cx="13.5" cy="7.5" r="2" fill="#fff" opacity=".7"/></svg>',
  // Rogue Missiles
  missile:
    '<svg viewBox="0 0 24 24"><path d="M12 1.5c3 3 4 7 4 11l3 3v3l-4-2-1 3h-4l-1-3-4 2v-3l3-3c0-4 1-8 4-11z" fill="currentColor"/><circle cx="12" cy="9" r="1.8" fill="#000" opacity=".5"/></svg>',
  // Sundog Beams: sol teleguiado
  sundog:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></g></svg>',
  // Bear Claw Mines
  mine: '<svg viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/></g><circle cx="12" cy="12" r="5.5" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="#ff2a1a"/></svg>',
  // KO Scatterpack: várias minas pequenas
  scatter:
    '<svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="6" cy="8" r="3.4"/><circle cx="17" cy="6" r="3"/><circle cx="12" cy="15" r="3.8"/><circle cx="4.5" cy="18" r="2.6"/><circle cx="19" cy="17" r="2.8"/></g><circle cx="12" cy="15" r="1.2" fill="#ff2a1a"/></svg>',
  // BF's Slipsauce
  oil: '<svg viewBox="0 0 24 24"><path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z" fill="currentColor"/><path d="M9 15a3 3 0 0 0 3 3" stroke="#fff" stroke-width="1.5" fill="none" opacity=".6"/></svg>',
  // Lightning Nitros
  nitro: '<svg viewBox="0 0 24 24"><path d="M13.5 1 4 13.5h6.5L9 23l10-13h-6.5z" fill="currentColor"/></svg>',
  // Locust Jump Jets
  jump: '<svg viewBox="0 0 24 24"><path d="M12 2 5 10h4.5v5h5v-5H19z" fill="currentColor"/><path d="M8 18c.5 2 1 3 1.5 4M12 17.5v4.5M16 18c-.5 2-1 3-1.5 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".7"/></svg>',
};

export interface HudSlot {
  icon: string;
  label: string;
  n: number;
  max: number;
  /** aceso (ex.: nitro em uso) */
  active?: boolean;
}

export interface HudData {
  time: number;
  best: number | null;
  speedKmh: number;
  place: number;
  total: number;
  /** 0..1 */
  armor: number;
  money: number;
  front: HudSlot;
  rear: HudSlot;
  assist: HudSlot;
  /** carros vivos (a lista é reaproveitada entre quadros: vale só até `carCount`) */
  cars: HudCar[];
  carCount: number;
}

export interface HudCar {
  x: number;
  z: number;
  heading?: number;
  color: string;
  me: boolean;
}

const ORD = ['', '1º', '2º', '3º', '4º', '5º', '6º'];

/**
 * HUD de corrida inspirada no original (SNES): tudo numa faixa no alto — minimapa num quadro à
 * esquerda, as três armas com contador, voltas com bolinhas verdes e a blindagem em esferas —
 * com acabamento de metal e tipografia pesada em itálico. A parte de baixo fica livre para os
 * botões de toque no celular.
 */
export class Hud {
  readonly el: HTMLElement;
  private lap: HTMLElement;
  private lapDots: HTMLElement;
  private time: HTMLElement;
  private best: HTMLElement;
  private speed: HTMLElement;
  private weapons: HTMLElement;
  private armor: HTMLElement;
  private money: HTMLElement;
  private pos: HTMLElement;
  private center: HTMLElement;
  private toast: HTMLElement;
  /** aviso de sistema (música, câmera, som, sala): canto de baixo, longe da contagem */
  private note: HTMLElement;
  private noteTimer = 0;
  /** relógio do HUD (pulso da seta do jogador no minimapa) */
  private clock = 0;
  private mirrorFrame: HTMLElement;
  private minimap: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapBase: HTMLCanvasElement;
  private mapTransform: (x: number, z: number) => [number, number];
  private toastTimer = 0;
  private centerTimer = 0;
  /** repetição da entrada da mensagem central (sem ler offsetWidth) */
  private centerAnim: Animation | null = null;
  private lapNow = 1;
  /** indicador de ping do online (criado no primeiro uso) */
  private pingEl: HTMLElement | null = null;
  private pingKey = '';

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'rh';
    this.el.innerHTML = `
      <div class="rh-left">
        <div class="rh-mapframe"><canvas class="rh-map" width="220" height="220"></canvas></div>
        <div class="rh-mid">
          <div class="rh-weapons"></div>
          <div class="rh-armor"></div>
          <div class="rh-money">$0</div>
        </div>
      </div>
      <div class="rh-right">
        <div class="rh-row">
          <div class="rh-pos"><b>1ST</b></div>
          <div class="rh-laps"><span>VOLTA</span><b>1/4</b></div>
        </div>
        <div class="rh-lapdots"></div>
        <div class="rh-time">0:00.00</div>
        <div class="rh-best"></div>
        <div class="rh-speed"><b>0</b><span>km/h</span></div>
        <div class="rh-toast"></div>
      </div>
      <div class="rh-center"></div>
      <div class="rh-note"></div>
      <div class="rh-mirror"></div>`;
    root.appendChild(this.el);
    const q = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.lap = q('.rh-laps b');
    this.lapDots = q('.rh-lapdots');
    this.time = q('.rh-time');
    this.best = q('.rh-best');
    this.speed = q('.rh-speed b');
    this.weapons = q('.rh-weapons');
    this.armor = q('.rh-armor');
    this.armor.innerHTML = '<i></i>'.repeat(ARMOR_DOTS);
    this.money = q('.rh-money');
    this.pos = q('.rh-pos');
    this.center = q('.rh-center');
    this.toast = q('.rh-toast');
    this.note = q('.rh-note');
    this.mirrorFrame = q('.rh-mirror');
    this.minimap = q('.rh-map') as HTMLCanvasElement;
    this.mapCtx = this.minimap.getContext('2d')!;
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.mapBase.height = this.minimap.width;
    this.mapTransform = () => [0, 0];
  }

  /** Troca a pista mostrada no minimapa. */
  setTrack(track: Track): void {
    const size = this.minimap.width;
    this.mapTransform = trackTransform(track, size, size, 18);
    const ctx = this.mapBase.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    // borda da pista na cor do planeta (contorno preto por fora), traçado por cima
    const theme = THEMES[track.def.theme];
    const pts = track.sampleCenterline(2);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [w, c] of [[22, 'rgba(0,0,0,0.85)'], [17, theme ? theme.roadEdge : '#c0c0c0']] as const) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.mapTransform(p.x, p.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.stroke();
    }
    drawTrack(ctx, track, this.mapTransform, 8);
    // já mostra a pista nova: durante o preparo da largada o HUD não é atualizado e o quadro
    // visível ficava com o minimapa da pista anterior
    this.mapCtx.clearRect(0, 0, size, size);
    this.mapCtx.drawImage(this.mapBase, 0, 0);
    this.mapTimer = 0;
  }

  setLap(lap: number, laps: number): void {
    this.lapNow = Math.min(lap, laps);
    this.lap.textContent = `${this.lapNow}/${laps}`;
    this.lapDots.innerHTML = Array.from({ length: laps }, (_, k) => `<i class="${k < this.lapNow - 1 ? 'done' : k === this.lapNow - 1 ? 'now' : ''}"></i>`).join('');
  }

  update(dt: number, data: HudData): void {
    // só escreve no DOM quando o texto muda: cada escrita custa recálculo de layout em celular fraco
    setText(this.time, formatTime(data.time));
    setText(this.best, data.best !== null ? `MELHOR ${formatTime(data.best)}` : '');
    setText(this.speed, String(Math.round(Math.abs(data.speedKmh))));
    const posKey = `${data.place}`;
    if (this.pos.dataset.v !== posKey) {
      this.pos.dataset.v = posKey;
      this.pos.className = `rh-pos p${data.place}`;
      this.pos.innerHTML = `<b>${ORD[data.place] ?? data.place}</b>`;
    }
    // toLocaleString é caro (Intl): só formata quando o valor muda
    if (this.moneyNow !== data.money) {
      this.moneyNow = data.money;
      setText(this.money, `$${data.money.toLocaleString('pt-BR')}`);
    }

    const ratio = Math.max(0, data.armor);
    const lit = Math.ceil(ratio * ARMOR_DOTS - 0.01);
    const tone = ratio > 0.6 ? 'ok' : ratio > 0.3 ? 'mid' : 'low';
    const key = `${lit}|${tone}`;
    if (this.armor.dataset.v !== key) {
      this.armor.dataset.v = key;
      this.armor.className = `rh-armor ${tone}`;
      this.armor.querySelectorAll('i').forEach((dot, k) => dot.classList.toggle('on', k < lit));
    }

    const f = data.front, r = data.rear, a = data.assist;
    const wkey = `${f.icon}${f.n}${f.active ? 1 : 0}${f.label}|${r.icon}${r.n}${r.active ? 1 : 0}${r.label}|${a.icon}${a.n}${a.active ? 1 : 0}${a.label}`;
    if (this.weaponsKey === wkey) return this.minimapTick(dt, data);
    this.weaponsKey = wkey;
    const slot = (s: HudSlot, cls: string) =>
      `<div class="w ${cls}${s.active ? ' active' : ''}${s.n === 0 ? ' empty' : ''}" title="${s.label}"><div class="ic">${ICONS[s.icon] ?? ICONS.laser}</div><b>${s.n}</b><small>${s.label}</small></div>`;
    const html = slot(data.front, 'front') + slot(data.rear, 'rear') + slot(data.assist, `assist ${data.assist.icon}`);
    if (this.weapons.dataset.v !== html) {
      this.weapons.innerHTML = html;
      this.weapons.dataset.v = html;
    }
    this.minimapTick(dt, data);
  }

  private moneyNow = NaN;
  private weaponsKey = '';

  private minimapTick(dt: number, data: HudData): void {

    // minimapa a ~30 quadros por segundo basta
    this.clock += dt;
    this.mapTimer -= dt;
    if (this.mapTimer > 0) return this.tickToast(dt);
    this.mapTimer = 1 / 30;
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, this.minimap.width, this.minimap.height);
    ctx.drawImage(this.mapBase, 0, 0);
    // tamanhos em pixels de tela (o canvas é reduzido pelo CSS): rivais com ~8 px e contorno
    // preto; o jogador é uma seta apontando para onde o carro vai
    // escala do canvas lida uma vez por redimensionamento (ler clientWidth a cada quadro força layout)
    if (this.mapK <= 0) this.mapK = this.minimap.width / Math.max(40, this.minimap.clientWidth || this.minimap.width);
    const k = this.mapK;
    ctx.lineJoin = 'round';
    // rivais primeiro, o jogador por cima (duas passadas, sem copiar e ordenar a lista)
    for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < data.carCount; i++) {
      const c = data.cars[i];
      if (c.me !== (pass === 1)) continue;
      const [x, y] = this.mapTransform(c.x, c.z);
      if (c.me) {
        const h = c.heading ?? 0;
        const [fx, fy] = this.mapTransform(c.x + Math.sin(h), c.z + Math.cos(h));
        const a = Math.atan2(fy - y, fx - x);
        // seta pulsante: acha o jogador de relance
        const r = 7.5 * k * (1 + 0.16 * Math.sin(this.clock * 7));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(r * 1.25, 0);
        ctx.lineTo(-r * 0.85, r * 0.8);
        ctx.lineTo(-r * 0.4, 0);
        ctx.lineTo(-r * 0.85, -r * 0.8);
        ctx.closePath();
        ctx.lineWidth = 3.2 * k;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.fillStyle = c.color;
        ctx.fill();
        ctx.lineWidth = 1.2 * k;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.restore();
      } else {
        // rival: ponto de ~6 px na cor do carro, contorno preto
        ctx.beginPath();
        ctx.arc(x, y, 3 * k, 0, Math.PI * 2);
        ctx.fillStyle = c.color;
        ctx.fill();
        ctx.lineWidth = 1.2 * k;
        ctx.strokeStyle = '#000';
        ctx.stroke();
      }
    }
    this.tickToast(dt);
  }

  private mapTimer = 0;
  /** pixels do canvas por pixel de tela no minimapa (0 = medir de novo) */
  private mapK = 0;

  /** A tela mudou de tamanho: o minimapa remede a escala no próximo desenho. */
  resize(): void {
    this.mapK = 0;
  }

  private tickToast(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    if (this.noteTimer > 0) {
      this.noteTimer -= dt;
      if (this.noteTimer <= 0) this.note.classList.remove('show');
    }
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.center.classList.remove('show');
    }
  }

  /** Mensagem grande no centro (contagem, "VOLTA FINAL", etc.). duration <= 0 = fica até trocar. */
  message(text: string, duration = 1.5, cls = ''): void {
    const className = `rh-center show ${cls ? `m-${cls}` : ''}`;
    const el = this.center;
    const showing = this.centerTimer > 0;
    this.centerTimer = duration > 0 ? duration : Infinity;
    // chamada a cada passo na contagem e no CONTRAMÃO: mesma mensagem na tela, só renova o tempo
    // (antes reescrevia o texto e lia offsetWidth: layout síncrono 60–120 vezes por segundo)
    if (showing && el.textContent === text && el.className === className) return;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== className) el.className = className;
    // já estava visível (3 → 2 → 1): repete a entrada (a transição do CSS) com a Web Animations,
    // sem forçar layout; entrando agora, a própria classe "show" dispara a transição
    if (showing && typeof el.animate === 'function') {
      this.centerAnim?.cancel();
      this.centerAnim = el.animate(CENTER_POP, CENTER_POP_TIMING);
    }
  }

  clearMessage(): void {
    this.center.classList.remove('show');
    this.centerTimer = 0;
  }

  /**
   * Aviso curto. Os de sistema (música, som, câmera, sala online) vão para o canto de baixo; os de
   * corrida (acertos, dinheiro, voltas) numa faixa sob o bloco de posição — nenhum no centro, sobre
   * a contagem ou o carro.
   */
  showToast(text: string, kind: 'race' | 'system' = SYSTEM_TOAST.test(text) ? 'system' : 'race'): void {
    if (kind === 'system') {
      this.note.innerHTML = withIcons(text);
      this.note.classList.add('show');
      this.noteTimer = 2.2;
      return;
    }
    this.toast.innerHTML = withIcons(text);
    this.toast.classList.add('show');
    this.toastTimer = 1.8;
  }

  /**
   * Indicador de ping (só no online): bolinha colorida com os ms. `undefined` esconde; `null` =
   * ainda sem medida. Só mexe no DOM quando o texto ou a cor mudam.
   */
  setPing(ms: number | null | undefined, tone: 'good' | 'ok' | 'bad' | 'none' = 'none'): void {
    if (ms === undefined) {
      if (this.pingEl) this.pingEl.style.display = 'none';
      return;
    }
    if (!this.pingEl) {
      this.pingEl = document.createElement('div');
      this.pingEl.className = 'rh-ping';
      Object.assign(this.pingEl.style, {
        display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end', marginTop: '4px',
        font: '700 11px/1 "Trebuchet MS", sans-serif', color: '#e8e8e8', textShadow: '0 1px 2px #000', pointerEvents: 'none',
      });
      this.pingEl.innerHTML = '<i style="display:inline-block;width:8px;height:8px;border-radius:50%;box-shadow:0 0 4px currentColor"></i><span></span>';
      (this.el.querySelector('.rh-right') ?? this.el).appendChild(this.pingEl);
    }
    this.pingEl.style.display = 'flex';
    const text = ms === null ? '— ms' : `${Math.round(ms)} ms`;
    const key = `${text}|${tone}`;
    if (key === this.pingKey) return;
    this.pingKey = key;
    const dot = this.pingEl.firstElementChild as HTMLElement;
    const color = { good: '#3cff4a', ok: '#ffd21a', bad: '#ff3a1a', none: '#888' }[tone];
    dot.style.background = color;
    dot.style.color = color;
    this.pingEl.lastElementChild!.textContent = text;
    this.pingEl.title = 'Ping com o host';
  }

  setMirror(visible: boolean, rect?: { x: number; y: number; w: number; h: number }): void {
    this.mirrorFrame.style.display = visible ? 'block' : 'none';
    if (visible && rect) {
      Object.assign(this.mirrorFrame.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    }
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
    if (v) this.mapK = 0;
  }
}

/** entrada da mensagem central: a mesma transição do .rh-center (hud.css), repetida pela Web Animations */
const CENTER_POP: Keyframe[] = [
  { opacity: 0, transform: 'scale(1.6)' },
  { opacity: 1, transform: 'scale(1)' },
];
const CENTER_POP_TIMING: KeyframeAnimationOptions = { duration: 180, easing: 'cubic-bezier(0.2, 1.6, 0.4, 1)' };

/** avisos de sistema reconhecidos pelo ícone inicial (música, som, câmera, sala online) */
const SYSTEM_TOAST = /^\s*(♪|🔇|🔊|🎥|🌐)/u;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
