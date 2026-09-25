import { clamp, forwardX, forwardZ, leftX, leftZ, smoothstep, wrapAngle } from './math';

/**
 * Pistas são sequências de peças em uma grade (como os blocos isométricos do original: as 36
 * pistas de 1993 ficam numa grade de 8x8 casas; cada casa é uma peça).
 *
 *  F  largada/chegada (reta)      S  reta
 *  L  curva de 90° à esquerda      R  curva de 90° à direita
 *  U  rampa subindo                D  rampa descendo
 *  J  salto (rampa de lançamento)  B  lombadas
 *  G  vão sem chão (voa-se por cima; quem cai é resgatado). `Gv`: o pouso fica um nível
 *     (RAMP_HEIGHT) abaixo da decolagem, como nos saltos do original que caem num patamar inferior
 *  X  cruzamento: reta que cruza outro trecho da mesma pista. No mesmo nível, as duas passagens
 *     dividem a placa; com pelo menos RAMP_HEIGHT de diferença vira viaduto (a de cima passa numa
 *     ponte sobre a de baixo, como nas espirais de Bogmire). O nível sai das rampas U/D do traçado.
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
  /** casas com poça fixa, transcritas do mapa original (substitui o espalhamento de `slime`) */
  puddles?: number[];
  /** ordem da pista no planeta (1 = primeira), como no original */
  order?: number;
  /** piso; se omitido, vem do planeta (ver SURFACE_OF_THEME) */
  surface?: Surface;
  /** meia-largura da pista (m); se omitida, HALF_WIDTH (as de Nho são mais largas no original) */
  halfWidth?: number;
  /**
   * Desvios (bifurcações do original: atalho de Inferno 4, laço de Bogmire 2). Cada ramo sai da
   * casa `from` do laço principal (mesma entrada) e volta na casa `to` (mesma saída), com as suas
   * próprias peças; as duas casas de junção são dividas pelas duas passagens (placa em T).
   */
  branches?: BranchDef[];
}

export interface BranchDef {
  /** casa do laço principal onde o ramo começa (a peça do ramo começa junto com ela) */
  from: number;
  /** casa do laço principal onde o ramo termina (a última peça do ramo termina junto com ela) */
  to: number;
  /** peças do ramo, de `from` a `to` inclusive */
  layout: string;
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
/** Rampa J: começa a subir em 52% da casa e o lábio fica em 97% (0,6 m antes do vão). */
export const JUMP_RAMP_START = 0.52;
export const JUMP_LIP = 0.97;
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
  /** -1 no laço principal; nos desvios, o índice do ramo em `Track.branches` */
  branch: number;
  /** metros de progresso (dist) por metro andado: 1 no laço; nos ramos, comprimento do trecho principal equivalente / do ramo */
  distScale: number;
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

/** Lê as peças com seus modificadores (`>` warp, `<` warp reverso, `v` vão com queda). */
export function parsePieces(layout: string): { code: PieceCode; warp: number; drop: boolean }[] {
  return layout
    .trim()
    .split(/\s+/)
    .map((t) => {
      if (!/^([FSLRUDJBX][<>]?|Gv?)$/.test(t)) throw new Error(`Peça de pista inválida: "${t}"`);
      return { code: t[0] as PieceCode, warp: t[1] === '>' ? 1 : t[1] === '<' ? -1 : 0, drop: t[1] === 'v' };
    });
}

function profile(code: PieceCode, t: number): number {
  switch (code) {
    case 'U':
      return RAMP_HEIGHT * smoothstep(t);
    case 'D':
      return -RAMP_HEIGHT * smoothstep(t);
    case 'J':
      // rampa de lançamento reta com o lábio colado na borda da casa (logo antes do vão, como no
      // original) e uma queda abrupta: o carro decola e só precisa vencer o vão, não 5 m de chão
      if (t < JUMP_RAMP_START) return 0;
      if (t < JUMP_LIP) return JUMP_HEIGHT * ((t - JUMP_RAMP_START) / (JUMP_LIP - JUMP_RAMP_START));
      if (t < JUMP_LIP + 0.02) return JUMP_HEIGHT * (1 - (t - JUMP_LIP) / 0.02);
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
  readonly halfWidth: number;
  readonly surface: Surface;
  /**
   * Par de cada cruzamento X (índice da outra passagem na mesma casa; -1 nas demais peças) e o
   * papel da passagem: 'flat' mesmo nível, 'over' ponte do viaduto, 'under' passagem por baixo.
   */
  readonly crossPartner: number[];
  readonly crossRole: ('none' | 'flat' | 'over' | 'under')[];
  /** erro de fechamento do circuito (posição, direção, altura) — deve ser ~0 */
  readonly closure: { dx: number; dz: number; dHeading: number; dh: number };
  /**
   * Peças do laço principal: `pieces[0..loop-1]`. As peças dos desvios vêm depois (índices a
   * partir de `loop`), na ordem de cada ramo; a distância (`dist`) delas é a do trecho principal
   * equivalente, então voltas, posições e a volta pela metade valem pelos dois caminhos.
   */
  readonly loop: number;
  readonly branches: { from: number; to: number; first: number; last: number; startDist: number; endDist: number; closure: { dx: number; dz: number; dHeading: number; dh: number } }[];
  /** peças candidatas na consulta com dica (vizinhas no caminho, incluindo as dos ramos) */
  private readonly near: number[][];
  /** ramo em uso por pointAtDist (ver withRoute); -1 = laço principal */
  private route = -1;

  constructor(def: TrackDef) {
    this.def = def;
    this.halfWidth = def.halfWidth ?? HALF_WIDTH;
    const parsed = parsePieces(def.layout);
    this.surface = def.surface ?? SURFACE_OF_THEME[def.theme] ?? 'asphalt';
    const pieces: Piece[] = [];
    let x = 0;
    let z = 0;
    let heading = 0;
    let h = 0;
    let dist = 0;
    parsed.forEach(({ code, warp, drop }, index) => {
      const turn: 0 | 1 | -1 = code === 'L' ? 1 : code === 'R' ? -1 : 0;
      const length = turn === 0 ? TILE : (Math.PI / 2) * ARC_RADIUS;
      const dh = code === 'U' ? RAMP_HEIGHT : code === 'D' || (code === 'G' && drop) ? -RAMP_HEIGHT : 0;
      const cx = x + turn * leftX(heading) * ARC_RADIUS;
      const cz = z + turn * leftZ(heading) * ARC_RADIUS;
      const piece: Piece = { index, code, turn, x0: x, z0: z, heading0: heading, h0: h, dh, length, startDist: dist, cx, cz, warp, branch: -1, distScale: 1 };
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
    const n = pieces.length;
    this.loop = n;
    this.branches = [];
    (def.branches ?? []).forEach((b, bi) => {
      if (!(b.from >= 0 && b.to > b.from && b.to < n)) throw new Error(`Desvio ${bi} inválido (${b.from}->${b.to})`);
      const a = pieces[b.from];
      const z0 = pieces[b.to];
      const startDist = a.startDist;
      const endDist = z0.startDist + z0.length;
      const bp = parsePieces(b.layout);
      const lens = bp.map((q) => (q.code === 'L' || q.code === 'R' ? (Math.PI / 2) * ARC_RADIUS : TILE));
      const scale = (endDist - startDist) / lens.reduce((u, v) => u + v, 0);
      let bx = a.x0;
      let bz = a.z0;
      let bh = a.h0;
      let bhd = a.heading0;
      let bd = startDist;
      const first = pieces.length;
      bp.forEach(({ code, warp, drop }, k) => {
        const turn: 0 | 1 | -1 = code === 'L' ? 1 : code === 'R' ? -1 : 0;
        const dh = code === 'U' ? RAMP_HEIGHT : code === 'D' || (code === 'G' && drop) ? -RAMP_HEIGHT : 0;
        const cx = bx + turn * leftX(bhd) * ARC_RADIUS;
        const cz = bz + turn * leftZ(bhd) * ARC_RADIUS;
        const piece: Piece = { index: pieces.length, code, turn, x0: bx, z0: bz, heading0: bhd, h0: bh, dh, length: lens[k], startDist: bd, cx, cz, warp, branch: bi, distScale: scale };
        pieces.push(piece);
        const end = this.pointOn(piece, piece.length);
        bx = end.x;
        bz = end.z;
        bhd = end.heading;
        bh += dh;
        bd += lens[k] * scale;
      });
      const endPt = this.pointOn(z0, z0.length);
      this.branches.push({
        from: b.from,
        to: b.to,
        first,
        last: pieces.length - 1,
        startDist,
        endDist,
        closure: { dx: bx - endPt.x, dz: bz - endPt.z, dHeading: wrapAngle(bhd - endPt.heading), dh: bh - (z0.h0 + z0.dh) },
      });
    });
    // vizinhas de cada peça no caminho (a de trás, ela, e duas à frente), mais as do outro caminho
    // nas casas de junção: é o que mantém o carro na passagem certa e deixa trocar de ramo na placa
    const near: number[][] = pieces.map((p) => (p.branch < 0 ? [-1, 0, 1, 2].map((d) => (((p.index + d) % n) + n) % n) : []));
    this.branches.forEach((b) => {
      const chain = [(b.from - 1 + n) % n, ...Array.from({ length: b.last - b.first + 1 }, (_, k) => b.first + k), (b.to + 1) % n, (b.to + 2) % n];
      for (let k = 1; k <= b.last - b.first + 1; k++) {
        const set = new Set([chain[k - 1], chain[k], chain[k + 1], chain[k + 2]]);
        if (k <= 2) set.add(b.from);
        if (k >= b.last - b.first) set.add(b.to);
        near[chain[k]] = [...set];
      }
      // do laço para o ramo: perto da saída e da chegada do desvio
      for (let d = -2; d <= 1; d++) near[(b.from + d + n) % n].push(b.first, Math.min(b.first + 1, b.last));
      for (let d = -1; d <= 1; d++) near[(b.to + d) % n].push(b.last, Math.max(b.last - 1, b.first));
    });
    this.near = near.map((l) => [...new Set(l)]);
    this.crossPartner = pieces.map(() => -1);
    this.crossRole = pieces.map(() => 'none');
    for (const a of pieces) {
      if (a.code !== 'X') continue;
      const ma = this.pointOn(a, a.length / 2);
      const b = pieces.find((o) => o !== a && o.code === 'X' && Math.hypot(this.pointOn(o, o.length / 2).x - ma.x, this.pointOn(o, o.length / 2).z - ma.z) < 1e-3);
      if (!b) continue;
      this.crossPartner[a.index] = b.index;
      const dh = a.h0 - b.h0;
      this.crossRole[a.index] = Math.abs(dh) < 1e-6 ? 'flat' : dh > 0 ? 'over' : 'under';
    }
    this.closure = { dx: x, dz: z, dHeading: wrapAngle(heading), dh: h };
  }

  get isClosed(): boolean {
    const ok = (c: { dx: number; dz: number; dHeading: number; dh: number }) => Math.hypot(c.dx, c.dz) < 1e-6 && Math.abs(c.dHeading) < 1e-6 && Math.abs(c.dh) < 1e-6;
    return ok(this.closure) && this.branches.every((b) => ok(b.closure));
  }

  /** Peça seguinte no caminho (no fim de um ramo, a casa depois da junção de chegada). */
  nextIndex(i: number): number {
    const p = this.pieces[i];
    if (p.branch < 0) return (i + 1) % this.loop;
    const b = this.branches[p.branch];
    return i < b.last ? i + 1 : (b.to + 1) % this.loop;
  }

  /** Peça anterior no caminho (no começo de um ramo, a casa antes da junção de saída). */
  prevIndex(i: number): number {
    const p = this.pieces[i];
    if (p.branch < 0) return (i - 1 + this.loop) % this.loop;
    const b = this.branches[p.branch];
    return i > b.first ? i - 1 : (b.from - 1 + this.loop) % this.loop;
  }

  /**
   * Casa de junção de um desvio: a peça do laço e a do ramo que dividem a mesma casa (placa em T).
   * Devolve a outra peça da casa, ou -1.
   */
  junctionPartner(i: number): number {
    for (const b of this.branches) {
      if (i === b.from) return b.first;
      if (i === b.first) return b.from;
      if (i === b.to) return b.last;
      if (i === b.last) return b.to;
    }
    return -1;
  }

  /**
   * Executa `fn` com pointAtDist seguindo um ramo: o do carro, se ele já está num desvio, ou o que
   * ele escolhe (`pick`) ao chegar perto de uma bifurcação. Fora disso, o laço principal.
   * A IA usa para mirar pelo caminho em que está (sem isso, miraria no outro, atrás da mureta).
   */
  withRoute<T>(pieceIndex: number, pick: (branch: number) => boolean, fn: () => T): T {
    const prev = this.route;
    this.route = this.routeFor(pieceIndex, pick);
    try {
      return fn();
    } finally {
      this.route = prev;
    }
  }

  private routeFor(pieceIndex: number, pick: (branch: number) => boolean): number {
    const p = this.pieces[pieceIndex];
    if (!p) return -1;
    if (p.branch >= 0) return p.branch;
    const n = this.loop;
    for (let k = 0; k < this.branches.length; k++) {
      const ahead = (this.branches[k].from - pieceIndex + n) % n;
      if (ahead <= 3 && pick(k)) return k;
    }
    return -1;
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
    // vão: não tem chão; a referência é o nível do pouso (o ímã de salto mira nele)
    if (p.code === 'G') return p.h0 + p.dh;
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
      dist: p.startDist + s * p.distScale,
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
   * procurar só nas vizinhas mantém a consulta barata e mantém o carro na sua passagem de um
   * cruzamento/viaduto. `y` (altura do carro), quando dada, desempata casas sobrepostas (viaduto):
   * vence a passagem cujo piso está mais perto, por baixo, da altura do carro.
   */
  query(x: number, z: number, hint = -1, y = NaN): TrackSample {
    const n = this.pieces.length;
    let best = -1;
    let bestScore = Infinity;
    // só a peça vencedora vira amostra completa
    if (hint >= 0 && hint < n) {
      for (const i of this.near[hint]) {
        const score = this.score(this.pieces[i], x, z, y);
        if (score < bestScore) {
          bestScore = score;
          best = i;
          Object.assign(this.prBest, this.prTmp);
        }
      }
    }
    if (best < 0 || bestScore > this.halfWidth + 3) {
      for (let i = 0; i < n; i++) {
        const score = this.score(this.pieces[i], x, z, y);
        if (score < bestScore) {
          bestScore = score;
          best = i;
          Object.assign(this.prBest, this.prTmp);
        }
      }
    }
    return this.sampleFor(this.pieces[best], this.prBest);
  }

  private score(p: Piece, x: number, z: number, y = NaN): number {
    const pr = this.project(p, x, z, this.prTmp);
    const d = Math.hypot(pr.outside, pr.lateral);
    if (y !== y || this.crossRole[p.index] === 'none' || this.crossRole[p.index] === 'flat') return d;
    // viaduto: penaliza o piso acima do carro (ele está embaixo) e o piso muito abaixo (está em cima)
    const dy = y - (p.h0 + 0.5);
    return d + (dy < -1 ? 50 : dy > RAMP_HEIGHT - 0.5 ? 10 : 0);
  }

  /** Ponto da linha central a uma distância (em metros) da linha de chegada. */
  pointAtDist(dist: number): { x: number; z: number; heading: number; h: number; pieceIndex: number } {
    const T = this.totalLength;
    const d = ((dist % T) + T) % T;
    const b = this.route >= 0 ? this.branches[this.route] : undefined;
    if (b && d >= b.startDist && d < b.endDist) {
      let k = b.first;
      while (k < b.last && this.pieces[k + 1].startDist <= d) k++;
      const p = this.pieces[k];
      const s = Math.min(p.length, (d - p.startDist) / p.distScale);
      const pt = this.pointOn(p, s);
      return { ...pt, h: this.heightOn(p, s), pieceIndex: p.index };
    }
    let lo = 0;
    let hi = this.loop - 1;
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
  sampleCenterline(step: number, branch = -1): CenterPoint[] {
    const out: CenterPoint[] = [];
    for (const p of this.pieces) {
      if (p.branch !== branch) continue;
      const count = Math.max(1, Math.ceil(p.length / step));
      for (let i = 0; i < count; i++) {
        const s = (p.length * i) / count;
        const pt = this.pointOn(p, s);
        out.push({ x: pt.x, z: pt.z, h: this.heightOn(p, s), heading: pt.heading, dist: p.startDist + s * p.distScale, pieceIndex: p.index });
      }
    }
    return out;
  }

  /**
   * Peça sem malha contínua própria: vão (G) ou cruzamento (X). A passagem de baixo de um viaduto
   * é pista comum (muretas contínuas); a de cima vira ponte (ver render/trackFeatures.ts).
   */
  isBreak(i: number): boolean {
    const c = this.pieces[i].code;
    return c === 'G' || (c === 'X' && this.crossRole[i] !== 'under') || this.junctionPartner(i) >= 0;
  }

  /**
   * Trechos contínuos de pista para montar a malha (piso, muretas, paredões). Vãos (G) e
   * cruzamentos (X) interrompem o trecho: o vão não tem chão e o cruzamento ganha uma placa
   * própria (ver render/trackFeatures.ts). Sem interrupções, devolve o laço fechado
   * (último ponto = primeiro, como a malha espera).
   */
  meshRuns(step: number): CenterPoint[][] {
    const pts = this.sampleCenterline(step);
    const n = this.loop;
    if (!this.pieces.some((_, i) => this.isBreak(i))) {
      pts.push({ ...pts[0], dist: this.totalLength });
      return [pts];
    }
    const byPiece: CenterPoint[][] = this.pieces.map(() => []);
    for (const q of pts) byPiece[q.pieceIndex].push(q);
    this.branches.forEach((_, b) => {
      for (const q of this.sampleCenterline(step, b)) byPiece[q.pieceIndex].push(q);
    });
    const endPoint = (pi: number, dist: number): CenterPoint => {
      const p = this.pieces[pi];
      const pt = this.pointOn(p, 0);
      // altura do fim da peça anterior (num vão com queda, o início do vão já está no nível do pouso)
      const prev = this.pieces[this.prevIndex(pi)];
      return { x: pt.x, z: pt.z, h: this.heightOn(prev, prev.length), heading: pt.heading, dist, pieceIndex: pi };
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
    // desvios: entre as duas casas de junção (que viram placas em T, ver render/trackFeatures.ts)
    for (const b of this.branches) {
      cur = [];
      for (let pi = b.first; pi <= b.last; pi++) {
        if (this.isBreak(pi)) {
          if (cur.length) {
            cur.push(endPoint(pi, this.pieces[pi].startDist));
            runs.push(cur);
            cur = [];
          }
          continue;
        }
        cur.push(...byPiece[pi]);
      }
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
