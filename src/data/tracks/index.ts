import type { ThemeId, TrackDef } from '../../sim/track';

/**
 * As 36 pistas do Rock n' Roll Racing original (SNES), por planeta e na ordem do jogo.
 *
 * GERADO por scripts/pistas/gerar.py (não edite à mão; ajuste o script e gere de novo):
 *  - traçado (retas, curvas, cruzamentos X e vãos G com rampa J) extraído dos minimapas do jogo
 *    (referencias/snes/mapas/Tracks(In-GameMaps).png) por scripts/pistas/construir.py, com o
 *    sentido da corrida lido da seta de cada mapa completo (VGMaps);
 *  - relevo (rampas U/D, lombadas B, setas de warp `>` e warp reverso `<`, poças fixas) transcrito
 *    dos mapas completos em scripts/pistas/relevo.json; pistas ainda sem transcrição usam regras
 *    de cada planeta (sorteio determinístico).
 * Todas são verificadas por teste: o circuito precisa fechar.
 */
const t = (planet: ThemeId, order: number, name: string, layout: string, slime = 0, puddles?: number[]): TrackDef => ({
  id: `${planet}-${order}`,
  name,
  planet: PLANET_NAMES[planet],
  theme: planet,
  laps: 4,
  layout,
  slime,
  order,
  ...(puddles ? { puddles } : {}),
});

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
  t('chem6', 2, 'Gasoduto', 'F R S S L S S R S B S R S S S S S S R S J S S S S R S S'),
  t('chem6', 3, 'Tanque de Ácido', 'F R S S X B S L S S L S S L S S X S S R S S R S'),
  t('chem6', 4, 'Chaminé', 'F S S S S R S S J S S S R S R S S S L S S S S R B S R S'),
  // Drakonis
  t('drakonis', 1, 'Cratera Lunar', 'F S R S S S S S S R S S D S R S S L S R S S D R U U S S', 2, [8, 20]),
  t('drakonis', 2, 'Serpente', 'F R S L S L S J S U S L S> S L S R D S S L S S S L B S L S R', 2),
  t('drakonis', 3, 'Ossário', 'F R S S S R B S S J S S R S S> U S S S R S S D R S S L S', 2),
  t('drakonis', 4, 'Nebulosa', 'F S R U S R S L S R B S R D J S S X S> L S L S L S X S S', 2),
  t('drakonis', 5, 'Eclipse', 'F B S R L R S S J S S R S S> U S S R L R S S S D S R S S', 2),
  // Bogmire
  t('bogmire', 1, 'Lamaçal', 'F S S R S> U S S U S R S S R D D R L S L S S L S S S S R S R S> S S S D S R U> S S', 5, [6, 7, 8, 32, 33]),
  t('bogmire', 2, 'Costa Azul', 'F L S J S S R S S U R B S S R S L S S> R D J S S R S R S', 3),
  t('bogmire', 3, 'Mangue', 'F B S L S> S L S R S S S L S S S L R L U S S L D R S L S', 3),
  t('bogmire', 4, 'Brejo Fundo', 'F X S S S R S R B S S X S S L S L S S L S X S X S S L U S> L D S L S', 3),
  t('bogmire', 5, 'Maré Alta', 'F R S> S X S L S X U R S R S R D X S L S X S S R B S R S', 3),
  t('bogmire', 6, 'Atoleiro', 'F S> R S S U S S R S R B S D L S X S S L S J S S L S S L S J S S X S R S', 3),
  // New Mojave
  t('newmojave', 1, 'Rodovia do Deserto', 'F L U U R S R S S U S R S L D R S D D S R S R B S L S X S> S L S L S S L S X'),
  t('newmojave', 2, 'Cânion', 'F L R S> U L B S J S D L U U S L D D R S L R L S S L S S'),
  t('newmojave', 3, 'Dunas', 'F S L S> S U S S U L S D S S S S L D S> J G S S L S L S S U S R S R S D S S L', 6, [13, 26, 27, 28, 29, 33]),
  t('newmojave', 4, 'Miragem', 'F L S S S J S U L S L S D S R S X U U R S D D R S S> R B S S X S S L S S'),
  t('newmojave', 5, 'Vale da Morte', 'F L S R S U R S D S U U S R S R D D L S L S S R B S R S R L S> S R S'),
  t('newmojave', 6, 'Poeira Vermelha', 'F R U L S R B D R S L S> R U U R S L S R D D R S L S R S'),
  t('newmojave', 7, 'Oásis', 'F L S U U S L S R S L D D S S L S> L S U R B D X S R S S R S R S S X S R S L'),
  // Nho
  t('nho', 1, 'Geleira', 'F L R S R S R L B S S> R S U S L R D R S R L S B S R S S', 2),
  t('nho', 2, 'Labirinto', 'F S X U L S L S L D X S S X S L S L S L S X B S X S L S L S L S X B S> X S L S L S L S X', 2),
  t('nho', 3, 'Abismo', 'F R U L S L D J G J G S L S L S R S S R S L S L S S S S U S L S L D R S', 3, [24, 26, 29]),
  t('nho', 4, 'Nevasca', 'F L R S S R U S J S S S R B S R S L D L S R S R B S> R L S S R S', 2),
  t('nho', 5, 'Cristal', 'F S L S L S J G S R S R U B S> B S D R S J S S S S R S J G J G S R S S R S S', 2),
  t('nho', 6, 'Pico Gelado', 'F R S J S S U R L R J G S R S D X S R L S L B S L S B S L S> X S L R L S S R', 2),
  t('nho', 7, 'Avalanche', 'F R S> S R S L S R S B U S R S R B D L S S L S S R S R S J G S R S L', 2),
  // Inferno
  t('inferno', 1, 'Caldeirão', 'F L S L B S S J G S L S L S S R S< X U U R S S R S> S R D D X S X U R S S R D R S S X S R', 2),
  t('inferno', 2, 'Rio de Lava', 'F S R S> U R L R S L B D R U U S R S J G S S< R D D L R S', 2),
  t('inferno', 3, 'Enxofre', 'F L U U B S L D D X S L S S L S L S S> X U L S S D L S S J G S S L S S< S S S', 2),
  t('inferno', 4, 'Forja', 'F R U U S S D D R S U S< B S> S R S J S D S S R S R S L S L S R S', 2),
  t('inferno', 5, 'Brasa', 'F R S S L U S R S D S R S> S< S> S D S R S U S S B S< R S S', 4, [2, 3, 19, 22]),
  t('inferno', 6, 'Portão do Inferno', 'F S> U S< S S L S J S D U U L S S J G S S L S L B D D S R S S R S S S S L S L', 2),
  t('inferno', 7, 'Apocalipse', 'F U U R B D D J S S R S J G S R S X S U R S< R S D R S> X S R S J G S R S S S', 2),
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
