import type { ThemeId } from '../sim/track';

/** Padrão do piso da pista. */
export type RoadPattern = 'grid' | 'hex' | 'dirt' | 'scales' | 'ice';
/** Estilo das laterais dos blocos da pista (o "paredão" sob o piso). */
export type WallStyle = 'pipes' | 'biomech' | 'roots' | 'camo' | 'icerock' | 'demonic';
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
}

/**
 * Identidade de cada planeta, tirada dos mapas do original (referencias/snes/mapas):
 * - Chem VI: piso preto com grade vermelha, paredões de cilindros prateados com marcas vermelhas,
 *   lodo químico ocre lá embaixo, tanques de refinaria e tochas de gás.
 * - Drakonis: ladrilhos roxos, mureta de tubo roxo com bulbos, paredes biomecânicas azuis com
 *   olhos vermelhos, chão preto com crateras roxas, totens de ossos.
 * - Bogmire: pista de terra marrom, cabo preto com estrelas de espinhos, paredões de raízes,
 *   oceano azul-profundo com tocos e palmeiras.
 * - New Mojave: piso verde-oliva com grade hexagonal, mureta verde com luzes amarelas, painéis
 *   camuflados, deserto laranja com crateras e ossadas.
 * - Nho: gelo azul-marinho em losangos com juntas escuras, mureta de gelo com pingentes, rocha escura com pilares azuis,
 *   neve branca com pinheiros e cristais.
 * - Inferno: piso cinza de escamas, mureta preta com chifres, paredes demoníacas iluminadas por
 *   lava, mar de lava com obeliscos.
 */
export const THEMES: Record<ThemeId, Theme> = {
  chem6: {
    skyHorizon: 0x5a3010, skyTop: 0x06040a, fog: 0x4a3008, groundLevel: -8, ground: 0x8a5a0e, groundStyle: 'sludge',
    liquid: true, liquidEmissive: 0x201000,
    road: '#34302f', roadGrid: '#120a0a', roadGlow: 0.12, roadPattern: 'grid', roadEdge: '#e02a20', roadLine: '#e02a20',
    skirt: 0xa8acb4, walls: 'pipes', wallAccent: 0xe02020,
    rail: ['#b8bcc4', '#e02a20'], railStyle: 'lip',
    props: [0xb0b4bc, 0x8a8e96, 0x6a6e76], glow: 0xff7a20, flames: true,
    sun: 0xfff0d8, sunIntensity: 2.9, ambientSky: 0xd8b888, ambientGround: 0x4a3410, surface: 'metal',
  },
  drakonis: {
    skyHorizon: 0x2a1450, skyTop: 0x020106, fog: 0x0a0614, groundLevel: -8, ground: 0x0c0914, groundStyle: 'void',
    liquid: false, liquidEmissive: 0,
    road: '#1a0f2e', roadGrid: '#6a34c0', roadGlow: 0.5, roadPattern: 'grid', roadEdge: '#9a52f0', roadLine: '#9a52f0',
    skirt: 0x2a78b0, walls: 'biomech', wallAccent: 0xff2020,
    rail: ['#9a44e8', '#5a1ea0'], railStyle: 'tube',
    props: [0x3a8ac0, 0x7a4ac8, 0xc8c0d8], glow: 0x60ff40, flames: false,
    sun: 0xe8e0ff, sunIntensity: 3.1, ambientSky: 0xa890e0, ambientGround: 0x201830, surface: 'metal',
  },
  bogmire: {
    skyHorizon: 0x10286a, skyTop: 0x020410, fog: 0x0a1a48, groundLevel: -8, ground: 0x0e2a6a, groundStyle: 'ocean',
    liquid: true, liquidEmissive: 0x020a30,
    road: '#8a5428', roadGrid: '#5a3416', roadGlow: 0, roadPattern: 'dirt', roadEdge: '#3a2412', roadLine: '#3a2412',
    skirt: 0x5a3418, walls: 'roots', wallAccent: 0x2a6a1a,
    rail: ['#1c1c20', '#b8bcc4'], railStyle: 'cable',
    props: [0x6a4424, 0x3a8a2a, 0x8a8a90], glow: 0x80c0ff, flames: false,
    sun: 0xfff4dc, sunIntensity: 3.2, ambientSky: 0xb8d0ff, ambientGround: 0x3a2a1a, surface: 'dirt',
  },
  newmojave: {
    skyHorizon: 0x7a3a10, skyTop: 0x080408, fog: 0x8a4a14, groundLevel: -8, ground: 0xe0801c, groundStyle: 'sand',
    liquid: false, liquidEmissive: 0,
    road: '#1c2612', roadGrid: '#3e5420', roadGlow: 0.15, roadPattern: 'hex', roadEdge: '#ffd21a', roadLine: '#ffd21a',
    skirt: 0x3a5a1c, walls: 'camo', wallAccent: 0xffd21a,
    rail: ['#2e4a16', '#ffe020'], railStyle: 'bumper',
    props: [0x9a5a2a, 0xd8d0c0, 0x6a6a70], glow: 0xffd070, flames: false,
    sun: 0xfff0d8, sunIntensity: 3.3, ambientSky: 0xffd8a8, ambientGround: 0x8a4a14, surface: 'metal',
  },
  nho: {
    skyHorizon: 0x2a4a8a, skyTop: 0x02040c, fog: 0x8aa8d8, groundLevel: -8, ground: 0x8c9cbc, groundStyle: 'snow',
    liquid: false, liquidEmissive: 0,
    road: '#10285e', roadGrid: '#06102a', roadGlow: 0, roadPattern: 'ice', roadEdge: '#8ac0ff', roadLine: '#8ac0ff',
    skirt: 0x22242c, walls: 'icerock', wallAccent: 0x1a3aa0,
    rail: ['#4a8aff', '#d8ecff'], railStyle: 'ice',
    props: [0x2a6a3a, 0x8ab8ff, 0xc8d8f0], glow: 0x60c8ff, flames: false,
    sun: 0xf0f6ff, sunIntensity: 2.5, ambientSky: 0x9ab4e0, ambientGround: 0x4a5a78, surface: 'metal',
  },
  inferno: {
    skyHorizon: 0x6a1004, skyTop: 0x060102, fog: 0x5a0a02, groundLevel: -8, ground: 0xb81800, groundStyle: 'lava',
    liquid: true, liquidEmissive: 0xff3a00,
    road: '#4c4c54', roadGrid: '#141418', roadGlow: 0, roadPattern: 'scales', roadEdge: '#e02010', roadLine: '#e02010',
    skirt: 0x1a0606, walls: 'demonic', wallAccent: 0xff5a10,
    rail: ['#141416', '#e02010'], railStyle: 'spiked',
    props: [0x6a1a0a, 0x3a3a40, 0x8a8a90], glow: 0xff5010, flames: true,
    sun: 0xffe8d8, sunIntensity: 2.8, ambientSky: 0xd8a8a0, ambientGround: 0x6a1004, surface: 'metal',
  },
};

/** Tema usado na cena (ponto único para ajustes globais). */
export function levelTheme(t: Theme): Theme {
  return { ...t };
}
