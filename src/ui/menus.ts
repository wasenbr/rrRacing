import { QUALITY_LABELS, type QualityLevel, type QualityPref } from '../render/quality';
import type { CameraMode } from '../render/cameras';
import { carThumbnail, itemThumbnail, SHOWROOM_COLOR, type CarThumbStyle, type ShopItem } from '../render/thumbnails';
import { planetThumbnail } from '../render/planetThumbs';
import type { ThemeId } from '../sim/track';
import {
  canAdvanceEarly, CAMPAIGN_PRIZES, carsForSale, DIVISIONS, PLANETS, POINTS, seasonInfo, START_MONEY, type CampaignState, type OpponentSetup, type PlanetDef,
  type RaceOutcome, RIVALS, CHAMPION_BONUS, seasonSchedule,
} from '../sim/campaign';
import {
  armamentText, ATTRIBUTE_LABEL, buildSpec, CAR_PRICES, carAttributes, CHARACTERS, CHARGE_KINDS, chargePrice, chargeWeapon, MAX_UPGRADE, maxExtraCharges,
  carSwapCost, tradeInValue, UPGRADE_KINDS, upgradeAvailable, upgradeHelp, upgradeLabel, upgradeName, upgradePrice, upgradesSpent, type CarAttributes, type CarSetup, type Character,
  type ChargeKind, type UpgradeKind,
} from '../sim/garage';
import type { Track, TrackDef } from '../sim/track';
import { trackById } from '../data/tracks';
import { WEAPON_NAMES, type VehicleSpec } from '../sim/vehicle';
import { VEHICLES } from '../data/vehicles';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty } from '../sim/world';
import type { SlotInfo } from '../core/storage';
import { formatTime } from './hud';
import { setTiltSteering, tiltSteeringEnabled, tiltSupported } from '../input/controls';
import { portraitSvg, warmPortraits } from './portraits';
import { trackThumbnail } from './trackThumb';
import { icon, iconizeHtml } from './icons';
import { idleJob, idleJobsUrgent } from './idleQueue';
import { APP_VERSION } from '../version';

/** Nome curto das armas (HUD/menus), a partir dos nomes do original. */
export const WEAPON_LABEL: Record<string, string> = Object.fromEntries(Object.entries(WEAPON_NAMES).map(([k, v]) => [k, v.short]));
const weapon = (k: string) => WEAPON_LABEL[k] ?? k;
const weaponFull = (k: string) => WEAPON_NAMES[k as keyof typeof WEAPON_NAMES]?.name ?? weapon(k);
const CHARGE_LABEL: Record<ChargeKind, string> = { front: 'Arma frontal', rear: 'Arma traseira', nitro: 'Assistência' };
export const COLORS = [0x2f7bff, 0xe02828, 0x2fc840, 0xf2c318, 0xb040e0, 0xf0f0f0];
const CAMERAS: [CameraMode, string][] = [['iso', 'Vista aérea'], ['cockpit', 'Cockpit'], ['chase', 'Perseguição']];
const DIFF_HELP: Record<Difficulty, string> = {
  easy: 'Rivais mais lentos, você toma menos dano',
  normal: 'Como no original',
  hard: 'Rivais implacáveis e bem armados',
};

const money = (n: number) => `$${n.toLocaleString('pt-BR')}`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface QuickOptions {
  trackId: string;
  /** piloto escolhido (bônus de habilidade e retrato) */
  characterId?: string;
  vehicleId: string;
  color: number;
  difficulty: Difficulty;
}

export interface NewCampaignOptions {
  characterId: string;
  color: number;
  difficulty: Difficulty;
  slot: number;
}

export interface OnlineOptions {
  name: string;
  vehicleId: string;
  color: number;
}

/** Sala online como aparece na tela (host e convidados). */
export interface LobbyView {
  code: string;
  link: string;
  host: boolean;
  players: { name: string; color: number; vehicleId: string; me: boolean }[];
  max: number;
  /** a corrida está rolando (quem entrou agora espera a próxima) */
  racing: boolean;
}

export interface MenuActions {
  quickRace(o: QuickOptions): void;
  newCampaign(o: NewCampaignOptions): void;
  continueCampaign(): void;
  /** carrega a senha no slot escolhido (a tela já confirmou se ele estava ocupado) */
  loadPassword(code: string, slot: number): boolean;
  listSlots(): SlotInfo[];
  advanceEarly(): void;
  loadSlot(slot: number): void;
  saveSlot(slot: number): void;
  /** apaga o slot; devolve se ainda há campanha para CONTINUAR */
  deleteSlot(slot: number): boolean;
  campaignRace(): void;
  openShop(): void;
  buyCar(id: string): void;
  buyUpgrade(kind: UpgradeKind): void;
  buyCharge(kind: ChargeKind): void;
  showPassword(): void;
  backToHub(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  resultsContinue(): void;
  toMain(): void;
  setCamera(mode: CameraMode): void;
  openSettings(): void;
  closeSettings(): void;
  setAudio(key: 'music' | 'sfx' | 'announcer', on: boolean): void;
  setMusicVolume(v: number): void;
  addMusic(files: File[]): void;
  clearMusic(): void;
  skipTrack(): void;
  setAutoThrottle(on: boolean): void;
  setQuality(q: QualityPref): void;
  setBatterySaver(on: boolean): void;
  toggleFullscreen(): void;
  install(): void;
  quitGame(): void;
  onlineCreate(o: OnlineOptions): void;
  onlineJoin(o: OnlineOptions, code: string): void;
  onlineStart(trackId: string, fillCpu: boolean): void;
  onlineLeave(): void;
  onlineLobby(): void;
}

/** Estado do "app" mostrado nos menus (tela cheia, instalação, toque). */
export interface AppInfo {
  touch: boolean;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  canInstall: boolean;
  installed: boolean;
  ios: boolean;
}

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  announcer: boolean;
  musicVolume: number;
  bundled: number;
  user: number;
  autoThrottle: boolean;
  touch: boolean;
  /** preferência de qualidade e o nível em uso agora */
  quality: QualityPref;
  qualityNow: QualityLevel;
  /** economia de bateria: corrida a 30 qps */
  battery: boolean;
}

export interface ResultRow {
  place: number;
  name: string;
  color: string;
  time: number | null;
  kills: number;
  prize: number;
  money: number;
  me: boolean;
  /** id/nome do piloto para o retrato (padrão: name) */
  pilot?: string;
  vehicleId?: string;
}

export interface HubData {
  state: CampaignState;
  planet: PlanetDef;
  track: Track;
  opponents: OpponentSetup[];
  spec: VehicleSpec;
  character: Character;
  vehicles: Record<string, VehicleSpec>;
}

export interface CampaignReport {
  outcome: RaceOutcome;
  pointsEarned: number;
  points: number;
  /** pontos necessários para subir na divisão em que a corrida foi disputada */
  promote: number;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Atributos dos carros: barras que mostram forças e fraquezas          */
/* ------------------------------------------------------------------ */

const ATTRS = Object.keys(ATTRIBUTE_LABEL) as (keyof CarAttributes)[];

/**
 * Faixa de cada atributo entre os 5 carros de fábrica (escala de `carAttributes`). As barras vão do
 * pior (2 segmentos) ao melhor carro (10): as diferenças entre eles aparecem de verdade (item 13).
 */
const STOCK_RANGE = Object.fromEntries(
  ATTRS.map((k) => {
    const vals = Object.values(VEHICLES).map((v) => carAttributes(v)[k]);
    return [k, [Math.min(...vals), Math.max(...vals)]];
  }),
) as Record<keyof CarAttributes, [number, number]>;

/**
 * Atributo na escala das barras (0..1 = 0..10 segmentos): pior carro de fábrica em 0,2, melhor em 1.
 * Melhorias e piloto podem passar de 1 (a barra fica cheia). Diferença desprezível entre os carros
 * (< 4% da escala absoluta) fica no meio para todos.
 */
function barScale(k: keyof CarAttributes, a: number): number {
  const [lo, hi] = STOCK_RANGE[k];
  const t = hi - lo < 0.04 ? 0.6 + (a - hi) * 2.5 : 0.2 + (0.8 * (a - lo)) / (hi - lo);
  return Math.max(0.05, t);
}

/**
 * Barras segmentadas dos atributos, normalizadas entre os carros de fábrica (2–10 segmentos), com o
 * maior atributo do carro marcado FORTE e o menor FRACO.
 */
function statBars(v: VehicleSpec, withPilot?: VehicleSpec): string {
  const a = carAttributes(v);
  const vals = ATTRS.map((k) => barScale(k, a[k]));
  // forte/fraco: sempre o maior e o menor atributo deste carro, na escala das barras
  let good = 0;
  let bad = 0;
  vals.forEach((x, i) => {
    if (x > vals[good]) good = i;
    if (x < vals[bad]) bad = i;
  });
  // bônus do piloto: segmentos a mais (ou a menos) em azul, por cima da base igual à da loja
  const p = withPilot ? carAttributes(withPilot) : a;
  let anyBonus = false;
  const bars = ATTRS.map((k, i) => {
    const n = Math.max(1, Math.min(10, Math.round(vals[i] * 10)));
    const t = Math.max(1, Math.min(10, Math.round(barScale(k, p[k]) * 10)));
    if (t !== n) anyBonus = true;
    const tag = good === bad ? '' : i === good ? '<em class="st-good">forte</em>' : i === bad ? '<em class="st-bad">fraco</em>' : '';
    const cls = (i === good && good !== bad) || n >= 8 ? 'hi' : (i === bad && good !== bad) || n <= 3 ? 'lo' : 'mid';
    const seg = (j: number) =>
      j < Math.min(n, t) ? '<b class="on"></b>' : j < t ? `<b class="on" style="${PILOT_UP}"></b>` : j < n ? `<b style="${PILOT_DOWN}"></b>` : '<b></b>';
    return `<div class="stat ${cls}"><span>${ATTRIBUTE_LABEL[k]}</span><i>${Array.from({ length: 10 }, (_, j) => seg(j)).join('')}</i>${tag}</div>`;
  }).join('');
  const legend = anyBonus
    ? `<small class="pilot-legend" style="display:flex;align-items:center;gap:5px;font-size:10px;opacity:.85;margin-top:2px"><b style="display:inline-block;width:12px;height:7px;transform:skewX(-14deg);${PILOT_UP}"></b>bônus do piloto</small>`
    : '';
  return `<div class="stats">${bars}${legend}</div>`;
}

/**
 * Prévia da próxima melhoria (loja): para cada atributo que muda, a barra atual (0..1, mesma escala
 * de `statBars`) com o ganho em segmento "fantasma" (ou a perda em vermelho) e a variação em %.
 */
function upgradePreview(base: VehicleSpec, car: CarSetup, k: UpgradeKind): string {
  const lvl = car.upgrades[k];
  if (lvl >= MAX_UPGRADE) return '';
  const cur = buildSpec(base, car);
  const nxt = buildSpec(base, { ...car, upgrades: { ...car.upgrades, [k]: lvl + 1 } });
  const ca0 = carAttributes(cur);
  const na0 = carAttributes(nxt);
  // mesma escala das barras (statBars); a prévia fica limitada à barra cheia
  const ca = Object.fromEntries(ATTRS.map((a) => [a, barScale(a, ca0[a])])) as Record<keyof CarAttributes, number>;
  const na = Object.fromEntries(ATTRS.map((a) => [a, barScale(a, na0[a])])) as Record<keyof CarAttributes, number>;
  const handling = (s: VehicleSpec) => s.steerRate * Math.pow(s.grip, 0.25);
  const raw: Record<string, [number, number]> = {
    accel: [cur.accel, nxt.accel], speed: [cur.maxSpeed, nxt.maxSpeed], handling: [handling(cur), handling(nxt)], armor: [cur.armor, nxt.armor],
  };
  const rows: [string, number, number, number][] = [];
  for (const a of ATTRS) {
    if (!raw[a] || Math.abs(na[a] - ca[a]) < 0.004) continue;
    rows.push([ATTRIBUTE_LABEL[a], Math.min(1, ca[a]), Math.min(1, na[a]), (raw[a][1] / raw[a][0] - 1) * 100]);
  }
  // amortecedores: embalo guardado no pouso (a perda cai de 25% até 7%)
  if (k === 'shocks') {
    const loss = (s: VehicleSpec) => s.landingLoss ?? 0.25;
    const keep = (s: VehicleSpec) => Math.min(1, Math.max(0.05, (0.26 - loss(s)) / 0.22));
    rows.push(['Pouso', keep(cur), keep(nxt), ((1 - loss(nxt)) / (1 - loss(cur)) - 1) * 100]);
  }
  if (!rows.length) return '';
  return `<div class="upg-prev">${rows
    .map(([label, c, n, pct]) => {
      const up = n >= c;
      const lo = Math.min(c, n) * 100;
      const w = Math.max(1.5, Math.abs(n - c) * 100);
      return `<div class="up-row${up ? '' : ' down'}"><span>${label}</span><i><b style="width:${lo.toFixed(1)}%"></b><u style="left:${lo.toFixed(1)}%;width:${w.toFixed(1)}%"></u></i><em>${pct >= 0 ? '+' : '−'}${Math.max(1, Math.round(Math.abs(pct)))}%</em></div>`;
    })
    .join('')}</div>`;
}

const PILOT_UP = 'background:linear-gradient(#8ae6ff,#1f9bd6)';
const PILOT_DOWN = 'background:rgba(255,90,70,.35)';

function pips(n: number, max: number): string {
  return `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** Miniaturas já geradas (a geração é feita aos poucos, depois que o menu aparece). */
const thumbReady = new Map<string, string>();
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Miniatura 3D de uma arma ou melhoria (gerada aos poucos, como a dos carros). */
function itemImg(item: string, size = 96): string {
  const key = `item|${item}|${size}`;
  const url = thumbReady.get(key);
  return `<img class="car-img item-img${url ? '' : ' loading'}" data-thumb="${key}" src="${url ?? BLANK}" alt="" draggable="false"/>`;
}

/**
 * Miniatura 3D de um carro. `card` (padrão) é o card de veículo com fundo e piso; `transparent`
 * serve para as listas pequenas (rivais, slots, resultados), sobre o painel.
 */
function carImg(id: string, color: number, size = 200, style: CarThumbStyle = 'card'): string {
  const key = `${id}|${color}|${size}|${style}`;
  const url = thumbReady.get(key);
  return `<img class="car-img${style === 'card' ? ' card-img' : ''}${url ? '' : ' loading'}" data-thumb="${esc(key)}" src="${url ?? BLANK}" alt="" draggable="false"/>`;
}

/** Tema (planeta) de cada nome de planeta usado nas pistas e na campanha. */
const PLANET_THEME: Record<string, ThemeId> = Object.fromEntries(PLANETS.map((p) => [p.name, p.theme]));

/** Miniatura do planeta (esfera 3D sobre o espaço), gerada aos poucos como as dos carros. */
function planetImg(theme: ThemeId | undefined, size = 64, cls = ''): string {
  if (!theme) return '';
  const key = `planet|${theme}|${size}`;
  const url = thumbReady.get(key);
  return `<img class="planet-img${cls ? ` ${cls}` : ''}${url ? '' : ' loading'}" data-thumb="${key}" src="${url ?? BLANK}" alt="" draggable="false"/>`;
}

/** Rota da campanha: os 6 planetas em ordem, com o atual em destaque e os vencidos marcados. */
function planetRoute(current: number, champion = false): string {
  return `<div class="planet-route">${PLANETS.map((p, i) => {
    const st = champion || i < current ? 'done' : i === current ? 'now' : 'next';
    return `<div class="pr-step ${st}" title="${esc(p.name)}">${planetImg(p.theme, i === current && !champion ? 72 : 48)}<small>${esc(p.name)}</small></div>`;
  }).join('<i class="pr-link"></i>')}</div>`;
}

/** Pistas conhecidas pela chave `track|id|w|h` (para gerar a miniatura na fila). */
const trackDefs = new Map<string, TrackDef>();
/** Miniaturas em geração (a imagem é codificada fora da thread principal). */
const thumbPending = new Set<string>();

/** Coloca a imagem pronta em todas as `<img>` que esperam por ela (em qualquer menu aberto). */
function applyThumb(key: string, url: string): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLImageElement>('img.loading[data-thumb]').forEach((el) => {
    if (el.dataset.thumb !== key) return;
    el.src = url || BLANK;
    el.classList.remove('loading');
  });
}

/**
 * Gera (uma vez) a miniatura de uma chave `id|cor|tamanho|estilo`, `planet|tema|tam`, `item|...` ou
 * `track|id|w|h`. O desenho é síncrono (um por intervalo livre, ver idleQueue); a codificação
 * (`toBlob`) termina depois e troca o `src` das imagens que esperam.
 */
function makeThumb(key: string): void {
  if (thumbReady.has(key) || thumbPending.has(key)) return;
  const [id, a, b, c] = key.split('|');
  let p: Promise<string>;
  if (id === 'item') p = itemThumbnail(a as ShopItem, Number(b));
  else if (id === 'planet') p = planetThumbnail(a as ThemeId, Number(b));
  else if (id === 'track') {
    const def = trackDefs.get(key);
    if (!def) return;
    p = trackThumbnail(def, Number(b), Number(c));
  } else p = carThumbnail(id, Number(a), Number(b), (c as CarThumbStyle) || 'card');
  thumbPending.add(key);
  void p.then((url) => {
    thumbPending.delete(key);
    if (url) thumbReady.set(key, url); // falha não fica guardada: a próxima tela tenta de novo
    applyThumb(key, url);
  });
}

/**
 * Pré-gera miniaturas (a partir do menu principal) nos intervalos livres, uma por vez e nunca
 * durante a rolagem: ao abrir a corrida rápida no celular elas já estão prontas. Continua mesmo
 * depois de trocar de menu (o que a tela aberta mostra passa na frente, ver fillThumbs).
 */
function warmThumbs(keys: string[]): void {
  for (const key of keys) if (!thumbReady.has(key)) idleJob(`thumb:${key}`, () => makeThumb(key));
}

/** Põe na frente da fila as miniaturas que faltam na tela aberta, na ordem em que aparecem. */
function fillThumbs(root: HTMLElement): void {
  const keys = [...new Set(Array.from(root.querySelectorAll<HTMLImageElement>('img[data-thumb].loading'), (el) => el.dataset.thumb!))];
  idleJobsUrgent(keys.filter((k) => !thumbReady.has(k)).map((key) => ({ key: `thumb:${key}`, run: () => makeThumb(key) })));
}

/** Chave da miniatura de pista (registra a pista para a fila poder gerá-la). */
function trackKey(def: TrackDef, w = 200, h = 130): string {
  const key = `track|${def.id}|${w}|${h}`;
  trackDefs.set(key, def);
  return key;
}

function trackImg(def: TrackDef, w = 200, h = 130): string {
  const key = trackKey(def, w, h);
  const url = thumbReady.get(key);
  return `<img class="trk-img${url ? '' : ' loading'}" data-thumb="${esc(key)}" src="${url ?? BLANK}" style="aspect-ratio:${w}/${h}" alt="" draggable="false"/>`;
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export class Menus {
  private el: HTMLElement;
  private fsButton: HTMLButtonElement;
  private camera: CameraMode = 'iso';
  private quick: QuickOptions = { trackId: 'chem6-1', characterId: CHARACTERS[1].id, vehicleId: 'marauder', color: COLORS[0], difficulty: 'normal' };
  private newChar: NewCampaignOptions = { characterId: CHARACTERS[0].id, color: COLORS[0], difficulty: 'normal', slot: 0 };
  private shopTab: 'cars' | 'upgrades' | 'weapons' = 'upgrades';
  /** planeta aberto na corrida rápida (abas) */
  private quickPlanet = '';
  private lastHub: HubData | null = null;
  private inCampaign = false;
  private hasSave = false;
  /** slot onde a senha será carregada */
  private pwSlot = -1;
  /** tela de slots: veio de onde (para o "Voltar") */
  private slotsFrom: 'main' | 'hub' = 'main';
  /** Olaf, o piloto secreto (como no original: L + R + Select com o Tarquinn selecionado). */
  private olafUnlocked = (() => {
    try {
      return localStorage.getItem('rnrr3d-olaf') === '1';
    } catch {
      return false;
    }
  })();
  private secretKeys = new Set<string>();
  private tarquinnTaps: number[] = [];
  private padTimer = 0;
  private nick = (() => {
    try {
      return localStorage.getItem('rnrr3d-nick') ?? '';
    } catch {
      return '';
    }
  })();
  private fillCpu = true;
  private lastLobby: LobbyView | null = null;
  private app: AppInfo = { touch: false, fullscreen: false, fullscreenSupported: false, canInstall: false, installed: false, ios: false };

  constructor(
    root: HTMLElement,
    private actions: MenuActions,
    private vehicles: Record<string, VehicleSpec>,
    private tracks: TrackDef[],
  ) {
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.style.display = 'none';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    // segredo do Olaf no teclado: segure Q + E (os "L" e "R") e aperte Backspace ou Tab ("Select")
    window.addEventListener('keydown', (e) => {
      this.secretKeys.add(e.code);
      if ((e.code === 'Backspace' || e.code === 'Tab') && this.secretKeys.has('KeyQ') && this.secretKeys.has('KeyE')) {
        if (this.trySecret()) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.secretKeys.delete(e.code));
    window.addEventListener('blur', () => this.secretKeys.clear());
    // botão flutuante de tela cheia nos menus (celular)
    this.fsButton = document.createElement('button');
    this.fsButton.className = 'fs-float';
    this.fsButton.setAttribute('aria-label', 'Tela cheia');
    this.fsButton.addEventListener('click', () => this.actions.toggleFullscreen());
    root.appendChild(this.fsButton);
    this.updateFsButton();
  }

  setCameraChoice(mode: CameraMode): void {
    this.camera = mode;
  }

  /** Atualiza tela cheia / instalação e redesenha o menu principal se estiver nele. */
  setApp(info: Partial<AppInfo>): void {
    this.app = { ...this.app, ...info };
    this.updateFsButton();
    const main = this.el.querySelector('.main-buttons');
    if (main && this.el.style.display !== 'none') this.showMain(this.hasSave);
  }

  private updateFsButton(): void {
    const inline = !!this.el.querySelector('[data-act="fullscreen"]');
    const visible = this.app.touch && this.app.fullscreenSupported && this.el.style.display !== 'none' && !inline;
    this.fsButton.style.display = visible ? '' : 'none';
    // o botão flutuante fica numa faixa própria à direita, sem cobrir o card nem a HUD
    this.el.classList.toggle('fs-pad', visible);
    this.fsButton.innerHTML = icon(this.app.fullscreen ? 'exitFullscreen' : 'fullscreen');
    this.fsButton.title = this.app.fullscreen ? 'Sair da tela cheia' : 'Tela cheia';
  }

  private show(html: string): void {
    this.el.innerHTML = html;
    this.el.style.display = '';
    this.el.scrollTop = 0;
    this.refresh();
    this.updateFsButton();
    fillThumbs(this.el);
  }

  /** A tela de som/opções está aberta? (para redesenhar depois de trocar a tela cheia) */
  isShowingSettings(): boolean {
    return this.el.style.display !== 'none' && !!this.el.querySelector('.vol');
  }

  hideAll(): void {
    this.el.style.display = 'none';
    this.updateFsButton();
  }

  private cameraPicker(): string {
    return `<div class="cams">${CAMERAS.map(([m, l]) => `<button class="cam" data-cam="${m}">${l}</button>`).join('')}</div>`;
  }

  private colorPicker(group: string): string {
    return `<div class="colors">${COLORS.map((c) => `<button class="color" data-color="${c}" data-group="${group}" style="background:${hex(c)}" aria-label="cor"></button>`).join('')}</div>`;
  }

  private difficultyPicker(group: string): string {
    return `<div class="diffs">${DIFFICULTIES.map((d) => `<button class="diff d-${d}" data-diff="${d}" data-group="${group}"><b>${DIFFICULTY_LABEL[d]}</b><small>${DIFF_HELP[d]}</small></button>`).join('')}</div>`;
  }

  private get allCars(): VehicleSpec[] {
    return Object.values(this.vehicles);
  }

  private carCard(v: VehicleSpec, color: number, extra = '', spec: VehicleSpec = v, withPilot?: VehicleSpec): string {
    return `${carImg(v.id, color)}<b>${v.name}</b>
      ${statBars(spec, withPilot)}
      <em>${armamentText(v)}</em>${extra}`;
  }

  private fsButtonHtml(): string {
    if (!this.app.touch || !this.app.fullscreenSupported) return '';
    return `<button data-act="fullscreen">${this.app.fullscreen ? `${icon('exitFullscreen')} Sair da tela cheia` : `${icon('fullscreen')} Tela cheia`}</button>`;
  }

  /* ---------------- menu principal ---------------- */

  showMain(hasSave: boolean): void {
    this.inCampaign = false;
    this.hasSave = hasSave;
    // retratos da escolha de piloto já prontos (PNG) quando o jogador abrir a tela: rolagem lisa
    warmPortraits(CHARACTERS.map((c) => c.id), [120, 208]);
    // e os das outras telas (logo, resultados, slots, garagem, rivais)
    warmPortraits([...CHARACTERS.map((c) => c.id), ...Object.keys(RIVALS)], [48, 56, 64, 72, 76]);
    // sempre visível fora do app instalado: sem o convite do navegador, mostra o passo a passo
    const install = this.app.installed ? '' : `<button class="install" data-act="install">${icon('install')} Instalar o jogo</button>`;
    // no celular deitado os botões secundários vão em duas colunas; com número ímpar, o primeiro
    // deles ocupa a linha toda para que Instalar e Sair fiquem lado a lado no fim
    const secondary = 4 + (hasSave ? 1 : 0) + (this.fsButtonHtml() ? 1 : 0) + (install ? 1 : 0) + 1;
    const quickWide = secondary % 2 ? ' class="wide"' : '';
    this.show(`
      <div class="card title-card">
        <div class="logo-row">
          <div class="logo-faces">${portraitSvg('snake', 64)}${portraitSvg('tarquinn', 64)}${portraitSvg('katarina', 64)}</div>
          <h1>ROCK <span>'N'</span> ROLL <br/>RACING <em>3D</em></h1>
        </div>
        <p class="sub">6 planetas · 5 carros · armas, pancadaria e muito rock</p>
        <div class="main-buttons">
          ${hasSave ? `<button class="go" data-act="continue">CONTINUAR</button>` : ''}
          <button class="${hasSave ? (quickWide ? 'wide' : '') : 'go'}" data-act="new">Nova campanha</button>
          <button data-act="quick"${hasSave ? '' : quickWide}>Corrida rápida</button>
          <button data-act="online">${icon('globe')} Online com amigos</button>
          <button data-act="load">${icon('folder')} Carregar jogo</button>
          <button data-act="settings">${icon('gear')} Som e opções</button>
          ${this.fsButtonHtml()}
          ${install}
          <button class="quit" data-act="quit-game">${icon('power')} Sair do jogo</button>
        </div>
        ${this.helpBlock()}
        <p class="version">versão ${esc(APP_VERSION)}</p>
      </div>`);
    // corrida rápida: planetas e carros já prontos quando o jogador abrir a tela
    this.warmAll();
  }

  /**
   * Pré-gera, nos intervalos livres, as miniaturas de todos os menus: primeiro o que a corrida rápida
   * mostra (carros na cor atual, abas de planeta, pistas do planeta aberto), depois o resto das
   * pistas, os planetas da campanha, os carros nas outras cores e as listas pequenas, e a loja.
   */
  private warmAll(): void {
    const themes = [...new Set(this.tracks.map((t) => PLANET_THEME[t.planet] ?? t.theme))];
    const allThemes = [...new Set([...themes, ...PLANETS.map((p) => p.theme)])];
    const cars = this.allCars;
    const open = this.tracks.find((t) => t.id === this.quick.trackId)?.planet ?? this.quickPlanet;
    const tracks = [...this.tracks.filter((t) => t.planet === open), ...this.tracks.filter((t) => t.planet !== open)];
    const colors = [this.quick.color, ...COLORS.filter((c) => c !== this.quick.color)];
    const weapons = [...new Set(cars.flatMap((v) => [v.front, v.rear, v.assist]))];
    warmThumbs([
      ...cars.map((v) => `${v.id}|${this.quick.color}|200|card`),
      ...themes.map((th) => `planet|${th}|64`),
      ...tracks.map((t) => trackKey(t)),
      ...allThemes.flatMap((th) => [32, 48, 72].map((sz) => `planet|${th}|${sz}`)),
      ...colors.slice(1).flatMap((c) => cars.map((v) => `${v.id}|${c}|200|card`)),
      ...colors.flatMap((c) => cars.map((v) => `${v.id}|${c}|96|transparent`)),
      ...cars.map((v) => `${v.id}|${SHOWROOM_COLOR[v.id] ?? COLORS[0]}|200|card`),
      ...UPGRADE_KINDS.map((k) => `item|${k}|96`),
      ...weapons.map((w) => `item|${w}|200`),
    ]);
  }

  private helpBlock(): string {
    return `<details class="help">
      <summary>Controles</summary>
      <p><b>Teclado:</b> ↑/W acelera · ↓/S freia/ré · ←→/A D vira · Q/E/Alt derrapar (freio de mão) · Ctrl esq./Espaço atira · \ ou X arma traseira · Shift assistência (nitro/pulo) · C câmera · Esc pausa · M som</p>
      <p><b>Controle:</b> RT acelera · LT freia · analógico vira · LB derrapar · X/RB atira · B arma traseira · L3/R3 assistência · Y câmera · Start pausa</p>
      <p><b>Celular:</b> polegar esquerdo no volante: toque à esquerda ou à direita da faixa para virar, como as setas do teclado (arrastando para cima, atira sem soltar a direção) e tem TIRO, a arma traseira (mina/óleo) e a assistência (nitro/pulo) logo acima, cada botão com o ícone da arma atual; polegar direito acelera, freia e tem o botão DERRAPAR. Em “Som e opções”: aceleração automática (o polegar direito ganha um TIRO) e direção por inclinação.</p>
      <p>Armas e nitro recarregam a cada volta. Dinheiro e blindagem aparecem pela pista.</p>
    </details>`;
  }

  /** Como instalar quando o navegador não oferece o convite automático (iPhone, convite recusado antes etc.). */
  showInstallHelp(): void {
    const steps = this.app.ios
      ? `<p>O iPhone não deixa sites abrirem em tela cheia: é preciso <b>adicionar o jogo à Tela de Início</b>.</p>
         <p>${/crios/i.test(navigator.userAgent) ? 'No <b>Chrome</b>, toque em <b>Compartilhar</b> (quadrado com seta para cima, na barra de endereço)' : 'No <b>Safari</b>, toque em <b>Compartilhar</b> (quadrado com seta para cima)'} e depois em <b>“Adicionar à Tela de Início”</b>.</p>
         <p class="small-note">Depois abra o jogo pelo ícone na Tela de Início: ele roda em tela cheia, sem a barra do navegador.</p>`
      : this.app.touch
        ? '<p>No <b>Chrome</b>, toque no menu <b>⋮</b> e depois em <b>“Instalar app”</b> ou <b>“Adicionar à tela inicial”</b>.</p>'
        : '<p>No <b>Chrome</b> ou <b>Edge</b>, clique no ícone de instalar no fim da barra de endereço (ou no menu <b>⋮ → Instalar</b>).</p>';
    this.show(`
      <div class="card small center">
        <h2>INSTALAR O JOGO</h2>
        ${steps}
        <button data-act="main">← Voltar</button>
      </div>`);
  }

  /** Tela de despedida quando o navegador não deixa fechar a aba. */
  showGoodbye(): void {
    this.show(`
      <div class="card small center">
        <h2>ATÉ A PRÓXIMA!</h2>
        <p class="small-note">Seu progresso está salvo. Pode fechar esta aba.</p>
        <button class="go" data-act="main">Voltar ao jogo</button>
      </div>`);
  }

  /* ---------------- corrida rápida ---------------- */

  private showQuick(): void {
    const planets = [...new Set(this.tracks.map((t) => t.planet))];
    if (!planets.includes(this.quickPlanet)) this.quickPlanet = this.tracks.find((t) => t.id === this.quick.trackId)?.planet ?? planets[0];
    this.show(`
      <div class="card wide quick">
        <h2>CORRIDA RÁPIDA</h2>
        <h3>Pista</h3>
        <div class="tabs planet-tabs">${planets.map((p) => `<button class="tab" data-qplanet="${esc(p)}">${planetImg(PLANET_THEME[p] ?? this.tracks.find((t) => t.planet === p)?.theme, 64)}<span>${esc(p)}</span></button>`).join('')}</div>
        <div class="tracks track-row">${this.quickTracks()}</div>
        <h3>Piloto</h3>
        ${this.charPick('quick')}
        <h3>Carro</h3>
        <div class="cars">${this.allCars.map((v) => `<button class="car" data-vehicle="${v.id}">${this.carCard(v, this.quick.color)}</button>`).join('')}</div>
        <div class="quick-opts">
          <div><h3>Cor</h3>${this.colorPicker('quick')}</div>
          <div><h3>Câmera inicial</h3>${this.cameraPicker()}</div>
        </div>
        <h3>Dificuldade</h3>${this.difficultyPicker('quick')}
        <button class="go" data-act="quick-start">CORRER!</button>
        <button data-act="main">← Voltar</button>
      </div>`);
  }

  /** Pistas do planeta aberto na corrida rápida. */
  private quickTracks(): string {
    return this.tracks
      .filter((t) => t.planet === this.quickPlanet)
      .map((t) => `<button class="trk" data-track="${t.id}">${trackImg(t)}<b>${esc(t.name)}</b></button>`)
      .join('');
  }

  /** Troca o `src` das miniaturas de carro da lista para a cor escolhida (sem refazer o menu). */
  private recolorCars(): void {
    this.el.querySelectorAll<HTMLButtonElement>('.cars .car[data-vehicle]').forEach((b) => {
      const img = b.querySelector<HTMLImageElement>('img[data-thumb]');
      if (!img) return;
      const key = `${b.dataset.vehicle}|${this.quick.color}|200|card`;
      const url = thumbReady.get(key);
      img.dataset.thumb = key;
      img.src = url ?? BLANK;
      img.classList.toggle('loading', !url);
    });
    fillThumbs(this.el);
  }

  /* ---------------- nova campanha ---------------- */

  private bonusText(c: Character): string {
    const names: Record<string, string> = { accel: 'Aceleração', topSpeed: 'Velocidade', cornering: 'Curvas', jumping: 'Saltos' };
    return Object.entries(c.bonus ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `<span class="skill">${names[k] ?? k} ${'★'.repeat(Number(v))}</span>`)
      .join('');
  }

  /** Libera o Olaf se o Tarquinn estiver selecionado na tela de nova campanha. */
  private trySecret(): boolean {
    if (this.olafUnlocked || !this.el.querySelector('.chars') || this.el.style.display === 'none') return false;
    if (this.newChar.characterId !== 'tarquinn') return false;
    this.olafUnlocked = true;
    try {
      localStorage.setItem('rnrr3d-olaf', '1');
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
    this.newChar.characterId = CHARACTERS.find((c) => c.secret)?.id ?? this.newChar.characterId;
    const scroll = this.el.scrollTop;
    this.showNewCampaign();
    this.el.scrollTop = scroll;
    const msg = this.el.querySelector('.secret-msg');
    if (msg) msg.textContent = 'Piloto secreto liberado: OLAF, direto de Valhalla!';
    navigator.vibrate?.([30, 40, 30]);
    return true;
  }

  /** Controle: L + R + Select (botões 4, 5 e 8) enquanto a tela de nova campanha estiver aberta. */
  private watchPadSecret(): void {
    cancelAnimationFrame(this.padTimer);
    const tick = () => {
      if (!this.el.querySelector('.chars') || this.el.style.display === 'none') return;
      const pad = Array.from(navigator.getGamepads?.() ?? []).find((p) => p && p.connected);
      if (pad && pad.buttons[4]?.pressed && pad.buttons[5]?.pressed && pad.buttons[8]?.pressed) this.trySecret();
      this.padTimer = requestAnimationFrame(tick);
    };
    this.padTimer = requestAnimationFrame(tick);
  }

  /** Piloto escolhido em destaque: retrato grande com a placa do nome em moldura metálica. */
  private charFeature(id = this.newChar.characterId): string {
    const c = CHARACTERS.find((k) => k.id === id) ?? CHARACTERS[0];
    return `<div class="cf-portrait">${portraitSvg(c.id, 208)}<div class="nameplate"><span>${esc(c.name)}</span></div></div>
      <div class="cf-info"><small class="home">${esc(c.homeworld ?? '')}</small><p>${esc(c.description)}</p><div class="skills">${this.bonusText(c)}</div></div>`;
  }

  /** Grade de pilotos (Nova campanha e Corrida rápida): destaque grande + retratos com placa metálica do nome. */
  private charPick(group: 'new' | 'quick'): string {
    const cur = group === 'quick' ? (this.quick.characterId ?? CHARACTERS[1].id) : this.newChar.characterId;
    return `<div class="char-pick" data-cgroup="${group}">
          <div class="char-feature">${this.charFeature(cur)}</div>
          <div class="chars">${CHARACTERS.filter((c) => !c.secret || this.olafUnlocked).map(
            (c) => `<button class="char ${c.secret ? 'secret' : ''}" data-char="${c.id}" data-cgroup="${group}">${portraitSvg(c.id, 120)}<span class="nameplate mini"><span>${esc(c.name)}</span></span></button>`,
          ).join('')}</div>
        </div>`;
  }

  private showNewCampaign(): void {
    const slots = this.actions.listSlots();
    if (!slots.some((s) => s.slot === this.newChar.slot && s.empty)) this.newChar.slot = slots.find((s) => s.empty)?.slot ?? this.newChar.slot;
    this.show(`
      <div class="card wide">
        <h2>NOVA CAMPANHA</h2>
        ${planetRoute(0)}
        <p class="sub center">Comece em ${esc(PLANETS[0].name)}, Divisão B, com ${money(START_MONEY)}. Some ${PLANETS[0].promote} pontos em ${PLANETS[0].races} corridas para subir
          (1º: ${POINTS[0]} pts e ${money(CAMPAIGN_PRIZES[0])} · 2º: ${POINTS[1]} · 3º: ${POINTS[2]}).</p>
        <h3>Escolha seu piloto</h3>
        ${this.charPick('new')}
        <p class="pw-msg secret-msg"></p>
        <h3>Cor do carro</h3>${this.colorPicker('new')}
        <h3>Dificuldade</h3>${this.difficultyPicker('new')}
        <h3>Salvar no slot</h3>
        <div class="slot-pick">${slots
          .map((s) => `<button class="slotsel" data-slotsel="${s.slot}"><b>Slot ${s.slot + 1}</b><small>${s.empty ? 'vazio' : `substituir: ${esc(s.pilot)} · ${esc(s.planet)}`}</small></button>`)
          .join('')}</div>
        <button class="go" data-act="new-start">COMEÇAR</button>
        <button data-act="main">← Voltar</button>
      </div>`);
    this.watchPadSecret();
  }

  /* ---------------- salvar / carregar ---------------- */

  showSlots(mode: 'save' | 'load', notice = ''): void {
    if (mode === 'save') this.slotsFrom = 'hub';
    else this.slotsFrom = this.inCampaign ? 'hub' : 'main';
    const slots = this.actions.listSlots();
    this.show(`
      <div class="card">
        <h2>${mode === 'save' ? 'SALVAR JOGO' : 'CARREGAR JOGO'}</h2>
        ${notice ? `<div class="notice">${iconizeHtml(notice)}</div>` : ''}
        <div class="slots">${slots
          .map((s) =>
            s.empty
              ? `<div class="slot empty"><div class="slot-n">${s.slot + 1}</div><div class="slot-info"><b>Vazio</b></div>
                  ${mode === 'save' ? `<button class="buy" data-save="${s.slot}">Salvar aqui</button>` : ''}</div>`
              : `<div class="slot"><div class="slot-n">${s.slot + 1}</div>${portraitSvg(s.characterId, 56)}${carImg(s.vehicleId, s.color, 96, 'transparent')}
                  <div class="slot-info"><b>${esc(s.pilot)}</b><small class="slot-planet">${planetImg(PLANET_THEME[s.planet], 32, 'mini')}${esc(s.planet)} · Divisão ${esc(s.division)}${s.champion ? ` · ${icon('trophy')}` : ''}</small>
                  <small><span class="gold">${money(s.money)}</span> · ${dateLabel(s.savedAt)}</small></div>
                  <div class="slot-btns">
                    ${mode === 'save' ? `<button class="buy" data-save="${s.slot}">Substituir</button>` : `<button class="buy" data-loadslot="${s.slot}">Carregar</button>`}
                    <button class="del" data-delslot="${s.slot}" aria-label="Apagar slot"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg>Apagar</button>
                  </div></div>`,
          )
          .join('')}</div>
        <p class="small-note">O jogo também salva sozinho no slot em uso ao fim de cada corrida.</p>
        ${mode === 'load' ? `<button data-act="password">${icon('key')} Usar uma senha</button>` : `<button data-act="show-password">${icon('key')} Ver senha (levar para outro aparelho)</button>`}
        <button data-act="slots-back">← Voltar</button>
      </div>`);
  }

  /* ---------------- garagem (hub da campanha) ---------------- */

  showHub(d: HubData, notice = ''): void {
    this.lastHub = d;
    this.inCampaign = true;
    const s = d.state;
    const div = DIVISIONS[s.division];
    const season = seasonInfo(s);
    const pct = Math.min(100, (s.points / season.promote) * 100);
    const u = s.car.upgrades;
    const base = this.vehicles[s.car.vehicleId];
    const early = canAdvanceEarly(s);
    this.show(`
      <div class="card wide">
        <div class="hub-head">
          <div class="hub-planet">${planetImg(d.planet.theme, 72)}<span><small>PLANETA</small><b>${esc(d.planet.name)}</b></span></div>
          <div><small>DIVISÃO</small><b>${div}</b></div>
          <div><small>CORRIDA</small><b>${s.race + 1}/${season.races}</b></div>
          <div><small>DINHEIRO</small><b class="gold">${money(s.money)}</b></div>
        </div>
        ${planetRoute(s.planet, s.champion)}
        <div class="points"><span>Pontos: <b>${s.points}</b> / ${season.promote} para subir</span><div class="bar"><i style="width:${pct}%"></i></div></div>
        ${this.seasonCalendar(s)}
        ${notice ? `<div class="notice">${iconizeHtml(notice)}</div>` : ''}
        ${early ? `<div class="notice promoted">Você já tem os pontos! Continue correndo aqui para ganhar dinheiro ou <button class="inline-go" data-act="advance">subir agora ${icon('arrowRight')}</button></div>` : ''}
        <div class="hub-grid">
          <div class="panel">
            <h3>Próxima pista</h3>
            ${trackImg(d.track.def, 320, 200)}
            <p class="trk-name"><b>${esc(d.track.def.name)}</b> · ${d.track.def.laps} voltas${d.track.def.slime ? ' · poças de gosma' : ''}</p>
            <h3>Rivais</h3>
            <ul class="rivals">${d.opponents
              .map(
                (o) => `<li><div class="rv-portrait">${portraitSvg(o.name, 76)}<span class="nameplate mini"><span>${esc(o.name)}</span></span></div><div><b style="color:${hex(o.color)}">${esc(o.spec.name)}</b><small>carro rival</small></div>${carImg(o.spec.id, o.color, 96, 'transparent')}</li>`,
              )
              .join('')}</ul>
          </div>
          <div class="panel">
            <h3>Seu piloto e carro</h3>
            <div class="me-row">${portraitSvg(d.character.id, 72)}<div><b>${esc(d.character.name)}</b><div class="skills">${this.bonusText(d.character)}</div></div></div>
            <div class="mycar">${base ? this.carCard(base, s.color, '', buildSpec(base, s.car), d.spec) : this.carCard(d.spec, s.color)}</div>
            <ul class="upg-list">
              ${UPGRADE_KINDS.filter((k) => upgradeAvailable(s.car.vehicleId, k)).map((k) => `<li><span>${upgradeLabel(s.car.vehicleId, k)} <small>${upgradeName(s.car.vehicleId, k, u[k])}</small></span> ${pips(u[k], MAX_UPGRADE)}</li>`).join('')}
            </ul>
            <p class="small-note">${d.spec.frontCharges}× ${weaponFull(d.spec.front)} · ${d.spec.rearCharges}× ${weaponFull(d.spec.rear)} · ${d.spec.nitroCharges}× ${weaponFull(d.spec.assist)}</p>
          </div>
        </div>
        <h3>Câmera</h3>${this.cameraPicker()}
        <button class="go" data-act="hub-race">CORRER!</button>
        <div class="row-buttons">
          <button data-act="shop">${icon('cart')} Loja</button>
          <button data-act="save">${icon('save')} Salvar</button>
          <button data-act="settings">${icon('gear')} Opções</button>
          <button data-act="main">Menu</button>
        </div>
      </div>`);
  }

  /** Calendário da divisão: as pistas das corridas, com as já disputadas marcadas e a próxima em destaque. */
  private seasonCalendar(s: CampaignState): string {
    const races = seasonSchedule(s)
      .map((r, i) => {
        let name = r.trackId;
        try {
          name = trackById(r.trackId).name;
        } catch {
          /* pista sem definição: mostra o id */
        }
        const mark = r.done ? '✓ ' : r.current ? '▶ ' : '';
        const style = r.done ? 'opacity:.55' : r.current ? 'color:var(--accent);font-weight:800' : '';
        return `<li style="${style}">${mark}${i + 1}. ${esc(name)}</li>`;
      })
      .join('');
    return `<details class="season-cal small-note"><summary>Calendário — ${esc(PLANETS[s.planet].name)}, Divisão ${DIVISIONS[s.division]} (${seasonSchedule(s).length} corridas)</summary><ol style="list-style:none;padding:0;margin:6px 0;columns:2;font-size:12px">${races}</ol></details>`;
  }

  /* ---------------- loja ---------------- */

  showShop(d: HubData, notice = ''): void {
    this.lastHub = d;
    const s = d.state;
    const tabs = `<div class="tabs">
      ${(['upgrades', 'weapons', 'cars'] as const).map((t) => `<button class="tab" data-tab="${t}">${{ upgrades: `${icon('wrench')} Melhorias`, weapons: `${icon('blast')} Armas`, cars: `${icon('car')} Carros` }[t]}</button>`).join('')}
    </div>`;
    let body = '';
    if (this.shopTab === 'upgrades') {
      const vbase = this.vehicles[s.car.vehicleId];
      body = `<div class="shop-car"><div class="shop-car-img">${carImg(s.car.vehicleId, s.color, 320)}<b>${esc(d.spec.name)}</b></div><div class="shop-car-stats"><h4>Atributos atuais</h4>${vbase ? statBars(buildSpec(vbase, s.car), d.spec) : statBars(d.spec)}<p class="upg-legend"><i></i>prévia do ganho da próxima melhoria (em cada item abaixo)</p></div></div>` +
        UPGRADE_KINDS.map((k) => {
          const lvl = s.car.upgrades[k];
          if (!upgradeAvailable(s.car.vehicleId, k)) {
            return `<div class="shop-row na"><div class="upg-icon">${itemImg(k)}</div><div class="grow"><b>${upgradeLabel(s.car.vehicleId, k)}</b><small>Não se aplica a este carro (${s.car.vehicleId === 'havac' ? 'aerodeslizador' : 'esteiras'}).</small></div><span class="maxed">—</span></div>`;
          }
          const price = upgradePrice(s.car, k);
          const vid = s.car.vehicleId;
          const next = upgradeName(vid, k, lvl + 1);
          return `<div class="shop-row"><div class="upg-icon">${itemImg(k)}</div><div class="grow"><b>${upgradeLabel(vid, k)}: ${upgradeName(vid, k, lvl)}</b> ${pips(lvl, MAX_UPGRADE)}<small>${upgradeHelp(vid, k)}${next ? ` · próximo: <b class="upg-next">${next}</b>` : ''}</small>${vbase ? upgradePreview(vbase, s.car, k) : ''}</div>
            ${price === null ? '<span class="maxed">MÁXIMO</span>' : `<button class="buy" data-upgrade="${k}" ${price > s.money ? 'disabled' : ''}>${money(price)}</button>`}</div>`;
        }).join('');
    } else if (this.shopTab === 'weapons') {
      const baseCar = d.vehicles[s.car.vehicleId];
      body = CHARGE_KINDS.map((k) => {
        const price = chargePrice(s.car, k, baseCar);
        const kind = chargeWeapon(baseCar, k);
        const total = k === 'front' ? d.spec.frontCharges : k === 'rear' ? d.spec.rearCharges : d.spec.nitroCharges;
        const cap = total + Math.max(0, maxExtraCharges(baseCar, k) - s.car.charges[k]);
        return `<div class="weapon-card"><div class="weapon-img">${itemImg(kind, 200)}<span class="weapon-slot">${CHARGE_LABEL[k]}</span></div><div class="grow"><b>${esc(weaponFull(kind))}</b>${pips(total, cap)}<small>${total} carga(s) por volta · +1 por compra (máx. 7)</small></div>
          ${price === null ? '<span class="maxed">MÁXIMO</span>' : `<button class="buy" data-charge="${k}" ${price > s.money ? 'disabled' : ''}>${money(price)}</button>`}</div>`;
      }).join('');
      body = `<div class="weapon-cards">${body}</div>`;
    } else {
      const trade = tradeInValue(s.car, d.vehicles[s.car.vehicleId]);
      const spent = upgradesSpent(s.car);
      const myName = d.vehicles[s.car.vehicleId]?.name ?? s.car.vehicleId;
      body =
        `<p class="small-note">Na troca, a loja fica com o seu ${esc(myName)} e paga <b>${money(trade)}</b> de revenda ` +
        `(metade do preço do carro${spent ? ` + 1/4 dos ${money(spent)} gastos em peças` : ''}). As peças e as cargas extras vão junto com ele: o carro novo sai de fábrica.</p>` +
        `<div class="shop-cars">${this.allCars
          .map((v) => {
            const mine = v.id === s.car.vehicleId;
            const forSale = carsForSale(s).includes(v.id);
            const net = carSwapCost(s.car, v.id);
            const netText = net > 0 ? `Você paga ${money(net)}` : net < 0 ? `Você recebe ${money(-net)}` : 'Troca sem custo';
            const action = mine
              ? '<span class="maxed">SEU CARRO</span>'
              : !forSale
                ? `<span class="maxed">${icon('lock')} NÃO VENDIDO NESTE PLANETA</span>`
                : `<button class="buy" data-buycar="${v.id}" data-buyinfo="${esc(`${netText}?`)}" ${net > s.money ? 'disabled' : ''}>${net > 0 ? money(net) : net < 0 ? `+${money(-net)}` : 'TROCAR'}</button>`;
            const priceLine = mine || !forSale ? `Preço: ${money(CAR_PRICES[v.id].price)}` : `Preço ${money(CAR_PRICES[v.id].price)} − revenda ${money(trade)} · ${netText}`;
            return `<div class="shop-carcard ${mine ? 'mine' : ''} ${forSale || mine ? '' : 'locked'}"><div class="car">${this.carCard(v, mine ? s.color : SHOWROOM_COLOR[v.id] ?? s.color, `<small>${priceLine}</small>`)}</div>${action}</div>`;
          })
          .join('')}</div>`;
    }
    this.show(`
      <div class="card wide">
        <div class="shop-head"><h2>LOJA</h2><b class="gold">${money(s.money)}</b></div>
        ${notice ? `<div class="notice">${iconizeHtml(notice)}</div>` : ''}
        ${tabs}
        <div class="shop-body">${body}</div>
        <button data-act="hub">← Voltar à garagem</button>
      </div>`);
  }

  /* ---------------- senha ---------------- */

  showPassword(code: string | null): void {
    const saving = code !== null;
    // carregar: escolhe o slot (o primeiro vazio por padrão); ocupado pede confirmação no Carregar
    const slots = saving ? [] : this.actions.listSlots();
    if (!saving && !slots.some((x) => x.slot === this.pwSlot)) this.pwSlot = slots.find((x) => x.empty)?.slot ?? 0;
    const pick = saving
      ? ''
      : `<h3>Carregar no slot</h3><div class="slot-pick">${slots
          .map((x) => `<button class="slotsel pwsel" data-pwslot="${x.slot}"><b>Slot ${x.slot + 1}</b><small>${x.empty ? 'vazio' : `substituir: ${esc(x.pilot)} · ${esc(x.planet)}`}</small></button>`)
          .join('')}</div>`;
    this.show(`
      <div class="card small">
        <h2>SENHA</h2>
        <p class="small-note">${saving ? 'Guarde esta senha para continuar em outro aparelho ou navegador.' : 'Cole aqui uma senha salva para continuar a campanha.'}</p>
        <textarea class="pw" rows="5" ${saving ? 'readonly' : ''} spellcheck="false">${saving ? esc(code) : ''}</textarea>
        ${pick}
        <p class="pw-msg"></p>
        ${saving ? '<button class="go" data-act="copy-password">Copiar</button><button data-act="hub">← Voltar</button>' : '<button class="go" data-act="load-password">Carregar</button><button data-act="load">← Voltar</button>'}
      </div>`);
  }

  /* ---------------- som e opções ---------------- */

  private lastAudio: AudioSettings | null = null;

  showSettings(a: AudioSettings): void {
    this.lastAudio = a;
    const toggle = (key: string, label: string, on: boolean, help = '') =>
      `<div class="shop-row"><div class="grow"><b>${label}</b>${help ? `<small>${help}</small>` : ''}</div><button class="toggle ${on ? 'on' : ''}" data-toggle="${key}" data-on="${on ? 1 : 0}">${on ? 'LIGADO' : 'DESLIGADO'}</button></div>`;
    const total = a.bundled + a.user;
    this.show(`
      <div class="card small">
        <h2>SOM E OPÇÕES</h2>
        ${toggle('music', 'Música', a.music)}
        <div class="shop-row"><div><b>Volume da música</b></div><input class="vol" type="range" min="0" max="100" value="${Math.round(a.musicVolume * 100)}"/></div>
        ${toggle('sfx', 'Efeitos sonoros', a.sfx)}
        ${toggle('announcer', 'Locutor', a.announcer)}
        <div class="shop-row"><div class="grow"><b>Qualidade gráfica</b><small>Em uso: ${QUALITY_LABELS[a.qualityNow]}. Baixa deixa o jogo liso em aparelhos simples.</small></div><button class="toggle on" data-quality="${a.quality}">${QUALITY_LABELS[a.quality].toUpperCase()}</button></div>
        ${toggle('battery', 'Economia de bateria', a.battery, 'Corrida a 30 quadros por segundo: gasta menos bateria e esquenta menos')}
        ${a.touch ? toggle('autothrottle', 'Aceleração automática', a.autoThrottle, 'O carro acelera sozinho; o polegar direito freia e atira') : ''}
        ${a.touch && tiltSupported() ? toggle('tilt', 'Direção por inclinação', tiltSteeringEnabled(), 'Vire o celular como um volante; o polegar esquerdo fica só com as armas') : ''}
        ${a.touch ? this.fsButtonHtml() : ''}
        <h3>Minhas músicas</h3>
        <p class="small-note">${
          total
            ? `${total} música(s): ${a.bundled} da pasta <code>music/</code> e ${a.user} escolhida(s) neste aparelho.`
            : 'Nenhuma música sua — tocando a trilha de rock sintetizada. Escolha arquivos do aparelho ou coloque-os na pasta <code>music/</code> do projeto.'
        }</p>
        <input class="music-files" type="file" accept="audio/*" multiple hidden />
        <button data-act="pick-music">${icon('plus')} Adicionar músicas do aparelho</button>
        ${a.user ? `<button data-act="clear-music">${icon('trash')} Remover músicas do aparelho</button>` : ''}
        ${total ? `<button data-act="skip-track">${icon('next')} Próxima música</button>` : ''}
        <p class="pw-msg"></p>
        <button data-act="close-settings">← Voltar</button>
      </div>`);
    const vol = this.el.querySelector<HTMLInputElement>('.vol')!;
    vol.addEventListener('input', () => this.actions.setMusicVolume(Number(vol.value) / 100));
    const files = this.el.querySelector<HTMLInputElement>('.music-files')!;
    files.addEventListener('change', () => {
      if (files.files?.length) {
        this.el.querySelector('.pw-msg')!.textContent = 'Guardando músicas…';
        this.actions.addMusic(Array.from(files.files));
      }
    });
  }

  /* ---------------- online com amigos ---------------- */

  private onlineOptions(): OnlineOptions {
    const input = this.el.querySelector<HTMLInputElement>('.nick');
    const name = (input?.value ?? this.nick).trim().slice(0, 12) || 'Piloto';
    this.nick = name;
    try {
      localStorage.setItem('rnrr3d-nick', name);
    } catch {
      /* sem armazenamento */
    }
    return { name, vehicleId: this.quick.vehicleId, color: this.quick.color };
  }

  /** Criar sala ou entrar numa (com o código já preenchido quando veio por link). */
  showOnline(code = '', error = ''): void {
    this.show(`
      <div class="card wide">
        <h2>ONLINE COM AMIGOS</h2>
        <p class="sub center">Crie uma sala e mande o link. Até 4 pilotos, direto entre os navegadores.</p>
        ${error ? `<div class="notice retry">${esc(error)}</div>` : ''}
        <h3>Seu nome</h3>
        <input class="nick" maxlength="12" placeholder="Piloto" value="${esc(this.nick)}" autocomplete="nickname"/>
        <h3>Carro</h3>
        <div class="cars">${this.allCars.map((v) => `<button class="car" data-vehicle="${v.id}">${this.carCard(v, this.quick.color)}</button>`).join('')}</div>
        <h3>Cor</h3>${this.colorPicker('online')}
        ${
          code
            ? `<h3>Sala ${esc(code)}</h3><input class="room" type="hidden" value="${esc(code)}"/>
               <button class="go" data-act="online-join">ENTRAR NA SALA</button>`
            : `<button class="go" data-act="online-create">CRIAR SALA</button>
               <h3>Ou entre com um código</h3>
               <div class="join-row"><input class="room" maxlength="4" placeholder="ABCD" autocapitalize="characters" spellcheck="false"/><button class="buy" data-act="online-join">Entrar</button></div>`
        }
        <p class="pw-msg online-msg"></p>
        <button data-act="main">← Voltar</button>
      </div>`);
  }

  /** "Conectando…" enquanto a sala abre. */
  showOnlineWait(text: string): void {
    this.show(`<div class="card small center"><h2>ONLINE</h2><p class="sub">${esc(text)}</p><button data-act="online-leave">Cancelar</button></div>`);
  }

  showOnlineNotice(text: string): void {
    this.show(`<div class="card small center"><h2>ONLINE</h2><div class="notice retry">${esc(text)}</div><button class="go" data-act="main">Menu principal</button></div>`);
  }

  showLobby(v: LobbyView): void {
    this.lastLobby = v;
    const open = this.el.querySelector<HTMLSelectElement>('.lobby-track');
    if (open) this.quick.trackId = open.value;
    const planets = [...new Set(this.tracks.map((t) => t.planet))];
    const slots = Array.from({ length: v.max }, (_, i) => {
      const p = v.players[i];
      return p
        ? `<li>${carImg(p.vehicleId, p.color, 96, 'transparent')}<div><b style="color:${esc(hex(p.color))}">${esc(p.name)}</b><small>${esc(this.vehicles[p.vehicleId]?.name ?? '')}${i === 0 ? ' · host' : ''}${p.me ? ' · você' : ''}</small></div></li>`
        : `<li class="empty"><div><small>${v.host && this.fillCpu ? 'CPU' : 'vago'}</small></div></li>`;
    }).join('');
    const canShare = typeof navigator.share === 'function';
    this.show(`
      <div class="card">
        <h2>SALA ${esc(v.code)}</h2>
        <p class="small-note center">Mande o link para os amigos: quem abrir já entra na sala.</p>
        <div class="join-row"><input class="room-link" readonly value="${esc(v.link)}"/><button class="buy" data-act="share-link">${canShare ? 'Enviar' : 'Copiar'}</button></div>
        <p class="pw-msg share-msg"></p>
        <h3>Pilotos</h3>
        <ul class="rivals lobby">${slots}</ul>
        ${
          v.host
            ? `<h3>Pista</h3>
               <select class="lobby-track">${planets
                 .map((pl) => `<optgroup label="${esc(pl)}">${this.tracks.filter((t) => t.planet === pl).map((t) => `<option value="${t.id}" ${t.id === this.quick.trackId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`)
                 .join('')}</select>
               <div class="shop-row"><div class="grow"><b>Completar com CPU</b><small>Preenche as vagas com rivais do computador</small></div><button class="toggle ${this.fillCpu ? 'on' : ''}" data-act="cpu-toggle">${this.fillCpu ? 'LIGADO' : 'DESLIGADO'}</button></div>
               ${v.racing ? '<p class="small-note center">Corrida em andamento…</p>' : `<button class="go" data-act="online-start" ${v.players.length < 2 && !this.fillCpu ? 'disabled' : ''}>LARGAR!</button>`}`
            : `<p class="sub center">${v.racing ? 'Corrida em andamento — você entra na próxima.' : 'Esperando o host largar…'}</p>`
        }
        <h3>Câmera</h3>${this.cameraPicker()}
        <button data-act="online-leave">← Sair da sala</button>
      </div>`);
  }

  /* ---------------- pausa e resultado ---------------- */

  showPause(online = false): void {
    this.show(`
      <div class="card small pause">
        <h2>${online ? 'MENU' : 'PAUSADO'}</h2>
        ${online ? '<p class="small-note center">No online a corrida não para.</p>' : ''}
        <button class="go" data-act="resume">Continuar</button>
        ${online ? '' : '<button data-act="restart">Reiniciar corrida</button>'}
        <button data-act="settings">${icon('gear')} Som e opções</button>
        ${this.fsButtonHtml()}
        <button class="quit" data-act="${online ? 'online-leave' : 'quit'}">${icon('eject')} ${online ? 'Sair da sala' : this.inCampaign ? 'Sair da corrida (não conta)' : 'Sair da corrida'}</button>
      </div>`);
  }

  /** Tela de campeão da galáxia: rota completa, estatísticas da campanha, fala do locutor e recompensa. */
  showChampion(d: HubData): void {
    this.lastHub = d;
    const s = d.state;
    const st = s.stats;
    const winPct = st.races ? Math.round((st.wins / st.races) * 100) : 0;
    const diff = s.difficulty ?? 'normal';
    const stat = (label: string, value: string) => `<div><small>${label}</small><b>${value}</b></div>`;
    this.show(`
      <div class="card wide champion-card">
        <h2>${icon('trophy')} CAMPEÃO DA GALÁXIA!</h2>
        ${planetRoute(PLANETS.length, true)}
        <div class="me-row">${portraitSvg(d.character.id, 96)}<div><b>${esc(d.character.name)}</b><small>${esc(d.character.homeworld)} · ${esc(DIFFICULTY_LABEL[diff])}</small></div>${carImg(s.car.vehicleId, s.color, 160, 'transparent')}</div>
        <div class="notice champion"><b>Loudmouth Larry:</b> “${esc(d.character.name)} passou por Chem VI, Drakonis, Bogmire, New Mojave, Nho e Inferno e não sobrou ninguém de pé! Temos um novo campeão — e que venha o rock!”</div>
        <div class="hub-head">
          ${stat('CORRIDAS', String(st.races))}
          ${stat('VITÓRIAS', `${st.wins} (${winPct}%)`)}
          ${stat('ABATES', String(st.kills))}
          ${stat('GANHOS', money(st.earnings))}
        </div>
        <div class="notice promoted">Recompensa: troféu da galáxia e <b class="gold">${money(CHAMPION_BONUS)}</b> de prêmio (saldo: ${money(s.money)}). A garagem continua aberta: corra no Inferno para gastar o prêmio.</div>
        <button class="go" data-act="hub">Voltar à garagem ${icon('arrowRight')}</button>
        <button data-act="main">Menu principal</button>
      </div>`);
  }

  showResults(rows: ResultRow[], lapTimes: number[], report: CampaignReport | null, online = false): void {
    const best = lapTimes.length ? Math.min(...lapTimes) : 0;
    const me = rows.find((r) => r.me);
    const title =
      report?.outcome === 'champion' ? 'CAMPEÃO!' : report?.outcome === 'promoted' ? 'PROMOVIDO!' : me && me.place === 1 ? 'VITÓRIA!' : 'RESULTADO';
    const campaignBlock = report
      ? `<div class="notice ${report.outcome}">
          ${report.outcome === 'champion' ? `${planetRoute(PLANETS.length, true)}Você venceu a galáxia inteira! Lenda do rock.` : ''}
          ${report.outcome === 'promoted' ? `${planetImg(PLANETS.find((p) => report.label.startsWith(p.name))?.theme, 112, 'promo')}Subiu para: <b>${report.label}</b>` : ''}
          ${report.outcome === 'retry' ? `Não somou ${report.promote} pontos. A temporada recomeça — melhore o carro na loja!` : ''}
          ${report.outcome === 'continue' ? `+${report.pointsEarned} pontos · total ${report.points}/${report.promote}` : ''}
        </div>`
      : '';
    const podium = rows
      .slice()
      .sort((a, b) => a.place - b.place)
      .map(
        (r) => `<div class="res-row ${r.me ? 'me' : ''} p${r.place}"><span class="res-place">${r.place}º</span>${portraitSvg(r.pilot ?? r.name, 48)}
          <div class="res-name"><b style="color:${esc(r.color)}">${esc(r.name)}</b><small>${r.time !== null ? formatTime(r.time) : '—'} · ${r.kills} abate(s)</small></div>
          ${r.vehicleId ? carImg(r.vehicleId, parseInt(r.color.slice(1), 16), 96, 'transparent') : ''}<span class="gold">${money(r.prize)}</span></div>`,
      )
      .join('');
    this.show(`
      <div class="card results">
        <h2>${title}</h2>
        ${campaignBlock}
        <div class="res-list">${podium}</div>
        ${lapTimes.length ? `<table>${lapTimes.map((t, i) => `<tr class="${t === best ? 'best' : ''}"><td>Volta ${i + 1}</td><td>${formatTime(t)}</td></tr>`).join('')}</table>` : ''}
        ${me ? `<p class="money">Ganho nesta corrida (prêmio + pista): <b>${money(me.money)}</b></p>` : ''}
        ${
          online
            ? '<button class="go" data-act="online-lobby">Voltar à sala</button>'
            : report
              ? '<button class="go" data-act="results-continue">Continuar</button>'
              : '<button class="go" data-act="restart">Correr de novo</button><button data-act="main">Menu principal</button>'
        }
      </div>`);
  }

  /* ---------------- eventos ---------------- */

  private refresh(): void {
    const sel = (selector: string, on: (el: HTMLElement) => boolean) => this.el.querySelectorAll<HTMLElement>(selector).forEach((b) => b.classList.toggle('sel', on(b)));
    sel('.cam', (b) => b.dataset.cam === this.camera);
    sel('.car[data-vehicle]', (b) => b.dataset.vehicle === this.quick.vehicleId);
    sel('.trk', (b) => b.dataset.track === this.quick.trackId);
    sel('.char', (b) => b.dataset.char === (b.dataset.cgroup === 'quick' ? this.quick.characterId : this.newChar.characterId));
    sel('.tab[data-tab]', (b) => b.dataset.tab === this.shopTab);
    sel('.tab[data-qplanet]', (b) => b.dataset.qplanet === this.quickPlanet);
    sel('.slotsel', (b) => Number(b.dataset.slotsel) === this.newChar.slot);
    sel('.pwsel', (b) => Number(b.dataset.pwslot) === this.pwSlot);
    sel('.color', (b) => Number(b.dataset.color) === (b.dataset.group === 'new' ? this.newChar.color : this.quick.color));
    sel('.diff', (b) => b.dataset.diff === (b.dataset.group === 'new' ? this.newChar.difficulty : this.quick.difficulty));
  }

  /** Segundo toque confirma: o primeiro troca o texto do botão pela pergunta. */
  private confirmClick(t: HTMLElement, question: string): boolean {
    if (t.classList.contains('confirm')) return true;
    this.clearConfirm();
    t.dataset.label = t.innerHTML;
    t.classList.add('confirm');
    t.textContent = question;
    return false;
  }

  private clearConfirm(): void {
    this.el.querySelectorAll<HTMLElement>('.confirm[data-label]').forEach((b) => {
      b.classList.remove('confirm');
      b.innerHTML = b.dataset.label!;
      delete b.dataset.label;
    });
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.cam) {
      this.camera = d.cam as CameraMode;
      this.actions.setCamera(this.camera);
    }
    if (d.vehicle) this.quick.vehicleId = d.vehicle;
    if (d.track) this.quick.trackId = d.track;
    if (d.char && d.cgroup === 'quick') {
      this.quick.characterId = d.char;
      const feat = this.el.querySelector('.char-pick[data-cgroup="quick"] .char-feature');
      if (feat) feat.innerHTML = this.charFeature(d.char);
    } else if (d.char) {
      // toque: 5 toques rápidos no Tarquinn liberam o Olaf
      if (d.char === 'tarquinn' && !this.olafUnlocked) {
        const now = performance.now();
        this.tarquinnTaps = [...this.tarquinnTaps.filter((t0) => now - t0 < 5000), now];
        if (this.tarquinnTaps.length >= 5) {
          this.newChar.characterId = 'tarquinn';
          this.tarquinnTaps = [];
          this.trySecret();
          return;
        }
      }
      this.newChar.characterId = d.char;
      const feat = this.el.querySelector('.char-feature');
      if (feat) feat.innerHTML = this.charFeature();
    }
    if (d.slotsel) {
      this.newChar.slot = Number(d.slotsel);
      this.clearConfirm();
    }
    if (d.pwslot) {
      this.pwSlot = Number(d.pwslot);
      this.clearConfirm();
    }
    if (d.diff) {
      if (d.group === 'new') this.newChar.difficulty = d.diff as Difficulty;
      else this.quick.difficulty = d.diff as Difficulty;
    }
    if (d.color) {
      if (d.group === 'new') this.newChar.color = Number(d.color);
      else {
        // corrida rápida e online: só as miniaturas dos carros trocam (sem refazer o menu)
        this.quick.color = Number(d.color);
        this.recolorCars();
      }
    }
    if (d.qplanet) {
      // troca só a linha de pistas
      this.quickPlanet = d.qplanet;
      const row = this.el.querySelector<HTMLElement>('.track-row');
      if (row) {
        row.innerHTML = this.quickTracks();
        fillThumbs(row);
      }
    }
    if (d.tab && this.lastHub) {
      this.shopTab = d.tab as typeof this.shopTab;
      this.showShop(this.lastHub);
      return;
    }
    if (d.quality) {
      const order: QualityPref[] = ['auto', 'baixo', 'medio', 'alto'];
      this.actions.setQuality(order[(order.indexOf(d.quality as QualityPref) + 1) % order.length]);
      return;
    }
    if (d.toggle) {
      if (d.toggle === 'tilt') {
        void setTiltSteering(d.on !== '1').then(() => this.lastAudio && this.showSettings(this.lastAudio));
        return;
      }
      if (d.toggle === 'battery') this.actions.setBatterySaver(d.on !== '1');
      else if (d.toggle === 'autothrottle') this.actions.setAutoThrottle(d.on !== '1');
      else this.actions.setAudio(d.toggle as 'music' | 'sfx' | 'announcer', d.on !== '1');
    }
    if (d.upgrade) this.actions.buyUpgrade(d.upgrade as UpgradeKind);
    if (d.charge) this.actions.buyCharge(d.charge as ChargeKind);
    if (d.buycar) {
      // trocar de carro perde as peças: pede um segundo toque com o valor da troca
      if (!this.confirmClick(t, `Trocar? ${d.buyinfo ?? ''}`.trim())) return;
      return this.actions.buyCar(d.buycar);
    }
    if (d.save) {
      const occupied = this.actions.listSlots().some((x) => x.slot === Number(d.save) && !x.empty);
      if (occupied && !this.confirmClick(t, 'Substituir?')) return;
      return this.actions.saveSlot(Number(d.save));
    }
    if (d.loadslot) return this.actions.loadSlot(Number(d.loadslot));
    if (d.delslot) {
      if (t.classList.contains('confirm')) {
        this.hasSave = this.actions.deleteSlot(Number(d.delslot));
        this.showSlots(this.el.querySelector('[data-save]') ? 'save' : 'load', 'Slot apagado.');
      } else {
        t.classList.add('confirm');
        t.textContent = 'Apagar?';
      }
      return;
    }

    switch (d.act) {
      case 'continue':
        return this.actions.continueCampaign();
      case 'new':
        return this.showNewCampaign();
      case 'new-start': {
        const slot = this.newChar.slot;
        const busy = this.actions.listSlots().some((x) => x.slot === slot && !x.empty);
        if (busy && !this.confirmClick(t, `Substituir o slot ${slot + 1}?`)) return;
        return this.actions.newCampaign({ ...this.newChar });
      }
      case 'quick':
        return this.showQuick();
      case 'quick-start':
        return this.actions.quickRace({ ...this.quick });
      case 'load':
        return this.showSlots('load');
      case 'save':
        return this.showSlots('save');
      case 'slots-back':
        return this.slotsFrom === 'hub' ? this.actions.backToHub() : this.showMain(this.hasSave);
      case 'password':
        return this.showPassword(null);
      case 'show-password':
        return this.actions.showPassword();
      case 'copy-password': {
        const ta = this.el.querySelector<HTMLTextAreaElement>('.pw')!;
        ta.select();
        void navigator.clipboard?.writeText(ta.value).catch(() => document.execCommand('copy'));
        this.el.querySelector('.pw-msg')!.textContent = 'Copiada!';
        return;
      }
      case 'load-password': {
        const busy = this.actions.listSlots().some((x) => x.slot === this.pwSlot && !x.empty);
        if (busy && !this.confirmClick(t, `Substituir o slot ${this.pwSlot + 1}?`)) return;
        const ok = this.actions.loadPassword(this.el.querySelector<HTMLTextAreaElement>('.pw')!.value, this.pwSlot);
        if (!ok) this.el.querySelector('.pw-msg')!.textContent = 'Senha inválida.';
        return;
      }
      case 'advance':
        return this.actions.advanceEarly();
      case 'hub-race':
        return this.actions.campaignRace();
      case 'shop':
        return this.actions.openShop();
      case 'hub':
        return this.actions.backToHub();
      case 'main':
        return this.actions.toMain();
      case 'resume':
        return this.actions.resume();
      case 'restart':
        return this.actions.restart();
      case 'quit':
        return this.actions.quit();
      case 'results-continue':
        return this.actions.resultsContinue();
      case 'settings':
        return this.actions.openSettings();
      case 'close-settings':
        return this.actions.closeSettings();
      case 'fullscreen':
        return this.actions.toggleFullscreen();
      case 'install':
        return this.actions.install();
      case 'quit-game':
        return this.actions.quitGame();
      case 'pick-music':
        this.el.querySelector<HTMLInputElement>('.music-files')?.click();
        return;
      case 'clear-music':
        return this.actions.clearMusic();
      case 'skip-track':
        return this.actions.skipTrack();
      case 'online':
        return this.showOnline();
      case 'online-create':
        return this.actions.onlineCreate(this.onlineOptions());
      case 'online-join': {
        const code = this.el.querySelector<HTMLInputElement>('.room')?.value ?? '';
        if (code.replace(/\s/g, '').length < 4) {
          this.el.querySelector('.online-msg')!.textContent = 'Digite o código de 4 letras da sala.';
          return;
        }
        return this.actions.onlineJoin(this.onlineOptions(), code);
      }
      case 'online-start':
        return this.actions.onlineStart(this.el.querySelector<HTMLSelectElement>('.lobby-track')?.value ?? this.quick.trackId, this.fillCpu);
      case 'online-leave':
        return this.actions.onlineLeave();
      case 'online-lobby':
        return this.actions.onlineLobby();
      case 'cpu-toggle':
        this.fillCpu = !this.fillCpu;
        if (this.lastLobby) this.showLobby(this.lastLobby);
        return;
      case 'share-link': {
        const link = this.lastLobby?.link ?? '';
        const msg = this.el.querySelector('.share-msg')!;
        if (typeof navigator.share === 'function') {
          void navigator.share({ title: "Rock 'n' Roll Racing 3D", text: `Corre comigo! Sala ${this.lastLobby?.code}`, url: link }).catch(() => {});
        } else {
          void navigator.clipboard
            ?.writeText(link)
            .then(() => (msg.textContent = 'Link copiado!'))
            .catch(() => {
              this.el.querySelector<HTMLInputElement>('.room-link')?.select();
              msg.textContent = 'Selecione e copie o link.';
            });
        }
        return;
      }
    }
    this.refresh();
  }
}
