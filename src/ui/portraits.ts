/**
 * Retratos dos pilotos, desenhados por código em SVG no estilo "capa de card": rosto grande,
 * sombreamento por gradientes, fundo temático com profundidade, roupa visível, vinheta e moldura metálica.
 * Os 7 pilotos jogáveis têm ilustração escrita à mão; rivais e pilotos desconhecidos usam um
 * montador de peças com o mesmo acabamento.
 */

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
}

/** Contorno de tinta: escuro, fino e translúcido — pintura, não ícone. */
const ink = (w = 2) => `stroke="${INK}" stroke-opacity="0.5" stroke-width="${w * 0.6}" stroke-linejoin="round" stroke-linecap="round"`;

/**
 * Modelagem de rosto pintado: órbitas e sombra sob a sobrancelha, lateral do nariz, sob o lábio e o
 * queixo (oclusão), maçãs e testa iluminadas, ponte do nariz com brilho e calor subcutâneo.
 * Chamar dentro do clip do rosto. `cool` troca a sombra quente por fria (peles azuis/verdes).
 */
function sculpt(P: Pic, skin: string, o: { eyeY?: number; dx?: number; noseY?: number; mouthY?: number; warm?: string; cool?: boolean; chin?: number } = {}): void {
  const ey = o.eyeY ?? 92;
  const dx = o.dx ?? 16;
  const ny = o.noseY ?? 112;
  const my = o.mouthY ?? 126;
  const dk = o.cool ? shade(skin, 0.42) : shade(skin, 0.5);
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
function skinFill(P: Pic, d: string, skin: string, o: { stroke?: number; light?: string; rim?: string; rim2?: string } = {}): string {
  const c = P.clip(`<path d="${d}"/>`);
  P.add(path(d, P.rad([[0, o.light ?? shade(skin, 1.35)], [0.55, skin], [1, shade(skin, 0.64)]], 0.4, 0.3, 0.85)));
  P.add(`<g clip-path="${c}">`);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#000', 0], [0.45, '#000', 0], [1, '#000', 0.34]], 96, 0, 140, 20, true)}"/>`);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#000', 0], [0.75, '#000', 0], [1, '#000', 0.3]], 0, 40, 0, 145, true)}"/>`);
  P.add(`<ellipse cx="84" cy="70" rx="22" ry="16" fill="${P.rad([[0, '#fff', 0.22], [1, '#fff', 0]])}"/><ellipse cx="80" cy="104" rx="12" ry="9" fill="${P.rad([[0, '#fff', 0.16], [1, '#fff', 0]])}"/>`);
  if (o.rim) P.add(`<path d="${d}" fill="none" stroke="${o.rim}" stroke-width="6" opacity="0.5" clip-path="${P.clip('<rect width="88" height="200"/>')}"/>`);
  if (o.rim2) P.add(`<path d="${d}" fill="none" stroke="${o.rim2}" stroke-width="6" opacity="0.5" clip-path="${P.clip('<rect x="112" y="0" width="88" height="200"/>')}"/>`);
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
    <rect x="${-w}" y="${-h * 1.5}" width="${w * 2}" height="${h * 3}" fill="${o.sclera ?? P.lin([[0, '#c8bcb4'], [0.6, '#f8f4ee'], [1, '#e0d8d0']])}"/>
    <circle cx="${ix}" cy="${h * 0.08}" r="${r}" fill="${ig}"/>${pupil}
    <path d="M${-w} ${-h * 1.4} L${w} ${-h * 1.4} L${w} ${-h * (o.lid ?? 0.35)} C${w * 0.3} ${-h * 0.9} ${-w * 0.3} ${-h * 0.9} ${-w} ${-h * (o.lid ?? 0.35)}Z" fill="#000" opacity="0.28"/>
    <circle cx="${ix}" cy="${h * 0.08}" r="${r * 0.72}" fill="none" stroke="${shade(iris, 1.8)}" stroke-width="${r * 0.18}" stroke-dasharray="${(r * 0.12).toFixed(2)} ${(r * 0.2).toFixed(2)}" opacity="0.5"/>
    <circle cx="${ix}" cy="${h * 0.08}" r="${r}" fill="none" stroke="#000" stroke-width="${r * 0.14}" opacity="0.55"/>
    <path d="M${-w} ${-h * 1.4} L${w} ${-h * 1.4} L${w} ${-h * 0.2} C${w * 0.3} ${-h * 0.5} ${-w * 0.3} ${-h * 0.5} ${-w} ${-h * 0.2}Z" fill="#000" opacity="0.18"/>
    <circle cx="${ix - r * 0.38}" cy="${-r * 0.3}" r="${Math.max(0.9, r * 0.3)}" fill="#fff"/>
    <circle cx="${ix + r * 0.42}" cy="${r * 0.38}" r="${Math.max(0.5, r * 0.13)}" fill="#fff" opacity="0.8"/>
    <path d="M${-w * 0.6} ${h * 0.75} C${-w * 0.2} ${h * 0.95} ${w * 0.3} ${h * 0.95} ${w * 0.65} ${h * 0.7}" fill="none" stroke="#fff" stroke-width="0.7" opacity="0.5"/>
  </g><path d="${d}" fill="none" ${ink(1.2)}/><path d="M${-w - 1} ${0.5} C${-w * 0.5} ${-h * 1.35} ${w * 0.5} ${-h * 1.35} ${w + 0.5} ${-0.3}" fill="none" ${ink(2.4)}/></g>`;
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

/** Nariz sombreado. */
function nose(y0: number, y1: number, w: number, skin: string): string {
  const dk = shade(skin, 0.55);
  return `${path(`M103 ${y0} C106 ${y0 + (y1 - y0) * 0.5} ${106 + w * 0.2} ${y1 - 6} ${100 + w} ${y1 - 1} C${100 + w} ${y1 + 3} 104 ${y1 + 3} 101 ${y1 + 1}Z`, dk, 'opacity="0.45"')}
    <ellipse cx="99" cy="${y1 - 3}" rx="${w * 0.45}" ry="2.2" fill="#fff" opacity="0.28"/>
    ${line(`M${100 - w} ${y1 - 2} C${100 - w - 2} ${y1 + 3} ${97} ${y1 + 4} 100 ${y1 + 2} C103 ${y1 + 4} ${100 + w + 2} ${y1 + 3} ${100 + w} ${y1 - 2}`, INK, 1.5)}
    ${path(`M${96 - w * 0.2} ${y1 + 1} C95 ${y1 - 1} 97 ${y1 - 1} 98 ${y1 + 1.5}Z M${104 + w * 0.2} ${y1 + 1} C105 ${y1 - 1} 103 ${y1 - 1} 102 ${y1 + 1.5}Z`, INK, 'opacity="0.7"')}`;
}

/** Fundo com gradiente cheio. */
const bgRect = (fill: string) => `<rect width="200" height="200" fill="${fill}"/>`;

/** Luz neon: halo largo + núcleo + filete branco. */
function neon(d: string, c: string, w = 2.2): string {
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w * 4}" opacity="0.18" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w * 2}" opacity="0.35" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="${w * 0.35}" opacity="0.8" stroke-linecap="round"/>`;
}

/** Jaqueta de couro (Snake, Jake, rivais). */
function leatherJacket(P: Pic, base: string, shirt: string, o: { collar?: boolean; rimL?: string; rimR?: string } = {}): void {
  P.add(path('M68 146 L132 146 L140 200 L60 200Z', P.lin([[0, shade(shirt, 1.2)], [1, shade(shirt, 0.6)]])));
  const leather = P.lin([[0, shade(base, 2.1)], [0.25, shade(base, 1.35)], [0.6, base], [1, shade(base, 0.4)]], 0.2, 0, 0.5, 1);
  const panel = 'M8 200 C10 174 30 158 62 150 L82 146 C84 164 88 182 94 200Z';
  P.add(sym(panel, leather, ink(2)));
  // brilho do couro
  P.add(symLine('M20 186 C26 170 40 160 60 155', '#fff', 2.2, 0.22));
  P.add(symLine('M72 160 C74 172 78 184 82 196', '#fff', 1.4, 0.18));
  if (o.collar !== false) {
    P.add(sym('M82 144 L62 154 L72 178 L88 162Z', P.lin([[0, shade(base, 1.9)], [1, shade(base, 0.6)]]), ink(1.6)));
  }
  if (o.rimL) P.add(line('M10 196 C12 174 32 158 62 150', o.rimL, 2.5, 0.8));
  if (o.rimR) P.add(line(mx('M10 196 C12 174 32 158 62 150'), o.rimR, 2.5, 0.8));
}

// ---------------------------------------------------------------- pilotos jogáveis

function snake(P: Pic): void {
  // noite neon na cidade, luzes do teto da cabine em perspectiva
  P.add(bgRect(P.lin([[0, '#14062e'], [0.55, '#46125e'], [1, '#0a0616']])));
  P.add(`<ellipse cx="100" cy="132" rx="120" ry="44" fill="${P.rad([[0, '#ff4fc0', 0.6], [1, '#ff4fc0', 0]])}"/>`);
  const r = rng(11);
  let city = '';
  let win = '';
  for (let x = -4; x < 204; ) {
    const w = 8 + r() * 13;
    const h = 22 + r() * 50;
    city += `M${x.toFixed(1)} 160 L${x.toFixed(1)} ${(160 - h).toFixed(1)} L${(x + w).toFixed(1)} ${(160 - h).toFixed(1)} L${(x + w).toFixed(1)} 160Z`;
    for (let wy = 160 - h + 4; wy < 156; wy += 5) for (let wx = x + 2; wx < x + w - 2; wx += 4) if (r() < 0.35) win += `M${wx.toFixed(1)} ${wy.toFixed(1)} h1.8 v2.2 h-1.8Z`;
    x += w + 1.5;
  }
  P.add(path(city, '#1a0b33'), path(win, '#ffd48a', 'opacity="0.75"'));
  P.add(neon('M-6 10 L70 76', '#ff3ad0'), neon('M16 -6 L82 64', '#3ae8ff', 1.6), neon('M206 10 L130 76', '#3ae8ff'), neon('M184 -6 L118 64', '#ff3ad0', 1.6));
  P.add(neon('M147 52 C147 40 173 40 173 52 C173 64 147 64 147 52Z', '#ff4fd8', 2), neon('M153 55 C154 47 158 47 158 52 C158 57 162 57 163 49 C164 45 167 47 167 53', '#7af4ff', 1.3));

  P.figure('#ff4fd0', '#4ae8ff', '#7a2a9a');
  const hair = P.lin([[0, '#fff6c8'], [0.3, '#f0c860'], [0.7, '#b8862a'], [1, '#5a3a10']]);
  // cabelo de trás: liso, comprido, caindo por trás dos ombros
  P.add(path('M100 24 C62 24 46 52 46 88 C46 122 40 152 26 190 C44 198 66 194 80 180 C74 156 70 132 70 108 L130 108 C130 132 126 156 120 180 C134 194 156 198 174 190 C160 152 154 122 154 88 C154 52 138 24 100 24Z', hair, ink(2)));
  const rs = rng(17);
  let dk = '';
  let lt = '';
  for (let i = 0; i < 16; i++) {
    const x0 = 50 + rs() * 18;
    const y0 = 70 + rs() * 30;
    const x1 = 28 + rs() * 46;
    const y1 = 168 + rs() * 24;
    const pts: Pt[] = [[x0, y0], [x0 - 4 - rs() * 6, y0 + 40], [x1 + 4, y1 - 36], [x1, y1]];
    const d = taper(pts, 2.6 + rs() * 1.6, 0.4, 12) + taper(mirPts(pts), 2.6 + rs() * 1.6, 0.4, 12);
    if (i % 2) dk += d;
    else lt += d;
  }
  P.add(path(dk, '#6a4612', 'opacity="0.55"'), path(lt, '#fff4c0', 'opacity="0.5"'));
  P.add(`<g clip-path="${P.clip('<path d="M100 24 C62 24 46 52 46 88 C46 122 40 152 26 190 C44 198 66 194 80 180 C74 156 70 132 70 108 L130 108 C130 132 126 156 120 180 C134 194 156 198 174 190 C160 152 154 122 154 88 C154 52 138 24 100 24Z"/>')}">`);
  strands(P, 70, 31, (r, i) => {
    const sgn = i % 2 ? 1 : -1;
    const x0 = 100 + sgn * (40 + r() * 16);
    const x1 = 100 + sgn * (30 + r() * 66);
    return [[x0, 50 + r() * 30], [x0 + sgn * 6, 100], [x1 - sgn * 4, 150], [x1, 196]];
  }, '#fff0b0', '#5a3a0e', 1.8);
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, '#000', 0], [0.5, '#000', 0.1], [1, '#2a0a3a', 0.55]])}"/></g>`);
  // pescoço largo com pomo de adão e sombra do queixo
  const skin = '#e0a47a';
  P.add(path('M79 118 L77 162 Q100 172 123 162 L121 118Z', P.lin([[0, '#b06a48'], [0.5, '#d89670'], [1, '#a05c3c']], 0, 0, 1, 0), ink(1.4)));
  P.add(path('M79 124 C88 148 112 148 121 124 L121 144 C110 154 90 154 79 144Z', '#3a1808', 'opacity="0.35"'));
  P.add(`<ellipse cx="100" cy="153" rx="4" ry="5.5" fill="#e8b08a" opacity="0.8"/>`, line('M97 158 C99 160 101 160 103 158', '#7a3a22', 1, 0.5));
  P.add(symLine('M86 140 C90 150 94 158 97 166', '#7a3a22', 1.3, 0.35));
  // jaqueta de couro com gola levantada, zíper e pespontos; camiseta branca e corrente
  leatherJacket(P, '#1c1a22', '#e8e4dc', { collar: false, rimL: '#ff4fd0', rimR: '#4ae8ff' });
  const collar = P.lin([[0, '#6a6674'], [0.35, '#2a2830'], [1, '#08080a']], 0, 0, 1, 1);
  P.add(sym('M80 144 L58 148 L48 176 L62 190 L86 160Z', collar, ink(1.6)));
  P.add(symLine('M76 150 L60 153 L52 175', '#fff', 1.4, 0.3));
  const stitch = 'M79 148 L62 151 L54 174 L64 184';
  P.add(`<path d="${stitch}" fill="none" stroke="#8a8694" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.8"/><path d="${mx(stitch)}" fill="none" stroke="#8a8694" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.8"/>`);
  P.add(`<path d="M84 162 C86 176 89 188 92 200" fill="none" stroke="#c8ccd4" stroke-width="2.2" stroke-dasharray="1.2 1.4"/>`);
  P.add(symLine('M14 196 C20 184 30 176 44 172', '#fff', 3, 0.18));
  P.add(`<g fill="${P.rad([[0, '#ffffff'], [1, '#6a7080']])}" ${ink(0.6)}><circle cx="34" cy="186" r="2.2"/><circle cx="166" cy="186" r="2.2"/></g>`);
  P.add(line('M86 150 C90 168 110 168 114 150', '#8a8e98', 2.4), `<path d="M86 150 C90 168 110 168 114 150" fill="none" stroke="#f0f2f6" stroke-width="1.4" stroke-dasharray="1.6 1.2"/>`);
  P.add(path('M96 165 L104 165 L100 177Z', P.lin([[0, '#ffffff'], [1, '#8a92a0']]), ink(0.8)));
  // mechas laterais atrás das orelhas
  P.add(sym('M62 66 C54 84 54 104 50 126 C46 146 40 162 32 178 C48 172 56 158 59 140 C61 120 61 100 65 84Z', hair, ink(1.6)));
  P.add(symLine('M58 90 C56 112 52 136 42 164', '#fff4c0', 1.1, 0.6), symLine('M61 96 C60 120 57 142 50 160', '#7a5214', 1, 0.6));
  // orelhas
  P.add(sym('M65 86 C57 82 54 94 56 102 C58 110 62 112 67 108Z', P.lin([[0, '#a45e3e'], [1, skin]]), ink(1.4)));
  P.add(symLine('M62 92 C59 96 60 102 63 104', '#7a3a22', 1, 0.6));
  // rosto masculino: têmporas largas, maçãs marcadas, mandíbula quadrada e queixo largo
  const face = 'M100 40 C122 40 136 54 137 78 C138 94 137 106 134 116 C131 126 127 132 120 138 C114 143 107 145 100 145 C93 145 86 143 80 138 C73 132 69 126 66 116 C63 106 62 94 63 78 C64 54 78 40 100 40Z';
  const sc = skinFill(P, face, skin);
  P.add(`<g clip-path="${sc}">`);
  sculpt(P, skin, { eyeY: 92, dx: 16, noseY: 114, mouthY: 127, chin: 141 });
  P.add(`<ellipse cx="84" cy="91" rx="14" ry="7" fill="#6a3420" opacity="0.3"/><ellipse cx="116" cy="91" rx="14" ry="7" fill="#6a3420" opacity="0.34"/>`);
  P.add(`<ellipse cx="78" cy="103" rx="9" ry="4" fill="#fff" opacity="0.16" transform="rotate(-22 78 103)"/><ellipse cx="122" cy="103" rx="8" ry="3.5" fill="#fff" opacity="0.1" transform="rotate(22 122 103)"/>`);
  P.add(symLine('M68 107 C74 117 80 123 87 127', '#6a3420', 5, 0.2));
  P.add(line('M64 80 C63 96 64 108 68 118', '#ff7ae0', 3, 0.35), line('M136 80 C137 96 136 108 132 118', '#6af0ff', 3, 0.3));
  // barba por fazer: sombra na mandíbula e no buço e fios curtos
  P.add(path('M65 110 C70 128 84 145 100 145 C116 145 130 128 135 110 C128 119 120 122 113 120 C108 117 92 117 87 120 C80 122 72 119 65 110Z', '#4a3424', 'opacity="0.3"'));
  P.add(path('M84 121 C90 115 110 115 116 121 L114 124 C108 120 92 120 86 124Z', '#4a3424', 'opacity="0.35"'));
  const rb = rng(23);
  let stub = '';
  for (let i = 0; i < 700; i++) {
    const x = 64 + rb() * 72;
    const y = 112 + rb() * 34;
    const hw = 35 - (y - 112) * 0.78;
    if (Math.abs(x - 100) > hw) continue;
    if (y < 121 && Math.abs(x - 100) < 20 - (121 - y) * 1.5) continue;
    if (y > 123.5 && y < 131 && Math.abs(x - 100) < 14) continue;
    stub += `M${x.toFixed(1)} ${y.toFixed(1)} h0.8 v0.8 h-0.8Z`;
  }
  P.add(path(stub, '#3a2414', 'opacity="0.6"'));
  P.add(line('M100 138 L100 142.5', '#5a2c18', 1.3, 0.55));
  P.add('</g>');
  // sobrancelhas grossas e retas, olhar semicerrado e confiante
  const brow: Pt[] = [[96, 84.5], [88, 81.5], [78, 80.5], [67, 83.5]];
  P.add(path(taper(brow, 5.6, 2.4), '#8a5e1e', ink(0.6)), path(taper(mirPts(brow), 5.6, 2.4), '#8a5e1e', ink(0.6)));
  P.add(eyes(P, 92, 16, 8.6, 3.6, '#3a86d8', { tilt: -2, lid: 0.55 }));
  P.add(symLine('M77 96.5 C81 98 87 98 91 96', '#6a3a22', 1, 0.55), symLine('M65 89 L61 87.5 M65.5 92.5 L61.5 92.5', '#7a4028', 0.8, 0.5));
  // nariz reto e forte
  P.add(path('M103 88 C105 99 108 108 110 114 C107 116 104 116 101 115Z', '#7a3a22', 'opacity="0.35"'));
  P.add(line('M98 90 C97 98 97 104 98 110', '#fff', 1.6, 0.25), `<ellipse cx="99" cy="112" rx="3.4" ry="2.4" fill="#fff" opacity="0.28"/>`);
  P.add(line('M92 113 C88.5 116 89.5 119.5 94 119.5 M108 113 C111.5 116 110.5 119.5 106 119.5', INK, 1.3));
  P.add(path('M94 118.5 C97 121 103 121 106 118.5 C104 123 96 123 94 118.5Z', '#5a2818', 'opacity="0.4"'));
  // boca fechada com meio sorriso de canto e sulcos nasolabiais
  P.add(line('M88 114 C84 119 83 124 84.5 128', '#7a3a22', 1.2, 0.45), line('M112 114 C117 118 118.5 122 118 126', '#7a3a22', 1.2, 0.45));
  P.add(path('M86 127 C92 124.5 97 125 100 126 C103 125 108 124 115 123.5 C109 127.5 104 128.5 100 128.5 C95 128.5 90 128 86 127Z', '#a45a44', ink(0.7)));
  P.add(line('M85 127 C92 128.8 106 128.8 116.5 123', INK, 1.9), line('M117 122.5 C119 121.5 120 119.5 119.5 117.5', INK, 1, 0.6));
  P.add(line('M92 131.5 C97 133.5 104 133.5 109 131', '#f4b896', 1.6, 0.6), line('M93 134.5 C98 136 103 136 107 134.5', '#5a2818', 1.3, 0.35));
  // topo do cabelo e mechas sobre a testa
  P.add(path('M60 70 C56 42 76 22 100 22 C124 22 144 42 140 70 C128 58 114 54 100 54 C86 54 72 58 60 70Z', hair, ink(2)));
  P.add(`<g clip-path="${P.clip('<path d="M60 70 C56 42 76 22 100 22 C124 22 144 42 140 70 C128 58 114 54 100 54 C86 54 72 58 60 70Z"/>')}">`);
  strands(P, 40, 37, (r) => {
    const x = 60 + r() * 80;
    return [[100 + (x - 100) * 0.2, 22], [x - 4, 30], [x, 44], [x + (x - 100) * 0.3, 70]];
  }, '#fff8d0', '#7a5214', 1.6);
  P.add('</g>');
  // bandana preta estampada com nó
  const band = 'M58 64 C70 46 130 46 142 64 L142 76 C130 60 70 60 58 76Z';
  P.add(path(band, P.lin([[0, '#4a4a56'], [0.45, '#1a1a22'], [1, '#050508']]), ink(2)));
  let dots = '';
  for (let i = 0; i < 9; i++) {
    const x = 68 + i * 8;
    const y = 60 - Math.sin((i / 8) * Math.PI) * 6;
    dots += i % 2 ? `M${x} ${y - 3} L${x + 2} ${y} L${x} ${y + 3} L${x - 2} ${y}Z` : `M${x - 1.6} ${y} a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0Z`;
    dots += `M${x + 4} ${y + 4.5} h1.2 v1.2 h-1.2Z M${x + 4} ${y - 5} h1.2 v1.2 h-1.2Z`;
  }
  P.add(path(dots, '#f4f0e8', 'opacity="0.85"'));
  P.add(line('M64 62 C76 52 124 52 136 62', '#fff', 1.2, 0.25), line('M70 70 C84 62 116 62 130 70', '#000', 1.4, 0.4));
  P.add(path('M140 66 C154 72 158 88 152 104 L145 100 C149 88 146 78 138 74Z', '#15151c', ink(1.5)), path('M140 68 C156 64 166 76 168 90 L161 90 C158 80 150 74 140 76Z', '#26262e', ink(1.5)));
  P.add(`<circle cx="142" cy="70" r="5" fill="#1a1a22" ${ink(1.5)}/>`);
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
  P.add(sym(shoulder, chrome, ink(2.2)));
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
  P.add(path(cran, chrome, ink(2.4)));
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
  P.add(path('M12 200 C14 172 38 156 70 150 L130 150 C162 156 186 172 188 200Z', suit, ink(2)));
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
  const hc = skinFill(P, head, skin, { light: '#ffcf8a' });
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
  P.add(path(stub, '#2a1a14', 'opacity="0.45"'), '</g>');
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
  P.add(sym(taper([[94, 80], [86, 76], [76, 76], [68, 79]], 5, 2.5), '#2a1a14'));
  const glass = 'M60 82 L140 82 L138 91 C136 102 118 104 110 97 L104 91 L96 91 L90 97 C82 104 64 102 62 91Z';
  P.add(path(glass, P.lin([[0, '#2a2a3e'], [0.5, '#08080e'], [1, '#1a0a1a']]), ink(2)));
  P.add(`<g clip-path="${P.clip(`<path d="${glass}"/>`)}">${path('M60 96 L140 84 L140 89 L60 101Z', P.lin([[0, '#c04aff'], [0.5, '#ff5a8a'], [1, '#ffb050']], 0, 0, 1, 0), 'opacity="0.75"')}${line('M68 86 L80 85 M112 85 L124 84', '#fff', 1.4, 0.8)}</g>`);
  P.add(line('M60 83 L54 88 M140 83 L146 88', INK, 2.2));
  // nariz, sorriso de canto, queixo
  P.add(nose(92, 112, 6.5, skin));
  P.add(line('M86 124 C94 127 106 126 116 119', INK, 2.2), line('M116 119 C118 118 119 116 119 114', INK, 1.2, 0.7), line('M92 131 C98 133 104 133 110 130', '#f0b890', 1.4, 0.6), line('M100 136 L100 139', INK, 1.1, 0.6));
}

function tarquinn(P: Pic): void {
  // gelo e aurora
  P.add(bgRect(P.lin([[0, '#061634'], [0.5, '#0e4a7a'], [1, '#8ad0f0']])));
  const r = rng(9);
  let stars = '';
  for (let i = 0; i < 40; i++) stars += `<circle cx="${(r() * 200).toFixed(1)}" cy="${(r() * 80).toFixed(1)}" r="${(0.4 + r() * 0.7).toFixed(1)}" fill="#fff" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`;
  P.add(stars);
  P.add(path('M-10 64 C30 20 70 74 110 32 C150 -6 180 40 210 12 L210 44 C180 76 150 36 110 66 C70 104 30 56 -10 96Z', P.lin([[0, '#3affb0', 0], [0.5, '#3affb0', 0.55], [1, '#3affb0', 0]])));
  P.add(path('M-10 40 C40 10 80 50 120 16 C150 -6 180 20 210 0 L210 16 C180 36 150 16 120 34 C80 66 40 28 -10 56Z', P.lin([[0, '#8a6aff', 0], [0.5, '#6adcff', 0.4], [1, '#8a6aff', 0]])));
  P.add(path('M0 160 L22 124 L40 138 L68 108 L96 140 L130 112 L160 132 L182 110 L200 126 L200 170 L0 170Z', P.lin([[0, '#dff4ff'], [1, '#5a9ac8']])));
  const ice = P.lin([[0, '#f4fcff'], [0.5, '#9ad4f4'], [1, '#2a6aa0']], 0, 0, 1, 1);
  P.add(sym('M0 200 L0 110 L12 94 L20 128 L32 86 L44 140 L58 200Z', ice, ink(1.2)));
  P.add(symLine('M12 94 L16 150 M32 86 L34 160 M20 128 L10 170', '#fff', 1, 0.7));
  P.figure('#9af4ff', '#7affc8', '#6ab0e0');
  // ombros de cristal
  const body = 'M8 200 C12 176 34 160 66 154 L134 154 C166 160 188 176 192 200Z';
  P.add(path(body, P.lin([[0, '#e8f8ff'], [0.4, '#8ac8ec'], [1, '#1a4a7a']], 0.3, 0, 0.6, 1), ink(2)));
  const facets = ['M20 176 L40 162 L52 180 L30 196Z', 'M40 162 L66 156 L62 178 L52 180Z', 'M52 180 L62 178 L70 200 L44 200Z', 'M10 196 L30 196 L34 200 L8 200Z'];
  for (const [i, f] of facets.entries()) P.add(sym(f, i % 2 ? '#ffffff' : '#0a3a6a', `opacity="${i % 2 ? 0.35 : 0.25}"`));
  // pescoço e gola alta de cristal
  P.add(path('M86 124 L86 158 L100 176 L114 158 L114 124Z', P.lin([[0, '#6a88b0'], [1, '#aac4e0']])));
  P.add(sym('M86 142 L64 120 L58 160 L92 184Z', P.lin([[0, '#ffffff'], [0.5, '#a8def8'], [1, '#3a7ab0']], 0, 0, 1, 1), ink(1.6)));
  P.add(sym('M64 120 L72 150 L58 160Z', '#fff', 'opacity="0.45"'), sym('M72 150 L92 184 L86 142Z', '#0a3a6a', 'opacity="0.25"'));
  P.add(line('M92 184 L100 196 L108 184', INK, 1.4));
  // orelhas pontudas longas
  const skin = '#bcd8f0';
  P.add(sym('M66 84 C50 74 30 56 10 36 C22 60 40 84 56 102 C60 106 64 106 67 100Z', P.lin([[0, '#6a88b0'], [1, '#d8e8f8']], 0, 0, 1, 0), ink(1.8)));
  P.add(sym('M62 88 C48 78 34 64 22 50 C32 66 44 82 58 96Z', '#5a78a0', 'opacity="0.6"'));
  // cabeça alongada careca
  const head = 'M100 20 C132 20 142 46 140 74 C138 96 132 112 122 126 C114 136 106 142 100 142 C94 142 86 136 78 126 C68 112 62 96 60 74 C58 46 68 20 100 20Z';
  const hc = skinFill(P, head, skin, { light: '#f6fbff', rim: '#9af4ff' });
  P.add(`<g clip-path="${hc}">`);
  sculpt(P, skin, { eyeY: 92, dx: 16, noseY: 114, mouthY: 127, chin: 140, cool: true, warm: '#8a7aff' });
  P.add(`<ellipse cx="86" cy="36" rx="18" ry="10" fill="#fff" opacity="0.4" transform="rotate(-20 86 36)"/>`);
  P.add(symLine('M72 108 C78 118 84 124 90 128', '#3a5a88', 4, 0.2), symLine('M84 30 C82 44 84 56 88 64', '#5a7aa8', 1.2, 0.35));
  P.add('</g>');
  // sobrancelhas finas, olhos claros
  P.add(symLine('M92 84 C86 79 78 79 70 83', '#5a78a0', 1.8, 0.9));
  P.add(`<ellipse cx="84" cy="92" rx="14" ry="8" fill="#7ae8ff" opacity="0.15"/><ellipse cx="116" cy="92" rx="14" ry="8" fill="#7ae8ff" opacity="0.15"/>`);
  P.add(eyes(P, 92, 16, 10, 4.6, '#9aeaff', { tilt: 10, irisR: 4, pupil: '#12304a', lid: 0.2 }));
  P.add(symLine('M76 98 C80 100 86 100 90 98', '#4a6a98', 0.9, 0.6));
  // nariz fino e sorriso sutil
  P.add(line('M101 92 C104 102 104 110 106 114', '#5a7aa8', 1.4, 0.7), line('M95 116 C98 118 102 118 106 115', INK, 1.3, 0.8));
  P.add(line('M88 127 C96 131 106 130 114 124', '#2a3a5a', 1.8), line('M92 133 C98 135 104 134 108 132', '#fff', 1.2, 0.5));
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
  P.add(path(fur, P.lin([[0, '#a07048'], [0.4, '#6a4424'], [1, '#2a180a']]), ink(1.8)));
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
  P.add(path(dome, steel, ink(2.2)));
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
  P.add(sym('M64 86 C72 76 88 76 96 84 C88 84 76 86 66 92Z', redH, ink(1.2)));
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
  P.add(line(dk, '#6a2008', 1.4, 0.6), line(lt, '#ffb070', 1.2, 0.5));
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

// ---------------------------------------------------------------- rivais (montador de peças)

type Head = 'human' | 'brute' | 'long' | 'skull' | 'robot' | 'cat';
type Eyes = 'shades' | 'visor' | 'angry' | 'glow' | 'cat' | 'goggles';
type Mouth = 'grin' | 'smirk' | 'fangs' | 'snarl' | 'grill' | 'skull';
type Hair = 'none' | 'mullet' | 'mohawk' | 'spikes' | 'long' | 'crest';
type Extra = 'horns' | 'viking' | 'beard' | 'scar' | 'earring' | 'antenna' | 'bolts' | 'tusks';

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
}

const FACES: Record<string, Face> = {
  rip: { head: 'human', skin: '#b8b8c0', eyes: 'angry', eyeColor: '#c02020', mouth: 'fangs', hair: 'spikes', hairColor: '#f0f0f0', extras: ['scar'], jacket: '#3a3a40', bg: '#505060' },
  shred: { head: 'human', skin: '#a0704a', eyes: 'angry', eyeColor: '#5a3a1a', mouth: 'snarl', hair: 'spikes', hairColor: '#4a2a14', extras: ['earring'], jacket: '#3a2210', bg: '#8a5020' },
  viper: { head: 'long', skin: '#3ac040', eyes: 'cat', eyeColor: '#ff3020', mouth: 'fangs', hair: 'long', hairColor: '#101010', jacket: '#0a2a10', bg: '#0a5a1a' },
  grinder: { head: 'robot', skin: '#6a6f7c', eyes: 'visor', eyeColor: '#40ff80', mouth: 'grill', hair: 'none', extras: ['bolts'], jacket: '#202228', bg: '#304050' },
  ragewortt: { head: 'brute', skin: '#6a7a2a', eyes: 'glow', eyeColor: '#ff3a1a', mouth: 'snarl', hair: 'spikes', hairColor: '#2e3a12', extras: ['tusks'], jacket: '#2a2a10', bg: '#4a3a10' },
  roadkill: { head: 'human', skin: '#a8b080', eyes: 'goggles', eyeColor: '#80e0ff', mouth: 'grin', hair: 'mohawk', hairColor: '#5cff3a', extras: ['scar'], jacket: '#4a3a14', bg: '#7a5a20' },
  butcher: { head: 'skull', skin: '#d8e8f0', eyes: 'glow', eyeColor: '#40e0ff', mouth: 'skull', hair: 'none', extras: ['horns'], jacket: '#10202a', bg: '#104a7a' },
  slash: { head: 'brute', skin: '#b02010', eyes: 'glow', eyeColor: '#ffe020', mouth: 'fangs', hair: 'long', hairColor: '#0a0a0a', extras: ['horns'], jacket: '#1a0606', bg: '#6a0a06' },
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
    skin: pick(['#e8b48a', '#7aa04a', '#9aa6b8', '#c08060', '#a070c0'], 3),
    eyes: pick<Eyes>(['angry', 'shades', 'glow', 'goggles'], 6),
    eyeColor: pick(['#ff3020', '#40e0ff', '#ffe020'], 9),
    mouth: pick<Mouth>(['grin', 'snarl', 'fangs', 'smirk'], 11),
    hair: pick<Hair>(['mohawk', 'spikes', 'none', 'long'], 14),
    hairColor: pick(['#e0301a', '#f2d060', '#101010', '#5cff3a'], 17),
    jacket: '#202020',
    bg: pick(['#6a1010', '#1f4fa0', '#3a5a1a', '#6a2a8a'], 20),
  };
}

function headShape(h: Head): string {
  switch (h) {
    case 'brute':
      return facePath(40, 41, 32, 146);
    case 'long':
      return 'M100 34 C126 34 138 52 138 76 C138 92 136 104 134 112 C134 128 118 142 100 142 C82 142 66 128 66 112 C64 104 62 92 62 76 C62 52 74 34 100 34Z';
    case 'skull':
      return 'M100 26 C130 26 146 48 146 78 C146 94 140 104 132 110 L128 132 C120 140 110 144 100 144 C90 144 80 140 72 132 L68 110 C60 104 54 94 54 78 C54 48 70 26 100 26Z';
    case 'robot':
      return 'M70 32 L130 32 C140 32 144 38 144 48 L142 118 C142 134 128 142 116 142 L84 142 C72 142 58 134 58 118 L56 48 C56 38 60 32 70 32Z';
    case 'cat':
      return facePath(46, 40, 26, 140);
    default:
      return facePath(42, 35, 25, 140);
  }
}

function rival(P: Pic, f: Face, seed: number): void {
  const hairC = f.hairColor ?? '#222';
  const eyeC = f.eyeColor ?? '#ff3020';
  const ex = new Set(f.extras ?? []);
  const metal = f.head === 'robot' || f.head === 'skull';
  // fundo: brilho da cor do piloto, riscos de velocidade e brasas
  P.add(bgRect(P.rad([[0, shade(f.bg, 1.55)], [0.5, f.bg], [1, shade(f.bg, 0.22)]], 0.5, 0.38, 0.75)));
  const r = rng(seed);
  let streak = '';
  for (let i = 0; i < 14; i++) {
    const y = r() * 200;
    streak += `M${(-10 + r() * 60).toFixed(1)} ${y.toFixed(1)} L${(140 + r() * 80).toFixed(1)} ${(y - 50 - r() * 30).toFixed(1)}`;
  }
  P.add(line(streak, '#fff', 1, 0.12));
  let emb = '';
  for (let i = 0; i < 26; i++) emb += `<circle cx="${(r() * 200).toFixed(1)}" cy="${(90 + r() * 110).toFixed(1)}" r="${(0.6 + r() * 1.4).toFixed(1)}" fill="${r() < 0.5 ? '#ffb040' : '#ff5a1a'}" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
  P.add(`<ellipse cx="100" cy="210" rx="130" ry="60" fill="${P.rad([[0, '#ff7a1a', 0.55], [1, '#ff3a0a', 0]])}"/>`, emb);
  P.figure(shade(f.bg, 1.9), '#ffb040', shade(f.bg, 1.2));
  // cabelo de trás
  const hairG = P.lin([[0, shade(hairC, 1.6)], [0.4, hairC], [1, shade(hairC, 0.4)]]);
  if (f.hair === 'long' || f.hair === 'mullet') {
    P.add(path(f.hair === 'long' ? 'M100 22 C60 22 46 50 46 86 C46 120 38 150 28 186 L76 184 C70 160 68 130 70 104 L130 104 C132 130 130 160 124 184 L172 186 C162 150 154 120 154 86 C154 50 140 22 100 22Z' : 'M100 26 C66 26 54 50 56 84 C56 110 58 140 64 160 L136 160 C142 140 144 110 144 84 C146 50 134 26 100 26Z', hairG, ink(2)));
    P.add(symLine('M56 80 C54 110 48 144 38 180', shade(hairC, 2.2), 1.2, 0.4));
  }
  // chifres atrás
  if (ex.has('horns')) {
    const hp: Pt[] = [[70, 50], [48, 44], [34, 24], [44, 2]];
    const hg = P.lin([[0, '#fff4e0'], [0.5, '#c8b890'], [1, '#5a4a30']], 0, 0, 1, 0);
    P.add(path(taper(hp, 16, 2, 18), hg, ink(2)), path(taper(mirPts(hp), 16, 2, 18), hg, ink(2)));
  }
  // corpo: pescoço, jaqueta, ombreiras
  P.add(path('M84 124 L84 156 Q100 166 116 156 L116 124Z', metal ? '#2a2e38' : P.lin([[0, shade(f.skin, 0.5)], [1, shade(f.skin, 0.8)]])));
  if (metal) P.add(line('M92 130 L90 160 M100 130 L100 164 M108 130 L110 160', '#0a0a0a', 3));
  leatherJacket(P, f.jacket, shade(f.jacket, 0.6), { rimL: shade(f.bg, 1.7), rimR: shade(f.bg, 1.7) });
  const pad = P.lin([[0, '#ffffff'], [0.4, shade(f.bg, 1.45)], [1, shade(f.bg, 0.3)]], 0, 0, 0.6, 1);
  P.add(sym('M14 172 C18 156 36 148 56 150 L50 168 C38 166 26 170 18 180Z', pad, ink(1.6)));
  if (f.head === 'brute' || ex.has('tusks')) P.add(sym('M24 162 L20 142 L32 158Z M38 154 L38 134 L46 152Z', pad, ink(1.2)));
  // orelhas
  if (f.head === 'human' || f.head === 'brute') P.add(sym('M66 84 C57 80 54 92 56 100 C58 108 62 110 67 106Z', P.lin([[0, shade(f.skin, 0.6)], [1, f.skin]]), ink(1.5)));
  if (f.head === 'long') P.add(sym('M64 76 C50 70 40 60 34 48 C40 66 50 80 62 92Z', P.lin([[0, shade(f.skin, 0.6)], [1, f.skin]]), ink(1.5)));
  // cabeça
  const hd = headShape(f.head);
  const hc = skinFill(P, hd, f.skin, metal ? { light: '#ffffff' } : {});
  P.add(`<g clip-path="${hc}">`);
  if (f.head === 'long') {
    let sc = '';
    for (let y = 40; y < 90; y += 7) for (let x = 70 + ((y / 7) % 2) * 3.5; x < 132; x += 7) sc += `M${x} ${y} C${x + 2} ${y + 4} ${x + 5} ${y + 4} ${x + 7} ${y}`;
    P.add(line(sc, shade(f.skin, 0.5), 0.9, 0.5));
  }
  if (!metal) sculpt(P, f.skin, { eyeY: 91, dx: 18, noseY: 113, mouthY: 125, chin: 140, cool: f.head === 'long' || f.head === 'brute' });
  if (metal) P.add(`<ellipse cx="82" cy="44" rx="16" ry="7" fill="#fff" opacity="0.5" transform="rotate(-18 82 44)"/>`);
  if (f.head === 'robot') P.add(line('M100 32 L100 70 M60 58 L80 62 M140 58 L120 62 M58 118 L76 112 M142 118 L124 112', shade(f.skin, 0.4), 1.5));
  P.add('</g>');
  if (f.head === 'robot' || ex.has('bolts')) P.add(`<g fill="${P.rad([[0, '#fff'], [1, '#5a6070']])}" ${ink(0.8)}><circle cx="64" cy="42" r="2.6"/><circle cx="136" cy="42" r="2.6"/><circle cx="62" cy="124" r="2.6"/><circle cx="138" cy="124" r="2.6"/></g>`);
  // olhos
  switch (f.eyes) {
    case 'angry':
      P.add(eyes(P, 92, 16, 8.5, 4.4, eyeC, { tilt: -8, lid: 0.7 }));
      P.add(sym(taper([[97, 88], [88, 80], [78, 78], [66, 80]], 6, 2.5), shade(hairC === '#f0f0f0' ? '#8a8a90' : hairC, 0.8), ink(0.6)));
      break;
    case 'glow':
      P.add(sym('M64 84 C74 82 88 86 96 92 C86 100 72 100 64 84Z', '#0a0404', ink(1.4)));
      P.add(glowEye(P, 82, 91, 4.5, eyeC), glowEye(P, 118, 91, 4.5, eyeC));
      P.add(sym('M58 78 C70 74 88 80 98 90 C86 84 72 82 60 84Z', shade(f.skin, 0.45), ink(1.2)));
      break;
    case 'cat':
      P.add(eyes(P, 88, 17, 11, 5.8, eyeC, { tilt: 16, slit: true, irisR: 6.4, lid: 0.5, sclera: '#e8e070' }));
      P.add(symLine('M66 78 C74 74 86 76 94 82', shade(f.skin, 0.4), 2.4));
      break;
    case 'goggles': {
      P.add(line('M56 90 L144 90', '#3a2a1a', 7), line('M56 88 L144 88', '#6a5030', 1.2, 0.6));
      const lens = P.rad([[0, shade(eyeC, 1.5)], [0.6, shade(eyeC, 0.7)], [1, shade(eyeC, 0.25)]], 0.4, 0.35, 0.7);
      for (const cx of [82, 118]) P.add(`<circle cx="${cx}" cy="91" r="12" fill="${P.lin([[0, '#e0e4ea'], [1, '#4a5060']])}" ${ink(1.8)}/><circle cx="${cx}" cy="91" r="8.5" fill="${lens}" ${ink(1)}/><path d="M${cx - 5} ${88} C${cx - 3} ${85} ${cx} ${84} ${cx + 2} ${84}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`);
      break;
    }
    case 'visor':
      P.add(`<rect x="60" y="80" width="80" height="20" rx="9" fill="#08090c" ${ink(2)}/><rect x="56" y="76" width="88" height="28" rx="13" fill="${P.rad([[0, eyeC, 0.45], [1, eyeC, 0]])}"/><rect x="65" y="86" width="70" height="8" rx="4" fill="${P.lin([[0, shade(eyeC, 0.6)], [0.5, '#ffffff'], [1, shade(eyeC, 0.6)]], 0, 0, 1, 0)}"/><rect x="65" y="86" width="70" height="8" rx="4" fill="${eyeC}" opacity="0.6"/>`);
      break;
    case 'shades':
      P.add(path('M60 82 L140 82 L138 91 C136 102 118 104 110 97 L104 91 L96 91 L90 97 C82 104 64 102 62 91Z', P.lin([[0, '#2a2a3e'], [1, '#08080e']]), ink(2)), line('M68 86 L80 85 M112 85 L124 84', '#fff', 1.4, 0.8));
      break;
  }
  // nariz
  if (f.head === 'human' || f.head === 'brute' || f.head === 'cat') P.add(nose(96, 113, 6.5, f.skin));
  if (f.head === 'long') P.add(`<ellipse cx="94" cy="108" rx="1.6" ry="1" fill="${INK}"/><ellipse cx="106" cy="108" rx="1.6" ry="1" fill="${INK}"/>`);
  // boca
  const tth = P.lin([[0, '#fffcf0'], [1, '#c8bca0']]);
  switch (f.mouth) {
    case 'grin':
      P.add(path('M80 120 C92 132 108 132 120 120 C108 126 92 126 80 120Z', tth, ink(1.6)), line('M86 123 L86 127 M93 125 L93 129 M100 126 L100 130 M107 125 L107 129 M114 123 L114 127', INK, 0.8, 0.8), line('M78 118 C80 120 80 122 78 124 M122 118 C120 120 120 122 122 124', INK, 1.2));
      break;
    case 'smirk':
      P.add(line('M86 124 C96 127 106 126 116 119', INK, 2.2));
      break;
    case 'fangs':
      P.add(path('M78 120 C90 116 110 116 122 120 C116 134 84 134 78 120Z', P.rad([[0, '#7a1010'], [1, '#200404']]), ink(1.8)));
      P.add(path('M84 119.5 L88 131 L91 118.5Z M109 118.5 L112 131 L116 119.5Z', tth, ink(0.9)), path('M91 118.5 L109 118.5 L108 122 L92 122Z', tth, ink(0.6)));
      break;
    case 'snarl':
      P.add(path('M76 118 L124 118 L120 132 L80 132Z', '#200404', ink(1.8)));
      P.add(path('M78 119 L122 119 L121 124.5 L79 124.5Z M80 126 L120 126 L119 131 L81 131Z', tth, ink(0.8)), line('M86 119 L86 131 M93 119 L93 131 M100 119 L100 131 M107 119 L107 131 M114 119 L114 131', INK, 0.8));
      break;
    case 'grill':
      P.add(`<rect x="74" y="116" width="52" height="18" rx="3" fill="#15171c" ${ink(1.6)}/>`, line('M80 117 L80 133 M87 117 L87 133 M94 117 L94 133 M101 117 L101 133 M108 117 L108 133 M115 117 L115 133 M121 117 L121 133', '#8a92a0', 1.8));
      break;
    case 'skull':
      P.add(path('M100 98 L93 112 C96 114 98 112 100 110 C102 112 104 114 107 112Z', '#0a0406', ink(1.2)));
      P.add(`<rect x="78" y="118" width="44" height="16" rx="2" fill="#0a0406"/>`);
      let t = '';
      for (let i = 0; i < 8; i++) t += `M${79 + i * 5.3} 119 h4.4 v6.5 c-1 1.5 -3.4 1.5 -4.4 0Z M${79 + i * 5.3} 133 h4.4 v-5.5 c-1 -1.5 -3.4 -1.5 -4.4 0Z`;
      P.add(path(t, tth, ink(0.7)));
      break;
  }
  if (ex.has('tusks')) P.add(sym('M80 126 C74 118 72 106 76 98 C78 108 82 116 86 122Z', P.lin([[0, '#fffcf0'], [1, '#b8a880']]), ink(1.4)));
  if (ex.has('scar')) P.add(line('M122 74 L132 110', '#7a1010', 3), line('M123 82 L130 79 M125 90 L132 87 M127 98 L134 95 M129 104 L135 102', '#7a1010', 1.5));
  if (ex.has('earring')) P.add(`<circle cx="57" cy="110" r="4.2" fill="none" stroke="#ffd84a" stroke-width="2"/>`);
  // cabelo da frente
  if (f.hair === 'spikes') {
    let sp = '';
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (1.08 + (0.84 * i) / (n - 1));
      const bx = 100 + Math.cos(a) * 36;
      const by = 66 + Math.sin(a) * 30;
      const tx = 100 + Math.cos(a) * 66;
      const ty = 66 + Math.sin(a) * 62;
      const px = -Math.sin(a) * 9;
      const py = Math.cos(a) * 9;
      sp += `M${(bx - px).toFixed(1)} ${(by - py).toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)} L${(bx + px).toFixed(1)} ${(by + py).toFixed(1)}Z`;
    }
    P.add(path(sp, hairG, ink(1.8)));
    P.add(path('M62 76 C60 50 76 36 100 36 C124 36 140 50 138 76 C130 62 118 58 108 64 C100 54 88 58 84 64 C76 60 66 66 62 76Z', hairG, ink(1.8)));
  }
  if (f.hair === 'mohawk') {
    let sp = '';
    for (let i = 0; i < 5; i++) {
      const bx = 88 + i * 6;
      sp += `M${bx - 6} 50 L${76 + i * 12} ${10 + Math.abs(i - 2) * 8} L${bx + 6} 50Z`;
    }
    P.add(path(sp, P.lin([[0, shade(hairC, 1.6)], [1, shade(hairC, 0.5)]]), ink(1.6)));
  }
  if (f.hair === 'long' || f.hair === 'mullet') P.add(path('M60 76 C56 44 76 28 100 28 C124 28 144 44 140 76 C132 60 118 54 106 58 C96 50 80 56 74 64 C70 66 64 70 60 76Z', hairG, ink(1.8)));
  if (f.hair === 'crest') P.add(path('M92 38 L84 8 L98 26 L102 2 L108 26 L120 10 L110 38Z', hairG, ink(1.6)));
  if (ex.has('antenna')) P.add(line('M126 34 L140 10', INK, 2.5), glowEye(P, 140, 10, 3.5, eyeC));
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

/** SVG do retrato (string pronta para innerHTML). */
export function portraitSvg(nameOrId: string, size = 96): string {
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
    `<feOffset in="SourceAlpha" dx="${dx}" dy="1.5" result="${tag}o"/><feComposite in="SourceAlpha" in2="${tag}o" operator="out" result="${tag}e"/><feGaussianBlur in="${tag}e" stdDeviation="0.9" result="${tag}b"/><feFlood flood-color="${color}" flood-opacity="0.95"/><feComposite in2="${tag}b" operator="in" result="${tag}"/>`;
  P.defs.push(
    `<filter id="${fx}bg" ${U}><feGaussianBlur stdDeviation="${size >= 80 ? 1.1 : 0.6}"/></filter>`,
    `<filter id="${fx}rim" ${U}>${rimPart(3.2, P.rimL, 'l')}${rimPart(-3.2, P.rimR, 'r')}<feGaussianBlur in="SourceAlpha" stdDeviation="4" result="sh"/><feOffset in="sh" dx="3" dy="4" result="sho"/><feFlood flood-color="#000" flood-opacity="0.55"/><feComposite in2="sho" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge><feBlend in2="l" mode="screen" result="m1"/><feBlend in="m1" in2="r" mode="screen"/></filter>`,
  );
  if (size >= 80) {
    // borda pintada: deslocamento leve por ruído (contornos à mão, sem aspecto de vetor)
    P.defs.push(`<filter id="${fx}p" ${U}><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="${size >= 160 ? 1.7 : 1.2}" xChannelSelector="R" yChannelSelector="G"/></filter>`);
  }
  P.add(`<g clip-path="${P.clip('<rect x="3" y="3" width="194" height="194" rx="20"/>')}">`);
  if (size >= 80) P.add(`<g filter="url(#${fx}p)">`);
  P.add(`<g filter="url(#${fx}bg)">`, ...scene.slice(0, s), '</g>');
  P.add(`<rect width="200" height="200" fill="${P.lin([[0, P.fog, 0.04], [0.6, P.fog, 0.22], [1, P.fog, 0.08]])}"/>`);
  P.add(`<g filter="url(#${fx}rim)">`, ...scene.slice(s), '</g>');
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
