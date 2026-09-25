"""
Gera src/data/tracks/index.ts a partir do traçado extraído dos minimapas (construir.py).

O traçado (retas, curvas, cruzamentos e vãos) é o do original. O relevo (rampas, lombadas, setas
de warp e poças fixas) vem de scripts/pistas/relevo.json, transcrito à mão dos mapas completos.
Pistas ainda sem transcrição ficam só com o traçado (retas, curvas, saltos J/G e cruzamentos X),
sem relevo, setas ou poças inventados.

Uso: python scripts/pistas/gerar.py [scripts/pistas/tracado.json]
"""
import json
import sys

NAMES = {
    'chem6': ['Refinaria', 'Gasoduto', 'Tanque de Ácido', 'Chaminé'],
    'drakonis': ['Cratera Lunar', 'Serpente', 'Ossário', 'Nebulosa', 'Eclipse'],
    'bogmire': ['Lamaçal', 'Costa Azul', 'Mangue', 'Brejo Fundo', 'Maré Alta', 'Atoleiro'],
    'newmojave': ['Rodovia do Deserto', 'Cânion', 'Dunas', 'Miragem', 'Vale da Morte', 'Poeira Vermelha', 'Oásis'],
    'nho': ['Geleira', 'Labirinto', 'Abismo', 'Nevasca', 'Cristal', 'Pico Gelado', 'Avalanche'],
    'inferno': ['Caldeirão', 'Rio de Lava', 'Enxofre', 'Forja', 'Brasa', 'Portão do Inferno', 'Apocalipse'],
}
PLANET_NAME = {'chem6': 'Chem VI', 'drakonis': 'Drakonis', 'bogmire': 'Bogmire', 'newmojave': 'New Mojave', 'nho': 'Nho', 'inferno': 'Inferno'}


def plain(codes):
    """Pista ainda sem transcrição: só o que o traçado exige (J/G/X já vêm de construir.py).
    Nada de relevo, setas ou poças inventadas (pedido do usuário, item 19)."""
    return ' '.join(codes)


RELEVO = 'scripts/pistas/relevo.json'
# voltas por pista (padrão 4): pistas longas ficam com 3 para o vencedor chegar em ~60-75 s
LAPS = {'bogmire-1': 3, 'newmojave-1': 3, 'nho-2': 3, 'inferno-1': 3}
# meia-largura por planeta (m; padrão HALF_WIDTH = 5,5): as pistas de Nho são mais largas no original
HALF = {'nho': 7}


def transcribed(codes, key, rel):
    """Aplica o relevo transcrito de uma pista; confere que é possível e que o circuito fecha."""
    n = len(codes)
    mods = [''] * n
    flat = {0, n - 1, n - 2}  # largada e grid (os carros largam até ~25 m antes da linha)
    for k, c in rel.get('pecas', {}).items():
        i = int(k)
        if c not in 'UDBJ' or len(c) != 1:
            raise SystemExit(f'{key}: peça inválida {c} na casa {i}')
        if codes[i] != 'S':
            raise SystemExit(f'{key}: casa {i} é {codes[i]}, relevo só em reta (S)')
        if i in flat:
            raise SystemExit(f'{key}: casa {i} é largada/grid, precisa ficar plana')
        if c == 'J' and codes[(i + 1) % n] != 'G':
            raise SystemExit(f'{key}: salto J na casa {i} sem vão depois')
        if c == 'B' and (codes[(i - 1) % n] not in 'SUDBFX' or codes[(i + 1) % n] not in 'SUDBFX'):
            # o carro pula na lombada; colada numa curva ele sai por cima da mureta
            raise SystemExit(f'{key}: lombada B na casa {i} colada numa curva')
        codes[i] = c
    if codes.count('U') != codes.count('D'):
        raise SystemExit(f"{key}: {codes.count('U')} subidas e {codes.count('D')} descidas, o circuito não fecha")
    for k, m in rel.get('setas', {}).items():
        i = int(k)
        if m not in ('>', '<') or codes[i] not in 'SUDB' or i in flat:
            raise SystemExit(f'{key}: seta {m} inválida na casa {i} ({codes[i]})')
        mods[i] = m
    puddles = sorted(set(rel.get('pocas', [])))
    for i in puddles:
        if codes[i] in 'GJ' or i in flat:
            raise SystemExit(f'{key}: poça na casa {i} ({codes[i]})')
    return ' '.join(c + m for c, m in zip(codes, mods)), puddles


def main():
    data = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'scripts/pistas/tracado.json', encoding='utf8'))
    relevo = {k: v for k, v in json.load(open(RELEVO, encoding='utf8')).items() if not k.startswith('_')}
    rows = []
    for t in data:
        if 'layout' not in t:
            raise SystemExit(f"pista sem traçado: {t['planet']} {t['race']}: {t.get('erro')}")
        codes = t['layout'].split()
        p = t['planet']
        key = f"{p}-{t['race']}"
        if key in relevo:
            layout, puddles = transcribed(codes, key, relevo[key])
        else:
            layout, puddles = plain(codes), None
        rows.append((p, t['race'], NAMES[p][t['race'] - 1], layout, len(puddles) if puddles is not None else 0, puddles))
    out = []
    out.append("""import type { ThemeId, TrackDef } from '../../sim/track';

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
const HALF_OF: Partial<Record<ThemeId, number>> = {@HALF@};

export const PLANET_NAMES: Record<ThemeId, string> = {
  chem6: 'Chem VI',
  drakonis: 'Drakonis',
  bogmire: 'Bogmire',
  newmojave: 'New Mojave',
  nho: 'Nho',
  inferno: 'Inferno',
};

export const TRACKS: TrackDef[] = [""")
    last = None
    for p, race, name, layout, slime, puddles in rows:
        if p != last:
            out.append(f'  // {PLANET_NAME[p]}')
            last = p
        laps = LAPS.get(f'{p}-{race}', 4)
        extra = f', {slime}' if slime or puddles or laps != 4 else ''
        if puddles:
            extra += f", [{', '.join(map(str, puddles))}]"
        elif laps != 4:
            extra += ', undefined'
        if laps != 4:
            extra += f', {laps}'
        out.append(f"  t('{p}', {race}, '{name}', '{layout}'{extra}),")
    out.append("""];

/** Pistas de um planeta, na ordem do original. */
export function tracksOfPlanet(theme: ThemeId): TrackDef[] {
  return TRACKS.filter((d) => d.theme === theme);
}

export function trackById(id: string): TrackDef {
  const def = TRACKS.find((d) => d.id === id);
  if (!def) throw new Error(`Pista desconhecida: ${id}`);
  return def;
}
""")
    text = '\n'.join(out).replace('@HALF@', ', '.join(f'{k}: {v}' for k, v in HALF.items()))
    open('src/data/tracks/index.ts', 'w', encoding='utf8', newline='\n').write(text)
    print(len(rows), 'pistas')


main()
