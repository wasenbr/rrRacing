import * as THREE from 'three';
import { Announcer, LINES } from '../audio/announcer';
import { setSfxEnabled, toggleMute, unlockAudio } from '../audio/context';
import { Music } from '../audio/music';
import { EngineSound } from '../audio/engine';
import { sfxBump, sfxDrop, sfxExplosion, sfxHit, sfxLaser, sfxMissile, sfxPickup } from '../audio/sfx';
import { trackById, TRACKS } from '../data/tracks';
import { VEHICLES } from '../data/vehicles';
import {
  applyRaceResult, currentPlanet, currentTrackId, decodeSave, DIVISIONS, encodeSave, newCampaign, opponentsFor, PLANETS, playerSpec, prizesFor,
  type CampaignState,
} from '../sim/campaign';
import { buildSpec, CAR_PRICES, CHARACTERS, chargePrice, newCarSetup, tradeInValue, upgradePrice } from '../sim/garage';
import { loadCampaign, loadPrefs, saveCampaign, savePrefs } from './storage';
import { Controls, createTouchControls, isTouchDevice } from '../input/controls';
import { CAMERA_LABELS, CameraRig, type CameraMode } from '../render/cameras';
import { createCarMesh, type CarVisual } from '../render/cars';
import { Effects } from '../render/effects';
import { buildEnvironment, buildGround, buildSky, SUN_DIR } from '../render/environment';
import { contactShadow } from '../render/textures';
import { PostFx } from '../render/postfx';
import { buildScenery } from '../render/scenery';
import { darkBackdrop, THEMES } from '../render/themes';
import { buildTrackMesh, canvasTexture } from '../render/trackMesh';
import { emptyInput, type ControlInput } from '../sim/input';
import { clamp, lerp, lerpAngle } from '../sim/math';
import { Track, type TrackDef } from '../sim/track';
import { CAR_SCALE, forwardSpeed, type VehicleSpec, type VehicleState } from '../sim/vehicle';
import { createWorld, PRIZES, stepWorld, type Racer, type RacerEntry, type World, type WorldEvent } from '../sim/world';
import type { AiProfile } from '../sim/ai';
import { Hud, formatTime } from '../ui/hud';
import { Menus, WEAPON_LABEL, type CampaignReport, type HubData, type ResultRow } from '../ui/menus';

const DT = 1 / 60;
const COUNTDOWN = 3;

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
  mode: 'quick' | 'campaign';
  trackId: string;
  opponents: { name: string; color: number; spec: VehicleSpec; ai: AiProfile }[];
  playerName: string;
  playerColor: number;
  playerSpec: VehicleSpec;
  prizes: number[];
}

interface CarView {
  /** sombra de contato (mancha escura sob o carro, também no celular) */
  shadow: THREE.Mesh;
  visual: CarVisual;
  prev: Snapshot;
  label: THREE.Sprite | null;
  smokeTimer: number;
}

function nameSprite(name: string, color: number): THREE.Sprite {
  const tex = canvasTexture(256, 64, (ctx) => {
    ctx.font = 'bold 34px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(name, 128, 34);
    ctx.fillStyle = hex(color);
    ctx.fillText(name, 128, 34);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(4.4, 1.1, 1);
  return s;
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
  private prefs = loadPrefs({ camera: 'iso' as CameraMode, music: true, sfx: true, announcer: true, musicVolume: 0.7 });
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
  private announcer = new Announcer();
  private phase: Phase = 'menu';
  private phaseBeforePause: Phase = 'racing';
  private countdown = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private shake = 0;
  private bounce = 0;
  private bounceVel = 0;
  private leaderId = -1;
  private warnedLow = new Set<number>();
  private resultsTimer = 0;
  private readonly touch = isTouchDevice();
  private touchEl: HTMLElement | null = null;
  private readonly shadows: boolean;
  private postfx: PostFx | null = null;
  private animated: ((t: number) => void)[] = [];
  private sky: THREE.Mesh | null = null;
  private shadowGeo = new THREE.PlaneGeometry(2.7 * CAR_SCALE, 5 * CAR_SCALE).rotateX(-Math.PI / 2);
  private clock = 0;

  constructor(private root: HTMLElement) {
    this.shadows = !this.touch;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    root.appendChild(this.renderer.domElement);

    this.scene.environmentIntensity = 0.8;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 1.35);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = this.shadows;
    this.sun.shadow.mapSize.set(this.touch ? 1024 : 4096, this.touch ? 1024 : 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -50;
    sc.right = sc.top = 50;
    sc.near = 1;
    sc.far = 220;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.effects.group);
    // bloom só no PC: no celular pesa demais
    if (!this.touch) this.postfx = new PostFx(this.renderer, this.scene);

    this.hud = new Hud(root);
    this.hud.setVisible(false);
    if (this.touch) this.touchEl = createTouchControls(root, this.controls);
    this.rig.mode = this.prefs.camera;
    this.menus = new Menus(root, this.menuActions(), VEHICLES, TRACKS);
    this.menus.setCameraChoice(this.prefs.camera);
    this.campaign = loadCampaign();

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
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.phase === 'racing' || this.phase === 'countdown')) this.togglePause();
    });

    // cenário de fundo do menu: a primeira pista, com os carros parados no grid
    this.setup = this.quickSetup({ trackId: TRACKS[0].id, vehicleId: 'marauder', color: 0x2f7bff });
    this.createRace();
    this.resize();
    this.menus.showMain(!!this.campaign);
    requestAnimationFrame((t) => this.frame(t));
  }

  private enterFullscreen(): void {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen()
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
    }
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
    const theme = darkBackdrop(THEMES[def.theme]);
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
    const oldEnv = this.scene.environment;
    this.scene.environment = buildEnvironment(this.renderer, theme);
    oldEnv?.dispose();
    this.sky = buildSky(theme);
    this.level.add(this.sky);
    this.scene.fog = new THREE.Fog(theme.fog, 150, 420);
    this.hemi.color.set(theme.ambientSky);
    this.hemi.groundColor.set(theme.ambientGround);
    this.sun.color.set(theme.sun);
    this.sun.intensity = theme.sunIntensity * 1.25;
    const ground = buildGround(this.track, theme, this.shadows);
    const scenery = buildScenery(this.track, theme, def.theme, this.shadows, def.id.length * 7 + 3);
    this.level.add(ground.mesh, buildTrackMesh(this.track, theme, this.shadows), scenery.group);
    this.animated = [ground.update, scenery.update];
    this.scene.add(this.level);
    this.hud.setTrack(this.track);
  }

  /* ------------------------------------------------------------------ */
  /* Montagem da corrida                                                  */
  /* ------------------------------------------------------------------ */

  /** Corrida rápida: rivais do planeta da pista, com carros do mesmo nível que o seu. */
  private quickSetup(o: { trackId: string; vehicleId: string; color: number }): RaceSetup {
    const def = trackById(o.trackId);
    const s = newCampaign(CHARACTERS[1].id, o.color);
    s.planet = Math.max(0, PLANETS.findIndex((p) => p.theme === def.theme));
    const car = newCarSetup(o.vehicleId);
    const level = Math.min(3, Math.floor((s.planet * 2) / 3));
    car.upgrades = { engine: level, tires: level, shocks: level, armor: level };
    return {
      mode: 'quick',
      trackId: def.id,
      opponents: opponentsFor(s, VEHICLES),
      playerName: 'Você',
      playerColor: o.color,
      playerSpec: buildSpec(VEHICLES[o.vehicleId], car),
      prizes: PRIZES,
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
    };
  }

  /** Monta o grid: os 3 rivais largam na frente, o jogador por último (como no original). */
  private createRace(): void {
    const setup = this.setup;
    this.loadTrack(trackById(setup.trackId));
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
    this.world = createWorld(this.track, entries, laps, (Date.now() & 0xffff) + 1, setup.prizes);

    for (const v of this.views) {
      this.scene.remove(v.shadow);
      this.scene.remove(v.visual.root);
      if (v.label) this.scene.remove(v.label);
    }
    this.views = this.world.racers.map((r, i) => {
      const visual = createCarMesh(r.spec.id, r.color, this.shadows);
      this.scene.add(visual.root);
      const label = i !== this.playerId ? nameSprite(r.name, r.color) : null;
      if (label) this.scene.add(label);
      const shadow = new THREE.Mesh(
        this.shadowGeo,
        new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      );
      shadow.renderOrder = 1;
      this.scene.add(shadow);
      return { visual, prev: snap(r.car), label, smokeTimer: 0, shadow };
    });
    this.leaderId = -1;
    this.warnedLow.clear();
    this.setCamera(this.rig.mode, false);
    const drop = this.touchEl?.querySelector('[data-a="drop"]');
    if (drop) drop.textContent = WEAPON_LABEL[this.player.spec.rear].toUpperCase();
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
    this.music.play(this.track.def.theme, 'race');
  }

  private toMenu(): void {
    this.phase = 'menu';
    this.engine.silence();
    window.speechSynthesis?.cancel();
    this.hud.setVisible(false);
    this.screen = 'main';
    this.music.play(this.track.def.theme, 'menu');
    this.menus.showMain(!!this.campaign);
  }

  private togglePause(): void {
    if (this.phase === 'paused') {
      this.phase = this.phaseBeforePause;
      this.menus.hideAll();
      this.music.setMood('race');
    } else if (this.phase === 'racing' || this.phase === 'countdown') {
      this.phaseBeforePause = this.phase;
      this.phase = 'paused';
      this.engine.silence();
      window.speechSynthesis?.cancel();
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
    const pr = Math.min(window.devicePixelRatio, this.touch ? 1.5 : 2);
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
    const frameDt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : DT;
    this.lastFrame = now;
    this.clock += frameDt;
    for (const fn of this.animated) fn(this.clock);

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
    this.render(simulating ? this.accumulator / DT : 1, frameDt, simulating);
  }

  private step(dt: number): void {
    this.views.forEach((v, i) => (v.prev = snap(this.world.racers[i].car)));
    let input: ControlInput = this.controls.read();
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.world.started = true;
        this.hud.message('VAI!', 1, 'go');
        this.announcer.say(LINES.start(), true);
      } else {
        this.hud.message(String(Math.ceil(this.countdown)), 0, 'count');
      }
      input = emptyInput();
    }

    stepWorld(this.world, { [this.playerId]: input }, dt);
    for (const e of this.world.events) this.onEvent(e);

    const p = this.player;
    if (this.phase === 'racing' && p.progress.wrongWayTime > 1) this.hud.message('CONTRAMÃO!', 0.2, 'warn');

    // quem lidera
    const leader = this.world.racers.find((r) => r.place === 1)!;
    if (this.phase === 'racing' && leader.id !== this.leaderId) {
      if (this.leaderId !== -1 && this.world.raceTime > 5) this.announcer.say(LINES.lead(this.speakName(leader)));
      this.leaderId = leader.id;
    }
    // blindagem baixa
    for (const r of this.world.racers) {
      const ratio = r.armor / r.spec.armor;
      if (r.alive && ratio < 0.3 && !this.warnedLow.has(r.id)) {
        this.warnedLow.add(r.id);
        this.announcer.say(LINES.lowArmor(this.speakName(r)));
      } else if (ratio > 0.6) this.warnedLow.delete(r.id);
    }

    if (this.phase === 'finished') {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) this.showResults();
    }

    // efeitos de impacto no carro do jogador
    const car = p.car;
    if (car.landingImpact > 2) {
      this.bounceVel -= car.landingImpact * 0.12;
      this.shake = Math.max(this.shake, clamp(car.landingImpact / 25, 0, 0.6));
    }
    if (car.wallImpact > 4) this.shake = Math.max(this.shake, clamp(car.wallImpact / 30, 0, 0.5));
    this.bounceVel += (-this.bounce * 300 - this.bounceVel * 18) * dt;
    this.bounce += this.bounceVel * dt;
    this.shake *= Math.exp(-dt * 6);
  }

  /** Nome para o locutor ('' = o próprio jogador). */
  private speakName(r: Racer): string {
    return r.id === this.playerId ? '' : r.name;
  }

  /** Volume de um som conforme a distância até o jogador. */
  private vol(x: number, z: number): number {
    const c = this.player.car;
    return clamp(1 - Math.hypot(x - c.x, z - c.z) / 90, 0, 1);
  }

  private onEvent(e: WorldEvent): void {
    const racers = this.world.racers;
    const me = this.playerId;
    const name = (id: number) => (id === me ? 'Você' : racers[id].name);
    switch (e.type) {
      case 'fire':
        if (e.kind === 'laser') sfxLaser(this.vol(e.x, e.z));
        else sfxMissile(this.vol(e.x, e.z));
        this.effects.sparks(e.x, e.y, e.z, 4);
        break;
      case 'drop': {
        const c = racers[e.racer].car;
        sfxDrop(this.vol(c.x, c.z));
        break;
      }
      case 'hit':
        if (e.kind === 'laser') {
          this.effects.sparks(e.x, e.y, e.z, 12);
          sfxHit(this.vol(e.x, e.z));
        } else {
          this.effects.explosion(e.x, e.y - 0.8, e.z, false);
          sfxExplosion(this.vol(e.x, e.z), false);
        }
        if (e.target === me) this.shake = Math.max(this.shake, e.kind === 'laser' ? 0.25 : 0.7);
        break;
      case 'impact':
        this.effects.sparks(e.x, e.y, e.z, e.kind === 'missile' ? 14 : 6);
        if (e.kind === 'missile') {
          this.effects.explosion(e.x, e.y - 0.8, e.z, false);
          sfxExplosion(this.vol(e.x, e.z) * 0.7, false);
        }
        break;
      case 'spin':
        if (e.racer === me) this.hud.showToast('Óleo! 🌀');
        break;
      case 'explode': {
        this.effects.explosion(e.x, e.y, e.z, true);
        sfxExplosion(this.vol(e.x, e.z), true);
        if (e.racer === me) {
          this.shake = 1.2;
          this.hud.message('DESTRUÍDO!', 2, 'warn');
        } else if (e.by === me) {
          this.hud.showToast(`💥 Você destruiu ${racers[e.racer].name}!`);
        } else {
          this.hud.showToast(`💥 ${name(e.racer)} explodiu!`);
        }
        this.announcer.say(LINES.explode(this.speakName(racers[e.racer])), true);
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
          sfxBump(clamp(e.strength / 15, 0, 1));
          this.shake = Math.max(this.shake, clamp(e.strength / 40, 0, 0.3));
        }
        break;
      case 'lap':
        if (e.racer === me) {
          const laps = this.world.laps;
          this.hud.setLap(e.lap, laps);
          const times = this.player.progress.lapTimes;
          this.hud.message(e.lap === laps ? 'VOLTA FINAL!' : `VOLTA ${e.lap}`, 1.6, 'lap');
          this.hud.showToast(`Volta: ${formatTime(times[times.length - 1])} · armas recarregadas`);
          if (e.lap === laps) this.announcer.say(LINES.finalLap(), true);
        }
        break;
      case 'finish':
        if (e.place === 1) this.announcer.say(LINES.winner(this.speakName(racers[e.racer])), true);
        if (e.racer === me) {
          this.phase = 'finished';
          this.hud.message(e.place === 1 ? 'VITÓRIA!' : `${e.place}º LUGAR`, 3, 'go');
          this.resultsTimer = 3;
        }
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
    }));
    let report: CampaignReport | null = null;
    if (this.setup.mode === 'campaign' && this.campaign) {
      const p = this.player;
      const res = applyRaceResult(this.campaign, p.place, p.money, p.kills);
      saveCampaign(this.campaign);
      report = { outcome: res.outcome, pointsEarned: res.pointsEarned, points: this.campaign.points, label: this.campaignLabel() };
    }
    this.hud.clearMessage();
    this.music.setMood('menu');
    this.menus.showResults(rows, this.player.progress.lapTimes, report);
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
    window.speechSynthesis?.cancel();
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
    };
  }

  private menuActions() {
    const beginAudio = () => {
      unlockAudio();
      this.engine.start();
      this.music.play(this.track.def.theme, 'menu');
      if (this.touch) this.enterFullscreen();
    };
    return {
      quickRace: (o: { trackId: string; vehicleId: string; color: number }) => {
        beginAudio();
        this.setup = this.quickSetup(o);
        this.startRace();
      },
      newCampaign: (characterId: string, color: number) => {
        beginAudio();
        this.campaign = newCampaign(characterId, color);
        saveCampaign(this.campaign);
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
        const price = Math.max(0, CAR_PRICES[id].price - tradeInValue(c.car));
        this.buy(price, () => (c.car = newCarSetup(id)), VEHICLES[id].name);
      },
      buyUpgrade: (kind: 'engine' | 'tires' | 'shocks' | 'armor') => {
        const c = this.campaign!;
        this.buy(upgradePrice(c.car, kind), () => c.car.upgrades[kind]++, 'Melhoria');
      },
      buyCharge: (kind: 'front' | 'rear' | 'nitro') => {
        const c = this.campaign!;
        this.buy(chargePrice(c.car, kind), () => c.car.charges[kind]++, 'Carga extra');
      },
      showPassword: () => this.menus.showPassword(encodeSave(this.campaign!)),
      backToHub: () => this.toHub(),
      resume: () => this.togglePause(),
      restart: () => this.startRace(),
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
        if (this.phase === 'paused') this.menus.showPause();
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
          if (!on) window.speechSynthesis?.cancel();
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

  private render(alpha: number, frameDt: number, simulating: boolean): void {
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
      visual.root.visible = r.alive && (r.invuln <= 0 || Math.sin(this.clock * 30) > -0.3);
      visual.root.position.set(x, y, z);
      visual.root.rotation.set(-lerp(p.pitch, v.pitch, alpha), heading, lerp(p.roll, v.roll, alpha), 'YXZ');
      visual.animate({ spin: v.wheelSpin, steer: v.steer, speed: forwardSpeed(v), time: this.clock, grounded: v.grounded });
      for (const f of visual.flames) {
        f.visible = r.alive && v.nitroTime > 0;
        if (f.visible) f.scale.setScalar(0.8 + Math.random() * 0.5);
      }
      // sombra de contato no chão, some conforme o carro sobe num salto
      const ground = world.track.query(x, z, v.pieceIndex).height;
      const lift = y - ground;
      view.shadow.visible = r.alive;
      view.shadow.position.set(x, ground + 0.03, z);
      view.shadow.rotation.y = heading;
      (view.shadow.material as THREE.MeshBasicMaterial).opacity = clamp(1 - lift / 4, 0, 1);
      view.shadow.scale.setScalar(1 + lift * 0.08);
      if (view.label) {
        view.label.visible = r.alive;
        view.label.position.set(x, y + 2.6, z);
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
      if (i === this.playerId) {
        visual.body.position.y = clamp(this.bounce, -0.25, 0.15);
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
    this.effects.update(world, simulating ? frameDt : 0, simulating ? this.accumulator : 0);

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
        nitro: pc.nitroCharges,
        nitroMax: r.spec.nitroCharges,
        boosting: pc.nitroTime > 0,
        cars: world.racers.filter((o) => o.alive).map((o) => ({ x: o.car.x, z: o.car.z, color: hex(o.color), me: o.id === this.playerId })),
      });
      this.engine.update(clamp(Math.abs(speed) / r.spec.maxSpeed, 0, 1.3), r.alive ? r.lastInput.throttle : 0, pc.nitroTime > 0);
    }

    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    if (this.postfx) this.postfx.render(this.rig.active);
    else this.renderer.render(this.scene, this.rig.active);

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
