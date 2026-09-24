"""
Gera src/data/tracks/index.ts a partir do traçado extraído dos minimapas (construir.py).

O traçado (retas, curvas, cruzamentos e vãos) é o do original. O relevo (rampas, lombadas, setas
de warp e poças fixas) vem de scripts/pistas/relevo.json, transcrito à mão dos mapas completos.
Pistas ainda sem transcrição caem no sorteio por regras de cada planeta, de forma determinística
(mesma saída sempre), respeitando:
  - cruzamentos (X) ficam no nível base (as duas passagens precisam da mesma altura);
  - vãos (G) só depois de rampa de salto (J), com casa de pouso;
  - largada e as 3 casas antes dela (grid) ficam planas.

Uso: python scripts/pistas/gerar.py [scripts/pistas/tracado.json]
"""
import json
import random
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
# relevo por planeta: pares de rampas (e quantos são duplos), saltos, lombadas, warps, warps reversos, poças
CFG = {
    'chem6': dict(ramps=0, double=0, jumps=1, bumps=1, warps=0, reverse=0, slime=0),
    'drakonis': dict(ramps=1, double=0, jumps=1, bumps=1, warps=1, reverse=0, slime=2),
    'bogmire': dict(ramps=1, double=0, jumps=2, bumps=1, warps=1, reverse=0, slime=3),
    'newmojave': dict(ramps=2, double=1, jumps=1, bumps=1, warps=1, reverse=0, slime=0),
    'nho': dict(ramps=1, double=0, jumps=1, bumps=2, warps=1, reverse=0, slime=2),
    'inferno': dict(ramps=2, double=1, jumps=1, bumps=1, warps=1, reverse=1, slime=2),
}


def decorate(codes, planet, race):
    n = len(codes)
    rng = random.Random(f'{planet}-{race}')
    cfg = CFG[planet]
    used = set()
    mods = [''] * n
    protected = {0, n - 1, n - 2, n - 3}  # largada e grid

    def free(i):
        i %= n
        return codes[i] == 'S' and i not in used and i not in protected and codes[(i - 1) % n] not in 'GJ' and codes[(i + 1) % n] not in 'GJ'

    # rampas: U (U) ... D (D) no mesmo sentido, sem cruzamento entre elas
    for k in range(cfg['ramps']):
        double = k < cfg['double']
        w = 2 if double else 1
        cands = []
        for u in range(1, n - 3):
            if not all(free(u + t) for t in range(w)):
                continue
            for d in range(u + w + 2, min(n - 3, u + w + 2 + max(4, n // 3))):
                if not all(free(d + t) for t in range(w)) or d + w - 1 >= n - 3:
                    continue
                if any(codes[x] == 'X' or x in used for x in range(u, d + w)):
                    continue
                cands.append((u, d))
        if not cands:
            continue
        u, d = rng.choice(cands)
        for t in range(w):
            codes[u + t] = 'U'
            codes[d + t] = 'D'
            used.update({u + t, d + t})
        # o platô inteiro fica reservado (sem outras rampas se sobrepondo)
        used.update(range(u, d + w))
        used.difference_update(range(u + w, d))  # mas aceita saltos/lombadas em cima

    straight = lambda i: codes[i % n] in 'SUDB'  # noqa: E731
    # saltos contínuos: J com reta antes (embalo) e duas retas de pouso (o voo passa de uma casa)
    for _ in range(cfg['jumps']):
        cands = [i for i in range(1, n - 5) if free(i) and free(i + 1) and straight(i + 2) and straight(i - 1)]
        if not cands:
            break
        i = rng.choice(cands)
        codes[i] = 'J'
        used.update({i - 1, i, i + 1, i + 2})

    # lombadas longe de curva (o carro pula nelas e sairia por cima da mureta)
    for _ in range(cfg['bumps']):
        cands = [i for i in range(1, n - 3) if free(i) and straight(i + 1)]
        if not cands:
            break
        i = rng.choice(cands)
        codes[i] = 'B'
        used.add(i)

    def warp_ok(i, sign):
        if not free(i):
            return False
        # warp reverso longe de rampa de salto/vão (senão vira armadilha impossível)
        if sign < 0 and any(codes[(i + t) % n] in 'JG' for t in range(1, 4)):
            return False
        return True

    for sign, count in ((1, cfg['warps']), (-1, cfg['reverse'])):
        for _ in range(count):
            cands = [i for i in range(1, n - 3) if warp_ok(i, sign)]
            if not cands:
                break
            i = rng.choice(cands)
            mods[i] = '>' if sign > 0 else '<'
            used.add(i)
    return ' '.join(c + m for c, m in zip(codes, mods))


RELEVO = 'scripts/pistas/relevo.json'


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
            layout, puddles = decorate(codes, p, t['race']), None
        rows.append((p, t['race'], NAMES[p][t['race'] - 1], layout, len(puddles) if puddles is not None else CFG[p]['slime'], puddles))
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

export const TRACKS: TrackDef[] = [""")
    last = None
    for p, race, name, layout, slime, puddles in rows:
        if p != last:
            out.append(f'  // {PLANET_NAME[p]}')
            last = p
        extra = f', {slime}' if slime or puddles else ''
        if puddles:
            extra += f", [{', '.join(map(str, puddles))}]"
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
    open('src/data/tracks/index.ts', 'w', encoding='utf8', newline='\n').write('\n'.join(out))
    print(len(rows), 'pistas')


main()
