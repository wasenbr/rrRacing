import { AutoDegrade, batteryApiAvailable, DynamicResolution, ECO_AUTO_S, ECO_PARTICLES, ECO_RES, ECO_SHADOW_EVERY, loadDynScale, normalizeBatteryPref, resolveQuality, saveDynScale, watchBattery, type BatteryPref, type QualityPref, type QualitySettings } from '../render/quality';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Announcer, Commentary } from '../audio/announcer';
import { resumeAudio, setAudioLite, setSfxEnabled, suspendAudio, toggleMute, unlockAudio } from '../audio/context';
import { Music } from '../audio/music';
import { EngineSound, RivalEngines, warmEngineStep, type RivalEngineInput } from '../audio/engine';
import { sfxAssist, sfxBump, sfxBurn, sfxCountdown, sfxDrop, sfxExplosion, sfxFall, sfxFire, sfxHit, sfxLand, sfxLap, sfxPickup, sfxSkid, sfxWall, prepareSfx, finaleShow } from '../audio/sfx';
import { trackById, TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  advanceEarly, campaignChargePrice, coopOwner, coopView, CHAMPION_PAINT, paintPrice, moneyCapped, currentPlanet, markRaceStarted, planetNews, resolveAbandonedRace, moneyScale, planetCount, shopLevel, difficultyOf, currentTrackId, decodeSave, newCampaign, opponentsFor, PLANETS, playerSpec, prizesFor,
  type CampaignState,
} from '../sim/campaign';
import { afterLeave, behindNotice, campaignLabel, exportSave, leaveNotice, resolveLeave, sceneAfter, settleFinish, type AfterLeave, type SettledRace } from '../sim/campaignFlow';
import { buildSpec, carSwapCost, CHARACTERS, newCarSetup, upgradePrice } from '../sim/garage';
import { deleteSlot, listSlots, loadCampaign, loadFromSlot, loadPrefs, saveCampaign, savePrefs, saveToSlot, slotChangedElsewhere } from './storage';
import { canInstall, fullscreenSupported, initPwa, initViewport, isFullscreen, isInstalled, isIos, onFullscreenChange, onInstallChange, promptInstall, quitGame, toggleFullscreen } from '../ui/pwa';
import { splitAssignment } from '../input/gamepad';
import { Controls, createTouchControls, isTouchDevice, setTouchAutoThrottle, setTouchWeapons } from '../input/controls';
import { CAMERA_LABELS, CameraRig, type CameraMode } from '../render/cameras';
import { createCarMesh, prewarmCarMesh, type CarVisual } from '../render/cars';
import { Effects } from '../render/effects';
import { buildEnvironment, buildGround, buildSky, SUN_DIR } from '../render/environment';
import { contactShadow, setMaxAnisotropy } from '../render/textures';
import { freezeStatic, mergeStatic } from '../render/merge';
import { PostFx } from '../render/postfx';
import { RivalTag, setTagCanvasRect } from '../render/rivalTag';
import { ghostVisible, nextGhost } from '../render/ghost';
import { buildScenery, scenerySeed } from '../render/scenery';
import { levelTheme, THEMES } from '../render/themes';
import { buildTrackMesh } from '../render/trackMesh';
import { setRoadDetail } from '../render/trackStyle';
import { emptyInput, type ControlInput } from '../sim/input';
import { clamp, forwardX, forwardZ, leftX, leftZ, lerp, lerpAngle } from '../sim/math';
import { Track, type TrackDef } from '../sim/track';
import { CAR_SCALE, forwardSpeed, type VehicleSpec, type VehicleState } from '../sim/vehicle';
import { carContact, createWorld, PRIZES, stepDriver, stepWorld, type DriverState, type Difficulty, type Racer, type RacerEntry, type World, type WorldEvent } from '../sim/world';
import type { AiProfile } from '../sim/ai';
import { Hud, ICONS, formatTime, type HudCar, type HudData } from '../ui/hud';
import { icon } from '../ui/icons';
import { idleJob, idleJobsUrgent, setIdlePaused } from '../ui/idleQueue';
import { releaseThumbRenderer } from '../render/thumbnails';
import { COLORS, Menus, WEAPON_LABEL, type CampaignReport, type HubData, type LobbyView, type NewCampaignOptions, type OnlineOptions, type OnlineResults, type QuickOptions, type ResultRow, type SplitOptions } from '../ui/menus';
import { DROP_MS, NetClient, NetHost, netErrorText, normalizeCode } from '../net/peer';
import { applyProg, applySnapshot, decodeSnapMsg, encodeSnapMsg, isImportant, MAX_PLAYERS, parseHello, parseLobbyPlayers, parseProg, parseStart, pickColor, progEntry, progKey, takeSnapshot, validateSnap, cleanName, type ClientMsg, type HostMsg, type IdEvent, type LobbyPlayer, type OnlineRace, type ProgMsg, type SnapMsg, type WorldSnap } from '../net/sync';
import { CMDS_PER_MSG, InputQueue, parseInputMsg, TapCounter, type NetCmd } from '../net/inputs';
import { backoffMs, canCloseRace, cpuTakesOver, dupPlan, guestDropPlan, isToken, JitterBuffer, loadSession, LocalEcho, newToken, onlineMenuToggle, pingTone, REJOIN_MS, RejoinBook, saveSession, StallGuard } from '../net/session';
import { HiddenTicker } from '../net/ticker';

const DT = 1 / 60;
const COUNTDOWN = 3;
/** ?semlimite: sem a trava de 30 qps do nível baixo (medição comparativa) */
const NO_CAP30 = typeof location !== 'undefined' && new URLSearchParams(location.search).has('semlimite');
/** online: o host manda o estado a cada 3 passos (20x por segundo) */
const SNAP_EVERY = 3;
const SNAP_S = SNAP_EVERY * DT;
/** online: sem estado novo, o convidado segue os rivais pela velocidade até 2 estados (~100 ms) além do último */
const EXTRAP_PKTS = 2;
/**
 * Convidado: posição em que um rival aparece. `al` 0..1 interpola entre o estado anterior e o
 * último; acima de 1 (fila de estados vazia), segue do último pela velocidade.
 */
function shownPos(p: { x: number; y: number; z: number }, v: VehicleState, al: number): { x: number; y: number; z: number } {
  if (al <= 1) return { x: lerp(p.x, v.x, al), y: lerp(p.y, v.y, al), z: lerp(p.z, v.z, al) };
  const t = Math.min(al - 1, EXTRAP_PKTS) * SNAP_S;
  return { x: v.x + v.vx * t, y: v.y, z: v.z + v.vz * t };
}
/** online: fila máxima de estados guardados no convidado (aba oculta não acumula sem fim) */
const SNAP_QUEUE = 40;
/** online: sem comando do convidado por esse tempo, o host solta os controles do carro dele */
const INPUT_STALE_MS = 500;
/** online: a largada espera o "pronto" de todos no máximo esse tempo */
const READY_TIMEOUT_MS = 10000;
/** quem sai no meio da corrida vira CPU */
const LEFT_PLAYER_AI: AiProfile = { skill: 0.8, aggression: 0.7, lane: 0.5 };
/** ids de carro aceitos da rede (o primeiro é o padrão quando vem um inválido) */
/** online: comandos analógicos com 3 casas (pacote menor; a previsão usa o mesmo valor que o host) */
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const vehicleIds = (): string[] => ['marauder', ...Object.keys(VEHICLES).filter((k) => k !== 'marauder')];

/** Estado recebido do host, com a sequência, os comandos confirmados e a contagem. */
interface NetSnap {
  s: WorldSnap;
  k: number;
  a: number[];
  cd: number;
  /** eventos do estado anterior (usados se ele se perdeu) */
  pe: WorldEvent[];
  /** carros fora da tela / reconectando */
  aw: number[];
  dc: number[];
  /** eventos importantes com id (repetidos por ~1 s; o convidado deduplica) */
  ie: IdEvent[];
}

/** online: por quantos estados (~1 s) o host repete cada evento importante */
const IMPORTANT_RESEND = 20;
/** id desta aba (a mesma ficha de sessão em outra aba: o host recusa a nova se a antiga responde) */
const INSTANCE = newToken();

/** Guarda a ficha de sessão do convidado (voltar à mesma sala depois de cair ou recarregar). */
const sessionStore = (): Storage | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};
/** `hello`: a apresentação (nome, cor, carro) para entrar de novo sozinho depois de recarregar. */
function storeRejoin(code: string, token: string | null, hello?: ClientMsg | null): void {
  const h = hello?.t === 'hello' ? hello : null;
  saveSession(sessionStore(), token && h ? { code, token, name: h.name, color: h.color, vehicleId: h.vehicleId } : null);
  // sem ficha, o convite (?sala=) sai da barra: recarregar não reabre a sala
  if (!token && typeof location !== 'undefined' && new URLSearchParams(location.search).has('sala')) {
    const url = new URL(location.href);
    url.searchParams.delete('sala');
    history.replaceState(null, '', url);
  }
}
function storedRejoin(code: string): string | undefined {
  const s = loadSession(sessionStore());
  return s?.code === code ? s.token : undefined;
}

/** Sessão online (host ou convidado). */
interface Online {
  /** host: quando chegou o último comando de cada carro */
  inputAt: Record<number, number>;
  /** host: último `n` recebido de cada carro (volta no estado para a previsão do convidado) */
  ack: Record<number, number>;
  /** host: sequência do próximo estado */
  seq: number;
  /** host: convidados que ainda não mandaram "pronto" para a largada, e até quando esperar */
  waiting: Set<string>;
  readyUntil: number;
  /** convidado: já avisou o host que está pronto */
  sentReady: boolean;
  /** convidado: relógio de reprodução (em pacotes) e sequência do estado aplicado por último */
  playK: number;
  curK: number;
  /** convidado: comandos já enviados (para refazer a previsão do próprio carro) */
  history: { n: number; i: ControlInput }[];
  /**
   * convidado: estado mais novo do próprio carro vindo do host (com derrapagem/giro), ainda não usado
   * na previsão; `kick`: o host aplicou um empurrão (tiro, mina, óleo): sem suavizar a diferença
   */
  own: { d: DriverState; ack: number; kick: boolean } | null;
  /** convidado: carro previsto localmente e o erro visual que ainda está sendo desfeito */
  pred: DriverState | null;
  /** convidado: previsão limitada quando os estados do host param de chegar */
  stall: StallGuard;
  /** host: a CPU pilota o carro do host enquanto a aba dele está oculta */
  hostCpu: boolean;
  /** host: próximo id de evento importante e os recentes (vão repetidos); último progresso enviado */
  evId: number;
  important: { id: number; e: WorldEvent; k: number }[];
  progKeys: string[];
  /** convidado: eventos importantes já mostrados, primeiro id que vale e progressos à espera do estado */
  seenEv: Set<number>;
  evMin: number;
  progs: ProgMsg[];
  /** convidado: sequência e último comando confirmado do estado mais novo recebido (adianta os próprios tiros) */
  lastK: number;
  lastAck: number;
  /** convidado: irregularidade da chegada dos estados (folga de reprodução de 2 a 5 estados) */
  jitter: JitterBuffer;
  /** convidado: tiro/bomba/turbo já mostrados na hora do toque (o eco do host é engolido) */
  echo: LocalEcho;
  /** convidado: comando do passo anterior (bordas de subida do retorno local) */
  prevIn: ControlInput;
  /** convidado: quando chegou o último estado do host (aviso de conexão instável) */
  recvAt: number;
  /** convidado: último tiro/bomba mostrado localmente (mesma espera de 0,25 s da simulação) */
  fxCd: number;
  predErr: { x: number; y: number; z: number; h: number };
  role: 'host' | 'client';
  host: NetHost | null;
  client: NetClient | null;
  code: string;
  players: LobbyPlayer[];
  /** a corrida da sala está rolando */
  racing: boolean;
  /** host: carro de cada convidado na corrida atual */
  racerOf: Map<string, number>;
  /** host: últimos comandos de cada convidado */
  inputs: Record<number, ControlInput>;
  /** host: eventos acumulados desde o último envio */
  events: WorldEvent[];
  tick: number;
  /** convidado: estados recebidos ainda não aplicados */
  snaps: NetSnap[];
  lastSnapAt: number;
  /** a tela da sala está aberta */
  inLobby: boolean;
  /** menu aberto por cima da corrida (no online a corrida não pausa) */
  menuOpen: boolean;
  /** id deste jogador na lista da sala ('host' no host) */
  myId: string;
  /** host: fila de comandos de cada carro de convidado (aplicados na ordem, um por passo) */
  queues: Record<number, InputQueue>;
  /** host: fichas de sessão (quem cai volta para a mesma vaga e o mesmo carro) */
  seats: RejoinBook<LobbyPlayer>;
  /** aviso na etiqueta de cada carro ("fora da tela", "reconectando…") */
  notes: Map<number, string>;
  /** host: eventos do estado anterior (vão de novo no seguinte) */
  prevEvents: WorldEvent[];
  /** host: quando o primeiro humano cruzou a linha */
  firstFinishAt: number | null;
  /** host: a tela de resultados pedia confirmação para voltar à sala (redesenha quando muda) */
  lastConfirm: boolean;
  /** convidado: toques de tiro/bomba/turbo e os últimos comandos (vão juntos no pacote) */
  taps: TapCounter;
  cmds: NetCmd[];
  /** convidado: ficha de sessão e a apresentação (para reconectar) */
  token: string;
  hello: ClientMsg | null;
  reconnecting: boolean;
  /** a sala acabou (o host saiu) */
  gone: boolean;
  /** convidado: o host está com a aba oculta */
  hostAway: boolean;
  /** relógio da sala (ping, vagas vencidas) */
  timer: ReturnType<typeof setInterval> | null;
  ticks: number;
  /** convidado: primeiro estado da corrida atual (o canal rápido pode trazer um atrasado da anterior) */
  minK: number;
}

type Phase = 'menu' | 'countdown' | 'racing' | 'finished' | 'paused';

interface Snapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
}

const byDist = (p: { dist: number }, q: { dist: number }) => p.dist - q.dist;

/** Identidade da corrida montada (pista, grid e carros): igual = não precisa remontar. */
const raceKeyOf = (s: RaceSetup): string => JSON.stringify(s);

/** Junta geometrias e materiais de uma árvore (os que ainda estão em uso). */
function collectGpu(root: THREE.Object3D, into: Set<unknown>): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) into.add(m.geometry);
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) into.add(mat);
  });
}

/** Libera da GPU geometrias e materiais de uma árvore (menos os de `keep`); texturas ficam (cache). */
function disposeTree(root: THREE.Object3D, keep?: Set<unknown>): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !keep?.has(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) if (!keep?.has(mat)) mat.dispose();
  });
}

const snap = (v: VehicleState): Snapshot => ({ x: v.x, y: v.y, z: v.z, heading: v.heading, pitch: v.pitch, roll: v.roll });
/** Copia o estado para um retrato existente (sem alocar a cada passo). */
const snapInto = (s: Snapshot, v: VehicleState): void => {
  s.x = v.x;
  s.y = v.y;
  s.z = v.z;
  s.heading = v.heading;
  s.pitch = v.pitch;
  s.roll = v.roll;
};
const ZERO_POSE = { x: 0, y: 0, z: 0, heading: 0 } as const;
/** entrada neutra da contagem/menu online (nunca é alterada: a simulação só lê a do jogador) */
const IDLE_INPUT: ControlInput = Object.freeze(emptyInput());
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Tudo que define uma corrida antes da largada. */
interface RaceSetup {
  mode: 'quick' | 'campaign' | 'online';
  trackId: string;
  opponents: { name: string; color: number; spec: VehicleSpec; ai: AiProfile }[];
  playerName: string;
  playerColor: number;
  playerSpec: VehicleSpec;
  prizes: number[];
  difficulty: Difficulty;
  /** multiplicador do dinheiro da pista e dos abates (campanha) */
  moneyScale?: number;
  /** piloto do jogador (retrato nos resultados) */
  pilot: string;
  /** corrida online: grid montado pelo host e o carro deste jogador */
  online?: { race: OnlineRace; you: number };
  /** tela dividida: o jogador 2 e o controle (Gamepad.index) de cada um (p1 null = teclado) */
  second?: { name: string; color: number; spec: VehicleSpec; pilot: string; pads: { p1: number | null; p2: number } };
}

interface CarView {
  /** sombra de contato (mancha escura sob o carro, também no celular) */
  shadow: THREE.Mesh;
  visual: CarVisual;
  prev: Snapshot;
  /** nome, posição e blindagem flutuando sobre os rivais */
  label: RivalTag | null;
  smokeTimer: number;
  /** intervalo entre marcas de pneu/poeira */
  fxTimer: number;
  /** suspensão visual (só render): rolagem, arfagem e compressão da carroceria */
  susp: { roll: number; pitch: number; heave: number; heaveV: number; speed: number; air: number };
  /** carro que já cruzou a chegada: materiais originais trocados por cópias escuras */
  dark: Map<THREE.Mesh, THREE.Material | THREE.Material[]> | null;
  /** perseguição: 1 = rival visível, 0 = escondido (colado na câmera ou tapando o jogador) */
  ghost?: number;
}

/** Cópias escuras já feitas, por material original (reaproveitadas entre carros e chegadas). */
const darkCache = new Map<THREE.Material, THREE.Material>();

/**
 * Cópia escura de um material (carro que terminou a corrida, como no original). Só muda uniforms
 * (cor, emissivo, reflexo, rugosidade): os mesmos defines do original, então nenhum shader é
 * compilado no quadro da chegada (verniz 0 desligaria USE_CLEARCOAT e geraria outro programa).
 */
function darkMaterial(m: THREE.Material): THREE.Material {
  const hit = darkCache.get(m);
  if (hit) return hit;
  const d = m.clone() as THREE.MeshPhysicalMaterial;
  // cor em espaço linear: 0,05 fica ~25% do brilho na tela; meio acinzentado, quase sem verniz nem reflexo
  if (d.color) d.color.lerp(new THREE.Color(0x404040), 0.5).multiplyScalar(0.05);
  if (d.emissive) d.emissive.setScalar(0);
  // brilhos aditivos (chama, faróis, bocas de arma acesas) somem no carro escurecido
  if (d.blending === THREE.AdditiveBlending) d.visible = false;
  if ('envMapIntensity' in d) d.envMapIntensity *= 0.15;
  if ('clearcoat' in d && d.clearcoat > 0) d.clearcoat = 0.0001;
  if ('roughness' in d) d.roughness = Math.max(d.roughness, 0.7);
  darkCache.set(m, d);
  return d;
}

/** Descarta as cópias escuras cujos originais não estão em `keep` (fim da corrida, com os carros). */
function disposeDarkCache(keep: Set<unknown>): void {
  for (const [orig, d] of darkCache) {
    if (keep.has(orig)) continue;
    d.dispose();
    darkCache.delete(orig);
  }
}

/** Escurece (ou devolve as cores de) um carro. */
function setCarDark(view: CarView, dark: boolean): void {
  if (dark === !!view.dark) return;
  if (dark) {
    const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    view.visual.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      saved.set(mesh, mesh.material);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(darkMaterial) : darkMaterial(mesh.material);
    });
    view.dark = saved;
  } else {
    // as cópias escuras ficam no cache (descartadas em disposeDarkCache)
    for (const [mesh, orig] of view.dark!) mesh.material = orig;
    view.dark = null;
  }
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig = new CameraRig();
  private track!: Track;
  private world!: World;
  private setup!: RaceSetup;
  private campaign: CampaignState | null = null;
  private level: THREE.Group | null = null;
  private hemi: THREE.HemisphereLight;
  private resultsShown = false;
  private prefs = loadPrefs({ camera: 'iso' as CameraMode, music: true, sfx: true, announcer: true, musicVolume: 0.7, autoThrottle: false, quality: 'auto' as QualityPref, battery: 'auto' as BatteryPref | boolean });
  private music = new Music();
  /** tela de menu atual (para voltar depois das configurações de som) */
  private screen: 'main' | 'hub' = 'main';
  private playerId = 0;
  private views: CarView[] = [];
  private effects = new Effects();
  private sun: THREE.DirectionalLight;
  private hud: Hud;
  private menus: Menus;
  private controls = new Controls();
  private engine = new EngineSound();
  /** motores dos rivais mais próximos (2 vozes no celular, 3 no PC) */
  private rivalEngines = new RivalEngines(isTouchDevice() ? 2 : 3);
  private announcer = new Announcer();
  /** decide as falas do locutor a cada passo (nome + frase, como no original) */
  private commentary = new Commentary(this.announcer, (r) => (r.id === this.playerId ? this.setup.pilot : r.name));
  private phaseNow: Phase = 'menu';
  /** fase do jogo; trocar de fase acorda o laço de quadros (ver sleeping) */
  private get phase(): Phase {
    return this.phaseNow;
  }
  private set phase(p: Phase) {
    this.phaseNow = p;
    this.wake();
  }
  private phaseBeforePause: Phase = 'racing';
  private countdown = 0;
  /** intervalo mínimo entre sons de raspão na mureta */
  private wallSoundCd = 0;
  private prevAssistBtn = false;
  /** último rival que acertou o jogador (evita repetir o aviso a cada tiro de plasma) */
  private lastHitBy = -1;
  private readonly panVec = new THREE.Vector3();
  private accumulator = 0;
  private lastFrame = 0;
  /** tempo acumulado entre quadros desenhados nos menus/pausa */
  private idleDt = 0;
  private redrawNow = true;
  /** algo mudou na pausa (tamanho, câmera): redesenhar uma vez; pedir acorda o laço de quadros */
  private get redraw(): boolean {
    return this.redrawNow;
  }
  private set redraw(v: boolean) {
    this.redrawNow = v;
    if (v) this.wake();
  }
  private rafId = 0;
  /** a resolução atual é a dos menus (reduzida) */
  private menuRes = false;
  /** fila de miniaturas/retratos dos menus parada (corrida na tela) */
  private idlePaused = false;
  /** corrida limitada a 30 qps (nível baixo em aparelho lento) e média do tempo de quadro que decide */
  private cap30 = false;
  /** relógio da última atualização do mapa de sombras */
  private shadowAt = -Infinity;
  /** economia de bateria em uso (opção "Sempre", ou "Automática" fora da tomada): 30 qps, resolução
   * ×0,75, sombra a cada 3 quadros e metade das partículas */
  private onBattery = false;
  /** o aparelho está fora da tomada (navigator.getBattery; false quando não dá para saber) */
  private discharging = false;
  /** quadros desenhados (sombra a cada N quadros na economia) */
  private drawn = 0;
  /** período medido do rAF (mediana das últimas amostras), em segundos */
  private rafPeriod = 1 / 60;
  private readonly rafSamples = new Float64Array(31);
  private readonly rafSorted = new Float64Array(31);
  private rafCount = 0;
  /** menu: segue desenhando um pouco depois de um pedido de redesenho (câmera assenta) */
  private menuWake = 0;
  /** degraus que trocariam shaders (luzes dos clarões, sombra): aplicados na próxima largada */
  private pendingNoFlash = false;
  private pendingNoShadow = false;
  /** entradas reaproveitadas por passo (sem alocar) */
  /** tela dividida: carro do jogador 2 (-1 = fora dela) */
  private p2 = -1;
  /** câmera, HUD e motor do jogador 2 (criados na primeira corrida em tela dividida) */
  private readonly rig2 = new CameraRig();
  private hud2: Hud | null = null;
  private engine2: EngineSound | null = null;
  private shake2 = 0;
  private prevAssistBtn2 = false;
  private hudData2: HudData | null = null;
  private readonly playerPoseTmp2 = { x: 0, y: 0, z: 0, heading: 0 };
  private readonly soloInputs: Record<number, ControlInput> = {};
  private soloInputsId = -1;
  private readonly playerPoseTmp = { x: 0, y: 0, z: 0, heading: 0 };
  private readonly nearPool: RivalEngineInput[] = [];
  private readonly nearList: RivalEngineInput[] = [];
  /** queda automática (luzes dos clarões → bloom → sombra → partículas → 30 qps) */
  private readonly autoDeg = new AutoDegrade();
  /** degraus da queda automática já aplicados (lido pelas evidências) */
  get degrade(): number {
    return this.autoDeg.level;
  }
  /**
   * Eventos de desempenho com carimbo (performance.now, ms): resize, resolução dinâmica, queda
   * automática e preparo da largada — as evidências cruzam com os quadros lentos. Só nos eventos
   * (raros): nada é montado por quadro.
   */
  readonly perfEvents: { t: number; tipo: string; info: string }[] = [];
  private perfEvent(tipo: string, info: string): void {
    if (this.perfEvents.length >= 200) this.perfEvents.shift();
    this.perfEvents.push({ t: Math.round(performance.now()), tipo, info });
  }
  /** corridas desde o carregamento (a primeira retoma a escala salva da resolução dinâmica) */
  private races = 0;
  /** tamanho da tela (guardado no resize: ler clientWidth por quadro força layout) */
  private width = 1;
  private height = 1;
  /** tamanho e densidade aplicados ao renderizador (setSize só quando mudam) */
  private sizeW = 0;
  private sizeH = 0;
  private sizePr = 0;
  /** degrau "bloom desligado" da queda automática: próxima largada usa sombra PCF (mais barata) */
  private pendingPcf = false;
  /** getBattery existe (Chrome/Edge); sem ele a "Automática" decide pela folga do aparelho */
  private readonly batteryKnown = batteryApiAvailable();
  /** economia ligada pela "Automática" sem getBattery (resolução presa no piso por ECO_AUTO_S) */
  private ecoAuto = false;
  private floorTime = 0;
  /** laço de quadros dormindo (menu parado, pausa, resultados congelados): acorda em requestRedraw */
  private sleeping = false;
  private readonly frameCb = (t: number) => this.frame(t);
  /** medição opcional das subetapas de step()/render() (ligada pelas evidências: game.prof = {}) */
  prof: Record<string, { soma: number; maior: number; n: number }> | null = null;
  /** o contexto WebGL foi perdido (GPU reiniciada): não desenha até voltar */
  /**
   * (regra da campanha: só enquanto o vídeo está fora sair não custa; se ele voltou, a corrida volta a
   * valer — ver campaignFlow.leaveRace/pauseView)
   */
  private glLost = false;
  /** campanha: resultado já contado na chegada do jogador (a tela de resultados só mostra) */
  private settled: SettledRace | null = null;
  private glNotice: HTMLElement | null = null;
  private glReloadTimer = 0;
  /** chave da última corrida montada (toHub não remonta se nada mudou) */
  private raceKey = '';
  /** dados da HUD reaproveitados a cada quadro */
  private hudData: HudData | null = null;
  private shake = 0;
  private bounce = 0;
  private bounceVel = 0;
  private resultsTimer = 0;
  private readonly touch = isTouchDevice();
  private touchEl: HTMLElement | null = null;
  private readonly shadows: boolean;
  private readonly quality: QualitySettings;
  private readonly dynRes = new DynamicResolution();
  private postfx: PostFx | null = null;
  private animated: ((t: number) => void)[] = [];
  private sky: THREE.Mesh | null = null;
  private shadowGeo = new THREE.PlaneGeometry(2.6 * CAR_SCALE, 4.4 * CAR_SCALE).rotateX(-Math.PI / 2);
  private clock = 0;
  /** preparando a GPU para a largada (texturas e shaders): não simula nem desenha */
  private preparing = false;
  private prepToken = 0;
  /** cor do véu de poeira em alta velocidade (tom do piso do planeta) */
  private speedDust = 0xc8c4c0;
  /** vetores reaproveitados a cada quadro (menos lixo para o coletor de memória) */
  private readonly poseTmp = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private readonly hexCache = new Map<number, string>();
  /** o jogador saiu da tela cheia pelo botão: não forçar de novo */
  private leftFullscreen = false;
  private showcase: {
    group: THREE.Group;
    cam: THREE.PerspectiveCamera;
    center: THREE.Vector3;
    heading: number;
    /** luz do planeta guardada: a vitrine usa luz neutra e devolve a original ao sair */
    light: { sun: THREE.Color; sunI: number; hemi: THREE.Color; hemiG: THREE.Color; hemiI: number; fill: THREE.Color | null; fillI: number };
    /** cada carro e o seu lugar nas fileiras (lateral, frente) em relação ao centro da reta */
    cars: Map<string, { root: THREE.Object3D; lat: number; fwd: number; flames: THREE.Mesh[] }>;
    /** estúdio: mapa de reflexos neutro (o do planeta volta ao sair), luz de recorte, piso e vinheta */
    studio: { env: THREE.Texture; oldEnv: THREE.Texture | null; oldEnvI: number; rim: THREE.DirectionalLight; floor: THREE.Mesh; vignette: HTMLElement };
  } | null = null;
  private net: Online | null = null;
  /** resultados online: nota (host caiu etc.) e se o placar já é o final */
  private netResults: OnlineResults = {};
  /** carro rival na posição mostrada (colisão da previsão do convidado; reaproveitado) */
  /** host online com a aba oculta: a simulação segue fora do rAF */
  private hiddenTicker = new HiddenTicker(() => this.hiddenTick());
  private hiddenLast = 0;
  /** cancela uma conexão em andamento quando o jogador desiste */
  private netToken = 0;

  constructor(private root: HTMLElement) {
    this.quality = resolveQuality(this.prefs.quality, this.touch);
    // economia de bateria: escolha do jogador nas opções (getBattery não existe no Safari/Firefox)
    this.prefs.battery = normalizeBatteryPref(this.prefs.battery);
    this.onBattery = this.prefs.battery === 'on';
    // automática: liga/desliga sozinha ao tirar/pôr na tomada (a resposta chega depois de montar tudo)
    watchBattery((d) => {
      this.discharging = d;
      this.updateEco();
    });
    // áudio leve (reverb curto, sem oversampling, 1 rival) no toque e no nível baixo
    if (this.touch || this.quality.level === 'baixo') setAudioLite(true);
    this.shadows = this.quality.shadows;
    this.effects.setDensity(this.particleDensity());
    // GPU econômica (a integrada nos notebooks com duas placas) fora do nível alto e na economia
    const lowPower = this.quality.level !== 'alto' || this.onBattery;
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: lowPower ? 'low-power' : 'default' });
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = this.quality.level === 'alto' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    // teto de anisotropia pelo nível (o three limita cada textura por getMaxAnisotropy na hora do envio)
    const caps = this.renderer.capabilities;
    const maxAniso = Math.min(this.quality.anisotropy, caps.getMaxAnisotropy());
    caps.getMaxAnisotropy = () => maxAniso;
    setMaxAnisotropy(maxAniso);
    this.dynRes.min = this.quality.minScale;
    this.dynRes.scale = this.quality.startScale;
    setRoadDetail(this.quality.level === 'alto');
    root.appendChild(this.renderer.domElement);
    // GPU reiniciada (driver, aba em segundo plano no celular): pausa com aviso e refaz ao voltar
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.glLost = true;
      if (!this.net && (this.phase === 'racing' || this.phase === 'countdown')) this.togglePause();
      // já estava pausado: refaz o menu (sem cobrança e sem reiniciar às cegas)
      else this.refreshPause();
      this.showGlNotice(true);
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.glLost = false;
      if (this.track) {
        const oldEnv = this.scene.environment;
        this.scene.environment = buildEnvironment(this.renderer, levelTheme(THEMES[this.track.def.theme]));
        oldEnv?.dispose();
      }
      this.renderer.shadowMap.needsUpdate = true;
      this.redraw = true;
      this.lastFrame = 0;
      this.idleDt = 0;
      this.accumulator = 0;
      this.showGlNotice(false);
      // pausa aberta: o menu volta a oferecer reiniciar, e a corrida volta a valer (sair é desistência)
      this.refreshPause();
    });

    this.scene.environmentIntensity = 0.7;
    // ambiente baixo (visual alvo): quem ilumina é o sol quente e rasante; sombras bem escuras
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.35);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = this.shadows;
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    // o mapa de sombras é redesenhado no máximo ~40 vezes por segundo (ver render)
    this.renderer.shadowMap.autoUpdate = false;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -50;
    sc.right = sc.top = 50;
    sc.near = 1;
    sc.far = 220;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.effects.group);
    // bloom só na qualidade alta do PC: no celular e em placas simples pesa demais
    if (this.quality.bloom) this.postfx = new PostFx(this.renderer, this.scene);
    // nível baixo: sem as luzes pontuais dos clarões (o sprite aditivo da explosão continua); ficam
    // desligadas de vez para não recompilar shaders a cada explosão
    if (!this.quality.flashLights) this.effects.group.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) o.visible = false;
    });

    // vinheta escura nas bordas da tela (visual alvo): CSS puro, custo zero na GPU
    const vignette = document.createElement('div');
    vignette.className = 'vignette';
    root.appendChild(vignette);
    this.hud = new Hud(root);
    this.hud.setVisible(false);
    if (this.touch) this.touchEl = createTouchControls(root, this.controls);
    this.controls.autoThrottle = this.touch && this.prefs.autoThrottle;
    setTouchAutoThrottle(this.touchEl, this.controls.autoThrottle);
    this.rig.mode = this.rig2.mode = this.prefs.camera;
    this.menus = new Menus(root, this.menuActions(), VEHICLES, TRACKS);
    this.menus.setCameraChoice(this.prefs.camera);
    this.campaign = loadCampaign();
    initPwa();
    const appInfo = () =>
      this.menus.setApp({
        touch: this.touch,
        fullscreen: isFullscreen(),
        fullscreenSupported: fullscreenSupported(),
        canInstall: canInstall(),
        installed: isInstalled(),
        ios: isIos(),
      });
    appInfo();
    onInstallChange(appInfo);
    onFullscreenChange((on) => {
      appInfo();
      const b = this.touchEl?.querySelector('.fs-btn');
      if (b) b.innerHTML = icon(on ? 'exitFullscreen' : 'fullscreen');
      this.resize();
    });

    this.music.enabled = this.prefs.music;
    this.music.volume = this.prefs.musicVolume;
    setSfxEnabled(this.prefs.sfx);
    this.announcer.enabled = this.prefs.announcer;
    void this.music.init();
    this.music.onTrackChange = (name) => {
      if (this.phase === 'racing' || this.phase === 'countdown') this.hud.showToast(`♪ ${name}`);
    };

    this.controls.onUiAction((a) => {
      if (a === 'camera' && this.phase !== 'menu') this.setCamera(this.rig.cycle());
      if (a === 'camera2' && this.phase !== 'menu' && this.p2 >= 0) {
        this.hud2?.showToast(`🎥 ${CAMERA_LABELS[this.rig2.cycle()]}`);
        this.resize();
      }
      if (a === 'pause') this.togglePause();
      if (a === 'mute') this.hud.showToast(toggleMute() ? '🔇 Som desligado' : '🔊 Som ligado');
      if (a === 'fullscreen') void toggleFullscreen();
    });
    initViewport(root, () => this.resize());
    // primeiro toque ou tecla em qualquer lugar: cria o áudio já e manda para a fila ociosa o que
    // antes era gerado dentro do clique de "correr" (ciclos de queima do motor e dos rivais, ~450 ms,
    // e as camadas sintéticas dos efeitos)
    const warmAudio = (): void => {
      unlockAudio();
      // urgentes: a fila do menu tem centenas de miniaturas na frente e a largada chegaria antes
      idleJob('audio:sfx', () => prepareSfx(), true);
      for (let i = 3; i >= 0; i--) idleJob(`audio:motor${i}`, () => warmEngineStep(i), true);
    };
    window.addEventListener('pointerdown', warmAudio, { once: true, capture: true });
    window.addEventListener('keydown', warmAudio, { once: true, capture: true });
    // Ctrl é o tiro no PC: um Ctrl+W acidental pede confirmação em vez de fechar a corrida
    window.addEventListener('beforeunload', (e) => {
      // (também entre a chegada e os resultados: o resultado já está salvo, mas a tela ainda não apareceu)
      if (this.phase === 'racing' || this.phase === 'countdown' || (this.phase === 'finished' && !this.resultsShown && !this.net)) e.preventDefault();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (!this.net && (this.phase === 'racing' || this.phase === 'countdown')) this.togglePause();
        // aba oculta: o áudio para de verdade (libera CPU/bateria); volta ao reabrir
        void suspendAudio();
      } else {
        void resumeAudio();
        // sem um salto de tempo gigante no primeiro quadro de volta
        this.lastFrame = 0;
        this.idleDt = 0;
        this.accumulator = 0;
        this.redraw = true;
      }
    });

    // outra aba salvou o mesmo slot: a garagem recarrega o save mais novo; em corrida só avisa
    window.addEventListener('storage', (e) => this.onOtherTabSave(e.key));

    document.addEventListener('visibilitychange', () => this.onlineVisibility());
    window.addEventListener('beforeunload', (e) => this.onlineBeforeUnload(e));
    window.addEventListener('pagehide', () => this.onlinePageHide());

    // cenário de fundo do menu: a primeira pista, com os carros parados no grid
    this.setup = this.quickSetup({ trackId: TRACKS[0].id, vehicleId: 'marauder', color: 0x2f7bff, difficulty: 'normal' });
    this.createRace();
    this.resize();
    this.menus.showMain(!!this.campaign);
    // link de convite (?sala=ABCD): abre direto a tela para entrar na sala
    const room = normalizeCode(new URLSearchParams(location.search).get('sala') ?? '');
    // recarregou a aba numa sala (ficha guardada): entra de novo direto, com o mesmo nome e carro
    // (o host devolve a vaga e, se a corrida segue, o mesmo carro); o ?sala= fica enquanto a ficha valer
    const saved = loadSession(sessionStore());
    if (saved && (room.length !== 4 || room === saved.code)) {
      this.onlineJoin({ name: saved.name, color: saved.color, vehicleId: saved.vehicleId }, saved.code);
    } else if (new URLSearchParams(location.search).has('sala')) {
      // código válido abre a tela de entrar; código malformado já pede o código correto
      if (room.length === 4) this.menus.showOnline(room);
      else this.menus.showOnline('', 'O link da sala está incompleto ou inválido. Informe o código de 4 letras ou volte ao menu inicial.', room);
      const url = new URL(location.href);
      url.searchParams.delete('sala');
      history.replaceState(null, '', url);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private enterFullscreen(): void {
    void toggleFullscreen(true);
  }

  private get player(): Racer {
    return this.world.racers[this.playerId];
  }

  /* ------------------------------------------------------------------ */
  /* Pistas e temas                                                       */
  /* ------------------------------------------------------------------ */

  /** Monta a pista, o cenário e a iluminação do planeta. Reaproveita se já estiver carregada. */
  private loadTrack(def: TrackDef): void {
    if (this.track?.def.id === def.id) return;
    this.track = new Track(def);
    const theme = levelTheme(THEMES[def.theme]);
    if (this.level) {
      this.scene.remove(this.level);
      this.level.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
    }
    this.level = new THREE.Group();
    this.effects.clearSkids();
    const oldEnv = this.scene.environment;
    this.scene.environment = buildEnvironment(this.renderer, theme);
    oldEnv?.dispose();
    this.sky = buildSky(theme);
    this.level.add(this.sky);
    // névoa escura crescendo com a distância (só as câmeras em perspectiva chegam lá)
    this.scene.fog = new THREE.Fog(theme.fog, 130, 420);
    this.hemi.color.set(theme.ambientSky);
    this.hemi.groundColor.set(theme.ambientGround);
    // sol quente, baixo e lateral (SUN_DIR ~30°): compensa o ângulo com mais intensidade
    this.sun.color.set(theme.sun).lerp(new THREE.Color(0xffc488), 0.22);
    this.sun.intensity = theme.sunIntensity * 2.3;
    // luz de recorte vinda do lado oposto ao sol, na cor do planeta: destaca a silhueta dos carros
    let fill = this.scene.getObjectByName('fill') as THREE.DirectionalLight | undefined;
    if (!fill) {
      fill = new THREE.DirectionalLight(0xffffff, 1);
      fill.name = 'fill';
      this.scene.add(fill);
    }
    // (luz dramática por planeta: sol colorido e preenchimento contrastante, ambiente baixo)
    fill.position.set(-SUN_DIR.x, 0.6, -SUN_DIR.z);
    fill.color.set(theme.light.fill);
    fill.intensity = theme.light.fillIntensity;
    this.hemi.intensity = theme.light.hemi;
    const ground = buildGround(this.track, theme, this.shadows, this.quality.level !== 'alto');
    const scenery = buildScenery(this.track, theme, def.theme, this.shadows, scenerySeed(def.id), this.quality.dense);
    const trackMesh = buildTrackMesh(this.track, theme, this.shadows);
    // cenário: peças paradas juntas por material em blocos de ~50 m (menos chamadas de desenho,
    // sem perder o descarte do que está fora da tela); pista e chão não se mexem: matriz congelada
    const moving = mergeStatic(scenery.group, { probe: [() => scenery.update(1.3), () => scenery.update(2.9)], cell: 50 });
    freezeStatic(scenery.group, moving);
    freezeStatic(trackMesh);
    freezeStatic(ground.mesh);
    this.level.add(ground.mesh, trackMesh, scenery.group);
    this.animated = [ground.update, scenery.update];
    this.speedDust = new THREE.Color(theme.road).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    this.scene.add(this.level);
    this.hud.setTrack(this.track);
  }

  /* ------------------------------------------------------------------ */
  /* Montagem da corrida                                                  */
  /* ------------------------------------------------------------------ */

  /** Corrida rápida: rivais do planeta da pista, com carros do mesmo nível que o seu. */
  private quickSetup(o: QuickOptions): RaceSetup {
    const def = trackById(o.trackId);
    const pilot = CHARACTERS.find((ch) => ch.id === o.characterId)?.id ?? CHARACTERS[1].id;
    const s = newCampaign(pilot, o.color, o.difficulty);
    s.planet = Math.max(0, PLANETS.findIndex((p) => p.theme === def.theme));
    const car = newCarSetup(o.vehicleId);
    // o carro do jogador tem o mesmo nível de melhorias dos rivais daquele planeta
    const level = Math.min(3, Math.floor((s.planet * 2 + 1) / 3));
    car.upgrades = { engine: level, tires: level, shocks: level, armor: level };
    return {
      mode: 'quick',
      trackId: def.id,
      opponents: opponentsFor(s, VEHICLES, o.difficulty),
      playerName: 'Você',
      playerColor: o.color,
      playerSpec: buildSpec(VEHICLES[o.vehicleId], car),
      prizes: PRIZES,
      difficulty: o.difficulty,
      pilot,
    };
  }

  /** Tela dividida: corrida rápida com o jogador 2 no grid (mesmo nível de melhorias dos dois). */
  private splitSetup(o: SplitOptions): RaceSetup {
    const [a, b] = o.players;
    const setup = this.quickSetup({ trackId: o.trackId, characterId: a.characterId, vehicleId: a.vehicleId, color: a.color, difficulty: o.difficulty });
    const car = newCarSetup(b.vehicleId);
    // mesmo nível de melhorias do jogador 1 (ver quickSetup)
    const planet = Math.max(0, PLANETS.findIndex((p) => p.theme === trackById(o.trackId).theme));
    const level = Math.min(3, Math.floor((planet * 2 + 1) / 3));
    car.upgrades = { engine: level, tires: level, shocks: level, armor: level };
    const pads = splitAssignment(o.swap);
    return {
      ...setup,
      playerName: 'Jogador 1',
      second: {
        name: 'Jogador 2',
        color: b.color,
        spec: buildSpec(VEHICLES[b.vehicleId], car),
        pilot: b.characterId,
        pads: { p1: pads.p1?.index ?? null, p2: pads.p2?.index ?? -1 },
      },
    };
  }

  private campaignSetup(c: CampaignState): RaceSetup {
    const setup: RaceSetup = {
      mode: 'campaign',
      trackId: currentTrackId(c),
      opponents: opponentsFor(c, VEHICLES),
      playerName: c.coop ? 'Jogador 1' : 'Você',
      playerColor: c.color,
      playerSpec: playerSpec(c, VEHICLES),
      prizes: prizesFor(c),
      difficulty: difficultyOf(c),
      moneyScale: moneyScale(c),
      pilot: c.characterId,
    };
    // cooperativa: o jogador 2 no grid, com o carro dele, em tela dividida
    if (c.coop) {
      const pads = splitAssignment(false);
      setup.second = {
        name: 'Jogador 2',
        color: c.coop.color,
        spec: playerSpec(coopView(c, 1), VEHICLES),
        pilot: c.coop.characterId,
        pads: { p1: pads.p1?.index ?? null, p2: pads.p2?.index ?? -1 },
      };
    }
    return setup;
  }

  /** Monta o grid: os 3 rivais largam na frente, o jogador por último (como no original). */
  /**
   * Vitrine: os 5 carros parados na reta plana mais longa da pista atual (fora da largada), em duas
   * fileiras centradas e longe das muretas, com câmera em perspectiva orbitando no ângulo dado (rad).
   * Com `only`, mostra só aquele carro, mais de perto (captura 3/4 de cada modelo). Ao entrar, a pista
   * fica vazia: sem tiros, explosões, minas, poças nem prêmios (a corrida é remontada ao sair).
   * Usada pelo script de evidências para avaliar os modelos. `nitro` acende as chamas do turbo
   * (como com nitroTime > 0 na corrida).
   * Luz de estúdio: reflexos de uma sala neutra (RoomEnvironment), luz de recorte forte por trás dos
   * carros (em relação à câmera), piso escuro brilhante sob eles e vinheta nas bordas — só aqui.
   */
  showroom(angle: number, only?: string, nitro = false): void {
    if (!this.showcase) {
      // nada da corrida na vitrine: efeitos, projéteis, minas, poças e prêmios somem; o mundo não
      // anda no menu (sem IA nem armas) e é refeito na próxima largada (raceKey invalidada ao sair)
      this.effects.reset();
      this.world.projectiles.length = 0;
      this.world.hazards.length = 0;
      this.world.pickups.length = 0;
      const group = new THREE.Group();
      const track = this.track;
      // a reta plana mais longa (sem rampa, cruzamento, vão nem seta de warp)
      const P = track.pieces;
      const n = P.length;
      const flat = (q: (typeof P)[number]) => (q.code === 'S' || q.code === 'F') && q.turn === 0 && Math.abs(q.dh) < 1e-6 && !q.warp;
      let best = { len: 0, dist: P[0].startDist + P[0].length / 2 };
      for (let i = 0; i < n; i++) {
        if (!flat(P[i]) || flat(P[(i - 1 + n) % n])) continue;
        let len = 0;
        for (let k = 0; k < n && flat(P[(i + k) % n]); k++) len += P[(i + k) % n].length;
        // a largada (quadriculado) só se não houver outra reta
        if (len > best.len + (P[i].code === 'F' ? 20 : 0)) best = { len, dist: P[i].startDist + len / 2 };
      }
      const mid = track.pointAtDist(best.dist);
      const heading = mid.heading;
      const ids = Object.keys(VEHICLES);
      // o Air Blade no vermelho do alvo (referencias/modernizados/air-blade.png)
      const colors = [0xf2c318, 0x2f7bff, 0xd41c1c, 0x2fc840, 0xb040e0];
      // duas fileiras: 3 atrás e 2 à frente, nos vãos da de trás (a câmera alta vê por cima); o mais
      // largo tem ~2,5 m: sobra ~1 m entre vizinhos e da borda da pista (meia largura 5,5 m)
      const spots = [
        [1.8, 3.6],
        [3.3, -3.6],
        [0, -3.6],
        [-3.3, -3.6],
        [-1.8, 3.6],
      ];
      const cars = new Map<string, { root: THREE.Object3D; lat: number; fwd: number; flames: THREE.Mesh[] }>();
      ids.forEach((id, k) => {
        const car = createCarMesh(id, colors[k % colors.length], this.shadows);
        car.animate({ spin: 0.4, steer: 0, speed: 0, time: 0.4, grounded: true });
        const [lat, fwd] = spots[k % spots.length];
        cars.set(id, { root: car.root, lat: lat * CAR_SCALE, fwd: fwd * CAR_SCALE, flames: car.flames });
        car.root.rotation.y = heading;
        group.add(car.root);
      });
      const cam = new THREE.PerspectiveCamera(38, this.width / this.height, 0.1, 600);
      this.scene.add(group);
      const fill = this.scene.getObjectByName('fill') as THREE.DirectionalLight | undefined;
      const light = {
        sun: this.sun.color.clone(),
        sunI: this.sun.intensity,
        hemi: this.hemi.color.clone(),
        hemiG: this.hemi.groundColor.clone(),
        hemiI: this.hemi.intensity,
        fill: fill ? fill.color.clone() : null,
        fillI: fill?.intensity ?? 0,
      };
      // luz neutra (branca) para avaliar cor e forma dos modelos, sem a cor do planeta
      this.sun.color.set(0xffffff);
      this.sun.intensity = 3;
      this.hemi.color.set(0xffffff);
      this.hemi.groundColor.set(0x404040);
      // (ambiente baixo: quem modela o volume é o sol, o recorte e os reflexos — não luz chapada)
      this.hemi.intensity = 0.45;
      if (fill) {
        fill.color.set(0xffffff);
        fill.intensity = 0.5;
      }
      // estúdio: reflexos de sala neutra (pintura e metal deixam de ficar foscos)
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      const env = pmrem.fromScene(room, 0.04).texture;
      pmrem.dispose();
      room.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      const oldEnv = this.scene.environment;
      const oldEnvI = this.scene.environmentIntensity;
      this.scene.environment = env;
      this.scene.environmentIntensity = 1.1;
      // luz de recorte forte por trás dos carros (reposicionada a cada ângulo da câmera)
      const rim = new THREE.DirectionalLight(0xffffff, 4.5);
      group.add(rim, rim.target);
      // piso escuro e brilhante sob os carros, esmaecendo nas bordas (a pista some em volta)
      const fc = document.createElement('canvas');
      fc.width = fc.height = 256;
      const fg = fc.getContext('2d')!;
      const grd = fg.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, 'rgba(255,255,255,0.96)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.9)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      fg.fillStyle = grd;
      fg.fillRect(0, 0, 256, 256);
      const floorTex = new THREE.CanvasTexture(fc);
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x0a0b0e, map: floorTex, transparent: true, depthWrite: false, roughness: 0.28, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      floor.position.set(mid.x, mid.h + 0.02, mid.z);
      floor.receiveShadow = this.shadows;
      floor.renderOrder = -1;
      group.add(floor);
      // vinheta forte nas bordas da tela (só na vitrine)
      const vignette = document.createElement('div');
      vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.35) 75%, rgba(0,0,0,0.6) 100%)';
      this.renderer.domElement.parentElement?.appendChild(vignette);
      this.showcase = {
        group,
        cam,
        center: new THREE.Vector3(mid.x, mid.h, mid.z),
        heading,
        light,
        cars,
        studio: { env, oldEnv, oldEnvI, rim, floor, vignette },
      };
    }
    const sc = this.showcase;
    this.phase = 'menu';
    this.menus.hideAll();
    this.hud.setVisible(false);
    for (const v of this.views) {
      v.visual.root.visible = false;
      v.shadow.visible = false;
      if (v.label) v.label.sprite.visible = false;
    }
    // todos nas duas fileiras, ou só o carro pedido no meio da reta
    const solo = only && sc.cars.has(only) ? only : null;
    for (const [id, c] of sc.cars) {
      c.root.visible = !solo || id === solo;
      for (const f of c.flames) {
        f.visible = nitro;
        f.scale.setScalar(1.15);
      }
      const lat = solo ? 0 : c.lat;
      const fwd = solo ? 0 : c.fwd;
      c.root.position.set(
        sc.center.x + leftX(sc.heading) * lat + forwardX(sc.heading) * fwd,
        sc.center.y,
        sc.center.z + leftZ(sc.heading) * lat + forwardZ(sc.heading) * fwd,
      );
    }
    // ângulo 0 = de frente (câmera à frente dos carros); π = de trás. Câmera alta (~28°): a fileira
    // da frente não tapa a de trás; sozinho, o carro é visto de perto como nas imagens de referência
    const a = sc.heading + angle;
    const dist = solo ? 7.2 : 19;
    const up = solo ? 3.4 : 9.5;
    const look = sc.center.clone();
    if (solo) {
      // mira no meio do carro (o Air Blade é bem mais alto que o Havac)
      const box = new THREE.Box3().setFromObject(sc.cars.get(solo)!.root);
      look.y = (box.min.y + box.max.y) / 2;
    } else look.y += 0.6;
    sc.cam.position.set(sc.center.x + Math.sin(a) * dist, sc.center.y + up, sc.center.z + Math.cos(a) * dist);
    sc.cam.lookAt(look);
    sc.cam.aspect = this.width / this.height;
    sc.cam.updateProjectionMatrix();
    sc.cam.updateMatrixWorld();
    // recorte: do lado oposto à câmera, alto; piso do tamanho do grupo (ou de um carro)
    const st = sc.studio;
    st.rim.position.set(sc.center.x - Math.sin(a) * 20, sc.center.y + 11, sc.center.z - Math.cos(a) * 20);
    st.rim.target.position.copy(look);
    st.rim.target.updateMatrixWorld();
    st.floor.scale.setScalar(solo ? 5.5 : 13 * CAR_SCALE);
    this.sun.position.copy(sc.center).addScaledVector(SUN_DIR, 90);
    this.sun.target.position.copy(sc.center);
    this.sun.target.updateMatrixWorld();
    // desenha já com a câmera da vitrine (antes a captura podia sair antes do próximo quadro do
    // menu, a 5 qps, e a vista de trás repetia a da frente)
    this.renderer.shadowMap.needsUpdate = true;
    if (this.postfx) this.postfx.render(sc.cam);
    else this.renderer.render(this.scene, sc.cam);
    this.redraw = true;
  }

  private endShowroom(): void {
    if (!this.showcase) return;
    const l = this.showcase.light;
    this.sun.color.copy(l.sun);
    this.sun.intensity = l.sunI;
    this.hemi.color.copy(l.hemi);
    this.hemi.groundColor.copy(l.hemiG);
    this.hemi.intensity = l.hemiI;
    const fill = this.scene.getObjectByName('fill') as THREE.DirectionalLight | undefined;
    if (fill && l.fill) {
      fill.color.copy(l.fill);
      fill.intensity = l.fillI;
    }
    const st = this.showcase.studio;
    // devolve os reflexos do planeta (se o planeta não foi trocado enquanto isso)
    if (this.scene.environment === st.env) {
      this.scene.environment = st.oldEnv;
      this.scene.environmentIntensity = st.oldEnvI;
    }
    st.env.dispose();
    st.vignette.remove();
    this.scene.remove(this.showcase.group);
    disposeTree(this.showcase.group);
    this.showcase = null;
    // a vitrine esvaziou a pista (prêmios, poças): a próxima largada remonta a corrida
    this.raceKey = '';
  }

  private createRace(): void {
    this.endShowroom();
    // cena nova: o menu (que só desenha quando pedido) mostra o grid montado
    this.redraw = true;
    const setup = this.setup;
    this.raceKey = raceKeyOf(setup);
    this.loadTrack(trackById(setup.trackId));
    // projéteis, minas e poças da corrida anterior não passam para a próxima
    this.effects.reset();
    // nem os avisos de acerto/dinheiro
    this.hud.clearToasts();
    this.lastHitBy = -1;
    if (setup.online) {
      // online: o grid, as voltas e a semente vêm do host (iguais em todos os aparelhos)
      const race = setup.online.race;
      this.playerId = setup.online.you;
      this.world = createWorld(this.track, race.entries.map((e) => ({ ...e })), race.laps, race.seed, setup.prizes, setup.difficulty);
    } else {
      const used = new Set([setup.playerColor, ...(setup.second ? [setup.second.color] : [])]);
      const spare = [0xe02828, 0xf2c318, 0xb040e0, 0x2f7bff, 0xf0f0f0, 0x2fc840];
      const entries: RacerEntry[] = setup.opponents.map((o) => {
        let color = o.color;
        if (used.has(color)) color = spare.find((c) => !used.has(c)) ?? color;
        used.add(color);
        return { name: o.name, color, spec: o.spec, ai: o.ai };
      });
      // ?autopilot na URL: o carro do jogador é pilotado pela IA (demonstração/testes)
      const autopilot = new URLSearchParams(location.search).has('autopilot') ? { skill: 0.85, aggression: 0.8, lane: 0.5 } : null;
      // campanha cooperativa: a dupla é uma equipe (sem fogo amigo); na corrida rápida em tela dividida, rivais
      const team = setup.mode === 'campaign' && setup.second ? 1 : undefined;
      entries.push({ name: setup.playerName, color: setup.playerColor, spec: setup.playerSpec, ai: autopilot, team });
      this.playerId = entries.length - 1;
      const second = setup.second;
      if (second) entries.push({ name: second.name, color: second.color, spec: second.spec, ai: autopilot, team });
      // ?laps=N na URL muda o número de voltas (útil para testar)
      const laps = Number(new URLSearchParams(location.search).get('laps')) || this.track.def.laps;
      this.world = createWorld(this.track, entries, laps, (Date.now() & 0xffff) + 1, setup.prizes, setup.difficulty, setup.moneyScale);
    }

    this.setSplit(!setup.online && setup.second ? this.playerId + 1 : -1);
    const old = this.views;
    this.views = this.world.racers.map((r, i) => {
      const visual = createCarMesh(r.spec.id, r.color, this.shadows);
      this.scene.add(visual.root);
      const label = i !== this.playerId && i !== this.p2 ? new RivalTag(r.name, r.color) : null;
      if (label) this.scene.add(label.sprite);
      const shadow = new THREE.Mesh(
        this.shadowGeo,
        new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      );
      shadow.renderOrder = 1;
      this.scene.add(shadow);
      return { visual, prev: snap(r.car), label, smokeTimer: 0, fxTimer: 0, shadow, susp: { roll: 0, pitch: 0, heave: 0, heaveV: 0, speed: 0, air: 0 }, dark: null };
    });
    // carros antigos: libera geometrias e materiais da GPU, exceto os que os novos reaproveitam
    // (peças em cache); as texturas em cache (decalques, sombra de contato) ficam
    if (old.length) {
      const keep = new Set<unknown>();
      for (const v of this.views) collectGpu(v.visual.root, keep);
      for (const v of old) {
        this.scene.remove(v.shadow);
        this.scene.remove(v.visual.root);
        (v.shadow.material as THREE.Material).dispose();
        setCarDark(v, false);
        disposeTree(v.visual.root, keep);
        if (v.label) {
          this.scene.remove(v.label.sprite);
          v.label.dispose();
        }
      }
      disposeDarkCache(keep);
    }
    this.commentary.reset();
    this.setCamera(this.rig.mode, false);
    const sp = this.player.spec;
    const item = (id: string, fb: string) => ({ svg: ICONS[id] ?? ICONS[fb], label: WEAPON_LABEL[id] ?? fb });
    setTouchWeapons(this.touchEl ?? null, { fire: item(sp.front, 'laser'), drop: item(sp.rear, 'mine'), nitro: item(sp.assist, 'nitro') });
  }

  /**
   * Liga (id do carro do jogador 2) ou desliga (-1) a tela dividida: controles de cada jogador,
   * HUD do jogador 2 na metade direita e as entradas da prova.
   */
  private setSplit(p2: number): void {
    for (const k of Object.keys(this.soloInputs)) delete this.soloInputs[Number(k)];
    this.soloInputsId = -1;
    this.p2 = p2;
    this.shake2 = 0;
    this.prevAssistBtn2 = false;
    const on = p2 >= 0;
    this.controls.setSplit(on ? this.setup.second!.pads : null);
    this.hud.el.classList.toggle('split-a', on);
    if (on && !this.hud2) {
      // dentro da HUD do jogador 1: aparece e some junto com ela
      this.hud2 = new Hud(this.hud.el);
      this.hud2.el.classList.add('split-b');
    }
    // J1 / J2 no canto de baixo de cada metade
    for (const [hud, tag] of [[this.hud, 'J1'], [this.hud2, 'J2']] as const) {
      if (hud && !hud.el.querySelector(':scope > .rh-player')) hud.el.insertAdjacentHTML('beforeend', `<div class="rh-player">${tag}</div>`);
    }
    if (this.hud2) {
      this.hud2.setVisible(on);
      this.hud2.clearToasts();
      this.hud2.clearMessage();
      if (on) this.hud2.setTrack(this.track);
    }
    if (!on) this.engine2?.stop();
    this.rig2.snap();
  }

  /** Tela dividida desenhada agora (corrida em tela dividida fora do menu). */
  private get splitView(): boolean {
    return this.p2 >= 0 && this.phase !== 'menu' && !this.showcase;
  }

  /** Mensagem central nas HUDs de todos os jogadores (contagem, largada). */
  private messageAll(text: string, duration: number, cls: string): void {
    this.hud.message(text, duration, cls);
    if (this.p2 >= 0) this.hud2?.message(text, duration, cls);
  }

  /** O carro é de um jogador deste aparelho? */
  private isLocal(id: number): boolean {
    return id === this.playerId || (this.p2 >= 0 && id === this.p2);
  }

  /** HUD do jogador dono do carro (o jogador 1 para os demais). */
  private hudOf(id: number): Hud {
    return id === this.p2 && this.p2 >= 0 && this.hud2 ? this.hud2 : this.hud;
  }

  /** Tremor da câmera do jogador dono do carro. */
  private shakeOf(id: number, amount: number): void {
    if (id === this.p2 && this.p2 >= 0) this.shake2 = Math.max(this.shake2, amount);
    else this.shake = Math.max(this.shake, amount);
  }

  /** Todos os jogadores deste aparelho já cruzaram a chegada? */
  private localsFinished(): boolean {
    const r = this.world.racers;
    return !!r[this.playerId]?.finishPlace && (this.p2 < 0 || !!r[this.p2]?.finishPlace);
  }

  /**
   * Cópias escuras (carro que terminou) de todos os materiais dos carros, em malhas descartáveis
   * para o preparo da largada: cria as cópias e compila/sobe tudo antes do "3" (antes, a primeira
   * chegada clonava e preparava os materiais no meio da corrida).
   */
  private darkWarmupGroup(): THREE.Group {
    const g = new THREE.Group();
    const done = new Set<THREE.Material>();
    for (const v of this.views)
      v.visual.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (done.has(m)) continue;
          done.add(m);
          const d = darkMaterial(m);
          if (d.visible) g.add(new THREE.Mesh(mesh.geometry, d));
        }
      });
    return g;
  }

  /** `midRace`: convidado online voltando a uma corrida já largada (sem contagem nem bipe). */
  private startRace(midRace = false): void {
    // grid já montado no menu (fundo do menu principal, garagem da campanha ou pré-monte da fila
    // ociosa): não remonta — eram ~600 ms de modelos dos carros dentro do clique de "correr"
    if (this.raceKey !== raceKeyOf(this.setup) || this.world.started || this.showcase) this.createRace();
    // corrida nova sem vídeo: frame() a pausa (sair enquanto o vídeo está fora não cobra)
    this.settled = null;
    this.countdown = COUNTDOWN;
    this.phase = 'countdown';
    // a contagem só anda depois que a GPU tem tudo pronto (texturas e shaders); teto de 4 s
    const token = ++this.prepToken;
    this.preparing = true;
    const ready = () => {
      if (token === this.prepToken) this.preparing = false;
    };
    prepareSfx();
    this.announcer.prepare();
    // degraus da queda automática que trocam shaders entram agora (o warmup compila os novos)
    this.applyPendingDegrade();
    // resolução da corrida já no preparo: a primeira corrida retoma a escala em que a anterior
    // terminou (salva por nível) e a troca da resolução do menu para a da corrida (canvas e alvos do
    // bloom) acontece aqui, antes do desenho do preparo — antes ela ficava para o primeiro quadro e os
    // degraus da resolução dinâmica realocavam tudo logo depois da largada
    if (this.races++ === 0 && this.dynRes.enabled) {
      const saved = loadDynScale(this.quality.level);
      if (saved !== null) this.dynRes.restore(saved);
    }
    // os primeiros segundos de corrida ainda pagam upload de malhas e link de shaders: a resolução
    // dinâmica espera antes de julgar (senão descia dois degraus, com um engasgo por degrau, logo
    // depois da largada — e voltava a subir minutos depois)
    this.dynRes.hold(3);
    this.perfEvent('preparo', `escala ${this.dynRes.scale.toFixed(2)} degrau ${this.autoDeg.level} bloom ${this.postfx ? 1 : 0}`);
    this.menuRes = false;
    this.resize();
    // o preparo também desenha a sombra (compila os shaders dela antes da contagem)
    this.renderer.shadowMap.needsUpdate = true;
    // câmera encaixada no carro e HUD zerado já no primeiro quadro do preparo (antes, a tela
    // mostrava a câmera e os números da corrida anterior até a contagem andar)
    this.rig.snap();
    this.rig2.snap();
    // sem contexto WebGL não desenha nem compila (o teto de 4 s libera a contagem)
    if (!this.glLost) {
      this.render(1, 0, false, 0);
      // + os materiais escuros da chegada e, com bloom, as duas variantes (alvo e tela)
      this.effects
        .warmup(this.renderer, this.scene, this.rig.active, this.track.def.theme, { extra: this.darkWarmupGroup(), offscreen: !!this.postfx })
        .then(ready, ready);
    }
    setTimeout(ready, 4000);
    this.resultsTimer = 0;
    this.resultsShown = false;
    this.menus.hideAll();
    this.hud.setVisible(true);
    this.hud.setLap(1, this.world.laps);
    if (this.p2 >= 0) this.hud2?.setLap(1, this.world.laps);
    if (!midRace) {
      this.messageAll('3', 0, 'count');
      sfxCountdown(false);
    }
    this.music.play(this.track.def.theme, 'race');
  }

  private toMenu(): void {
    this.endShowroom();
    this.phase = 'menu';
    this.engine.stop();
    this.engine2?.stop();
    this.rivalEngines.stop();
    this.announcer.stop();
    this.hud.setVisible(false);
    this.screen = 'main';
    this.music.play(this.track.def.theme, 'menu');
    this.menus.showMain(!!this.campaign);
  }

  private togglePause(): void {
    if (this.net) {
      // online a corrida não para: só abre/fecha o menu por cima (com o placar na tela, nada)
      const act = onlineMenuToggle(this.phase, this.resultsShown, this.net.menuOpen);
      if (act === 'ignore') return;
      this.net.menuOpen = act === 'open';
      if (this.net.menuOpen) this.menus.showPause(true);
      // o placar chegou com o menu aberto (ou abre agora): volta para ele, não para a pista vazia
      else if (this.phase === 'finished' && this.resultsShown && this.setup.mode === 'online') this.refreshOnlineResults();
      else this.menus.hideAll();
      return;
    }
    if (this.phase === 'paused') {
      if (this.glLost) {
        // sem vídeo não dá para correr: explica em vez de ignorar o toque
        this.showGlNotice(true, 'Aguardando o vídeo voltar para continuar a corrida…');
        return;
      }
      this.phase = this.phaseBeforePause;
      this.menus.hideAll();
      unlockAudio();
      this.music.setMood('race');
      // sem o tempo parado da pausa no primeiro quadro (a simulação não "pula")
      this.idleDt = 0;
      this.accumulator = 0;
      this.lastFrame = 0;
    } else if (this.phase === 'racing' || this.phase === 'countdown') {
      this.phaseBeforePause = this.phase;
      this.phase = 'paused';
      this.engine.stop();
      this.engine2?.stop();
      this.rivalEngines.stop();
      this.announcer.stop();
      this.music.setMood('pause');
      this.showPauseMenu();
    }
  }

  /** Menu de pausa offline com a regra da corrida (largou, vídeo caiu nesta corrida, vídeo fora agora). */
  private showPauseMenu(): void {
    this.menus.showPause(false, this.world.started, this.glLost);
  }

  /** Pausa na tela (não as opções por cima dela): refaz o menu com o estado atual do vídeo. */
  private refreshPause(): void {
    if (this.phase === 'paused' && !this.net && !this.menus.isShowingSettings()) this.showPauseMenu();
  }

  private setCamera(mode: CameraMode, toast = true): void {
    this.rig.mode = mode;
    const view = this.views[this.playerId];
    if (view) {
      const cockpit = mode === 'cockpit';
      view.visual.cockpit.visible = cockpit;
      for (const c of view.visual.cabin) c.visible = !cockpit;
    }
    if (toast) this.hud.showToast(`🎥 ${CAMERA_LABELS[mode]}`);
    this.resize();
  }

  private resize(): void {
    const w = (this.width = Math.max(1, this.root.clientWidth));
    const h = (this.height = Math.max(1, this.root.clientHeight));
    this.hud.resize();
    // piso da resolução dinâmica (pixels de tela por pixel CSS): no alto 0,85 (antes 1,0: numa tela
    // de densidade 1 a escala descia sem mudar pixel nenhum e a resolução dinâmica não aliviava
    // nada); no médio do PC 0,6 e do toque 0,75; no baixo, sem piso no PC e 0,75 no toque com tela
    // densa (antes caía a 0,5 px CSS numa tela 3x: tudo borrado). Economia de bateria: teto ×0,75
    const dpr = window.devicePixelRatio || 1;
    const lvl = this.quality.level;
    const floor = lvl === 'baixo' ? (this.touch && dpr >= 2 ? 0.75 : 0) : Math.min(dpr, 1) * (lvl === 'alto' ? 0.85 : this.touch ? 0.75 : 0.6);
    const top = Math.min(dpr, this.quality.maxPixelRatio) * (this.onBattery ? ECO_RES : 1);
    // o mínimo da escala é o piso efetivo: abaixo dele cada degrau não mudaria a imagem (e a queda
    // automática esperava a escala chegar a um piso que não fazia efeito)
    this.dynRes.setMin(Math.max(this.quality.minScale, Math.min(1, floor / top)));
    const scale = this.phase === 'menu' ? Math.min(this.dynRes.scale, 0.75) : this.dynRes.scale;
    const pr = Math.max(floor, top * scale);
    this.redraw = true;
    // só recria o buffer da tela quando o tamanho ou a densidade mudam de fato (cada setSize é um
    // engasgo, principalmente no tablet e com o MSAA do bloom)
    if (pr !== this.sizePr || w !== this.sizeW || h !== this.sizeH) {
      this.sizePr = pr;
      this.sizeW = w;
      this.sizeH = h;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h);
      const fx = this.postfx?.setSize(w, h, pr) ?? false;
      this.perfEvent('resize', `${w}x${h}@${pr.toFixed(2)}${fx ? ' +bloom' : ''} ${this.phase}${this.preparing ? ':preparando' : ''}`);
      // retângulo do canvas para as etiquetas dos rivais (lido aqui, uma vez, não por rival no desenho)
      const rc = this.renderer.domElement.getBoundingClientRect();
      setTagCanvasRect(rc.left, rc.top, rc.width, rc.height);
    }
    // tela dividida: uma metade (lado a lado) para cada jogador, sem retrovisor
    const split = this.splitView;
    const half = Math.floor(w / 2);
    this.rig.resize(split ? half : w, h);
    if (split) this.rig2.resize(w - half, h);
    const mirror = this.mirrorRect();
    this.hud.setMirror(this.rig.mode === 'cockpit' && this.phase !== 'menu' && !split, mirror);
    this.rig.mirror.aspect = mirror.w / mirror.h;
    this.rig.mirror.updateProjectionMatrix();
  }

  private mirrorRect() {
    const w = this.width;
    const mw = Math.round(Math.min(360, w * 0.36));
    const mh = Math.round(mw * 0.26);
    return { x: Math.round((w - mw) / 2), y: 8, w: mw, h: mh };
  }

  /** Acorda o laço de quadros parado (pedido de redesenho ou troca de fase). */
  private wake(): void {
    if (!this.sleeping) return;
    this.sleeping = false;
    // sem salto de tempo no primeiro quadro depois de acordar
    this.lastFrame = 0;
    this.rafId = requestAnimationFrame(this.frameCb);
  }

  /** Imagem parada (menu assentado, pausa, resultados congelados): para de agendar quadros até wake(). */
  private sleep(): void {
    cancelAnimationFrame(this.rafId);
    this.sleeping = true;
  }

  private frame(now: number): void {
    this.rafId = requestAnimationFrame(this.frameCb);
    const raw = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    let frameDt = this.lastFrame ? Math.min(raw, 0.1) : DT;
    this.lastFrame = now;
    this.measureRaf(raw);
    // controles de toque só na corrida (largada e prova); menus, pausa e resultados ficam limpos
    if (this.touchEl) {
      const show = this.phase === 'countdown' || this.phase === 'racing';
      if (this.touchEl.classList.contains('off') === show) this.touchEl.classList.toggle('off', !show);
    }
    // menu principal: a cena de fundo fica parada atrás do painel (câmera fixa): desenha ao entrar e
    // quando pedido (ver menuWake); resultados: ~30 qps (a corrida segue atrás); pausa: imagem
    // congelada. Tudo em resolução reduzida
    // (a troca de resolução e a primeira pintura dos botões acontecem ainda no preparo da largada)
    const menuRes = this.phase === 'menu';
    if (menuRes !== this.menuRes) {
      this.menuRes = menuRes;
      this.resize();
    }
    // pré-geração de miniaturas e retratos só fora da corrida (no iPhone ela disputava CPU e GPU)
    const racingView = this.phase === 'countdown' || this.phase === 'racing' || (this.phase === 'finished' && !this.resultsShown);
    if (racingView !== this.idlePaused) {
      this.idlePaused = racingView;
      setIdlePaused(racingView);
      // na corrida o 2º contexto WebGL (miniaturas) fica sem uso: libera a memória de vídeo; as
      // imagens prontas seguem em cache e o renderizador é recriado na próxima miniatura pedida
      if (racingView) releaseThumbRenderer();
    }
    // sem vídeo, corrida offline (inclusive uma iniciada depois da perda) fica em pausa
    if (this.glLost && !this.net && (this.phase === 'racing' || this.phase === 'countdown')) this.togglePause();
    if (this.preparing && this.phase === 'countdown') return;
    // resultados por cima da corrida também contam como menu (cena de fundo a ~30 qps)
    const behindMenu = this.phase === 'paused' || (this.phase === 'finished' && this.resultsShown);
    const capped = this.cap30 || (this.onBattery && !NO_CAP30);
    this.idleDt += frameDt;
    if (this.phase === 'menu') {
      // menu/garagem/loja: um pedido de redesenho (entrar, trocar de pista, redimensionar) mantém
      // ~10 qps por 1,5 s para a câmera assentar; depois a imagem fica parada até o próximo pedido
      if (this.redraw) this.menuWake = 1.5;
      this.menuWake -= frameDt;
      // assentou: nem agenda mais quadros (antes o rAF seguia a cada vsync só para decidir não desenhar)
      if (!this.redraw && this.menuWake <= 0) return this.sleep();
      if (!this.redraw && this.idleDt < 0.1) return;
    } else if (this.phase === 'paused' || this.frozenResults()) {
      // pausa e resultados congelados: imagem parada, só redesenha quando pedido (redimensionar etc.)
      if (!this.redraw) return this.sleep();
    } else if (this.idleDt < this.minFrameDt(behindMenu || capped) && !this.redraw) return;
    // contagem com qps muito baixo: o tempo acima do teto de 0,1 s por quadro anda só o relógio da
    // contagem (sem física), senão os "3, 2, 1" viravam câmera lenta em aparelho muito lento
    if (this.phase === 'countdown' && !this.net && this.idleDt > 0.1) this.countdownSkip(Math.min(this.idleDt, 0.5) - 0.1);
    frameDt = Math.min(this.idleDt, 0.1);
    this.idleDt = 0;
    this.redraw = false;
    this.drawn++;
    // animações do cenário só nos quadros desenhados (antes rodavam a cada vsync, até no menu)
    this.clock += frameDt;
    for (const fn of this.animated) fn(this.clock);
    const workStart = performance.now();

    // fora do online, com os resultados na tela a prova congela (sem motores, locutor nem explosões
    // soando atrás dos resultados e da viagem entre planetas); online o host segue simulando
    const simulating = (this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'finished') && !this.frozenResults();
    if (simulating) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= DT && steps < 5) {
        this.step(DT);
        this.accumulator -= DT;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
    }
    // convidado online: interpola entre os dois estados do host em volta do relógio de reprodução
    const guest = this.isGuestRace();
    const sinceSnap = guest ? performance.now() - this.net!.lastSnapAt : 0;
    const alpha = !simulating ? 1 : guest ? this.guestAlpha(this.net!) : this.accumulator / DT;
    // sem contexto WebGL a simulação segue (resultados, host online), mas nada vai à GPU; o
    // webglcontextrestored pede um quadro novo
    if (this.glLost) return;
    this.render(alpha, frameDt, simulating, guest ? Math.min(sinceSnap / 1000, 0.1) : this.accumulator);
    // desempenho: mede só os quadros desenhados na corrida (depois do limitador). O custo é o maior
    // entre o trabalho do quadro (passos + desenho) e o intervalo desde o último quadro desenhado
    // (pega a GPU atrasada), os dois normalizados para o orçamento de 60 qps: a 30 qps travados,
    // 33 ms entre quadros é o normal, não lentidão
    const racingNow = (this.phase === 'racing' || this.phase === 'countdown' || this.phase === 'finished') && !this.resultsShown && !document.hidden;
    if (racingNow) {
      const work = (performance.now() - workStart) / 1000;
      const cost = Math.max(work, capped ? frameDt / 2 : frameDt);
      if (this.dynRes.update(frameDt, cost)) {
        this.perfEvent('dynRes', this.dynRes.scale.toFixed(2));
        // a próxima corrida (mesmo depois de recarregar) já começa nesta escala
        saveDynScale(this.quality.level, this.dynRes.scale);
        this.resize();
      }
      if (this.phase === 'racing') {
        this.autoDegrade(frameDt, cost);
        this.ecoWatch(frameDt);
      }
    }
  }

  /**
   * "Automática" sem getBattery (Safari, Firefox): não dá para saber se está na tomada. Se a
   * resolução dinâmica fica presa no piso por ECO_AUTO_S segundos de corrida, o aparelho não dá
   * conta: liga a economia (30 qps, menos resolução) até recarregar a página.
   */
  private ecoWatch(dt: number): void {
    if (this.batteryKnown || this.ecoAuto || this.prefs.battery !== 'auto') return;
    this.floorTime = this.dynRes.scale <= this.dynRes.min + 1e-3 ? this.floorTime + dt : 0;
    if (this.floorTime < ECO_AUTO_S) return;
    this.ecoAuto = true;
    this.updateEco();
  }

  /**
   * Período do rAF: mediana das últimas 31 amostras (ignora buracos de aba oculta e engasgos), refeita
   * a cada 31 quadros. Decide quantos vsyncs cabem por quadro desenhado (ver minFrameDt).
   */
  private measureRaf(raw: number): void {
    if (raw <= 0.002 || raw > 0.05) return;
    const n = this.rafSamples.length;
    this.rafSamples[this.rafCount++ % n] = raw;
    if (this.rafCount % n !== 0) return;
    this.rafSorted.set(this.rafSamples);
    this.rafSorted.sort();
    this.rafPeriod = this.rafSorted[n >> 1];
  }

  /**
   * Intervalo mínimo entre quadros desenhados, em vsyncs inteiros do período medido (meio período de
   * folga contra a oscilação do rAF). Sem trava: telas de até ~110 Hz desenham todo vsync (90/100 Hz
   * caíam para 45/50 qps com o piso fixo de 12,5 ms); acima disso (120/144/240 Hz), ~60–72 qps (o
   * dobro de GPU e bateria por quase nada de diferença). Travado (30 qps: economia, queda automática,
   * resultados): 2 vsyncs em 60 Hz, 3 em 90/100 Hz, 4 em 120 Hz, 5 em 144 Hz.
   * Economia "Automática" sem getBattery (não dá para saber se está na tomada): toda tela acima de
   * ~65 Hz também fica perto de 60 qps (45/50 em 90/100 Hz, 60 em 120 Hz, 72 em 144 Hz).
   */
  private minFrameDt(cap30: boolean): number {
    const period = this.rafPeriod;
    const fastScreen = !this.batteryKnown && this.prefs.battery === 'auto' ? 0.0155 : 0.009;
    const n = cap30 ? Math.max(1, Math.floor(1 / 30 / period + 0.4)) : period < fastScreen ? Math.max(2, Math.floor(1 / 60 / period + 0.4)) : 1;
    return n > 1 ? (n - 0.5) * period : 0;
  }

  /** Fração das partículas: nível, queda automática (metade) e economia de bateria (metade). */
  private particleDensity(): number {
    return this.quality.particles * (this.degrade > 3 && this.quality.particles > 0.4 ? 0.5 : 1) * (this.onBattery ? ECO_PARTICLES : 1);
  }

  /** Recalcula a economia de bateria (opção ou tomada) e aplica o que mudou, sem trocar shaders. */
  private updateEco(): void {
    const pref = this.prefs.battery;
    const on = pref === 'on' || (pref === 'auto' && (this.discharging || this.ecoAuto));
    if (on === this.onBattery) return;
    this.onBattery = on;
    this.effects.setDensity(this.particleDensity());
    this.resize();
    if (this.phase === 'racing' || this.phase === 'countdown') this.hud.showToast(on ? '🔋 Economia de bateria ligada' : '🔌 Economia de bateria desligada');
  }

  /**
   * Degraus da queda automática que mudam os shaders (luzes dos clarões, sombra do sol): no meio da
   * corrida só apagam (sem recompilar); aqui, antes do preparo da largada, saem de vez e o
   * warmup compila os programas novos antes da contagem.
   */
  private applyPendingDegrade(): void {
    if (this.pendingNoFlash) {
      this.pendingNoFlash = false;
      this.effects.group.traverse((o) => {
        if ((o as THREE.PointLight).isPointLight) o.visible = false;
      });
    }
    if (this.pendingNoShadow) {
      this.pendingNoShadow = false;
      this.sun.castShadow = false;
      this.sun.shadow.intensity = 1;
    }
    // sem bloom (queda automática no alto): a sombra suave (PCFSoft, várias amostras por pixel) vira PCF
    if (this.pendingPcf) {
      this.pendingPcf = false;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
  }

  /**
   * Queda automática de nível quando a resolução dinâmica já está no piso e o jogo ainda não segura
   * ~42 qps: primeiro as luzes dos clarões, depois o bloom (o maior custo do alto), depois a sombra,
   * depois metade das partículas e, por fim, a trava em 30 qps estáveis (sem engasgos, menos calor).
   * Vale até recarregar a página.
   * ?semlimite desliga (medição comparativa).
   */
  private autoDegrade(dt: number, cost: number): void {
    if (NO_CAP30 || this.cap30) return;
    const shots = this.autoDeg.update(dt, cost, this.dynRes.scale <= this.dynRes.min + 1e-3, {
      flashLights: this.quality.flashLights,
      bloom: !!this.postfx,
      shadow: this.sun.castShadow,
      particles: this.quality.particles > 0.4,
    });
    if (!shots) return;
    for (const a of shots) {
      this.perfEvent('degrade', `${this.autoDeg.level}:${a}`);
      // luzes dos clarões: tirá-las muda a chave dos shaders (recompilação no meio da corrida =
      // engasgo); saem na próxima largada, com warmup
      if (a === 'flash') this.pendingNoFlash = true;
      // bloom: desliga já e desenha direto na tela. As variantes de shader da tela foram compiladas
      // e desenhadas de verdade no preparo da largada (warmup): nada recompila. A sombra suave vira
      // PCF na próxima largada
      else if (a === 'bloom' && this.postfx) {
        this.postfx.dispose();
        this.postfx = null;
        if (this.renderer.shadowMap.type === THREE.PCFSoftShadowMap) this.pendingPcf = true;
      }
      // sombra: agora só some (intensidade 0, uniforme) e o mapa deixa de ser redesenhado (ver
      // render); castShadow=false (outro shader) fica para a próxima largada
      else if (a === 'shadow') {
        this.sun.shadow.intensity = 0;
        this.pendingNoShadow = true;
      } else if (a === 'particles') this.effects.setDensity(this.particleDensity());
      else if (a === 'cap30') this.cap30 = true;
    }
  }


  /** Resultados na tela fora do online: a prova para de simular e de soar (imagem parada atrás). */
  private frozenResults(): boolean {
    return this.resultsShown && this.phase === 'finished' && !this.net;
  }

  /**
   * Aviso de vídeo perdido. Sem o webglcontextrestored em ~5 s, oferece recarregar a página (a
   * campanha é salva antes). `why` troca o texto (ex.: tentou continuar a pausa sem vídeo).
   */
  private showGlNotice(on: boolean, why = ''): void {
    if (on && !this.glNotice) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed', left: '50%', top: 'max(12px, env(safe-area-inset-top))', transform: 'translateX(-50%)', zIndex: '60', padding: '12px 18px',
        background: 'rgba(0,0,0,0.88)', color: '#fff', font: '600 15px system-ui, sans-serif', borderRadius: '10px', pointerEvents: 'none',
        display: 'flex', alignItems: 'center', gap: '12px', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
      });
      const text = document.createElement('span');
      text.textContent = 'O vídeo foi reiniciado pelo aparelho — recuperando…';
      el.appendChild(text);
      this.root.appendChild(el);
      this.glNotice = el;
      this.glReloadTimer = window.setTimeout(() => {
        this.glReloadTimer = 0;
        if (!this.glLost || this.glNotice !== el) return;
        text.textContent = 'O vídeo não voltou sozinho.';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Recarregar';
        Object.assign(btn.style, {
          pointerEvents: 'auto', padding: '10px 16px', minHeight: '44px', font: '700 15px system-ui, sans-serif', borderRadius: '8px',
          border: '0', background: '#f2c318', color: '#111', cursor: 'pointer', flex: 'none',
        });
        btn.addEventListener('click', () => {
          try {
            // recarga pelo botão do vídeo perdido: a corrida não conta como desistência
            if (this.campaign) {
              delete this.campaign.raceInProgress;
              saveCampaign(this.campaign);
            }
          } catch {
            /* armazenamento indisponível: recarrega mesmo assim */
          }
          location.reload();
        });
        el.style.pointerEvents = 'auto';
        el.appendChild(btn);
      }, 5000);
    } else if (!on && this.glNotice) {
      clearTimeout(this.glReloadTimer);
      this.glReloadTimer = 0;
      this.glNotice.remove();
      this.glNotice = null;
    }
    if (on && why && this.glNotice) {
      const span = this.glNotice.firstElementChild as HTMLElement;
      span.textContent = why;
    }
  }

  /** Preenche os dados da HUD no mesmo objeto a cada quadro (sem lixo para o coletor). */
  private fillHud(r: Racer, speed: number, second = false): HudData {
    const pc = r.car;
    const sp = r.spec;
    const fresh = (): HudData => ({
      time: 0, best: null, speedKmh: 0, place: 1, total: 1, armor: 1, money: 0,
      front: { label: '', icon: '', n: 0, max: 0 }, rear: { label: '', icon: '', n: 0, max: 0 }, assist: { label: '', icon: '', n: 0, max: 0, active: false },
      cars: [], carCount: 0,
    });
    const d = second ? (this.hudData2 ??= fresh()) : (this.hudData ??= fresh());
    const world = this.world;
    d.time = world.raceTime;
    const laps = r.progress.lapTimes;
    let best = Infinity;
    for (let i = 0; i < laps.length; i++) if (laps[i] < best) best = laps[i];
    d.best = laps.length ? best : null;
    d.speedKmh = speed * 3.6;
    d.place = r.place;
    d.total = world.racers.length;
    d.armor = r.armor / sp.armor;
    d.money = r.money;
    d.front.label = WEAPON_LABEL[sp.front];
    d.front.icon = sp.front;
    d.front.n = r.frontCharges;
    d.front.max = sp.frontCharges;
    d.rear.label = WEAPON_LABEL[sp.rear];
    d.rear.icon = sp.rear;
    d.rear.n = r.rearCharges;
    d.rear.max = sp.rearCharges;
    d.assist.label = WEAPON_LABEL[sp.assist] ?? sp.assist;
    d.assist.icon = sp.assist;
    d.assist.n = pc.nitroCharges;
    d.assist.max = sp.nitroCharges;
    d.assist.active = sp.assist === 'jump' ? !pc.grounded && pc.vy > 0 : pc.nitroTime > 0;
    let n = 0;
    for (const o of world.racers) {
      if (!o.alive) continue;
      const c: HudCar = (d.cars[n] ??= { x: 0, z: 0, heading: 0, color: '', me: false });
      c.x = o.car.x;
      c.z = o.car.z;
      c.heading = o.car.heading;
      c.color = this.hexOf(o.color);
      c.me = o.id === r.id;
      n++;
    }
    d.carCount = n;
    return d;
  }

  private hexOf(c: number): string {
    let h = this.hexCache.get(c);
    if (!h) this.hexCache.set(c, (h = hex(c)));
    return h;
  }

  /** Este aparelho é convidado numa corrida online (só mostra o que o host simula). */
  /** Entradas da prova offline: um objeto só, reaproveitado a cada passo. */
  private soloInput(input: ControlInput): Record<number, ControlInput> {
    const inputs = this.soloInputs;
    if (this.soloInputsId !== this.playerId) {
      if (this.soloInputsId >= 0) delete inputs[this.soloInputsId];
      this.soloInputsId = this.playerId;
    }
    inputs[this.playerId] = input;
    return inputs;
  }

  private isGuestRace(): boolean {
    return this.net?.role === 'client' && this.setup.mode === 'online';
  }

  /** Soma o tempo desde `t0` na subetapa `k` (só com game.prof ligado) e devolve o relógio atual. */
  private lap(k: string, t0: number): number {
    const now = performance.now();
    const prof = this.prof;
    if (!prof) return now;
    const e = prof[k] ?? (prof[k] = { soma: 0, maior: 0, n: 0 });
    const d = now - t0;
    e.soma += d;
    e.n++;
    if (d > e.maior) e.maior = d;
    return now;
  }

  /** Adianta só o relógio da contagem (sem física), com os bipes e o número na tela. */
  private countdownSkip(extra: number): void {
    const shown = Math.ceil(this.countdown);
    // a passagem para "VAI!" (largada, locutor) fica para o step()
    this.countdown = Math.max(this.countdown - extra, Math.min(this.countdown, 0.01));
    if (Math.ceil(this.countdown) !== shown) {
      sfxCountdown(false);
      this.messageAll(String(Math.ceil(this.countdown)), 0, 'count');
    }
  }

  private step(dt: number): void {
    // subetapas medidas só quando as evidências ligam game.prof (sem custo no jogo normal)
    const pf = this.prof !== null;
    let t0 = pf ? performance.now() : 0;
    const guest = this.isGuestRace();
    if (!guest) for (let i = 0; i < this.views.length; i++) snapInto(this.views[i].prev, this.world.racers[i].car);
    let input: ControlInput = this.controls.read();
    if (this.net?.menuOpen) input = IDLE_INPUT;
    let input2: ControlInput | null = this.p2 >= 0 ? this.controls.readSecond() : null;
    const me2 = this.p2 >= 0 ? this.world.racers[this.p2] : null;
    if (input2 && me2 && input2.nitro && !this.prevAssistBtn2 && this.phase === 'racing' && me2.alive && me2.car.nitroCharges === 0)
      this.hud2?.showToast(me2.spec.assist === 'jump' ? 'Sem pulo — recarrega na próxima volta' : 'Sem turbo — recarrega na próxima volta');
    this.prevAssistBtn2 = !!input2?.nitro;
    // assistência sem carga: avisa (senão parece que o botão falhou)
    const me = this.world.racers[this.playerId];
    if (input.nitro && !this.prevAssistBtn && this.phase === 'racing' && me?.alive && me.car.nitroCharges === 0)
      this.hud.showToast(me.spec.assist === 'jump' ? 'Sem pulo — recarrega na próxima volta' : 'Sem turbo — recarrega na próxima volta');
    this.prevAssistBtn = input.nitro;
    if (this.phase === 'countdown') {
      const shown = Math.ceil(this.countdown);
      // host online: a contagem só anda quando todos os convidados avisaram que estão prontos
      if (!this.hostWaiting()) this.countdown -= dt;
      if (this.countdown > 0 && Math.ceil(this.countdown) !== shown) sfxCountdown(false);
      if (this.countdown <= 0) {
        sfxCountdown(true);
        this.phase = 'racing';
        this.world.started = true;
        // campanha: a corrida em andamento vai para o save (fechar ou recarregar agora conta como desistência)
        if (this.setup.mode === 'campaign' && this.campaign && markRaceStarted(this.campaign)) saveCampaign(this.campaign);
        this.messageAll('VAI!', 1, 'go');
        this.commentary.start();
      } else {
        this.messageAll(String(Math.ceil(this.countdown)), 0, 'count');
      }
      input = IDLE_INPUT;
      if (input2) input2 = IDLE_INPUT;
    }

    const net = this.net;
    if (guest && net) this.guestStep(net, input, dt);
    else {
      if (net?.host) this.hostInputs(net);
      if (pf) t0 = this.lap('step:entrada', t0);
      const solo = net ? null : this.soloInput(input);
      if (solo && input2) solo[this.p2] = input2;
      stepWorld(this.world, net ? { ...net.inputs, [this.playerId]: input } : solo!, dt);
      if (pf) t0 = this.lap('step:stepWorld', t0);
      if (net?.host) this.hostSend(net);
    }
    for (const e of this.world.events) this.onEvent(e);
    if (pf) t0 = this.lap('step:onEvent', t0);
    // faíscas onde os carros raspam/batem na mureta (todos os carros)
    for (const o of this.world.racers) {
      const c = o.car;
      if (!o.alive || c.wallImpact < 1.5) continue;
      const q = this.track.query(c.x, c.z, c.pieceIndex);
      const side = Math.sign(q.lateral) || 1;
      this.effects.sparks(c.x + leftX(q.heading) * side, c.y + 0.45, c.z + leftZ(q.heading) * side, Math.round(clamp(c.wallImpact * 2, 3, 26)));
    }

    const p = this.player;
    if (this.phase === 'racing' && p.progress.wrongWayTime > 1) this.hud.message('CONTRAMÃO!', 0.2, 'warn');
    if (me2 && (this.phase === 'racing' || this.phase === 'finished') && !me2.finishPlace && me2.progress.wrongWayTime > 1) this.hud2?.message('CONTRAMÃO!', 0.2, 'warn');

    // locutor: liderança, último lugar, blindagem baixa, rajadas, abates, contramão...
    // (com os resultados na tela o locutor fica calado, também no online, em que a prova segue rodando)
    if (pf) t0 = this.lap('step:faiscas', t0);
    if ((this.phase === 'racing' || this.phase === 'finished') && !this.resultsShown) this.commentary.update(this.world, this.playerId, dt);
    if (pf) t0 = this.lap('step:commentary', t0);

    if (this.phase === 'finished') {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) this.showResults();
    }

    // efeitos de impacto no carro do jogador
    const car = p.car;
    if (car.landingImpact > 4) sfxLand(clamp(car.landingImpact / 16, 0.3, 1));
    this.wallSoundCd -= dt;
    if (car.wallImpact > 4 && this.wallSoundCd <= 0) {
      sfxWall(clamp(car.wallImpact / 22, 0.3, 1));
      this.wallSoundCd = 0.25;
    }
    if (car.landingImpact > 2) {
      this.bounceVel -= car.landingImpact * 0.12;
      this.shake = Math.max(this.shake, clamp(car.landingImpact / 25, 0, 0.6));
    }
    if (car.wallImpact > 4) this.shake = Math.max(this.shake, clamp(car.wallImpact / 30, 0, 0.5));
    if (guest) car.landingImpact = car.wallImpact = 0; // já tratados: o próximo estado traz os novos
    if (me2) {
      // jogador 2: pouso e mureta com som e tremor na câmera dele
      const c2 = me2.car;
      if (c2.landingImpact > 4) sfxLand(clamp(c2.landingImpact / 16, 0.3, 1));
      if (c2.wallImpact > 4 && this.wallSoundCd <= 0) {
        sfxWall(clamp(c2.wallImpact / 22, 0.3, 1));
        this.wallSoundCd = 0.25;
      }
      if (c2.landingImpact > 2) this.shake2 = Math.max(this.shake2, clamp(c2.landingImpact / 25, 0, 0.6));
      if (c2.wallImpact > 4) this.shake2 = Math.max(this.shake2, clamp(c2.wallImpact / 30, 0, 0.5));
      this.shake2 *= Math.exp(-dt * 6);
    }
    this.bounceVel += (-this.bounce * 300 - this.bounceVel * 18) * dt;
    this.bounce += this.bounceVel * dt;
    this.shake *= Math.exp(-dt * 6);
    // resultados (showResults) + sons de pouso/mureta
    if (pf) this.lap('step:sfx', t0);
  }

  /** Volume de um som conforme a distância até o jogador. */
  private vol(x: number, z: number): number {
    const c = this.player.car;
    // tela dividida: vale o jogador mais perto do som
    const c2 = this.p2 >= 0 ? this.world.racers[this.p2]?.car : null;
    const d = Math.min(Math.hypot(x - c.x, z - c.z), c2 ? Math.hypot(x - c2.x, z - c2.z) : Infinity);
    // queda suave (quadrática): perto soa forte, longe some sem corte brusco
    const t = clamp(1 - d / 90, 0, 1);
    return t * t * 0.7 + t * 0.3;
  }

  /** Posição do som na tela, de -1 (esquerda) a +1 (direita), para o pan estéreo. */
  private pan(x: number, z: number): number {
    // tela dividida: duas câmeras, sem um lado certo para o som
    if (this.p2 >= 0) return 0;
    // lado pelo vetor "direita" da câmera (project() inverte o x de fontes atrás da câmera)
    const cam = this.rig.active;
    const right = this.panVec.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const c = this.player.car;
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return 0;
    const side = (dx * right.x + dz * right.z) / (d * Math.max(1e-6, Math.hypot(right.x, right.z)));
    // perto do carro o som fica mais ao centro
    return clamp(side * 0.8 * Math.min(1, d / 12), -0.8, 0.8);
  }

  private onEvent(e: WorldEvent): void {
    const racers = this.world.racers;
    const me = this.playerId;
    // convidado online: tiro/bomba/turbo próprios já soaram na hora do toque (ver guestFeedback)
    if (this.net && this.isGuestRace() && (e.type === 'fire' || e.type === 'drop' || e.type === 'assist') && e.racer === me) {
      if (this.net.echo.echo(e.type === 'fire' ? 0 : e.type === 'drop' ? 1 : 2, performance.now())) return;
    }
    // tela dividida: cada aviso vai para a HUD (e a câmera) do jogador dono do carro
    const local = (id: number) => this.isLocal(id);
    const name = (id: number) => (id === me && this.p2 < 0 ? 'Você' : racers[id].name);
    switch (e.type) {
      case 'fire':
        sfxFire(e.kind, this.vol(e.x, e.z), this.pan(e.x, e.z));
        this.effects.muzzle(e.kind, e.x, e.y, e.z);
        break;
      case 'drop': {
        const c = racers[e.racer].car;
        sfxDrop(this.vol(c.x, c.z), e.kind, this.pan(c.x, c.z));
        break;
      }
      case 'hit':
        if (e.kind === 'laser' || e.kind === 'sundog') {
          this.effects.zap(e.kind, e.x, e.y, e.z);
          this.effects.sparks(e.x, e.y, e.z, 8);
          sfxHit(this.vol(e.x, e.z), this.pan(e.x, e.z));
        } else {
          this.effects.explosion(e.x, e.y - 0.8, e.z, false);
          sfxExplosion(this.vol(e.x, e.z), false, this.pan(e.x, e.z));
        }
        if (local(e.target)) {
          this.shakeOf(e.target, e.kind === 'laser' ? 0.25 : 0.7);
          // quem acertou (o plasma é frequente: só avisa das armas fortes ou de quem ainda não tinha acertado)
          const by = e.by >= 0 && e.by !== e.target ? this.world.racers[e.by] : null;
          if (by && (e.kind !== 'laser' || this.lastHitBy !== e.by)) this.hudOf(e.target).showToast(`💥 ${by.name} te acertou (${WEAPON_LABEL[e.kind] ?? e.kind})`);
          this.lastHitBy = e.by;
        }
        break;
      case 'impact':
        this.effects.sparks(e.x, e.y, e.z, e.kind === 'missile' ? 14 : 6);
        if (e.kind !== 'missile') this.effects.zap(e.kind, e.x, e.y, e.z);
        if (e.kind === 'missile') {
          this.effects.explosion(e.x, e.y - 0.8, e.z, false);
          sfxExplosion(this.vol(e.x, e.z) * 0.7, false, this.pan(e.x, e.z));
        }
        break;
      case 'spin':
        if (local(e.racer)) {
          this.hudOf(e.racer).showToast('Óleo! 🌀');
          sfxSkid(1);
        } else {
          const sc = racers[e.racer].car;
          sfxSkid(this.vol(sc.x, sc.z) * 0.6, this.pan(sc.x, sc.z));
        }
        break;
      case 'explode': {
        this.effects.explosion(e.x, e.y, e.z, true, racers[e.racer].color);
        sfxExplosion(local(e.racer) ? 1 : this.vol(e.x, e.z), true, this.pan(e.x, e.z));
        if (local(e.racer)) {
          this.shakeOf(e.racer, 1.2);
          this.hudOf(e.racer).message('DESTRUÍDO!', 2, 'warn');
        }
        if (local(e.by) && e.by !== e.racer) {
          this.hudOf(e.by).showToast(`💥 Você destruiu ${racers[e.racer].name}! +$${e.bounty.toLocaleString('pt-BR')}`);
        } else if (!local(e.racer)) {
          this.hud.showToast(`💥 ${name(e.racer)} explodiu!`);
        }
        break;
      }
      case 'pickup':
        if (local(e.racer)) {
          sfxPickup(e.kind);
          this.hudOf(e.racer).showToast(e.kind === 'money' ? '+ $1.000' : '+ Blindagem');
        }
        break;
      case 'bump':
        if (local(e.a) || local(e.b)) {
          const mine = local(e.a) ? e.a : e.b;
          const other = racers[mine === e.a ? e.b : e.a].car;
          sfxBump(clamp(e.strength / 15, 0, 1), this.pan(other.x, other.z));
          for (const id of [e.a, e.b]) if (local(id)) this.shakeOf(id, clamp(e.strength / 40, 0, 0.3));
        }
        break;
      case 'lap':
        if (local(e.racer)) {
          const laps = this.world.laps;
          const hud = this.hudOf(e.racer);
          hud.setLap(e.lap, laps);
          const times = racers[e.racer].progress.lapTimes;
          hud.message(e.lap === laps ? 'VOLTA FINAL!' : `VOLTA ${e.lap}`, 0.8, 'lap');
          hud.showToast(`Volta: ${formatTime(times[times.length - 1])} · armas recarregadas`);
          sfxLap(e.lap === laps);
        }
        break;
      case 'finish':
        if (local(e.racer)) {
          this.hudOf(e.racer).message(e.place === 1 ? 'VITÓRIA!' : `${e.place}º LUGAR`, this.p2 >= 0 ? 0 : 3, 'go');
          // tela dividida: os resultados esperam os dois jogadores cruzarem a chegada
          if (this.localsFinished()) {
            this.phase = 'finished';
            this.resultsTimer = 3;
            this.settleCampaignFinish();
          }
        }
        break;
      case 'burn':
        if (local(e.racer)) sfxBurn(0.8);
        break;
      case 'lapped':
        if (local(e.racer)) sfxPickup('money');
        if (local(e.racer)) this.hudOf(e.racer).showToast(`Você abriu uma volta sobre ${racers[e.victim].name}! +$${e.bonus.toLocaleString('pt-BR')} se vencer`);
        if (local(e.victim)) this.hudOf(e.victim).showToast(`${racers[e.racer].name} abriu uma volta sobre você!`);
        break;
      case 'assist': {
        const ac = racers[e.racer].car;
        if (e.kind === 'jump') this.effects.jumpJet(ac.x, ac.y, ac.z);
        else this.effects.nitroBurst(ac.x - Math.sin(ac.heading) * 2, ac.y, ac.z - Math.cos(ac.heading) * 2);
        sfxAssist(e.kind, local(e.racer) ? 1 : this.vol(ac.x, ac.z) * 0.7, this.pan(ac.x, ac.z));
        break;
      }
      case 'fall':
        this.effects.fall(e.x, THEMES[this.track.def.theme].groundLevel, e.z, THEMES[this.track.def.theme].groundStyle);
        sfxFall(local(e.racer) ? 1 : this.vol(e.x, e.z) * 0.6, this.pan(e.x, e.z));
        if (local(e.racer)) this.hudOf(e.racer).message('CAIU!', 1.2, 'warn');
        break;
      case 'respawn':
        break;
    }
  }

  private showResults(): void {
    if (this.resultsShown) return;
    this.resultsShown = true;
    // online: o placar toma o lugar do menu aberto por cima (senão o "Continuar" o esconderia)
    if (this.net) this.net.menuOpen = false;
    // motores e locutor calam já, com ou sem rede (no online a prova segue rodando atrás, mas muda)
    this.engine.stop();
    this.engine2?.stop();
    this.rivalEngines.stop();
    this.announcer.stop();
    // a prova congela atrás dos resultados (ver frame)
    if (this.frozenResults()) this.redraw = true;
    const order = [...this.world.racers].sort((a, b) => a.place - b.place);
    const rows: ResultRow[] = order.map((r) => ({
      place: r.place,
      name: r.id === this.playerId ? this.setup.playerName : r.name,
      color: hex(r.color),
      time: r.finishPlace ? r.progress.finishTime : null,
      kills: r.kills,
      prize: this.world.prizes[r.place - 1] ?? 0,
      money: r.money,
      me: this.isLocal(r.id),
      pilot: r.id === this.playerId ? this.setup.pilot : r.id === this.p2 && this.setup.second ? this.setup.second.pilot : r.name,
      vehicleId: r.spec.id,
    }));
    let report: CampaignReport | null = null;
    if (this.setup.mode === 'campaign' && this.campaign) {
      // o resultado já foi contado e salvo na chegada (settleCampaignFinish); aqui só é mostrado
      const done = this.settled ?? this.settleCampaignFinish();
      // dinheiro e abates do jogador: os creditados na chegada (não o que mudou depois dela)
      const mine = rows[order.findIndex((r) => r.id === this.playerId)];
      const second = this.p2 >= 0 ? rows[order.findIndex((r) => r.id === this.p2)] : undefined;
      if (done && mine) {
        mine.money = done.money;
        if (!second) mine.kills = done.kills;
      }
      if (done && second) second.money = done.coopMoney;
      if (done) {
        const res = done.report;
        report = {
          outcome: res.outcome,
          kind: res.kind,
          pointsEarned: res.pointsEarned,
          points: this.campaign.points,
          promote: done.promote,
          label: this.campaignLabel(),
          boss: done.boss,
          bonus: res.bonus,
          playoffLeft: res.playoffLeft,
          planets: planetCount(this.campaign),
          moneyCapped: moneyCapped(this.campaign),
        };
      }
    }
    this.hud.clearMessage();
    this.music.setMood('menu');
    this.menus.showResults(rows, this.player.progress.lapTimes, report, this.setup.mode === 'online' ? this.onlineResultsInfo() : false);
  }

  /* ------------------------------------------------------------------ */
  /* Campanha, garagem e loja                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Campanha: o jogador cruzou a chegada. O resultado vale na hora e vai para o save (recarregar ou
   * fechar antes da tela de resultados não conta mais como último); a tela só mostra o relatório.
   */
  private settleCampaignFinish(): SettledRace | null {
    const c = this.campaign;
    if (this.setup.mode !== 'campaign' || !c || this.settled) return this.settled;
    const p = this.player;
    // cooperativa: vale a melhor colocação da dupla; cada um leva o próprio dinheiro
    const p2 = c.coop && this.p2 >= 0 ? this.world.racers[this.p2] : null;
    const place = Math.min(p.finishPlace || p.place, p2 ? p2.finishPlace || p2.place : Infinity);
    this.settled = settleFinish(c, place, p.money, p.kills + (p2?.kills ?? 0), p2?.money ?? 0);
    const scene = sceneAfter(c, this.settled.fromPlanet, this.settled.report);
    // subiu de planeta: o "Continuar" dos resultados mostra a viagem até o novo planeta
    this.warpFrom = scene === 'warp' ? this.settled.fromPlanet : -1;
    this.championPending = scene === 'champion';
    saveCampaign(c);
    return this.settled;
  }

  private campaignLabel(): string {
    return campaignLabel(this.campaign!);
  }

  /** Dados da garagem/loja vistos por um jogador (cooperativa: 1 = jogador 2). */
  private hubData(player = 0): HubData {
    const c = this.campaign!;
    const v = coopView(c, player);
    const second = c.coop ? coopView(c, 1) : null;
    return {
      state: v,
      planet: currentPlanet(c),
      track: new Track(trackById(currentTrackId(c))),
      opponents: opponentsFor(c, VEHICLES),
      spec: playerSpec(v, VEHICLES),
      character: CHARACTERS.find((ch) => ch.id === v.characterId) ?? CHARACTERS[0],
      vehicles: VEHICLES,
      coop: second
        ? {
            player: c.coop ? player : 0,
            state: second,
            spec: playerSpec(second, VEHICLES),
            character: CHARACTERS.find((ch) => ch.id === second.characterId) ?? CHARACTERS[0],
            padReady: !!splitAssignment(false).p2,
          }
        : undefined,
    };
  }

  /** Mostra a garagem com a próxima pista já montada ao fundo. */
  /** a última corrida deu o título: o "Continuar" dos resultados abre a tela de campeão */
  private championPending = false;
  /** planeta de onde o jogador acabou de sair (-1: sem viagem pendente) */
  private warpFrom = -1;

  /** Animação de viagem para o novo planeta (com a música dele já tocando). */
  private showPlanetWarp(): void {
    const c = this.campaign!;
    const from = PLANETS[this.warpFrom >= 0 ? this.warpFrom : (c.warpFrom ?? Math.max(0, c.planet - 1))];
    this.warpFrom = -1;
    // (a viagem só sai do save no fim da cena, em warpDone: fechar no meio dela a mostra de novo)
    this.phase = 'menu';
    this.engine.stop();
    this.engine2?.stop();
    this.rivalEngines.stop();
    this.hud.setVisible(false);
    this.menus.showPlanetWarp({ from, to: currentPlanet(c), planets: planetCount(c), vehicleId: c.car.vehicleId, color: c.color, news: planetNews(c, VEHICLES) });
    this.music.play(currentPlanet(c).theme, 'menu');
    this.announcer.say('holyToledo', null, 3);
  }

  /**
   * Final da campanha (item 58): a sequência de campeão sobre a garagem, com a música de vitória, e
   * depois o resumo (a campanha continua dali ou começa outra na próxima dificuldade).
   */
  private showChampion(): void {
    // (o final só sai do save quando termina ou é pulado: championSeen)
    this.toHub();
    // hino da vitória: a faixa do menu/abertura (ou a trilha do menu) no volume cheio, com os fogos
    this.music.playAnthem();
    this.menus.showChampion(this.hubData());
    this.announcer.say('finishFirst', this.setup.pilot ?? null, 3);
    // fogos de verdade (assobio, estouro grave, crepitar) em ~10 salvas + multidão; o locutor grita
    // "Holy Toledo!" no meio da queima. Sair da tela do final cala tudo.
    const show = finaleShow();
    for (const [s, run] of show.cues) {
      window.setTimeout(() => {
        if (document.querySelector('.finale')) run();
      }, 900 + s * 1000);
    }
    window.setTimeout(() => {
      if (document.querySelector('.finale')) this.announcer.say('holyToledo', null, 3);
    }, 4200);
    const watch = window.setInterval(() => {
      if (document.querySelector('.finale')) return;
      window.clearInterval(watch);
      show.stop();
    }, 300);
    window.setTimeout(() => window.clearInterval(watch), 20000);
  }

  /**
   * Cena pendente no save (recarregou na tela de resultados): mostra antes da garagem. Antes, uma
   * corrida abandonada (o jogo foi fechado ou recarregado no meio dela) conta como desistência; o aviso
   * vai para a garagem (depois da viagem, se ela subiu de planeta).
   */
  private showPendingScene(extra = ''): boolean {
    const c = this.campaign;
    if (!c) return false;
    this.pendingNotice = '';
    const boss = currentPlanet(c).local;
    const abandoned = !!c.raceInProgress;
    // (se a desistência subir de planeta, promote() já deixa a viagem pendente em c.warpFrom)
    const r = resolveAbandonedRace(c);
    if (abandoned) saveCampaign(c);
    if (r) {
      this.pendingNotice = leaveNotice(c, 'A corrida foi abandonada: contou como último.', r, boss);
    }
    // aviso extra (ex.: save mais antigo que o jogo aberto) só quando há cena; senão o chamador o mostra
    if (extra && (r || (c.finalePending && c.champion) || c.warpFrom !== undefined)) this.pendingNotice = `${this.pendingNotice} ${extra}`.trim();
    if (c.finalePending && c.champion) {
      this.showChampion();
      return true;
    }
    if (c.warpFrom !== undefined) {
      this.showPlanetWarp();
      return true;
    }
    if (this.pendingNotice) {
      this.toHub(this.pendingNotice);
      this.pendingNotice = '';
      return true;
    }
    return false;
  }

  /** aviso da desistência resolvida ao carregar, mostrado na garagem depois da viagem */
  private pendingNotice = '';

  /**
   * Sair ou reiniciar no meio de uma corrida da campanha: a regra (campaignFlow.resolveLeave/afterLeave)
   * decide o que conta e a cena seguinte; aqui só salva e executa. Fora da campanha: null.
   */
  private campaignLeave(action: 'quit' | 'restart'): AfterLeave | null {
    const c = this.campaign;
    if (this.setup.mode !== 'campaign' || !c) return null;
    const p = this.player;
    const hadMark = !!c.raceInProgress;
    const p2 = this.p2 >= 0 ? this.world.racers[this.p2] : null;
    const place = Math.min(p.finishPlace || p.place, p2 ? p2.finishPlace || p2.place : Infinity);
    const o = resolveLeave(c, { started: this.world.started, finished: !!this.settled, resolved: this.resultsShown, videoLostNow: this.glLost }, this.settled, place);
    if (o.kind !== 'none') this.resultsShown = true; // a corrida está resolvida: nada de contar de novo
    if (o.kind === 'forfeit' || (hadMark && !c.raceInProgress)) saveCampaign(c);
    return afterLeave(c, action, o);
  }

  /**
   * Evento 'storage': outra aba do jogo salvou o slot em uso. Na garagem/loja recarrega a campanha (o
   * save mais novo vale); no menu principal só troca o "Continuar"; no meio da corrida avisa (ao
   * terminar, o save desta aba passa por cima).
   */
  private onOtherTabSave(key: string | null): void {
    const slot = slotChangedElsewhere(key);
    if (slot < 0 || this.net) return;
    if (this.phase === 'menu' && this.screen === 'main') {
      this.campaign = loadCampaign();
      return;
    }
    if (!this.campaign || this.setup.mode !== 'campaign') return;
    if (this.phase === 'menu' && this.screen === 'hub' && this.menus.isShowingGarage()) {
      const fresh = loadFromSlot(slot);
      if (!fresh) return; // apagado na outra aba: segue com o jogo em memória
      this.campaign = fresh;
      this.toHub('Este jogo foi salvo em outra aba: a garagem foi recarregada com o save mais novo.');
    } else if (this.phase !== 'menu') {
      this.hud.showToast('Atenção: este jogo foi salvo em outra aba. Use uma aba só para não perder progresso.');
    }
  }

  /** Executa a cena de depois da saída (final, viagem, garagem ou largar a próxima). */
  private runAfterLeave(a: AfterLeave): void {
    this.championPending = false;
    if (a.scene === 'champion') return this.showChampion();
    if (a.scene === 'warp') {
      this.pendingNotice = a.notice;
      return this.showPlanetWarp();
    }
    if (a.scene === 'hub') return this.toHub(a.notice);
    this.setup = this.campaignSetup(this.campaign!);
    this.startRace();
    if (a.notice) this.hud.showToast(a.notice);
  }

  private toHub(notice = ''): void {
    const c = this.campaign!;
    this.phase = 'menu';
    this.engine.stop();
    this.engine2?.stop();
    this.rivalEngines.stop();
    this.announcer.stop();
    this.hud.setVisible(false);
    this.setup = this.campaignSetup(c);
    // garagem ↔ loja/slots: mesma pista e mesmos carros, com o grid ainda parado: não remonta
    if (this.raceKey !== raceKeyOf(this.setup) || this.world.started || this.showcase) this.createRace();
    this.screen = 'hub';
    this.music.play(this.track.def.theme, 'menu');
    this.menus.showHub(this.hubData(), notice);
  }

  /** Jogador da loja aberta (cooperativa: cada um compra com o próprio dinheiro). */
  private shopPlayer = 0;

  private buy(price: number | null, apply: () => void, label: string): void {
    const c = this.campaign!;
    const owner = coopOwner(c, this.shopPlayer);
    if (price === null || price > owner.money) return;
    owner.money -= price;
    apply();
    saveCampaign(c);
    sfxPickup('money');
    this.menus.showShop(this.hubData(this.shopPlayer), `✔ ${label} comprado(a)!`);
  }

  private audioSettings() {
    return {
      music: this.prefs.music,
      sfx: this.prefs.sfx,
      announcer: this.prefs.announcer,
      musicVolume: this.prefs.musicVolume,
      bundled: this.music.bundledCount,
      user: this.music.userCount,
      autoThrottle: this.prefs.autoThrottle,
      touch: this.touch,
      quality: this.prefs.quality,
      qualityNow: this.quality.level,
      battery: normalizeBatteryPref(this.prefs.battery),
      batteryNow: this.onBattery,
      batteryDetect: this.batteryKnown,
    };
  }

  private menuActions() {
    const beginAudio = () => {
      unlockAudio();
      this.engine.start();
      this.rivalEngines.start();
      this.music.play(this.track.def.theme, 'menu');
      // no celular entra em tela cheia ao começar, a menos que o jogador tenha saído dela pelo botão
      if (this.touch && !this.leftFullscreen) this.enterFullscreen();
    };
    return {
      quickRace: (o: QuickOptions) => {
        beginAudio();
        this.setup = this.quickSetup(o);
        this.startRace();
      },
      splitRace: (o: SplitOptions) => {
        beginAudio();
        (this.engine2 ??= new EngineSound()).start();
        this.setup = this.splitSetup(o);
        this.startRace();
      },
      /**
       * Seleção da corrida rápida mudou: manda os carros daquele grid para a fila ociosa, ainda no
       * menu (um modelo por intervalo livre). No clique de "correr", createRace só pega os prontos —
       * eram ~600 ms de modelos dentro do clique.
       */
      prewarmQuick: (o: QuickOptions) => {
        if (this.phase !== 'menu' || this.net) return;
        const setup = this.quickSetup(o);
        const grid = [...setup.opponents.map((r) => ({ id: r.spec.id, color: r.color })), { id: setup.playerSpec.id, color: setup.playerColor }];
        const key = raceKeyOf(setup);
        if (key === this.raceKey && !this.world.started) return;
        // na frente das miniaturas dos menus (são centenas e podem levar minutos): primeiro um
        // modelo por vez e, com eles prontos, o grid inteiro no fundo do menu — pista, cenário e
        // shaders da pista nova compilados aqui, não no clique. É o que a garagem da campanha faz.
        idleJobsUrgent([
          ...grid.map((c) => ({ key: `carro:${c.id}|${c.color}`, run: () => prewarmCarMesh(c.id, c.color, this.shadows) })),
          {
            key: 'grid',
            run: () => {
              // o jogador pode ter saído do menu ou mudado a escolha enquanto a fila esperava
              if (this.phase !== 'menu' || this.net || this.showcase || key === this.raceKey) return;
              this.setup = setup;
              this.createRace();
              // com o grid na cena, compila os shaders da pista nova ainda no menu (compileAsync, em
              // paralelo): era ~1 s de link de programas parado na tela de preparo, antes do "3"
              idleJob(
                'warmup',
                () => {
                  if (this.phase !== 'menu' || this.net || this.showcase || this.glLost) return;
                  void this.effects.warmup(this.renderer, this.scene, this.rig.active, this.track.def.theme, { extra: this.darkWarmupGroup(), offscreen: !!this.postfx });
                },
                true,
              );
            },
          },
        ]);
      },
      newCampaign: (o: NewCampaignOptions) => {
        beginAudio();
        const c = newCampaign(o.characterId, o.color, o.difficulty, o.coop);
        this.campaign = c;
        saveToSlot(o.slot, c);
        this.toHub(
          c.coop
            ? `Bem-vindos a ${this.campaignLabel()}! Cada jogador tem um Dirt Devil e $10.000 — passem na loja. Os pontos são da dupla: vale a melhor colocação.`
            : `Bem-vindo a ${this.campaignLabel()}! Você tem um Dirt Devil e $10.000 — passe na loja.`,
        );
      },
      continueCampaign: () => {
        beginAudio();
        if (this.campaign && !this.showPendingScene()) this.toHub();
      },
      loadPassword: (code: string, slot: number) => {
        const c = decodeSave(code);
        if (!c) return false;
        beginAudio();
        const behind = behindNotice(this.campaign, c);
        this.campaign = c;
        // no slot escolhido na tela da senha (que já pediu confirmação se ele estava ocupado)
        saveToSlot(slot, c);
        // senha com viagem/final pendente (ou corrida abandonada) mostra a cena antes da garagem
        if (!this.showPendingScene(behind)) this.toHub(`Campanha carregada pela senha no slot ${slot + 1}.${behind ? ` ${behind}` : ''}`);
        return true;
      },
      campaignRace: () => {
        const c = this.campaign!;
        if (c.coop) {
          // cooperativa: sem o controle do jogador 2 a corrida não larga
          if (!splitAssignment(false).p2) return this.toHub('Conecte o controle do jogador 2 e aperte um botão dele para correr em dupla.');
          // controles de agora (o grid só remonta se mudaram desde a garagem)
          this.setup = this.campaignSetup(c);
        }
        beginAudio();
        if (c.coop) (this.engine2 ??= new EngineSound()).start();
        this.startRace();
      },
      openShop: (player = 0) => {
        this.shopPlayer = this.campaign?.coop ? player : 0;
        this.menus.showShop(this.hubData(this.shopPlayer));
      },
      buyCar: (id: string) => {
        const o = coopOwner(this.campaign!, this.shopPlayer);
        // preço do novo menos a revenda do atual (negativo: a diferença volta para o jogador)
        this.buy(carSwapCost(o.car, id), () => (o.car = newCarSetup(id)), VEHICLES[id].name);
      },
      buyUpgrade: (kind: 'engine' | 'tires' | 'shocks' | 'armor') => {
        const c = this.campaign!;
        const o = coopOwner(c, this.shopPlayer);
        // a loja só vende peças até o nível liberado neste planeta
        this.buy(o.car.upgrades[kind] < shopLevel(c) ? upgradePrice(o.car, kind) : null, () => o.car.upgrades[kind]++, 'Melhoria');
      },
      buyCharge: (kind: 'front' | 'rear' | 'nitro') => {
        const c = this.campaign!;
        const o = coopOwner(c, this.shopPlayer);
        // preço da campanha (planeta × dificuldade), o mesmo mostrado na loja
        this.buy(campaignChargePrice(c, kind, o.car), () => o.car.charges[kind]++, 'Carga extra');
      },
      buyPaint: () => {
        const c = this.campaign!;
        const o = coopOwner(c, this.shopPlayer);
        // gasto opcional do último planeta: a cor muda na loja, na garagem e na corrida
        this.buy(paintPrice(coopView(c, this.shopPlayer)), () => {
          o.paint = 'champion';
          o.color = CHAMPION_PAINT.color;
        }, 'Pintura de campeão');
      },
      showPassword: () => this.menus.showPassword(exportSave(this.campaign!)),
      championSeen: () => {
        // o final foi visto (ou pulado): sai do save; fechar no meio dele o mostra de novo ao voltar
        const c = this.campaign;
        if (c?.finalePending) {
          delete c.finalePending;
          saveCampaign(c);
        }
      },
      listSlots: () => listSlots(),
      advanceEarly: () => {
        const c = this.campaign;
        if (!c) return;
        const out = advanceEarly(c);
        saveCampaign(c);
        if (out === 'champion') this.showChampion();
        else if (out === 'continue') this.toHub(`Hora do chefe! Vença ${currentPlanet(c).local} no duelo para deixar ${currentPlanet(c).name}.`);
        else this.toHub(`Promovido! Agora em ${this.campaignLabel()}.`);
      },
      loadSlot: (slot: number) => {
        const c = loadFromSlot(slot);
        if (!c) return;
        beginAudio();
        const behind = behindNotice(this.campaign, c);
        this.campaign = c;
        if (!this.showPendingScene(behind)) this.toHub(`Jogo do slot ${slot + 1} carregado.${behind ? ` ${behind}` : ''}`);
      },
      saveSlot: (slot: number) => {
        if (!this.campaign) return;
        saveToSlot(slot, this.campaign);
        this.menus.showSlots('save', `💾 Jogo salvo no slot ${slot + 1}.`);
      },
      deleteSlot: (slot: number) => {
        deleteSlot(slot);
        // no menu principal, CONTINUAR passa a apontar para o save mais recente que sobrou (ou some).
        // Na garagem, a campanha em andamento continua na memória: o próximo salvamento automático
        // vai para um slot livre
        if (this.screen === 'main') this.campaign = loadCampaign();
        return !!this.campaign;
      },
      setAutoThrottle: (on: boolean) => {
        this.prefs.autoThrottle = on;
        savePrefs(this.prefs);
        this.controls.autoThrottle = this.touch && on;
        setTouchAutoThrottle(this.touchEl, this.controls.autoThrottle);
        this.menus.showSettings(this.audioSettings());
      },
      setBatterySaver: (mode: BatteryPref) => {
        this.prefs.battery = mode;
        savePrefs(this.prefs);
        this.updateEco();
        this.menus.showSettings(this.audioSettings());
      },
      setQuality: (q: QualityPref) => {
        this.prefs.quality = q;
        savePrefs(this.prefs);
        // antialias e sombras só mudam recriando o renderizador: no menu, recarrega na hora
        if (this.phase === 'menu' && !this.net) location.reload();
        else this.menus.showSettings(this.audioSettings());
      },
      toggleFullscreen: () => {
        void toggleFullscreen().then((on) => {
          this.leftFullscreen = !on;
          if (this.phase === 'paused') this.showPauseMenu();
          else if (this.menus.isShowingSettings()) this.menus.showSettings(this.audioSettings());
        });
      },
      install: () => {
        if (canInstall()) void promptInstall();
        else this.menus.showInstallHelp();
      },
      quitGame: () => {
        void quitGame().then((closing) => {
          if (closing) return;
          this.music.setMood('pause');
          this.engine.stop();
          this.engine2?.stop();
          this.rivalEngines.stop();
          this.menus.showGoodbye();
        });
      },
      backToHub: () => this.toHub(),
      resume: () => this.togglePause(),
      restart: () => {
        unlockAudio();
        // sem vídeo a corrida largaria às cegas (a pausa desabilita o botão; aqui, por garantia)
        if (this.glLost && !this.net) {
          this.showGlNotice(true, 'Aguardando o vídeo voltar para reiniciar a corrida…');
          return;
        }
        // campanha: "Desistir e ir para a próxima" conta como último (fora do Fácil) e larga a seguinte
        // ou vai à garagem/viagem/final conforme o que a desistência causou (campaignFlow.afterLeave)
        const after = this.campaignLeave('restart');
        if (after) return this.runAfterLeave(after);
        this.startRace();
      },
      onlineCreate: (o: OnlineOptions) => {
        beginAudio();
        this.onlineCreate(o);
      },
      onlineJoin: (o: OnlineOptions, code: string) => {
        beginAudio();
        this.onlineJoin(o, code);
      },
      onlineStart: (trackId: string, fillCpu: boolean) => this.onlineStart(trackId, fillCpu),
      onlineLeave: () => this.onlineLeave(),
      onlineLobby: () => this.onlineBackToLobby(),
      quit: () => {
        unlockAudio();
        const after = this.campaignLeave('quit');
        if (after) this.runAfterLeave(after);
        else this.toMenu();
      },
      resultsContinue: () => {
        const c = this.campaign!;
        // acabou de ser campeão: tela de campeão e depois a garagem (não o menu principal)
        if (c.champion && this.championPending) {
          this.championPending = false;
          this.showChampion();
          return;
        }
        if (this.warpFrom >= 0) {
          this.showPlanetWarp();
          return;
        }
        this.toHub();
      },
      warpDone: () => {
        const c = this.campaign!;
        // a viagem foi vista até o fim: sai do save (ver CampaignState.warpFrom)
        if (c.warpFrom !== undefined) {
          delete c.warpFrom;
          saveCampaign(c);
        }
        const before = this.pendingNotice ? `${this.pendingNotice} ` : '';
        this.pendingNotice = '';
        this.toHub(`${before}Bem-vindo a ${currentPlanet(c).name}! Rivais mais fortes à vista: confira a loja antes de correr.`);
      },
      toMain: () => this.toMenu(),
      openSettings: () => {
        unlockAudio();
        this.menus.showSettings(this.audioSettings());
      },
      closeSettings: () => {
        if (this.net?.menuOpen) this.menus.showPause(true);
        else if (this.phase === 'paused') this.showPauseMenu();
        else if (this.screen === 'hub' && this.campaign) this.menus.showHub(this.hubData());
        else this.menus.showMain(!!this.campaign);
      },
      setAudio: (key: 'music' | 'sfx' | 'announcer', on: boolean) => {
        this.prefs[key] = on;
        savePrefs(this.prefs);
        if (key === 'music') {
          this.music.setEnabled(on);
          if (on) this.music.play(this.track.def.theme, this.phase === 'paused' ? 'pause' : 'menu');
        } else if (key === 'sfx') setSfxEnabled(on);
        else {
          this.announcer.enabled = on;
          if (!on) this.announcer.stop();
        }
        this.menus.showSettings(this.audioSettings());
      },
      setMusicVolume: (v: number) => {
        this.prefs.musicVolume = v;
        savePrefs(this.prefs);
        this.music.setVolume(v);
      },
      addMusic: (files: File[]) => {
        void this.music.addFiles(files).then(() => {
          this.music.play(this.track.def.theme, this.phase === 'paused' ? 'pause' : 'menu');
          this.menus.showSettings(this.audioSettings());
        });
      },
      clearMusic: () => {
        void this.music.clearFiles().then(() => {
          this.music.play(this.track.def.theme, this.phase === 'paused' ? 'pause' : 'menu');
          this.menus.showSettings(this.audioSettings());
        });
      },
      skipTrack: () => this.music.skip(),
      setCamera: (mode: CameraMode) => {
        this.prefs.camera = mode;
        savePrefs(this.prefs);
        this.setCamera(mode, false);
      },
    };
  }

  /**
   * Suspensão visual de todos os carros: a carroceria inclina para fora na curva, empina no
   * arranque, mergulha na freada e comprime no pouso (mola amortecida). Não afeta a simulação.
   */
  private suspension(view: CarView, r: Racer, dt: number, isPlayer: boolean): void {
    const s = view.susp;
    const v = r.car;
    const body = view.visual.body;
    if (dt <= 0 || dt > 0.1) return;
    const speed = forwardSpeed(v);
    const accel = clamp((speed - s.speed) / dt, -60, 60);
    s.speed = speed;
    // esteiras e colchão de ar balançam menos que monster trucks
    const soft = r.spec.traction === 'treads' ? 0.45 : r.spec.traction === 'hover' ? 0.6 : 1;
    const sr = clamp(Math.abs(speed) / r.spec.maxSpeed, 0, 1.2);
    const rollT = v.grounded ? -v.steer * sr * 0.09 * soft : 0;
    const pitchT = v.grounded ? clamp(accel * 0.0022, -0.07, 0.05) * soft : 0;
    s.roll += (rollT - s.roll) * clamp(dt * 7, 0, 1);
    s.pitch += (pitchT - s.pitch) * clamp(dt * 6, 0, 1);
    // pouso: impulso proporcional ao tempo no ar
    if (!v.grounded) s.air += dt;
    else if (s.air > 0.12) {
      s.heaveV -= Math.min(4, s.air * 5) * soft;
      s.air = 0;
    } else s.air = 0;
    s.heaveV += (-s.heave * 260 - s.heaveV * 16) * dt;
    s.heave = clamp(s.heave + s.heaveV * dt, -0.3, 0.15);
    body.rotation.set(-s.pitch, 0, s.roll);
    if (!isPlayer) body.position.y = s.heave;
  }

  /* ------------------------------------------------------------------ */
  /* Online com amigos (P2P: o navegador do host simula, os outros mostram) */
  /* ------------------------------------------------------------------ */

  private newSession(role: 'host' | 'client', code: string): Online {
    const net: Online = {
      role, host: null, client: null, code, players: [], racing: false, racerOf: new Map(), inputs: {}, events: [], tick: 0, snaps: [],
      lastSnapAt: performance.now(), inLobby: false, menuOpen: false, myId: role === 'host' ? 'host' : '',
      inputAt: {}, ack: {}, seq: 0, waiting: new Set(), readyUntil: 0, sentReady: false, playK: 0, curK: -1, history: [], own: null, pred: null,
      predErr: { x: 0, y: 0, z: 0, h: 0 },
      queues: {}, seats: new RejoinBook(), notes: new Map(), prevEvents: [], firstFinishAt: null, lastConfirm: false,
      taps: new TapCounter(), cmds: [], token: '', hello: null, reconnecting: false, gone: false, hostAway: false, timer: null, ticks: 0, minK: 0,
      hostCpu: false, evId: 0, important: [], progKeys: [], seenEv: new Set(), evMin: 0, progs: [], lastK: -1, lastAck: -1, stall: new StallGuard(), jitter: new JitterBuffer(), echo: new LocalEcho(), prevIn: emptyInput(), recvAt: performance.now(), fxCd: 0,
    };
    net.timer = setInterval(() => this.onlineTick(net), 1000);
    return net;
  }

  private roomLink(code: string): string {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('sala', code);
    return url.toString();
  }

  private onlineCreate(o: OnlineOptions): void {
    const token = ++this.netToken;
    this.menus.showOnlineWait('Criando sala…');
    NetHost.create().then(
      (host) => {
        if (token !== this.netToken) return host.close();
        const net = this.newSession('host', host.code);
        net.host = host;
        net.players = [{ id: 'host', name: cleanName(o.name), color: pickColor(o.color, new Set(), COLORS), vehicleId: VEHICLES[o.vehicleId] ? o.vehicleId : 'marauder' }];
        this.net = net;
        host.onJoin = (id, msg) => this.hostJoin(id, msg);
        host.onMessage = (id, msg) => this.hostMessage(id, msg);
        host.onLeave = (id) => this.hostLeave(id);
        this.showLobby();
      },
      (err) => {
        if (token === this.netToken) this.menus.showOnline('', netErrorText(err));
      },
    );
  }

  /** Host: mensagem de um convidado já na sala (nada dele é confiável: tudo conferido). */
  private hostMessage(id: string, msg: unknown): void {
    const net = this.net;
    if (!net?.host) return;
    const m = msg as { t?: unknown } | null;
    const racer = net.racerOf.get(id);
    switch (m?.t) {
      case 'ready':
        net.waiting.delete(id);
        break;
      case 'input': {
        if (racer === undefined) return;
        const cmds = parseInputMsg(m);
        if (!cmds.length) return;
        (net.queues[racer] ??= new InputQueue()).push(cmds);
        net.inputAt[racer] = performance.now();
        break;
      }
      case 'away':
      case 'back': {
        // aba oculta (celular): espera até 30 s antes de dar como caído, e avisa na etiqueta
        const away = m.t === 'away';
        net.host.setAway(id, away);
        if (racer !== undefined) {
          if (away) net.notes.set(racer, 'fora da tela');
          else net.notes.delete(racer);
        }
        break;
      }
      case 'leave':
        // saiu de propósito: não guarda a vaga, sai da sala já (o carro vira CPU) e a conexão fecha
        net.seats.remove(id);
        this.hostLeave(id);
        net.host.kick(id);
        break;
    }
  }

  private hostJoin(id: string, msg: unknown): void {
    const net = this.net;
    if (!net?.host) return;
    const m = parseHello(msg, vehicleIds());
    if (!m) return net.host.kick(id);
    // a mesma ficha com outra conexão aberta, de outra aba: se a antiga responde, recusa a nova
    // (aba duplicada; sem isso as duas se derrubavam em ciclo); se não responde, é recarga: volta
    const held = net.seats.peek(m.rejoin);
    if (held && dupPlan(held, id, m.inst, net.host.connected(held.peerId)) === 'probe') {
      const host = net.host;
      void host.probe(held.peerId).then((alive) => {
        if (this.net !== net || !host.connected(id)) return;
        if (!alive) return this.hostAdmit(id, m);
        host.send(id, { t: 'dup' } satisfies HostMsg);
        setTimeout(() => host.kick(id), 500);
      });
      return;
    }
    this.hostAdmit(id, m);
  }

  /** Host: `hello` aceito: volta com a ficha (mesma vaga e carro) ou entra na sala. */
  private hostAdmit(id: string, m: NonNullable<ReturnType<typeof parseHello>>): void {
    const net = this.net;
    if (!net?.host) return;
    const now = performance.now();
    // voltando com a ficha de sessão: mesma vaga, mesmo carro
    const seat = net.seats.rejoin(m.rejoin, id, now);
    if (seat) {
      this.hostRejoin(id, seat.peerId, seat.player, seat.racer);
      if (m.inst) net.seats.setInst(id, m.inst);
      return;
    }
    if (net.players.length >= MAX_PLAYERS) {
      net.host.send(id, { t: 'full' } satisfies HostMsg);
      setTimeout(() => net.host?.kick(id), 500);
      return;
    }
    // cor só da paleta (a cor vai para o HTML da sala); repetida ou inválida: a primeira livre
    const color = pickColor(m.color, new Set(net.players.map((p) => p.color)), COLORS);
    const { name, vehicleId } = m;
    net.players = net.players.filter((p) => p.id !== id);
    const player: LobbyPlayer = { id, name, color, vehicleId };
    net.players.push(player);
    net.seats.add(newToken(), id, player, undefined, m.inst || undefined);
    net.host.accept(id);
    this.hud.showToast(`🌐 ${name} entrou na sala`);
    this.lobbyChanged();
  }

  /** Host: convidado voltou com a ficha (caiu ou recarregou): devolve a vaga e o carro. */
  private hostRejoin(id: string, oldId: string, seatPlayer: LobbyPlayer, racer: number | undefined): void {
    const net = this.net!;
    const host = net.host!;
    if (oldId !== id) {
      // a conexão antiga pode ainda não ter caído do lado de cá
      host.kick(oldId);
      net.waiting.delete(oldId);
    }
    const player: LobbyPlayer = { id, name: seatPlayer.name, color: seatPlayer.color, vehicleId: seatPlayer.vehicleId };
    net.players = net.players.filter((p) => p.id !== oldId && p.id !== id);
    net.players.push(player);
    net.seats.add(net.seats.tokenOf(id)!, id, player, racer);
    net.racerOf.delete(oldId);
    host.accept(id);
    const race = this.setup.online?.race;
    const r = racer !== undefined ? this.world.racers[racer] : undefined;
    if (net.racing && race && r && this.setup.mode === 'online') {
      // o carro volta para o piloto no primeiro comando dele (até lá a CPU segue pilotando: sem
      // inputAt, cpuTakesOver); quem já tinha terminado também recebe a corrida e o placar.
      // `re`: corrida já largada (o convidado pula a contagem)
      net.racerOf.set(id, racer!);
      net.queues[racer!] = new InputQueue();
      delete net.inputAt[racer!];
      net.inputs[racer!] = emptyInput();
      net.progKeys = []; // o progresso de todos vai de novo (quem voltou não tem)
      net.notes.delete(racer!);
      host.send(id, { t: 'start', race, you: racer!, token: net.seats.tokenOf(id), k: net.seq, ...(this.world.started && { re: true }), ev: net.evId } satisfies HostMsg);
    } else if (racer !== undefined) net.notes.delete(racer);
    this.hud.showToast(`🌐 ${player.name} voltou`);
    this.lobbyChanged();
  }

  private hostLeave(id: string): void {
    const net = this.net;
    if (!net) return;
    const p = net.players.find((x) => x.id === id);
    const racer = net.racerOf.get(id);
    // caiu sem avisar: guarda a vaga (e o carro) por 30 s
    const seat = net.seats.left(id, performance.now());
    if (seat && p) p.away = true;
    else net.players = net.players.filter((x) => x.id !== id);
    net.waiting.delete(id);
    if (racer !== undefined) {
      // o carro continua na corrida, pilotado pela CPU até o dono voltar
      net.racerOf.delete(id);
      delete net.inputs[racer];
      delete net.queues[racer];
      const r = this.world.racers[racer];
      if (r) r.ai = LEFT_PLAYER_AI;
      if (seat) net.notes.set(racer, 'reconectando…');
      else net.notes.delete(racer);
    }
    if (p) this.hud.showToast(seat ? `🌐 ${p.name} caiu — esperando voltar` : `🌐 ${p.name} saiu da sala`);
    this.lobbyChanged();
  }

  /** Relógio da sala (1 s): ping no HUD e na sala, vagas vencidas, prazo do fim da corrida. */
  private onlineTick(net: Online): void {
    if (this.net !== net) {
      if (net.timer) clearInterval(net.timer);
      return;
    }
    net.ticks++;
    const host = net.host;
    if (host) {
      let changed = false;
      for (const s of net.seats.expire(performance.now())) {
        const p = net.players.find((x) => x.id === s.peerId && x.away);
        if (p) {
          net.players = net.players.filter((x) => x !== p);
          this.hud.showToast(`🌐 ${p.name} saiu da sala`);
          changed = true;
        }
        if (s.racer !== undefined && !net.racerOf.has(s.peerId)) net.notes.delete(s.racer);
      }
      if (changed) this.lobbyChanged();
      else if (net.ticks % 2 === 0 && net.players.length > 1) this.lobbyChanged(true);
      // o prazo para voltar à sala sem perguntar pode ter vencido: redesenha o placar
      if (this.onlineResultsOpen(net) && this.hostMustConfirm(net) !== net.lastConfirm) this.refreshOnlineResults();
      let worst: number | null = null;
      for (const p of net.players) {
        const ms = p.id === 'host' ? null : host.rtt(p.id);
        if (ms !== null) worst = Math.max(worst ?? 0, ms);
      }
      this.hud.setPing(net.players.length > 1 ? worst : undefined, pingTone(worst));
    } else if (net.client) {
      const ms = net.client.rtt.value;
      this.hud.setPing(ms, pingTone(ms));
    }
  }

  /** Lista da sala como vai para os convidados (com o ping medido pelo host). */
  private lobbyPlayers(net: Online): LobbyPlayer[] {
    return net.players.map((p) => {
      const ping = p.id !== 'host' && net.host ? net.host.rtt(p.id) : null;
      return ping === null ? p : { ...p, ping: Math.round(ping) };
    });
  }

  /** Avisa todos da nova lista de pilotos e redesenha a sala se ela estiver aberta. `pings`: só o ping mudou. */
  private lobbyChanged(pings = false): void {
    const net = this.net;
    if (!net) return;
    if (net.host) {
      const players = this.lobbyPlayers(net);
      for (const p of net.players) {
        if (p.id === 'host' || p.away) continue;
        net.host.send(p.id, { t: 'lobby', players, racing: net.racing, you: p.id, token: net.seats.tokenOf(p.id) } satisfies HostMsg);
      }
    }
    if (!net.inLobby) return;
    if (pings) this.menus.updateLobbyPings(this.lobbyView());
    else this.menus.showLobby(this.lobbyView());
  }

  private lobbyView(): LobbyView {
    const net = this.net!;
    return {
      code: net.code,
      link: this.roomLink(net.code),
      host: net.role === 'host',
      players: net.players.map((p) => ({
        name: p.name,
        color: p.color,
        vehicleId: p.vehicleId,
        me: p.id === net.myId,
        away: p.away,
        ping: p.id === 'host' ? undefined : net.host ? net.host.rtt(p.id) : (p.ping ?? null),
      })),
      max: MAX_PLAYERS,
      racing: net.racing,
    };
  }

  private showLobby(): void {
    const net = this.net;
    if (!net) return;
    this.endShowroom();
    this.phase = 'menu';
    this.engine.stop();
    this.engine2?.stop();
    this.announcer.stop();
    this.hud.setVisible(false);
    net.inLobby = true;
    net.menuOpen = false;
    this.menus.showLobby(this.lobbyView());
  }

  private onlineJoin(o: OnlineOptions, raw: string): void {
    const code = normalizeCode(raw);
    const token = ++this.netToken;
    this.menus.showOnlineWait(`Entrando na sala ${code}…`);
    // recarregou a página no meio da corrida: volta para o mesmo carro
    const rejoin = storedRejoin(code);
    const hello: ClientMsg = { t: 'hello', name: o.name, color: o.color, vehicleId: o.vehicleId, inst: INSTANCE, ...(rejoin ? { rejoin } : {}) };
    NetClient.join(code, hello).then(
      (client) => {
        if (token !== this.netToken) return client.close();
        const net = this.newSession('client', code);
        net.hello = hello;
        net.token = rejoin ?? '';
        this.net = net;
        this.guestConnected(net, client);
        this.showLobby();
      },
      (err) => {
        if (token !== this.netToken) return;
        // a sala da ficha guardada não existe mais: esquece a ficha (e o ?sala= da barra)
        if (rejoin) storeRejoin(code, null);
        // sala inexistente (link velho ou código errado): tira o ?sala= da barra e pede o código certo
        if ((err as { type?: string })?.type === 'peer-unavailable') {
          const url = new URL(location.href);
          if (url.searchParams.has('sala')) {
            url.searchParams.delete('sala');
            history.replaceState(null, '', url);
          }
          this.menus.showOnline('', `A sala ${code} não existe ou já foi fechada. Confira o código com quem convidou ou volte ao menu inicial.`, code);
          return;
        }
        this.menus.showOnline(code, netErrorText(err));
      },
    );
  }

  private guestConnected(net: Online, client: NetClient): void {
    net.client = client;
    net.reconnecting = false;
    net.hostAway = false;
    client.onMessage = (msg) => {
      if (this.net === net) this.guestMessage(msg);
    };
    client.onClose = () => {
      if (this.net === net && net.client === client) this.guestDropped(net);
    };
    if (document.hidden) {
      client.setPatience(REJOIN_MS);
      client.send({ t: 'away' } satisfies ClientMsg);
    }
  }

  /** Convidado: a conexão com o host caiu. Tenta voltar (~30 s) antes de desistir. */
  private guestDropped(net: Online): void {
    net.client = null;
    const racing = this.setup.mode === 'online' && this.phase !== 'menu' && net.racing && !this.resultsShown;
    // gone: o host fechou a sala (o placar final já chegou com a despedida); sem ficha não dá para voltar
    const plan = guestDropPlan({ gone: net.gone, token: !!net.token, racing, resultsOpen: this.onlineResultsOpen(net), reconnecting: net.reconnecting });
    const why = net.gone ? 'O host desconectou.' : 'A conexão com o host caiu.';
    if (plan === 'close') return this.closeNet();
    if (plan === 'giveUp') return this.guestGiveUp(net, why);
    if (plan === 'lost') return this.onlineLost(net.gone ? 'O host fechou a sala.' : why);
    if (plan === 'none') return;
    net.reconnecting = true;
    // a corrida some atrás do "Reconectando…"; o host devolve o carro e o estado ao voltar
    if (this.phase !== 'menu') {
      this.endShowroom();
      this.phase = 'menu';
      this.engine.stop();
      this.engine2?.stop();
      this.rivalEngines.stop();
      this.announcer.stop();
      this.hud.setVisible(false);
    }
    net.inLobby = false;
    net.menuOpen = false;
    const token = this.netToken;
    const started = performance.now();
    let tries = 0;
    let missing = 0;
    const attempt = () => {
      if (token !== this.netToken || this.net !== net) return;
      if (performance.now() - started > REJOIN_MS) return this.guestGiveUp(net, 'Não deu para reconectar ao host.');
      this.menus.showOnlineWait(`Reconectando… (tentativa ${tries + 1})`);
      NetClient.tryJoin(net.code, { ...net.hello, rejoin: net.token }).then(
        (client) => {
          if (token !== this.netToken || this.net !== net) return client.close();
          this.guestConnected(net, client);
          // o host responde com a sala e, se a corrida segue, a largada com o mesmo carro
          net.inLobby = true;
          this.menus.showLobby(this.lobbyView());
        },
        (err) => {
          if (token !== this.netToken || this.net !== net) return;
          // sala sumiu do servidor de apresentação algumas vezes seguidas: o host saiu
          if ((err as { type?: string })?.type === 'peer-unavailable' && ++missing >= 3) return this.guestGiveUp(net, 'O host desconectou.');
          setTimeout(attempt, backoffMs(tries++));
        },
      );
    };
    this.menus.showOnlineWait('Reconectando…');
    setTimeout(attempt, backoffMs(tries++));
  }

  /** Convidado sem host: mostra o último placar conhecido (se houve corrida) com a nota. */
  private guestGiveUp(net: Online, note: string): void {
    const hadRace = this.setup.mode === 'online' && (net.racing || this.resultsShown) && this.world.started;
    storeRejoin(net.code, null);
    this.closeNet();
    if (!hadRace) return this.onlineLost(note);
    this.netResults = { note, gone: true, final: false };
    this.showOnlineResults();
  }

  private guestMessage(msg: unknown): void {
    const net = this.net;
    // estado do host: binário (ver encodeSnapMsg)
    if (msg instanceof ArrayBuffer) {
      if (net) this.guestSnap(net, msg);
      return;
    }
    // tudo que vem do host é conferido antes de usar (vai para a simulação e para o HTML)
    const m = msg as { t?: unknown } & Record<string, unknown>;
    if (!net || typeof m !== 'object' || m === null) return;
    switch (m.t) {
      case 'lobby': {
        const players = parseLobbyPlayers(m.players, COLORS, vehicleIds());
        if (!players || typeof m.you !== 'string') return;
        const racing = m.racing === true;
        // só o ping mudou: atualiza no lugar (sem redesenhar a sala)
        const key = (ps: LobbyPlayer[]) => ps.map((p) => `${p.id}|${p.name}|${p.color}|${p.vehicleId}|${p.away ? 1 : 0}`).join(',');
        const same = key(players) === key(net.players) && racing === net.racing && net.myId === m.you;
        net.players = players;
        net.racing = racing;
        net.myId = m.you;
        this.guestToken(net, m.token);
        if (net.inLobby) {
          if (same) this.menus.updateLobbyPings(this.lobbyView());
          else this.menus.showLobby(this.lobbyView());
        }
        break;
      }
      case 'full':
        this.onlineLost('A sala está cheia (4 pilotos).');
        break;
      case 'start': {
        const start = parseStart(m, vehicleIds(), TRACKS.map((t) => t.id));
        if (!start) return;
        this.guestToken(net, m.token);
        net.racing = true;
        net.inLobby = false;
        net.menuOpen = false;
        net.snaps = [];
        net.tick = 0;
        net.sentReady = false;
        net.playK = 0;
        net.curK = -1;
        net.minK = Number.isSafeInteger(m.k) && (m.k as number) >= 0 ? (m.k as number) : 0;
        net.history = [];
        net.own = null;
        net.pred = null;
        net.stall = new StallGuard();
        net.jitter.reset();
        net.seenEv.clear();
        net.evMin = Number.isSafeInteger(m.ev) ? (m.ev as number) : 0;
        net.progs = [];
        net.lastK = -1;
        net.lastAck = -1;
        net.echo.clear();
        net.prevIn = emptyInput();
        net.recvAt = performance.now();
        net.fxCd = 0;
        net.predErr = { x: 0, y: 0, z: 0, h: 0 };
        net.taps = new TapCounter();
        net.cmds = [];
        net.notes.clear();
        this.netResults = {};
        this.setup = this.onlineSetup(start.race, start.you);
        // reentrada no meio da corrida: sem contagem, bipe nem abertura do locutor
        const mid = m.re === true;
        this.startRace(mid);
        if (mid) {
          this.phase = 'racing';
          this.countdown = 0;
          this.world.started = true;
          this.commentary.start();
          this.announcer.stop();
        }
        net.lastSnapAt = performance.now();
        break;
      }
      case 'prog': {
        // volta, tempos, dinheiro e abates: aplicados junto com o estado a que pertencem (applySnaps)
        if (this.setup.mode !== 'online' || this.phase === 'menu' || !net.racing) return;
        const p = parseProg(m, this.world.racers.length);
        if (!p || p.k < net.minK) return;
        net.progs.push(p);
        if (net.progs.length > 60) net.progs.shift();
        break;
      }
      case 'dup':
        // a mesma ficha está aberta em outra aba (que ainda responde): esta desiste, sem tentar voltar
        storeRejoin(net.code, null);
        this.onlineLost('Esta sala já está aberta em outra aba deste navegador.');
        break;
      case 'end': {
        const wasRacing = net.racing;
        net.racing = false;
        net.snaps = [];
        if (m.bye === true) net.gone = true;
        const inRace = this.setup.mode === 'online' && this.phase !== 'menu' && wasRacing;
        // o estado final oficial do host (ordem de chegada, tempos)
        const s = inRace ? validateSnap(m.s, this.world.racers.length, this.track.pieces.length) : null;
        if (s) applySnapshot(this.world, s);
        if (inRace || this.onlineResultsOpen(net)) {
          this.netResults = { final: true, ...(net.gone && { note: 'O host saiu da sala.', gone: true }) };
          this.showOnlineResults();
        } else if (net.inLobby) this.menus.showLobby(this.lobbyView());
        if (net.gone) {
          storeRejoin(net.code, null);
          if (!inRace && !this.resultsShown) this.onlineLost('O host fechou a sala.');
        }
        break;
      }
      case 'hostAway': {
        // host com a aba oculta: espera mais antes de dar a conexão como perdida
        const away = m.away === true;
        if (away !== net.hostAway && this.phase !== 'menu') this.hud.showToast(away ? '🌐 O host saiu da tela — esperando voltar…' : '🌐 O host voltou');
        net.hostAway = away;
        net.client?.setPatience(away || document.hidden ? REJOIN_MS : DROP_MS);
        break;
      }
    }
  }

  /** Convidado: estado binário do host (conferido em decodeSnapMsg). */
  private guestSnap(net: Online, buf: ArrayBuffer): void {
    if (this.setup.mode !== 'online' || this.phase === 'menu' || !net.racing) return;
    const m: SnapMsg | null = decodeSnapMsg(buf, this.world.racers.length, this.track.pieces.length);
    if (!m || m.k <= (net.snaps.at(-1)?.k ?? net.curK) || m.k < net.minK) return;
    const { s, a } = m;
    const cd = clamp(m.cd, 0, COUNTDOWN);
    net.snaps.push({ s, k: m.k, a, cd, pe: m.pe ?? [], aw: m.aw ?? [], dc: m.dc ?? [], ie: m.ie ?? [] });
    // aba oculta ou rede travada: guarda só os mais novos
    if (net.snaps.length > SNAP_QUEUE) net.snaps.splice(0, net.snaps.length - SNAP_QUEUE);
    // o próprio carro usa sempre o estado mais novo (previsão), sem a folga dos outros
    const rs = s.racers[this.playerId];
    const me = this.playerId;
    // empurrão do host no próprio carro (tiro, mina, óleo): a previsão pula direto para ele
    const kicked = [...s.events, ...(net.snaps.at(-1)?.pe ?? [])].some((e) => (e.type === 'hit' && e.target === me) || (e.type === 'spin' && e.racer === me));
    net.recvAt = performance.now();
    net.jitter.add(m.k, net.recvAt, SNAP_S * 1000);
    net.lastK = m.k;
    net.lastAck = a[me] ?? -1;
    if (rs) {
      const d: DriverState = { car: rs.car, slipTime: rs.slipTime ?? 0, spinTime: rs.spinTime, spinTotal: Math.max(0.05, rs.spinTotal ?? 1), oilGrace: rs.oilGrace ?? 0 };
      net.own = { d, ack: a[me] ?? -1, kick: kicked || !!net.own?.kick };
    }
  }

  /** Convidado: guarda a ficha de sessão vinda do host (sessionStorage: sobrevive a recarregar). */
  private guestToken(net: Online, token: unknown): void {
    if (!isToken(token) || token === net.token) return;
    net.token = token;
    storeRejoin(net.code, token, net.hello);
  }

  /** Convidado: um passo da corrida (comandos ao host, estado do host, previsão do próprio carro). */
  private guestStep(net: Online, input: ControlInput, dt: number): void {
    if (!net.racing) return;
    // avisa que está pronto (o preparo terminou)
    if (!net.sentReady) {
      net.sentReady = true;
      net.client?.send({ t: 'ready' } satisfies ClientMsg);
    }
    const n = ++net.tick;
    const i: ControlInput = document.hidden
      ? emptyInput()
      : { ...input, throttle: round3(input.throttle), brake: round3(input.brake), steer: round3(input.steer) };
    this.guestCommand(net, n, i);
    // a cada 2 passos, os comandos recentes (inclusive os já enviados: o canal rápido pode perder)
    if (n % 2 === 0) net.client?.sendFast({ t: 'input', c: net.cmds } satisfies ClientMsg);
    net.history.push({ n, i });
    if (net.history.length > 180) net.history.splice(0, net.history.length - 180);
    this.applySnaps(net, dt);
    // o "chegou" do host pode ter se perdido: a colocação já vem no estado
    const me = this.world.racers[this.playerId];
    if (this.phase === 'racing' && me?.finishPlace) {
      this.phase = 'finished';
      this.hud.message(me.finishPlace === 1 ? 'VITÓRIA!' : `${me.finishPlace}º LUGAR`, 3, 'go');
      this.resultsTimer = 3;
    }
    // estados do host parados: avisa e deixa a previsão andar só ~250 ms sozinha
    const advance = net.stall.step(performance.now() - net.recvAt);
    this.hud.setNetWarning(net.stall.stalled && !this.resultsShown ? 'Conexão instável…' : null);
    const assist = this.predictOwn(net, i, dt, advance);
    this.guestFeedback(net, i, assist, dt);
  }

  /**
   * Convidado: tiro, bomba e turbo soam e brilham na hora do toque (com carga), sem esperar a volta
   * do host; o mesmo evento vindo depois do host é engolido (LocalEcho).
   */
  private guestFeedback(net: Online, i: ControlInput, assist: boolean, dt: number): void {
    const prev = net.prevIn;
    net.prevIn = i;
    net.fxCd = Math.max(0, net.fxCd - dt);
    const r = this.world.racers[this.playerId];
    if (!r || !r.alive || r.finishPlace || !this.world.started || this.phase !== 'racing') return;
    const now = performance.now();
    const c = r.car;
    if (i.fire && !prev.fire && net.fxCd <= 0 && r.frontCharges - net.echo.count(0, now) > 0) {
      const kind = r.spec.front;
      sfxFire(kind, 1, 0);
      this.effects.muzzle(kind, c.x + forwardX(c.heading) * 2.8 * CAR_SCALE, c.y + 1, c.z + forwardZ(c.heading) * 2.8 * CAR_SCALE);
      net.echo.played(0, now);
      net.fxCd = 0.25;
    }
    if (i.drop && !prev.drop && net.fxCd <= 0 && r.rearCharges - net.echo.count(1, now) > 0) {
      sfxDrop(1, r.spec.rear, 0);
      net.echo.played(1, now);
      net.fxCd = 0.25;
    }
    if (assist) {
      if (r.spec.assist === 'jump') this.effects.jumpJet(c.x, c.y, c.z);
      else this.effects.nitroBurst(c.x - Math.sin(c.heading) * 2, c.y, c.z - Math.cos(c.heading) * 2);
      sfxAssist(r.spec.assist, 1, 0);
      net.echo.played(2, now);
    }
  }

  private guestCommand(net: Online, n: number, i: ControlInput): void {
    net.cmds.push({ n, i, b: net.taps.update(i) });
    if (net.cmds.length > CMDS_PER_MSG) net.cmds.shift();
  }

  /** Host: comandos dos convidados para este passo (um da fila de cada, na ordem). */
  private hostInputs(net: Online): void {
    // convidado sem mandar comando há 500 ms (aba oculta, rede travada): solta os controles
    const now = performance.now();
    for (const racer of net.racerOf.values()) {
      const q = (net.queues[racer] ??= new InputQueue());
      if (!q.size && now - (net.inputAt[racer] ?? 0) > INPUT_STALE_MS) q.release();
      net.inputs[racer] = q.next();
      net.ack[racer] = q.acked;
      // sem comandos há 1,5 s (rede travada) ou com a aba oculta: a CPU pilota até ele voltar
      const r = this.world.racers[racer];
      if (r && !r.finishPlace) r.ai = cpuTakesOver(now, net.inputAt[racer], net.notes.get(racer) === 'fora da tela') ? LEFT_PLAYER_AI : null;
    }
  }

  /** Host: depois do passo, junta os eventos e manda o estado (20x por segundo). */
  private hostSend(net: Online): void {
    const host = net.host!;
    let finished = false;
    for (const e of this.world.events) {
      net.events.push(e);
      if (e.type !== 'finish') continue;
      finished = true;
      if (net.firstFinishAt === null && (e.racer === this.playerId || [...net.racerOf.values()].includes(e.racer))) net.firstFinishAt = performance.now();
    }
    if (net.events.length > 400) net.events.splice(0, net.events.length - 400);
    if (finished && this.onlineResultsOpen(net)) this.refreshOnlineResults();
    if (++net.tick % SNAP_EVERY !== 0) return;
    const a = this.world.racers.map((r) => net.ack[r.id] ?? -1);
    const k = net.seq++;
    // eventos importantes (chegada, volta, explosão...) ganham id e vão repetidos por ~1 s; os
    // outros vão no estado e, de novo, no seguinte (pe)
    const normal: WorldEvent[] = [];
    for (const e of net.events) {
      if (isImportant(e)) net.important.push({ id: net.evId++, e, k });
      else normal.push(e);
    }
    while (net.important.length && k - net.important[0].k >= IMPORTANT_RESEND) net.important.shift();
    const msg: SnapMsg = { t: 'snap', s: takeSnapshot(this.world, normal), k, a, cd: this.phase === 'countdown' ? this.countdown : 0 };
    if (net.important.length) msg.ie = net.important.map((x) => ({ i: x.id, e: x.e }));
    if (net.prevEvents.length) msg.pe = net.prevEvents;
    // progresso, dinheiro e abates: só quando mudam, pelo canal confiável
    const changed = this.world.racers.map((r, i) => progEntry(i, r)).filter((e) => {
      const key = progKey(e);
      if (net.progKeys[e.i] === key) return false;
      net.progKeys[e.i] = key;
      return true;
    });
    if (changed.length) host.broadcast({ t: 'prog', k, r: changed } satisfies HostMsg);
    if (net.notes.size) {
      msg.aw = [];
      msg.dc = [];
      for (const [racer, note] of net.notes) (note === 'fora da tela' ? msg.aw : msg.dc).push(racer);
    }
    host.broadcastFast(encodeSnapMsg(msg));
    net.prevEvents = normal;
    net.events = [];
  }

  /**
   * Convidado: aplica os estados do host seguindo um relógio de reprodução ~100 ms atrás do mais
   * novo (folga medida pelo JitterBuffer: 2 a 5 estados). Os pacotes chegam em rajadas irregulares; com a folga, os carros
   * dos outros andam lisos. O relógio acompanha o host devagar e só salta se ficar muito longe.
   */
  private applySnaps(net: Online, dt: number): void {
    const q = net.snaps;
    const me = this.playerId;
    if (net.pred) this.views[me].prev = snap(this.world.racers[me].car);
    if (q.length) {
      const target = q[q.length - 1].k - net.jitter.packets;
      if (net.curK < 0) net.playK = target;
      net.playK += dt / SNAP_S;
      const err = target - net.playK;
      if (Math.abs(err) > 8) net.playK = target;
      else net.playK += err * Math.min(1, dt * 2);
    } else if (net.curK >= 0) net.playK = Math.min(net.playK + dt / SNAP_S, net.curK + EXTRAP_PKTS);
    const events: WorldEvent[] = [];
    const finishedBefore = this.world.finishedCount;
    while (q.length && q[0].k <= Math.floor(net.playK) + 1) {
      const m = q.shift()!;
      this.views.forEach((v, i) => {
        if (i !== me || !net.pred) v.prev = snap(this.world.racers[i].car);
      });
      // o estado anterior se perdeu no caminho: os eventos dele vêm repetidos neste
      if (net.curK >= 0 && m.k === net.curK + 2) for (const e of m.pe) events.push(e);
      applySnapshot(this.world, m.s);
      for (const e of m.s.events) events.push(e);
      // eventos importantes: cada id uma vez só (vêm repetidos em vários estados)
      for (const { i, e } of m.ie) {
        if (i < net.evMin || net.seenEv.has(i)) continue;
        net.seenEv.add(i);
        events.push(e);
      }
      if (net.seenEv.size > 500) for (const i of [...net.seenEv].slice(0, 250)) net.seenEv.delete(i);
      while (net.progs.length && net.progs[0].k <= m.k) applyProg(this.world, net.progs.shift()!);
      net.curK = m.k;
      net.lastSnapAt = performance.now();
      net.notes.clear();
      for (const r of m.aw) net.notes.set(r, 'fora da tela');
      for (const r of m.dc) net.notes.set(r, 'reconectando…');
      // contagem da largada em sintonia com a do host (que espera o "pronto" de todos)
      if (this.phase === 'countdown') this.countdown = m.s.started ? Math.min(this.countdown, 1e-3) : Math.max(m.cd, 1e-3);
    }
    this.world.events = events;
    // placar aberto: redesenha quando mais alguém cruza a linha
    if (this.world.finishedCount !== finishedBefore && this.onlineResultsOpen(net)) this.refreshOnlineResults();
  }

  /**
   * Convidado: quanto (s) o carro previsto está à frente do estado do host que aparece na tela: os
   * estados ainda na fila de reprodução mais os comandos que o host não aplicou (até 0,5 s).
   * `ahead`: o tanto que os projéteis já andam além do estado aplicado.
   */
  private ownShotLead(ahead: number): number {
    const net = this.net;
    if (!net || !this.isGuestRace() || !net.pred || net.curK < 0) return 0;
    const pending = net.history.reduce((n, h) => (h.n > net.lastAck ? n + 1 : n), 0);
    return clamp((net.lastK - net.curK) * SNAP_S + pending * DT - ahead, 0, 0.5);
  }

  /** Posição de interpolação entre o estado anterior e o aplicado por último (0..1). */
  private guestAlpha(net: Online): number {
    if (net.curK < 0) return 1;
    return clamp(net.playK + this.accumulator / SNAP_S - (net.curK - 1), 0, 1 + EXTRAP_PKTS);
  }

  /**
   * Convidado: prevê o próprio carro com os comandos locais (resposta imediata na direção). A cada
   * estado novo do host, parte do carro dele e refaz os comandos que o host ainda não tinha
   * aplicado; a diferença para a previsão anterior vira um erro visual que some em ~0,2 s. As
   * batidas contra os rivais (na posição em que aparecem na tela), as poças fixas, o óleo e a
   * derrapagem entram na previsão. `advance` false: conexão travada, o carro espera o host (ver
   * StallGuard). Devolve se o turbo/pulo saiu neste passo.
   */
  private predictOwn(net: Online, input: ControlInput, dt: number, advance = true): boolean {
    const r = this.world.racers[this.playerId];
    if (!r) return false;
    if (!this.world.started || !r.alive || r.progress.finished) {
      net.pred = null;
      net.own = null;
      net.predErr = { x: 0, y: 0, z: 0, h: 0 };
      return false;
    }
    // mesmas regras do host para poças fixas, óleo e derrapagem (stepDriver); as batidas contra os
    // rivais entram logo depois do movimento
    const human = !r.ai && this.world.difficulty !== 'hard';
    const hazards = this.world.hazards;
    // rivais na posição em que aparecem na tela: batidas logo depois do movimento e vácuo (mesmas regras do host)
    const rivals = r.finishPlace ? [] : this.shownRivals(net);
    const cars = rivals.map((o) => o.car);
    const contacts = (c: VehicleState) => {
      for (const o of rivals) carContact(c, r.spec.mass, o.car, o.mass);
    };
    const drive = (d: DriverState, i: ControlInput) => stepDriver(d, r.spec, i, this.playerId, human, this.track, hazards, dt, contacts, cars);
    let fired = false;
    if (net.own || !net.pred) {
      const before = net.pred?.car;
      const src = net.own?.d ?? { car: r.car, slipTime: r.slipTime, spinTime: r.spinTime, spinTotal: Math.max(0.05, r.spinTotal || 1), oilGrace: r.oilGrace };
      const d: DriverState = { ...src, car: { ...src.car } };
      const ack = net.own ? net.own.ack : Infinity;
      const kick = !!net.own?.kick;
      let replayed = false;
      for (const h of net.history) {
        if (h.n <= ack) continue;
        drive(d, h.i);
        fired = d.car.assistFired;
        replayed = true;
      }
      if (!replayed && advance) {
        drive(d, input);
        fired = d.car.assistFired;
      }
      if (before && !kick) {
        const err = net.predErr;
        err.x += before.x - d.car.x;
        err.y += before.y - d.car.y;
        err.z += before.z - d.car.z;
        err.h += Math.atan2(Math.sin(before.heading - d.car.heading), Math.cos(before.heading - d.car.heading));
        // teleporte (renasceu, erro grande): corrige de uma vez
        if (Math.hypot(err.x, err.z) > 6) net.predErr = { x: 0, y: 0, z: 0, h: 0 };
      } else if (kick) net.predErr = { x: 0, y: 0, z: 0, h: 0 }; // empurrão do host: sem suavizar
      net.pred = d;
      net.own = null;
    } else if (advance) {
      drive(net.pred, input);
      fired = net.pred.car.assistFired;
    }
    const pred = net.pred;
    pred.car.fell = false;
    const e = net.predErr;
    const k = Math.exp(-dt * 12);
    e.x *= k;
    e.y *= k;
    e.z *= k;
    e.h *= k;
    Object.assign(r.car, pred.car);
    r.car.x += e.x;
    r.car.y += e.y;
    r.car.z += e.z;
    r.car.heading += e.h;
    r.lastInput = input;
    return fired;
  }

  /**
   * Rivais vivos e na disputa na posição interpolada (ou extrapolada pela velocidade, até
   * EXTRAP_PKTS pacotes, quando a fila de estados esvazia) em que aparecem na tela. A previsão do
   * próprio carro bate e pega vácuo contra eles (os rivais vêm do host: cópias, nunca mexidas).
   */
  private shownRivals(net: Online): { car: VehicleState; mass: number }[] {
    const al = this.guestAlpha(net);
    const out: { car: VehicleState; mass: number }[] = [];
    const racers = this.world.racers;
    for (let i = 0; i < racers.length; i++) {
      const o = racers[i];
      if (i === this.playerId || !o.alive || o.finishPlace) continue;
      const p = this.views[i]?.prev;
      if (!p) continue;
      const car = { ...o.car };
      const pos = shownPos(p, o.car, al);
      car.x = pos.x;
      car.y = pos.y;
      car.z = pos.z;
      out.push({ car, mass: o.spec.mass });
    }
    return out;
  }

  /** Host online: a largada espera o "pronto" de todos os convidados (com prazo). */
  private hostWaiting(): boolean {
    const net = this.net;
    if (!net?.host || !net.waiting.size || this.setup.mode !== 'online') return false;
    for (const id of net.waiting) if (!net.racerOf.has(id)) net.waiting.delete(id);
    if (performance.now() > net.readyUntil) net.waiting.clear();
    return net.waiting.size > 0;
  }

  /**
   * Aba oculta: o convidado solta os controles e avisa (o host espera até 30 s antes de dar como
   * caído); o host avisa os convidados e segue simulando fora do rAF.
   */
  private onlineVisibility(): void {
    const net = this.net;
    if (!net) return this.hiddenTicker.stop();
    const hidden = document.hidden;
    if (net.client) {
      net.client.send({ t: hidden ? 'away' : 'back' } satisfies ClientMsg);
      net.client.setPatience(hidden || net.hostAway ? REJOIN_MS : DROP_MS);
      if (hidden && net.racing && this.setup.mode === 'online') {
        this.guestCommand(net, ++net.tick, emptyInput());
        net.client.sendFast({ t: 'input', c: net.cmds } satisfies ClientMsg);
      }
    }
    if (net.host) {
      net.host.broadcast({ t: 'hostAway', away: hidden } satisfies HostMsg);
      this.hostCpu(net, hidden);
      if (hidden && this.setup.mode === 'online') {
        this.hiddenLast = performance.now();
        this.hiddenTicker.start();
      } else this.hiddenTicker.stop();
    }
  }

  /**
   * Host com a aba oculta: a CPU pilota o carro dele (senão ficava parado na pista) e os convidados
   * veem "fora da tela"; ao voltar, o carro é devolvido.
   */
  private hostCpu(net: Online, away: boolean): void {
    const r = this.world.racers[this.playerId];
    const racing = this.setup.mode === 'online' && net.racing && !!r;
    if (away && racing && !r.finishPlace && !r.ai) {
      r.ai = LEFT_PLAYER_AI;
      net.hostCpu = true;
      net.notes.set(this.playerId, 'fora da tela');
    } else if (!away && net.hostCpu) {
      if (r && racing) r.ai = null;
      net.hostCpu = false;
      net.notes.delete(this.playerId);
    }
  }

  /** Host com convidados: pede confirmação antes de fechar a aba (a sala acaba para todos). */
  private onlineBeforeUnload(e: BeforeUnloadEvent): void {
    if (!this.net?.host?.guests) return;
    e.preventDefault();
    e.returnValue = '';
  }

  /** Página indo embora: o host avisa que a sala acabou (com o placar final). */
  private onlinePageHide(): void {
    const net = this.net;
    if (!net?.host) return;
    this.hostBye(net);
  }

  /** Host saindo: manda o fim (com o último estado, se havia corrida) e a despedida. */
  private hostBye(net: Online): void {
    const host = net.host;
    if (!host) return;
    const racing = net.racing && this.setup.mode === 'online';
    host.broadcast({ t: 'end', bye: true, ...(racing && { s: takeSnapshot(this.world, []) }) } satisfies HostMsg);
    net.racing = false;
  }

  /** Host com a aba oculta: passos da simulação fora do rAF (os convidados continuam correndo). */
  private hiddenTick(): void {
    const now = performance.now();
    const dt = Math.min((now - this.hiddenLast) / 1000, 1);
    this.hiddenLast = now;
    if (!document.hidden || !this.net?.host || this.setup.mode !== 'online') return this.hiddenTicker.stop();
    if (this.phase !== 'countdown' && this.phase !== 'racing' && this.phase !== 'finished') return;
    if (this.preparing && this.phase === 'countdown') return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= DT && steps < 60) {
      this.step(DT);
      this.accumulator -= DT;
      steps++;
    }
    if (steps === 60) this.accumulator = 0;
  }

  private onlineSetup(race: OnlineRace, you: number): RaceSetup {
    const me = race.entries[you];
    return {
      mode: 'online',
      trackId: race.trackId,
      opponents: [],
      playerName: me.name,
      playerColor: me.color,
      playerSpec: me.spec,
      prizes: PRIZES,
      difficulty: 'normal',
      pilot: me.name,
      online: { race, you },
    };
  }

  /** Host: monta o grid (CPUs na frente, amigos atrás) e manda todo mundo largar. */
  private onlineStart(trackId: string, fillCpu: boolean): void {
    const net = this.net;
    if (!net?.host || net.racing) return;
    const def = trackById(trackId);
    // quem caiu e ainda não voltou fica de fora desta
    const humans = net.players.filter((p) => !p.away);
    const base = this.quickSetup({ trackId: def.id, vehicleId: 'marauder', color: humans[0].color, difficulty: 'normal' });
    const used = new Set(humans.map((p) => p.color));
    const cpus: RacerEntry[] = (fillCpu ? base.opponents.slice(0, Math.max(0, MAX_PLAYERS - humans.length)) : []).map((o) => {
      const color = used.has(o.color) ? (COLORS.find((c) => !used.has(c)) ?? o.color) : o.color;
      used.add(color);
      return { name: o.name, color, spec: o.spec, ai: o.ai };
    });
    const people: RacerEntry[] = humans.map((p) => ({
      name: p.name,
      color: p.color,
      spec: this.quickSetup({ trackId: def.id, vehicleId: p.vehicleId, color: p.color, difficulty: 'normal' }).playerSpec,
      ai: null,
    }));
    const entries = [...cpus, ...people];
    const race: OnlineRace = {
      trackId: def.id,
      laps: clamp(Math.round(Number(new URLSearchParams(location.search).get('laps'))) || def.laps, 1, 20),
      seed: Math.floor(Math.random() * 0xffff) + 1,
      entries,
    };
    net.racerOf.clear();
    net.inputs = {};
    net.inputAt = {};
    net.ack = {};
    net.queues = {};
    net.events = [];
    net.prevEvents = [];
    net.notes.clear();
    net.hostCpu = false;
    net.important = [];
    net.progKeys = [];
    net.firstFinishAt = null;
    net.tick = 0;
    net.racing = true;
    net.inLobby = false;
    net.menuOpen = false;
    net.seats.clearRacers();
    this.netResults = {};
    humans.forEach((p, i) => {
      const racer = cpus.length + i;
      if (p.id === 'host') return;
      net.racerOf.set(p.id, racer);
      net.inputAt[racer] = performance.now();
      net.seats.setRacer(p.id, racer);
      net.host!.send(p.id, { t: 'start', race, you: racer, token: net.seats.tokenOf(p.id), k: net.seq } satisfies HostMsg);
    });
    // a contagem espera o "pronto" de todos (quem demora mais de 10 s fica para trás)
    net.waiting = new Set(net.racerOf.keys());
    net.readyUntil = performance.now() + READY_TIMEOUT_MS;
    this.setup = this.onlineSetup(race, cpus.length + humans.findIndex((p) => p.id === 'host'));
    this.startRace();
  }

  /** Host: todos os humanos terminaram? Pode voltar à sala sem perguntar? */
  private hostMustConfirm(net: Online): boolean {
    if (!net.host || !net.racing || this.setup.mode !== 'online') return false;
    const racers = [this.playerId, ...net.racerOf.values()];
    const done = racers.map((i) => !!this.world.racers[i]?.finishPlace);
    return !canCloseRace(done, net.firstFinishAt, performance.now());
  }

  /** O placar online está na tela (nem a sala nem o menu por cima). */
  private onlineResultsOpen(net: Online | null): boolean {
    return this.setup.mode === 'online' && this.phase === 'finished' && this.resultsShown && !net?.inLobby && !net?.menuOpen;
  }

  /** Como mostrar o placar online (nota, final ou parcial, confirmação do host). */
  private onlineResultsInfo(): OnlineResults {
    const net = this.net;
    const info: OnlineResults = { ...this.netResults };
    if (net?.host) {
      const confirm = this.hostMustConfirm(net);
      net.lastConfirm = confirm;
      info.confirm = confirm;
      info.final = !net.racing || [this.playerId, ...net.racerOf.values()].every((i) => !!this.world.racers[i]?.finishPlace);
    }
    return info;
  }

  /** Redesenha o placar online (alguém cruzou a linha, chegou a ordem final, o prazo venceu). */
  private refreshOnlineResults(): void {
    this.resultsShown = false;
    this.showResults();
  }

  /** Mostra o placar online agora (fim vindo do host, host caiu). */
  private showOnlineResults(): void {
    if (this.net) this.net.menuOpen = false;
    this.phase = 'finished';
    this.resultsTimer = Infinity;
    this.resultsShown = false;
    this.showResults();
  }

  /** Dos resultados de volta para a sala. No host, encerra a corrida para todos (com o placar final). */
  private onlineBackToLobby(): void {
    const net = this.net;
    if (!net) return this.toMenu();
    if (net.host && net.racing) {
      net.racing = false;
      net.host.broadcast({ t: 'end', s: takeSnapshot(this.world, []) } satisfies HostMsg);
    }
    this.showLobby();
    this.lobbyChanged();
  }

  private closeNet(): void {
    this.netToken++;
    this.hiddenTicker.stop();
    const net = this.net;
    if (net?.timer) clearInterval(net.timer);
    net?.host?.close();
    net?.client?.close();
    this.net = null;
    this.hud.setPing(undefined);
    this.hud.setNetWarning(null);
  }

  private onlineLeave(): void {
    const net = this.net;
    if (net?.host) {
      // a despedida precisa de um instante para sair antes de fechar a sala
      this.hostBye(net);
      const host = net.host;
      net.host = null;
      setTimeout(() => host.close(), 400);
    }
    if (net?.client) {
      // saiu de propósito: o host não guarda a vaga (o "saí" sai antes de a conexão fechar)
      net.client.leave({ t: 'leave' } satisfies ClientMsg);
      net.client = null;
    }
    // convidado (também cancelando a entrada ou a reconexão): recarregar não volta mais para a sala
    if (net?.role !== 'host') storeRejoin(net?.code ?? '', null);
    this.closeNet();
    this.toMenu();
  }

  private onlineLost(text: string): void {
    this.closeNet();
    this.endShowroom();
    this.phase = 'menu';
    this.engine.stop();
    this.engine2?.stop();
    this.announcer.stop();
    this.hud.setVisible(false);
    this.screen = 'main';
    this.menus.showOnlineNotice(text);
  }

  /**
   * Perseguição: rival colado na câmera (< ~3 m) ou entre ela e o jogador some com um atraso curto
   * (sem trocar materiais: nenhum shader novo) e a câmera sobe um pouco para enxergar por cima.
   */
  private chaseOcclusion(pose: { x: number; y: number; z: number }, dt: number): void {
    const chase = this.rig.mode === 'chase';
    const cam = this.rig.persp.position;
    const px = pose.x - cam.x;
    const py = pose.y + 0.8 - cam.y;
    const pz = pose.z - cam.z;
    const len2 = px * px + py * py + pz * pz;
    let lift = 0;
    for (let i = 0; i < this.views.length; i++) {
      if (i === this.playerId) continue;
      const view = this.views[i];
      const root = view.visual.root;
      let want = 1;
      if (chase && root.visible) {
        const rx = root.position.x - cam.x;
        const ry = root.position.y + 0.8 - cam.y;
        const rz = root.position.z - cam.z;
        const dist = Math.hypot(rx, ry, rz);
        const t = len2 > 0 ? (rx * px + ry * py + rz * pz) / len2 : 0;
        // distância do rival à linha câmera → jogador (só no trecho antes do jogador)
        const block = t > 0 && t < 0.85 && Math.hypot(rx - px * t, ry - py * t, rz - pz * t) < 1.9 * CAR_SCALE;
        if (dist < 3.2 || block) want = 0;
        if (t > -0.3 && t < 1.1 && dist < 8) lift = Math.max(lift, 1 - dist / 8);
      }
      // só na perseguição; nas outras câmeras volta a 1 na hora (sem depender de dt > 0)
      view.ghost = nextGhost(view.ghost, want, dt, chase);
      if (!ghostVisible(view.ghost)) root.visible = false;
    }
    this.rig.chaseLift = lift;
  }

  private render(alpha: number, frameDt: number, simulating: boolean, ahead: number): void {
    const pf = this.prof !== null;
    let t0 = pf ? performance.now() : 0;
    const world = this.world;
    let playerPose: { x: number; y: number; z: number; heading: number } | null = null;
    const poseOut = this.playerPoseTmp;
    const split = this.splitView;
    const p2 = split ? this.p2 : -1;

    // laço simples (sem closure por quadro)
    for (let i = 0; i < world.racers.length; i++) {
      const r = world.racers[i];
      const view = this.views[i];
      const v = r.car;
      const p = view.prev;
      // convidado online: o próprio carro é previsto a cada passo local (interpola como fora do online)
      const al = i === this.playerId && this.net?.pred ? this.accumulator / DT : alpha;
      // convidado sem estado novo: os rivais seguem pela velocidade (al > 1, ver shownPos)
      const ext = al > 1 ? shownPos(p, v, al) : null;
      const x = ext ? ext.x : lerp(p.x, v.x, al);
      const y = ext ? ext.y : lerp(p.y, v.y, al);
      const z = ext ? ext.z : lerp(p.z, v.z, al);
      const heading = lerpAngle(p.heading, v.heading, Math.min(al, 1));
      const visual = view.visual;
      visual.root.visible = !this.showcase && r.alive && (r.invuln <= 0 || Math.sin(this.clock * 30) > -0.3);
      // cruzou a chegada: o carro para e escurece, fora da disputa (como no original)
      setCarDark(view, !!r.finishPlace && !this.showcase);
      visual.root.position.set(x, y, z);
      visual.root.rotation.set(-lerp(p.pitch, v.pitch, Math.min(al, 1)), heading, lerp(p.roll, v.roll, Math.min(al, 1)), 'YXZ');
      visual.animate({ spin: v.wheelSpin, steer: v.steer, speed: forwardSpeed(v), time: this.clock, grounded: v.grounded, roll: view.susp.roll, pitch: view.susp.pitch });
      this.suspension(view, r, frameDt, i === this.playerId || i === p2);
      // chamas do nitro: apagadas no carro que já chegou (escurecido); coladas na câmera
      // (perseguição/cockpit, < 6 m) encolhem para não estourar a tela
      // (também os rivais: as turbinas do Havac à frente viravam discos brancos no cockpit)
      const camD = this.rig.mode !== 'iso' ? Math.hypot(x - this.rig.active.position.x, y - this.rig.active.position.y, z - this.rig.active.position.z) : 99;
      for (const f of visual.flames) {
        f.visible = r.alive && v.nitroTime > 0 && !r.finishPlace;
        if (f.visible) f.scale.setScalar((0.8 + Math.random() * 0.5) * (camD < 10 ? Math.max(0.3, camD / 10) : 1));
      }
      // sombra de contato no chão, some conforme o carro sobe num salto
      const ground = world.track.query(x, z, v.pieceIndex).height;
      const lift = y - ground;
      view.shadow.visible = r.alive && !this.showcase;
      view.shadow.position.set(x, ground + 0.03, z);
      view.shadow.rotation.y = heading;
      (view.shadow.material as THREE.MeshBasicMaterial).opacity = clamp(1 - lift / 4, 0, 1);
      view.shadow.scale.setScalar(1 + lift * 0.08);
      // (tela dividida: o anel vai para baixo do carro de cada jogador na hora de desenhar a metade dele)
      if (i === this.playerId && !split) this.effects.markPlayer(x, ground, z, heading, r.alive && !this.showcase && this.rig.mode !== 'cockpit', this.rig.mode !== 'iso');
      if (view.label) {
        // no cockpit e bem de perto na perseguição, a etiqueta taparia a visão
        const near = this.rig.mode !== 'iso' && Math.hypot(x - this.rig.active.position.x, z - this.rig.active.position.z) < 9;
        // colado no jogador (< 3 m) a etiqueta cairia sobre o carro dele
        const pc = world.racers[this.playerId]?.car;
        const onPlayer = !!pc && Math.hypot(x - pc.x, z - pc.z) < 3;
        view.label.sprite.visible = r.alive && !r.finishPlace && this.phase !== 'menu' && this.rig.mode !== 'cockpit' && !near && !onPlayer && !this.showcase;
        view.label.sprite.position.set(x, y + 3.4, z);
        view.label.update(r.armor / r.spec.armor, r.place, this.net?.notes.get(i) ?? '');
      }
      // fumaça (e fogo) quando a blindagem está baixa
      const ratio = r.armor / r.spec.armor;
      if (r.alive && ratio < 0.5 && simulating) {
        view.smokeTimer -= frameDt;
        if (view.smokeTimer <= 0) {
          view.smokeTimer = ratio < 0.25 ? 0.04 : 0.1;
          this.effects.puff(x, y + 1.2, z, ratio < 0.25 ? 0x1a1a1a : 0x4a4a4a, 0.8);
          if (ratio < 0.25) this.effects.flame(x, y + 1.1, z);
        }
      }
      // derrapagem: marcas de pneu + fumaça; em terra, poeira; nitro: jato azul
      if (r.alive && simulating && v.grounded) {
        view.fxTimer -= frameDt;
        const spd = Math.abs(forwardSpeed(v));
        if (view.fxTimer <= 0 && spd > 4) {
          view.fxTimer = 0.035;
          const dirt = THEMES[this.track.def.theme].surface === 'dirt';
          const drift = v.drift ?? 0;
          const back = -1.2 * CAR_SCALE;
          // os dois lados sem montar um vetor [1, -1] por carro a cada quadro
          for (let side = 1; side >= -1; side -= 2) {
            const wx = x + forwardX(heading) * back + leftX(heading) * side * 0.95 * CAR_SCALE;
            const wz = z + forwardZ(heading) * back + leftZ(heading) * side * 0.95 * CAR_SCALE;
            if (drift > 0.25 || v.nitroTime > 0) this.effects.skid(wx, ground, wz, heading);
            if (drift > 0.35 && Math.random() < drift) this.effects.dust(wx, ground, wz, dirt ? 0xb08a60 : 0xc8c4c0, 0.8 + drift * 0.6);
            else if (dirt && spd > 12 && Math.random() < 0.35) this.effects.dust(wx, ground, wz, 0xb08a60, 0.7);
            // em alta velocidade, um véu leve de poeira na cor do piso (sensação de velocidade)
            else if (spd > r.spec.maxSpeed * 0.7 && Math.random() < 0.18) this.effects.dust(wx, ground, wz, this.speedDust, 0.45);
          }
        }
      }
      if (r.alive && v.nitroTime > 0 && simulating) {
        const bx = x - forwardX(heading) * 2.4 * CAR_SCALE;
        const bz = z - forwardZ(heading) * 2.4 * CAR_SCALE;
        this.effects.nitro(bx, y + 0.55 * CAR_SCALE, bz, heading, forwardSpeed(v));
      }
      if (i === p2) {
        visual.steeringWheel.rotation.z = v.steer * 1.6;
        const o2 = this.playerPoseTmp2;
        o2.x = x;
        o2.y = y;
        o2.z = z;
        o2.heading = heading;
      }
      if (i === this.playerId) {
        visual.body.position.y = clamp(this.bounce, -0.25, 0.15);
        if (this.rig.mode === 'cockpit') visual.body.rotation.set(0, 0, 0);
        visual.steeringWheel.rotation.z = v.steer * 1.6;
        poseOut.x = x;
        poseOut.y = y;
        poseOut.z = z;
        poseOut.heading = heading;
        playerPose = poseOut;
      }
    }

    const pv = this.views[this.playerId].visual;
    const pose = playerPose ?? ZERO_POSE;
    pv.root.updateMatrixWorld();
    const pc = this.player.car;
    this.rig.update(
      {
        position: this.poseTmp.position.set(pose.x, pose.y, pose.z),
        quaternion: pv.root.quaternion,
        heading: pose.heading,
        velocity: this.poseTmp.velocity.set(pc.vx, pc.vy, pc.vz),
        shake: this.shake,
        eye: pv.eye,
        track: this.track,
        pieceIndex: pc.pieceIndex,
      },
      frameDt,
    );
    if (split) {
      const pv2 = this.views[p2].visual;
      const pose2 = this.playerPoseTmp2;
      const c2 = this.world.racers[p2].car;
      pv2.root.updateMatrixWorld();
      this.rig2.update(
        {
          position: this.poseTmp.position.set(pose2.x, pose2.y, pose2.z),
          quaternion: pv2.root.quaternion,
          heading: pose2.heading,
          velocity: this.poseTmp.velocity.set(c2.vx, c2.vy, c2.vz),
          shake: this.shake2,
          eye: pv2.eye,
          track: this.track,
          pieceIndex: c2.pieceIndex,
        },
        frameDt,
      );
      // (sem o carro fantasma da perseguição: o rival que some numa metade apareceria na outra)
      this.rig.chaseLift = this.rig2.chaseLift = 0;
    } else this.chaseOcclusion(pose, frameDt);
    if (pf) t0 = this.lap('render:carros', t0);
    // convidado: os tiros dele saem do carro previsto (à frente do estado do host): desenha os
    // projéteis dele adiantados pelo mesmo tanto, senão nasciam atrás do carro
    const lead = simulating ? this.ownShotLead(ahead) : 0;
    if (lead > 0) {
      const real = world.projectiles;
      const me = this.playerId;
      world.projectiles = real.map((p) => (p.owner === me ? { ...p, x: p.x + forwardX(p.heading) * p.speed * lead, z: p.z + forwardZ(p.heading) * p.speed * lead } : p));
      this.effects.update(world, frameDt, ahead);
      world.projectiles = real;
    } else this.effects.update(world, simulating ? frameDt : 0, simulating ? ahead : 0);
    if (pf) t0 = this.lap('render:efeitos', t0);

    // na vitrine a sombra acompanha os carros expostos (fora do grid)
    const lit = this.showcase?.center ?? pose;
    this.sun.position.set(lit.x, lit.y, lit.z).addScaledVector(SUN_DIR, 90);
    this.sun.target.position.set(lit.x, lit.y, lit.z);
    this.sky?.position.copy(this.rig.active.position);

    const r = this.player;
    const speed = forwardSpeed(pc);
    if (this.phase !== 'menu' && this.phase !== 'paused' && !this.frozenResults()) {
      this.hud.update(frameDt, this.fillHud(r, speed));
      // derrapagem: velocidade lateral em relação à direção do carro (pneus cantando)
      const lateral = Math.abs(pc.vx * Math.cos(pc.heading) - pc.vz * Math.sin(pc.heading));
      // (esterçar em alta não basta: só canta quando o carro escorrega de lado de verdade)
      const slip = !r.alive || !pc.grounded ? 0 : r.spinTime > 0 ? 1 : clamp((lateral - 3) / 8, 0, 1);
      // resultados na tela (também no online, em que a prova segue rodando): motores calados
      const engineOn = !this.resultsShown;
      if (engineOn) this.engine.update(clamp(Math.abs(speed) / r.spec.maxSpeed, 0, 1.3), r.alive ? r.lastInput.throttle : 0, pc.nitroTime > 0, slip);
      if (split) {
        // jogador 2: HUD e motor próprios
        const r2 = world.racers[p2];
        const c2 = r2.car;
        const speed2 = forwardSpeed(c2);
        this.hud2?.update(frameDt, this.fillHud(r2, speed2, true));
        const lat2 = Math.abs(c2.vx * Math.cos(c2.heading) - c2.vz * Math.sin(c2.heading));
        const slip2 = !r2.alive || !c2.grounded ? 0 : r2.spinTime > 0 ? 1 : clamp((lat2 - 3) / 8, 0, 1);
        if (engineOn) this.engine2?.update(clamp(Math.abs(speed2) / r2.spec.maxSpeed, 0, 1.3), r2.alive ? r2.lastInput.throttle : 0, c2.nitroTime > 0, slip2);
      }
      // rivais audíveis: os mais próximos, com pan e Doppler pela velocidade de aproximação
      const near = this.nearList;
      near.length = 0;
      for (const o of engineOn ? world.racers : []) {
        if (o.id === this.playerId || o.id === p2 || !o.alive) continue;
        const dx = o.car.x - pc.x;
        const dz = o.car.z - pc.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 45) continue;
        const closing = -((o.car.vx - pc.vx) * dx + (o.car.vz - pc.vz) * dz) / Math.max(dist, 1);
        // objetos reaproveitados (o motor dos rivais não guarda a lista)
        const e = this.nearPool[near.length] ?? (this.nearPool[near.length] = { speedRatio: 0, throttle: 0, dist: 0, pan: 0, closing: 0 });
        e.speedRatio = Math.abs(forwardSpeed(o.car)) / o.spec.maxSpeed;
        e.throttle = o.lastInput.throttle;
        e.dist = dist;
        e.pan = this.pan(o.car.x, o.car.z);
        e.closing = closing;
        near.push(e);
      }
      if (near.length > 1) near.sort(byDist);
      if (engineOn) this.rivalEngines.update(near);
    }
    if (pf) t0 = this.lap('render:hudSom', t0);

    const w = this.width;
    const h = this.height;
    if (split) {
      this.renderSplit(w, h, pose);
      if (pf) this.lap('render:gpu', t0);
      return;
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    // (a tela dividida troca a cabine do carro por quadro: aqui volta ao que a câmera do jogador 1 pede)
    this.cockpitLook(this.playerId, this.rig.mode === 'cockpit');
    const cam = this.showcase?.cam ?? this.rig.active;
    if (this.showcase) {
      this.showcase.cam.aspect = w / h;
      this.showcase.cam.updateProjectionMatrix();
    }
    // sombras a cada ~25 ms: a 60 qps, um quadro sim e outro não (a passada de sombra é ~1/3 das
    // chamadas de desenho e 40% dos triângulos); a 30 qps, todo quadro. A sombra do carro atrasa no
    // máximo 1/60 s, imperceptível; a do cenário não muda (o mapa guarda a matriz com que foi feito)
    // Economia de bateria: a cada 3 quadros desenhados. Sombra apagada pela queda automática
    // (intensidade 0 até a próxima largada): o mapa não é mais redesenhado
    if (this.sun.castShadow && this.sun.shadow.intensity > 0) {
      if (this.onBattery ? this.drawn % ECO_SHADOW_EVERY === 0 : this.clock - this.shadowAt >= 0.024 || this.clock < this.shadowAt) {
        this.renderer.shadowMap.needsUpdate = true;
        this.shadowAt = this.clock;
      }
    }
    if (this.postfx) this.postfx.render(cam);
    else this.renderer.render(this.scene, cam);

    if (this.rig.mode === 'cockpit' && this.phase !== 'menu') {
      const m = this.mirrorRect();
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(m.x, h - m.y - m.h, m.w, m.h);
      this.renderer.setViewport(m.x, h - m.y - m.h, m.w, m.h);
      this.renderer.render(this.scene, this.rig.mirror);
      this.renderer.setScissorTest(false);
    }
    if (pf) this.lap('render:gpu', t0);
  }

  /**
   * Tela dividida: cada jogador na sua metade (lado a lado), com a câmera, o cockpit, o anel sob o
   * carro, as etiquetas dos rivais e o sol dele. Sem bloom (o pós-processamento é da tela inteira).
   */
  private renderSplit(w: number, h: number, pose1: { x: number; y: number; z: number; heading: number }): void {
    const half = Math.floor(w / 2);
    const pose2 = this.playerPoseTmp2;
    const r1 = this.world.racers[this.playerId];
    const r2 = this.world.racers[this.p2];
    // perto um do outro, uma sombra só (centrada entre os dois) serve para as duas metades
    const shared = Math.hypot(pose1.x - pose2.x, pose1.z - pose2.z) < 40;
    const shadowsOn = this.sun.castShadow && this.sun.shadow.intensity > 0;
    if (shared) {
      this.sun.position.set((pose1.x + pose2.x) / 2, (pose1.y + pose2.y) / 2, (pose1.z + pose2.z) / 2);
      this.sun.target.position.copy(this.sun.position);
      this.sun.position.addScaledVector(SUN_DIR, 90);
      if (shadowsOn && (this.onBattery ? this.drawn % ECO_SHADOW_EVERY === 0 : this.clock - this.shadowAt >= 0.024 || this.clock < this.shadowAt)) {
        this.renderer.shadowMap.needsUpdate = true;
        this.shadowAt = this.clock;
      }
    }
    this.renderer.setScissorTest(true);
    for (let k = 0; k < 2; k++) {
      const rig = k ? this.rig2 : this.rig;
      const pose = k ? pose2 : pose1;
      const me = k ? r2 : r1;
      const x0 = k ? half : 0;
      const vw = k ? w - half : half;
      // cockpit: só o carro dono desta metade troca a cabine pelo painel
      this.cockpitLook(this.playerId, !k && rig.mode === 'cockpit');
      this.cockpitLook(this.p2, !!k && rig.mode === 'cockpit');
      const ground = this.track.query(pose.x, pose.z, me.car.pieceIndex).height;
      this.effects.markPlayer(pose.x, ground, pose.z, pose.heading, me.alive && rig.mode !== 'cockpit', rig.mode !== 'iso');
      this.splitTags(rig, me);
      if (!shared) {
        this.sun.position.set(pose.x, pose.y, pose.z).addScaledVector(SUN_DIR, 90);
        this.sun.target.position.set(pose.x, pose.y, pose.z);
        if (shadowsOn) this.renderer.shadowMap.needsUpdate = true;
      }
      this.sky?.position.copy(rig.active.position);
      this.renderer.setViewport(x0, 0, vw, h);
      this.renderer.setScissor(x0, 0, vw, h);
      this.renderer.render(this.scene, rig.active);
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
  }

  /** Mostra o painel (cockpit) ou a cabine de um carro. */
  private cockpitLook(id: number, cockpit: boolean): void {
    const view = this.views[id];
    if (!view || view.visual.cockpit.visible === cockpit) return;
    view.visual.cockpit.visible = cockpit;
    for (const c of view.visual.cabin) c.visible = !cockpit;
  }

  /** Etiquetas dos rivais na metade de um jogador (some no cockpit, colada na câmera ou no carro dele). */
  private splitTags(rig: CameraRig, me: Racer): void {
    const cam = rig.active.position;
    for (let i = 0; i < this.views.length; i++) {
      const label = this.views[i].label;
      if (!label) continue;
      const r = this.world.racers[i];
      const pos = label.sprite.position;
      const near = rig.mode !== 'iso' && Math.hypot(pos.x - cam.x, pos.z - cam.z) < 9;
      const onMe = Math.hypot(pos.x - me.car.x, pos.z - me.car.z) < 3;
      label.sprite.visible = r.alive && !r.finishPlace && rig.mode !== 'cockpit' && !near && !onMe;
    }
  }
}
