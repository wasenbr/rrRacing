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
  private readonly enabled = !new URLSearchParams(location.search).has('q');

  constructor(public min = 0.6) {}

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
    // a medição recomeça no novo degrau
    this.slow = 0;
    return true;
  }
}
