/**
 * Níveis de qualidade gráfica. "auto" escolhe pelo aparelho; a resolução dinâmica ajusta a
 * densidade de pixels em tempo real para segurar ~55+ fps em hardware simples.
 * Forçar por URL: ?q=baixo|medio|alto (usado nas capturas de evidência).
 */
export type QualityLevel = 'baixo' | 'medio' | 'alto';
export type QualityPref = 'auto' | QualityLevel;

export interface QualitySettings {
  level: QualityLevel;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  /** teto do devicePixelRatio */
  maxPixelRatio: number;
  /** cenário cheio (mais objetos e detritos) */
  dense: boolean;
  /** fração das partículas de fumaça/poeira */
  particles: number;
  /** teto da filtragem anisotrópica das texturas (custo por pixel em GPU simples/render por software) */
  anisotropy: number;
  /** luzes pontuais dos clarões de explosão (cada luz extra pesa em todo pixel iluminado) */
  flashLights: boolean;
  /** piso da resolução dinâmica (fração do pixelRatio) */
  minScale: number;
  /** escala inicial da resolução dinâmica (sobe sozinha até 1 quando sobra folga) */
  startScale: number;
}

export const QUALITY_LABELS: Record<QualityPref, string> = { auto: 'Automática', baixo: 'Baixa', medio: 'Média', alto: 'Alta' };

let gpuCache: string | null = null;

function gpuName(): string {
  if (gpuCache === null) gpuCache = readGpuName();
  return gpuCache;
}

function readGpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name.toLowerCase();
  } catch {
    return '';
  }
}

/** Palpite do nível pelo aparelho: memória, núcleos e placa de vídeo. */
export function detectQuality(touch: boolean): QualityLevel {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency || 4;
  const gpu = gpuName();
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'baixo';
  // iPhone/iPad: o Safari esconde memória e núcleos (os números "baixos" caíam no nível baixo, com
  // 1 pixel por ponto numa tela 3x: tudo pixelado). O nível alto (sombra 1024 + luzes dos clarões)
  // esquentava e engasgava nos modelos mais antigos: médio, com teto de 2x de densidade
  if (touch && /apple/.test(gpu)) return 'medio';
  if (touch) return mem <= 3 || cores <= 4 || /mali-[gt]?[0-7]\d\b|adreno \(tm\) [1-5]\d\d|powervr/.test(gpu) ? 'baixo' : 'medio';
  if (mem <= 4 || cores <= 2) return 'baixo';
  if (/intel|uhd|hd graphics|iris|mali|adreno/.test(gpu) || cores <= 4) return 'medio';
  return 'alto';
}

export function resolveQuality(pref: QualityPref, touch: boolean): QualitySettings {
  const forced = new URLSearchParams(location.search).get('q');
  const level: QualityLevel =
    forced === 'baixo' || forced === 'medio' || forced === 'alto' ? forced : pref === 'auto' ? detectQuality(touch) : pref;
  // custo decrescente: alto > médio > baixo (o alto também tem MSAA no alvo do bloom; o médio do PC
  // usa o MSAA da tela, que antes faltava e deixava as bordas serrilhadas)
  if (level === 'alto')
    return { level, antialias: true, shadows: true, shadowMapSize: touch ? 1024 : 2048, bloom: !touch, maxPixelRatio: 2, dense: true, particles: 1, anisotropy: 16, flashLights: true, minScale: 0.6, startScale: 1 };
  // médio: sem as luzes pontuais dos clarões (entram no shader de todo material iluminado: ~18% da
  // GPU mesmo apagadas). No toque (tablet com tela grande e densa), começa em 1,0x e só sobe para
  // 1,5x se o aparelho aguentar: a resolução era metade do custo de GPU medido. No PC (GPU integrada)
  // começa em 0,8x: em 1,0x engasgava 1 quadro em 10; sobe sozinha se houver folga
  if (level === 'medio')
    return { level, antialias: !touch, shadows: !touch, shadowMapSize: 1024, bloom: false, maxPixelRatio: touch && /apple/.test(gpuName()) ? 2 : 1.5, dense: false, particles: 0.75, anisotropy: 4, flashLights: false, minScale: 0.5, startScale: touch ? 0.67 : 0.8 };
  return { level, antialias: false, shadows: false, shadowMapSize: 512, bloom: false, maxPixelRatio: 1, dense: false, particles: 0.4, anisotropy: 2, flashLights: false, minScale: 0.5, startScale: 1 };
}

/**
 * Resolução dinâmica: mede o custo dos quadros desenhados e baixa a escala (até `min`) quando o fps cai,
 * subindo devagar quando sobra folga. Além da média, conta os quadros perdidos (> 25 ms): numa GPU
 * integrada o jogo fica perto do limite e engasga em 1 de cada 10 quadros sem a média passar de
 * 1/50 s — a média sozinha não reagia e o jogo seguia travando.
 * Cada troca recria o buffer da tela (um engasgo no tablet), então ela não fica oscilando: se uma
 * subida derruba o fps logo depois, aquele degrau vira teto.
 * Desligada quando a qualidade é forçada pela URL.
 */
export class DynamicResolution {
  scale = 1;
  private avg = 1 / 60;
  /** fração recente de quadros perdidos (média móvel de 0/1) */
  private slow = 0;
  private cooldown = 2;
  private ceiling = 1;
  private clock = 0;
  private lastUp = -Infinity;
  /** desligada com ?q= (as evidências ligam de volta para medir) */
  enabled = typeof location === 'undefined' || !new URLSearchParams(location.search).has('q');
  /** trocas de escala [relógio da resolução (s), escala] — as últimas 32, para as evidências */
  readonly history: [number, number][] = [];

  constructor(public min = 0.6) {}

  /** Começa numa escala conhecida (a da corrida anterior), limitada ao piso e ao teto atuais. */
  restore(scale: number): void {
    if (!Number.isFinite(scale)) return;
    this.scale = Math.min(this.ceiling, Math.max(this.min, scale));
  }

  /**
   * Piso efetivo (o jogo calcula pela tela: abaixo dele um degrau não mudaria nenhum pixel). Se o
   * piso sobe, a escala e o teto sobem junto.
   */
  setMin(min: number): void {
    this.min = min;
    if (this.scale < min) this.scale = min;
    if (this.ceiling < min) this.ceiling = min;
  }

  /**
   * Chamada a cada quadro DESENHADO. `frameDt` = tempo desde o último quadro desenhado (anda os
   * relógios); `cost` = custo do quadro já normalizado para o orçamento de 60 qps (trabalho do quadro
   * ou o intervalo, o maior). Retorna true quando a escala mudou (é hora de chamar setPixelRatio).
   */
  update(frameDt: number, cost = frameDt): boolean {
    if (!this.enabled || frameDt <= 0 || frameDt > 0.25) return false;
    this.clock += frameDt;
    this.avg += (cost - this.avg) * 0.05;
    this.slow += ((cost > 0.025 ? 1 : 0) - this.slow) * 0.02;
    this.cooldown -= frameDt;
    if (this.cooldown > 0) return false;
    let next = this.scale;
    if (this.avg > 1 / 50 || this.slow > 0.05) {
      next = Math.max(this.min, this.scale - 0.1);
      // a última subida não se sustentou: não tenta mais aquele degrau
      if (this.clock - this.lastUp < 8) this.ceiling = Math.max(this.min, this.scale - 0.05);
    } else if (this.avg < 1 / 57 && this.slow < 0.01 && this.scale < this.ceiling) {
      next = Math.min(this.ceiling, this.scale + 0.05);
      this.lastUp = this.clock;
    }
    if (Math.abs(next - this.scale) < 1e-6) return false;
    this.cooldown = next < this.scale ? 1.2 : 5;
    this.scale = next;
    if (this.history.length >= 32) this.history.shift();
    this.history.push([+this.clock.toFixed(2), +next.toFixed(3)]);
    // a medição recomeça no novo degrau
    this.slow = 0;
    return true;
  }
}

/** Escala da resolução dinâmica em que a última corrida terminou, por nível (sobrevive à recarga). */
const SCALE_KEY = 'rr.dynScale.';
export function loadDynScale(level: QualityLevel): number | null {
  try {
    const v = parseFloat(localStorage.getItem(SCALE_KEY + level) ?? '');
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
  } catch {
    return null;
  }
}
export function saveDynScale(level: QualityLevel, scale: number): void {
  try {
    localStorage.setItem(SCALE_KEY + level, scale.toFixed(3));
  } catch {
    /* sem armazenamento: começa do padrão */
  }
}

/** O que cada degrau da queda automática faz (ver AutoDegrade). */
export type DegradeAction = 'flash' | 'bloom' | 'shadow' | 'particles' | 'cap30';
/** O que ainda existe para desligar. */
export interface DegradeCaps {
  flashLights: boolean;
  bloom: boolean;
  shadow: boolean;
  particles: boolean;
}

/**
 * Queda automática de nível quando a resolução dinâmica já está no piso e o jogo ainda não segura
 * ~42 qps: primeiro as luzes dos clarões (pendente até a próxima largada: não gasta a espera), depois
 * o bloom (o maior custo do alto), a sombra, metade das partículas e, por fim, a trava em 30 qps.
 * Um degrau com efeito a cada 3 s. Nenhum degrau troca programas no meio da corrida: o jogo aplica
 * o que muda shader só no preparo da próxima largada.
 */
export class AutoDegrade {
  level = 0;
  private slowAvg = 1 / 60;
  private cd = 0;

  /** Chamado a cada quadro desenhado na corrida. Retorna as ações do degrau (ou null). */
  update(dt: number, cost: number, atFloor: boolean, caps: DegradeCaps): DegradeAction[] | null {
    this.slowAvg += (cost - this.slowAvg) * 0.03;
    this.cd -= dt;
    if (this.cd > 0 || this.slowAvg <= 1 / 42 || !atFloor || this.level >= 5) return null;
    this.cd = 3;
    this.slowAvg = 1 / 60;
    const out: DegradeAction[] = [];
    while (this.level < 5) {
      const step = this.level++;
      if (step === 0 && caps.flashLights) {
        out.push('flash');
        continue;
      }
      const a: DegradeAction | null =
        step === 1 && caps.bloom ? 'bloom' : step === 2 && caps.shadow ? 'shadow' : step === 3 && caps.particles ? 'particles' : step === 4 ? 'cap30' : null;
      if (a) {
        out.push(a);
        break;
      }
    }
    return out.length ? out : null;
  }
}

/**
 * Economia de bateria (item 52): "Automática" liga sozinha fora da tomada (navigator.getBattery, onde
 * existe: Chrome/Edge; Safari e Firefox não informam: a automática segura ~60 qps e liga a economia se a resolução ficar presa no piso), "Sempre" e "Nunca".
 * Na economia: corrida a 30 qps, teto de resolução ×0,75, sombra a cada 3 quadros e metade das
 * partículas — nada que mude os shaders (troca no meio da corrida sem recompilar).
 */
export type BatteryPref = 'auto' | 'on' | 'off';
export const BATTERY_LABELS: Record<BatteryPref, string> = { auto: 'Automática', on: 'Sempre', off: 'Nunca' };
/** fração do teto de resolução na economia */
export const ECO_RES = 0.75;
/** fração das partículas na economia */
export const ECO_PARTICLES = 0.5;
/** a sombra é redesenhada a cada N quadros desenhados na economia */
export const ECO_SHADOW_EVERY = 3;
/**
 * "Automática" sem getBattery: segundos de corrida com a resolução dinâmica presa no piso até ligar a
 * economia sozinha (o aparelho não dá conta; provavelmente um notebook fraco ou na bateria).
 */
export const ECO_AUTO_S = 20;

/** O navegador informa a bateria (getBattery: Chrome/Edge; Safari e Firefox não). */
export function batteryApiAvailable(): boolean {
  return typeof (navigator as Navigator & { getBattery?: unknown }).getBattery === 'function';
}

/** Preferência salva (a antiga era booleana: ligada = "Sempre"; desligada vira a automática). */
export function normalizeBatteryPref(v: unknown): BatteryPref {
  if (v === 'auto' || v === 'on' || v === 'off') return v;
  return v === true ? 'on' : 'auto';
}

interface BatteryLike extends EventTarget {
  charging: boolean;
}

/**
 * Observa a bateria: chama `cb(true)` quando o aparelho está fora da tomada e `cb(false)` ligado nela
 * (ou quando não dá para saber). Sem getBattery, não chama nada (fica "na tomada").
 */
export function watchBattery(cb: (discharging: boolean) => void): void {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (typeof nav.getBattery !== 'function') return;
  nav.getBattery().then(
    (b) => {
      cb(!b.charging);
      b.addEventListener('chargingchange', () => cb(!b.charging));
    },
    () => undefined,
  );
}
