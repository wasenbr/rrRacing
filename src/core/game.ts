import { DynamicResolution, resolveQuality, type QualityPref, type QualitySettings } from '../render/quality';
import * as THREE from 'three';
import { Announcer, Commentary } from '../audio/announcer';
import { resumeAudio, setAudioLite, setSfxEnabled, suspendAudio, toggleMute, unlockAudio } from '../audio/context';
import { Music } from '../audio/music';
import { EngineSound, RivalEngines, type RivalEngineInput } from '../audio/engine';
import { sfxAssist, sfxBump, sfxBurn, sfxCountdown, sfxDrop, sfxExplosion, sfxFall, sfxFire, sfxHit, sfxLand, sfxLap, sfxPickup, sfxSkid, sfxWall, prepareSfx } from '../audio/sfx';
import { trackById, TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  advanceEarly, applyRaceResult, currentPlanet, moneyScale, planetCount, seasonInfo, shopLevel, difficultyOf, currentTrackId, decodeSave, DIVISIONS, encodeSave, newCampaign, opponentsFor, PLANETS, playerSpec, prizesFor,
  type CampaignState,
} from '../sim/campaign';
import { buildSpec, carSwapCost, CHARACTERS, chargePrice, newCarSetup, upgradePrice } from '../sim/garage';
import { deleteSlot, listSlots, loadCampaign, loadFromSlot, loadPrefs, saveCampaign, savePrefs, saveToSlot } from './storage';
import { canInstall, fullscreenSupported, initPwa, initViewport, isFullscreen, isInstalled, isIos, onFullscreenChange, onInstallChange, promptInstall, quitGame, toggleFullscreen } from '../ui/pwa';
import { Controls, createTouchControls, isTouchDevice, setTouchAutoThrottle, setTouchWeapons } from '../input/controls';
import { CAMERA_LABELS, CameraRig, type CameraMode } from '../render/cameras';
import { createCarMesh, type CarVisual } from '../render/cars';
import { Effects } from '../render/effects';
import { buildEnvironment, buildGround, buildSky, SUN_DIR } from '../render/environment';
import { contactShadow, setMaxAnisotropy } from '../render/textures';
import { freezeStatic, mergeStatic } from '../render/merge';
import { PostFx } from '../render/postfx';
import { RivalTag } from '../render/rivalTag';
import { buildScenery } from '../render/scenery';
import { levelTheme, THEMES } from '../render/themes';
import { buildTrackMesh } from '../render/trackMesh';
import { setRoadDetail } from '../render/trackStyle';
import { emptyInput, type ControlInput } from '../sim/input';
import { clamp, forwardX, forwardZ, leftX, leftZ, lerp, lerpAngle } from '../sim/math';
import { Track, type TrackDef } from '../sim/track';
import { CAR_SCALE, forwardSpeed, stepVehicle, type VehicleSpec, type VehicleState } from '../sim/vehicle';
import { createWorld, PRIZES, stepWorld, type Difficulty, type Racer, type RacerEntry, type World, type WorldEvent } from '../sim/world';
import type { AiProfile } from '../sim/ai';
import { Hud, ICONS, formatTime, type HudCar, type HudData } from '../ui/hud';
import { icon } from '../ui/icons';
import { setIdlePaused } from '../ui/idleQueue';
import { COLORS, Menus, WEAPON_LABEL, type CampaignReport, type HubData, type LobbyView, type NewCampaignOptions, type OnlineOptions, type QuickOptions, type ResultRow } from '../ui/menus';
import { NetClient, NetHost, netErrorText, normalizeCode } from '../net/peer';
import { applySnapshot, MAX_PLAYERS, parseHello, parseLobbyPlayers, parseStart, pickColor, sanitizeInput, takeSnapshot, validateSnap, cleanName, type ClientMsg, type HostMsg, type LobbyPlayer, type OnlineRace, type WorldSnap } from '../net/sync';
import { HiddenTicker } from '../net/ticker';

const DT = 1 / 60;
const COUNTDOWN = 3;
/** ?semlimite: sem a trava de 30 qps do nível baixo (medição comparativa) */
const NO_CAP30 = typeof location !== 'undefined' && new URLSearchParams(location.search).has('semlimite');
/** online: o host manda o estado a cada 3 passos (20x por segundo) */
const SNAP_EVERY = 3;
const SNAP_S = SNAP_EVERY * DT;
/** online: o convidado mostra os outros carros ~100 ms atrás do estado mais novo (2 pacotes de folga) */
const SNAP_BUFFER = 2;
/** online: fila máxima de estados guardados no convidado (aba oculta não acumula sem fim) */
const SNAP_QUEUE = 40;
/** online: sem comando do convidado por esse tempo, o host solta os controles do carro dele */
const INPUT_STALE_MS = 500;
/** online: a largada espera o "pronto" de todos no máximo esse tempo */
const READY_TIMEOUT_MS = 10000;
/** quem sai no meio da corrida vira CPU */
const LEFT_PLAYER_AI: AiProfile = { skill: 0.8, aggression: 0.7, lane: 0.5 };
/** ids de carro aceitos da rede (o primeiro é o padrão quando vem um inválido) */
const vehicleIds = (): string[] => ['marauder', ...Object.keys(VEHICLES).filter((k) => k !== 'marauder')];

/** Estado recebido do host, com a sequência, os comandos confirmados e a contagem. */
interface NetSnap {
  s: WorldSnap;
  k: number;
  a: number[];
  cd: number;
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
  /** convidado: estado mais novo do próprio carro vindo do host, ainda não usado na previsão */
  own: { car: VehicleState; ack: number } | null;
  /** convidado: carro previsto localmente e o erro visual que ainda está sendo desfeito */
  pred: VehicleState | null;
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
  private prefs = loadPrefs({ camera: 'iso' as CameraMode, music: true, sfx: true, announcer: true, musicVolume: 0.7, autoThrottle: false, quality: 'auto' as QualityPref, battery: false });
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
  private phase: Phase = 'menu';
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
  /** algo mudou na pausa (tamanho, câmera): redesenhar uma vez */
  private redraw = true;
  /** a resolução atual é a dos menus (reduzida) */
  private menuRes = false;
  /** fila de miniaturas/retratos dos menus parada (corrida na tela) */
  private idlePaused = false;
  /** corrida limitada a 30 qps (nível baixo em aparelho lento) e média do tempo de quadro que decide */
  private cap30 = false;
  private slowAvg = 1 / 60;
  /** relógio da última atualização do mapa de sombras */
  private shadowAt = -Infinity;
  /** opção "Economia de bateria": corrida a 30 qps para gastar menos */
  private onBattery = false;
  /** degraus de queda automática já aplicados (luzes dos clarões → sombra → partículas → 30 qps) */
  private degrade = 0;
  private degradeCd = 0;
  /** tamanho da tela (guardado no resize: ler clientWidth por quadro força layout) */
  private width = 1;
  private height = 1;
  /** o contexto WebGL foi perdido (GPU reiniciada): não desenha até voltar */
  private glLost = false;
  private glNotice: HTMLElement | null = null;
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
  private showcase: { group: THREE.Group; cam: THREE.PerspectiveCamera; center: THREE.Vector3; heading: number } | null = null;
  private net: Online | null = null;
  /** host online com a aba oculta: a simulação segue fora do rAF */
  private hiddenTicker = new HiddenTicker(() => this.hiddenTick());
  private hiddenLast = 0;
  /** cancela uma conexão em andamento quando o jogador desiste */
  private netToken = 0;

  constructor(private root: HTMLElement) {
    this.quality = resolveQuality(this.prefs.quality, this.touch);
    // economia de bateria: escolha do jogador nas opções (getBattery não existe no Safari/Firefox)
    this.onBattery = !!this.prefs.battery;
    // áudio leve (reverb curto, sem oversampling, 1 rival) no toque e no nível baixo
    if (this.touch || this.quality.level === 'baixo') setAudioLite(true);
    this.shadows = this.quality.shadows;
    this.effects.setDensity(this.quality.particles);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'default' });
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
    this.rig.mode = this.prefs.camera;
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
      if (a === 'pause') this.togglePause();
      if (a === 'mute') this.hud.showToast(toggleMute() ? '🔇 Som desligado' : '🔊 Som ligado');
      if (a === 'fullscreen') void toggleFullscreen();
    });
    initViewport(root, () => this.resize());
    // Ctrl é o tiro no PC: um Ctrl+W acidental pede confirmação em vez de fechar a corrida
    window.addEventListener('beforeunload', (e) => {
      if (this.phase === 'racing' || this.phase === 'countdown') e.preventDefault();
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

    document.addEventListener('visibilitychange', () => this.onlineVisibility());

    // cenário de fundo do menu: a primeira pista, com os carros parados no grid
    this.setup = this.quickSetup({ trackId: TRACKS[0].id, vehicleId: 'marauder', color: 0x2f7bff, difficulty: 'normal' });
    this.createRace();
    this.resize();
    this.menus.showMain(!!this.campaign);
    // link de convite (?sala=ABCD): abre direto a tela para entrar na sala
    const room = normalizeCode(new URLSearchParams(location.search).get('sala') ?? '');
    if (room.length === 4) {
      this.menus.showOnline(room);
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
    const scenery = buildScenery(this.track, theme, def.theme, this.shadows, def.id.length * 7 + 3, this.quality.dense);
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

  private campaignSetup(c: CampaignState): RaceSetup {
    return {
      mode: 'campaign',
      trackId: currentTrackId(c),
      opponents: opponentsFor(c, VEHICLES),
      playerName: 'Você',
      playerColor: c.color,
      playerSpec: playerSpec(c, VEHICLES),
      prizes: prizesFor(c),
      difficulty: difficultyOf(c),
      moneyScale: moneyScale(c),
      pilot: c.characterId,
    };
  }

  /** Monta o grid: os 3 rivais largam na frente, o jogador por último (como no original). */
  /**
   * Vitrine: os 5 carros lado a lado na largada da pista atual, com câmera em perspectiva
   * orbitando no ângulo dado (rad). Usada pelo script de evidências para avaliar os modelos.
   */
  showroom(angle: number): void {
    if (!this.showcase) {
      const group = new THREE.Group();
      const p = this.track.pieces[0];
      const ids = Object.keys(VEHICLES);
      ids.forEach((id, k) => {
        const colors = [0xe02828, 0x2f7bff, 0xf2c318, 0x2fc840, 0xb040e0];
        const car = createCarMesh(id, colors[k % colors.length], this.shadows);
        const lat = (k - (ids.length - 1) / 2) * 2.6 * CAR_SCALE;
        const fwd = 6 + (k % 2) * 1.2;
        car.root.position.set(
          p.x0 + leftX(p.heading0) * lat + forwardX(p.heading0) * fwd,
          p.h0,
          p.z0 + leftZ(p.heading0) * lat + forwardZ(p.heading0) * fwd,
        );
        car.root.rotation.y = p.heading0;
        group.add(car.root);
      });
      const cam = new THREE.PerspectiveCamera(38, this.width / this.height, 0.1, 600);
      this.scene.add(group);
      this.showcase = { group, cam, center: new THREE.Vector3(p.x0 + forwardX(p.heading0) * 6.6, p.h0 + 0.8, p.z0 + forwardZ(p.heading0) * 6.6), heading: p.heading0 };
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
    const a = sc.heading + angle;
    sc.cam.position.set(sc.center.x + Math.sin(a) * 15, sc.center.y + 4.2, sc.center.z + Math.cos(a) * 15);
    sc.cam.lookAt(sc.center);
    this.sun.position.copy(sc.center).addScaledVector(SUN_DIR, 90);
    this.sun.target.position.copy(sc.center);
  }

  private endShowroom(): void {
    if (!this.showcase) return;
    this.scene.remove(this.showcase.group);
    disposeTree(this.showcase.group);
    this.showcase = null;
  }

  private createRace(): void {
    this.endShowroom();
    const setup = this.setup;
    this.raceKey = raceKeyOf(setup);
    this.loadTrack(trackById(setup.trackId));
    // projéteis, minas e poças da corrida anterior não passam para a próxima
    this.effects.reset();
    if (setup.online) {
      // online: o grid, as voltas e a semente vêm do host (iguais em todos os aparelhos)
      const race = setup.online.race;
      this.playerId = setup.online.you;
      this.world = createWorld(this.track, race.entries.map((e) => ({ ...e })), race.laps, race.seed, setup.prizes, setup.difficulty);
    } else {
      const used = new Set([setup.playerColor]);
      const spare = [0xe02828, 0xf2c318, 0xb040e0, 0x2f7bff, 0xf0f0f0, 0x2fc840];
      const entries: RacerEntry[] = setup.opponents.map((o) => {
        let color = o.color;
        if (used.has(color)) color = spare.find((c) => !used.has(c)) ?? color;
        used.add(color);
        return { name: o.name, color, spec: o.spec, ai: o.ai };
      });
      // ?autopilot na URL: o carro do jogador é pilotado pela IA (demonstração/testes)
      const autopilot = new URLSearchParams(location.search).has('autopilot') ? { skill: 0.85, aggression: 0.8, lane: 0.5 } : null;
      entries.push({ name: setup.playerName, color: setup.playerColor, spec: setup.playerSpec, ai: autopilot });
      this.playerId = entries.length - 1;
      // ?laps=N na URL muda o número de voltas (útil para testar)
      const laps = Number(new URLSearchParams(location.search).get('laps')) || this.track.def.laps;
      this.world = createWorld(this.track, entries, laps, (Date.now() & 0xffff) + 1, setup.prizes, setup.difficulty, setup.moneyScale);
    }

    const old = this.views;
    this.views = this.world.racers.map((r, i) => {
      const visual = createCarMesh(r.spec.id, r.color, this.shadows);
      this.scene.add(visual.root);
      const label = i !== this.playerId ? new RivalTag(r.name, r.color) : null;
      if (label) this.scene.add(label.sprite);
      const shadow = new THREE.Mesh(
        this.shadowGeo,
        new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      );
      shadow.renderOrder = 1;
      this.scene.add(shadow);
      return { visual, prev: snap(r.car), label, smokeTimer: 0, fxTimer: 0, shadow, susp: { roll: 0, pitch: 0, heave: 0, heaveV: 0, speed: 0, air: 0 } };
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
        disposeTree(v.visual.root, keep);
        if (v.label) {
          this.scene.remove(v.label.sprite);
          v.label.dispose();
        }
      }
    }
    this.commentary.reset();
    this.setCamera(this.rig.mode, false);
    const sp = this.player.spec;
    const item = (id: string, fb: string) => ({ svg: ICONS[id] ?? ICONS[fb], label: WEAPON_LABEL[id] ?? fb });
    setTouchWeapons(this.touchEl ?? null, { fire: item(sp.front, 'laser'), drop: item(sp.rear, 'mine'), nitro: item(sp.assist, 'nitro') });
  }

  private startRace(): void {
    this.createRace();
    this.countdown = COUNTDOWN;
    this.phase = 'countdown';
    // a contagem só anda depois que a GPU tem tudo pronto (texturas e shaders); teto de 4 s
    const token = ++this.prepToken;
    this.preparing = true;
    const ready = () => {
      if (token === this.prepToken) this.preparing = false;
    };
    prepareSfx();
    // o preparo também desenha a sombra (compila os shaders dela antes da contagem)
    this.renderer.shadowMap.needsUpdate = true;
    // câmera encaixada no carro e HUD zerado já no primeiro quadro do preparo (antes, a tela
    // mostrava a câmera e os números da corrida anterior até a contagem andar)
    this.rig.snap();
    this.render(1, 0, false, 0);
    this.effects.warmup(this.renderer, this.scene, this.rig.active, this.track.def.theme).then(ready, ready);
    setTimeout(ready, 4000);
    this.resultsTimer = 0;
    this.resultsShown = false;
    this.menus.hideAll();
    this.hud.setVisible(true);
    this.hud.setLap(1, this.world.laps);
    this.hud.message('3', 0, 'count');
    sfxCountdown(false);
    this.music.play(this.track.def.theme, 'race');
  }

  private toMenu(): void {
    this.endShowroom();
    this.phase = 'menu';
    this.engine.silence();
    this.rivalEngines.silence();
    this.announcer.stop();
    this.hud.setVisible(false);
    this.screen = 'main';
    this.music.play(this.track.def.theme, 'menu');
    this.menus.showMain(!!this.campaign);
  }

  private togglePause(): void {
    if (this.net) {
      // online a corrida não para: só abre/fecha o menu por cima
      if (this.phase === 'menu') return;
      this.net.menuOpen = !this.net.menuOpen;
      if (this.net.menuOpen) this.menus.showPause(true);
      else this.menus.hideAll();
      return;
    }
    if (this.phase === 'paused') {
      if (this.glLost) return;
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
      this.engine.silence();
      this.rivalEngines.silence();
      this.announcer.stop();
      this.music.setMood('pause');
      this.menus.showPause();
    }
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
    const scale = this.phase === 'menu' ? Math.min(this.dynRes.scale, 0.75) : this.dynRes.scale;
    // piso da resolução dinâmica: no alto, 1 pixel de tela por pixel CSS (abaixo disso fica serrilhado
    // demais); no médio (PC e toque) desce até 0,75 — o médio do toque começa em 1,0 e antes já
    // nascia no piso, sem margem para aliviar a GPU; no baixo, sem piso
    const dpr = window.devicePixelRatio || 1;
    const floor = this.quality.level === 'baixo' ? 0 : Math.min(dpr, 1) * (this.quality.level === 'medio' ? 0.75 : 1);
    const pr = Math.max(floor, Math.min(dpr, this.quality.maxPixelRatio) * scale);
    this.redraw = true;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.postfx?.setSize(w, h, pr);
    this.rig.resize(w, h);
    const mirror = this.mirrorRect();
    this.hud.setMirror(this.rig.mode === 'cockpit' && this.phase !== 'menu', mirror);
    this.rig.mirror.aspect = mirror.w / mirror.h;
    this.rig.mirror.updateProjectionMatrix();
  }

  private mirrorRect() {
    const w = this.width;
    const mw = Math.round(Math.min(360, w * 0.36));
    const mh = Math.round(mw * 0.26);
    return { x: Math.round((w - mw) / 2), y: 8, w: mw, h: mh };
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    let frameDt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : DT;
    this.lastFrame = now;
    // controles de toque só na corrida (largada e prova); menus, pausa e resultados ficam limpos
    if (this.touchEl) {
      const show = this.phase === 'countdown' || this.phase === 'racing';
      if (this.touchEl.classList.contains('off') === show) this.touchEl.classList.toggle('off', !show);
    }
    // menu principal: a cena de fundo fica parada atrás do painel (câmera fixa), 5 qps bastam;
    // resultados: ~30 qps (a corrida segue atrás); pausa: imagem congelada. Tudo em resolução reduzida
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
    }
    if (this.preparing && this.phase === 'countdown') return;
    // sem contexto WebGL não há o que desenhar (volta no webglcontextrestored)
    if (this.glLost) return;
    this.clock += frameDt;
    for (const fn of this.animated) fn(this.clock);
    // resultados por cima da corrida também contam como menu (cena de fundo a ~30 qps)
    const behindMenu = this.phase === 'menu' || this.phase === 'paused' || (this.phase === 'finished' && this.resultsShown);
    // intervalo mínimo entre quadros desenhados. 29 ms = 30 qps (com o rAF oscilando, 16+16 ms às
    // vezes dava 32,1 ms < 1/31 e o quadro caía para 20 qps; também acerta 1 a cada 4 quadros numa
    // tela de 120 Hz). 12,5 ms: telas de 120/144 Hz desenham no máximo ~60–72 qps (o dobro de GPU e
    // bateria por quase nada de diferença); em 60 Hz não muda nada
    const capped = this.cap30 || (this.onBattery && !NO_CAP30);
    const minDt = this.phase === 'menu' ? 0.2 : behindMenu || capped ? 0.029 : 0.0125;
    this.idleDt += frameDt;
    if (this.phase === 'paused' ? !this.redraw : this.idleDt < minDt && !this.redraw) return;
    frameDt = Math.min(this.idleDt, 0.1);
    this.idleDt = 0;
    this.redraw = false;
    const workStart = performance.now();

    const simulating = this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'finished';
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
    this.render(alpha, frameDt, simulating, guest ? Math.min(sinceSnap / 1000, 0.1) : this.accumulator);
    // desempenho: mede só os quadros desenhados na corrida (depois do limitador). O custo é o maior
    // entre o trabalho do quadro (passos + desenho) e o intervalo desde o último quadro desenhado
    // (pega a GPU atrasada), os dois normalizados para o orçamento de 60 qps: a 30 qps travados,
    // 33 ms entre quadros é o normal, não lentidão
    const racingNow = (this.phase === 'racing' || this.phase === 'countdown' || this.phase === 'finished') && !this.resultsShown && !document.hidden;
    if (racingNow) {
      const work = (performance.now() - workStart) / 1000;
      const cost = Math.max(work, capped ? frameDt / 2 : frameDt);
      if (this.dynRes.update(frameDt, cost)) this.resize();
      if (this.phase === 'racing') this.autoDegrade(frameDt, cost);
    }
  }

  /**
   * Queda automática de nível quando a resolução dinâmica já está no piso e o jogo ainda não segura
   * ~42 qps: primeiro as luzes dos clarões, depois a sombra, depois metade das partículas e, por
   * fim, a trava em 30 qps estáveis (sem engasgos, menos calor). Vale até recarregar a página.
   * ?semlimite desliga (medição comparativa).
   */
  private autoDegrade(dt: number, cost: number): void {
    if (NO_CAP30 || this.cap30) return;
    this.slowAvg += (cost - this.slowAvg) * 0.03;
    this.degradeCd -= dt;
    if (this.degradeCd > 0 || this.slowAvg <= 1 / 42 || this.dynRes.scale > this.dynRes.min + 1e-3) return;
    this.degradeCd = 3;
    this.slowAvg = 1 / 60;
    while (this.degrade < 4) {
      const step = this.degrade++;
      if (step === 0 && this.quality.flashLights) {
        this.effects.group.traverse((o) => {
          if ((o as THREE.PointLight).isPointLight) o.visible = false;
        });
        return;
      }
      if (step === 1 && this.sun.castShadow) {
        this.sun.castShadow = false;
        return;
      }
      if (step === 2 && this.quality.particles > 0.4) {
        this.effects.setDensity(this.quality.particles * 0.5);
        return;
      }
      if (step === 3) {
        this.cap30 = true;
        return;
      }
    }
  }

  private showGlNotice(on: boolean): void {
    if (on && !this.glNotice) {
      const el = document.createElement('div');
      el.textContent = 'O vídeo foi reiniciado pelo aparelho — recuperando…';
      Object.assign(el.style, {
        position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%,-50%)', zIndex: '60', padding: '14px 20px',
        background: 'rgba(0,0,0,0.85)', color: '#fff', font: '600 16px system-ui, sans-serif', borderRadius: '10px', pointerEvents: 'none',
      });
      this.root.appendChild(el);
      this.glNotice = el;
    } else if (!on && this.glNotice) {
      this.glNotice.remove();
      this.glNotice = null;
    }
  }

  /** Preenche os dados da HUD no mesmo objeto a cada quadro (sem lixo para o coletor). */
  private fillHud(r: Racer, speed: number): HudData {
    const pc = r.car;
    const sp = r.spec;
    const d = (this.hudData ??= {
      time: 0, best: null, speedKmh: 0, place: 1, total: 1, armor: 1, money: 0,
      front: { label: '', icon: '', n: 0, max: 0 }, rear: { label: '', icon: '', n: 0, max: 0 }, assist: { label: '', icon: '', n: 0, max: 0, active: false },
      cars: [], carCount: 0,
    });
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
      c.me = o.id === this.playerId;
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
  private isGuestRace(): boolean {
    return this.net?.role === 'client' && this.setup.mode === 'online';
  }

  private step(dt: number): void {
    const guest = this.isGuestRace();
    if (!guest) this.views.forEach((v, i) => (v.prev = snap(this.world.racers[i].car)));
    let input: ControlInput = this.controls.read();
    if (this.net?.menuOpen) input = emptyInput();
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
        this.hud.message('VAI!', 1, 'go');
        this.commentary.start();
      } else {
        this.hud.message(String(Math.ceil(this.countdown)), 0, 'count');
      }
      input = emptyInput();
    }

    const net = this.net;
    if (guest && net) {
      // convidado: avisa que está pronto (o preparo terminou), manda os comandos ao host, aplica o
      // estado que chegou e prevê o próprio carro
      if (!net.sentReady) {
        net.sentReady = true;
        net.client?.send({ t: 'ready' } satisfies ClientMsg);
      }
      const n = ++net.tick;
      if (document.hidden) input = emptyInput();
      if (n % 2 === 0) net.client?.send({ t: 'input', i: input, n } satisfies ClientMsg);
      net.history.push({ n, i: input });
      if (net.history.length > 180) net.history.splice(0, net.history.length - 180);
      this.applySnaps(net, dt);
      this.predictOwn(net, input, dt);
    } else {
      if (net?.host) {
        // convidado sem mandar comando há 500 ms (aba oculta, rede travada): solta os controles
        const now = performance.now();
        for (const racer of net.racerOf.values()) {
          if (now - (net.inputAt[racer] ?? 0) > INPUT_STALE_MS) net.inputs[racer] = emptyInput();
        }
      }
      stepWorld(this.world, net ? { ...net.inputs, [this.playerId]: input } : { [this.playerId]: input }, dt);
      if (net?.host) {
        net.events.push(...this.world.events);
        if (net.events.length > 400) net.events.splice(0, net.events.length - 400);
        if (++net.tick % SNAP_EVERY === 0) {
          const a = this.world.racers.map((r) => net.ack[r.id] ?? -1);
          net.host.broadcast({ t: 'snap', s: takeSnapshot(this.world, net.events), k: net.seq++, a, cd: this.phase === 'countdown' ? this.countdown : 0 } satisfies HostMsg);
          net.events = [];
        }
      }
    }
    for (const e of this.world.events) this.onEvent(e);
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

    // locutor: liderança, último lugar, blindagem baixa, rajadas, abates, contramão...
    if (this.phase === 'racing' || this.phase === 'finished') this.commentary.update(this.world, this.playerId, dt);

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
    this.bounceVel += (-this.bounce * 300 - this.bounceVel * 18) * dt;
    this.bounce += this.bounceVel * dt;
    this.shake *= Math.exp(-dt * 6);
  }

  /** Volume de um som conforme a distância até o jogador. */
  private vol(x: number, z: number): number {
    const c = this.player.car;
    // queda suave (quadrática): perto soa forte, longe some sem corte brusco
    const t = clamp(1 - Math.hypot(x - c.x, z - c.z) / 90, 0, 1);
    return t * t * 0.7 + t * 0.3;
  }

  /** Posição do som na tela, de -1 (esquerda) a +1 (direita), para o pan estéreo. */
  private pan(x: number, z: number): number {
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
    const name = (id: number) => (id === me ? 'Você' : racers[id].name);
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
        if (e.target === me) {
          this.shake = Math.max(this.shake, e.kind === 'laser' ? 0.25 : 0.7);
          // quem acertou (o plasma é frequente: só avisa das armas fortes ou de quem ainda não tinha acertado)
          const by = e.by >= 0 && e.by !== me ? this.world.racers[e.by] : null;
          if (by && (e.kind !== 'laser' || this.lastHitBy !== e.by)) this.hud.showToast(`💥 ${by.name} te acertou (${WEAPON_LABEL[e.kind] ?? e.kind})`);
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
        if (e.racer === me) {
          this.hud.showToast('Óleo! 🌀');
          sfxSkid(1);
        } else {
          const sc = racers[e.racer].car;
          sfxSkid(this.vol(sc.x, sc.z) * 0.6, this.pan(sc.x, sc.z));
        }
        break;
      case 'explode': {
        this.effects.explosion(e.x, e.y, e.z, true);
        sfxExplosion(e.racer === me ? 1 : this.vol(e.x, e.z), true, this.pan(e.x, e.z));
        if (e.racer === me) {
          this.shake = 1.2;
          this.hud.message('DESTRUÍDO!', 2, 'warn');
        } else if (e.by === me) {
          this.hud.showToast(`💥 Você destruiu ${racers[e.racer].name}! +$${e.bounty.toLocaleString('pt-BR')}`);
        } else {
          this.hud.showToast(`💥 ${name(e.racer)} explodiu!`);
        }
        break;
      }
      case 'pickup':
        if (e.racer === me) {
          sfxPickup(e.kind);
          this.hud.showToast(e.kind === 'money' ? '+ $1.000' : '+ Blindagem');
        }
        break;
      case 'bump':
        if (e.a === me || e.b === me) {
          const other = racers[e.a === me ? e.b : e.a].car;
          sfxBump(clamp(e.strength / 15, 0, 1), this.pan(other.x, other.z));
          this.shake = Math.max(this.shake, clamp(e.strength / 40, 0, 0.3));
        }
        break;
      case 'lap':
        if (e.racer === me) {
          const laps = this.world.laps;
          this.hud.setLap(e.lap, laps);
          const times = this.player.progress.lapTimes;
          this.hud.message(e.lap === laps ? 'VOLTA FINAL!' : `VOLTA ${e.lap}`, 0.8, 'lap');
          this.hud.showToast(`Volta: ${formatTime(times[times.length - 1])} · armas recarregadas`);
          sfxLap(e.lap === laps);
        }
        break;
      case 'finish':
        if (e.racer === me) {
          this.phase = 'finished';
          this.hud.message(e.place === 1 ? 'VITÓRIA!' : `${e.place}º LUGAR`, 3, 'go');
          this.resultsTimer = 3;
        }
        break;
      case 'burn':
        if (e.racer === me) sfxBurn(0.8);
        break;
      case 'lapped':
        if (e.racer === me) sfxPickup('money');
        if (e.racer === me) this.hud.showToast(`Você abriu uma volta sobre ${racers[e.victim].name}! +$${e.bonus.toLocaleString('pt-BR')} se vencer`);
        else if (e.victim === me) this.hud.showToast(`${racers[e.racer].name} abriu uma volta sobre você!`);
        break;
      case 'assist': {
        const ac = racers[e.racer].car;
        if (e.kind === 'jump') this.effects.jumpJet(ac.x, ac.y, ac.z);
        else this.effects.nitroBurst(ac.x - Math.sin(ac.heading) * 2, ac.y, ac.z - Math.cos(ac.heading) * 2);
        sfxAssist(e.kind, e.racer === me ? 1 : this.vol(ac.x, ac.z) * 0.7, this.pan(ac.x, ac.z));
        break;
      }
      case 'fall':
        this.effects.fall(e.x, THEMES[this.track.def.theme].groundLevel, e.z, THEMES[this.track.def.theme].groundStyle);
        sfxFall(e.racer === me ? 1 : this.vol(e.x, e.z) * 0.6, this.pan(e.x, e.z));
        if (e.racer === me) this.hud.message('CAIU!', 1.2, 'warn');
        break;
      case 'respawn':
        break;
    }
  }

  private showResults(): void {
    if (this.resultsShown) return;
    this.resultsShown = true;
    const order = [...this.world.racers].sort((a, b) => a.place - b.place);
    const rows: ResultRow[] = order.map((r) => ({
      place: r.place,
      name: r.id === this.playerId ? this.setup.playerName : r.name,
      color: hex(r.color),
      time: r.finishPlace ? r.progress.finishTime : null,
      kills: r.kills,
      prize: this.world.prizes[r.place - 1] ?? 0,
      money: r.money,
      me: r.id === this.playerId,
      pilot: r.id === this.playerId ? this.setup.pilot : r.name,
      vehicleId: r.spec.id,
    }));
    let report: CampaignReport | null = null;
    if (this.setup.mode === 'campaign' && this.campaign) {
      const p = this.player;
      const promote = seasonInfo(this.campaign).promote;
      const boss = currentPlanet(this.campaign).local;
      const res = applyRaceResult(this.campaign, p.place, p.money, p.kills);
      this.championPending = res.outcome === 'champion';
      saveCampaign(this.campaign);
      report = {
        outcome: res.outcome,
        kind: res.kind,
        pointsEarned: res.pointsEarned,
        points: this.campaign.points,
        promote,
        label: this.campaignLabel(),
        boss,
        bonus: res.bonus,
        playoffLeft: res.playoffLeft,
        planets: planetCount(this.campaign),
      };
    }
    this.hud.clearMessage();
    this.music.setMood('menu');
    this.menus.showResults(rows, this.player.progress.lapTimes, report, this.setup.mode === 'online');
  }

  /* ------------------------------------------------------------------ */
  /* Campanha, garagem e loja                                             */
  /* ------------------------------------------------------------------ */

  private campaignLabel(): string {
    const c = this.campaign!;
    return `${currentPlanet(c).name} — Divisão ${DIVISIONS[c.division]}`;
  }

  private hubData(): HubData {
    const c = this.campaign!;
    return {
      state: c,
      planet: currentPlanet(c),
      track: new Track(trackById(currentTrackId(c))),
      opponents: opponentsFor(c, VEHICLES),
      spec: playerSpec(c, VEHICLES),
      character: CHARACTERS.find((ch) => ch.id === c.characterId) ?? CHARACTERS[0],
      vehicles: VEHICLES,
    };
  }

  /** Mostra a garagem com a próxima pista já montada ao fundo. */
  /** a última corrida deu o título: o "Continuar" dos resultados abre a tela de campeão */
  private championPending = false;

  /** Tela de campeão sobre a garagem (a campanha continua dali). */
  private showChampion(): void {
    this.toHub();
    this.menus.showChampion(this.hubData());
    this.announcer.say('dominating', this.setup.pilot ?? null, 3);
  }

  private toHub(notice = ''): void {
    const c = this.campaign!;
    this.phase = 'menu';
    this.engine.silence();
    this.rivalEngines.silence();
    this.announcer.stop();
    this.hud.setVisible(false);
    this.setup = this.campaignSetup(c);
    // garagem ↔ loja/slots: mesma pista e mesmos carros, com o grid ainda parado: não remonta
    if (this.raceKey !== raceKeyOf(this.setup) || this.world.started || this.showcase) this.createRace();
    this.screen = 'hub';
    this.music.play(this.track.def.theme, 'menu');
    this.menus.showHub(this.hubData(), notice);
  }

  private buy(price: number | null, apply: () => void, label: string): void {
    const c = this.campaign!;
    if (price === null || price > c.money) return;
    c.money -= price;
    apply();
    saveCampaign(c);
    sfxPickup('money');
    this.menus.showShop(this.hubData(), `✔ ${label} comprado(a)!`);
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
      battery: !!this.prefs.battery,
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
      newCampaign: (o: NewCampaignOptions) => {
        beginAudio();
        const c = newCampaign(o.characterId, o.color, o.difficulty);
        this.campaign = c;
        saveToSlot(o.slot, c);
        this.toHub(`Bem-vindo a ${this.campaignLabel()}! Você tem um Dirt Devil e $10.000 — passe na loja.`);
      },
      continueCampaign: () => {
        beginAudio();
        if (this.campaign) this.toHub();
      },
      loadPassword: (code: string, slot: number) => {
        const c = decodeSave(code);
        if (!c) return false;
        beginAudio();
        this.campaign = c;
        // no slot escolhido na tela da senha (que já pediu confirmação se ele estava ocupado)
        saveToSlot(slot, c);
        this.toHub(`Campanha carregada pela senha no slot ${slot + 1}.`);
        return true;
      },
      campaignRace: () => {
        beginAudio();
        this.startRace();
      },
      openShop: () => this.menus.showShop(this.hubData()),
      buyCar: (id: string) => {
        const c = this.campaign!;
        // preço do novo menos a revenda do atual (negativo: a diferença volta para o jogador)
        this.buy(carSwapCost(c.car, id), () => (c.car = newCarSetup(id)), VEHICLES[id].name);
      },
      buyUpgrade: (kind: 'engine' | 'tires' | 'shocks' | 'armor') => {
        const c = this.campaign!;
        // a loja só vende peças até o nível liberado neste planeta
        this.buy(c.car.upgrades[kind] < shopLevel(c) ? upgradePrice(c.car, kind) : null, () => c.car.upgrades[kind]++, 'Melhoria');
      },
      buyCharge: (kind: 'front' | 'rear' | 'nitro') => {
        const c = this.campaign!;
        this.buy(chargePrice(c.car, kind, VEHICLES[c.car.vehicleId]), () => c.car.charges[kind]++, 'Carga extra');
      },
      showPassword: () => this.menus.showPassword(encodeSave(this.campaign!)),
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
        this.campaign = c;
        this.toHub(`Jogo do slot ${slot + 1} carregado.`);
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
      setBatterySaver: (on: boolean) => {
        this.prefs.battery = on;
        this.onBattery = on;
        savePrefs(this.prefs);
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
          if (this.phase === 'paused') this.menus.showPause();
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
          this.engine.silence();
          this.rivalEngines.silence();
          this.menus.showGoodbye();
        });
      },
      backToHub: () => this.toHub(),
      resume: () => this.togglePause(),
      restart: () => {
        unlockAudio();
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
        if (this.setup.mode === 'campaign' && this.campaign) this.toHub('Corrida abandonada — não contou para a temporada.');
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
        this.toHub();
      },
      toMain: () => this.toMenu(),
      openSettings: () => {
        unlockAudio();
        this.menus.showSettings(this.audioSettings());
      },
      closeSettings: () => {
        if (this.net?.menuOpen) this.menus.showPause(true);
        else if (this.phase === 'paused') this.menus.showPause();
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
    return {
      role, host: null, client: null, code, players: [], racing: false, racerOf: new Map(), inputs: {}, events: [], tick: 0, snaps: [],
      lastSnapAt: performance.now(), inLobby: false, menuOpen: false, myId: role === 'host' ? 'host' : '',
      inputAt: {}, ack: {}, seq: 0, waiting: new Set(), readyUntil: 0, sentReady: false, playK: 0, curK: -1, history: [], own: null, pred: null,
      predErr: { x: 0, y: 0, z: 0, h: 0 },
    };
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
        host.onMessage = (id, msg) => {
          // nada do convidado é confiável: comando sanitizado, número do passo conferido
          const m = msg as { t?: unknown; i?: unknown; n?: unknown };
          if (m?.t === 'ready') {
            net.waiting.delete(id);
            return;
          }
          const racer = net.racerOf.get(id);
          if (m?.t !== 'input' || racer === undefined) return;
          net.inputs[racer] = sanitizeInput(m.i);
          net.inputAt[racer] = performance.now();
          if (Number.isSafeInteger(m.n)) net.ack[racer] = m.n as number;
        };
        host.onLeave = (id) => this.hostLeave(id);
        this.showLobby();
      },
      (err) => {
        if (token === this.netToken) this.menus.showOnline('', netErrorText(err));
      },
    );
  }

  private hostJoin(id: string, msg: unknown): void {
    const net = this.net;
    if (!net?.host) return;
    const m = parseHello(msg, vehicleIds());
    if (!m) return net.host.kick(id);
    if (net.players.length >= MAX_PLAYERS) {
      net.host.send(id, { t: 'full' } satisfies HostMsg);
      setTimeout(() => net.host?.kick(id), 500);
      return;
    }
    // cor só da paleta (a cor vai para o HTML da sala); repetida ou inválida: a primeira livre
    const color = pickColor(m.color, new Set(net.players.map((p) => p.color)), COLORS);
    const { name, vehicleId } = m;
    net.players = net.players.filter((p) => p.id !== id);
    net.players.push({ id, name, color, vehicleId });
    net.host.accept(id);
    this.hud.showToast(`🌐 ${name} entrou na sala`);
    this.lobbyChanged();
  }

  private hostLeave(id: string): void {
    const net = this.net;
    if (!net) return;
    const p = net.players.find((x) => x.id === id);
    net.players = net.players.filter((x) => x.id !== id);
    const racer = net.racerOf.get(id);
    if (racer !== undefined) {
      // o carro continua na corrida, agora pilotado pela CPU
      net.racerOf.delete(id);
      delete net.inputs[racer];
      const r = this.world.racers[racer];
      if (r) r.ai = LEFT_PLAYER_AI;
    }
    if (p) this.hud.showToast(`🌐 ${p.name} saiu da sala`);
    this.lobbyChanged();
  }

  /** Avisa todos da nova lista de pilotos e redesenha a sala se ela estiver aberta. */
  private lobbyChanged(): void {
    const net = this.net;
    if (!net) return;
    if (net.host) {
      for (const p of net.players) {
        if (p.id !== 'host') net.host.send(p.id, { t: 'lobby', players: net.players, racing: net.racing, you: p.id } satisfies HostMsg);
      }
    }
    if (net.inLobby) this.menus.showLobby(this.lobbyView());
  }

  private lobbyView(): LobbyView {
    const net = this.net!;
    return {
      code: net.code,
      link: this.roomLink(net.code),
      host: net.role === 'host',
      players: net.players.map((p) => ({ name: p.name, color: p.color, vehicleId: p.vehicleId, me: p.id === net.myId })),
      max: MAX_PLAYERS,
      racing: net.racing,
    };
  }

  private showLobby(): void {
    const net = this.net;
    if (!net) return;
    this.endShowroom();
    this.phase = 'menu';
    this.engine.silence();
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
    const hello: ClientMsg = { t: 'hello', name: o.name, color: o.color, vehicleId: o.vehicleId };
    NetClient.join(code, hello).then(
      (client) => {
        if (token !== this.netToken) return client.close();
        const net = this.newSession('client', code);
        net.client = client;
        this.net = net;
        client.onMessage = (msg) => this.guestMessage(msg);
        client.onClose = (lost) => this.onlineLost(lost ? 'A conexão com o host caiu.' : 'O host fechou a sala.');
        this.showLobby();
      },
      (err) => {
        if (token === this.netToken) this.menus.showOnline(code, netErrorText(err));
      },
    );
  }

  private guestMessage(msg: unknown): void {
    const net = this.net;
    // tudo que vem do host é conferido antes de usar (vai para a simulação e para o HTML)
    const m = msg as { t?: unknown } & Record<string, unknown>;
    if (!net || typeof m !== 'object' || m === null) return;
    switch (m.t) {
      case 'lobby': {
        const players = parseLobbyPlayers(m.players, COLORS, vehicleIds());
        if (!players || typeof m.you !== 'string') return;
        net.players = players;
        net.racing = m.racing === true;
        net.myId = m.you;
        if (net.inLobby) this.menus.showLobby(this.lobbyView());
        break;
      }
      case 'full':
        this.onlineLost('A sala está cheia (4 pilotos).');
        break;
      case 'start': {
        const start = parseStart(m, vehicleIds(), TRACKS.map((t) => t.id));
        if (!start) return;
        net.racing = true;
        net.inLobby = false;
        net.menuOpen = false;
        net.snaps = [];
        net.tick = 0;
        net.sentReady = false;
        net.playK = 0;
        net.curK = -1;
        net.history = [];
        net.own = null;
        net.pred = null;
        net.predErr = { x: 0, y: 0, z: 0, h: 0 };
        this.setup = this.onlineSetup(start.race, start.you);
        this.startRace();
        net.lastSnapAt = performance.now();
        break;
      }
      case 'snap': {
        if (this.setup.mode !== 'online' || this.phase === 'menu') return;
        const s = validateSnap(m.s, this.world.racers.length, this.track.pieces.length);
        if (!s || !Number.isSafeInteger(m.k) || (m.k as number) <= (net.snaps.at(-1)?.k ?? net.curK)) return;
        const a = Array.isArray(m.a) ? m.a.map((x) => (Number.isSafeInteger(x) ? (x as number) : -1)) : [];
        const cd = typeof m.cd === 'number' && Number.isFinite(m.cd) ? clamp(m.cd, 0, COUNTDOWN) : 0;
        net.snaps.push({ s, k: m.k as number, a, cd });
        // aba oculta ou rede travada: guarda só os mais novos
        if (net.snaps.length > SNAP_QUEUE) net.snaps.splice(0, net.snaps.length - SNAP_QUEUE);
        // o próprio carro usa sempre o estado mais novo (previsão), sem a folga dos outros
        const own = s.racers[this.playerId]?.car;
        if (own) net.own = { car: own, ack: a[this.playerId] ?? -1 };
        break;
      }
      case 'end':
        net.racing = false;
        // o host encerrou: quem ainda corria vê o resultado parcial
        if (this.setup.mode === 'online' && this.phase !== 'menu' && !this.resultsShown) {
          this.phase = 'finished';
          this.resultsTimer = Infinity;
          net.menuOpen = false;
          this.showResults();
        } else if (net.inLobby) this.menus.showLobby(this.lobbyView());
        break;
    }
  }

  /**
   * Convidado: aplica os estados do host seguindo um relógio de reprodução ~100 ms atrás do mais
   * novo (SNAP_BUFFER pacotes). Os pacotes chegam em rajadas irregulares; com a folga, os carros
   * dos outros andam lisos. O relógio acompanha o host devagar e só salta se ficar muito longe.
   */
  private applySnaps(net: Online, dt: number): void {
    const q = net.snaps;
    const me = this.playerId;
    if (net.pred) this.views[me].prev = snap(this.world.racers[me].car);
    if (q.length) {
      const target = q[q.length - 1].k - SNAP_BUFFER;
      if (net.curK < 0) net.playK = target;
      net.playK += dt / SNAP_S;
      const err = target - net.playK;
      if (Math.abs(err) > 8) net.playK = target;
      else net.playK += err * Math.min(1, dt * 2);
    } else if (net.curK >= 0) net.playK = Math.min(net.playK + dt / SNAP_S, net.curK);
    const events: WorldEvent[] = [];
    while (q.length && q[0].k <= Math.floor(net.playK) + 1) {
      const m = q.shift()!;
      this.views.forEach((v, i) => {
        if (i !== me || !net.pred) v.prev = snap(this.world.racers[i].car);
      });
      applySnapshot(this.world, m.s);
      for (const e of m.s.events) events.push(e);
      net.curK = m.k;
      net.lastSnapAt = performance.now();
      // contagem da largada em sintonia com a do host (que espera o "pronto" de todos)
      if (this.phase === 'countdown') this.countdown = m.s.started ? Math.min(this.countdown, 1e-3) : Math.max(m.cd, 1e-3);
    }
    this.world.events = events;
  }

  /** Posição de interpolação entre o estado anterior e o aplicado por último (0..1). */
  private guestAlpha(net: Online): number {
    if (net.curK < 0) return 1;
    return clamp(net.playK + this.accumulator / SNAP_S - (net.curK - 1), 0, 1);
  }

  /**
   * Convidado: prevê o próprio carro com os comandos locais (resposta imediata na direção). A cada
   * estado novo do host, parte do carro dele e refaz os comandos que o host ainda não tinha
   * recebido; a diferença para a previsão anterior vira um erro visual que some em ~0,2 s.
   */
  private predictOwn(net: Online, input: ControlInput, dt: number): void {
    const r = this.world.racers[this.playerId];
    if (!r) return;
    if (!this.world.started || !r.alive || r.spinTime > 0 || r.progress.finished) {
      net.pred = null;
      net.own = null;
      net.predErr = { x: 0, y: 0, z: 0, h: 0 };
      return;
    }
    if (net.own || !net.pred) {
      const before = net.pred;
      const car: VehicleState = { ...(net.own?.car ?? r.car) };
      const ack = net.own ? net.own.ack : Infinity;
      let replayed = false;
      for (const h of net.history) {
        if (h.n <= ack) continue;
        stepVehicle(car, r.spec, h.i, this.track, dt);
        replayed = true;
      }
      if (!replayed) stepVehicle(car, r.spec, input, this.track, dt);
      if (before) {
        const err = net.predErr;
        err.x += before.x - car.x;
        err.y += before.y - car.y;
        err.z += before.z - car.z;
        err.h += Math.atan2(Math.sin(before.heading - car.heading), Math.cos(before.heading - car.heading));
        // teleporte (renasceu, erro grande): corrige de uma vez
        if (Math.hypot(err.x, err.z) > 6) net.predErr = { x: 0, y: 0, z: 0, h: 0 };
      }
      net.pred = car;
      net.own = null;
    } else stepVehicle(net.pred, r.spec, input, this.track, dt);
    const pred = net.pred;
    pred.fell = false;
    const e = net.predErr;
    const k = Math.exp(-dt * 12);
    e.x *= k;
    e.y *= k;
    e.z *= k;
    e.h *= k;
    Object.assign(r.car, pred);
    r.car.x += e.x;
    r.car.y += e.y;
    r.car.z += e.z;
    r.car.heading += e.h;
    r.lastInput = input;
  }

  /** Host online: a largada espera o "pronto" de todos os convidados (com prazo). */
  private hostWaiting(): boolean {
    const net = this.net;
    if (!net?.host || !net.waiting.size || this.setup.mode !== 'online') return false;
    for (const id of net.waiting) if (!net.racerOf.has(id)) net.waiting.delete(id);
    if (performance.now() > net.readyUntil) net.waiting.clear();
    return net.waiting.size > 0;
  }

  /** Aba oculta numa corrida online: o convidado solta os controles; o host segue simulando. */
  private onlineVisibility(): void {
    const net = this.net;
    if (!net || this.setup.mode !== 'online') return this.hiddenTicker.stop();
    if (document.hidden) {
      if (net.client) net.client.send({ t: 'input', i: emptyInput(), n: ++net.tick } satisfies ClientMsg);
      if (net.host) {
        this.hiddenLast = performance.now();
        this.hiddenTicker.start();
      }
    } else this.hiddenTicker.stop();
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
    const humans = net.players;
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
    net.events = [];
    net.tick = 0;
    net.racing = true;
    net.inLobby = false;
    net.menuOpen = false;
    humans.forEach((p, i) => {
      const racer = cpus.length + i;
      if (p.id === 'host') return;
      net.racerOf.set(p.id, racer);
      net.host!.send(p.id, { t: 'start', race, you: racer } satisfies HostMsg);
    });
    // a contagem espera o "pronto" de todos (quem demora mais de 10 s fica para trás)
    net.waiting = new Set(net.racerOf.keys());
    net.readyUntil = performance.now() + READY_TIMEOUT_MS;
    this.setup = this.onlineSetup(race, cpus.length + humans.findIndex((p) => p.id === 'host'));
    this.startRace();
  }

  /** Dos resultados de volta para a sala. No host, encerra a corrida para todos. */
  private onlineBackToLobby(): void {
    const net = this.net;
    if (!net) return this.toMenu();
    if (net.host && net.racing) {
      net.racing = false;
      net.host.broadcast({ t: 'end' } satisfies HostMsg);
    }
    this.showLobby();
    this.lobbyChanged();
  }

  private closeNet(): void {
    this.netToken++;
    this.hiddenTicker.stop();
    this.net?.host?.close();
    this.net?.client?.close();
    this.net = null;
  }

  private onlineLeave(): void {
    this.closeNet();
    this.toMenu();
  }

  private onlineLost(text: string): void {
    this.closeNet();
    this.endShowroom();
    this.phase = 'menu';
    this.engine.silence();
    this.announcer.stop();
    this.hud.setVisible(false);
    this.screen = 'main';
    this.menus.showOnlineNotice(text);
  }

  private render(alpha: number, frameDt: number, simulating: boolean, ahead: number): void {
    const world = this.world;
    let playerPose: { x: number; y: number; z: number; heading: number } | null = null;

    world.racers.forEach((r, i) => {
      const view = this.views[i];
      const v = r.car;
      const p = view.prev;
      // convidado online: o próprio carro é previsto a cada passo local (interpola como fora do online)
      const al = i === this.playerId && this.net?.pred ? this.accumulator / DT : alpha;
      const x = lerp(p.x, v.x, al);
      const y = lerp(p.y, v.y, al);
      const z = lerp(p.z, v.z, al);
      const heading = lerpAngle(p.heading, v.heading, al);
      const visual = view.visual;
      visual.root.visible = !this.showcase && r.alive && (r.invuln <= 0 || Math.sin(this.clock * 30) > -0.3);
      visual.root.position.set(x, y, z);
      visual.root.rotation.set(-lerp(p.pitch, v.pitch, al), heading, lerp(p.roll, v.roll, al), 'YXZ');
      visual.animate({ spin: v.wheelSpin, steer: v.steer, speed: forwardSpeed(v), time: this.clock, grounded: v.grounded, roll: view.susp.roll, pitch: view.susp.pitch });
      this.suspension(view, r, frameDt, i === this.playerId);
      for (const f of visual.flames) {
        f.visible = r.alive && v.nitroTime > 0;
        if (f.visible) f.scale.setScalar(0.8 + Math.random() * 0.5);
      }
      // sombra de contato no chão, some conforme o carro sobe num salto
      const ground = world.track.query(x, z, v.pieceIndex).height;
      const lift = y - ground;
      view.shadow.visible = r.alive && !this.showcase;
      view.shadow.position.set(x, ground + 0.03, z);
      view.shadow.rotation.y = heading;
      (view.shadow.material as THREE.MeshBasicMaterial).opacity = clamp(1 - lift / 4, 0, 1);
      view.shadow.scale.setScalar(1 + lift * 0.08);
      if (i === this.playerId) this.effects.markPlayer(x, ground, z, heading, r.alive && !this.showcase && this.rig.mode !== 'cockpit');
      if (view.label) {
        // no cockpit e bem de perto na perseguição, a etiqueta taparia a visão
        const near = this.rig.mode !== 'iso' && Math.hypot(x - this.rig.active.position.x, z - this.rig.active.position.z) < 9;
        view.label.sprite.visible = r.alive && this.phase !== 'menu' && this.rig.mode !== 'cockpit' && !near;
        view.label.sprite.position.set(x, y + 3.4, z);
        view.label.update(r.armor / r.spec.armor, r.place);
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
          for (const side of [1, -1]) {
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
      if (i === this.playerId) {
        visual.body.position.y = clamp(this.bounce, -0.25, 0.15);
        if (this.rig.mode === 'cockpit') visual.body.rotation.set(0, 0, 0);
        visual.steeringWheel.rotation.z = v.steer * 1.6;
        playerPose = { x, y, z, heading };
      }
    });

    const pv = this.views[this.playerId].visual;
    const pose = playerPose ?? { x: 0, y: 0, z: 0, heading: 0 };
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
    this.effects.update(world, simulating ? frameDt : 0, simulating ? ahead : 0);

    this.sun.position.set(pose.x, pose.y, pose.z).addScaledVector(SUN_DIR, 90);
    this.sun.target.position.set(pose.x, pose.y, pose.z);
    this.sky?.position.copy(this.rig.active.position);

    const r = this.player;
    const speed = forwardSpeed(pc);
    if (this.phase !== 'menu' && this.phase !== 'paused') {
      this.hud.update(frameDt, this.fillHud(r, speed));
      // derrapagem: velocidade lateral em relação à direção do carro (pneus cantando)
      const lateral = Math.abs(pc.vx * Math.cos(pc.heading) - pc.vz * Math.sin(pc.heading));
      // (esterçar em alta não basta: só canta quando o carro escorrega de lado de verdade)
      const slip = !r.alive || !pc.grounded ? 0 : r.spinTime > 0 ? 1 : clamp((lateral - 3) / 8, 0, 1);
      this.engine.update(clamp(Math.abs(speed) / r.spec.maxSpeed, 0, 1.3), r.alive ? r.lastInput.throttle : 0, pc.nitroTime > 0, slip);
      // rivais audíveis: os mais próximos, com pan e Doppler pela velocidade de aproximação
      const near: RivalEngineInput[] = [];
      for (const o of world.racers) {
        if (o.id === this.playerId || !o.alive) continue;
        const dx = o.car.x - pc.x;
        const dz = o.car.z - pc.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 45) continue;
        const closing = -((o.car.vx - pc.vx) * dx + (o.car.vz - pc.vz) * dz) / Math.max(dist, 1);
        near.push({ speedRatio: Math.abs(forwardSpeed(o.car)) / o.spec.maxSpeed, throttle: o.lastInput.throttle, dist, pan: this.pan(o.car.x, o.car.z), closing });
      }
      if (near.length > 1) near.sort(byDist);
      this.rivalEngines.update(near);
    }

    const w = this.width;
    const h = this.height;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    const cam = this.showcase?.cam ?? this.rig.active;
    if (this.showcase) {
      this.showcase.cam.aspect = w / h;
      this.showcase.cam.updateProjectionMatrix();
    }
    // sombras a cada ~25 ms: a 60 qps, um quadro sim e outro não (a passada de sombra é ~1/3 das
    // chamadas de desenho e 40% dos triângulos); a 30 qps, todo quadro. A sombra do carro atrasa no
    // máximo 1/60 s, imperceptível; a do cenário não muda (o mapa guarda a matriz com que foi feito)
    if (this.clock - this.shadowAt >= 0.024 || this.clock < this.shadowAt) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowAt = this.clock;
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
  }
}
