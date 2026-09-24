/**
 * Retratos dos pilotos, desenhados por código em SVG no estilo "capa de card": rosto grande,
 * sombreamento por gradientes, fundo temático com profundidade, roupa visível, vinheta e moldura metálica.
 * Os 7 pilotos jogáveis têm ilustração escrita à mão; rivais e pilotos desconhecidos usam um
 * montador de peças com o mesmo acabamento.
 */

import { idleJob } from './idleQueue';

const INK = '#120a08';
type Stop = [number, string, number?];
type Pt = [number, number];

let uid = 0;

/** Acumula defs (gradientes/clips com ids únicos) e o corpo do SVG de um retrato. */
class Pic {
  readonly id = `pt${uid++}`;
  private n = 0;
  readonly defs: string[] = [];
  readonly out: string[] = [];
  private stops(s: Stop[]): string {
    return s.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('');
  }
  /** Gradiente linear; coordenadas em fração da caixa, ou em unidades do desenho com `user`. */
  lin(s: Stop[], x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false): string {
    const k = `${this.id}g${this.n++}`;
    this.defs.push(`<linearGradient id="${k}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${this.stops(s)}</linearGradient>`);
    return `url(#${k})`;
  }
  rad(s: Stop[], cx = 0.5, cy = 0.5, r = 0.5, user = false): string {
    const k = `${this.id}g${this.n++}`;
    this.defs.push(`<radialGradient id="${k}" cx="${cx}" cy="${cy}" r="${r}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${this.stops(s)}</radialGradient>`);
    return `url(#${k})`;
  }
  clip(inner: string): string {
    const k = `${this.id}c${this.n++}`;
    this.defs.push(`<clipPath id="${k}">${inner}</clipPath>`);
    return `url(#${k})`;
  }
  add(...s: string[]): void {
    this.out.push(...s);
  }
  /** Índice em `out` onde começa a figura (antes disso é cenário: fica desfocado e atrás da névoa). */
  subj = -1;
  /** Luzes de recorte coloridas (esquerda e direita) e cor da névoa entre cenário e figura. */
  rimL = '#ffd8a0';
  rimR = '#8ad0ff';
  fog = '#8aa0c0';
  /** Marca o início da figura e define a iluminação da cena. */
  figure(rimL: string, rimR: string, fog: string): void {
    this.subj = this.out.length;
    this.rimL = rimL;
    this.rimR = rimR;
    this.fog = fog;
  }
  private blurs = new Map<number, string>();
  /** Filtro de desfoque (pinceladas macias de luz e sombra). */
  blur(sd: number): string {
    let k = this.blurs.get(sd);
    if (!k) {
      k = `${this.id}b${this.n++}`;
      this.defs.push(`<filter id="${k}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`);
      this.blurs.set(sd, k);
    }
    return `filter="url(#${k})"`;
  }
  private texs = new Map<string, string>();
  /**
   * Textura de material por filtro (ruído + relevo iluminado): couro (grão e dobras com brilho),
   * metal escovado (riscos horizontais), tecido (trama fina), pele (poros e manchas), pelo.
   * Devolve o id do filtro; use com `texture()`.
   */
  tex(kind: TexKind): string {
    let k = this.texs.get(kind);
    if (k) return k;
    k = `${this.id}t${this.n++}`;
    const U = `x="0" y="0" width="200" height="200" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`;
    const gray = '<feColorMatrix type="saturate" values="0"/>';
    const body: Record<TexKind, string> = {
      leather:
        `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="g"/>` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.018 0.045" numOctaves="3" seed="8" result="f"/>` +
        `<feComposite in="g" in2="f" operator="arithmetic" k2="0.15" k3="1" result="h"/>` +
        `<feDiffuseLighting in="h" surfaceScale="1.6" lighting-color="#fff" result="d"><feDistantLight azimuth="225" elevation="48"/></feDiffuseLighting>` +
        `<feSpecularLighting in="h" surfaceScale="1.6" specularConstant="0.9" specularExponent="18" lighting-color="#fff" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>` +
        `<feComposite in="s" in2="d" operator="arithmetic" k2="0.7" k3="1"/>${gray}`,
      metal:
        `<feTurbulence type="fractalNoise" baseFrequency="0.004 0.9" numOctaves="2" seed="5"/>${gray}` +
        `<feComponentTransfer><feFuncR type="linear" slope="1.8" intercept="-0.4"/><feFuncG type="linear" slope="1.8" intercept="-0.4"/><feFuncB type="linear" slope="1.8" intercept="-0.4"/></feComponentTransfer>`,
      fabric:
        `<feTurbulence type="fractalNoise" baseFrequency="1.1 0.12" numOctaves="1" seed="2" result="a"/><feTurbulence type="fractalNoise" baseFrequency="0.12 1.1" numOctaves="1" seed="4" result="b"/>` +
        `<feComposite in="a" in2="b" operator="arithmetic" k2="0.5" k3="0.5" result="w"/><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="9" result="c"/>` +
        `<feComposite in="w" in2="c" operator="arithmetic" k2="0.6" k3="0.5" result="h"/><feDiffuseLighting in="h" surfaceScale="1.2" lighting-color="#fff"><feDistantLight azimuth="225" elevation="55"/></feDiffuseLighting>${gray}`,
      skin:
        `<feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="11" result="p"/><feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="12" result="m"/>` +
        `<feComposite in="p" in2="m" operator="arithmetic" k2="0.45" k3="0.7"/>${gray}`,
      fur:
        `<feTurbulence type="fractalNoise" baseFrequency="0.25 1.6" numOctaves="3" seed="6" result="h"/><feDiffuseLighting in="h" surfaceScale="3" lighting-color="#fff"><feDistantLight azimuth="235" elevation="50"/></feDiffuseLighting>${gray}`,
      stubble:
        `<feTurbulence type="fractalNoise" baseFrequency="2.1" numOctaves="1" seed="21"/>` +
        `<feColorMatrix type="matrix" values="0 0 0 0 0.14 0 0 0 0 0.09 0 0 0 0 0.06 -8 0 0 0 3.25"/>`,
      stone:
        `<feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="4" seed="14" result="h"/><feDiffuseLighting in="h" surfaceScale="5" lighting-color="#fff"><feDistantLight azimuth="225" elevation="40"/></feDiffuseLighting>${gray}`,
    };
    // recentra o relevo em cinza médio (0,5): overlay neutro, sem clarear o material
    const center: Partial<Record<TexKind, [number, number]>> = { leather: [1.2, -0.52], fabric: [1.3, -0.56], skin: [1.4, -0.2], fur: [1.3, -0.41], stone: [1.2, -0.22] };
    const c = center[kind];
    const ct = c ? `<feComponentTransfer>${['R', 'G', 'B'].map((ch) => `<feFunc${ch} type="linear" slope="${c[0]}" intercept="${c[1]}"/>`).join('')}</feComponentTransfer>` : '';
    // luz e sombra do relevo viram camadas branca/preta com alfa (independe do tom do material)
    const split = kind === 'stubble' ? '' : '<feComponentTransfer result="tx"/><feColorMatrix in="tx" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -3 0 0 0 1.5" result="dk"/><feColorMatrix in="tx" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 3 0 0 0 -1.5" result="lt"/><feMerge><feMergeNode in="dk"/><feMergeNode in="lt"/></feMerge>';
    this.defs.push(`<filter id="${k}" ${U}>${body[kind]}${ct}${split}</filter>`);
    this.texs.set(kind, k);
    return k;
  }
  /** Aplica a textura `kind` dentro do contorno `d` (mistura overlay/soft-light). */
  texture(d: string, kind: TexKind, opacity = 0.45, blend = 'normal'): void {
    const c = this.clip(`<path d="${d}"/>`);
    this.out.push(`<g clip-path="${c}"><rect width="200" height="200" filter="url(#${this.tex(kind)})" opacity="${opacity}" style="mix-blend-mode:${blend}"/></g>`);
  }
}
type TexKind = 'leather' | 'metal' | 'fabric' | 'skin' | 'fur' | 'stone' | 'stubble';

/** Contorno de tinta: escuro, fino e translúcido — pintura, não ícone. */
const ink = (w = 2) => `stroke="${INK}" stroke-opacity="0.32" stroke-width="${w * 0.45}" stroke-linejoin="round" stroke-linecap="round"`;

/**
 * Modelagem de rosto pintado: órbitas e sombra sob a sobrancelha, lateral do nariz, sob o lábio e o
 * queixo (oclusão), maçãs e testa iluminadas, ponte do nariz com brilho e calor subcutâneo.
 * Chamar dentro do clip do rosto. `cool` troca a sombra quente por fria (peles azuis/verdes).
 */
function sculpt(P: Pic, skin: string, o: { eyeY?: number; dx?: number; noseY?: number; mouthY?: number; warm?: string; cool?: boolean; chin?: number; shadow?: string } = {}): void {
  const ey = o.eyeY ?? 92;
  const dx = o.dx ?? 16;
  const ny = o.noseY ?? 112;
  const my = o.mouthY ?? 126;
  const dk = o.shadow ?? (o.cool ? shade(skin, 0.42) : shade(skin, 0.5));
  const warm = o.warm ?? (o.cool ? '#6a8aff' : '#e0503a');
  const b3 = P.blur(3.2);
  const b2 = P.blur(1.8);
  P.add(`<g ${b3}>`);
  // órbitas e sombra sob a arcada
  P.add(`<ellipse cx="${100 - dx}" cy="${ey - 1}" rx="14" ry="8.5" fill="${dk}" opacity="0.5"/><ellipse cx="${100 + dx}" cy="${ey - 1}" rx="14" ry="8.5" fill="${dk}" opacity="0.62"/>`);
  P.add(`<ellipse cx="100" cy="${ey - 6}" rx="8" ry="5" fill="${dk}" opacity="0.25"/>`);
  // lado direito do nariz, sulco sob o nariz, sob o lábio inferior e sob o queixo
  P.add(`<ellipse cx="${106}" cy="${ny - 8}" rx="4.5" ry="12" fill="${dk}" opacity="0.45"/><ellipse cx="100" cy="${ny + 3}" rx="9" ry="3" fill="${dk}" opacity="0.4"/>`);
  P.add(`<ellipse cx="100" cy="${my + 7}" rx="10" ry="3.2" fill="${dk}" opacity="0.4"/><ellipse cx="100" cy="${(o.chin ?? my + 18) + 2}" rx="26" ry="6" fill="${dk}" opacity="0.4"/>`);
  // calor subcutâneo (bochechas, ponta do nariz)
  P.add(`<ellipse cx="${100 - dx - 4}" cy="${ey + 17}" rx="11" ry="7" fill="${warm}" opacity="0.22"/><ellipse cx="${100 + dx + 4}" cy="${ey + 17}" rx="11" ry="7" fill="${warm}" opacity="0.16"/><ellipse cx="100" cy="${ny - 1}" rx="5" ry="3.5" fill="${warm}" opacity="0.2"/>`);
  // luzes: testa, maçã esquerda, queixo
  P.add(`<ellipse cx="90" cy="${ey - 26}" rx="15" ry="8" fill="#fff" opacity="0.32"/><ellipse cx="${100 - dx - 6}" cy="${ey + 11}" rx="9" ry="4.5" fill="#fff" opacity="0.28"/><ellipse cx="97" cy="${my + 12}" rx="6" ry="3" fill="#fff" opacity="0.2"/>`);
  P.add('</g>');
  P.add(`<g ${b2}><ellipse cx="98" cy="${ny - 9}" rx="2.2" ry="9" fill="#fff" opacity="0.4"/><ellipse cx="98.5" cy="${ny - 2}" rx="2.6" ry="1.8" fill="#fff" opacity="0.55"/></g>`);
  // planos: têmpora e lateral do nariz em meia-luz, faixa do malar
  P.add(`<g ${P.blur(2.6)}><path d="M${100 - dx - 14} ${ey + 8} C${100 - dx - 6} ${ey + 14} ${100 - dx + 6} ${ey + 13} ${100 - dx + 10} ${ey + 8}" fill="none" stroke="#fff" stroke-width="3" opacity="0.2"/>` +
    `<path d="M${100 + dx + 14} ${ey + 8} C${100 + dx + 6} ${ey + 16} ${100 + dx - 4} ${ey + 16} ${100 + dx - 8} ${ey + 11}" fill="none" stroke="${dk}" stroke-width="4" opacity="0.3"/></g>`);
  // brilhos especulares pontuais (pele oleosa sob luz forte)
  P.add(`<g ${P.blur(0.7)} fill="#fff"><ellipse cx="97.5" cy="${ny - 2.5}" rx="1.6" ry="1.1" opacity="0.85"/><ellipse cx="92" cy="${ey - 22}" rx="4" ry="1.6" opacity="0.4" transform="rotate(-12 92 ${ey - 22})"/>` +
    `<ellipse cx="${100 - dx - 7}" cy="${ey + 10}" rx="2.6" ry="1.2" opacity="0.45" transform="rotate(-25 ${100 - dx - 7} ${ey + 10})"/><ellipse cx="97" cy="${ny - 12}" rx="0.9" ry="3" opacity="0.5"/></g>`);
}

/** Mechas: muitos fios afilados em dois tons ao longo de curvas geradas por `f` (dentro de um clip). */
function strands(P: Pic, n: number, seed: number, f: (r: () => number, i: number) => Pt[], light: string, dark: string, w = 1.6): void {
  const r = rng(seed);
  let dk = '';
  let lt = '';
  let hl = '';
  for (let i = 0; i < n; i++) {
    const d = taper(f(r, i), w * (0.6 + r() * 0.8), 0.2, 12);
    const k = r();
    if (k < 0.45) dk += d;
    else if (k < 0.85) lt += d;
    else hl += d;
  }
  P.add(path(dk, dark, 'opacity="0.55"'), path(lt, light, 'opacity="0.45"'), path(hl, '#ffffff', 'opacity="0.35"'));
}
type Curve = (t: number) => Pt;
/** Curva cúbica com ondulação perpendicular (mecha ondulada coerente). */
function waveCurve(p: Pt[], amp: number, freq: number, ph: number): Curve {
  return (t) => {
    const b = bez(p, t);
    const len = Math.hypot(b.dx, b.dy) || 1;
    const a = amp * Math.sin(t * freq * Math.PI * 2 + ph) * Math.min(1, t * 3);
    return [b.x + (-b.dy / len) * a, b.y + (b.dx / len) * a];
  };
}
/** Fita afilada ao longo de uma curva paramétrica; `shift` desloca a linha central (fração da largura). */
function ribbon(c: Curve, w0: number, w1: number, steps = 22, shift = 0, sw = w0): string {
  const L: string[] = [];
  const R: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x1, y1] = c(Math.max(0, t - 0.01));
    const [x2, y2] = c(Math.min(1, t + 0.01));
    const [x, y] = c(t);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const w = (w0 + (w1 - w0) * t) / 2;
    const s = shift * (sw + (w1 - sw) * t) * 0.5;
    L.push(`${(x + nx * (s + w)).toFixed(1)} ${(y + ny * (s + w)).toFixed(1)}`);
    R.push(`${(x + nx * (s - w)).toFixed(1)} ${(y + ny * (s - w)).toFixed(1)}`);
  }
  return `M${L.join(' L')} L${R.reverse().join(' L')}Z`;
}
/**
 * Cabelo em mechas: cada mecha é uma fita ondulada com lado de sombra, corpo e dezenas de fios finos
 * claros/escuros seguindo a mesma onda — lê como cabelo pintado, não como traços retos.
 */
function hairLocks(
  P: Pic,
  n: number,
  seed: number,
  gen: (r: () => number, i: number) => { p: Pt[]; w: number },
  col: { dark: string; mid: string; light: string },
  amp = 3,
  freq = 1.5,
): void {
  const r = rng(seed);
  let dk = '';
  let md = '';
  let sh = '';
  let lt = '';
  let hl = '';
  for (let i = 0; i < n; i++) {
    const { p, w } = gen(r, i);
    const c = waveCurve(p, amp * (0.6 + r() * 0.8), freq * (0.8 + r() * 0.4), r() * 6.28);
    md += ribbon(c, w, w * 0.2);
    sh += ribbon(c, w * 0.45, w * 0.1, 22, 0.55, w);
    for (let k = 0; k < 7; k++) {
      const s = (r() - 0.5) * 1.6;
      const fine = ribbon(c, 0.5 + r() * 0.5, 0.12, 18, s, w);
      const q = r();
      if (q < 0.35) dk += fine;
      else if (q < 0.8) lt += fine;
      else hl += fine;
    }
  }
  P.add(path(md, col.mid, 'opacity="0.92"'), path(sh, col.dark, `opacity="0.55" ${P.blur(0.8)}`), path(dk, col.dark, 'opacity="0.6"'), path(lt, col.light, 'opacity="0.55"'), path(hl, '#ffffff', 'opacity="0.25"'));
}
const path = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d: string, color: string, w: number, op = 1) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${op < 1 ? ` opacity="${op}"` : ''}/>`;

/** Espelha um path (só comandos absolutos com pares x y) no eixo vertical central. */
function mx(d: string): string {
  return d.replace(/(-?\d*\.?\d+)[ ,]+(-?\d*\.?\d+)/g, (_m, x: string, y: string) => `${+(200 - +x).toFixed(2)} ${y}`);
}
/** O path e o seu espelho. */
const sym = (d: string, fill: string, extra = '') => path(d, fill, extra) + path(mx(d), fill, extra);
const symLine = (d: string, color: string, w: number, op = 1) => line(d, color, w, op) + line(mx(d), color, w, op);

function bez(p: Pt[], t: number): { x: number; y: number; dx: number; dy: number } {
  const u = 1 - t;
  const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
  const y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
  const dx = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]);
  const dy = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]);
  return { x, y, dx, dy };
}

/** Forma afilada ao longo de uma curva cúbica (mechas, tentáculos, chifres, listras). */
function taper(p: Pt[], w0: number, w1: number, steps = 16): string {
  const L: string[] = [];
  const R: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const b = bez(p, t);
    const len = Math.hypot(b.dx, b.dy) || 1;
    const w = (w0 + (w1 - w0) * t) / 2;
    const nx = (-b.dy / len) * w;
    const ny = (b.dx / len) * w;
    L.push(`${(b.x + nx).toFixed(1)} ${(b.y + ny).toFixed(1)}`);
    R.push(`${(b.x - nx).toFixed(1)} ${(b.y - ny).toFixed(1)}`);
  }
  return `M${L.join(' L')} L${R.reverse().join(' L')}Z`;
}
const mirPts = (p: Pt[]): Pt[] => p.map(([x, y]) => [200 - x, y]);

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------- peças de rosto

/** Contorno de rosto humano centrado em x=100. */
function facePath(T = 42, W = 35, J = 24, C = 140): string {
  return `M100 ${T} C${100 + W * 0.7} ${T} ${100 + W} ${T + 16} ${100 + W} ${T + 42} C${100 + W} ${T + 58} ${100 + W - 3} ${T + 70} ${100 + J} ${C - 16} C${100 + J - 8} ${C - 5} 107 ${C} 100 ${C} C93 ${C} ${100 - J + 8} ${C - 5} ${100 - J} ${C - 16} C${100 - W + 3} ${T + 70} ${100 - W} ${T + 58} ${100 - W} ${T + 42} C${100 - W} ${T + 16} ${100 - W * 0.7} ${T} 100 ${T}Z`;
}

/** Preenche um contorno com pele sombreada (luz de cima-esquerda, sombra à direita e embaixo). Devolve o clip. */
function skinFill(P: Pic, d: string, skin: string, o: { stroke?: number; light?: string; rim?: string; rim2?: string; shadow?: string; sss?: string; tex?: TexKind } = {}): string {
  const c = P.clip(`<path d="${d}"/>`);
  const sh = o.shadow ?? '#2a0c04';
  P.add(path(d, P.rad([[0, o.light ?? shade(skin, 1.35)], [0.55, skin], [1, o.shadow ? shade(skin, 0.8) : shade(skin, 0.64)]], 0.4, 0.3, 0.85)));
  P.add(`<g clip-path="${c}">`);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, sh, 0], [0.45, sh, 0], [1, sh, 0.38]], 96, 0, 140, 20, true)}"/>`);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, sh, 0], [0.75, sh, 0], [1, sh, 0.32]], 0, 40, 0, 145, true)}"/>`);
  P.add(`<ellipse cx="84" cy="70" rx="22" ry="16" fill="${P.rad([[0, '#fff', 0.22], [1, '#fff', 0]])}"/><ellipse cx="80" cy="104" rx="12" ry="9" fill="${P.rad([[0, '#fff', 0.16], [1, '#fff', 0]])}"/>`);
  // plano de sombra (lado direito) com a borda da sombra quente (subsuperfície) e luz refletida na orla
  const tone = o.shadow ? shade(skin, 0.55) : shade(skin, 0.5);
  const sss = o.sss ?? (o.shadow ? '#6a5aff' : '#d8402a');
  P.add(`<path d="M126 20 C120 50 124 80 118 104 C114 124 104 140 96 160 L200 160 L200 20Z" fill="${tone}" opacity="0.6" ${P.blur(7)}/>`);
  P.add(`<path d="M124 30 C118 56 122 82 116 104 C112 122 104 136 96 150" fill="none" stroke="${sss}" stroke-width="7" opacity="0.26" ${P.blur(4)}/>`);
  P.add(`<path d="M140 60 C142 90 138 116 124 136" fill="none" stroke="${o.rim2 ?? shade(skin, 1.3)}" stroke-width="3" opacity="0.35" ${P.blur(2)}/>`);
  // oclusão: faixa na linha do cabelo e sob a mandíbula
  P.add(`<ellipse cx="100" cy="40" rx="46" ry="10" fill="${shade(skin, 0.4)}" opacity="0.35" ${P.blur(5)}/>`);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#000', 0], [0.82, '#000', 0], [1, sh, 0.35]], 0, 20, 0, 150, true)}"/>`);
  P.texture(d, o.tex ?? 'skin', o.tex === 'metal' ? 0.45 : o.tex ? 0.22 : 0.16);
  if (o.rim) P.add(`<path d="${d}" fill="none" stroke="${o.rim}" stroke-width="6" opacity="0.4" ${P.blur(1.5)} clip-path="${P.clip('<rect width="88" height="200"/>')}"/>`);
  if (o.rim2) P.add(`<path d="${d}" fill="none" stroke="${o.rim2}" stroke-width="6" opacity="0.4" ${P.blur(1.5)} clip-path="${P.clip('<rect x="112" y="0" width="88" height="200"/>')}"/>`);
  P.add('</g>');
  P.add(path(d, 'none', ink(o.stroke ?? 2.2)));
  return c;
}

/** Olho em amêndoa com íris em gradiente, pupila e brilho. `tilt` positivo levanta o canto externo. */
function eye(
  P: Pic,
  cx: number,
  cy: number,
  w: number,
  h: number,
  iris: string,
  o: { tilt?: number; right?: boolean; slit?: boolean; irisR?: number; pupil?: string; lid?: number; sclera?: string; look?: number } = {},
): string {
  const tilt = (o.tilt ?? 0) * (o.right ? -1 : 1);
  const d = `M${-w} 0 C${-w * 0.5} ${-h * 1.3} ${w * 0.5} ${-h * 1.3} ${w} 0 C${w * 0.5} ${h * 1.05} ${-w * 0.5} ${h * 1.05} ${-w} 0Z`;
  const c = P.clip(`<path d="${d}"/>`);
  const r = o.irisR ?? h * 0.95;
  const ix = (o.look ?? 0) * w * 0.25;
  const ig = P.rad([[0, shade(iris, 1.55)], [0.55, iris], [1, shade(iris, 0.35)]], 0.5, 0.62, 0.6);
  const pupil = o.slit
    ? `<ellipse cx="${ix}" cy="0" rx="${r * 0.22}" ry="${r * 0.95}" fill="${o.pupil ?? '#060404'}"/>`
    : `<circle cx="${ix}" cy="${h * 0.08}" r="${r * 0.45}" fill="${o.pupil ?? '#060404'}"/>`;
  return `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><g clip-path="${c}">
    <rect x="${-w}" y="${-h * 1.5}" width="${w * 2}" height="${h * 3}" fill="${o.sclera ?? P.lin([[0, '#9a8a84'], [0.55, '#e4dcd4'], [1, '#c8bcb4']])}"/>
    <circle cx="${ix}" cy="${h * 0.08}" r="${r}" fill="${ig}"/>${pupil}
    <path d="M${-w} ${-h * 1.4} L${w} ${-h * 1.4} L${w} ${-h * (o.lid ?? 0.35)} C${w * 0.3} ${-h * 0.9} ${-w * 0.3} ${-h * 0.9} ${-w} ${-h * (o.lid ?? 0.35)}Z" fill="#000" opacity="0.28"/>
    <circle cx="${ix}" cy="${h * 0.08}" r="${r * 0.72}" fill="none" stroke="${shade(iris, 1.8)}" stroke-width="${r * 0.18}" stroke-dasharray="${(r * 0.12).toFixed(2)} ${(r * 0.2).toFixed(2)}" opacity="0.5"/>
    <circle cx="${ix}" cy="${h * 0.08}" r="${r}" fill="none" stroke="#000" stroke-width="${r * 0.14}" opacity="0.55"/>
    <path d="M${-w} ${-h * 1.4} L${w} ${-h * 1.4} L${w} ${-h * 0.2} C${w * 0.3} ${-h * 0.5} ${-w * 0.3} ${-h * 0.5} ${-w} ${-h * 0.2}Z" fill="#000" opacity="0.18"/>
    <circle cx="${ix - r * 0.38}" cy="${-r * 0.3}" r="${Math.max(0.9, r * 0.3)}" fill="#fff"/>
    <circle cx="${ix + r * 0.42}" cy="${r * 0.38}" r="${Math.max(0.5, r * 0.13)}" fill="#fff" opacity="0.8"/>
    <path d="M${-w * 0.6} ${h * 0.75} C${-w * 0.2} ${h * 0.95} ${w * 0.3} ${h * 0.95} ${w * 0.65} ${h * 0.7}" fill="none" stroke="#fff" stroke-width="0.7" opacity="0.5"/>
    <ellipse cx="${-w * 0.86}" cy="${h * 0.1}" rx="${w * 0.14}" ry="${h * 0.3}" fill="#d87a78" opacity="0.6"/>
  </g><path d="${d}" fill="none" stroke="${INK}" stroke-opacity="0.25" stroke-width="0.5"/>
  <path d="M${-w - 1} ${0.5} C${-w * 0.5} ${-h * 1.35} ${w * 0.5} ${-h * 1.35} ${w + 0.8} ${-0.3}" fill="none" stroke="#1a0c08" stroke-width="${Math.max(1, h * 0.36)}" stroke-linecap="round" opacity="0.85"/>
  <path d="M${-w * 0.9} ${-h * 1.3} C${-w * 0.4} ${-h * 2.1} ${w * 0.5} ${-h * 2.1} ${w * 1.05} ${-h * 1.0}" fill="none" stroke="#2a0c04" stroke-width="${Math.max(0.6, h * 0.22)}" opacity="0.32" stroke-linecap="round"/>
  <path d="M${-w * 0.7} ${h * 0.85} C${-w * 0.2} ${h * 1.25} ${w * 0.4} ${h * 1.2} ${w * 0.85} ${h * 0.55}" fill="none" stroke="#2a0c04" stroke-width="${Math.max(0.5, h * 0.16)}" opacity="0.28" stroke-linecap="round"/>
  <path d="M${-w * 0.6} ${h * 1.05} C${-w * 0.1} ${h * 1.35} ${w * 0.4} ${h * 1.3} ${w * 0.8} ${h * 0.8}" fill="none" stroke="#fff" stroke-width="${Math.max(0.4, h * 0.12)}" opacity="0.3" stroke-linecap="round"/></g>`;
}

/** Par de olhos simétricos. */
function eyes(P: Pic, y: number, dx: number, w: number, h: number, iris: string, o: Parameters<typeof eye>[6] = {}): string {
  return eye(P, 100 - dx, y, w, h, iris, o) + eye(P, 100 + dx, y, w, h, iris, { ...o, right: true, look: o.look });
}

/** Olho brilhante (robôs, demônios). */
function glowEye(P: Pic, cx: number, cy: number, r: number, color: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r * 3}" fill="${P.rad([[0, color, 0.75], [0.35, color, 0.3], [1, color, 0]])}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.rad([[0, '#ffffff'], [0.35, shade(color, 1.4)], [0.8, color], [1, shade(color, 0.4)]])}"/>`;
}

/** Nariz modelado por luz e sombra (sem traço): ponte iluminada, lateral em sombra, asas, narinas e oclusão. */
function realNose(P: Pic, top: number, tip: number, w: number, skin: string, o: { dark?: string } = {}): void {
  const dk = o.dark ?? shade(skin, 0.45);
  const L = (tip - top) * 0.5;
  P.add(`<path d="M103.5 ${top} C105 ${top + L} ${104 + w * 0.3} ${tip - 6} ${100 + w * 1.05} ${tip - 1} L${100 + w * 0.2} ${tip - 2} C101 ${tip - 8} 101.5 ${top + L} 101 ${top}Z" fill="${dk}" opacity="0.45" ${P.blur(1.6)}/>`);
  P.add(`<path d="M98.6 ${top + 2} C98 ${top + L} 97.8 ${tip - 8} 98.4 ${tip - 4}" fill="none" stroke="#fff" stroke-width="2.4" opacity="0.32" stroke-linecap="round" ${P.blur(1)}/>`);
  P.add(`<ellipse cx="100" cy="${tip - 1.5}" rx="${w * 0.6}" ry="3.8" fill="${P.rad([[0, shade(skin, 1.25)], [0.7, skin], [1, shade(skin, 0.8)]], 0.4, 0.3, 0.7)}" ${P.blur(0.7)}/>`);
  P.add(`<g ${P.blur(0.9)}><ellipse cx="${100 - w * 0.82}" cy="${tip}" rx="2.6" ry="2.9" fill="${shade(skin, 0.85)}"/><ellipse cx="${100 + w * 0.82}" cy="${tip}" rx="2.6" ry="2.9" fill="${shade(skin, 0.65)}"/></g>`);
  P.add(`<g ${P.blur(0.45)} fill="none" stroke="${dk}" stroke-linecap="round"><path d="M${100 - w * 0.5} ${tip - 3.5} C${100 - w * 1.2} ${tip - 3} ${100 - w * 1.25} ${tip + 1.8} ${100 - w * 0.6} ${tip + 2.3}" stroke-width="1" opacity="0.6"/><path d="M${100 + w * 0.5} ${tip - 3.5} C${100 + w * 1.2} ${tip - 3} ${100 + w * 1.25} ${tip + 1.8} ${100 + w * 0.6} ${tip + 2.3}" stroke-width="1.1" opacity="0.75"/></g>`);
  P.add(`<g ${P.blur(0.4)} fill="#2a0c06"><ellipse cx="${100 - w * 0.42}" cy="${tip + 1.9}" rx="1.9" ry="0.95" opacity="0.8" transform="rotate(12 ${100 - w * 0.42} ${tip + 1.9})"/><ellipse cx="${100 + w * 0.42}" cy="${tip + 1.9}" rx="1.9" ry="0.95" opacity="0.85" transform="rotate(-12 ${100 + w * 0.42} ${tip + 1.9})"/></g>`);
  P.add(`<ellipse cx="101" cy="${tip + 4.2}" rx="${w * 0.95}" ry="1.8" fill="${dk}" opacity="0.35" ${P.blur(1.4)}/>`);
  P.add(`<g ${P.blur(0.5)} fill="#fff"><ellipse cx="98.6" cy="${tip - 2.6}" rx="1.5" ry="1" opacity="0.8"/><ellipse cx="98.4" cy="${top + L}" rx="0.7" ry="2.4" opacity="0.4"/></g>`);
}

/** Boca modelada: linha de fenda macia, lábio superior em sombra, inferior iluminado com brilho, oclusão embaixo. */
function realMouth(P: Pic, y: number, w: number, lip: string, o: { smirk?: number; philtrum?: number; dark?: string } = {}): void {
  const s = o.smirk ?? 0;
  const dk = o.dark ?? '#3a1208';
  const cut = `M${100 - w} ${y} C${100 - w * 0.5} ${y - 1.2} 98 ${y - 0.3} 100 ${y + 0.3} C102 ${y - 0.3} ${100 + w * 0.5} ${y - 1.2 - s * 0.5} ${100 + w} ${y - s}`;
  if (o.philtrum) P.add(`<g ${P.blur(0.8)} fill="none" stroke="${shade(lip, 0.6)}" stroke-width="1" opacity="0.35"><path d="M98 ${y - o.philtrum} L97.4 ${y - 4.5}"/><path d="M102 ${y - o.philtrum} L102.6 ${y - 4.5}"/></g>`);
  P.add(`<path d="M${100 - w} ${y} C${100 - w * 0.6} ${y - 3} ${100 - 5} ${y - 5} 100 ${y - 3.6} C${100 + 5} ${y - 5} ${100 + w * 0.6} ${y - 3 - s * 0.7} ${100 + w} ${y - s}" fill="${shade(lip, 0.72)}" opacity="0.85" ${P.blur(0.5)}/>`);
  P.add(`<path d="M${100 - w * 0.92} ${y + 0.3} C${100 - w * 0.5} ${y + 5.6} ${100 + w * 0.5} ${y + 5.6 - s * 0.3} ${100 + w * 0.92} ${y - s + 0.3}Z" fill="${P.rad([[0, shade(lip, 1.25)], [0.6, lip], [1, shade(lip, 0.75)]], 0.45, 0.35, 0.7)}" opacity="0.9" ${P.blur(0.55)}/>`);
  P.add(`<path d="${cut}" fill="none" stroke="${dk}" stroke-width="1.5" stroke-linecap="round" ${P.blur(0.35)}/>`);
  P.add(`<g ${P.blur(0.6)}><circle cx="${100 - w}" cy="${y}" r="1.3" fill="${dk}" opacity="0.6"/><circle cx="${100 + w}" cy="${y - s}" r="1.4" fill="${dk}" opacity="0.6"/></g>`);
  P.add(`<ellipse cx="97" cy="${y + 2.8}" rx="3.4" ry="0.95" fill="#fff" opacity="0.45" ${P.blur(0.5)}/>`);
  P.add(`<ellipse cx="100" cy="${y + 8}" rx="${w * 0.55}" ry="2.2" fill="${shade(lip, 0.45)}" opacity="0.35" ${P.blur(1.5)}/>`);
}

/** Sobrancelha feita de dezenas de pelos curtos sobre uma mancha macia. */
function browHairs(P: Pic, pts: Pt[], color: string, width: number, seed: number, n = 34): void {
  const r = rng(seed);
  P.add(path(taper(pts, width, width * 0.4), color, `opacity="0.55" ${P.blur(0.9)}`));
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = r();
    const b = bez(pts, t);
    const len = Math.hypot(b.dx, b.dy) || 1;
    const ux = b.dx / len;
    const uy = b.dy / len;
    const off = (r() - 0.5) * width * (1 - t * 0.5);
    const x = b.x - uy * off;
    const y = b.y + ux * off;
    const l = 2.4 + r() * 2.2;
    const lift = (1 - t) * 1.6;
    d += taper([[x, y], [x + ux * l * 0.3, y + uy * l * 0.3 - lift * 0.3], [x + ux * l * 0.7, y + uy * l * 0.7 - lift * 0.7], [x + ux * l, y + uy * l - lift]], 0.7, 0.1, 4);
  }
  P.add(path(d, shade(color, 0.7), 'opacity="0.8"'), path(d, shade(color, 1.4), 'opacity="0.25" transform="translate(-0.3 -0.3)"'));
}

/** Fundo com gradiente cheio. */
const bgRect = (fill: string) => `<rect width="200" height="200" fill="${fill}"/>`;

/** Luz neon: halo largo + núcleo + filete branco. */
function neon(d: string, c: string, w = 2.2): string {
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w * 4}" opacity="0.18" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w * 2}" opacity="0.35" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="${w * 0.35}" opacity="0.8" stroke-linecap="round"/>`;
}

/** Jaqueta de couro (Snake, Jake, rivais): grão e dobras por textura, brilhos macios. */
function leatherJacket(P: Pic, base: string, shirt: string, o: { collar?: boolean; rimL?: string; rimR?: string } = {}): void {
  const tee = 'M68 146 L132 146 L140 200 L60 200Z';
  P.add(path(tee, P.lin([[0, shade(shirt, 1.2)], [1, shade(shirt, 0.6)]])));
  P.texture(tee, 'fabric', 0.4);
  const leather = P.lin([[0, shade(base, 1.3)], [0.22, shade(base, 1.12)], [0.6, base], [1, shade(base, 0.35)]], 0.2, 0, 0.5, 1);
  const panel = 'M8 200 C10 174 30 158 62 150 L82 146 C84 164 88 182 94 200Z';
  P.add(sym(panel, leather, ink(1.4)));
  P.texture(panel, 'leather', 0.6);
  P.texture(mx(panel), 'leather', 0.6);
  // dobras do couro (sombra + aresta de luz) e brilhos especulares macios
  P.add(`<g ${P.blur(1.4)} fill="none" stroke-linecap="round">` +
    symLine('M30 196 C34 184 44 176 58 170', '#000', 3, 0.45) + symLine('M29 194 C33 182 43 174 57 168', '#fff', 1.2, 0.22) +
    symLine('M66 158 C70 172 72 186 76 198', '#000', 2.6, 0.4) + '</g>');
  P.add(`<g ${P.blur(2.2)}>` + symLine('M20 186 C26 170 40 160 60 155', '#fff', 3.2, 0.3) + '</g>');
  P.add(`<g ${P.blur(0.8)}>` + symLine('M24 178 C30 168 38 162 48 159', '#fff', 1.2, 0.55) + '</g>');
  if (o.collar !== false) {
    const col = 'M82 144 L62 154 L72 178 L88 162Z';
    P.add(sym(col, P.lin([[0, shade(base, 1.3)], [1, shade(base, 0.6)]]), ink(1.2)));
    P.texture(col, 'leather', 0.5);
    P.texture(mx(col), 'leather', 0.5);
  }
  if (o.rimL) P.add(`<g ${P.blur(1.2)}>${line('M10 196 C12 174 32 158 62 150', o.rimL, 2.5, 0.75)}</g>`);
  if (o.rimR) P.add(`<g ${P.blur(1.2)}>${line(mx('M10 196 C12 174 32 158 62 150'), o.rimR, 2.5, 0.75)}</g>`);
}

// ---------------------------------------------------------------- pilotos jogáveis

function snake(P: Pic): void {
  // noite neon na cidade vista da cabine: céu, prédios em dois planos, feixes neon e letreiro
  P.add(bgRect(P.lin([[0, '#14062e'], [0.55, '#46125e'], [1, '#0a0616']])));
  P.add(`<ellipse cx="100" cy="132" rx="120" ry="44" fill="${P.rad([[0, '#ff4fc0', 0.6], [1, '#ff4fc0', 0]])}"/>`);
  const r = rng(11);
  for (const [base, col, wc, op] of [[150, '#3a1a5e', '#ff9ad8', 0.5], [162, '#1a0b33', '#ffd48a', 0.75]] as [number, string, string, number][]) {
    let city = '';
    let win = '';
    for (let x = -4; x < 204; ) {
      const w = 8 + r() * 13;
      const h = (base === 150 ? 30 : 18) + r() * 46;
      city += `M${x.toFixed(1)} ${base} L${x.toFixed(1)} ${(base - h).toFixed(1)} L${(x + w).toFixed(1)} ${(base - h).toFixed(1)} L${(x + w).toFixed(1)} ${base}Z`;
      for (let wy = base - h + 4; wy < base - 4; wy += 5) for (let wx = x + 2; wx < x + w - 2; wx += 4) if (r() < 0.35) win += `M${wx.toFixed(1)} ${wy.toFixed(1)} h1.8 v2.2 h-1.8Z`;
      x += w + 1.5;
    }
    P.add(path(city, col), path(win, wc, `opacity="${op}"`));
  }
  P.add(`<rect y="120" width="200" height="50" fill="${P.lin([[0, '#ff4fc0', 0], [0.5, '#ff4fc0', 0.25], [1, '#1a0b33', 0]])}"/>`);
  P.add(neon('M-6 10 L70 76', '#ff3ad0'), neon('M16 -6 L82 64', '#3ae8ff', 1.6), neon('M206 10 L130 76', '#3ae8ff'), neon('M184 -6 L118 64', '#ff3ad0', 1.6));
  P.add(neon('M147 52 C147 40 173 40 173 52 C173 64 147 64 147 52Z', '#ff4fd8', 2), neon('M153 55 C154 47 158 47 158 52 C158 57 162 57 163 49 C164 45 167 47 167 53', '#7af4ff', 1.3));

  P.figure('#ff4fd0', '#4ae8ff', '#7a2a9a');
  const skin = '#d89a72';
  // volume de cabelo atrás da cabeça e dos ombros: base escura macia + centenas de fios ondulados
  const back = 'M100 30 C62 30 44 58 43 92 C42 126 32 160 16 200 L184 200 C168 160 158 126 157 92 C156 58 138 30 100 30Z';
  P.add(path(back, P.lin([[0, '#c89a48'], [0.45, '#7a5418'], [1, '#2a1804']]), P.blur(1.4)));
  P.add(`<g clip-path="${P.clip(`<path d="${back}"/>`)}">`);
  const wavy = (r: () => number, i: number): Pt[] => {
    const sg = i % 2 ? 1 : -1;
    const x0 = 100 + sg * (30 + r() * 24);
    const x1 = 100 + sg * (36 + r() * 66);
    const wv = (r() - 0.5) * 44;
    return [[x0, 44 + r() * 30], [x0 + sg * 6 + wv, 102], [x1 - wv, 152], [x1, 204]];
  };
  hairLocks(P, 30, 31, (r, i) => {
    const sg = i % 2 ? 1 : -1;
    const x0 = 100 + sg * (26 + r() * 26);
    const x1 = 100 + sg * (34 + r() * 66);
    return { p: [[x0, 40 + r() * 30], [x0 + sg * 8, 100], [x1 - sg * 6, 150], [x1, 206]], w: 9 + r() * 6 };
  }, { dark: '#3a2406', mid: '#a87a2c', light: '#f4d488' }, 5, 1.6);
  strands(P, 60, 32, wavy, '#fff0b8', '#6a4812', 0.6);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#000', 0], [0.55, '#000', 0.1], [1, '#1a0626', 0.6]])}"/></g>`);
  // pescoço com sombra do queixo e pomo de adão
  P.add(path('M81 120 L79 164 Q100 174 121 164 L119 120Z', P.lin([[0, '#a8643e'], [0.45, '#d08e66'], [1, '#7a3e24']], 0, 0, 1, 0)));
  P.add(`<path d="M80 122 C88 148 112 148 120 122 L120 152 C110 160 90 160 80 152Z" fill="#3a1406" opacity="0.55" ${P.blur(2.5)}/>`);
  P.add(`<ellipse cx="100" cy="156" rx="3.5" ry="5" fill="#f0b890" opacity="0.45" ${P.blur(1.2)}/>`);
  P.add(`<g ${P.blur(1)}>${symLine('M87 142 C90 152 94 160 97 168', '#6a2a14', 1.6, 0.35)}</g>`);
  // jaqueta de couro sobre camiseta cinza, gola larga, pespontos, zíper e tachas
  leatherJacket(P, '#1c1a20', '#9a9aa2', { collar: false, rimL: '#ff4fd0', rimR: '#4ae8ff' });
  const lap = 'M80 144 L58 148 L46 176 L60 192 L86 160Z';
  P.add(sym(lap, P.lin([[0, '#64606e'], [0.3, '#2a2830'], [1, '#060608']], 0, 0, 1, 1), ink(1)));
  P.texture(lap, 'leather', 0.55);
  P.texture(mx(lap), 'leather', 0.55);
  P.add(`<g ${P.blur(1)}>${symLine('M76 150 L60 153 L52 175', '#fff', 1.6, 0.35)}</g>`);
  const stitch = 'M79 148 L62 151 L54 174 L64 184';
  P.add(`<path d="${stitch}" fill="none" stroke="#8a8694" stroke-width="0.6" stroke-dasharray="1.6 1.6" opacity="0.7"/><path d="${mx(stitch)}" fill="none" stroke="#8a8694" stroke-width="0.6" stroke-dasharray="1.6 1.6" opacity="0.7"/>`);
  P.add(`<path d="M84 162 C86 176 89 188 92 200" fill="none" stroke="#c8ccd4" stroke-width="1.8" stroke-dasharray="1 1.2" opacity="0.8"/>`);
  P.add(`<g fill="${P.rad([[0, '#ffffff'], [0.5, '#9aa0ae'], [1, '#3a3e48']], 0.35, 0.3, 0.7)}"><circle cx="34" cy="186" r="2"/><circle cx="166" cy="186" r="2"/><circle cx="42" cy="180" r="1.6"/><circle cx="158" cy="180" r="1.6"/></g>`);
  // corrente e pingente
  let chain = '';
  for (let t = 0; t <= 1.001; t += 0.06) {
    const b = bez([[86, 150], [88, 168], [112, 168], [114, 150]], t);
    chain += `<ellipse cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" rx="1.3" ry="0.9" fill="none" stroke="#dfe3ea" stroke-width="0.7"/>`;
  }
  P.add(`<g opacity="0.95">${chain}</g>`, path('M96.5 165 L103.5 165 L100 176Z', P.lin([[0, '#ffffff'], [0.5, '#a8aebb'], [1, '#4a505e']], 0, 0, 1, 1)));
  // sombra do cabelo sobre as laterais do rosto (desenhada antes do rosto por dentro do clip)
  const face = 'M100 44 C121 44 134 56 135 78 C136 92 135 104 132 114 C129 126 124 134 117 140 C111 145 106 147 100 147 C94 147 89 145 83 140 C76 134 71 126 68 114 C65 104 64 92 65 78 C66 56 79 44 100 44Z';
  const sc = skinFill(P, face, skin, { rim: '#ff7ae0', rim2: '#6af0ff' });
  P.add(`<g clip-path="${sc}">`);
  sculpt(P, skin, { eyeY: 94, dx: 16, noseY: 116, mouthY: 129, chin: 143 });
  const beard = 'M66 110 C70 132 86 148 100 148 C114 148 130 132 134 110 C126 122 118 124 113 121 C108 118 92 118 87 121 C82 124 74 122 66 110Z M86 125 C91 119 109 119 114 124 C108 121 92 121 86 125Z';
  P.add(path(beard, '#4a3020', `opacity="0.3" ${P.blur(2.2)}`));
  P.texture(beard, 'stubble', 0.85, 'normal');
  P.add(`<g ${P.blur(3)}><path d="M64 60 C72 80 72 110 80 140" fill="none" stroke="#2a1006" stroke-width="10" opacity="0.45"/><path d="M136 60 C128 80 128 110 120 140" fill="none" stroke="#2a1006" stroke-width="10" opacity="0.5"/></g>`);
  P.add('</g>');
  // sobrancelhas de pelos, olhos semicerrados, nariz e boca modelados
  const brow: Pt[] = [[97, 85.5], [89, 82.5], [78, 81.8], [67, 84.8]];
  browHairs(P, brow, '#a8782e', 4.2, 51);
  browHairs(P, mirPts(brow), '#a8782e', 4.2, 52);
  P.add(eyes(P, 94, 16, 8.2, 3.3, '#4a8ad0', { tilt: -2, lid: 0.5 }));
  realNose(P, 90, 116, 6.8, skin);
  realMouth(P, 130, 13, '#b8705a', { smirk: 2.2, philtrum: 11 });
  P.add(`<g ${P.blur(1.1)} fill="none" stroke="#6a3420" stroke-width="1.6" opacity="0.4"><path d="M88 117 C84.5 122 84 127 86 132"/><path d="M112 117 C116.5 121 118 125 117 130"/></g>`);
  P.add(`<path d="M99 141 C100 143 101 143 101.5 141" fill="none" stroke="#6a3420" stroke-width="1" opacity="0.35" ${P.blur(0.6)}/>`);
  // mechas da frente emoldurando o rosto e cobrindo as orelhas
  const lockL = 'M72 50 C60 62 58 84 61 108 C63 132 56 162 40 200 L86 200 C80 172 75 150 73 128 C71 104 71 80 80 58Z';
  const lockR = 'M128 50 C140 62 142 86 140 110 C138 136 145 166 160 200 L114 200 C120 172 125 150 127 128 C129 104 129 80 120 58Z';
  for (const [k, lk] of [lockL, lockR].entries()) {
    P.add(path(lk, P.lin([[0, '#f0cc70'], [0.5, '#b8862a'], [1, '#4a300a']], k ? 1 : 0, 0, k ? 0 : 1, 0.4), P.blur(0.8)));
    P.add(`<g clip-path="${P.clip(`<path d="${lk}"/>`)}">`);
    const sg = k ? 1 : -1;
    const lockF = (r: () => number): Pt[] => {
      const x0 = 100 + sg * (22 + r() * 10);
      const x1 = 100 + sg * (26 + r() * 50);
      const wv = (r() - 0.5) * 30;
      return [[x0, 50 + r() * 8], [x0 + sg * 12 + wv, 96], [x1 - wv * 0.6 - sg * 8, 150], [x1, 202]];
    };
    hairLocks(P, 11, 60 + k, (r) => ({ p: lockF(r), w: 7 + r() * 5 }), { dark: '#5a3a0c', mid: '#d0a044', light: '#fff0b0' }, 4, 1.4);
    P.add(`<ellipse cx="${100 + sg * 36}" cy="100" rx="8" ry="26" fill="#fff4c8" opacity="0.28" ${P.blur(3)}/></g>`);
  }
  // topo com risca ao meio, sob a bandana
  const crown = 'M60 74 C55 44 76 24 100 24 C124 24 145 44 140 74 C132 60 118 52 100 52 C82 52 68 60 60 74Z';
  P.add(path(crown, P.lin([[0, '#fff0b0'], [0.4, '#d8a848'], [1, '#6a4410']]), P.blur(0.6)));
  P.add(`<g clip-path="${P.clip(`<path d="${crown}"/>`)}">`);
  strands(P, 70, 37, (r, i) => {
    const sg = i % 2 ? 1 : -1;
    const x = 100 + sg * (4 + r() * 42);
    return [[100 + sg * 1.5, 24], [100 + sg * 10, 28 + r() * 4], [x - sg * 6, 44], [x + sg * 8, 76]];
  }, '#fff8d0', '#7a5214', 1.2);
  P.add('</g>');
  // bandana preta estampada, com dobra e nó do lado direito
  const band = 'M58 64 C70 46 130 46 142 64 L142 76 C130 60 70 60 58 76Z';
  P.add(path(band, P.lin([[0, '#4a4a56'], [0.45, '#1a1a22'], [1, '#050508']]), ink(1)));
  P.texture(band, 'fabric', 0.6);
  let dots = '';
  for (let i = 0; i < 9; i++) {
    const x = 68 + i * 8;
    const y = 60.5 - Math.sin((i / 8) * Math.PI) * 6;
    dots += i % 2 ? `M${x} ${y - 2.6} L${x + 1.8} ${y} L${x} ${y + 2.6} L${x - 1.8} ${y}Z` : `M${x - 1.8} ${y} C${x - 1.8} ${y - 2.4} ${x + 1.8} ${y - 2.4} ${x + 1.8} ${y} C${x + 1} ${y + 1} ${x} ${y + 2} ${x - 1.8} ${y}Z`;
    dots += `M${x + 4} ${y + 4.2} h1 v1 h-1Z M${x + 4} ${y - 4.6} h1 v1 h-1Z`;
  }
  P.add(path(dots, '#e8e4dc', `opacity="0.75" ${P.blur(0.25)}`));
  P.add(`<g ${P.blur(0.8)}>${line('M64 62 C76 52 124 52 136 62', '#fff', 1.4, 0.3)}${line('M70 71 C84 63 116 63 130 71', '#000', 2, 0.5)}</g>`);
  P.add(`<path d="M60 74 C72 66 128 66 140 74" fill="none" stroke="#2a1006" stroke-width="4" opacity="0.4" ${P.blur(2)}/>`);
  const tail1 = 'M140 66 C154 72 158 88 152 106 L145 102 C149 88 146 78 138 74Z';
  const tail2 = 'M140 68 C156 64 166 76 168 92 L161 92 C158 80 150 74 140 76Z';
  P.add(path(tail1, P.lin([[0, '#2a2a34'], [1, '#08080c']]), ink(1)), path(tail2, P.lin([[0, '#3a3a46'], [1, '#101016']]), ink(1)));
  P.texture(tail1, 'fabric', 0.5);
  P.texture(tail2, 'fabric', 0.5);
  P.add(`<circle cx="142" cy="70" r="5" fill="${P.rad([[0, '#3a3a44'], [1, '#0a0a0e']], 0.4, 0.35, 0.7)}"/>`);
}

function cyberhawk(P: Pic): void {
  // código verde caindo, monitores e pista neon
  P.add(bgRect(P.lin([[0, '#021a0c'], [0.6, '#06331a'], [1, '#010a05']])));
  const r = rng(5);
  const lv = ['', '', ''];
  for (let x = 3; x < 200; x += 8) {
    const head = r() * 170;
    const len = 5 + Math.floor(r() * 9);
    for (let k = 0; k < len; k++) {
      const y = head - k * 5;
      if (y < -4 || r() < 0.2) continue;
      lv[k < 2 ? 0 : k < 5 ? 1 : 2] += `M${x} ${y.toFixed(1)} h${(1.6 + r() * 1.4).toFixed(1)} v3.2 h-${(1.6).toFixed(1)}Z`;
    }
  }
  P.add(path(lv[2], '#1f9a4a', 'opacity="0.45"'), path(lv[1], '#3aff7a', 'opacity="0.6"'), path(lv[0], '#c8ffd8'));
  P.add(neon('M206 30 C176 40 188 62 158 70 C136 76 150 94 124 98', '#ff3ad0', 1.6), neon('M206 42 C182 50 194 70 166 78 C146 84 158 100 134 104', '#3ae8ff', 1.2));
  // consoles
  P.add(sym('M0 128 L44 122 L50 160 L0 168Z', '#0a1a12', ink(1.5)), sym('M6 132 L40 127 L44 154 L8 160Z', P.lin([[0, '#1a8a4a'], [1, '#063a1a']]), 'opacity="0.9"'));
  P.add(symLine('M10 138 L36 134 M10 144 L30 141 M10 150 L38 146', '#8affb0', 1, 0.8));

  P.figure('#3aff7a', '#ff3ad0', '#0a4a22');
  const chrome = P.lin([[0, '#ffffff'], [0.18, '#c9d0da'], [0.42, '#6f7888'], [0.5, '#eef2f6'], [0.64, '#8a93a3'], [1, '#2a303c']]);
  const chromeDk = P.lin([[0, '#d8dee6'], [0.4, '#6a7282'], [0.55, '#b8c0cc'], [1, '#1e232c']]);
  // armadura
  P.add(path('M70 146 L130 146 L126 168 L74 168Z', '#20242c', ink(1.5)));
  P.add(path('M74 164 L126 164 L134 200 L66 200Z', chromeDk, ink(2)));
  P.add(line('M88 180 L112 180', '#ff2a1a', 2.4), line('M88 180 L112 180', '#ff2a1a', 7, 0.25), line('M100 168 L100 200', '#1a1e26', 1.5));
  const shoulder = 'M4 200 C4 170 24 150 58 148 C72 148 82 156 82 170 L82 200Z';
  P.add(sym(shoulder, chrome, ink(1.4)));
  P.texture(shoulder, 'metal', 0.45);
  P.texture(mx(shoulder), 'metal', 0.45);
  P.add(symLine('M12 184 C20 168 38 160 66 160', '#2a303c', 1.6), symLine('M8 196 C14 182 30 174 56 172', '#2a303c', 1.4));
  P.add(symLine('M18 170 C28 158 44 154 60 153', '#fff', 2, 0.6));
  P.add(`<g fill="#e8ecf2" ${ink(0.8)}><circle cx="22" cy="176" r="2"/><circle cx="178" cy="176" r="2"/><circle cx="70" cy="178" r="2"/><circle cx="130" cy="178" r="2"/></g>`);
  // cabos do pescoço
  P.add(line('M84 136 C82 150 80 160 76 170', '#1a0a0a', 5), line('M84 136 C82 150 80 160 76 170', '#c0201a', 3));
  P.add(line('M116 136 C118 150 120 160 124 170', '#1a0a0a', 5), line('M116 136 C118 150 120 160 124 170', '#c0201a', 3));
  P.add(line('M92 138 C92 150 90 158 88 166', '#0a0a0a', 4), line('M108 138 C108 150 110 158 112 166', '#0a0a0a', 4));
  P.add(path('M95 136 L105 136 L104 164 L96 164Z', chromeDk, ink(1.2)), line('M95 144 L105 144 M95 152 L105 152 M96 160 L104 160', INK, 1));
  // orelhas-disco e pistões
  P.add(sym('M42 72 C42 68 46 66 50 66 L56 66 L58 106 L50 106 C46 106 42 104 42 100Z', chromeDk, ink(1.8)));
  P.add(glowEye(P, 50, 86, 2.4, '#ff2a1a'), glowEye(P, 150, 86, 2.4, '#ff2a1a'));
  P.add(symLine('M52 104 L76 134', '#262b35', 6), symLine('M52 104 L76 134', '#b8c0cc', 2.2));
  // crânio cromado
  const cran = 'M100 28 C131 28 148 50 148 80 C148 96 142 104 139 114 L61 114 C58 104 52 96 52 80 C52 50 69 28 100 28Z';
  P.add(path(cran, chrome, ink(1.4)));
  P.texture(cran, 'metal', 0.4);
  const cc = P.clip(`<path d="${cran}"/>`);
  P.add(`<g clip-path="${cc}"><rect width="200" height="200" fill="${P.lin([[0, '#000', 0.5], [0.25, '#000', 0], [0.7, '#000', 0], [1, '#000', 0.55]], 52, 0, 148, 0, true)}"/></g>`);
  P.add(line('M100 29 L100 58', '#3a4250', 1.5), symLine('M64 48 C74 58 84 62 94 62', '#3a4250', 1.3), symLine('M56 72 C62 70 66 72 70 76', '#3a4250', 1.2));
  P.add(`<ellipse cx="82" cy="42" rx="14" ry="6" fill="#fff" opacity="0.55" transform="rotate(-18 82 42)"/>`);
  P.add(path('M91 56 L109 56 L100 70Z', P.lin([[0, '#ff6a4a'], [1, '#a00a00']]), ink(1.2)), path('M91 56 L109 56 L100 70Z', 'none', 'stroke="#ff3a1a" stroke-width="5" opacity="0.25"'));
  // arcadas e órbitas
  P.add(path('M62 80 C72 70 90 70 98 80 L102 80 C110 70 128 70 138 80 L136 86 C126 80 112 82 104 90 L96 90 C88 82 74 80 64 86Z', chromeDk, ink(1.6)));
  P.add(sym('M66 88 C70 80 90 82 96 90 C96 100 86 106 76 104 C68 102 64 96 66 88Z', '#0a0406', ink(1.6)));
  P.add(glowEye(P, 81, 93, 5, '#ff2a1a'), glowEye(P, 119, 93, 5, '#ff2a1a'));
  // maçãs e nariz
  P.add(sym('M58 98 C60 112 66 120 78 124 L84 112 C76 110 70 104 66 96Z', chrome, ink(1.6)));
  P.add(path('M100 100 L93 114 C96 116 98 114 100 112 C102 114 104 116 107 114Z', '#0a0406', ink(1.2)));
  // mandíbula e dentes
  P.add(path('M76 116 L124 116 L126 138 L74 138Z', '#0a0406'));
  P.add(path('M70 124 C74 140 86 148 100 148 C114 148 126 140 130 124 L120 132 L80 132Z', chromeDk, ink(2)));
  const teeth = P.lin([[0, '#fbf8ee'], [1, '#aaa290']]);
  let t1 = '';
  let t2 = '';
  for (let i = 0; i < 8; i++) {
    const x = 80 + i * 5;
    t1 += `M${x + 0.5} 117 L${x + 4.5} 117 L${x + 4.5} 126 C${x + 3.5} 128 ${x + 1.5} 128 ${x + 0.5} 126Z`;
    t2 += `M${x + 0.8} 138 L${x + 4.2} 138 L${x + 4.2} 131 C${x + 3.4} 129.5 ${x + 1.6} 129.5 ${x + 0.8} 131Z`;
  }
  P.add(path(t1, teeth, ink(0.9)), path(t2, teeth, ink(0.9)));
  P.add(line('M84 142 C92 146 108 146 116 142', '#fff', 1.2, 0.5));
}

function ivanzypher(P: Pic): void {
  // pântano verde luminoso com tentáculos ao fundo
  P.add(bgRect(P.lin([[0, '#6aa83a'], [0.45, '#2e6a1c'], [1, '#0a1e06']])));
  P.add(`<ellipse cx="100" cy="40" rx="120" ry="70" fill="${P.rad([[0, '#d8ff7a', 0.6], [1, '#d8ff7a', 0]])}"/>`);
  P.add(path('M0 0 L200 0 L200 10 C196 22 192 22 190 12 C186 30 180 30 178 10 C170 16 166 18 164 8 L40 8 C36 26 30 28 28 10 C22 18 16 16 14 8 C10 30 4 30 2 12Z', '#9ae04a', 'opacity="0.55"'));
  const bgT = '#1a4a12';
  P.add(path(taper([[4, 206], [-6, 140], [44, 110], [20, 56]], 24, 5), bgT, 'opacity="0.85"'), path(taper(mirPts([[4, 206], [-6, 140], [44, 110], [20, 56]]), 24, 5), bgT, 'opacity="0.85"'));
  P.add(path(taper([[20, 56], [10, 36], [34, 30], [36, 44]], 5, 2), bgT, 'opacity="0.85"'), path(taper(mirPts([[20, 56], [10, 36], [34, 30], [36, 44]]), 5, 2), bgT, 'opacity="0.85"'));
  P.add(path(taper([[30, 206], [40, 170], [8, 150], [14, 120]], 14, 3), '#24561a', 'opacity="0.9"'), path(taper(mirPts([[30, 206], [40, 170], [8, 150], [14, 120]]), 14, 3), '#24561a', 'opacity="0.9"'));
  P.figure('#e8ff8a', '#8aff4a', '#3a7a1a');
  // corpo
  P.add(path('M10 200 C14 170 40 152 76 146 L124 146 C160 152 186 170 190 200Z', P.lin([[0, '#4a5a2a'], [1, '#141a08']]), ink(2)));
  // cabeça bulbosa
  const skin = '#62a236';
  const dome = 'M100 16 C142 16 160 46 158 76 C156 96 146 108 136 118 L64 118 C54 108 44 96 42 76 C40 46 58 16 100 16Z';
  const dc = skinFill(P, dome, skin, { light: '#c4ec7a', stroke: 2.4 });
  P.add(`<g clip-path="${dc}">`);
  P.add(line('M70 30 C76 44 72 56 80 66 M84 22 C88 34 86 44 92 52 M130 28 C124 42 130 54 122 64 M146 50 C140 58 142 68 136 74 M56 54 C62 62 60 72 66 78', '#2e6a1a', 1.6, 0.6));
  P.add(`<ellipse cx="100" cy="112" rx="50" ry="14" fill="#0e2a06" opacity="0.55" ${P.blur(5)}/><ellipse cx="146" cy="70" rx="10" ry="30" fill="#e8ff8a" opacity="0.3" ${P.blur(3)}/>`);
  P.add(`<g fill="#fff" ${P.blur(0.6)}><ellipse cx="74" cy="34" rx="7" ry="3" opacity="0.8" transform="rotate(-25 74 34)"/><circle cx="90" cy="27" r="1.6" opacity="0.8"/><circle cx="64" cy="48" r="1.2" opacity="0.7"/><circle cx="120" cy="30" r="1.1" opacity="0.6"/></g>`);
  P.add(`<ellipse cx="78" cy="38" rx="20" ry="9" fill="#fff" opacity="0.25" transform="rotate(-22 78 38)"/><circle cx="118" cy="40" r="4" fill="#2e5a18" opacity="0.35"/><circle cx="132" cy="56" r="3" fill="#2e5a18" opacity="0.35"/><circle cx="66" cy="60" r="3.5" fill="#2e5a18" opacity="0.3"/>`);
  P.add('</g>');
  // arcada furiosa + olhos amarelos
  P.add(sym('M54 80 C68 74 88 80 98 94 C88 88 72 84 56 90Z', '#2a5a16', ink(1.4)));
  P.add(sym('M62 86 C74 88 86 92 95 98 C88 108 70 108 62 86Z', P.rad([[0, '#fffac0'], [0.45, '#ffc81a'], [1, '#c05a00']], 0.55, 0.6, 0.6), ink(2)));
  P.add(`<ellipse cx="81" cy="98" rx="2.4" ry="4.4" fill="#0a0404"/><ellipse cx="119" cy="98" rx="2.4" ry="4.4" fill="#0a0404"/><circle cx="78" cy="94.5" r="1.4" fill="#fff"/><circle cx="116" cy="94.5" r="1.4" fill="#fff"/>`);
  P.add(line('M96 82 L100 92 L104 82', INK, 1.4, 0.8), symLine('M58 100 C64 108 72 112 80 112', '#1e4a10', 1.4, 0.7));
  P.add(symLine('M93 106 C94 103 96 103 97 106', INK, 1.6));
  // boca rosnando
  const mouth = 'M66 114 C80 104 120 104 134 114 C128 134 72 134 66 114Z';
  P.add(path(mouth, P.rad([[0, '#8a1414'], [1, '#240404']], 0.5, 0.4, 0.6), ink(2)));
  const yTop = (x: number) => 114 - 7.5 * Math.sin((Math.PI * (x - 66)) / 68);
  const yBot = (x: number) => 114 + 13.5 * Math.sin((Math.PI * (x - 66)) / 68);
  let up = '';
  let dn = '';
  for (let x = 70; x < 131; x += 6) {
    const L = x - 2.6;
    const R = x + 2.6;
    const tip = x === 76 || x === 124 ? 11 : 7;
    up += `M${L} ${yTop(L) - 1} L${R} ${yTop(R) - 1} L${x} ${yTop(x) + tip}Z`;
    if (x > 72 && x < 128) dn += `M${L + 1} ${yBot(L) + 1} L${R + 1} ${yBot(R) + 1} L${x + 1} ${yBot(x) - (x === 82 || x === 118 ? 9 : 6)}Z`;
  }
  P.add(path(up, P.lin([[0, '#fffcee'], [1, '#d8cca8']]), ink(0.8)), path(dn, P.lin([[0, '#d8cca8'], [1, '#fffcee']]), ink(0.8)));
  // tentáculos no queixo
  const tg = P.lin([[0, '#a8dc6a'], [0.45, '#5c9c34'], [1, '#1e4a12']], 0, 0, 1, 0);
  const tent: [Pt[], number][] = [
    [[[70, 118], [48, 130], [26, 122], [22, 146]], 13],
    [[[130, 118], [152, 130], [174, 122], [178, 146]], 13],
    [[[78, 124], [62, 150], [36, 152], [38, 186]], 15],
    [[[122, 124], [138, 150], [164, 152], [162, 186]], 15],
    [[[88, 128], [84, 160], [62, 172], [72, 202]], 15],
    [[[112, 128], [116, 160], [138, 172], [128, 202]], 15],
    [[[100, 130], [104, 160], [90, 178], [100, 204]], 16],
  ];
  for (const [pts, w] of tent) {
    P.add(path(taper(pts, w, 3.5, 20), tg, ink(1.6)));
    P.add(path(taper(pts, w * 0.35, 1, 20), '#c8f08a', 'opacity="0.35"'));
    let s = '';
    for (const t of [0.3, 0.45, 0.6, 0.74, 0.86]) {
      const b = bez(pts, t);
      const len = Math.hypot(b.dx, b.dy) || 1;
      const ww = (w + (3.5 - w) * t) * 0.28;
      s += `<circle cx="${(b.x + (b.dy / len) * ww).toFixed(1)}" cy="${(b.y - (b.dx / len) * ww).toFixed(1)}" r="${(1 + (1 - t) * 1.6).toFixed(1)}" fill="#e8a8a0" stroke="#6a2a2a" stroke-width="0.6"/>`;
    }
    P.add(s);
  }
  // pontas enroladas
  P.add(path(taper([[22, 146], [18, 158], [30, 160], [28, 152]], 3.5, 1.5), tg, ink(1)), path(taper([[178, 146], [182, 158], [170, 160], [172, 152]], 3.5, 1.5), tg, ink(1)));
}

function katarina(P: Pic): void {
  // cabine de nave: para-brisa com deserto e cidade no horizonte
  P.add(bgRect(P.lin([[0, '#4a9ee0'], [0.45, '#b8def2'], [0.62, '#f4dcb0'], [1, '#f4dcb0']])));
  P.add(path('M122 118 L124 90 L127 90 L129 118Z M132 118 L134 76 L138 72 L141 76 L142 118Z M146 118 L148 96 L152 96 L153 118Z M160 118 L161 84 L165 84 L166 118Z M170 118 L172 100 L176 100 L176 118Z M28 118 L30 98 L34 98 L35 118Z', '#7a8aa8', 'opacity="0.75"'));
  P.add(path('M0 120 C50 112 140 116 200 110 L200 200 L0 200Z', P.lin([[0, '#eab872'], [0.5, '#c88a48'], [1, '#7a4a20']])));
  P.add(line('M0 134 C40 128 80 132 120 126 M60 146 C100 140 150 144 200 136', '#fff0c8', 1.4, 0.5));
  P.add(path('M92 120 L108 120 L150 200 L50 200Z', '#8a6a4a', 'opacity="0.35"'));
  // moldura da cabine
  const frame = P.lin([[0, '#3a3e48'], [1, '#101216']], 0, 0, 1, 0);
  P.add(path('M0 0 L34 0 L10 128 L0 140Z', frame, ink(1.5)), path(mx('M0 0 L34 0 L10 128 L0 140Z'), frame, ink(1.5)), path('M0 0 L200 0 L200 12 L0 12Z', '#16181e'));
  P.add(symLine('M30 4 L8 122', '#8a96aa', 1.2, 0.6));
  P.add(path('M0 150 C40 134 160 134 200 150 L200 200 L0 200Z', P.lin([[0, '#3a322c'], [1, '#141010']]), ink(1.5)));
  P.add(glowEye(P, 22, 162, 3, '#40c8ff'), glowEye(P, 178, 162, 3, '#ffb020'), glowEye(P, 36, 172, 2, '#60ff80'));
  P.figure('#ffe0a0', '#8ad0ff', '#e8c890');
  // traje espacial branco
  const suit = P.lin([[0, '#ffffff'], [0.45, '#dfe3ea'], [1, '#8a909e']], 0.2, 0, 0.6, 1);
  P.add(path('M12 200 C14 172 38 156 70 150 L130 150 C162 156 186 172 188 200Z', suit, ink(1.2)));
  P.texture('M12 200 C14 172 38 156 70 150 L130 150 C162 156 186 172 188 200Z', 'fabric', 0.55);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#000', 0], [0.6, '#000', 0], [1, '#000', 0.25]], 100, 0, 190, 0, true)}" clip-path="${P.clip('<path d="M12 200 C14 172 38 156 70 150 L130 150 C162 156 186 172 188 200Z"/>')}"/>`);
  P.add(symLine('M40 168 C44 180 46 190 46 200', '#9aa0ae', 1.4), symLine('M26 180 C34 176 44 174 52 174', '#9aa0ae', 1.2));
  P.add(`<rect x="32" y="176" width="15" height="10" rx="1" fill="#fff" ${ink(0.8)}/><path d="M32 178 h15 M32 181 h15 M32 184 h15" stroke="#d0202a" stroke-width="1.2"/><rect x="32" y="176" width="7" height="5" fill="#1a3a8a"/>`);
  P.add(`<circle cx="152" cy="180" r="9" fill="${P.rad([[0, '#4a8aff'], [1, '#0a2a7a']])}" ${ink(1)}/><circle cx="152" cy="180" r="6" fill="none" stroke="#fff" stroke-width="0.8"/><path d="M147 182 L152 175 L157 182" fill="none" stroke="#ffd84a" stroke-width="1.2"/>`);
  P.add(`<rect x="88" y="176" width="24" height="16" rx="3" fill="#b8bec8" ${ink(1)}/><circle cx="95" cy="184" r="2" fill="#ff4a2a"/><circle cx="102" cy="184" r="2" fill="#4aff6a"/><rect x="106" y="181" width="3" height="6" fill="#3a4050"/>`);
  // pescoço peludo e anel do capacete
  P.add(path('M76 124 L76 152 L124 152 L124 124Z', P.lin([[0, '#b8601e'], [1, '#e8a060']])));
  const ringO = 'M56 150 C56 138 144 138 144 150 C144 162 56 162 56 150Z';
  const ringI = 'M66 148 C66 140 134 140 134 148 C134 154 66 154 66 148Z';
  P.add(path(`${ringO} ${ringI}`, P.lin([[0, '#d8dee8'], [0.35, '#5a6a8a'], [0.6, '#1a2238'], [1, '#6a7a98']]), `fill-rule="evenodd" ${ink(1.8)}`));
  P.add(line('M62 146 C80 140 120 140 138 146', '#fff', 1.2, 0.6));
  // orelhas
  const skin = '#e08a34';
  P.add(sym('M60 80 C54 58 54 36 58 16 C72 26 88 40 96 52Z', P.lin([[0, '#6a2a08'], [0.3, '#c8641c'], [1, skin]]), ink(2)));
  P.add(sym('M64 72 C60 56 60 42 62 28 C72 36 80 44 88 54Z', P.lin([[0, '#b85a6a'], [1, '#f4b0b4']])));
  P.add(symLine('M64 60 C66 52 70 46 74 42 M66 66 C70 58 74 54 80 50', '#fff4e8', 1, 0.8));
  // cabeça com tufos nas bochechas
  const head = 'M100 44 C124 44 140 58 144 80 C150 88 154 96 150 102 L157 108 L147 112 L151 120 L138 122 C128 134 114 141 100 141 C86 141 72 134 62 122 L49 120 L53 112 L43 108 L50 102 C46 96 50 88 56 80 C60 58 76 44 100 44Z';
  const hc = skinFill(P, head, skin, { light: '#ffcf8a', tex: 'fur' });
  P.add(`<g clip-path="${hc}">`);
  const st = '#7a3208';
  P.add(path(taper([[100, 46], [99, 56], [101, 62], [100, 72]], 5, 1), st));
  for (const pts of [
    [[90, 47], [87, 56], [91, 62], [93, 70]],
    [[80, 52], [80, 60], [85, 64], [88, 70]],
    [[64, 64], [72, 66], [78, 70], [84, 76]],
    [[46, 96], [56, 96], [62, 98], [70, 102]],
    [[48, 108], [56, 108], [62, 110], [70, 112]],
    [[56, 118], [62, 118], [66, 120], [72, 122]],
  ] as Pt[][]) {
    P.add(path(taper(pts, 4.2, 0.8), st), path(taper(mirPts(pts), 4.2, 0.8), st));
  }
  P.add(`<ellipse cx="82" cy="80" rx="10" ry="4" fill="#fff4e0" opacity="0.4"/><ellipse cx="118" cy="80" rx="10" ry="4" fill="#fff4e0" opacity="0.35"/>`);
  P.add('</g>');
  // olhos verdes de gata
  P.add(eyes(P, 90, 18, 12, 7, '#8ad83a', { tilt: 10, slit: true, irisR: 7.6, lid: 0.55 }));
  P.add(symLine('M68 94 C72 100 78 102 84 102', '#fff4e0', 1.2, 0.6));
  // focinho branco, nariz rosa, boca e bigodes
  P.add(path('M100 104 C86 99 74 107 76 118 C78 128 92 131 100 124 C108 131 122 128 124 118 C126 107 114 99 100 104Z', P.rad([[0, '#ffffff'], [0.7, '#f4ece0'], [1, '#d8c4a8']], 0.5, 0.4, 0.6)));
  P.add(path('M88 131 C92 140 108 140 112 131 C108 135 92 135 88 131Z', '#f4ece0'));
  P.add(path('M93 101 L107 101 C107 106 103 110 100 110 C97 110 93 106 93 101Z', P.lin([[0, '#f8b0b4'], [1, '#b0505e']]), ink(1.2)), `<ellipse cx="98" cy="103" rx="2.5" ry="1.2" fill="#fff" opacity="0.6"/>`);
  P.add(line('M100 110 L100 116 C97 121 91 121 88 117 M100 116 C103 121 109 121 112 117', INK, 1.4));
  P.add(`<g fill="#6a4a3a" opacity="0.7"><circle cx="86" cy="112" r="0.9"/><circle cx="90" cy="115" r="0.9"/><circle cx="84" cy="117" r="0.9"/><circle cx="114" cy="112" r="0.9"/><circle cx="110" cy="115" r="0.9"/><circle cx="116" cy="117" r="0.9"/></g>`);
  P.add(symLine('M80 114 C62 108 50 108 36 110 M80 118 C62 118 50 120 34 124 M82 122 C66 126 54 132 42 138', '#ffffff', 0.9, 0.9));
}

function jake(P: Pic): void {
  // cânion roxo/laranja ao pôr do sol, visto pela janela da nave
  P.add(bgRect(P.lin([[0, '#2a0f4a'], [0.4, '#8a2a78'], [0.7, '#ff7a4a'], [1, '#ffc070']])));
  P.add(`<circle cx="42" cy="38" r="13" fill="${P.lin([[0, '#f0d8ff'], [1, '#8a5aa8']])}"/><circle cx="46" cy="35" r="11" fill="#2a0f4a" opacity="0.35"/>`);
  P.add(path('M0 140 L0 104 L12 100 L18 86 L38 86 L44 102 L60 104 L66 92 L84 92 L88 108 L112 110 L118 96 L140 96 L144 88 L166 88 L170 104 L186 106 L192 94 L200 94 L200 140Z', '#8a3a5e', 'opacity="0.85"'));
  P.add(path('M0 200 L0 122 L20 118 L26 106 L48 106 L54 124 L150 126 L156 108 L180 108 L186 120 L200 120 L200 200Z', P.lin([[0, '#5a1a44'], [1, '#1a0418']])));
  P.add(line('M26 108 L48 108 M156 110 L180 110', '#ffb070', 1.4, 0.8));
  // moldura da janela
  const winO = 'M0 0 L200 0 L200 200 L0 200Z';
  const winI = 'M36 18 L164 18 C178 18 188 28 188 44 L188 200 L12 200 L12 44 C12 28 22 18 36 18Z';
  P.add(path(`${winO} ${winI}`, P.lin([[0, '#5a5a6a'], [0.5, '#2a2a34'], [1, '#14141a']], 0, 0, 1, 1), `fill-rule="evenodd"`));
  P.add(path(winI, 'none', ink(2)), line('M36 20 L164 20', '#aab0c0', 1, 0.5));
  P.add(`<g fill="#9aa0b0" ${ink(0.6)}><circle cx="6" cy="60" r="1.8"/><circle cx="6" cy="110" r="1.8"/><circle cx="194" cy="60" r="1.8"/><circle cx="194" cy="110" r="1.8"/><circle cx="60" cy="9" r="1.8"/><circle cx="140" cy="9" r="1.8"/></g>`);
  P.add(neon('M148 34 L178 32 L179 50 L149 52Z', '#6aff6a', 1.1), neon('M153 40 C155 37 157 43 159 40 C161 37 163 43 165 40 M156 46 L172 45', '#9affc0', 0.8));
  P.figure('#ff8a4a', '#c04aff', '#8a3a6a');
  // jaqueta com espinhos
  P.add(path('M84 124 L84 156 Q100 166 116 156 L116 124Z', P.lin([[0, '#7a4a30'], [1, '#b87a58']])));
  P.add(path('M84 128 C90 142 110 142 116 128 L116 142 C110 150 90 150 84 142Z', '#000', 'opacity="0.3"'));
  leatherJacket(P, '#1e1c22', '#6a6a72', { rimL: '#ff8a4a', rimR: '#c04aff' });
  const spike = P.lin([[0, '#ffffff'], [0.5, '#9aa2b0'], [1, '#3a4050']], 0, 0, 1, 0);
  for (const [x, y, a] of [[18, 178, -60], [26, 166, -50], [38, 158, -38], [52, 153, -25], [66, 151, -12]] as [number, number, number][]) {
    const s = `<path d="M-4.5 0 L0 -13 L4.5 0Z" fill="${spike}" ${ink(1)}/>`;
    P.add(`<g transform="translate(${x} ${y}) rotate(${a})">${s}</g><g transform="translate(${200 - x} ${y}) rotate(${-a})">${s}</g>`);
  }
  // orelhas e brinco
  const skin = '#d49a72';
  P.add(sym('M65 84 C56 80 53 92 55 100 C57 108 61 110 66 106Z', P.lin([[0, '#a86a48'], [1, skin]]), ink(1.6)));
  P.add(`<circle cx="57" cy="110" r="4.2" fill="none" stroke="#e8ecf2" stroke-width="2"/><circle cx="57" cy="110" r="4.2" fill="none" ${ink(0.6)}/>`);
  // cabeça com laterais raspadas
  const hc = skinFill(P, facePath(40, 37, 27, 142), skin, { rim: '#ff9a5a', rim2: '#c46aff' });
  P.add(`<g clip-path="${hc}">`);
  sculpt(P, skin, { eyeY: 90, dx: 17, noseY: 112, mouthY: 125, chin: 140 });
  P.add(sym('M60 84 C58 58 68 44 86 38 L88 62 C78 64 70 72 66 86Z', '#2a3a6a', 'opacity="0.55"'));
  const r = rng(3);
  let stub = '';
  for (let i = 0; i < 110; i++) {
    const x = 72 + r() * 56;
    const y = 112 + r() * 30;
    stub += `M${x.toFixed(1)} ${y.toFixed(1)} h0.9 v0.9 h-0.9Z`;
  }
  void stub;
  P.texture('M66 110 C70 132 86 148 100 148 C114 148 130 132 134 110 C126 122 118 124 113 121 C108 118 92 118 87 121 C82 124 74 122 66 110Z', 'stubble', 0.75);
  P.add('</g>');
  // moicano azul espetado
  const mo = P.lin([[0, '#d8f6ff'], [0.35, '#3aa8ff'], [1, '#0a2a8a']], 0, 0, 0, 60, true);
  const spikes: [number, number, number][] = [[-9, -30, 34], [9, 30, 34], [-7, -22, 18], [7, 22, 18], [-4, -12, 6], [4, 12, 6], [0, 0, -2]];
  for (const [bx, tx, ty] of spikes) {
    const bxx = 100 + bx * 1.6;
    P.add(path(`M${bxx - 9} 56 C${bxx - 6} 42 ${100 + tx - 3} ${ty + 12} ${100 + tx} ${ty} C${100 + tx + 3} ${ty + 12} ${bxx + 6} 42 ${bxx + 9} 56Z`, mo, ink(1.6)));
  }
  P.add(path('M84 58 C86 46 94 42 100 42 C106 42 114 46 116 58Z', mo, ink(1.4)));
  P.add(line('M98 6 C98 20 99 34 100 48', '#fff', 1.2, 0.6));
  // sobrancelhas, óculos escuros com reflexo do pôr do sol
  browHairs(P, [[95, 80], [87, 76.5], [77, 76], [67, 79]], '#3a2418', 4.4, 81);
  browHairs(P, mirPts([[95, 80], [87, 76.5], [77, 76], [67, 79]]), '#3a2418', 4.4, 82);
  const glass = 'M60 82 L140 82 L138 91 C136 102 118 104 110 97 L104 91 L96 91 L90 97 C82 104 64 102 62 91Z';
  P.add(path(glass, P.lin([[0, '#2a2a3e'], [0.5, '#08080e'], [1, '#1a0a1a']]), ink(2)));
  P.add(`<g clip-path="${P.clip(`<path d="${glass}"/>`)}">${path('M60 96 L140 84 L140 89 L60 101Z', P.lin([[0, '#c04aff'], [0.5, '#ff5a8a'], [1, '#ffb050']], 0, 0, 1, 0), 'opacity="0.75"')}${line('M68 86 L80 85 M112 85 L124 84', '#fff', 1.4, 0.8)}</g>`);
  P.add(line('M60 83 L54 88 M140 83 L146 88', INK, 2.2));
  // nariz, sorriso de canto, queixo
  realNose(P, 92, 112, 6.8, skin);
  realMouth(P, 124, 13, '#a8604a', { smirk: 3.5, philtrum: 9 });
  P.add(`<g ${P.blur(1)} fill="none" stroke="#6a3420" stroke-width="1.5" opacity="0.4"><path d="M88 113 C84.5 118 84 123 86 127"/><path d="M112 113 C116.5 117 118 121 117 126"/></g>`);
}

function tarquinn(P: Pic): void {
  // noite polar: céu profundo, estrelas, cortinas de aurora, cordilheira de gelo em planos e lago congelado
  P.add(bgRect(P.lin([[0, '#030a22'], [0.35, '#0a2c5a'], [0.62, '#1a6a9a'], [1, '#bfe8fa']])));
  const r = rng(9);
  let stars = '';
  for (let i = 0; i < 60; i++) stars += `<circle cx="${(r() * 200).toFixed(1)}" cy="${(r() * 90).toFixed(1)}" r="${(0.3 + r() * 0.8).toFixed(1)}" fill="#fff" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
  P.add(stars);
  // aurora: faixas verticais que sobem de uma curva (cortina), desfocadas, em verde e violeta
  const aur = (y0: number, amp: number, ph: number, c1: string, c2: string, h: number, op: number) => {
    let d = '';
    for (let x = -10; x <= 210; x += 3) {
      const y = y0 + Math.sin(x * 0.03 + ph) * amp + Math.sin(x * 0.011 + ph * 2) * amp * 0.6;
      d += `M${x} ${y.toFixed(1)} L${x} ${(y - h * (0.6 + 0.4 * Math.abs(Math.sin(x * 0.09 + ph)))).toFixed(1)}`;
    }
    const g = P.lin([[0, c2, 0], [0.5, c2, op * 0.35], [0.88, c1, op], [1, c1, 0]], 0, y0 - h - amp * 1.6, 0, y0 + amp * 1.6, true);
    return `<path d="${d}" fill="none" stroke="${g}" stroke-width="1.5" ${P.blur(1.2)}/>`;
  };
  P.add(`<ellipse cx="100" cy="50" rx="140" ry="50" fill="${P.rad([[0, '#3affb0', 0.42], [1, '#3affb0', 0]])}"/>`);
  P.add(aur(66, 12, 0.4, '#5affc0', '#8a5aff', 56, 0.9), aur(52, 9, 2.1, '#9affe0', '#4ab8ff', 40, 0.7), aur(84, 6, 4.2, '#3aff9a', '#c06aff', 30, 0.55));
  // cordilheira distante (plano 3, azulado e enevoado) e próxima (plano 2, faces de luz e sombra)
  P.add(path('M0 132 L18 108 L30 116 L52 92 L70 112 L88 100 L108 118 L128 94 L150 110 L170 90 L190 106 L200 100 L200 150 L0 150Z', P.lin([[0, '#8ab8dc'], [1, '#4a7aa8']]), 'opacity="0.85"'));
  const peaks: [number, number, number][] = [[-6, 150, 34], [30, 124, 26], [62, 140, 30], [138, 138, 30], [172, 122, 28], [206, 150, 30]];
  for (const [x, top, w] of peaks) {
    P.add(path(`M${x - w} 160 L${x} ${top - 20} L${x + w} 160Z`, P.lin([[0, '#f4fcff'], [1, '#6aa8d4']])));
    P.add(path(`M${x} ${top - 20} L${x + w} 160 L${x + 4} 160Z`, '#1a4a82', 'opacity="0.55"'));
    P.add(line(`M${x} ${top - 20} L${x - w * 0.3} ${top + 10} M${x} ${top - 20} L${x + 2} 150`, '#ffffff', 0.9, 0.7));
  }
  // lago congelado com reflexo da aurora
  P.add(path('M0 156 L200 156 L200 200 L0 200Z', P.lin([[0, '#9ad8f4'], [0.4, '#4a9ac8'], [1, '#0e3a6a']])));
  P.add(path('M20 164 L180 164 L150 200 L50 200Z', P.lin([[0, '#6affc8', 0.35], [1, '#6affc8', 0]]), P.blur(2)));
  P.add(line('M10 170 L60 168 M120 176 L190 172 M40 186 L100 184', '#ffffff', 0.9, 0.55));
  // moldura de estalactites de gelo (laterais)
  const ice = P.lin([[0, '#ffffff'], [0.45, '#a8e0fa'], [1, '#1e5a92']], 0, 0, 1, 1);
  P.add(sym('M0 200 L0 118 L8 104 L14 132 L22 96 L30 150 L36 200Z', ice, ink(1)));
  P.add(sym('M8 104 L10 160 L3 190Z M22 96 L25 170 L32 196Z', '#ffffff', 'opacity="0.35"'), sym('M22 96 L30 150 L25 170Z', '#0a3a7a', 'opacity="0.35"'));
  P.add(sym('M0 0 L34 0 L28 6 L24 18 L18 8 L12 24 L6 10 L0 20Z', ice, ink(1)));
  P.figure('#b8f8ff', '#7affc8', '#1a5a9a');
  // traje de cristal: ombros facetados com reflexos de aurora
  const body = 'M8 200 C12 176 34 160 66 154 L134 154 C166 160 188 176 192 200Z';
  P.add(path(body, P.lin([[0, '#f4fcff'], [0.35, '#9ad4f4'], [0.75, '#3a7ab8'], [1, '#0e2e5a']], 0.3, 0, 0.6, 1), ink(1.6)));
  const bc = P.clip(`<path d="${body}"/>`);
  P.add(`<g clip-path="${bc}">`);
  const facets = ['M20 176 L40 162 L52 180 L30 196Z', 'M40 162 L66 156 L62 178 L52 180Z', 'M52 180 L62 178 L70 200 L44 200Z', 'M10 196 L30 196 L34 200 L8 200Z', 'M66 156 L84 158 L74 186 L62 178Z'];
  for (const [i, f] of facets.entries()) P.add(sym(f, i % 2 ? '#ffffff' : '#0a3a6a', `opacity="${i % 2 ? 0.4 : 0.3}"`));
  P.add(symLine('M20 176 L40 162 L66 156 M40 162 L52 180 L62 178', '#e8fcff', 0.9, 0.8));
  P.add(`<ellipse cx="44" cy="170" rx="24" ry="8" fill="#7affc8" opacity="0.35" ${P.blur(3)}/><ellipse cx="160" cy="176" rx="22" ry="8" fill="#9a7aff" opacity="0.3" ${P.blur(3)}/>`);
  P.add('</g>');
  // pescoço (sombra fria sob o queixo) e gola alta de cristal
  const skin = '#bcd8f0';
  P.add(path('M86 124 L86 158 L100 176 L114 158 L114 124Z', P.lin([[0, '#5a7ab4'], [0.5, '#9ab8e0'], [1, '#6a8ac0']], 0, 0, 1, 0)));
  P.add(path('M86 128 C92 142 108 142 114 128 L114 146 C106 152 94 152 86 146Z', '#1a3a8a', `opacity="0.45" ${P.blur(2)}`));
  P.add(sym('M86 142 L64 120 L58 160 L92 184Z', P.lin([[0, '#ffffff'], [0.5, '#a8def8'], [1, '#2a6aa8']], 0, 0, 1, 1), ink(1.2)));
  P.add(sym('M64 120 L72 150 L58 160Z', '#fff', 'opacity="0.55"'), sym('M72 150 L92 184 L86 142Z', '#0a3a6a', 'opacity="0.3"'));
  P.add(symLine('M64 120 L58 160', '#ffffff', 1.1, 0.9));
  P.add(line('M92 184 L100 196 L108 184', INK, 1.2, 0.6));
  // orelhas pontudas longas, concha interna sombreada e borda translúcida
  const earG = P.lin([[0, '#7a9ad0'], [0.55, '#bcd8f0'], [1, '#e8f4ff']], 0, 0, 1, 0);
  P.add(sym('M66 84 C50 74 30 56 8 34 C20 60 38 84 54 102 C60 108 64 106 67 100Z', earG, ink(1.4)));
  P.add(sym('M62 88 C48 78 34 64 20 48 C32 66 44 82 58 96Z', '#3a5aa0', `opacity="0.45" ${P.blur(1)}`));
  P.add(symLine('M10 36 C28 56 44 72 64 84', '#ffffff', 1, 0.7), symLine('M22 56 C34 72 44 84 56 98', '#c8a8ff', 1.4, 0.35));
  // cabeça alongada careca, sombra azul-violeta (sem cinza sujo)
  const head = 'M100 20 C132 20 142 46 140 74 C138 96 132 112 122 126 C114 136 106 142 100 142 C94 142 86 136 78 126 C68 112 62 96 60 74 C58 46 68 20 100 20Z';
  const hc = skinFill(P, head, skin, { light: '#f8fcff', rim: '#9af4ff', rim2: '#7affc8', shadow: '#1a2a8a' });
  P.add(`<g clip-path="${hc}">`);
  sculpt(P, skin, { eyeY: 92, dx: 16, noseY: 114, mouthY: 127, chin: 138, cool: true, warm: '#6a9aff', shadow: '#3a5aa8' });
  P.add(`<ellipse cx="86" cy="38" rx="20" ry="11" fill="#fff" opacity="0.55" transform="rotate(-20 86 38)" ${P.blur(2.5)}/><ellipse cx="82" cy="34" rx="7" ry="3.5" fill="#fff" opacity="0.8" transform="rotate(-20 82 34)" ${P.blur(0.8)}/>`);
  P.add(`<ellipse cx="136" cy="80" rx="8" ry="30" fill="#7affc8" opacity="0.3" ${P.blur(3)}/>`);
  P.add(symLine('M72 108 C78 118 84 124 90 128', '#3a5aa8', 4, 0.22));
  P.add('</g>');
  // sobrancelhas finas e arqueadas, olhos gelo luminosos
  const brow: Pt[] = [[94, 84], [86, 79], [76, 78.5], [68, 82]];
  P.add(path(taper(brow, 2.6, 0.8), '#5a7ab0'), path(taper(mirPts(brow), 2.6, 0.8), '#5a7ab0'));
  P.add(`<g ${P.blur(2.5)}><ellipse cx="84" cy="92" rx="11" ry="5" fill="#7ae8ff" opacity="0.45"/><ellipse cx="116" cy="92" rx="11" ry="5" fill="#7ae8ff" opacity="0.45"/></g>`);
  P.add(eyes(P, 92, 16, 10, 4.6, '#6ae4ff', { tilt: 10, irisR: 4.2, pupil: '#0a2a4a', lid: 0.45, sclera: '#eaf6ff' }));
  P.add(symLine('M76 98 C80 100 86 100 90 98', '#4a6aa8', 0.9, 0.5));
  // nariz fino, sorriso de canto confiante, lábios azul-violeta
  realNose(P, 94, 115, 5.6, skin, { dark: '#3a5aa8' });
  realMouth(P, 126, 12, '#7a88c8', { smirk: 2.5, philtrum: 9, dark: '#1a2450' });
}

function olaf(P: Pic): void {
  // fiorde com montanhas, pedra e porta iluminada, moldura de madeira
  P.add(bgRect(P.lin([[0, '#5a7a9a'], [0.6, '#b8ccd8'], [1, '#dfe8ee']])));
  P.add(path('M0 126 L20 82 L40 98 L66 58 L96 100 L120 70 L150 96 L176 62 L200 90 L200 140 L0 140Z', P.lin([[0, '#7a90a8'], [1, '#4a6078']])));
  P.add(path('M66 58 L74 70 L68 68 L60 72Z M176 62 L184 74 L176 72 L170 76Z M120 70 L126 78 L118 78Z', '#f4f8fc', 'opacity="0.9"'));
  P.add(path('M0 130 L200 130 L200 170 L0 170Z', P.lin([[0, '#8aa8c0'], [1, '#2a4058']])));
  P.add(line('M120 138 L160 138 M140 146 L190 146 M130 154 L170 154', '#fff', 1, 0.5));
  P.add(path('M150 132 L168 108 L184 120 L200 104 L200 170 L140 170Z', '#34424e'));
  P.add(path('M0 44 L42 44 L42 200 L0 200Z', P.lin([[0, '#4a4440'], [1, '#2a2622']], 0, 0, 1, 0)));
  P.add(path('M8 170 L8 108 C8 90 34 90 34 108 L34 170Z', P.rad([[0, '#ffd070'], [0.6, '#e0701a'], [1, '#6a2a08']], 0.5, 0.7, 0.7), ink(1.5)));
  P.add(line('M0 60 L42 60 M0 80 L10 80 M34 80 L42 80 M20 44 L20 60', '#1a1612', 1.2));
  const wood = P.lin([[0, '#7a4a24'], [0.5, '#a86a34'], [1, '#4a2a12']], 0, 0, 1, 0);
  P.add(path('M0 0 L200 0 L200 14 L0 14Z', P.lin([[0, '#a86a34'], [1, '#4a2a12']])), path('M0 0 L10 0 L10 200 L0 200Z', wood), path('M190 0 L200 0 L200 200 L190 200Z', wood));
  P.figure('#ffb050', '#cfe4ff', '#9ab4c8');
  // pele de animal nos ombros com escudos de metal
  const furTop: string[] = [];
  const rf = rng(8);
  for (let i = 0; i <= 32; i++) {
    const x = i * 6.25 + (rf() * 3 - 1.5);
    const y = 142 + (i % 2 ? -6 - rf() * 6 : 2 + rf() * 3) + Math.pow((x - 100) / 100, 2) * 14;
    furTop.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  const fur = `M0 200 L0 150 L${furTop.join(' L')} L200 150 L200 200Z`;
  P.add(path(fur, P.lin([[0, '#a07048'], [0.4, '#6a4424'], [1, '#2a180a']]), ink(1.2)));
  P.texture(fur, 'fur', 0.4);
  const r = rng(21);
  let fs = '';
  for (let i = 0; i < 70; i++) {
    const x = 4 + r() * 192;
    const y = 150 + r() * 48;
    fs += `M${x.toFixed(1)} ${y.toFixed(1)} l${(r() * 4 - 2).toFixed(1)} 6`;
  }
  P.add(line(fs, '#c8a078', 1, 0.5));
  const boss = P.rad([[0, '#ffffff'], [0.3, '#b8c0cc'], [0.8, '#4a5260'], [1, '#1a1e26']], 0.38, 0.32, 0.7);
  P.add(`<circle cx="30" cy="178" r="15" fill="${boss}" ${ink(1.8)}/><circle cx="170" cy="178" r="15" fill="${boss}" ${ink(1.8)}/><circle cx="30" cy="178" r="4" fill="#d8dde6" ${ink(1)}/><circle cx="170" cy="178" r="4" fill="#d8dde6" ${ink(1)}/>`);
  // chifres (atrás do capacete)
  const hornG = P.lin([[0, '#fff8e8'], [0.5, '#e0d0b0'], [1, '#8a7a5a']], 0, 0, 1, 0);
  const hp: Pt[] = [[66, 58], [40, 54], [20, 40], [28, 4]];
  P.add(path(taper(hp, 18, 2.5, 20), hornG, ink(2)), path(taper(mirPts(hp), 18, 2.5, 20), hornG, ink(2)));
  let rings = '';
  for (const t of [0.15, 0.3, 0.45, 0.6, 0.75]) {
    for (const pts of [hp, mirPts(hp)]) {
      const b = bez(pts, t);
      const len = Math.hypot(b.dx, b.dy) || 1;
      const w = (18 + (2.5 - 18) * t) / 2;
      rings += `M${(b.x - (b.dy / len) * w).toFixed(1)} ${(b.y + (b.dx / len) * w).toFixed(1)} L${(b.x + (b.dy / len) * w).toFixed(1)} ${(b.y - (b.dx / len) * w).toFixed(1)}`;
    }
  }
  P.add(line(rings, '#8a7050', 1.1, 0.7));
  // rosto
  const skin = '#e89a74';
  P.add(sym('M64 88 C56 86 54 96 56 104 C58 110 62 112 66 108Z', P.lin([[0, '#b86a48'], [1, skin]]), ink(1.5)));
  const oc = skinFill(P, facePath(52, 38, 30, 140), skin);
  P.add(`<g clip-path="${oc}">`);
  sculpt(P, skin, { eyeY: 93, dx: 17, noseY: 114, mouthY: 126, chin: 138 });
  P.add('</g>');
  P.add(`<ellipse cx="78" cy="104" rx="11" ry="7" fill="${P.rad([[0, '#e0403a', 0.45], [1, '#e0403a', 0]])}"/><ellipse cx="122" cy="104" rx="11" ry="7" fill="${P.rad([[0, '#e0403a', 0.4], [1, '#e0403a', 0]])}"/>`);
  // capacete
  const steel = P.lin([[0, '#f4f7fa'], [0.3, '#aab2be'], [0.6, '#5a6270'], [1, '#2a3038']]);
  const dome = 'M58 72 C58 36 78 18 100 18 C122 18 142 36 142 72Z';
  P.add(path(dome, steel, ink(1.4)));
  P.texture(dome, 'metal', 0.45);
  P.add(`<g clip-path="${P.clip(`<path d="${dome}"/>`)}"><rect width="200" height="200" fill="${P.lin([[0, '#000', 0.35], [0.3, '#000', 0], [0.7, '#000', 0], [1, '#000', 0.5]], 58, 0, 142, 0, true)}"/></g>`);
  P.add(path('M94 19 L106 19 L108 70 L92 70Z', P.lin([[0, '#c8a050'], [1, '#6a4a18']], 0, 0, 1, 0), ink(1.3)));
  P.add(`<ellipse cx="80" cy="34" rx="10" ry="5" fill="#fff" opacity="0.6" transform="rotate(-30 80 34)"/>`);
  P.add(path('M54 64 C70 58 130 58 146 64 L146 80 C130 74 70 74 54 80Z', P.lin([[0, '#d8a858'], [0.5, '#8a6424'], [1, '#4a3010']]), ink(2)));
  let riv = '';
  for (let i = 0; i < 9; i++) {
    const x = 60 + i * 10;
    const y = 70 - Math.sin((i / 8) * Math.PI) * 5;
    riv += `<circle cx="${x}" cy="${y.toFixed(1)}" r="1.9" fill="#fff4d0" ${ink(0.6)}/>`;
  }
  P.add(riv);
  P.add(path('M95 76 L105 76 L104 98 C102 100 98 100 96 98Z', steel, ink(1.4)));
  // sobrancelhas grossas ruivas, olhos azuis
  const redH = '#c8501a';
  browHairs(P, [[96, 85], [88, 79], [76, 79], [64, 86]], redH, 6, 91, 46);
  browHairs(P, mirPts([[96, 85], [88, 79], [76, 79], [64, 86]]), redH, 6, 92, 46);
  P.add(eyes(P, 93, 17, 7, 3.8, '#4a7ab8', { tilt: -6, lid: 0.05 }));
  // nariz grande
  P.add(path('M94 98 C90 108 88 114 94 116 C98 118 102 118 106 116 C112 114 110 108 106 98Z', P.rad([[0, '#ffc0a0'], [0.6, '#e88a6a'], [1, '#b85a40']], 0.4, 0.35, 0.7), ink(1.3)));
  P.add(`<ellipse cx="97" cy="108" rx="3" ry="2" fill="#fff" opacity="0.4"/>`);
  // barba enorme
  const beard = P.rad([[0, '#ffa050'], [0.5, '#d65418'], [1, '#6a2008']], 0.5, 0.2, 0.9);
  const bd = 'M58 96 C52 130 60 170 78 200 L122 200 C140 170 148 130 142 96 C134 112 122 120 100 120 C78 120 66 112 58 96Z';
  P.add(path(bd, beard, ink(2)));
  const rb = rng(4);
  let dk = '';
  let lt = '';
  for (let i = 0; i < 16; i++) {
    const x = 64 + i * 4.6 + rb() * 2;
    const x2 = 100 + (x - 100) * 0.6 + rb() * 6 - 3;
    const s = `M${x.toFixed(1)} ${(112 + Math.abs(x - 100) * -0.3).toFixed(1)} C${(x - 2).toFixed(1)} 150 ${x2.toFixed(1)} 170 ${x2.toFixed(1)} 196`;
    if (i % 2) dk += s;
    else lt += s;
  }
  P.add(line(dk, '#6a2008', 1.4, 0.4), line(lt, '#ffb070', 1.2, 0.3));
  P.add(`<g clip-path="${P.clip(`<path d="${bd}"/>`)}">`);
  hairLocks(P, 22, 45, (r) => {
    const x = 58 + r() * 84;
    const y = 100 + r() * 24;
    const x2 = 100 + (x - 100) * (0.4 + r() * 0.3);
    return { p: [[x, y], [x + (x - 100) * 0.15, y + 30], [x2, y + 60], [x2, y + 84 + r() * 20]], w: 8 + r() * 5 };
  }, { dark: '#4a1404', mid: '#c0501a', light: '#ffb060' }, 2.5, 2);
  strands(P, 110, 44, (r) => {
    const x = 56 + r() * 88;
    const y = 100 + r() * 30;
    const x2 = 100 + (x - 100) * (0.45 + r() * 0.3);
    return [[x, y], [x + (x - 100) * 0.12, y + 30], [x2 + (r() - 0.5) * 8, y + 60], [x2, y + 80 + r() * 20]];
  }, '#ffb060', '#5a1804', 2);
  P.add(`<ellipse cx="100" cy="126" rx="34" ry="9" fill="#3a0a02" opacity="0.5" ${P.blur(3)}/><ellipse cx="86" cy="150" rx="10" ry="24" fill="#ffd090" opacity="0.25" ${P.blur(4)}/>`);
  P.add('</g>');
  // tranças com anéis
  for (const bx of [82, 118]) {
    let seg = '';
    for (let y = 160; y < 200; y += 7) seg += `<ellipse cx="${bx + ((y / 7) % 2 ? 1.5 : -1.5)}" cy="${y}" rx="6" ry="4.5" fill="${beard}" ${ink(1.1)}/>`;
    P.add(seg, `<rect x="${bx - 6}" y="178" width="12" height="5" rx="1.5" fill="${P.lin([[0, '#f0d890'], [1, '#8a6424']])}" ${ink(1)}/>`);
  }
  // bigode e boca
  P.add(path('M92 124 C96 128 104 128 108 124 L106 128 C102 130 98 130 94 128Z', '#3a0a04'));
  P.add(path('M100 114 C88 108 70 112 60 128 C72 120 88 122 100 120 C112 122 128 120 140 128 C130 112 112 108 100 114Z', P.lin([[0, '#ffb060'], [1, '#b8440e']]), ink(1.6)));
}

// ---------------------------------------------------------------- rivais (montador com o mesmo acabamento dos jogáveis)

type Head = 'human' | 'brute' | 'long' | 'skull' | 'robot' | 'cat';
type Eyes = 'shades' | 'visor' | 'angry' | 'glow' | 'cat' | 'goggles';
type Mouth = 'grin' | 'smirk' | 'fangs' | 'snarl' | 'grill' | 'skull';
type Hair = 'none' | 'mullet' | 'mohawk' | 'spikes' | 'long' | 'crest';
type Extra = 'horns' | 'viking' | 'beard' | 'scar' | 'earring' | 'antenna' | 'bolts' | 'tusks';
type Theme = 'storm' | 'desert' | 'jungle' | 'factory' | 'lava' | 'junk' | 'ice' | 'hell';

interface Face {
  head: Head;
  skin: string;
  eyes: Eyes;
  eyeColor?: string;
  mouth: Mouth;
  hair: Hair;
  hairColor?: string;
  extras?: Extra[];
  jacket: string;
  bg: string;
  theme?: Theme;
}

const FACES: Record<string, Face> = {
  rip: { head: 'human', skin: '#c4bcc8', eyes: 'angry', eyeColor: '#c02020', mouth: 'fangs', hair: 'spikes', hairColor: '#e8e8f0', extras: ['scar'], jacket: '#2a1a3a', bg: '#5a2a8a', theme: 'storm' },
  shred: { head: 'human', skin: '#a8704a', eyes: 'angry', eyeColor: '#6a4a24', mouth: 'snarl', hair: 'spikes', hairColor: '#3a2412', extras: ['earring', 'beard'], jacket: '#4a2a12', bg: '#8a5020', theme: 'desert' },
  viper: { head: 'long', skin: '#4aa844', eyes: 'cat', eyeColor: '#ff3020', mouth: 'fangs', hair: 'long', hairColor: '#14141a', jacket: '#0a3a1a', bg: '#0a5a1a', theme: 'jungle' },
  grinder: { head: 'robot', skin: '#7a808c', eyes: 'visor', eyeColor: '#40ff80', mouth: 'grill', hair: 'none', extras: ['bolts', 'antenna'], jacket: '#1a2a3a', bg: '#1a5a8a', theme: 'factory' },
  ragewortt: { head: 'brute', skin: '#6a7a34', eyes: 'glow', eyeColor: '#ff3a1a', mouth: 'snarl', hair: 'spikes', hairColor: '#2a3010', extras: ['tusks'], jacket: '#3a2a0a', bg: '#4a3a10', theme: 'lava' },
  roadkill: { head: 'human', skin: '#b8b088', eyes: 'goggles', eyeColor: '#80e0ff', mouth: 'grin', hair: 'mohawk', hairColor: '#5cff3a', extras: ['scar'], jacket: '#4a3414', bg: '#7a5a20', theme: 'junk' },
  butcher: { head: 'skull', skin: '#dfe6ea', eyes: 'glow', eyeColor: '#40e0ff', mouth: 'skull', hair: 'none', extras: ['horns'], jacket: '#0a2a44', bg: '#104a7a', theme: 'ice' },
  slash: { head: 'brute', skin: '#a82414', eyes: 'glow', eyeColor: '#ffd020', mouth: 'fangs', hair: 'long', hairColor: '#0e0a0a', extras: ['horns'], jacket: '#2a0806', bg: '#6a0a06', theme: 'hell' },
};

/** Liga nomes/ids (com variações de grafia) ao rosto. */
function faceKey(nameOrId: string): string {
  const n = nameOrId.toLowerCase().replace(/[^a-z0-9]/g, '');
  const keys: [string, string][] = [
    ['snake', 'snake'], ['cyber', 'cyberhawk'], ['ivan', 'ivanzypher'], ['zypher', 'ivanzypher'], ['katarina', 'katarina'], ['lyons', 'katarina'],
    ['jake', 'jake'], ['badlands', 'jake'], ['tarquinn', 'tarquinn'], ['olaf', 'olaf'], ['rip', 'rip'], ['shred', 'shred'], ['viper', 'viper'],
    ['grinder', 'grinder'], ['rage', 'ragewortt'], ['roadkill', 'roadkill'], ['kelly', 'roadkill'], ['butcher', 'butcher'], ['icebone', 'butcher'],
    ['slash', 'slash'], ['jb', 'slash'],
  ];
  return keys.find(([k]) => n.includes(k))?.[1] ?? '';
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Rosto genérico (piloto desconhecido): variação determinística pelo nome. */
function genericFace(name: string): Face {
  const h = hash(name);
  const pick = <T,>(arr: T[], k: number) => arr[(h >>> k) % arr.length];
  return {
    head: pick<Head>(['human', 'brute', 'long', 'robot'], 0),
    skin: pick(['#d8a47a', '#7aa04a', '#9aa6b8', '#b07858', '#9a70b0'], 3),
    eyes: pick<Eyes>(['angry', 'shades', 'glow', 'goggles'], 6),
    eyeColor: pick(['#ff3020', '#40e0ff', '#ffe020'], 9),
    mouth: pick<Mouth>(['grin', 'snarl', 'fangs', 'smirk'], 11),
    hair: pick<Hair>(['mohawk', 'spikes', 'none', 'long'], 14),
    hairColor: pick(['#c0301a', '#e2c060', '#101010', '#5cff3a'], 17),
    jacket: '',
    bg: pick(['#6a1010', '#1f4fa0', '#3a5a1a', '#6a2a8a'], 20),
    theme: pick<Theme>(['storm', 'desert', 'factory', 'lava', 'junk'], 23),
  };
}

function headShape(h: Head): string {
  switch (h) {
    case 'brute':
      return 'M100 40 C126 40 141 54 142 80 C143 96 141 110 137 120 C132 134 120 146 100 147 C80 146 68 134 63 120 C59 110 57 96 58 80 C59 54 74 40 100 40Z';
    case 'long':
      return 'M100 32 C124 32 137 50 137 74 C137 92 135 104 132 114 C128 130 116 144 100 146 C84 144 72 130 68 114 C65 104 63 92 63 74 C63 50 76 32 100 32Z';
    case 'skull':
      return 'M100 26 C130 26 146 48 146 78 C146 94 140 104 132 110 L128 132 C120 140 110 144 100 144 C90 144 80 140 72 132 L68 110 C60 104 54 94 54 78 C54 48 70 26 100 26Z';
    case 'robot':
      return 'M70 32 L130 32 C140 32 144 38 144 48 L142 118 C142 134 128 142 116 142 L84 142 C72 142 58 134 58 118 L56 48 C56 38 60 32 70 32Z';
    case 'cat':
      return facePath(46, 40, 26, 140);
    default:
      return 'M100 42 C121 42 134 55 135 78 C136 92 135 104 132 114 C129 126 124 134 117 140 C111 145 106 147 100 147 C94 147 89 145 83 140 C76 134 71 126 68 114 C65 104 64 92 65 78 C66 55 79 42 100 42Z';
  }
}

/** Cenário temático pintado em planos (céu, fundo distante, meio, luz ambiente e partículas). */
function scene(P: Pic, t: Theme, seed: number): void {
  const r = rng(seed);
  const ridge = (y: number, amp: number, step: number, col: string, extra = '') => {
    let d = `M-4 200 L-4 ${y}`;
    for (let x = -4; x <= 208; x += step) d += ` L${x} ${(y - r() * amp).toFixed(1)}`;
    P.add(path(`${d} L208 200Z`, col, extra));
  };
  const specks = (n: number, y0: number, y1: number, cols: string[], rmax = 1.4) => {
    let s = '';
    for (let i = 0; i < n; i++) s += `<circle cx="${(r() * 200).toFixed(1)}" cy="${(y0 + r() * (y1 - y0)).toFixed(1)}" r="${(0.4 + r() * rmax).toFixed(1)}" fill="${cols[i % cols.length]}" opacity="${(0.35 + r() * 0.6).toFixed(2)}"/>`;
    P.add(s);
  };
  switch (t) {
    case 'storm': {
      P.add(bgRect(P.lin([[0, '#0e0620'], [0.5, '#3a1a6a'], [1, '#140828']])));
      for (let i = 0; i < 9; i++) P.add(`<ellipse cx="${(r() * 200).toFixed(0)}" cy="${(10 + r() * 60).toFixed(0)}" rx="${(40 + r() * 40).toFixed(0)}" ry="${(10 + r() * 12).toFixed(0)}" fill="${i % 2 ? '#6a4aa8' : '#2a1648'}" opacity="0.6" ${P.blur(5)}/>`);
      P.add(neon('M150 0 L140 30 L152 34 L136 70 L146 72 L128 104', '#d8c0ff', 1.2), neon('M30 0 L38 20 L30 24 L42 50', '#b89aff', 0.9));
      ridge(150, 30, 14, '#1a0c30');
      ridge(172, 16, 10, '#0a0418');
      specks(30, 80, 200, ['#c8a8ff', '#ffffff'], 0.8);
      break;
    }
    case 'desert': {
      P.add(bgRect(P.lin([[0, '#3a1a3a'], [0.35, '#c0503a'], [0.62, '#ffb060'], [1, '#6a3018']])));
      P.add(`<circle cx="148" cy="96" r="22" fill="${P.rad([[0, '#fff4c0'], [0.5, '#ffd070'], [1, '#ff8a3a', 0]])}"/>`);
      P.add(path('M-4 200 L-4 110 L14 104 L20 84 L44 84 L50 110 L70 112 L76 100 L96 100 L100 116 L200 118 L208 200Z', '#8a3a2a', `opacity="0.8" ${P.blur(1)}`));
      P.add(path('M-4 200 L-4 132 L30 128 L36 114 L62 114 L68 134 L140 136 L146 118 L176 118 L182 132 L208 132 L208 200Z', P.lin([[0, '#5a1e1a'], [1, '#1a0806']])));
      P.add(`<g ${P.blur(0.8)}>${line('M36 116 L62 116 M146 120 L176 120', '#ffb070', 1.4, 0.8)}</g>`);
      specks(24, 90, 200, ['#ffd08a', '#ff9a4a'], 0.8);
      break;
    }
    case 'jungle': {
      P.add(bgRect(P.lin([[0, '#0a2a14'], [0.45, '#2a6a2a'], [1, '#061a08']])));
      P.add(`<ellipse cx="100" cy="60" rx="110" ry="60" fill="${P.rad([[0, '#c8ff8a', 0.55], [1, '#c8ff8a', 0]])}"/>`);
      for (let i = 0; i < 7; i++) {
        const x = r() * 200;
        P.add(path(taper([[x, -4], [x + 10 - r() * 20, 50], [x + 20 - r() * 40, 110], [x + r() * 10, 200]], 8 + r() * 10, 3), i % 2 ? '#0e3a14' : '#1a4a1a', `opacity="0.85" ${P.blur(i % 2 ? 2 : 1)}`));
      }
      let leaves = '';
      for (let i = 0; i < 26; i++) {
        const x = r() * 200;
        const y = r() * 200;
        const a = r() * 360;
        leaves += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(6 + r() * 8).toFixed(0)}" ry="${(2 + r() * 2).toFixed(1)}" transform="rotate(${a.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="${i % 3 ? '#2a6a22' : '#4a9a34'}" opacity="0.7"/>`;
      }
      P.add(`<g ${P.blur(1.4)}>${leaves}</g>`);
      P.add(`<rect y="120" width="200" height="80" fill="${P.lin([[0, '#9aff8a', 0], [1, '#9aff8a', 0.25]])}" ${P.blur(4)}/>`);
      specks(18, 20, 160, ['#eaff9a'], 0.9);
      break;
    }
    case 'factory': {
      P.add(bgRect(P.lin([[0, '#0a141e'], [0.6, '#1e3a4e'], [1, '#0a0e14']])));
      P.add(`<ellipse cx="60" cy="150" rx="90" ry="40" fill="${P.rad([[0, '#ff8a2a', 0.55], [1, '#ff8a2a', 0]])}"/>`);
      let g = '';
      for (let x = -10; x < 210; x += 34) g += `M${x} 0 L${x + 8} 0 L${x + 8} 200 L${x} 200Z`;
      P.add(path(g, '#0e1a24', `opacity="0.85" ${P.blur(1.2)}`));
      let tr = '';
      for (let x = -10; x < 210; x += 17) tr += `M${x} 40 L${x + 17} 58 M${x + 17} 40 L${x} 58`;
      P.add(`<path d="M-4 38 H204 M-4 60 H204" stroke="#1a2c3a" stroke-width="3"/>`, line(tr, '#1a2c3a', 1.6));
      for (const [x, y] of [[30, 20], [170, 24], [110, 12]]) P.add(glowEye(P, x, y, 2.5, '#ffd08a'));
      let sp = '';
      for (let i = 0; i < 26; i++) {
        const x = 20 + r() * 80;
        const y = 120 + r() * 70;
        const a = -0.6 - r() * 1.6;
        const l = 3 + r() * 9;
        sp += `M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * l).toFixed(1)} ${(Math.sin(a) * l).toFixed(1)}`;
      }
      P.add(line(sp, '#ffd05a', 0.8, 0.85));
      break;
    }
    case 'lava': {
      P.add(bgRect(P.lin([[0, '#1a0604'], [0.5, '#4a140a'], [1, '#ff5a1a']])));
      P.add(path('M-4 200 L-4 150 L40 100 L64 94 L76 104 L100 150 L130 120 L150 70 L166 66 L176 76 L208 130 L208 200Z', '#200a06', P.blur(0.8)));
      P.add(`<g ${P.blur(1.5)}>${line('M150 70 C156 90 150 110 160 140 M166 68 C170 96 180 118 196 150', '#ff7a1a', 2.2, 0.85)}</g>`);
      P.add(`<ellipse cx="158" cy="66" rx="30" ry="14" fill="${P.rad([[0, '#ffb04a', 0.8], [1, '#ff4a0a', 0]])}"/>`);
      for (let i = 0; i < 5; i++) P.add(`<ellipse cx="${(140 + r() * 40).toFixed(0)}" cy="${(10 + r() * 40).toFixed(0)}" rx="${(14 + r() * 14).toFixed(0)}" ry="${(8 + r() * 8).toFixed(0)}" fill="#3a2020" opacity="0.7" ${P.blur(4)}/>`);
      P.add(`<ellipse cx="100" cy="206" rx="130" ry="50" fill="${P.rad([[0, '#ffb040', 0.8], [1, '#ff3a0a', 0]])}"/>`);
      specks(40, 60, 200, ['#ffb040', '#ff6a1a', '#ffe08a'], 1.2);
      break;
    }
    case 'junk': {
      P.add(bgRect(P.lin([[0, '#6a5a3a'], [0.5, '#c8a060'], [1, '#4a3418']])));
      P.add(`<circle cx="52" cy="70" r="18" fill="${P.rad([[0, '#fff8d8'], [0.6, '#ffe0a0', 0.8], [1, '#ffe0a0', 0]])}"/>`);
      ridge(128, 14, 12, '#8a6a3a', `opacity="0.7" ${P.blur(1.5)}`);
      // pilha de sucata: carcaças, pneus e placas tortas
      P.add(path('M-4 200 L-4 140 L20 126 L44 132 L52 118 L84 116 L96 128 L130 124 L140 110 L170 112 L184 128 L208 124 L208 200Z', P.lin([[0, '#4a3420'], [1, '#1a1008']])));
      let tires = '';
      for (const [x, y, rr] of [[26, 140, 9], [160, 132, 10], [120, 142, 7]]) tires += `<circle cx="${x}" cy="${y}" r="${rr}" fill="none" stroke="#120c08" stroke-width="5"/><circle cx="${x}" cy="${y}" r="${rr}" fill="none" stroke="#5a4a3a" stroke-width="1" opacity="0.6"/>`;
      P.add(`<g ${P.blur(0.6)}>${tires}</g>`, `<g ${P.blur(0.8)}>${line('M52 120 L84 118 M140 112 L170 114', '#e0b070', 1.2, 0.6)}</g>`);
      P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#e8c080', 0.3], [0.5, '#e8c080', 0], [1, '#e8c080', 0.15]])}"/>`);
      specks(30, 0, 200, ['#f0d8a0'], 0.8);
      break;
    }
    case 'ice': {
      P.add(bgRect(P.lin([[0, '#04142a'], [0.5, '#1a4a7a'], [1, '#8ad0f0']])));
      P.add(`<ellipse cx="100" cy="80" rx="120" ry="60" fill="${P.rad([[0, '#7ae8ff', 0.4], [1, '#7ae8ff', 0]])}"/>`);
      for (const [x, w, h] of [[10, 22, 90], [44, 16, 60], [160, 20, 80], [190, 18, 100], [120, 12, 50]] as [number, number, number][]) {
        P.add(path(`M${x - w} 200 L${x} ${200 - h - 60} L${x + w} 200Z`, P.lin([[0, '#e8fcff'], [0.5, '#6ab8e0'], [1, '#1a4a7a']], 0, 0, 1, 0), `opacity="0.8" ${P.blur(1)}`));
        P.add(line(`M${x} ${200 - h - 60} L${x + 2} 200`, '#fff', 0.8, 0.6));
      }
      P.add(path('M0 0 L200 0 L200 10 L190 26 L184 10 L170 30 L160 8 L140 22 L128 6 L100 18 L80 4 L60 24 L44 6 L30 28 L16 8 L0 20Z', '#dff6ff', `opacity="0.7" ${P.blur(0.8)}`));
      specks(40, 0, 200, ['#ffffff', '#bff0ff'], 1);
      break;
    }
    case 'hell': {
      P.add(bgRect(P.lin([[0, '#0a0202'], [0.55, '#5a0a04'], [1, '#ff4a0a']])));
      for (const x of [14, 186]) P.add(path(`M${x - 12} 200 L${x - 10} 30 L${x + 10} 30 L${x + 12} 200Z`, P.lin([[0, '#1a0604'], [0.5, '#3a1008'], [1, '#0a0202']], 0, 0, 1, 0), P.blur(1)));
      let fl = '';
      for (let i = 0; i < 16; i++) {
        const x = r() * 200;
        const h = 40 + r() * 80;
        fl += taper([[x, 204], [x - 8 + r() * 16, 200 - h * 0.4], [x - 10 + r() * 20, 200 - h * 0.8], [x + r() * 6, 200 - h]], 14 + r() * 10, 0.5);
      }
      P.add(path(fl, '#ff6a1a', `opacity="0.55" ${P.blur(2.5)}`), path(fl, '#ffd04a', `opacity="0.35" transform="translate(0 10) scale(1 0.95)" ${P.blur(1.5)}`));
      specks(40, 40, 200, ['#ffb040', '#ff5a1a'], 1.2);
      break;
    }
  }
}

/** Dentes individuais com volume (brilho no topo, sombra na raiz e vãos escuros). */
function teethRow(P: Pic, x0: number, x1: number, yBase: number, dir: 1 | -1, n: number, h: number, fangAt: number[] = [], fangH = 0): string {
  const tg = P.lin(dir > 0 ? [[0, '#8a7a5a'], [0.25, '#e8e0cc'], [0.7, '#fffcf0'], [1, '#d8ccb0']] : [[0, '#d8ccb0'], [0.3, '#fffcf0'], [0.75, '#e8e0cc'], [1, '#8a7a5a']]);
  const w = (x1 - x0) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + i * w;
    const hh = fangAt.includes(i) ? fangH : h * (0.85 + ((i * 37) % 7) * 0.03);
    const tip = yBase + dir * hh;
    d += fangAt.includes(i)
      ? `M${x.toFixed(1)} ${yBase} L${(x + w).toFixed(1)} ${yBase} L${(x + w * 0.55).toFixed(1)} ${tip.toFixed(1)}Z`
      : `M${(x + 0.3).toFixed(1)} ${yBase} L${(x + w - 0.3).toFixed(1)} ${yBase} L${(x + w - 0.5).toFixed(1)} ${(tip - dir * 1.2).toFixed(1)} Q${(x + w / 2).toFixed(1)} ${(tip + dir * 0.8).toFixed(1)} ${(x + 0.5).toFixed(1)} ${(tip - dir * 1.2).toFixed(1)}Z`;
  }
  return `<path d="${d}" fill="${tg}" stroke="#3a2a1a" stroke-width="0.5" stroke-opacity="0.6" ${P.blur(0.25)}/>`;
}

function rival(P: Pic, f: Face, seed: number): void {
  const hairC = f.hairColor ?? '#222';
  const eyeC = f.eyeColor ?? '#ff3020';
  const ex = new Set(f.extras ?? []);
  const metal = f.head === 'robot' || f.head === 'skull';
  scene(P, f.theme ?? 'storm', seed);
  P.figure(shade(f.bg, 1.9), '#ffb040', shade(f.bg, 1.2));
  const hairG = P.lin([[0, shade(hairC, 1.5)], [0.4, hairC], [1, shade(hairC, 0.4)]]);
  const hairCols = { dark: shade(hairC, 0.35), mid: hairC, light: shade(hairC, 1.28) };
  // cabelo comprido atrás, em mechas
  if (f.hair === 'long' || f.hair === 'mullet') {
    const back = 'M100 22 C60 22 44 52 44 88 C44 122 36 156 22 200 L178 200 C164 156 156 122 156 88 C156 52 140 22 100 22Z';
    P.add(path(back, P.lin([[0, shade(hairC, 1.3)], [1, shade(hairC, 0.4)]]), P.blur(1.2)));
    P.add(`<g clip-path="${P.clip(`<path d="${back}"/>`)}">`);
    hairLocks(P, 26, seed + 1, (r, i) => {
      const sg = i % 2 ? 1 : -1;
      const x0 = 100 + sg * (24 + r() * 28);
      const x1 = 100 + sg * (34 + r() * 64);
      return { p: [[x0, 34 + r() * 30], [x0 + sg * 8, 96], [x1 - sg * 6, 150], [x1, 206]], w: 9 + r() * 6 };
    }, hairCols, 3, 1.2);
    P.add('</g>');
  }
  // chifres atrás, com anéis e textura óssea
  if (ex.has('horns')) {
    const hp: Pt[] = [[70, 50], [46, 44], [30, 24], [42, 0]];
    const hg = P.lin([[0, '#fff4e0'], [0.5, '#c8b890'], [1, '#4a3a20']], 0, 0, 1, 0);
    for (const pts of [hp, mirPts(hp)]) {
      const d = taper(pts, 17, 2, 20);
      P.add(path(d, hg, ink(1.2)));
      P.texture(d, 'stone', 0.5);
      let rings = '';
      for (const t of [0.15, 0.3, 0.45, 0.6, 0.75]) {
        const b = bez(pts, t);
        const len = Math.hypot(b.dx, b.dy) || 1;
        const w = (17 + (2 - 17) * t) / 2;
        rings += `M${(b.x - (b.dy / len) * w).toFixed(1)} ${(b.y + (b.dx / len) * w).toFixed(1)} L${(b.x + (b.dy / len) * w).toFixed(1)} ${(b.y - (b.dx / len) * w).toFixed(1)}`;
      }
      P.add(`<g ${P.blur(0.5)}>${line(rings, '#5a4a30', 1, 0.6)}</g>`);
    }
  }
  // pescoço e tronco
  const neck = 'M83 122 L82 158 Q100 168 118 158 L117 122Z';
  P.add(path(neck, metal ? P.lin([[0, '#3a404c'], [0.5, '#6a7280'], [1, '#22262e']], 0, 0, 1, 0) : P.lin([[0, shade(f.skin, 0.55)], [0.5, shade(f.skin, 0.85)], [1, shade(f.skin, 0.45)]], 0, 0, 1, 0)));
  if (metal) {
    P.add(line('M90 128 L89 160 M100 128 L100 164 M110 128 L111 160', '#0a0a0e', 2.6));
    P.add(line('M90 128 L89 160 M110 128 L111 160', '#c02a1a', 1.2, 0.8));
  } else P.add(`<path d="M82 124 C90 146 110 146 118 124 L118 150 C108 158 92 158 82 150Z" fill="#1a0804" opacity="0.5" ${P.blur(2.5)}/>`);
  const jk = f.jacket || shade(f.bg, 0.4);
  leatherJacket(P, jk, shade(jk, 0.7), { rimL: shade(f.bg, 1.8), rimR: '#ffb040' });
  // ombreiras de metal com textura escovada, rebites e espinhos
  const padD = 'M12 176 C16 158 36 148 58 150 L52 170 C40 168 28 172 18 184Z';
  const pad = P.lin([[0, '#e8ecf2'], [0.3, '#8a92a0'], [0.6, '#3a404c'], [1, '#141820']], 0, 0, 0.6, 1);
  P.add(sym(padD, pad, ink(1.2)));
  P.texture(padD, 'metal', 0.5);
  P.texture(mx(padD), 'metal', 0.5);
  P.add(`<g ${P.blur(0.8)}>${symLine('M20 170 C28 160 40 155 54 154', '#fff', 1.4, 0.6)}</g>`);
  P.add(`<g fill="${P.rad([[0, '#ffffff'], [0.5, '#9aa0ae'], [1, '#2a2e38']], 0.35, 0.3, 0.7)}"><circle cx="26" cy="170" r="1.6"/><circle cx="40" cy="162" r="1.6"/><circle cx="174" cy="170" r="1.6"/><circle cx="160" cy="162" r="1.6"/></g>`);
  if (f.head === 'brute' || ex.has('tusks')) P.add(sym('M24 164 L18 142 L32 160Z M38 156 L36 134 L46 154Z', pad, ink(1)));
  // orelhas
  if (f.head === 'human' || f.head === 'brute') {
    const ear = 'M66 84 C57 80 54 92 56 100 C58 108 62 110 67 106Z';
    P.add(sym(ear, P.lin([[0, shade(f.skin, 0.55)], [1, f.skin]]), ink(1)));
    P.add(`<g ${P.blur(0.8)}>${symLine('M63 90 C60 94 60 100 63 103', shade(f.skin, 0.4), 1.2, 0.6)}</g>`);
  }
  if (f.head === 'long') P.add(sym('M64 76 C50 70 36 58 28 44 C36 66 48 82 62 94Z', P.lin([[0, shade(f.skin, 0.55)], [1, f.skin]]), ink(1)));
  // cabeça modelada
  const hd = headShape(f.head);
  const hc = skinFill(P, hd, f.skin, metal ? { light: '#ffffff', tex: f.head === 'skull' ? 'stone' : 'metal' } : { rim: shade(f.bg, 1.8), rim2: '#ffb050', sss: f.head === 'long' ? '#c8ff4a' : undefined });
  P.add(`<g clip-path="${hc}">`);
  if (f.head === 'long') {
    // escamas: fileiras de arcos com luz e sombra
    let sc = '';
    let hl = '';
    for (let y = 36; y < 100; y += 5.5) for (let x = 64 + ((y / 5.5) % 2) * 3; x < 136; x += 6) {
      sc += `M${x} ${y} C${x + 1.5} ${y + 3.6} ${x + 4.5} ${y + 3.6} ${x + 6} ${y}`;
      hl += `M${x + 1} ${y + 0.8} C${x + 2} ${y + 2.4} ${x + 4} ${y + 2.4} ${x + 5} ${y + 0.8}`;
    }
    P.add(line(sc, shade(f.skin, 0.45), 0.8, 0.55), line(hl, shade(f.skin, 1.5), 0.6, 0.35));
  }
  if (!metal) sculpt(P, f.skin, { eyeY: 92, dx: 17, noseY: 115, mouthY: 127, chin: 142, cool: f.head === 'long' || f.head === 'brute' });
  if (ex.has('beard')) {
    const bz = 'M66 110 C70 132 86 150 100 150 C114 150 130 132 134 110 C126 122 118 124 113 121 C108 118 92 118 87 121 C82 124 74 122 66 110Z';
    P.add(path(bz, shade(hairC, 0.8), `opacity="0.35" ${P.blur(2)}`));
    P.texture(bz, 'stubble', 0.9);
  }
  if (metal) {
    P.add(`<ellipse cx="82" cy="44" rx="16" ry="7" fill="#fff" opacity="0.55" transform="rotate(-18 82 44)" ${P.blur(1.5)}/>`);
    P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#000', 0.45], [0.25, '#000', 0], [0.7, '#000', 0], [1, '#000', 0.55]], 54, 0, 146, 0, true)}"/>`);
  }
  if (f.head === 'robot') {
    P.add(`<g ${P.blur(0.35)}>${line('M100 32 L100 70 M60 58 L80 62 M140 58 L120 62 M58 118 L76 112 M142 118 L124 112', '#1a1e26', 1.2)}${line('M101 32 L101 70 M60 59.5 L80 63.5', '#fff', 0.6, 0.5)}</g>`);
    P.add(`<ellipse cx="136" cy="90" rx="6" ry="30" fill="#40ff80" opacity="0.18" ${P.blur(3)}/>`);
  }
  if (f.head === 'skull') {
    P.add(`<g ${P.blur(0.5)}>${line('M100 27 L100 50 M74 40 C82 50 88 54 96 56 M126 40 C118 50 112 54 104 56', '#5a6a78', 1, 0.6)}${line('M120 34 L126 52 L122 62', '#3a4250', 0.9, 0.7)}</g>`);
  }
  P.add('</g>');
  if (f.head === 'robot' || ex.has('bolts')) P.add(`<g fill="${P.rad([[0, '#fff'], [0.5, '#9aa0ae'], [1, '#3a4050']], 0.35, 0.3, 0.7)}"><circle cx="64" cy="42" r="2.4"/><circle cx="136" cy="42" r="2.4"/><circle cx="62" cy="124" r="2.4"/><circle cx="138" cy="124" r="2.4"/></g>`);
  // olhos
  const browC = shade(hairC === '#e8e8f0' ? '#7a7a88' : f.head === 'long' || f.head === 'brute' ? f.skin : hairC, 0.55);
  switch (f.eyes) {
    case 'angry': {
      P.add(eyes(P, 93, 16, 8, 3.4, eyeC, { tilt: -8, lid: 0.7 }));
      const bw: Pt[] = [[97, 89], [89, 82.5], [79, 80.5], [67, 82]];
      browHairs(P, bw, browC, 4.6, seed + 3);
      browHairs(P, mirPts(bw), browC, 4.6, seed + 4);
      P.add(`<g ${P.blur(1)}>${line('M96 84 L99 90 M104 84 L101 90', shade(f.skin, 0.45), 1.3, 0.5)}</g>`);
      break;
    }
    case 'glow':
      P.add(`<g ${P.blur(1.4)}>${sym('M62 84 C74 81 88 86 97 93 C86 102 70 101 62 84Z', '#0a0404', 'opacity="0.9"')}</g>`);
      P.add(glowEye(P, 82, 91, 4.2, eyeC), glowEye(P, 118, 91, 4.2, eyeC));
      P.add(`<g ${P.blur(0.8)}>${sym('M56 78 C70 72 88 78 99 90 C86 83 72 81 58 84Z', shade(f.skin, 0.4))}</g>`);
      P.add(`<g ${P.blur(0.6)}>${symLine('M60 79 C72 74 86 78 96 86', shade(f.skin, 1.35), 1, 0.5)}</g>`);
      break;
    case 'cat':
      P.add(`<g ${P.blur(1.5)}>${sym('M64 82 C74 80 88 84 96 92 C86 98 72 98 64 82Z', shade(f.skin, 0.35), 'opacity="0.7"')}</g>`);
      P.add(eyes(P, 89, 17, 10.5, 5.2, eyeC, { tilt: 16, slit: true, irisR: 6, lid: 0.5, sclera: '#d8cc50' }));
      P.add(`<g ${P.blur(0.6)}>${symLine('M64 79 C74 74 86 76 95 83', shade(f.skin, 0.35), 2.4, 0.9)}</g>`);
      break;
    case 'goggles': {
      P.add(`<g ${P.blur(0.4)}>${line('M54 90 L146 90', '#2a1c10', 7)}${line('M54 88 L146 88', '#8a6a40', 1, 0.6)}</g>`);
      P.texture('M54 86.5 L146 86.5 L146 93.5 L54 93.5Z', 'leather', 0.6);
      const lens = P.rad([[0, shade(eyeC, 1.5)], [0.6, shade(eyeC, 0.6)], [1, shade(eyeC, 0.2)]], 0.4, 0.35, 0.7);
      for (const cx of [82, 118]) {
        P.add(`<circle cx="${cx}" cy="91" r="12.5" fill="${P.lin([[0, '#f0f2f6'], [0.4, '#8a92a0'], [1, '#2a303a']], 0, 0, 1, 1)}" ${ink(1.2)}/><circle cx="${cx}" cy="91" r="9" fill="${lens}"/>`);
        P.add(`<circle cx="${cx}" cy="91" r="9" fill="none" stroke="#000" stroke-width="1.6" opacity="0.5" ${P.blur(0.6)}/><path d="M${cx - 5.5} 88 C${cx - 3.5} 84.5 ${cx} 83.6 ${cx + 2.5} 84" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" ${P.blur(0.4)}/><circle cx="${cx + 4}" cy="95" r="1" fill="#fff" opacity="0.6"/>`);
      }
      break;
    }
    case 'visor':
      P.add(`<rect x="60" y="80" width="80" height="20" rx="9" fill="#060709" ${ink(1.2)}/><rect x="52" y="72" width="96" height="36" rx="16" fill="${P.rad([[0, eyeC, 0.5], [1, eyeC, 0]])}"/>`);
      P.add(`<rect x="65" y="86" width="70" height="8" rx="4" fill="${P.lin([[0, shade(eyeC, 0.5)], [0.5, '#ffffff'], [1, shade(eyeC, 0.5)]], 0, 0, 1, 0)}"/><rect x="65" y="86" width="70" height="8" rx="4" fill="${eyeC}" opacity="0.55"/>`);
      P.add(line('M68 90 L132 90', '#fff', 0.6, 0.8), `<path d="M62 82 L138 82" stroke="#fff" stroke-width="0.8" opacity="0.35"/>`);
      break;
    case 'shades':
      P.add(path('M60 82 L140 82 L138 91 C136 102 118 104 110 97 L104 91 L96 91 L90 97 C82 104 64 102 62 91Z', P.lin([[0, '#2a2a3e'], [1, '#08080e']]), ink(1.2)));
      P.add(`<g ${P.blur(0.5)}>${line('M68 86 L82 85 M112 85 L126 84', '#fff', 1.4, 0.7)}</g>`);
      break;
  }
  // nariz
  if (f.head === 'human' || f.head === 'brute') realNose(P, 92, 115, f.head === 'brute' ? 8.5 : 7, f.skin);
  if (f.head === 'long') P.add(`<g ${P.blur(0.5)}><ellipse cx="94.5" cy="109" rx="1.8" ry="1.1" fill="#0a1a06"/><ellipse cx="105.5" cy="109" rx="1.8" ry="1.1" fill="#0a1a06"/></g>`, `<ellipse cx="100" cy="104" rx="6" ry="4" fill="#fff" opacity="0.18" ${P.blur(1.5)}/>`);
  // boca
  const my = 126;
  const inner = P.rad([[0, '#6a1010'], [0.7, '#2a0404'], [1, '#100202']], 0.5, 0.3, 0.7);
  switch (f.mouth) {
    case 'grin':
      P.add(path(`M80 ${my - 4} C90 ${my + 8} 110 ${my + 8} 120 ${my - 4} C108 ${my + 1} 92 ${my + 1} 80 ${my - 4}Z`, inner));
      P.add(teethRow(P, 83, 117, my - 2.2, 1, 8, 4.8));
      P.add(`<g ${P.blur(0.5)}>${line(`M79 ${my - 4.5} C92 ${my + 0.5} 108 ${my + 0.5} 121 ${my - 4.5}`, '#2a0a04', 1.4)}${line(`M82 ${my + 1} C92 ${my + 9} 108 ${my + 9} 118 ${my + 1}`, '#2a0a04', 1.2, 0.8)}</g>`);
      P.add(`<ellipse cx="100" cy="${my + 9}" rx="10" ry="1.6" fill="#fff" opacity="0.3" ${P.blur(0.8)}/>`);
      break;
    case 'smirk':
      realMouth(P, my, 13, shade(f.skin, 0.8), { smirk: 3 });
      break;
    case 'fangs':
      P.add(path(`M78 ${my - 5} C90 ${my - 9} 110 ${my - 9} 122 ${my - 5} C116 ${my + 10} 84 ${my + 10} 78 ${my - 5}Z`, inner));
      P.add(teethRow(P, 84, 116, my - 7.5, 1, 7, 3.2, [0, 6], 11), teethRow(P, 88, 112, my + 7, -1, 6, 2.6, [0, 5], 7));
      P.add(`<g ${P.blur(0.5)}>${path(`M78 ${my - 5} C90 ${my - 9} 110 ${my - 9} 122 ${my - 5} C116 ${my + 10} 84 ${my + 10} 78 ${my - 5}Z`, 'none', `stroke="#200404" stroke-width="1.4"`)}</g>`);
      P.add(`<path d="M78 ${my - 6} C90 ${my - 11} 110 ${my - 11} 122 ${my - 6}" fill="none" stroke="${shade(f.skin, 0.55)}" stroke-width="3" opacity="0.6" ${P.blur(1)}/>`);
      break;
    case 'snarl':
      P.add(path(`M76 ${my - 7} L124 ${my - 7} C122 ${my + 4} 120 ${my + 8} 100 ${my + 8} C80 ${my + 8} 78 ${my + 4} 76 ${my - 7}Z`, inner));
      P.add(`<path d="M78 ${my - 6.5} L122 ${my - 6.5} L121 ${my - 4.5} L79 ${my - 4.5}Z" fill="#b83a3a" opacity="0.8"/>`);
      P.add(teethRow(P, 79, 121, my - 4.8, 1, 9, 5.2, ex.has('tusks') ? [] : [0, 8], 8), teethRow(P, 81, 119, my + 7, -1, 8, 4.4));
      P.add(`<g ${P.blur(0.6)}>${line(`M74 ${my - 8} C88 ${my - 11} 112 ${my - 11} 126 ${my - 8}`, shade(f.skin, 0.4), 2.2, 0.7)}${line(`M80 ${my + 9} C92 ${my + 12} 108 ${my + 12} 120 ${my + 9}`, shade(f.skin, 0.45), 1.6, 0.5)}</g>`);
      P.add(`<g ${P.blur(1)}>${line('M88 110 C84 116 80 120 76 122 M112 110 C116 116 120 120 124 122', shade(f.skin, 0.45), 1.6, 0.5)}</g>`);
      break;
    case 'grill': {
      P.add(`<rect x="72" y="114" width="56" height="20" rx="4" fill="${P.lin([[0, '#2a2e38'], [1, '#0a0c10']])}" ${ink(1)}/>`);
      let bars = '';
      for (let x = 78; x <= 122; x += 6) bars += `M${x} 116 L${x} 132`;
      P.add(line(bars, '#1a1e26', 3), line(bars, '#b8c0cc', 1.4), `<g ${P.blur(0.4)}>${line(bars.replace(/M(\d+)/g, (_m, x) => `M${+x - 0.5}`), '#fff', 0.5, 0.6)}</g>`);
      P.add(`<rect x="72" y="114" width="56" height="20" rx="4" fill="${P.rad([[0, eyeC, 0.25], [1, eyeC, 0]])}"/>`);
      break;
    }
    case 'skull': {
      P.add(`<path d="M100 99 L93 113 C96 115 98 113 100 111 C102 113 104 115 107 113Z" fill="#0a0406" ${P.blur(0.4)}/>`);
      P.add(`<rect x="76" y="117" width="48" height="18" rx="3" fill="#0a0406"/>`);
      P.add(teethRow(P, 77, 123, 118, 1, 8, 7.4), teethRow(P, 78, 122, 134, -1, 8, 6.2));
      P.add(`<g ${P.blur(0.6)}>${line('M70 112 C74 128 86 140 100 142 C114 140 126 128 130 112', '#5a6a78', 1.2, 0.6)}</g>`);
      break;
    }
  }
  if (ex.has('tusks')) {
    const tk = 'M80 128 C72 120 70 106 75 96 C78 108 83 117 88 123Z';
    P.add(sym(tk, P.lin([[0, '#fffcf0'], [0.6, '#d8c8a0'], [1, '#7a6a48']]), ink(1)));
    P.add(`<g ${P.blur(0.5)}>${symLine('M77 116 C75 108 75 102 76 98', '#fff', 1, 0.6)}</g>`);
  }
  if (ex.has('scar')) {
    P.add(`<g ${P.blur(0.5)}>${line('M122 72 L133 112', '#6a1010', 2.6, 0.85)}${line('M123 81 L130 78.5 M125.5 90 L132.5 87.5 M128 99 L135 96.5 M130 106 L136 104', '#7a1a14', 1.2, 0.8)}</g>`);
    P.add(`<g ${P.blur(0.4)}>${line('M121.2 72.4 L132.2 112.4', '#ffb0a0', 0.6, 0.45)}</g>`);
  }
  if (ex.has('earring')) P.add(`<circle cx="57" cy="110" r="4" fill="none" stroke="${P.lin([[0, '#fff4b0'], [1, '#a07818']])}" stroke-width="1.8"/>`);
  // cabelo da frente
  if (f.hair === 'spikes') {
    // espetos feitos de mechas afiladas com fios
    const r = rng(seed + 9);
    let sp = '';
    let ln = '';
    for (let i = 0; i < 22; i++) {
      const a = Math.PI * (1.04 + 0.92 * (i / 21)) + (r() - 0.5) * 0.08;
      const bx = 100 + Math.cos(a) * 30;
      const by = 64 + Math.sin(a) * 26;
      const L = 30 + r() * 26;
      const tx = 100 + Math.cos(a) * (30 + L);
      const ty = 64 + Math.sin(a) * (26 + L * 0.9);
      const p: Pt[] = [[bx, by], [bx + (tx - bx) * 0.35, by + (ty - by) * 0.3 - 3], [bx + (tx - bx) * 0.7, by + (ty - by) * 0.72 - 2], [tx, ty]];
      sp += taper(p, 11 + r() * 5, 0.5, 14);
      for (let k = 0; k < 3; k++) ln += taper(p.map(([x, y]) => [x + (r() - 0.5) * 3, y + (r() - 0.5) * 3]) as Pt[], 0.9, 0.1, 10);
    }
    P.add(path(sp, hairG, ink(0.8)), path(ln, shade(hairC, 1.7), 'opacity="0.5"'), path(ln, shade(hairC, 0.4), 'opacity="0.35" transform="translate(0.8 0.6)"'));
    const cap = 'M62 78 C60 50 76 34 100 34 C124 34 140 50 138 78 C130 64 118 58 108 64 C100 54 88 58 84 64 C76 60 66 66 62 78Z';
    P.add(path(cap, hairG, ink(0.8)));
    P.add(`<g clip-path="${P.clip(`<path d="${cap}"/>`)}">`);
    strands(P, 50, seed + 11, (r) => {
      const x = 64 + r() * 72;
      return [[100 + (x - 100) * 0.3, 34], [x - 2, 44], [x, 58], [x + (x - 100) * 0.2, 78]];
    }, shade(hairC, 1.7), shade(hairC, 0.4), 1);
    P.add('</g>');
  }
  if (f.hair === 'mohawk') {
    // crista de dezenas de espetos finos
    const r = rng(seed + 5);
    let sp = '';
    let hl = '';
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const bx = 80 + t * 40;
      const tx = 64 + t * 72 + (r() - 0.5) * 6;
      const ty = 6 + Math.abs(t - 0.5) * 30 + r() * 8;
      const p: Pt[] = [[bx, 54], [bx + (tx - bx) * 0.3, 40], [tx - (tx - bx) * 0.15, ty + 10], [tx, ty]];
      sp += taper(p, 7 + r() * 3, 0.4, 12);
      hl += taper(p, 1, 0.1, 10);
    }
    P.add(path(sp, P.lin([[0, shade(hairC, 1.6)], [0.6, hairC], [1, shade(hairC, 0.35)]], 0, 0, 0, 1), ink(0.6)), path(hl, '#ffffff', 'opacity="0.35"'));
    P.add(`<ellipse cx="100" cy="30" rx="26" ry="18" fill="${hairC}" opacity="0.3" ${P.blur(6)}/>`);
  }
  if (f.hair === 'long' || f.hair === 'mullet') {
    const cap = 'M60 78 C56 44 76 26 100 26 C124 26 144 44 140 78 C132 60 118 52 106 56 C96 48 80 54 74 62 C70 66 64 70 60 78Z';
    P.add(path(cap, hairG, P.blur(0.5)));
    P.add(`<g clip-path="${P.clip(`<path d="${cap}"/>`)}">`);
    hairLocks(P, 12, seed + 7, (r, i) => {
      const sg = i % 2 ? 1 : -1;
      const x = 100 + sg * (2 + r() * 42);
      return { p: [[100 + sg * 2, 24], [100 + sg * 14, 30], [x - sg * 4, 50], [x + sg * 8, 82]], w: 8 + r() * 4 };
    }, hairCols, 1.5, 1);
    P.add('</g>');
    // mechas caindo ao lado do rosto
    for (const sg of [-1, 1]) {
      const lk = sg < 0 ? 'M70 56 C60 70 60 96 62 118 C64 140 58 170 46 200 L80 200 C76 176 72 150 72 126 C72 100 70 78 78 62Z' : mx('M70 56 C60 70 60 96 62 118 C64 140 58 170 46 200 L80 200 C76 176 72 150 72 126 C72 100 70 78 78 62Z');
      P.add(path(lk, hairG, P.blur(0.6)));
      P.add(`<g clip-path="${P.clip(`<path d="${lk}"/>`)}">`);
      hairLocks(P, 8, seed + 20 + sg, (r) => {
        const x0 = 100 + sg * (26 + r() * 8);
        const x1 = 100 + sg * (30 + r() * 28);
        return { p: [[x0, 56], [x0 + sg * 8, 100], [x1 - sg * 4, 150], [x1, 204]], w: 6 + r() * 4 };
      }, hairCols, 2.5, 1.2);
      P.add('</g>');
    }
  }
  if (f.hair === 'crest') P.add(path('M92 38 L84 8 L98 26 L102 2 L108 26 L120 10 L110 38Z', hairG, ink(1)));
  if (ex.has('antenna')) {
    P.add(line('M126 34 L140 10', '#1a1e26', 3), line('M126 34 L140 10', '#b8c0cc', 1.2));
    P.add(glowEye(P, 140, 10, 3.2, eyeC));
  }
}

// ---------------------------------------------------------------- montagem

/**
 * Acabamento de pintura sobre a ilustração: luz principal quente vinda do alto à esquerda,
 * sombra fria embaixo à direita, manchas de pincel (ruído de baixa frequência) e textura fina
 * de tela — tira o aspecto de ícone vetorial chapado.
 */
function paintFinish(P: Pic): void {
  const gray = 'type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1"';
  const brush = `${P.id}fb`;
  const grain = `${P.id}fg`;
  P.defs.push(
    `<filter id="${brush}" x="0" y="0" width="200" height="200" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.035 0.06" numOctaves="3" seed="7"/><feColorMatrix ${gray}/></filter>`,
    `<filter id="${grain}" x="0" y="0" width="200" height="200" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix ${gray}/></filter>`,
  );
  P.add(`<rect width="200" height="200" fill="${P.rad([[0, '#fff2d8', 0.5], [0.55, '#fff2d8', 0.08], [1, '#fff2d8', 0]], 0.2, 0.12, 0.7)}" style="mix-blend-mode:soft-light"/>`);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#1a2a6a', 0], [0.55, '#1a2a6a', 0], [1, '#1a1040', 0.45]], 0, 0, 1, 1)}" style="mix-blend-mode:multiply"/>`);
  P.add(`<rect width="200" height="200" filter="url(#${brush})" opacity="0.4" style="mix-blend-mode:soft-light"/>`);
  P.add(`<rect width="200" height="200" filter="url(#${grain})" opacity="0.2" style="mix-blend-mode:overlay"/>`);
}

const HEROES: Record<string, (P: Pic) => void> = { snake, cyberhawk, ivanzypher, katarina, jake, tarquinn, olaf };

const cache = new Map<string, string>();

/**
 * Retrato pronto para innerHTML. A pintura tem dezenas de filtros (texturas, desfoques); como imagem
 * (blob) ela é rasterizada uma vez e reaproveitada pelo navegador — barata de redesenhar em menus
 * e em aparelhos fracos. Sem suporte a blob, devolve o SVG embutido.
 */
export function portraitSvg(nameOrId: string, size = 96): string {
  const label = nameOrId.replace(/[^w .'-]/g, '');
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') return portraitSvgRaw(nameOrId, size);
  const k = `${faceKey(nameOrId) || nameOrId}|${size}`;
  let url = cache.get(k);
  if (!url) {
    url = URL.createObjectURL(new Blob([portraitSvgRaw(nameOrId, size)], { type: 'image/svg+xml' }));
    cache.set(k, url);
    rasterize(k, url, size);
  }
  return `<img class="portrait" src="${url}" width="${size}" height="${size}" alt="${label}" draggable="false" decoding="async">`;
}

/**
 * Troca o SVG por um PNG na resolução da tela. O SVG com filtros era re-rasterizado pelo navegador
 * a cada repintura (rolagem de menu travava no celular); o PNG é só um bitmap.
 */
function rasterize(k: string, svgUrl: string, size: number): void {
  if (typeof document === 'undefined') return;
  const img = new Image();
  // a pintura (drawImage do SVG com filtros) é o passo caro: vai para a fila dos intervalos livres
  img.onload = () => idleJob(`portrait-png:${k}`, paint, true);
  const paint = () => {
    try {
      const px = Math.round(size * Math.min(3, Math.max(1, window.devicePixelRatio || 1)));
      const c = document.createElement('canvas');
      c.width = c.height = px;
      c.getContext('2d')!.drawImage(img, 0, 0, px, px);
      c.toBlob((b) => {
        if (!b) return;
        const png = URL.createObjectURL(b);
        cache.set(k, png);
        document.querySelectorAll<HTMLImageElement>(`img.portrait[src="${svgUrl}"]`).forEach((el) => (el.src = png));
        // o SVG não é mais usado (o cache aponta para o PNG): libera a memória depois que as
        // imagens trocadas carregarem o PNG
        setTimeout(() => URL.revokeObjectURL(svgUrl), 1000);
      }, 'image/png');
    } catch {
      // canvas contaminado ou sem suporte: fica o SVG
    }
  };
  img.src = svgUrl;
}

/** Prepara (em PNG) os retratos dos menus antes de abrir a tela, nos intervalos livres. */
export function warmPortraits(ids: string[], sizes: number[]): void {
  for (const id of ids) for (const s of sizes) idleJob(`portrait:${faceKey(id) || id}|${s}`, () => portraitSvg(id, s));
}

/** SVG do retrato (string com o <svg> embutido). */
export function portraitSvgRaw(nameOrId: string, size = 96): string {
  const key = faceKey(nameOrId);
  const P = new Pic();
  const hero = HEROES[key];
  if (hero) hero(P);
  else rival(P, FACES[key] ?? genericFace(nameOrId), hash(key || nameOrId));
  // separa cenário e figura: cenário desfocado (profundidade) + névoa; figura com luz de recorte
  // colorida nos dois lados e sombra projetada sobre o fundo (oclusão)
  const s = Math.max(0, P.subj);
  const scene = P.out.splice(0, P.out.length);
  const fx = `${P.id}fx`;
  const U = 'x="-20" y="-20" width="240" height="240" filterUnits="userSpaceOnUse"';
  const rimPart = (dx: number, color: string, tag: string) =>
    `<feOffset in="SourceAlpha" dx="${dx}" dy="1.5" result="${tag}o"/><feComposite in="SourceAlpha" in2="${tag}o" operator="out" result="${tag}e"/><feGaussianBlur in="${tag}e" stdDeviation="1.3" result="${tag}b"/><feFlood flood-color="${color}" flood-opacity="0.5"/><feComposite in2="${tag}b" operator="in" result="${tag}"/>`;
  P.defs.push(
    `<filter id="${fx}bg" ${U}><feGaussianBlur stdDeviation="${size >= 80 ? 1.6 : 0.8}"/></filter>`,
    `<filter id="${fx}rim" ${U}>${rimPart(2.4, P.rimL, 'l')}${rimPart(-2.4, P.rimR, 'r')}<feGaussianBlur in="SourceAlpha" stdDeviation="4" result="sh"/><feOffset in="sh" dx="3" dy="4" result="sho"/><feFlood flood-color="#000" flood-opacity="0.55"/><feComposite in2="sho" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge><feBlend in2="l" mode="screen" result="m1"/><feBlend in="m1" in2="r" mode="screen"/></filter>`,
  );
  if (size >= 80) {
    // borda pintada: deslocamento leve por ruído (contornos à mão, sem aspecto de vetor)
    P.defs.push(`<filter id="${fx}p" ${U}><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="${size >= 160 ? 0.9 : 0.6}" xChannelSelector="R" yChannelSelector="G"/></filter>`);
  }
  P.add(`<g clip-path="${P.clip('<rect x="3" y="3" width="194" height="194" rx="20"/>')}">`);
  if (size >= 80) P.add(`<g filter="url(#${fx}p)">`);
  P.add(`<g filter="url(#${fx}bg)">`, ...scene.slice(0, s), '</g>');
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, P.fog, 0.04], [0.6, P.fog, 0.22], [1, P.fog, 0.08]])}"/>`);
  // rivais: aproxima a figura (rosto maior, lê melhor nas miniaturas da garagem e dos resultados)
  const zoom = key in HEROES ? '' : ' transform="translate(100 104) scale(1.16) translate(-100 -104)"';
  P.add(`<g filter="url(#${fx}rim)"${zoom}>`, ...scene.slice(s), '</g>');
  if (size >= 80) P.add('</g>');
  paintFinish(P);
  // vinheta e brilho de vidro
  P.add(bgRect(P.rad([[0, '#000', 0], [0.62, '#000', 0], [1, '#000', 0.6]], 0.5, 0.45, 0.78)));
  P.add(path('M3 3 L197 3 L197 40 C140 26 60 26 3 60Z', P.lin([[0, '#fff', 0.14], [1, '#fff', 0]])));
  P.add('</g>');
  // moldura metálica
  const rim = P.lin([[0, '#f6f8fb'], [0.25, '#6a7080'], [0.5, '#e4e8ee'], [0.75, '#4a5060'], [1, '#c8ccd4']], 0, 0, 1, 1);
  P.add(`<rect x="3.5" y="3.5" width="193" height="193" rx="20" fill="none" stroke="${rim}" stroke-width="5"/><rect x="1.5" y="1.5" width="197" height="197" rx="22" fill="none" stroke="${INK}" stroke-width="3"/><rect x="7" y="7" width="186" height="186" rx="17" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="1.5"/>`);
  return `<svg class="portrait" viewBox="0 0 200 200" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${nameOrId.replace(/"/g, '')}"><defs>${P.defs.join('')}</defs>${P.out.join('')}</svg>`;
}
