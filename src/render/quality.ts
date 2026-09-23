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
}

export const QUALITY_LABELS: Record<QualityPref, string> = { auto: 'Automática', baixo: 'Baixa', medio: 'Média', alto: 'Alta' };

function gpuName(): string {
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
  if (touch) return mem <= 3 || cores <= 4 || /mali-[gt]?[0-7]\d\b|adreno \(tm\) [1-5]\d\d|powervr/.test(gpu) ? 'baixo' : 'medio';
  if (mem <= 4 || cores <= 2) return 'baixo';
  if (/intel|uhd|hd graphics|iris|mali|adreno/.test(gpu) || cores <= 4) return 'medio';
  return 'alto';
}

export function resolveQuality(pref: QualityPref, touch: boolean): QualitySettings {
  const forced = new URLSearchParams(location.search).get('q');
  const level: QualityLevel =
    forced === 'baixo' || forced === 'medio' || forced === 'alto' ? forced : pref === 'auto' ? detectQuality(touch) : pref;
  if (level === 'alto')
    return { level, antialias: true, shadows: true, shadowMapSize: touch ? 1024 : 2048, bloom: !touch, maxPixelRatio: touch ? 1.5 : 2, dense: true, particles: 1 };
  if (level === 'medio')
    return { level, antialias: true, shadows: !touch, shadowMapSize: 1024, bloom: false, maxPixelRatio: 1.5, dense: false, particles: 0.75 };
  return { level, antialias: false, shadows: false, shadowMapSize: 512, bloom: false, maxPixelRatio: 1, dense: false, particles: 0.45 };
}

/**
 * Resolução dinâmica: mede o tempo de quadro e baixa a escala (até 60%) quando o fps cai,
 * subindo de novo devagar quando sobra folga. Desligada quando a qualidade é forçada pela URL.
 */
export class DynamicResolution {
  scale = 1;
  private avg = 1 / 60;
  private cooldown = 2;
  private readonly enabled = !new URLSearchParams(location.search).has('q');

  constructor(private readonly min = 0.6) {}

  /** Retorna true quando a escala mudou (é hora de chamar setPixelRatio). */
  update(frameDt: number): boolean {
    if (!this.enabled || frameDt <= 0 || frameDt > 0.25) return false;
    this.avg += (frameDt - this.avg) * 0.05;
    this.cooldown -= frameDt;
    if (this.cooldown > 0) return false;
    let next = this.scale;
    if (this.avg > 1 / 48) next = Math.max(this.min, this.scale - 0.1);
    else if (this.avg < 1 / 58 && this.scale < 1) next = Math.min(1, this.scale + 0.05);
    if (next === this.scale) return false;
    this.cooldown = next < this.scale ? 1 : 2.5;
    this.scale = next;
    return true;
  }
}
