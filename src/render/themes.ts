import type { ThemeId } from '../sim/track';

/** Padrão do piso da pista. */
export type RoadPattern = 'grid' | 'hex' | 'dirt' | 'scales' | 'ice';
/** Estilo das laterais dos blocos da pista (o "paredão" sob o piso). */
export type WallStyle = 'pipes' | 'biomech' | 'roots' | 'riveted' | 'icerock' | 'demonic';
/** Estilo da mureta na borda da pista. */
export type RailStyle = 'lip' | 'tube' | 'cable' | 'bumper' | 'ice' | 'spiked';
/** Terreno lá embaixo, em volta dos blocos. */
export type GroundStyle = 'sludge' | 'void' | 'ocean' | 'sand' | 'snow' | 'lava';

export interface Theme {
  /** céu (só aparece nas câmeras de perseguição e cockpit): espaço escuro com um tom do planeta */
  skyHorizon: number;
  skyTop: number;
  fog: number;
  /** altura do terreno abaixo da pista (as pistas originais são blocos elevados) */
  groundLevel: number;
  ground: number;
  groundStyle: GroundStyle;
  /** o terreno é líquido (lodo, oceano, lava)? */
  liquid: boolean;
  liquidEmissive: number;
  /** piso: cor base, cor das linhas do padrão e se as linhas brilham (neon) */
  road: string;
  roadGrid: string;
  roadGlow: number;
  roadPattern: RoadPattern;
  /** linha fina que contorna a borda do piso */
  roadEdge: string;
  roadLine: string;
  skirt: number;
  walls: WallStyle;
  /** cor de destaque das paredes (olhos, faixas de perigo, brilho da lava) */
  wallAccent: number;
  rail: [string, string];
  railStyle: RailStyle;
  props: number[];
  glow: number;
  /** canos soltando chamas de gás */
  flames: boolean;
  sun: number;
  sunIntensity: number;
  ambientSky: number;
  ambientGround: number;
  /** piso "de terra" (levanta poeira) */
  surface: 'asphalt' | 'metal' | 'dirt';
  /** poeira/areia acumulada nas juntas do piso (cor do planeta) */
  dust: string;
  /** meio-fio arredondado no topo da borda: claro, cor de osso/areia (visual alvo) */
  curb: string;
  /**
   * Iluminação dramática por planeta (visual alvo): direção do sol (baixo = sombras longas), luz de
   * preenchimento vinda do lado oposto numa cor que contrasta com a do sol, e ambiente baixo.
   */
  light: { sunDir: [number, number, number]; fill: number; fillIntensity: number; hemi: number };
  /** quantas placas cabem na largura da pista (placas maiores = menos moiré de longe) */
  cells: number;
}

/**
 * Identidade de cada planeta, tirada dos mapas do original (referencias/snes/mapas):
 * - Chem VI: piso preto com grade vermelha, paredões de cilindros prateados com marcas vermelhas,
 *   lodo químico ocre lá embaixo, tanques de refinaria e tochas de gás.
 * - Drakonis: ladrilhos roxos, mureta de tubo roxo com bulbos, paredes biomecânicas azuis com
 *   olhos vermelhos, chão preto com crateras roxas, totens de ossos.
 * - Bogmire: pista de terra marrom, cabo preto com estrelas de espinhos, paredões de raízes,
 *   oceano azul-profundo com tocos e palmeiras.
 * - New Mojave: piso verde-oliva com grade hexagonal, mureta com tachas amarelas, paredões de
 *   chapa verde-oliva escura camuflada, deserto laranja de dia (céu quente) com crateras e ossadas.
 * - Nho: gelo azul-marinho em losangos com juntas escuras, mureta de gelo com pingentes, rocha escura com pilares azuis,
 *   neve branca com pinheiros e cristais.
 * - Inferno: piso cinza de escamas, mureta preta com chifres, paredes demoníacas iluminadas por
 *   lava, mar de lava com obeliscos.
 */
export const THEMES: Record<ThemeId, Theme> = {
  chem6: {
    skyHorizon: 0x5a3010, skyTop: 0x06040a, fog: 0x160e06, groundLevel: -8, ground: 0x8a5a0e, groundStyle: 'sludge',
    liquid: true, liquidEmissive: 0x201000,
    road: '#1a1c22', roadGrid: '#c01c14', roadGlow: 0.35, roadPattern: 'grid', roadEdge: '#e02a20', roadLine: '#e02a20',
    skirt: 0xa8acb4, walls: 'pipes', wallAccent: 0xe02020,
    rail: ['#b8bcc4', '#e02a20'], railStyle: 'lip',
    props: [0xb0b4bc, 0x8a8e96, 0x6a6e76], glow: 0xff7a20, flames: true,
    sun: 0xfff0d8, sunIntensity: 2.9, ambientSky: 0xd8b888, ambientGround: 0x4a3410, surface: 'metal',
    dust: '#7c858c', curb: '#d6c7a4',
    light: { sunDir: [55, 40, -42], fill: 0xff9a50, fillIntensity: 0.5, hemi: 0.35 }, cells: 10,
  },
  drakonis: {
    skyHorizon: 0x2a1450, skyTop: 0x020106, fog: 0x07040e, groundLevel: -8, ground: 0x1e1630, groundStyle: 'void',
    liquid: false, liquidEmissive: 0,
    road: '#2a2240', roadGrid: '#6a34c0', roadGlow: 0.5, roadPattern: 'grid', roadEdge: '#9a52f0', roadLine: '#9a52f0',
    skirt: 0x2a78b0, walls: 'biomech', wallAccent: 0xff2020,
    rail: ['#9a44e8', '#5a1ea0'], railStyle: 'tube',
    props: [0x3a8ac0, 0x7a4ac8, 0xc8c0d8], glow: 0x60ff40, flames: false,
    sun: 0xff6ae0, sunIntensity: 3.4, ambientSky: 0x8a70d0, ambientGround: 0x140c24, surface: 'metal',
    dust: '#8a8098', curb: '#cfc6d2',
    light: { sunDir: [48, 30, -52], fill: 0x30e0ff, fillIntensity: 2.3, hemi: 0.2 }, cells: 7,
  },
  bogmire: {
    skyHorizon: 0x10286a, skyTop: 0x020410, fog: 0x050a18, groundLevel: -8, ground: 0x0e2a6a, groundStyle: 'ocean',
    liquid: true, liquidEmissive: 0x020a30,
    road: '#8a5428', roadGrid: '#5a3416', roadGlow: 0, roadPattern: 'dirt', roadEdge: '#3a2412', roadLine: '#3a2412',
    skirt: 0x5a3418, walls: 'roots', wallAccent: 0x2a6a1a,
    rail: ['#1c1c20', '#b8bcc4'], railStyle: 'cable',
    props: [0x6a4424, 0x3a8a2a, 0x8a8a90], glow: 0x80c0ff, flames: false,
    sun: 0xfff4dc, sunIntensity: 3.2, ambientSky: 0xb8d0ff, ambientGround: 0x3a2a1a, surface: 'dirt',
    dust: '#6a4a2a', curb: '#cdbb98',
    light: { sunDir: [58, 34, -40], fill: 0x4a8aff, fillIntensity: 0.9, hemi: 0.28 }, cells: 10,
  },
  newmojave: {
    skyHorizon: 0xf2b064, skyTop: 0xb86428, fog: 0xc88444, groundLevel: -8, ground: 0xe0801c, groundStyle: 'sand',
    liquid: false, liquidEmissive: 0,
    road: '#34441a', roadGrid: '#101806', roadGlow: 0, roadPattern: 'hex', roadEdge: '#ffd21a', roadLine: '#ffd21a',
    skirt: 0x2c3816, walls: 'riveted', wallAccent: 0xffd21a,
    rail: ['#3a4a1c', '#ffe020'], railStyle: 'bumper',
    props: [0x9a5a2a, 0xd8d0c0, 0x6a6a70], glow: 0xffd070, flames: false,
    sun: 0xfff0d8, sunIntensity: 3.3, ambientSky: 0xffd8a8, ambientGround: 0x8a4a14, surface: 'metal',
    dust: '#aa9a74', curb: '#4e5a28',
    light: { sunDir: [60, 30, -34], fill: 0x6a8aff, fillIntensity: 0.7, hemi: 0.28 }, cells: 10,
  },
  nho: {
    skyHorizon: 0x2a4a8a, skyTop: 0x02040c, fog: 0x141a26, groundLevel: -8, ground: 0xe4eefc, groundStyle: 'snow',
    liquid: false, liquidEmissive: 0,
    road: '#1c58c8', roadGrid: '#08184a', roadGlow: 0.3, roadPattern: 'ice', roadEdge: '#8ac0ff', roadLine: '#8ac0ff',
    skirt: 0x22242c, walls: 'icerock', wallAccent: 0x1a3aa0,
    rail: ['#4a8aff', '#d8ecff'], railStyle: 'ice',
    props: [0x2a6a3a, 0x8ab8ff, 0xc8d8f0], glow: 0x60c8ff, flames: false,
    // sol mais fraco e disco menos branco: na perseguição o sol baixo estourava em clarão (rodada 10)
    sun: 0xe8bc90, sunIntensity: 3.4, ambientSky: 0x7a9ad8, ambientGround: 0x2a3a58, surface: 'metal',
    dust: '#c4ccd6', curb: '#dfe4e8',
    light: { sunDir: [62, 22, -30], fill: 0x40ffc8, fillIntensity: 1.3, hemi: 0.22 }, cells: 6,
  },
  inferno: {
    // céu, névoa e ambiente mais escuros e quentes: o ambiente rosado refletia no piso metálico e
    // deixava o cockpit lilás/lavado (rodada 10). Rodada 11: sol mais fraco e alaranjado (menos
    // especular cinza-bege no piso em vista baixa), horizonte mais escuro (o céu refletido na lava em
    // ângulo rasante deixava a lava cinza-rosada) e meio-fio menos claro
    skyHorizon: 0x340702, skyTop: 0x040101, fog: 0x160201, groundLevel: -8, ground: 0xb81800, groundStyle: 'lava',
    liquid: true, liquidEmissive: 0xff3a00,
    road: '#1a1414', roadGrid: '#7a1206', roadGlow: 0.25, roadPattern: 'scales', roadEdge: '#e02010', roadLine: '#e02010',
    skirt: 0x1a0606, walls: 'demonic', wallAccent: 0xff5a10,
    rail: ['#141416', '#e02010'], railStyle: 'spiked',
    props: [0x6a1a0a, 0x3a3a40, 0x8a8a90], glow: 0xff5010, flames: true,
    sun: 0xffb07a, sunIntensity: 1.9, ambientSky: 0x5c2216, ambientGround: 0x6a1004, surface: 'metal',
    dust: '#3e302c', curb: '#a8988a',
    light: { sunDir: [52, 32, -46], fill: 0xff3a10, fillIntensity: 1.2, hemi: 0.2 }, cells: 10,
  },
};

/**
 * Tema usado na cena (ponto único para ajustes globais). Devolve o mesmo objeto enquanto o planeta
 * não muda: as texturas geradas (piso, paredões, meio-fio, chão) ficam em cache por tema, então a
 * corrida seguinte no mesmo planeta não gera tudo de novo (era boa parte da demora da largada).
 */
let lastTheme: { src: Theme; level: Theme } | null = null;
export function levelTheme(t: Theme): Theme {
  if (lastTheme?.src !== t) lastTheme = { src: t, level: { ...t } };
  return lastTheme.level;
}
