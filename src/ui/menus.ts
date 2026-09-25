import { BATTERY_LABELS, QUALITY_LABELS, type BatteryPref, type QualityLevel, type QualityPref } from '../render/quality';
import type { CameraMode } from '../render/cameras';
import { carThumbnail, itemThumbnail, SHOWROOM_COLOR, type CarThumbStyle, type ShopItem } from '../render/thumbnails';
import { planetThumbnail } from '../render/planetThumbs';
import type { ThemeId } from '../sim/track';
import {
  bossBonus, campaignChargePrice, CAMPAIGN_RULES, canAdvanceEarly, carComingSoon, carsForSale, DIVISIONS, moneyCapped, planetCount, planetForLevel, PLANETS, POINTS, raceKind, rulesOf, seasonInfo, shopLevel, START_MONEY,
  CHAMPION_PAINT, paintPrice, type CampaignState, type OpponentSetup, type PlanetDef, type PlanetNews, type RaceKind, type RaceOutcome, RIVALS, CHAMPION_BONUS, seasonSchedule,
} from '../sim/campaign';
import { pauseView } from '../sim/campaignFlow';
import {
  armamentText, attributeTags, ATTRIBUTE_LABEL, buildSpec, CAR_PRICES, carAttributes, CHARACTERS, CHARGE_KINDS, chargeWeapon, MAX_UPGRADE, maxExtraCharges,
  carSwapCost, TRADE_CAP, tradeInValue, UPGRADE_KINDS, upgradeAvailable, upgradeHelp, upgradeLabel, upgradeName, upgradePrice, upgradesSpent, type CarAttributes, type CarSetup, type Character,
  type ChargeKind, type UpgradeKind,
} from '../sim/garage';
import type { Track, TrackDef } from '../sim/track';
import { trackById } from '../data/tracks';
import { WEAPON_NAMES, type VehicleSpec } from '../sim/vehicle';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty } from '../sim/world';
import type { SlotInfo } from '../core/storage';
import { formatTime } from './hud';
import { isTouchDevice, setTiltSteering, tiltSteeringEnabled, tiltSupported } from '../input/controls';
import { portraitSvg, warmPortraits } from './portraits';
import { trackOutlineUrl, trackThumbnail } from './trackThumb';
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
/** No cartão da campanha o Normal diz até onde vai (o Veteran do original parava em Nho). */
const CAMPAIGN_DIFF_HELP: Partial<Record<Difficulty, string>> = { normal: 'Até Nho, como o Veteran do original' };

const money = (n: number) => `$${n.toLocaleString('pt-BR')}`;

/** Viagem entre planetas (animação da promoção de planeta). */
export interface PlanetWarp {
  from: PlanetDef;
  to: PlanetDef;
  /** planetas da campanha nesta dificuldade */
  planets: number;
  vehicleId: string;
  color: number;
  /** novidades do planeta novo (carro à venda, peças, rivais, prêmio), listadas no quadro final */
  news?: PlanetNews;
}

/** Falas do locutor na chegada a um planeta ({planet}, {boss}). */
const WARP_LINES = [
  'Bem-vindo a {planet}! Aperte o cinto e prepare o metal!',
  'Chegamos a {planet}! {boss} já está esquentando os motores!',
  '{planet}, preparem-se: tem um novato faminto chegando!',
  'Atenção, {planet}! {boss} manda recado: aqui ninguém passa!',
  'Novo planeta, nova carnificina! {planet} vai tremer!',
  '{planet}! O último degrau antes da glória! {boss} te espera no fogo!',
];

/** Resumo das regras da campanha numa dificuldade (tela de nova campanha). */
function campaignRulesText(d: Difficulty): string {
  const r = CAMPAIGN_RULES[d];
  const last = PLANETS[r.planets - 1].name;
  const races = `${Math.min(...r.races)}–${Math.max(...r.races)}`;
  const cash = r.money === 1 ? 'dinheiro normal' : r.money > 1 ? `+${Math.round((r.money - 1) * 100)}% de dinheiro` : `${Math.round((r.money - 1) * 100)}% de dinheiro`;
  const tries = r.playoffTries === 1 ? '1 repescagem' : `${r.playoffTries} repescagens`;
  return `${r.planets} planetas (até ${esc(last)}) · ${races} corridas por divisão · meta ${Math.round(r.goal * 100)}% dos pontos · ${tries} · ${cash}`;
}
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
  /** `ping`: ms (null = ainda sem medida; ausente = não se aplica); `away`: caiu e pode voltar */
  players: { name: string; color: number; vehicleId: string; me: boolean; ping?: number | null; away?: boolean }[];
  max: number;
  /** a corrida está rolando (quem entrou agora espera a próxima) */
  racing: boolean;
}

export interface MenuActions {
  quickRace(o: QuickOptions): void;
  /** Escolha da corrida rápida mudou: monta o grid na fila ociosa, antes do clique em CORRER. */
  prewarmQuick?(o: QuickOptions): void;
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
  buyPaint(): void;
  showPassword(): void;
  /** o final da campanha foi visto até o fim (ou pulado): sai do save */
  championSeen(): void;
  backToHub(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  resultsContinue(): void;
  /** fim da animação de viagem para o novo planeta */
  warpDone(): void;
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
  setBatterySaver(mode: BatteryPref): void;
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
  /** economia de bateria: Automática (fora da tomada) / Sempre / Nunca */
  battery: BatteryPref;
  /** a economia está em uso agora */
  batteryNow: boolean;
  /** o navegador informa a bateria (getBattery); sem isso a Automática decide pela folga do aparelho */
  batteryDetect?: boolean;
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

/** Resultados online: nota (host caiu etc.), placar final ou parcial, pergunta antes de encerrar. */
export interface OnlineResults {
  note?: string;
  final?: boolean;
  /** host: voltar à sala encerra a corrida de quem ainda corre (pede confirmação) */
  confirm?: boolean;
  /** a sala acabou: o botão leva ao menu */
  gone?: boolean;
}

/** Ping de um piloto na sala (bolinha colorida + ms). */
function pingBadge(ms: number | null | undefined): string {
  if (ms === undefined) return '';
  const color = ms === null ? '#888' : ms < 90 ? '#3cff4a' : ms < 180 ? '#ffd21a' : '#ff3a1a';
  return `<small class="ping-badge" style="margin-left:auto;display:flex;align-items:center;gap:4px;white-space:nowrap"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></i>${ms === null ? '—' : Math.round(ms)} ms</small>`;
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
  /** tipo da corrida disputada (normal, duelo do chefe ou repescagem) e o chefe do planeta */
  kind: RaceKind;
  boss: string;
  /** bônus por derrotar o chefe */
  bonus: number;
  /** repescagem: duelos que ainda restam */
  playoffLeft: number;
  /** planetas da campanha nesta dificuldade */
  planets: number;
  /** bolso acima do que a loja vende: os prêmios estão reduzidos (hoardFactor) */
  moneyCapped?: boolean;
}

/* ------------------------------------------------------------------ */
/* Atributos dos carros: barras que mostram forças e fraquezas          */
/* ------------------------------------------------------------------ */

const ATTRS = Object.keys(ATTRIBUTE_LABEL) as (keyof CarAttributes)[];

/** Piso das barras: nenhum carro aparece com menos de 3 de 10 segmentos em nada (item 18). */
const BAR_FLOOR = 0.3;

/**
 * Atributo na escala das barras (0..1 = 0..10 segmentos). Usa a escala ABSOLUTA de `carAttributes`
 * (faixa real de cada atributo, igual para todos os carros, poder de fogo pelo dano esperado das
 * armas): nada de esticar o pior carro de fábrica para 2 segmentos e o melhor para 10 — diferença
 * pequena fica pequena. Piso de 3 segmentos. Melhorias e piloto podem encher a barra.
 */
function barScale(_k: keyof CarAttributes, a: number): number {
  return Math.max(BAR_FLOOR, Math.min(1, a));
}

/**
 * Barras segmentadas dos atributos (escala absoluta, piso 3/10). FORTE/FRACO só quando o carro se
 * destaca de fato dos outros carros de fábrica (`attributeTags`), no máximo um de cada.
 */
function statBars(v: VehicleSpec, withPilot?: VehicleSpec): string {
  const a = carAttributes(v);
  const vals = ATTRS.map((k) => barScale(k, a[k]));
  const tags = attributeTags(v);
  // bônus do piloto: segmentos a mais (ou a menos) em azul, por cima da base igual à da loja
  const p = withPilot ? carAttributes(withPilot) : a;
  let anyBonus = false;
  const bars = ATTRS.map((k, i) => {
    const n = Math.max(1, Math.min(10, Math.round(vals[i] * 10)));
    const t = Math.max(1, Math.min(10, Math.round(barScale(k, p[k]) * 10)));
    if (t !== n) anyBonus = true;
    const tag = tags[k] === 'good' ? '<em class="st-good">forte</em>' : tags[k] === 'bad' ? '<em class="st-bad">fraco</em>' : '';
    const cls = tags[k] === 'good' || n >= 8 ? 'hi' : tags[k] === 'bad' || n <= 3 ? 'lo' : 'mid';
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
function carImg(id: string, color: number, size = 200, style: CarThumbStyle = 'card', prio = false): string {
  const key = `${id}|${color}|${size}|${style}`;
  const url = thumbReady.get(key);
  return `<img class="car-img${style === 'card' ? ' card-img' : ''}${url ? '' : ' loading'}" data-thumb="${esc(key)}"${prio ? ' data-prio="1"' : ''} src="${url ?? BLANK}" alt="" draggable="false"/>`;
}

/** Tema (planeta) de cada nome de planeta usado nas pistas e na campanha. */
const PLANET_THEME: Record<string, ThemeId> = Object.fromEntries(PLANETS.map((p) => [p.name, p.theme]));

/** Miniatura do planeta (esfera 3D sobre o espaço), gerada aos poucos como as dos carros. */
function planetImg(theme: ThemeId | undefined, size = 64, cls = ''): string {
  if (!theme) return '';
  const key = `planet|${theme}|${size}`;
  const url = thumbReady.get(key);
  // fundo na cor do planeta: enquanto a miniatura 3D não fica pronta (ou se ela falhar), nunca um círculo vazio
  const [lit, dark] = PLANET_TINT[theme] ?? ['#8a8aa0', '#1a1a2a'];
  const bg = `background:radial-gradient(circle at 36% 34%,${lit},${dark} 68%,#05040a 100%)`;
  return `<img class="planet-img${cls ? ` ${cls}` : ''}${url ? '' : ' loading'}" data-thumb="${key}" style="${bg}" src="${url ?? BLANK}" alt="" draggable="false"/>`;
}

/** Cores (luz, sombra) do fundo provisório de cada planeta. */
const PLANET_TINT: Record<ThemeId, [string, string]> = {
  chem6: ['#d8883a', '#4a1c08'],
  drakonis: ['#9458d0', '#1a0a30'],
  bogmire: ['#7a8a3a', '#1a220c'],
  newmojave: ['#eca858', '#6a2a0c'],
  nho: ['#d4e4f6', '#2a5a98'],
  inferno: ['#ff6a1a', '#2a0806'],
};

/** Aquece as miniaturas do planeta atual e do próximo (cabeçalho, rota e viagem) na frente da fila. */
function warmPlanetThumbs(index: number, urgent = true): void {
  const keys: string[] = [];
  for (const p of PLANETS.slice(index, index + 2)) for (const s of [72, 48, 176]) keys.push(`planet|${p.theme}|${s}`);
  if (!urgent) return warmThumbs(keys);
  idleJobsUrgent(keys.filter((k) => !thumbReady.has(k)).map((key) => ({ key: `thumb:${key}`, run: () => makeThumb(key) })));
}

/** Rota da campanha: os 6 planetas em ordem, com o atual em destaque e os vencidos marcados. */
/** "Chem VI, Drakonis e Bogmire" (os planetas da campanha). */
function planetList(count: number): string {
  const names = PLANETS.slice(0, count).map((p) => p.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0];
}

/** Selo do teto de dinheiro (garagem e resultados): o jogador entende por que os prêmios encolheram. */
const CAPPED_SEAL = '<span class="capped-seal" title="Com mais dinheiro do que a loja ainda vende, o dinheiro da pista e os prêmios de 2º e 3º rendem só uma parte. O 1º lugar e o bônus do chefe pagam sempre cheio.">Pista e 2º/3º reduzidos: você já tem mais do que a loja vende</span>';

/** Rota dos planetas da campanha (só os da dificuldade: Fácil 3, Normal 5, Difícil 6). */
function planetRoute(current: number, champion = false, count = PLANETS.length): string {
  return `<div class="planet-route">${PLANETS.slice(0, count).map((p, i) => {
    const st = champion || i < current ? 'done' : i === current ? 'now' : 'next';
    return `<div class="pr-step ${st}" title="${esc(p.name)}">${planetImg(p.theme, i === current && !champion ? 72 : 48)}<small>${esc(p.name)}</small></div>`;
  }).join('<i class="pr-link"></i>')}</div>`;
}

/** Troféu da galáxia desenhado em SVG (taça dourada com estrela). `id` separa os gradientes na página. */
function trophySvg(id: string): string {
  const g = `trophy-${id}`;
  return `<svg class="trophy-svg" viewBox="0 0 120 140" aria-hidden="true">
    <defs><linearGradient id="${g}" x1="0" x2="1"><stop offset="0" stop-color="#8a5a00"/><stop offset=".35" stop-color="#ffe27a"/><stop offset=".6" stop-color="#f2b418"/><stop offset="1" stop-color="#7a4a00"/></linearGradient></defs>
    <path d="M30 22H15c0 19 8 29 20 31M90 22h15c0 19-8 29-20 31" fill="none" stroke="url(#${g})" stroke-width="7" stroke-linecap="round"/>
    <path d="M28 12h64v28c0 23-14 39-32 39S28 63 28 40z" fill="url(#${g})" stroke="#5a3600" stroke-width="2"/>
    <path d="M36 16h8v24c0 12 4 22 10 28-12-4-18-16-18-28z" fill="#fff6c8" opacity=".45"/>
    <path d="M60 25l4.7 9.5 10.5 1.5-7.6 7.4 1.8 10.4-9.4-4.9-9.4 4.9 1.8-10.4-7.6-7.4 10.5-1.5z" fill="#fff6c8" stroke="#8a5a00" stroke-width="1"/>
    <rect x="53" y="78" width="14" height="18" fill="url(#${g})" stroke="#5a3600" stroke-width="1.5"/>
    <path d="M38 96h44l7 14H31z" fill="url(#${g})" stroke="#5a3600" stroke-width="2"/>
    <rect x="25" y="110" width="70" height="18" rx="3" fill="#2a1a3a" stroke="#f2c318" stroke-width="2"/>
    <text x="60" y="123.5" text-anchor="middle" font-size="9" font-weight="700" fill="#f2c318" letter-spacing="1">GALÁXIA</text>
  </svg>`;
}

/** Pistas conhecidas pela chave `track|id|w|h` (para gerar a miniatura na fila). */
const trackDefs = new Map<string, TrackDef>();
/** Miniaturas em geração (a imagem é codificada fora da thread principal). */
const thumbPending = new Set<string>();

/** Coloca a imagem pronta em todas as `<img>` que esperam por ela (em qualquer menu aberto). */
function applyThumb(key: string, url: string): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLImageElement>('img.loading[data-thumb]').forEach((el) => {
    if (el.dataset.thumb !== key || (!url && el.classList.contains('trk-img'))) return;
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
    if (url) {
      thumbTries.delete(key);
      thumbReady.set(key, url);
    } else {
      // falha (ex.: contexto WebGL perdido): tenta de novo mais tarde (até 3 vezes) com a imagem ainda "carregando"
      const n = (thumbTries.get(key) ?? 0) + 1;
      thumbTries.set(key, n);
      if (n <= 3) {
        setTimeout(() => idleJob(`thumb:${key}`, () => makeThumb(key)), 400 * n);
        return;
      }
      thumbTries.delete(key); // desiste por agora; a próxima tela tenta de novo
    }
    applyThumb(key, url);
  });
}
/** Tentativas seguidas que falharam por chave de miniatura. */
const thumbTries = new Map<string, number>();

/**
 * Pré-gera miniaturas (a partir do menu principal) nos intervalos livres, uma por vez e nunca
 * durante a rolagem: ao abrir a corrida rápida no celular elas já estão prontas. Continua mesmo
 * depois de trocar de menu (o que a tela aberta mostra passa na frente, ver fillThumbs).
 */
function warmThumbs(keys: string[]): void {
  for (const key of keys) if (!thumbReady.has(key)) idleJob(`thumb:${key}`, () => makeThumb(key));
}

/**
 * Põe na frente da fila as miniaturas que faltam na tela aberta, na ordem em que aparecem — as
 * marcadas com `data-prio` (o carro do jogador na garagem e na loja) antes de todas.
 */
function fillThumbs(root: HTMLElement): void {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-thumb].loading'));
  imgs.sort((a, b) => Number(!!b.dataset.prio) - Number(!!a.dataset.prio));
  const keys = [...new Set(imgs.map((el) => el.dataset.thumb!))];
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
  // enquanto a miniatura não fica pronta, o traçado vetorial da pista ocupa o quadro (nunca vazio)
  return `<img class="trk-img${url ? '' : ' loading'}" data-thumb="${esc(key)}" src="${url ?? trackOutlineUrl(def, w, h)}" style="aspect-ratio:${w}/${h}" alt="" draggable="false"/>`;
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

  /** A garagem ou a loja estão na tela (sem cena por cima)? Para recarregar o save salvo em outra aba. */
  isShowingGarage(): boolean {
    return this.el.style.display !== 'none' && !!this.el.querySelector('.card.hub, .shop-head') && !this.el.querySelector('.finale');
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
    const help = (d: Difficulty) => (group === 'new' ? `${CAMPAIGN_DIFF_HELP[d] ?? DIFF_HELP[d]}<br>${campaignRulesText(d)}` : DIFF_HELP[d]);
    return `<div class="diffs">${DIFFICULTIES.map((d) => `<button class="diff d-${d}" data-diff="${d}" data-group="${group}"><b>${DIFFICULTY_LABEL[d]}</b><small>${help(d)}</small></button>`).join('')}</div>`;
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
      <p><b>Teclado:</b> ↑/W acelera · ↓/S freia/ré · ←→/A D vira · Q/E derrapar (freio de mão) · Ctrl esq./Espaço atira · \ ou X arma traseira · Shift assistência (nitro/pulo) · C câmera · Esc pausa · M som</p>
      <p><b>Controle:</b> RT acelera · LT freia · analógico vira · LB derrapar · X/RB atira · B arma traseira · L3/R3 assistência · Y câmera · Start pausa</p>
      <p><b>Celular:</b> polegar esquerdo no volante: toque à esquerda ou à direita da faixa para virar, como as setas do teclado (arrastando para cima, atira sem soltar a direção) e tem TIRO, a arma traseira (mina/óleo) e a assistência (nitro/pulo) logo acima, cada botão com o ícone da arma atual; polegar direito acelera, freia e tem o botão DERRAPAR (deslizando do ACEL até o TIRO logo acima, atira sem soltar o gás). Em “Som e opções”: aceleração automática (o polegar direito ganha um TIRO) e direção por inclinação.</p>
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
      <div class="cf-info"><b class="cf-name">${esc(c.name)}</b><small class="home">${esc(c.homeworld ?? '')}</small><p>${esc(c.description)}</p><div class="skills">${this.bonusText(c)}</div></div>`;
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
        <div class="new-route">${planetRoute(0, false, CAMPAIGN_RULES[this.newChar.difficulty].planets)}</div>
        <p class="sub center">Comece em ${esc(PLANETS[0].name)}, Divisão B, com ${money(START_MONEY)}. Some pontos para subir de divisão
          (1º: ${POINTS[0]} pts · 2º: ${POINTS[1]} · 3º: ${POINTS[2]}). A Divisão A de cada planeta fecha com um duelo contra o chefe local;
          se faltar ponto, a repescagem é um duelo contra ele. A dificuldade decide até onde vai a galáxia.</p>
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
                  <div class="slot-info"><b>${esc(s.pilot)}</b><small class="slot-planet">${planetImg(PLANET_THEME[s.planet], 32, 'mini')}${esc(s.planet)} · Divisão ${esc(s.division)} · ${esc(DIFFICULTY_LABEL[s.difficulty] ?? '')}${s.champion ? ` · ${icon('trophy')}` : ''}</small>
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
    const early = canAdvanceEarly(s);
    const kind = raceKind(s);
    const boss = d.planet.local;
    const triesText = (n: number) => (n === 1 ? '<b>Última chance</b> — se perder, a divisão recomeça' : `Restam <b>${n}</b> tentativas`);
    const duel =
      kind === 'boss'
        ? `<div class="notice boss"><b>DUELO CONTRA O CHEFE:</b> só você e ${esc(boss)}, com o carro turbinado e armado até os dentes.
            ${s.points >= season.promote ? 'Você já tem os pontos: vença e deixe o planeta!' : `Vença para somar ${POINTS[0]} pontos (faltam ${season.promote - s.points}).`}
            Prêmio extra: <b class="gold">${money(bossBonus(s))}</b>.</div>`
        : kind === 'playoff'
          ? `<div class="notice boss"><b>REPESCAGEM:</b> ainda dá! Vença ${esc(boss)} no duelo e ${s.division === 0 ? 'suba de divisão' : 'deixe o planeta'}.
              ${triesText(s.playoff ?? 1)}. Prêmio extra: <b class="gold">${money(bossBonus(s))}</b>.</div>`
          : '';
    const earlyText =
      s.division === 1
        ? `Você já tem os pontos! Continue correndo para ganhar dinheiro ou <button class="inline-go" data-act="advance">desafiar ${esc(boss)} agora ${icon('arrowRight')}</button>`
        : `Você já tem os pontos! Continue correndo aqui para ganhar dinheiro ou <button class="inline-go" data-act="advance">subir agora ${icon('arrowRight')}</button>`;
    const car = this.vehicles[s.car.vehicleId];
    this.show(`
      <div class="card wide hub">
        <div class="hub-top">
          <div class="hub-planet">${planetImg(d.planet.theme, 72)}<span><small>PLANETA ${s.planet + 1}/${planetCount(s)}</small><b>${esc(d.planet.name)}</b><em>Divisão ${div}</em></span></div>
          ${this.raceBadge(s)}
          <div class="hub-money"><small>DINHEIRO</small><b class="gold">${money(s.money)}</b>${moneyCapped(s) ? CAPPED_SEAL : ''}</div>
        </div>
        <div class="hub-progress">
          ${planetRoute(s.planet, s.champion, planetCount(s))}
          <div class="points"><span>Pontos: <b>${s.points}</b> / ${season.promote} para subir${s.division === 1 && !s.champion ? ` e vencer ${esc(boss)}` : ''}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
        </div>
        ${notice ? `<div class="notice">${iconizeHtml(notice)}</div>` : ''}
        ${duel}
        ${early ? `<div class="notice promoted">${earlyText}</div>` : ''}
        <div class="hub-main">
          <div class="panel hub-track">
            <h3>Próxima pista</h3>
            ${trackImg(d.track.def, 320, 200)}
            <p class="trk-name"><b>${esc(d.track.def.name)}</b> · ${d.track.def.laps} voltas${d.track.def.slime ? ' · poças de gosma' : ''}</p>
            ${this.seasonCalendar(s)}
          </div>
          <div class="panel hub-rivals">
            <h3>${kind === 'normal' ? 'Rivais' : 'Chefe do planeta'}</h3>
            <ul class="rivals">${d.opponents
              .map(
                (o) => `<li>${portraitSvg(o.name, 56)}<div><b>${esc(o.name)}</b><small class="rv-car"><i style="background:${hex(o.color)}"></i>${esc(o.spec.name)}</small></div>${carImg(o.spec.id, o.color, 96, 'transparent')}</li>`,
              )
              .join('')}</ul>
          </div>
          <div class="panel hub-me">
            <h3>Você</h3>
            <div class="me-row">${portraitSvg(d.character.id, 56)}<div><b>${esc(d.character.name)}</b><div class="skills">${this.bonusText(d.character)}</div></div></div>
            <div class="hub-car">${carImg(s.car.vehicleId, s.color, 160, 'transparent', true)}<b>${esc(car?.name ?? d.spec.name)}</b></div>
            <ul class="upg-list">
              ${UPGRADE_KINDS.filter((k) => upgradeAvailable(s.car.vehicleId, k)).map((k) => `<li><span>${upgradeLabel(s.car.vehicleId, k)}</span> ${pips(u[k], MAX_UPGRADE)}</li>`).join('')}
            </ul>
            <p class="small-note">${d.spec.frontCharges}× ${weaponFull(d.spec.front)} · ${d.spec.rearCharges}× ${weaponFull(d.spec.rear)} · ${d.spec.nitroCharges}× ${weaponFull(d.spec.assist)}</p>
          </div>
        </div>
        <div class="hub-actions">
          <button class="go" data-act="hub-race">CORRER!</button>
          <div class="row-buttons">
            <button data-act="shop">${icon('cart')} Loja</button>
            <button data-act="save">${icon('save')} Salvar</button>
            <button data-act="settings">${icon('gear')} Opções</button>
            <button data-act="main">Menu</button>
          </div>
          <div class="hub-cam"><small>CÂMERA</small>${this.cameraPicker()}</div>
        </div>
      </div>`);
    // a próxima pista é desenho 2D barato: gera na hora, sem esperar a fila das miniaturas 3D
    // (na garagem do chefe a fila ainda estava nos carros e o quadro ficava vazio)
    makeThumb(trackKey(d.track.def, 320, 200));
    // planeta atual e próximo na frente dos carros (cabeçalho e rota nunca ficam esperando)
    warmPlanetThumbs(s.planet);
  }

  /**
   * Viagem para o próximo planeta: o planeta vencido recebe o selo, o seu carro cruza o espaço até
   * o novo planeta, que cresce na tela, e o nome entra com impacto. Toque em qualquer lugar pula.
   */
  showPlanetWarp(w: PlanetWarp): void {
    const n = PLANETS.indexOf(w.to);
    const line = WARP_LINES[n % WARP_LINES.length].replace('{planet}', w.to.name).replace('{boss}', w.to.local);
    const nw = w.news;
    const carName = (id: string) => esc(this.vehicles[id]?.name ?? id);
    // quadro final: o que mudou no planeta novo (cada item entra em sequência, ver .wn-item)
    const items: string[] = [];
    if (nw) {
      for (const c of nw.newCars)
        items.push(`<div class="wn-item wn-car">${carImg(c.id, SHOWROOM_COLOR[c.id] ?? w.color, 120, 'transparent')}<div><small>CARRO NOVO</small><b>${carName(c.id)}</b><span>${esc(c.when)}</span></div></div>`);
      items.push(`<div class="wn-item"><div><small>PEÇAS NA LOJA</small><b>${nw.levelUp ? `Nível ${nw.shopLevel} liberado` : `Até o nível ${nw.shopLevel}`}</b><span>${nw.levelUp ? 'peças mais fortes à venda' : 'mesmo nível do planeta anterior'}</span></div></div>`);
      const rivals = nw.rivals
        .map((r) => `<div class="wn-rival">${carImg(r.vehicleId, r.color, 96, 'transparent')}<b>${esc(r.name)}</b><span>${carName(r.vehicleId)}</span></div>`)
        .join('');
      items.push(`<div class="wn-item wn-rivals"><small>RIVAIS</small><div>${rivals}</div></div>`);
      items.push(`<div class="wn-item"><div><small>1º LUGAR PAGA</small><b class="gold">${money(nw.firstPrize)}</b></div></div>`);
    }
    const news = items.length ? `<div class="warp-news">${items.map((h, i) => h.replace('class="wn-item', `style="--k:${i}" class="wn-item`)).join('')}</div>` : '';
    this.show(`
      <div class="warp${news ? ' has-news' : ''}">
        <div class="warp-stars"></div><div class="warp-stars far"></div>
        <div class="warp-stage">
          <div class="warp-streaks"></div>
          <div class="warp-to">${planetImg(w.to.theme, 440)}</div>
          <div class="warp-from">${planetImg(w.from.theme, 176)}<span class="warp-check">✓</span><small>${esc(w.from.name)}</small></div>
          <div class="warp-ship"><i class="warp-fire"></i>${carImg(w.vehicleId, w.color, 256, 'transparent')}</div>
        </div>
        <div class="warp-flash"></div>
        <div class="warp-title">
          <small>PLANETA ${n + 1} DE ${w.planets}</small>
          <h2>${esc(w.to.name.toUpperCase())}</h2>
          <p>Divisão B · Chefe local: <b>${esc(w.to.local)}</b></p>
        </div>
        ${news}
        <p class="warp-larry"><b>Loudmouth Larry:</b> “${esc(line)}”</p>
        <button class="go warp-go" data-act="warp-done">Continuar ${icon('arrowRight')}</button>
      </div>`);
    // ao sair da viagem a garagem do planeta novo já encontra as miniaturas prontas
    warmPlanetThumbs(n, false);
  }

  /**
   * Número da corrida em destaque (ex.: 2/6) com uma bolinha por corrida da divisão: feitas, a atual e
   * o duelo do chefe no fim da Divisão A. Nos duelos, o selo vira CHEFE / REPESCAGEM.
   */
  private raceBadge(s: CampaignState): string {
    const kind = raceKind(s);
    const cal = seasonSchedule(s);
    const dots = cal
      .map((r, i) => {
        let name = r.trackId;
        try {
          name = trackById(r.trackId).name;
        } catch {
          /* pista sem definição: mostra o id */
        }
        const cls = [r.done ? 'done' : '', r.current ? 'now' : '', r.boss ? 'boss' : ''].filter(Boolean).join(' ');
        return `<i class="${cls}" title="${i + 1}. ${esc(name)}${r.boss ? ' (chefe)' : ''}"></i>`;
      })
      .join('');
    const tries = kind === 'playoff' ? Array.from({ length: rulesOf(s).playoffTries }, (_, i) => `<i class="${i < (s.playoff ?? 0) ? 'now' : 'done'}"></i>`).join('') : '';
    const big =
      kind === 'playoff'
        ? `<b class="race-word">REPESCAGEM</b>`
        : kind === 'boss'
          ? `<b class="race-word">CHEFE <span>${s.race + 1}/${cal.length}</span></b>`
          : `<b class="race-num">${s.race + 1}<span>/${cal.length}</span></b>`;
    return `<div class="race-badge ${kind}"><small>${kind === 'playoff' ? 'TENTATIVAS' : 'CORRIDA'}</small>${big}<div class="race-dots">${kind === 'playoff' ? tries : dots}</div></div>`;
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
        return `<li style="${style}">${mark}${i + 1}. ${esc(name)}${r.boss ? ` · <b>chefe: ${esc(PLANETS[s.planet].local)}</b>` : ''}</li>`;
      })
      .join('');
    return `<details class="season-cal small-note"><summary>Calendário da divisão (${seasonSchedule(s).length} corridas)</summary><ol style="list-style:none;padding:0;margin:6px 0;columns:2;font-size:12px">${races}</ol></details>`;
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
      body = `<div class="shop-car"><div class="shop-car-img">${carImg(s.car.vehicleId, s.color, 320, 'card', true)}<b>${esc(d.spec.name)}</b></div><div class="shop-car-stats"><h4>Atributos atuais</h4>${vbase ? statBars(buildSpec(vbase, s.car), d.spec) : statBars(d.spec)}<p class="upg-legend"><i></i>prévia do ganho da próxima melhoria (em cada item abaixo)</p></div></div>` +
        UPGRADE_KINDS.map((k) => {
          const lvl = s.car.upgrades[k];
          if (!upgradeAvailable(s.car.vehicleId, k)) {
            return `<div class="shop-row na"><div class="upg-icon">${itemImg(k)}</div><div class="grow"><b>${upgradeLabel(s.car.vehicleId, k)}</b><small>Não se aplica a este carro (${s.car.vehicleId === 'havac' ? 'aerodeslizador' : 'esteiras'}).</small></div><span class="maxed">—</span></div>`;
          }
          const price = upgradePrice(s.car, k);
          const vid = s.car.vehicleId;
          // a loja só vende até o nível liberado neste planeta (acompanha os rivais)
          const lockedAt = price !== null && lvl >= shopLevel(s) ? planetForLevel(lvl + 1) : undefined;
          const next = upgradeName(vid, k, lvl + 1);
          return `<div class="shop-row"><div class="upg-icon">${itemImg(k)}</div><div class="grow"><b>${upgradeLabel(vid, k)}: ${upgradeName(vid, k, lvl)}</b> ${pips(lvl, MAX_UPGRADE)}<small>${upgradeHelp(vid, k)}${next ? ` · próximo: <b class="upg-next">${next}</b>` : ''}</small>${vbase ? upgradePreview(vbase, s.car, k) : ''}</div>
            ${price === null ? '<span class="maxed">MÁXIMO</span>' : lockedAt ? `<span class="maxed">${icon('lock')} CHEGA EM ${esc(lockedAt.name.toUpperCase())}</span>` : `<button class="buy" data-upgrade="${k}" ${price > s.money ? 'disabled' : ''}>${money(price)}</button>`}</div>`;
        }).join('') +
        this.paintRow(s);
    } else if (this.shopTab === 'weapons') {
      const baseCar = d.vehicles[s.car.vehicleId];
      body = CHARGE_KINDS.map((k) => {
        // (preço da campanha: acompanha o dinheiro do planeta e da dificuldade)
        const price = campaignChargePrice(s, k);
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
        `(30% do preço do carro${spent ? ` + 1/4 dos ${money(spent)} gastos em peças` : ''}; no máximo ${Math.round(TRADE_CAP * 100)}% do preço do carro novo). As peças e as cargas extras vão junto com ele: o carro novo sai de fábrica.</p>` +
        `<div class="shop-cars">${this.allCars
          .map((v) => {
            const mine = v.id === s.car.vehicleId;
            const forSale = carsForSale(s).includes(v.id);
            const net = carSwapCost(s.car, v.id);
            const netText = net > 0 ? `Você paga ${money(net)}` : net < 0 ? `Você recebe ${money(-net)}` : 'Troca sem custo';
            const action = mine
              ? '<span class="maxed">SEU CARRO</span>'
              : !forSale
                ? `<span class="maxed">${icon('lock')} ${carComingSoon(s, v.id) ? esc(carComingSoon(s, v.id).toUpperCase()) : 'NÃO VENDIDO NESTE PLANETA'}</span>`
                : `<button class="buy" data-buycar="${v.id}" data-buyinfo="${esc(`${netText}?`)}" ${net > s.money ? 'disabled' : ''}>${net > 0 ? money(net) : net < 0 ? `+${money(-net)}` : 'TROCAR'}</button>`;
            const priceLine = mine || !forSale ? `Preço: ${money(CAR_PRICES[v.id].price)}` : `Preço ${money(CAR_PRICES[v.id].price)} − revenda ${money(CAR_PRICES[v.id].price - net)} · ${netText}`;
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

  /** Pintura de campeão (gasto opcional do último planeta para o dinheiro que sobra). */
  private paintRow(s: CampaignState): string {
    const price = paintPrice(s);
    if (price === null && s.paint !== 'champion') return '';
    const swatch = `<div class="upg-icon" style="display:grid;place-items:center"><i style="display:block;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffd29a,#${CHAMPION_PAINT.color.toString(16).padStart(6, '0')} 55%,#6a1a00);box-shadow:0 0 12px #${CHAMPION_PAINT.color.toString(16).padStart(6, '0')}"></i></div>`;
    return `<div class="shop-row">${swatch}<div class="grow"><b>Pintura de campeão: laranja-brasa</b><small>Só aqui no último planeta: o carro corre com a cor que nenhum rival usa. Não muda o desempenho.</small></div>
      ${price === null ? '<span class="maxed">PINTADO</span>' : `<button class="buy" data-paint="1" ${price > s.money ? 'disabled' : ''}>${money(price)}</button>`}</div>`;
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
        <div class="shop-row"><div class="grow"><b>Economia de bateria</b><small>${a.batteryNow ? 'Ligada agora' : 'Desligada agora'}. ${a.batteryDetect === false ? 'Este navegador não informa a bateria: a Automática fica em até 60 quadros por segundo e liga a economia se o aparelho não der conta' : 'Automática liga fora da tomada'}: 30 quadros por segundo e menos resolução, sombras e fumaça.</small></div><button class="toggle ${a.battery === 'off' ? '' : 'on'}" data-battery="${a.battery}">${BATTERY_LABELS[a.battery].toUpperCase()}</button></div>
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
  /**
   * Tela do online. `code` fixa a sala (convite); `retryCode` reabre o campo de código já preenchido
   * (sala do link não encontrada: o jogador corrige o código ou volta ao menu).
   */
  showOnline(code = '', error = '', retryCode = ''): void {
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
               <h3>${retryCode ? 'Informe o código correto da sala' : 'Ou entre com um código'}</h3>
               <div class="join-row"><input class="room" maxlength="4" placeholder="ABCD" autocapitalize="characters" spellcheck="false" value="${esc(retryCode)}"/><button class="buy" data-act="online-join">Entrar</button></div>`
        }
        <p class="pw-msg online-msg"></p>
        <button data-act="main">${retryCode ? '← Menu inicial' : '← Voltar'}</button>
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
        ? `<li>${carImg(p.vehicleId, p.color, 96, 'transparent')}<div><b style="color:${esc(hex(p.color))}">${esc(p.name)}</b><small>${esc(this.vehicles[p.vehicleId]?.name ?? '')}${i === 0 ? ' · host' : ''}${p.me ? ' · você' : ''}${p.away ? ' · reconectando…' : ''}</small></div>${pingBadge(p.ping)}</li>`
        : `<li class="empty"><div><small>${v.host && this.fillCpu ? 'CPU' : 'vago'}</small></div></li>`;
    }).join('');
    const canShare = typeof navigator.share === 'function';
    this.show(`
      <div class="card">
        <h2>SALA ${esc(v.code)}</h2>
        <p class="small-note center">Mande o link para os amigos: quem abrir escolhe nome e carro e entra na sala.</p>
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

  /** Só o ping dos pilotos mudou: atualiza as bolinhas sem redesenhar a sala (lista aberta etc.). */
  updateLobbyPings(v: LobbyView): void {
    this.lastLobby = v;
    this.el.querySelectorAll<HTMLElement>('.rivals.lobby > li').forEach((li, i) => {
      const html = pingBadge(v.players[i]?.ping);
      const old = li.querySelector('.ping-badge');
      if (old) old.outerHTML = html;
      else if (html) li.insertAdjacentHTML('beforeend', html);
    });
  }

  /* ---------------- pausa e resultado ---------------- */

  /**
   * Pausa. `started`: a corrida já largou (na contagem sair não custa nada); `glLostNow`: o vídeo está
   * fora agora (sair não custa e reiniciar fica desabilitado: largaria às cegas). Se o vídeo voltou, a
   * corrida volta a valer. A regra é a mesma que decide a cobrança no jogo (campaignFlow.pauseView/leaveRace).
   */
  showPause(online = false, started = true, glLostNow = false): void {
    // campanha (fora do Fácil): sair ou reiniciar depois da largada conta como último lugar (e gasta o duelo)
    const st = this.inCampaign ? this.lastHub?.state : undefined;
    const view = pauseView({ campaign: st ?? null, online, started, videoLostNow: glLostNow });
    const costs = view.costs;
    const duel = costs && raceKind(st!) !== 'normal';
    const quitLabel = online
      ? 'Sair da sala'
      : costs
        ? 'Desistir (conta como último)'
        : this.inCampaign
          ? 'Sair da corrida (não conta)'
          : 'Sair da corrida';
    const freeNote =
      view.note === 'video'
        ? 'O vídeo caiu: sair agora não custa nada. Se ele voltar, a corrida volta a valer.'
        : view.note === 'not-started'
          ? 'A corrida ainda não largou: sair ou reiniciar agora não conta.'
          : !online && glLostNow
            ? 'Sem vídeo: reiniciar volta quando o vídeo voltar.'
            : '';
    this.show(`
      <div class="card small pause">
        <h2>${online ? 'MENU' : 'PAUSADO'}</h2>
        ${online ? '<p class="small-note center">No online a corrida não para.</p>' : ''}
        <button class="go" data-act="resume">Continuar</button>
        ${online ? '' : `<button data-act="restart"${costs ? ' data-forfeit="1"' : ''}${view.restartEnabled ? '' : ' disabled title="Aguardando o vídeo voltar"'}>${costs ? 'Desistir e ir para a próxima' : 'Reiniciar corrida'}</button>`}
        <button data-act="settings">${icon('gear')} Som e opções</button>
        ${this.fsButtonHtml()}
        <button class="quit" data-act="${online ? 'online-leave' : 'quit'}"${costs ? ' data-forfeit="1"' : ''}>${icon('eject')} ${quitLabel}</button>
        ${costs ? `<p class="small-note center">Desistir vale como último lugar: 0 pontos e sem o dinheiro da corrida${duel ? ', e gasta esta tentativa do duelo' : ''}. Não dá para repetir a corrida.</p>` : ''}
        ${freeNote ? `<p class="small-note center">${freeNote}</p>` : ''}
      </div>`);
  }

  /**
   * Final da campanha (item 58): palco escuro com holofotes, o troféu desce, o carro do jogador sobe no
   * pódio, fogos e confete, a rota dos planetas acende um a um, o título entra com impacto, fala do
   * Loudmouth Larry e os créditos rolam. Tudo em CSS (as capturas congelam as animações em tempos
   * fixos). Um toque pula para o resumo; no fim dos créditos o resumo entra sozinho. Com
   * `prefers-reduced-motion` fica o quadro final parado (sem fogos nem confete), à espera do toque.
   */
  showChampion(d: HubData): void {
    this.lastHub = d;
    const s = d.state;
    const count = planetCount(s);
    const diff = s.difficulty ?? 'normal';
    const light = isTouchDevice(); // celular: menos partículas
    const route = PLANETS.slice(0, count)
      .map((p, i) => `<div class="fin-pl" style="--i:${i}">${planetImg(p.theme, 64)}<small>${esc(p.name)}</small></div>`)
      .join('<i class="fin-link"></i>');
    // posições "aleatórias" fixas (as capturas saem iguais a cada rodada)
    const rnd = (i: number, k: number) => {
      const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const FW_COLORS = ['#ffd84a', '#ff5a3a', '#5ad8ff', '#b46bff', '#6bff8a', '#ffffff'];
    const fireworks = Array.from({ length: light ? 3 : 6 }, (_, i) => {
      const sparks = Array.from({ length: light ? 10 : 14 }, (_, k) => `<i style="--a:${Math.round((360 / (light ? 10 : 14)) * k)}deg"></i>`).join('');
      return `<div class="fw" style="--x:${Math.round(10 + rnd(i, 1) * 80)}%;--y:${Math.round(8 + rnd(i, 2) * 34)}%;--d:${(1 + i * 0.55).toFixed(2)}s;--c:${FW_COLORS[i % FW_COLORS.length]}">${sparks}</div>`;
    }).join('');
    const confetti = Array.from({ length: light ? 18 : 42 }, (_, i) =>
      `<i style="--x:${(rnd(i, 3) * 100).toFixed(1)}%;--d:${(0.8 + rnd(i, 4) * 4).toFixed(2)}s;--t:${(3.2 + rnd(i, 5) * 2.4).toFixed(2)}s;--r:${Math.round(rnd(i, 6) * 720 - 360)}deg;--c:${FW_COLORS[i % FW_COLORS.length]}"></i>`,
    ).join('');
    const bosses = PLANETS.slice(0, count).map((p) => p.local);
    // pódio: o chefe final (2º) e Rip e Shred (3º) com os carros do último planeta
    const last = PLANETS[count - 1];
    const credits = [
      ['CAMPEÃO DA GALÁXIA', esc(d.character.name)],
      ['CARRO', esc(d.vehicles[s.car.vehicleId]?.name ?? s.car.vehicleId)],
      ['DIFICULDADE', esc(DIFFICULTY_LABEL[diff])],
      ['CHEFES DERROTADOS', bosses.map(esc).join('<br>')],
      ['SEMPRE NA SUA COLA', 'Rip e Shred'],
      ['NARRAÇÃO', 'Loudmouth Larry'],
      ['CORRIDAS', `${s.stats.races} corridas · ${s.stats.wins} vitórias · ${s.stats.kills} abates`],
      ['HOMENAGEM', 'Rock n’ Roll Racing (1993)'],
      ['', 'Obrigado por jogar!'],
    ]
      .map(([h, v]) => `<div class="fin-cr">${h ? `<small>${h}</small>` : ''}<b>${v}</b></div>`)
      .join('');
    this.show(`
      <div class="finale" role="dialog" aria-label="Campeão da galáxia">
        <div class="fin-beams"><i></i><i></i></div>
        <div class="fin-fireworks">${fireworks}</div>
        <div class="fin-confetti">${confetti}</div>
        <div class="fin-title"><div class="fin-trophy">${trophySvg('fin')}</div><div><small>${esc(DIFFICULTY_LABEL[diff].toUpperCase())} · ${count} PLANETAS</small><h2>CAMPEÃO DA GALÁXIA!</h2></div></div>
        <div class="fin-stage">
          <div class="fin-podium p2">
            <div class="fin-car">${carImg(last.cars[2], RIVALS[last.local]?.color ?? 0x5a1f8a, 200, 'transparent')}</div>
            <div class="fin-block"><span>2</span><b>${esc(last.local)}</b></div>
          </div>
          <div class="fin-podium p1">
            <div class="fin-car">${carImg(s.car.vehicleId, s.color, 320, 'transparent')}</div>
            <div class="fin-block"><span>1</span><b>${portraitSvg(d.character.id, 40)}${esc(d.character.name)}</b></div>
          </div>
          <div class="fin-podium p3">
            <div class="fin-car duo">${carImg(last.cars[2], RIVALS.Rip.color, 200, 'transparent')}${carImg(last.cars[1], RIVALS.Shred.color, 200, 'transparent')}</div>
            <div class="fin-block"><span>3</span><b>Rip e Shred</b></div>
          </div>
        </div>
        <div class="fin-route">${route}</div>
        <p class="fin-larry"><b>Loudmouth Larry:</b> “${esc(d.character.name)} passou por ${esc(planetList(count))} e não sobrou ninguém de pé! Temos um novo campeão — e que venha o rock!”</p>
        <div class="fin-credits"><div class="fin-roll">${credits}</div></div>
        <p class="fin-hint">Toque para pular</p>
      </div>`);
    const roll = this.el.querySelector<HTMLElement>('.fin-roll');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // fim dos créditos: o resumo entra sozinho (parado de propósito com movimento reduzido)
    if (roll && !reduced) roll.addEventListener('animationend', () => {
      if (this.el.contains(roll)) this.showChampionSummary(d);
    });
  }

  /** Resumo do título: estatísticas, recompensa e o que fazer agora (garagem ou nova campanha mais difícil). */
  private showChampionSummary(d: HubData): void {
    this.lastHub = d;
    // o final foi visto (ou pulado): só agora sai do save
    this.actions.championSeen();
    const s = d.state;
    const st = s.stats;
    const winPct = st.races ? Math.round((st.wins / st.races) * 100) : 0;
    const diff = s.difficulty ?? 'normal';
    const next = DIFFICULTIES[Math.min(DIFFICULTIES.indexOf(diff) + 1, DIFFICULTIES.length - 1)];
    const stat = (label: string, value: string) => `<div><small>${label}</small><b>${value}</b></div>`;
    this.show(`
      <div class="card wide champion-card">
        <div class="champ-head">${trophySvg('sum')}<div><h2>CAMPEÃO DA GALÁXIA!</h2><small>${esc(DIFFICULTY_LABEL[diff])} · ${planetCount(s)} planetas</small></div></div>
        ${planetRoute(planetCount(s), true, planetCount(s))}
        <div class="me-row champ-me">${portraitSvg(d.character.id, 96)}<div class="champ-who"><b>${esc(d.character.name)}</b><small>de ${esc(d.character.homeworld)}</small><small>${esc(DIFFICULTY_LABEL[diff])}</small></div>${carImg(s.car.vehicleId, s.color, 160, 'transparent')}</div>
        <div class="hub-head">
          ${stat('CORRIDAS', String(st.races))}
          ${stat('VITÓRIAS', `${st.wins} (${winPct}%)`)}
          ${stat('ABATES', String(st.kills))}
          ${stat('GANHOS', money(st.earnings))}
        </div>
        <div class="notice promoted">Recompensa: troféu da galáxia e <b class="gold">${money(CHAMPION_BONUS)}</b> de prêmio, já somado ao seu saldo de <b>${money(s.money)}</b>. A garagem continua aberta: em ${esc(PLANETS[planetCount(s) - 1].name)} as corridas valem só dinheiro e diversão${moneyCapped(s) ? ' — com o bolso acima do que a loja vende, a pista e o 2º/3º rendem menos até você gastar (o 1º paga cheio)' : ''}.</div>
        <button class="go" data-act="champion-next" data-diff-next="${next}">${diff === next ? 'Nova campanha no' : 'Próximo desafio: campanha no'} ${esc(DIFFICULTY_LABEL[next])} ${icon('arrowRight')}</button>
        <div class="row-buttons">
          <button data-act="hub">Voltar à garagem</button>
          <button data-act="champion-replay">${icon('trophy')} Rever o final</button>
          <button data-act="main">Menu principal</button>
        </div>
      </div>`);
  }

  showResults(rows: ResultRow[], lapTimes: number[], report: CampaignReport | null, online: boolean | OnlineResults = false): void {
    const net = typeof online === 'object' ? online : null;
    const best = lapTimes.length ? Math.min(...lapTimes) : 0;
    const me = rows.find((r) => r.me);
    // venceu o duelo (chefe ou repescagem): o título é a vitória sobre o chefe; a promoção vira subtítulo
    const bossWin = !!report && report.kind !== 'normal' && (report.bonus > 0 || me?.place === 1);
    const title =
      report?.outcome === 'champion'
        ? 'CAMPEÃO!'
        : bossWin
          ? 'CHEFE DERROTADO!'
          : report?.outcome === 'promoted'
            ? 'PROMOVIDO!'
            : me && me.place === 1
              ? 'VITÓRIA!'
              : 'RESULTADO';
    const subtitle = report?.outcome === 'promoted' && bossWin ? `<p class="res-sub center" style="margin:-6px 0 8px;font-weight:700;letter-spacing:.08em;opacity:.85">PROMOVIDO</p>` : '';
    const tries = (n: number) => (n === 1 ? '<b>última chance</b>' : `restam <b>${n}</b> tentativas`);
    const campaignBlock = report
      ? `<div class="notice ${report.outcome}">
          ${report.bonus ? `<div>Você derrotou ${esc(report.boss)}! Bônus de chefe: <b class="gold">${money(report.bonus)}</b></div>` : ''}
          ${report.outcome === 'champion' ? `${planetRoute(report.planets, true, report.planets)}Você venceu a galáxia inteira! Lenda do rock.` : ''}
          ${report.outcome === 'promoted' ? `<div${report.bonus ? ' style="margin-top:6px"' : ''}>${planetImg(PLANETS.find((p) => report.label.startsWith(p.name))?.theme, 112, 'promo')}Promovido — subiu para: <b>${report.label}</b></div><span hidden>${planetImg(PLANETS.find((p) => report.label.startsWith(p.name))?.theme, 176)}</span>` : ''}
          ${report.outcome === 'retry' ? (report.kind === 'playoff' ? `${esc(report.boss)} venceu a repescagem. A divisão recomeça — melhore o carro na loja!` : `Não somou ${report.promote} pontos. A divisão recomeça — melhore o carro na loja!`) : ''}
          ${
            report.outcome !== 'playoff'
              ? ''
              : report.kind === 'playoff'
                ? `${esc(report.boss)} levou essa. Nova repescagem: ${tries(report.playoffLeft)}.`
                : report.kind === 'boss' && report.points >= report.promote
                  ? `${esc(report.boss)} venceu o duelo. Repescagem: vença-o para deixar o planeta (${tries(report.playoffLeft)}).`
                  : `Faltaram pontos (${report.points}/${report.promote}). Repescagem: vença ${esc(report.boss)} no duelo (${tries(report.playoffLeft)}).`
          }
          ${report.outcome === 'continue' ? `+${report.pointsEarned} pontos · total ${report.points}/${report.promote}` : ''}
          ${report.moneyCapped ? `<br>${CAPPED_SEAL}` : ''}
        </div>`
      : '';
    const podium = rows
      .slice()
      .sort((a, b) => a.place - b.place)
      .map(
        (r) => `<div class="res-row ${r.me ? 'me' : ''} p${r.place}"><span class="res-place">${r.place}º</span>${portraitSvg(r.pilot ?? r.name, 48)}
          <div class="res-name"><b style="color:${esc(r.color)}">${esc(r.name)}</b><small>${r.time !== null ? formatTime(r.time) : online && !net?.final ? 'correndo…' : '—'} · ${r.kills} abate(s)</small></div>
          ${r.vehicleId ? carImg(r.vehicleId, parseInt(r.color.slice(1), 16), 96, 'transparent') : ''}${online ? '' : `<span class="gold">${money(r.prize)}</span>`}</div>`,
      )
      .join('');
    this.show(`
      <div class="card results">
        <h2>${title}</h2>
        ${subtitle}
        ${campaignBlock}
        <div class="res-list">${podium}</div>
        ${lapTimes.length ? `<table>${lapTimes.map((t, i) => `<tr class="${t === best ? 'best' : ''}"><td>Volta ${i + 1}</td><td>${formatTime(t)}</td></tr>`).join('')}</table>` : ''}
        ${me && !online ? `<p class="money">Ganho nesta corrida (prêmio + pista): <b>${money(me.money)}</b></p>` : ''}
        ${net?.note ? `<div class="notice retry">${esc(net.note)}</div>` : ''}
        ${net && !net.final ? '<p class="small-note center">Placar parcial: atualiza conforme os pilotos cruzam a linha.</p>' : ''}
        ${
          online
            ? net?.gone
              ? '<button class="go" data-act="main">Menu principal</button>'
              : `<button class="go" data-act="online-lobby"${net?.confirm ? ' data-confirm="1"' : ''}>Voltar à sala</button>`
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
    // tela de corrida rápida na frente: o grid da escolha atual já vai sendo montado na fila ociosa
    if (this.el.querySelector('.quick')) this.actions.prewarmQuick?.(this.quick);
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
    // final da campanha: um toque pula para o resumo
    if ((e.target as HTMLElement).closest('.finale') && this.lastHub) {
      this.showChampionSummary(this.lastHub);
      return;
    }
    // viagem entre planetas: o 1º toque fora do botão adianta a animação para o fim; o 2º continua
    const warp = (e.target as HTMLElement).closest('.warp');
    if (warp && !(e.target as HTMLElement).closest('button')) {
      if (warp.classList.contains('skip')) this.actions.warpDone();
      else warp.classList.add('skip');
      return;
    }
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
      if (d.group === 'new') {
        this.newChar.difficulty = d.diff as Difficulty;
        // a rota mostra só os planetas da dificuldade escolhida (Fácil 3, Normal 5, Difícil 6)
        const route = this.el.querySelector('.new-route');
        if (route) route.innerHTML = planetRoute(0, false, CAMPAIGN_RULES[this.newChar.difficulty].planets);
      } else this.quick.difficulty = d.diff as Difficulty;
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
    if (d.battery) {
      const order: BatteryPref[] = ['auto', 'on', 'off'];
      this.actions.setBatterySaver(order[(order.indexOf(d.battery as BatteryPref) + 1) % order.length]);
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
      if (d.toggle === 'autothrottle') this.actions.setAutoThrottle(d.on !== '1');
      else this.actions.setAudio(d.toggle as 'music' | 'sfx' | 'announcer', d.on !== '1');
    }
    if (d.upgrade) this.actions.buyUpgrade(d.upgrade as UpgradeKind);
    if (d.charge) this.actions.buyCharge(d.charge as ChargeKind);
    if (d.paint) this.actions.buyPaint();
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
        if (d.forfeit && !this.confirmClick(t, 'Conta como último. Ir para a próxima?')) return;
        return this.actions.restart();
      case 'quit':
        if (d.forfeit && !this.confirmClick(t, 'Conta como último. Desistir?')) return;
        return this.actions.quit();
      case 'results-continue':
        return this.actions.resultsContinue();
      case 'warp-done':
        return this.actions.warpDone();
      case 'champion-replay':
        if (this.lastHub) this.showChampion(this.lastHub);
        return;
      case 'champion-next': {
        // nova campanha na próxima dificuldade, com o mesmo piloto e a mesma cor já escolhidos
        const st = this.lastHub?.state;
        if (st) this.newChar = { ...this.newChar, characterId: st.characterId, color: st.color, difficulty: (d.diffNext as Difficulty) ?? 'hard' };
        return this.showNewCampaign();
      }
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
        // host com gente ainda correndo: o segundo toque confirma (encerra a corrida para todos)
        if (d.confirm && !this.confirmClick(t, 'Ainda há pilotos correndo. Encerrar para todos?')) return;
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
