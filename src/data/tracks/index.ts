import type { ThemeId, TrackDef } from '../../sim/track';

/**
 * As 36 pistas do Rock n' Roll Racing original (SNES), por planeta e na ordem do jogo.
 *
 * GERADO por scripts/pistas/gerar.py (não edite à mão; ajuste o script e gere de novo):
 *  - traçado (retas, curvas, cruzamentos X e vãos G com rampa J) extraído dos minimapas do jogo
 *    (referencias/snes/mapas/Tracks(In-GameMaps).png) por scripts/pistas/construir.py, com o
 *    sentido da corrida lido da seta de cada mapa completo (VGMaps);
 *  - relevo (rampas U/D, lombadas B, setas de warp `>` e warp reverso `<`, poças fixas) transcrito
 *    dos mapas completos em scripts/pistas/relevo.json; pistas ainda sem transcrição ficam só com
 *    o traçado (nenhum relevo inventado).
 * Todas são verificadas por teste: o circuito precisa fechar.
 */
const t = (planet: ThemeId, order: number, name: string, layout: string, slime = 0, puddles?: number[], laps = 4): TrackDef => ({
  id: `${planet}-${order}`,
  name,
  planet: PLANET_NAMES[planet],
  theme: planet,
  laps,
  layout,
  slime,
  order,
  ...(puddles ? { puddles } : {}),
  ...(HALF_OF[planet] ? { halfWidth: HALF_OF[planet] } : {}),
});

/** Meia-largura por planeta (m), quando difere do padrão. */
const HALF_OF: Partial<Record<ThemeId, number>> = {nho: 7};

export const PLANET_NAMES: Record<ThemeId, string> = {
  chem6: 'Chem VI',
  drakonis: 'Drakonis',
  bogmire: 'Bogmire',
  newmojave: 'New Mojave',
  nho: 'Nho',
  inferno: 'Inferno',
};

export const TRACKS: TrackDef[] = [
  // Chem VI
  t('chem6', 1, 'Refinaria', 'F S R S U U S S S R S S D D S S R S S S D S S R S U S S'),
  t('chem6', 2, 'Gasoduto', 'F R S S L S S R S S S R S S D S D S R S S S U U S R S S'),
  t('chem6', 3, 'Tanque de Ácido', 'F R S S X S S L S S L S S L S S X S S R S S R S'),
  t('chem6', 4, 'Chaminé', 'F S D S S R S U U U S S R S R S S S L S S D S R S D R S'),
  // Drakonis
  t('drakonis', 1, 'Cratera Lunar', 'F S R S S S S S S R S S D S R S S L S R S S D R U U S S', 2, [8, 20]),
  t('drakonis', 2, 'Serpente', 'F R S L S L S U S U S L S D L S R S S S L S D S L S S L S R', 2, [20, 27]),
  t('drakonis', 3, 'Ossário', 'F R S S S R S S S S S S R S S S S S S R S S S R S S L S'),
  t('drakonis', 4, 'Nebulosa', 'F S R S S R S L S R S S R S S S S X S L S L S L S X S S'),
  t('drakonis', 5, 'Eclipse', 'F S S R L R S S S S S R S S S S S R L R S S S S S R S S'),
  // Bogmire
  t('bogmire', 1, 'Lamaçal', 'F S S R S> U S S U S R S S R D D R L S L S S L S S S S R S R S> S S S D S R U> S S', 5, [6, 7, 8, 32, 33], 3),
  t('bogmire', 2, 'Costa Azul', 'F L S S S S R S S D R S D S R S L S S R S U S U R S R S', 1, [25]),
  t('bogmire', 3, 'Mangue', 'F S S L S S L S R S S S L S S S L R L S S S L S R S L S'),
  t('bogmire', 4, 'Brejo Fundo', 'F X S S S R S R S S S X S S L S L S S L S X S X S S L S S L S S L S'),
  t('bogmire', 5, 'Maré Alta', 'F R S S X S L S X S R S R S R S X S L S X S S R S S R S'),
  t('bogmire', 6, 'Atoleiro', 'F S R S S S S S R S R S S S L S X S S L S S S S L S S L S S S S X S R S'),
  // New Mojave
  t('newmojave', 1, 'Rodovia do Deserto', 'F L S S R S R S U S S R S L S R S S D S R S R S S L S X S S L S L S S L S X', 1, [14], 3),
  t('newmojave', 2, 'Cânion', 'F L R S S L S S S S S L S S S L S S R S L R L S S L S S'),
  t('newmojave', 3, 'Dunas', 'F S L S> S U S S U L S D S S S S L D S> J G S S L S L S S U S R S R S D S S L', 6, [13, 26, 27, 28, 29, 33]),
  t('newmojave', 4, 'Miragem', 'F L S S S S S S L S L S S S R S X S S R S S S R S S R S S S X S S L S S'),
  t('newmojave', 5, 'Vale da Morte', 'F L S R S S R S S S S S S R S R S S L S L S S R S S R S R L S S R S'),
  t('newmojave', 6, 'Poeira Vermelha', 'F R S L S R S S R S L S R S S R S L S R S S R S L S R S'),
  t('newmojave', 7, 'Oásis', 'F L S S S S L S R S L S S S S L S L S S R S S X S R S S R S R S S X S R S L'),
  // Nho
  t('nho', 1, 'Geleira', 'F L R S R S R L S S S R S S S L R S R S R L S S S> R S S', 2, [8, 23]),
  t('nho', 2, 'Labirinto', 'F S X S L S L S L S X S S X S L S L S L S X S S X S L S L S L S X S S X S L S L S L S X', 0, undefined, 3),
  t('nho', 3, 'Abismo', 'F R U L S L D J G J G S L S L S R S S R S L S L S S S S U S L S L D R S', 3, [24, 26, 29]),
  t('nho', 4, 'Nevasca', 'F L R S S R S S S S S S R S S R S L S L S R S R S S R L S S R S'),
  t('nho', 5, 'Cristal', 'F S L S L S J G S R S R S S S S S S R S S S S S S R S J G J G S R S S R S S'),
  t('nho', 6, 'Pico Gelado', 'F R S S S S S R L R J G S R S S X S R L S L S S L S S S L S X S L R L S S R'),
  t('nho', 7, 'Avalanche', 'F R S S R S L S R S S S S R S R S S L S S L S S R S R S J G S R S L'),
  // Inferno
  t('inferno', 1, 'Caldeirão', 'F L S L S D S J G U L S L S S R S X D S R U S R S S R S S> X S X S R S S R S R S S X S R', 1, [35], 3),
  t('inferno', 2, 'Rio de Lava', 'F S R S S R L R S L S S R S S S R S J G S S R S S L R S'),
  t('inferno', 3, 'Enxofre', 'F L S S S S L S S X S L S S L S L S S X S L S S S L S S J G S S L S S S S S'),
  t('inferno', 4, 'Forja', 'F R S S S S S S R S S S S S S R S S S S S S R S R S L S L S R S'),
  t('inferno', 5, 'Brasa', 'F R S S L U S R S D S R S> S< S> S D S R S U S S B S< R S S', 4, [2, 3, 19, 22]),
  t('inferno', 6, 'Portão do Inferno', 'F S S S S S L S S S S S S L S S J G S S L S L S S S S R S S R S S S S L S L'),
  t('inferno', 7, 'Apocalipse', 'F S S R S S S S S S R S J G S R S X S S R S R S S R S X S R S J G S R S S S'),
];

/** Pistas de um planeta, na ordem do original. */
export function tracksOfPlanet(theme: ThemeId): TrackDef[] {
  return TRACKS.filter((d) => d.theme === theme);
}

export function trackById(id: string): TrackDef {
  const def = TRACKS.find((d) => d.id === id);
  if (!def) throw new Error(`Pista desconhecida: ${id}`);
  return def;
}
