import type { ThemeId } from '../sim/track';

export interface Theme {
  /** cor do céu no horizonte e no topo */
  skyHorizon: number;
  skyTop: number;
  fog: number;
  /** altura do terreno/água abaixo da pista (as pistas originais são blocos elevados) */
  groundLevel: number;
  ground: number;
  /** o terreno é líquido (pântano, lava, oceano)? */
  liquid: boolean;
  liquidEmissive: number;
  road: string;
  roadEdge: string;
  roadLine: string;
  skirt: number;
  rail: [string, string];
  props: number[];
  glow: number;
  /** canos soltando chamas de gás (Chem VI) */
  flames: boolean;
  sun: number;
  sunIntensity: number;
  ambientSky: number;
  ambientGround: number;
}

/**
 * Paletas de cada planeta, seguindo o original:
 * - Chem VI: pistas preto-e-vermelho elevadas sobre um pântano químico, canos queimando metano.
 * - Drakonis: roxo e preto, crateras lunares; primeiras poças de gosma verde.
 * - Bogmire: pistas de terra marrom, oceano azul profundo ao fundo.
 * - New Mojave: deserto. Nho: rocha escura. Inferno: lava.
 */
export const THEMES: Record<ThemeId, Theme> = {
  chem6: {
    skyHorizon: 0xc0603a,
    skyTop: 0x2a1438,
    fog: 0x6a4030,
    groundLevel: -5,
    ground: 0x1a2c12,
    liquid: true,
    liquidEmissive: 0x0e2606,
    road: '#2a282e',
    roadEdge: '#d42a20',
    roadLine: '#d8d0c0',
    skirt: 0x4a3a3c,
    rail: ['#d42a20', '#1a181c'],
    props: [0x6a605a, 0x8a7a6a, 0x4a4640],
    glow: 0xff7a20,
    flames: true,
    sun: 0xffd8b0,
    sunIntensity: 2.6,
    ambientSky: 0xd0a080,
    ambientGround: 0x203018,
  },
  drakonis: {
    skyHorizon: 0x3a1f55, skyTop: 0x05030a, fog: 0x24153a, groundLevel: -4, ground: 0x2a2236, liquid: false,
    liquidEmissive: 0, road: '#1a1620', roadEdge: '#7a3ab0', roadLine: '#c0b0d8', skirt: 0x1e1828,
    rail: ['#7a3ab0', '#101010'], props: [0x4a4058, 0x2e2838], glow: 0x6aff40, flames: false, sun: 0xe0d0ff,
    sunIntensity: 2.2, ambientSky: 0x9a80d0, ambientGround: 0x181020,
  },
  bogmire: {
    skyHorizon: 0x3a6a9a, skyTop: 0x0a1a3a, fog: 0x2a4a6a, groundLevel: -4, ground: 0x0e2a55, liquid: true,
    liquidEmissive: 0x020818, road: '#6a4a2c', roadEdge: '#4a321c', roadLine: '#8a6a44', skirt: 0x4a3420,
    rail: ['#8a6a3a', '#3a2a18'], props: [0x5a4a30, 0x3a5a2a], glow: 0x80c0ff, flames: false, sun: 0xfff0d0,
    sunIntensity: 2.8, ambientSky: 0xa0c8ff, ambientGround: 0x302010,
  },
  newmojave: {
    skyHorizon: 0xe0a070, skyTop: 0x5a7ab0, fog: 0xc09070, groundLevel: -3, ground: 0xb07a4a, liquid: false,
    liquidEmissive: 0, road: '#5a4a40', roadEdge: '#e0e0e0', roadLine: '#f0e0a0', skirt: 0x7a5234,
    rail: ['#f0f0f0', '#c03030'], props: [0x8a5a3a, 0x6a8a3a], glow: 0xffd070, flames: false, sun: 0xfff0d0,
    sunIntensity: 3.2, ambientSky: 0xffd8b0, ambientGround: 0x503020,
  },
  nho: {
    skyHorizon: 0x1a2a3a, skyTop: 0x020408, fog: 0x10181f, groundLevel: -4, ground: 0x1a1c20, liquid: false,
    liquidEmissive: 0, road: '#2a2c30', roadEdge: '#40a0c0', roadLine: '#a0d0e0', skirt: 0x16181c,
    rail: ['#40a0c0', '#101014'], props: [0x3a3c44, 0x24262c], glow: 0x40e0ff, flames: false, sun: 0xc0d8ff,
    sunIntensity: 2, ambientSky: 0x8098c0, ambientGround: 0x101014,
  },
  inferno: {
    skyHorizon: 0x8a2a0a, skyTop: 0x1a0402, fog: 0x4a1408, groundLevel: -5, ground: 0x8a2000, liquid: true,
    liquidEmissive: 0xff3a00, road: '#2a2220', roadEdge: '#ff5010', roadLine: '#ffb060', skirt: 0x2a1410,
    rail: ['#ff5010', '#201010'], props: [0x3a2a24, 0x2a2220], glow: 0xff5010, flames: true, sun: 0xffc090,
    sunIntensity: 2.4, ambientSky: 0xff9070, ambientGround: 0x401008,
  },
};

const dim = (c: number, k: number) => {
  const r = ((c >> 16) & 255) * k;
  const g = ((c >> 8) & 255) * k;
  const b = (c & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
};

/**
 * Fundo escuro como no original: as pistas flutuam sobre um vazio quase preto, com só um tom
 * da cor do planeta. O terreno fica bem abaixo e escuro; a pista continua bem iluminada.
 */
export function darkBackdrop(t: Theme): Theme {
  return {
    ...t,
    skyHorizon: dim(t.skyHorizon, 0.28),
    skyTop: dim(t.skyTop, 0.12),
    fog: dim(t.skyHorizon, 0.12),
    groundLevel: Math.min(t.groundLevel, -11),
    ground: dim(t.ground, t.liquidEmissive > 0x400000 ? 0.8 : 0.3),
    liquidEmissive: t.liquidEmissive > 0x400000 ? t.liquidEmissive : dim(t.liquidEmissive, 0.4),
    skirt: dim(t.skirt, 0.45),
    props: t.props.map((c) => dim(c, 0.55)),
    ambientSky: dim(t.ambientSky, 0.7),
    ambientGround: dim(t.ambientGround, 0.4),
  };
}
