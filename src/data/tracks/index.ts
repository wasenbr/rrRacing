import type { ThemeId, TrackDef } from '../../sim/track';

/**
 * Pistas por planeta. PROVISÓRIAS: seguem o estilo de cada planeta do original
 * (Chem VI simples, Drakonis sinuoso, Bogmire com saltos, New Mojave com retas longas,
 * Nho e Inferno com tudo junto), mas o traçado exato será refeito a partir dos mapas
 * de referência (ver PLANO.md). Todas são verificadas por teste: o circuito precisa fechar.
 */
const t = (id: string, name: string, planet: string, theme: ThemeId, layout: string, slime = 0): TrackDef => ({ id, name, planet, theme, laps: 4, layout, slime });

export const TRACKS: TrackDef[] = [
  t('chem6-1', 'Refinaria', 'Chem VI', 'chem6', 'F S S J S S R S U S R B S L R S D S R S S S S R'),
  t('chem6-2', 'Gasoduto', 'Chem VI', 'chem6', 'F S S R S S S R B S S L R S S R S S S S R S S S'),
  t('drakonis-1', 'Cratera Lunar', 'Drakonis', 'drakonis', 'F S R S L S R S S R S B S R L S R S S S R S', 3),
  t('drakonis-2', 'Serpente', 'Drakonis', 'drakonis', 'F S S J S R S R S L S L S R U S S R S S D S S R S S S S S S S R', 4),
  t('bogmire-1', 'Lamaçal', 'Bogmire', 'bogmire', 'F S J S S R S B S R S U S J D S R S S S R S', 2),
  t('bogmire-2', 'Costa Azul', 'Bogmire', 'bogmire', 'F S S R L S R S J S S R S B B S L R R S S S S S S R', 3),
  t('newmojave-1', 'Rodovia do Deserto', 'New Mojave', 'newmojave', 'F S S S J S S S R S S R S S S J S S S R S L R R'),
  t('newmojave-2', 'Cânion', 'New Mojave', 'newmojave', 'F S U S S D S R S S R J S S L R S S S R S S S R'),
  t('nho-1', 'Labirinto', 'Nho', 'nho', 'F S R L S R S U S R D S S L S R S S R S S S S S S R S S', 2),
  t('nho-2', 'Abismo', 'Nho', 'nho', 'F S S R S L S R U S S R S D L S R S J S S R S S S S S S S R S S', 2),
  t('inferno-1', 'Caldeirão', 'Inferno', 'inferno', 'F S J S S R S L S R U S R S D S S R B S S L S S R R', 3),
  t('inferno-2', 'Rio de Lava', 'Inferno', 'inferno', 'F S S U J D S R S R S L S L S R S R S S S S S S S R S S S S S R', 3),
];

export function trackById(id: string): TrackDef {
  const def = TRACKS.find((d) => d.id === id);
  if (!def) throw new Error(`Pista desconhecida: ${id}`);
  return def;
}
