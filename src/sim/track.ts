import { clamp, forwardX, forwardZ, leftX, leftZ, smoothstep, wrapAngle } from './math';

/**
 * Pistas são sequências de peças em uma grade (como os blocos isométricos do original: as 36
 * pistas de 1993 ficam numa grade de 8x8 casas; cada casa é uma peça).
 *
 *  F  largada/chegada (reta)      S  reta
 *  L  curva de 90° à esquerda      R  curva de 90° à direita
 *  U  rampa subindo                D  rampa descendo
 *  J  salto (rampa de lançamento)  B  lombadas
 *  G  vão sem chão (voa-se por cima; quem cai é resgatado)
 *  X  cruzamento: reta que cruza outro trecho da mesma pista no mesmo nível
 *
 * Modificadores logo após a letra: `>` seta de warp (impulso para a frente),
 * `<` warp reverso (arremessa para trás, como em Inferno). Ex.: "S>".
 */
export type PieceCode = 'F' | 'S' | 'L' | 'R' | 'U' | 'D' | 'J' | 'B' | 'G' | 'X';

/** Piso do planeta: lama (Bogmire) e gelo (Nho) mudam a aderência. */
export type Surface = 'asphalt' | 'mud' | 'ice';

export type ThemeId = 'chem6' | 'drakonis' | 'bogmire' | 'newmojave' | 'nho' | 'inferno';

export interface TrackDef {
  id: string;
  name: string;
  planet: string;
  theme: ThemeId;
  laps: number;
  /** Peças separadas por espaço, ex.: "F S S R S L ..." */
  layout: string;
  /** poças de gosma (deixam o carro lento), espalhadas pelas retas */
  slime?: number;
  /** ordem da pista no planeta (1 = primeira), como no original */
  order?: number;
  /** piso; se omitido, vem do planeta (ver SURFACE_OF_THEME) */
  surface?: Surface;
}

export const SURFACE_OF_THEME: Record<ThemeId, Surface> = {
  chem6: 'asphalt',
  drakonis: 'asphalt',
  bogmire: 'mud',
  newmojave: 'asphalt',
  nho: 'ice',
  inferno: 'asphalt',
};

/**
 * Efeito do piso por carro: multiplicador de aderência e arrasto extra.
 * Como no original, esteiras (Battle Trak) não ligam para lama e o aerodeslizador (Havac)
 * não liga para lama nem gelo.
 */
export function surfaceEffect(surface: Surface, vehicleId: string): { grip: number; drag: number } {
  if (surface === 'asphalt' || vehicleId === 'havac') return { grip: 1, drag: 0 };
  if (surface === 'mud') return vehicleId === 'battletrak' ? { grip: 1, drag: 0 } : { grip: 0.8, drag: 0.08 };
  return vehicleId === 'battletrak' ? { grip: 0.85, drag: 0 } : { grip: 0.6, drag: 0 };
}

/**
 * Vão (G): quem chega abaixo desta velocidade (m/s) cai no abismo; acima dela o carro vence o
 * vão (voando pela rampa J ou, no limite, "raspando" a borda). Um voo balístico puro não serve
 * para carros de 30 a 50 m/s ao mesmo tempo: ou os lentos caem sempre, ou os rápidos passam
 * direto da reta de pouso.
 */
export const GAP_MIN_SPEED = 22;

/** Aceleração (m/s²) de uma seta de warp, na direção da pista. */
export const WARP_ACCEL = 70;
/**
 * Desaceleração do warp reverso. Menor que a aceleração de qualquer carro: freia forte
 * (perde-se ~1 s), mas nunca prende o carro. Ocupa só metade da pista (dá para desviar).
 */
export const WARP_REVERSE_ACCEL = 24;

/** Lado da pista ocupado por um warp reverso na peça i (+1 esquerda, -1 direita). */
export function reverseWarpSide(i: number): 1 | -1 {
  return i % 2 === 0 ? 1 : -1;
}

/** tamanho da casa (m): 20 dá corridas de ~1 a 1,5 min com 4 voltas nas pistas originais */
export const TILE = 20;
/** meia-largura da pista: 11 m, cabem ~5 carros lado a lado (disputa de posição, como no Motor Rock) */
export const HALF_WIDTH = 5.5;
export const RAMP_HEIGHT = 3;
export const JUMP_HEIGHT = 2.5;
const ARC_RADIUS = TILE / 2;

export interface Piece {
  index: number;
  code: PieceCode;
  /** 0 = reta, +1 = curva à esquerda, -1 = curva à direita */
  turn: 0 | 1 | -1;
  x0: number;
  z0: number;
  heading0: number;
  h0: number;
  dh: number;
  length: number;
  startDist: number;
  cx: number;
  cz: number;
  /** +1 seta de warp, -1 warp reverso, 0 nada */
  warp: number;
}

export interface TrackSample {
  pieceIndex: number;
  /** distância percorrida dentro da peça */
  s: number;
  /** deslocamento lateral em relação à linha central (positivo = esquerda) */
  lateral: number;
  /** distância total desde a linha de chegada */
  dist: number;
  /** direção da pista neste ponto */
  heading: number;
  height: number;
  /** quanto o ponto está fora do comprimento da peça (0 = dentro) */
  outside: number;
  /** vão sem chão (peça G): o carro só passa voando */
  void: boolean;
  /** seta de warp sob o ponto: +1 impulso para a frente, -1 reverso, 0 nada */
  warp: number;
  surface: Surface;
}

export interface CenterPoint {
  x: number;
  z: number;
  h: number;
  heading: number;
  dist: number;
  pieceIndex: number;
}

export function parseLayout(layout: string): PieceCode[] {
  return parsePieces(layout).map((p) => p.code);
}

/** Lê as peças com seus modificadores (`>` warp, `<` warp reverso). */
export function parsePieces(layout: string): { code: PieceCode; warp: number }[] {
  return layout
    .trim()
    .split(/\s+/)
    .map((t) => {
      if (!/^[FSLRUDJBGX][<>]?$/.test(t)) throw new Error(`Peça de pista inválida: "${t}"`);
      return { code: t[0] as PieceCode, warp: t[1] === '>' ? 1 : t[1] === '<' ? -1 : 0 };
    });
}

function profile(code: PieceCode, t: number): number {
  switch (code) {
    case 'U':
      return RAMP_HEIGHT * smoothstep(t);
    case 'D':
      return -RAMP_HEIGHT * smoothstep(t);
    case 'J':
      // rampa de lançamento reta e depois uma queda abrupta: o carro decola
      if (t < 0.3) return 0;
      if (t < 0.75) return JUMP_HEIGHT * ((t - 0.3) / 0.45);
      if (t < 0.8) return JUMP_HEIGHT * (1 - (t - 0.75) / 0.05);
      return 0;
    case 'B': {
      const b = Math.sin(Math.PI * t * 3);
      return 0.45 * b * b;
    }
    default:
      return 0;
  }
}

export class Track {
  readonly def: TrackDef;
  readonly pieces: Piece[];
  readonly totalLength: number;
  readonly halfWidth = HALF_WIDTH;
  readonly surface: Surface;
  /** erro de fechamento do circuito (posição, direção, altura) — deve ser ~0 */
  readonly closure: { dx: number; dz: number; dHeading: number; dh: number };

  constructor(def: TrackDef) {
    this.def = def;
    const parsed = parsePieces(def.layout);
    this.surface = def.surface ?? SURFACE_OF_THEME[def.theme] ?? 'asphalt';
    const pieces: Piece[] = [];
    let x = 0;
    let z = 0;
    let heading = 0;
    let h = 0;
    let dist = 0;
    parsed.forEach(({ code, warp }, index) => {
      const turn: 0 | 1 | -1 = code === 'L' ? 1 : code === 'R' ? -1 : 0;
      const length = turn === 0 ? TILE : (Math.PI / 2) * ARC_RADIUS;
      const dh = code === 'U' ? RAMP_HEIGHT : code === 'D' ? -RAMP_HEIGHT : 0;
      const cx = x + turn * leftX(heading) * ARC_RADIUS;
      const cz = z + turn * leftZ(heading) * ARC_RADIUS;
      const piece: Piece = { index, code, turn, x0: x, z0: z, heading0: heading, h0: h, dh, length, startDist: dist, cx, cz, warp };
      pieces.push(piece);
      const end = this.pointOn(piece, length);
      x = end.x;
      z = end.z;
      heading = end.heading;
      h += dh;
      dist += length;
    });
    this.pieces = pieces;
    this.totalLength = dist;
    this.closure = { dx: x, dz: z, dHeading: wrapAngle(heading), dh: h };
  }

  get isClosed(): boolean {
    const c = this.closure;
    return Math.hypot(c.dx, c.dz) < 1e-6 && Math.abs(c.dHeading) < 1e-6 && Math.abs(c.dh) < 1e-6;
  }

  pointOn(p: Piece, s: number): { x: number; z: number; heading: number } {
    if (p.turn === 0) {
      return { x: p.x0 + forwardX(p.heading0) * s, z: p.z0 + forwardZ(p.heading0) * s, heading: p.heading0 };
    }
    const heading = p.heading0 + (p.turn * s) / ARC_RADIUS;
    return {
      x: p.cx - p.turn * leftX(heading) * ARC_RADIUS,
      z: p.cz - p.turn * leftZ(heading) * ARC_RADIUS,
      heading,
    };
  }

  heightOn(p: Piece, s: number): number {
    return p.h0 + profile(p.code, clamp(s / p.length, 0, 1));
  }

  /** Projeta um ponto do mundo sobre a linha central de uma peça. */
  project(p: Piece, x: number, z: number, out: { s: number; lateral: number; outside: number } = { s: 0, lateral: 0, outside: 0 }): { s: number; lateral: number; outside: number } {
    let s: number;
    let lateral: number;
    if (p.turn === 0) {
      const dx = x - p.x0;
      const dz = z - p.z0;
      s = dx * forwardX(p.heading0) + dz * forwardZ(p.heading0);
      lateral = dx * leftX(p.heading0) + dz * leftZ(p.heading0);
    } else {
      const dx = x - p.cx;
      const dz = z - p.cz;
      const r = Math.hypot(dx, dz);
      // direção do centro para o ponto é -turn*left(heading)
      const heading = p.turn === 1 ? Math.atan2(dz, -dx) : Math.atan2(-dz, dx);
      const a = wrapAngle((heading - p.heading0) * p.turn);
      s = a * ARC_RADIUS;
      lateral = p.turn * (ARC_RADIUS - r);
    }
    out.s = s;
    out.lateral = lateral;
    out.outside = s < 0 ? -s : s > p.length ? s - p.length : 0;
    return out;
  }

  /** rascunhos da consulta (evitam criar objetos a cada chamada: ~2 mil consultas por segundo) */
  private readonly prTmp = { s: 0, lateral: 0, outside: 0 };
  private readonly prBest = { s: 0, lateral: 0, outside: 0 };

  private sampleFor(p: Piece, pr: { s: number; lateral: number; outside: number }): TrackSample {
    const s = clamp(pr.s, 0, p.length);
    const t = s / p.length;
    return {
      pieceIndex: p.index,
      s,
      lateral: pr.lateral,
      dist: p.startDist + s,
      heading: this.pointOn(p, s).heading,
      height: this.heightOn(p, s),
      outside: pr.outside,
      void: p.code === 'G',
      // a seta ocupa o meio da casa
      warp: p.warp !== 0 && t > 0.3 && t < 0.7 && (p.warp > 0 || pr.lateral * reverseWarpSide(p.index) > 0) ? p.warp : 0,
      surface: this.surface,
    };
  }

  /**
   * Encontra o ponto da pista mais próximo. `hint` é a peça atual do carro:
   * procurar só nas vizinhas mantém a consulta barata e permite pontes/cruzamentos no futuro.
   */
  query(x: number, z: number, hint = -1): TrackSample {
    const n = this.pieces.length;
    let best = -1;
    let bestScore = Infinity;
    // só a peça vencedora vira amostra completa
    if (hint >= 0) {
      for (let d = -1; d <= 2; d++) {
        const i = (((hint + d) % n) + n) % n;
        const score = this.score(this.pieces[i], x, z);
        if (score < bestScore) {
          bestScore = score;
          best = i;
          Object.assign(this.prBest, this.prTmp);
        }
      }
    }
    if (best < 0 || bestScore > this.halfWidth + 3) {
      for (let i = 0; i < n; i++) {
        const score = this.score(this.pieces[i], x, z);
        if (score < bestScore) {
          bestScore = score;
          best = i;
          Object.assign(this.prBest, this.prTmp);
        }
      }
    }
    return this.sampleFor(this.pieces[best], this.prBest);
  }

  private score(p: Piece, x: number, z: number): number {
    const pr = this.project(p, x, z, this.prTmp);
    return Math.hypot(pr.outside, pr.lateral);
  }

  /** Ponto da linha central a uma distância (em metros) da linha de chegada. */
  pointAtDist(dist: number): { x: number; z: number; heading: number; h: number; pieceIndex: number } {
    const T = this.totalLength;
    const d = ((dist % T) + T) % T;
    let lo = 0;
    let hi = this.pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.pieces[mid].startDist <= d) lo = mid;
      else hi = mid - 1;
    }
    const p = this.pieces[lo];
    const s = d - p.startDist;
    const pt = this.pointOn(p, s);
    return { ...pt, h: this.heightOn(p, s), pieceIndex: p.index };
  }

  /** Amostra a linha central a cada `step` metros (usado para malha, minimapa e IA). */
  sampleCenterline(step: number): CenterPoint[] {
    const out: CenterPoint[] = [];
    for (const p of this.pieces) {
      const count = Math.max(1, Math.ceil(p.length / step));
      for (let i = 0; i < count; i++) {
        const s = (p.length * i) / count;
        const pt = this.pointOn(p, s);
        out.push({ x: pt.x, z: pt.z, h: this.heightOn(p, s), heading: pt.heading, dist: p.startDist + s, pieceIndex: p.index });
      }
    }
    return out;
  }

  /** Peça sem malha contínua própria: vão (G) ou cruzamento (X). */
  isBreak(i: number): boolean {
    const c = this.pieces[i].code;
    return c === 'G' || c === 'X';
  }

  /**
   * Trechos contínuos de pista para montar a malha (piso, muretas, paredões). Vãos (G) e
   * cruzamentos (X) interrompem o trecho: o vão não tem chão e o cruzamento ganha uma placa
   * própria (ver render/trackFeatures.ts). Sem interrupções, devolve o laço fechado
   * (último ponto = primeiro, como a malha espera).
   */
  meshRuns(step: number): CenterPoint[][] {
    const pts = this.sampleCenterline(step);
    const n = this.pieces.length;
    if (!this.pieces.some((_, i) => this.isBreak(i))) {
      pts.push({ ...pts[0], dist: this.totalLength });
      return [pts];
    }
    const byPiece: CenterPoint[][] = this.pieces.map(() => []);
    for (const q of pts) byPiece[q.pieceIndex].push(q);
    const endPoint = (pi: number, dist: number): CenterPoint => {
      const p = this.pieces[pi];
      const pt = this.pointOn(p, 0);
      return { x: pt.x, z: pt.z, h: this.heightOn(p, 0), heading: pt.heading, dist, pieceIndex: pi };
    };
    // começa logo depois de uma interrupção, para nenhum trecho ficar partido no fim da lista
    const first = this.pieces.findIndex((_, i) => this.isBreak(i) && !this.isBreak((i + 1) % n));
    const start = (first + 1) % n;
    const runs: CenterPoint[][] = [];
    let cur: CenterPoint[] = [];
    let offset = 0; // soma uma volta à distância ao passar pela largada (texturas contínuas)
    for (let k = 0; k <= n; k++) {
      const pi = (start + k) % n;
      if (k > 0 && pi === 0) offset = this.totalLength;
      if (k === n || this.isBreak(pi)) {
        if (cur.length) {
          cur.push(endPoint(pi, this.pieces[pi].startDist + offset));
          runs.push(cur);
          cur = [];
        }
        continue;
      }
      for (const q of byPiece[pi]) cur.push(offset ? { ...q, dist: q.dist + offset } : q);
    }
    return runs.filter((r) => r.length > 1);
  }

  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of this.sampleCenterline(2)) {
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z);
      b.maxZ = Math.max(b.maxZ, p.z);
    }
    return b;
  }
}
