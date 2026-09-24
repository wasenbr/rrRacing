import { DynamicResolution, resolveQuality, type QualityPref, type QualitySettings } from '../render/quality';
import * as THREE from 'three';
import { Announcer, Commentary } from '../audio/announcer';
import { setSfxEnabled, toggleMute, unlockAudio } from '../audio/context';
import { Music } from '../audio/music';
import { EngineSound, RivalEngines, type RivalEngineInput } from '../audio/engine';
import { sfxAssist, sfxBump, sfxBurn, sfxCountdown, sfxDrop, sfxExplosion, sfxFall, sfxFire, sfxHit, sfxLand, sfxLap, sfxPickup, sfxSkid, sfxWall } from '../audio/sfx';
import { trackById, TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  advanceEarly, applyRaceResult, currentPlanet, difficultyOf, currentTrackId, decodeSave, DIVISIONS, encodeSave, newCampaign, opponentsFor, PLANETS, playerSpec, prizesFor,
  type CampaignState,
} from '../sim/campaign';
import { buildSpec, CAR_PRICES, CHARACTERS, chargePrice, newCarSetup, tradeInValue, upgradePrice } from '../sim/garage';
import { deleteSlot, listSlots, loadCampaign, loadFromSlot, loadPrefs, saveCampaign, savePrefs, saveToSlot } from './storage';
import { canInstall, fullscreenSupported, initPwa, initViewport, isFullscreen, isInstalled, isIos, onFullscreenChange, onInstallChange, promptInstall, quitGame, toggleFullscreen } from '../ui/pwa';
import { Controls, createTouchControls, isTouchDevice, setTouchAutoThrottle } from '../input/controls';
import { CAMERA_LABELS, CameraRig, type CameraMode } from '../render/cameras';
import { createCarMesh, type CarVisual } from '../render/cars';
import { Effects } from '../render/effects';
import { buildEnvironment, buildGround, buildSky, SUN_DIR } from '../render/environment';
import { contactShadow } from '../render/textures';
import { PostFx } from '../render/postfx';
import { RivalTag } from '../render/rivalTag';
import { buildScenery } from '../render/scenery';
import { levelTheme, THEMES } from '../render/themes';
import { buildTrackMesh } from '../render/trackMesh';
import { emptyInput, type ControlInput } from '../sim/input';
import { clamp, forwardX, forwardZ, leftX, leftZ, lerp, lerpAngle } from '../sim/math';
import { Track, type TrackDef } from '../sim/track';
import { CAR_SCALE, forwardSpeed, type VehicleSpec, type VehicleState } from '../sim/vehicle';
import { createWorld, PRIZES, stepWorld, type Difficulty, type Racer, type RacerEntry, type World, type WorldEvent } from '../sim/world';
import type { AiProfile } from '../sim/ai';
import { Hud, formatTime } from '../ui/hud';
import { icon } from '../ui/icons';
import { COLORS, Menus, WEAPON_LABEL, type CampaignReport, type HubData, type LobbyView, type NewCampaignOptions, type OnlineOptions, type QuickOptions, type ResultRow } from '../ui/menus';
import { NetClient, NetHost, netErrorText, normalizeCode } from '../net/peer';
import { applySnapshot, MAX_PLAYERS, takeSnapshot, type ClientMsg, type HostMsg, type LobbyPlayer, type OnlineRace, type WorldSnap } from '../net/sync';

const DT = 1 / 60;
const COUNTDOWN = 3;
/** online: o host manda o estado a cada 3 passos (20x por segundo) */
const SNAP_EVERY = 3;
const SNAP_MS = SNAP_EVERY * DT * 1000;
/** quem sai no meio da corrida vira CPU */
const LEFT_PLAYER_AI: AiProfile = { skill: 0.8, aggression: 0.7, lane: 0.5 };

/** Sessão online (host ou convidado). */
interface Online {
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
  snaps: WorldSnap[];
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
  private prefs = loadPrefs({ camera: 'iso' as CameraMode, music: true, sfx: true, announcer: true, musicVolume: 0.7, autoThrottle: false, quality: 'auto' as QualityPref });
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
  /** o jogador saiu da tela cheia pelo botão: não forçar de novo */
  private leftFullscreen = false;
  private showcase: { group: THREE.Group; cam: THREE.PerspectiveCamera; center: THREE.Vector3; heading: number } | null = null;
  private net: Online | null = null;
  /** cancela uma conexão em andamento quando o jogador desiste */
  private netToken = 0;

  constructor(private root: HTMLElement) {
    this.quality = resolveQuality(this.prefs.quality, this.touch);
    this.shadows = this.quality.shadows;
    this.effects.setDensity(this.quality.particles);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = this.quality.level === 'alto' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    root.appendChild(this.renderer.domElement);

    this.scene.environmentIntensity = 0.7;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.7);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = this.shadows;
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -50;
    sc.right = sc.top = 50;
    sc.near = 1;
    sc.far = 220;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.effects.group);
    // bloom só na qualidade alta do PC: no celular e em placas simples pesa demais
    if (this.quality.bloom) this.postfx = new PostFx(this.renderer, this.scene);

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
    initViewport(() => this.resize());
    // Ctrl é o tiro no PC: um Ctrl+W acidental pede confirmação em vez de fechar a corrida
    window.addEventListener('beforeunload', (e) => {
      if (this.phase === 'racing' || this.phase === 'countdown') e.preventDefault();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.net && (this.phase === 'racing' || this.phase === 'countdown')) this.togglePause();
    });

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
    this.scene.fog = new THREE.Fog(theme.fog, 170, 520);
    this.hemi.color.set(theme.ambientSky);
    this.hemi.groundColor.set(theme.ambientGround);
    this.sun.color.set(theme.sun);
    // luz mais dramática: sol forte e ambiente contido (contraste de luz e sombra do visual alvo)
    this.sun.intensity = theme.sunIntensity * 1.5;
    // luz de recorte vinda do lado oposto ao sol, na cor do planeta: destaca a silhueta dos carros
    let fill = this.scene.getObjectByName('fill') as THREE.DirectionalLight | undefined;
    if (!fill) {
      fill = new THREE.DirectionalLight(0xffffff, 1);
      fill.name = 'fill';
      fill.position.set(-SUN_DIR.x, 0.6, -SUN_DIR.z);
      this.scene.add(fill);
    }
    fill.color.set(theme.glow).lerp(new THREE.Color(theme.ambientSky), 0.4);
    fill.intensity = 0.9;
    const ground = buildGround(this.track, theme, this.shadows);
    const scenery = buildScenery(this.track, theme, def.theme, this.shadows, def.id.length * 7 + 3, this.quality.dense);
    this.level.add(ground.mesh, buildTrackMesh(this.track, theme, this.shadows), scenery.group);
    this.animated = [ground.update, scenery.update];
    this.scene.add(this.level);
    this.hud.setTrack(this.track);
  }

  /* ------------------------------------------------------------------ */
  /* Montagem da corrida                                                  */
  /* ------------------------------------------------------------------ */

  /** Corrida rápida: rivais do planeta da pista, com carros do mesmo nível que o seu. */
  private quickSetup(o: QuickOptions): RaceSetup {
    const def = trackById(o.trackId);
    const s = newCampaign(CHARACTERS[1].id, o.color, o.difficulty);
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
      pilot: CHARACTERS[1].id,
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
      const cam = new THREE.PerspectiveCamera(38, this.root.clientWidth / this.root.clientHeight, 0.1, 600);
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
    this.showcase = null;
  }

  private createRace(): void {
    this.endShowroom();
    const setup = this.setup;
    this.loadTrack(trackById(setup.trackId));
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
      this.world = createWorld(this.track, entries, laps, (Date.now() & 0xffff) + 1, setup.prizes, setup.difficulty);
    }

    for (const v of this.views) {
      this.scene.remove(v.shadow);
      this.scene.remove(v.visual.root);
      if (v.label) {
        this.scene.remove(v.label.sprite);
        v.label.dispose();
      }
    }
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
    this.commentary.reset();
    this.setCamera(this.rig.mode, false);
    const drop = this.touchEl?.querySelector('[data-a="drop"]');
    if (drop) drop.textContent = WEAPON_LABEL[this.player.spec.rear].toUpperCase();
    const assist = this.touchEl?.querySelector('[data-a="nitro"]');
    if (assist) assist.textContent = (WEAPON_LABEL[this.player.spec.assist] ?? 'Nitro').toUpperCase();
  }

  private startRace(): void {
    this.createRace();
    this.countdown = COUNTDOWN;
    this.phase = 'countdown';
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
      this.phase = this.phaseBeforePause;
      this.menus.hideAll();
      this.music.setMood('race');
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
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const scale = this.phase === 'menu' ? Math.min(this.dynRes.scale, 0.75) : this.dynRes.scale;
    const pr = Math.min(window.devicePixelRatio, this.quality.maxPixelRatio) * scale;
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
    const w = this.root.clientWidth;
    const mw = Math.round(Math.min(360, w * 0.36));
    const mh = Math.round(mw * 0.26);
    return { x: Math.round((w - mw) / 2), y: 8, w: mw, h: mh };
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    let frameDt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : DT;
    this.lastFrame = now;
    this.clock += frameDt;
    if (this.phase !== 'menu' && !document.hidden && this.dynRes.update(frameDt)) this.resize();
    for (const fn of this.animated) fn(this.clock);
    // controles de toque só na corrida (largada e prova); menus, pausa e resultados ficam limpos
    if (this.touchEl) {
      const show = this.phase === 'countdown' || this.phase === 'racing';
      if (this.touchEl.classList.contains('off') === show) this.touchEl.classList.toggle('off', !show);
    }
    // menus: cena de fundo a ~30 qps e em resolução reduzida; pausa: imagem congelada
    const menuRes = this.phase === 'menu';
    if (menuRes !== this.menuRes) {
      this.menuRes = menuRes;
      this.resize();
    }
    if (this.phase === 'menu' || this.phase === 'paused') {
      this.idleDt += frameDt;
      if (this.phase === 'paused' ? !this.redraw : this.idleDt < 1 / 31) return;
      frameDt = Math.min(this.idleDt, 0.1);
    }
    this.idleDt = 0;
    this.redraw = false;

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
    // convidado online: interpola entre os dois últimos estados recebidos do host
    const guest = this.isGuestRace();
    const sinceSnap = guest ? performance.now() - this.net!.lastSnapAt : 0;
    const alpha = !simulating ? 1 : guest ? clamp(sinceSnap / SNAP_MS, 0, 1) : this.accumulator / DT;
    this.render(alpha, frameDt, simulating, guest ? Math.min(sinceSnap / 1000, 0.1) : this.accumulator);
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
      this.countdown -= dt;
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
      // convidado: manda os comandos ao host e aplica o estado que chegou
      if (++net.tick % 2 === 0) net.client?.send({ t: 'input', i: input } satisfies ClientMsg);
      this.applySnaps(net);
    } else {
      stepWorld(this.world, net ? { ...net.inputs, [this.playerId]: input } : { [this.playerId]: input }, dt);
      if (net?.host) {
        net.events.push(...this.world.events);
        if (++net.tick % SNAP_EVERY === 0) {
          net.host.broadcast({ t: 'snap', s: takeSnapshot(this.world, net.events) } satisfies HostMsg);
          net.events = [];
        }
      }
    }
    for (const e of this.world.events) this.onEvent(e);

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
          this.hud.message(e.lap === laps ? 'VOLTA FINAL!' : `VOLTA ${e.lap}`, 1.1, 'lap');
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
      const promote = currentPlanet(this.campaign).promote;
      const res = applyRaceResult(this.campaign, p.place, p.money, p.kills);
      saveCampaign(this.campaign);
      report = { outcome: res.outcome, pointsEarned: res.pointsEarned, points: this.campaign.points, promote, label: this.campaignLabel() };
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
  private toHub(notice = ''): void {
    const c = this.campaign!;
    this.phase = 'menu';
    this.engine.silence();
    this.rivalEngines.silence();
    this.announcer.stop();
    this.hud.setVisible(false);
    this.setup = this.campaignSetup(c);
    this.createRace();
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
      loadPassword: (code: string) => {
        const c = decodeSave(code);
        if (!c) return false;
        beginAudio();
        this.campaign = c;
        saveCampaign(c);
        this.toHub('Campanha carregada pela senha.');
        return true;
      },
      campaignRace: () => {
        beginAudio();
        this.startRace();
      },
      openShop: () => this.menus.showShop(this.hubData()),
      buyCar: (id: string) => {
        const c = this.campaign!;
        const price = Math.max(0, CAR_PRICES[id].price - tradeInValue(c.car, VEHICLES[c.car.vehicleId]));
        this.buy(price, () => (c.car = newCarSetup(id)), VEHICLES[id].name);
      },
      buyUpgrade: (kind: 'engine' | 'tires' | 'shocks' | 'armor') => {
        const c = this.campaign!;
        this.buy(upgradePrice(c.car, kind), () => c.car.upgrades[kind]++, 'Melhoria');
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
        if (out === 'champion') this.toMenu();
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
        if (!listSlots().some((x) => !x.empty) && this.phase === 'menu' && this.screen === 'main') this.campaign = null;
      },
      setAutoThrottle: (on: boolean) => {
        this.prefs.autoThrottle = on;
        savePrefs(this.prefs);
        this.controls.autoThrottle = this.touch && on;
        setTouchAutoThrottle(this.touchEl, this.controls.autoThrottle);
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
      restart: () => this.startRace(),
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
      quit: () => (this.setup.mode === 'campaign' && this.campaign ? this.toHub('Corrida abandonada — não contou para a temporada.') : this.toMenu()),
      resultsContinue: () => {
        const c = this.campaign!;
        if (c.champion) {
          this.toMenu();
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
        net.players = [{ id: 'host', name: o.name, color: o.color, vehicleId: o.vehicleId }];
        this.net = net;
        host.onJoin = (id, msg) => this.hostJoin(id, msg as ClientMsg);
        host.onMessage = (id, msg) => {
          const m = msg as ClientMsg;
          const racer = net.racerOf.get(id);
          if (m?.t === 'input' && racer !== undefined) net.inputs[racer] = m.i;
        };
        host.onLeave = (id) => this.hostLeave(id);
        this.showLobby();
      },
      (err) => {
        if (token === this.netToken) this.menus.showOnline('', netErrorText(err));
      },
    );
  }

  private hostJoin(id: string, m: ClientMsg): void {
    const net = this.net;
    if (!net?.host || m?.t !== 'hello') return;
    if (net.players.length >= MAX_PLAYERS) {
      net.host.send(id, { t: 'full' } satisfies HostMsg);
      setTimeout(() => net.host?.kick(id), 500);
      return;
    }
    // cor repetida: pega a primeira livre
    const used = new Set(net.players.map((p) => p.color));
    const color = used.has(m.color) ? (COLORS.find((c) => !used.has(c)) ?? m.color) : m.color;
    const name = String(m.name ?? '').slice(0, 12) || 'Piloto';
    const vehicleId = VEHICLES[m.vehicleId] ? m.vehicleId : 'marauder';
    net.players.push({ id, name, color, vehicleId });
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
        client.onMessage = (msg) => this.guestMessage(msg as HostMsg);
        client.onClose = () => this.onlineLost('O host fechou a sala.');
        this.showLobby();
      },
      (err) => {
        if (token === this.netToken) this.menus.showOnline(code, netErrorText(err));
      },
    );
  }

  private guestMessage(m: HostMsg): void {
    const net = this.net;
    if (!net || !m) return;
    switch (m.t) {
      case 'lobby':
        net.players = m.players;
        net.racing = m.racing;
        net.myId = m.you;
        if (net.inLobby) this.menus.showLobby(this.lobbyView());
        break;
      case 'full':
        this.onlineLost('A sala está cheia (4 pilotos).');
        break;
      case 'start':
        net.racing = true;
        net.inLobby = false;
        net.menuOpen = false;
        net.snaps = [];
        net.tick = 0;
        this.setup = this.onlineSetup(m.race, m.you);
        this.startRace();
        net.lastSnapAt = performance.now();
        break;
      case 'snap':
        if (this.setup.mode === 'online' && this.phase !== 'menu') net.snaps.push(m.s);
        break;
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

  /** Convidado: aplica o estado mais recente do host, com os eventos de todos os pacotes. */
  private applySnaps(net: Online): void {
    const q = net.snaps;
    if (!q.length) {
      this.world.events = [];
      return;
    }
    this.views.forEach((v, i) => (v.prev = snap(this.world.racers[i].car)));
    const events = q.flatMap((s) => s.events);
    applySnapshot(this.world, q[q.length - 1]);
    this.world.events = events;
    q.length = 0;
    net.lastSnapAt = performance.now();
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
      laps: Number(new URLSearchParams(location.search).get('laps')) || def.laps,
      seed: Math.floor(Math.random() * 0xffff) + 1,
      entries,
    };
    net.racerOf.clear();
    net.inputs = {};
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
      const x = lerp(p.x, v.x, alpha);
      const y = lerp(p.y, v.y, alpha);
      const z = lerp(p.z, v.z, alpha);
      const heading = lerpAngle(p.heading, v.heading, alpha);
      const visual = view.visual;
      visual.root.visible = !this.showcase && r.alive && (r.invuln <= 0 || Math.sin(this.clock * 30) > -0.3);
      visual.root.position.set(x, y, z);
      visual.root.rotation.set(-lerp(p.pitch, v.pitch, alpha), heading, lerp(p.roll, v.roll, alpha), 'YXZ');
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
            else if (spd > r.spec.maxSpeed * 0.7 && Math.random() < 0.18) this.effects.dust(wx, ground, wz, new THREE.Color(THEMES[this.track.def.theme].road).lerp(new THREE.Color(0xffffff), 0.35).getHex(), 0.45);
          }
        }
      }
      if (r.alive && v.nitroTime > 0 && simulating) {
        const bx = x - forwardX(heading) * 2.4 * CAR_SCALE;
        const bz = z - forwardZ(heading) * 2.4 * CAR_SCALE;
        this.effects.nitro(bx, y + 0.55 * CAR_SCALE, bz, heading);
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
        position: new THREE.Vector3(pose.x, pose.y, pose.z),
        quaternion: pv.root.quaternion,
        heading: pose.heading,
        velocity: new THREE.Vector3(pc.vx, pc.vy, pc.vz),
        shake: this.shake,
        eye: pv.eye,
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
      this.hud.update(frameDt, {
        time: world.raceTime,
        best: r.progress.lapTimes.length ? Math.min(...r.progress.lapTimes) : null,
        speedKmh: speed * 3.6,
        place: r.place,
        total: world.racers.length,
        armor: r.armor / r.spec.armor,
        money: r.money,
        front: { label: WEAPON_LABEL[r.spec.front], icon: r.spec.front, n: r.frontCharges, max: r.spec.frontCharges },
        rear: { label: WEAPON_LABEL[r.spec.rear], icon: r.spec.rear, n: r.rearCharges, max: r.spec.rearCharges },
        assist: {
          label: WEAPON_LABEL[r.spec.assist] ?? r.spec.assist,
          icon: r.spec.assist,
          n: pc.nitroCharges,
          max: r.spec.nitroCharges,
          active: r.spec.assist === 'jump' ? !pc.grounded && pc.vy > 0 : pc.nitroTime > 0,
        },
        cars: world.racers.filter((o) => o.alive).map((o) => ({ x: o.car.x, z: o.car.z, color: hex(o.color), me: o.id === this.playerId })),
      });
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
      near.sort((p, q) => p.dist - q.dist);
      this.rivalEngines.update(near);
    }

    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    const cam = this.showcase?.cam ?? this.rig.active;
    if (this.showcase) {
      this.showcase.cam.aspect = w / h;
      this.showcase.cam.updateProjectionMatrix();
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
