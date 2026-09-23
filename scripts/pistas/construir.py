"""
Constrói o traçado das 36 pistas originais a partir dos minimapas do jogo.

As pistas do original ficam numa grade de 8x8 casas; no minimapa cada casa mede 8 px e o centro
das casas fica em 11 + 8*i. Cada casa vira exatamente uma peça do nosso formato:
    S reta · L/R curva de 90° · J rampa de salto · G vão sem chão (voo) · F largada
O sentido da corrida vem da seta vermelha no mapa completo de cada pista (VGMaps).

Pontas soltas (a estrada some e reaparece alinhada, às vezes com outra estrada passando no meio)
são saltos: a casa antes do vão vira J, as casas do vão viram G.

Uso: python scripts/pistas/construir.py scripts/pistas/tracado.json [pastaDebug]
"""
import json
import sys
from collections import deque

from PIL import Image, ImageDraw

MAPS = 'referencias/snes/mapas/'
SRC = MAPS + 'Tracks(In-GameMaps).png'
PLANETS = ['chem6', 'drakonis', 'bogmire', 'newmojave', 'nho', 'inferno']
FILES = ['ChemVI', 'Drakonis', 'Bogmire', 'NewMojave', 'Nho', 'Inferno']
COUNTS = [4, 5, 6, 7, 7, 7]
LINE = (68, 68, 68)
CELL = 80
N = 8
C0 = 11  # centro da casa 0 na máscara (a máscara começa 1 px dentro da célula)
DIRS = {(1, 0): 'E', (-1, 0): 'W', (0, 1): 'S', (0, -1): 'N'}


def analyse(im, px, py):
    w = h = CELL - 1
    m = [[im.getpixel((px + 1 + x, py + 1 + y)) == LINE for x in range(w)] for y in range(h)]
    lab = [[-1] * w for _ in range(h)]
    regs = []
    for y in range(h):
        for x in range(w):
            if m[y][x] or lab[y][x] >= 0:
                continue
            q = deque([(x, y)])
            lab[y][x] = len(regs)
            border = False
            while q:
                cx, cy = q.popleft()
                if cx in (0, w - 1) or cy in (0, h - 1):
                    border = True
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not m[ny][nx] and lab[ny][nx] < 0:
                        lab[ny][nx] = len(regs)
                        q.append((nx, ny))
            regs.append(border)
    adj = [set() for _ in regs]
    for y in range(h):
        for x in range(w):
            if m[y][x]:
                labs = {lab[y + dy][x + dx] for dx in (-1, 0, 1) for dy in (-1, 0, 1) if 0 <= x + dx < w and 0 <= y + dy < h and lab[y + dy][x + dx] >= 0}
                for a in labs:
                    adj[a] |= labs - {a}
    depth = [None] * len(regs)
    q = deque(i for i, b in enumerate(regs) if b)
    for i in q:
        depth[i] = 0
    while q:
        i = q.popleft()
        for j in adj[i]:
            if depth[j] is None:
                depth[j] = depth[i] + 1
                q.append(j)
    corr = [[(not m[y][x]) and depth[lab[y][x]] is not None and depth[lab[y][x]] % 2 == 1 for x in range(w)] for y in range(h)]
    marker = set()
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if m[y][x] and all(m[y + dy][x + dx] or corr[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                marker.add((x, y))
    return m, corr, marker, w, h


OFF = [C0, C0]


def ctr(i, axis=0):
    return OFF[axis] + 8 * i


def build(im, pi, ri, arrow):
    px = 92 + ri * CELL
    py = 35 + pi * CELL
    m, corr, marker, w, h = analyse(im, px, py)

    def ok(x, y):
        return 0 <= x < w and 0 <= y < h and (corr[y][x] or (x, y) in marker)

    # grade: algumas pistas usam casas deslocadas meia casa; testa os deslocamentos
    def score(ox, oy):
        OFF[0], OFF[1] = ox, oy
        return sum(1 for j in range(N) for i in range(N) for d in DIRS if edge(i, j, d[0], d[1]))

    def edge(i, j, di, dj):
        a = (ctr(i), ctr(j, 1))
        if not (0 <= i + di < N and 0 <= j + dj < N):
            return False
        if not ok(*a):
            return False
        # a faixa central (3 px de largura) entre os dois centros precisa ser corredor
        for t in range(1, 8):
            x = a[0] + di * t
            y = a[1] + dj * t
            if not ok(x, y):
                return False
        return True

    best_off = max(((ox, oy) for ox in (C0, C0 + 4) for oy in (C0, C0 + 4)), key=lambda o: score(*o))
    OFF[0], OFF[1] = best_off
    node = [[ok(ctr(i), ctr(j, 1)) for i in range(N)] for j in range(N)]
    E = {}
    for j in range(N):
        for i in range(N):
            if not node[j][i]:
                continue
            E[(i, j)] = [d for d in DIRS if edge(i, j, d[0], d[1])]

    # largada: pixels de marca -> aresta onde estão
    if not marker:
        raise RuntimeError('sem marca de largada')
    mx = sum(p[0] for p in marker) / len(marker)
    my = sum(p[1] for p in marker) / len(marker)
    d = arrow
    # a marca fica numa aresta entre duas casas vizinhas no sentido da seta; escolhe a aresta
    # existente mais próxima da marca. A peça F é a casa à frente da fronteira.
    best = None
    ax = 0 if d[0] != 0 else 1
    for j0 in range(N):
        for i0 in range(N):
            if d[0] != 0:
                if i0 + 1 >= N or (1, 0) not in E.get((i0, j0), []):
                    continue
                bxp, byp = ctr(i0) + 4, ctr(j0, 1)
            else:
                if j0 + 1 >= N or (0, 1) not in E.get((i0, j0), []):
                    continue
                bxp, byp = ctr(i0), ctr(j0, 1) + 4
            dist = abs(bxp - mx) + abs(byp - my)
            if best is None or dist < best[0]:
                best = (dist, i0, j0)
    if best is None:
        raise RuntimeError('largada não encontrada')
    _, i0, j0 = best
    if d[0] != 0:
        fi, fj = (i0 + 1 if d[0] > 0 else i0), j0
    else:
        fi, fj = i0, (j0 + 1 if d[1] > 0 else j0)

    def options(i, j, d, by_air):
        """Direções possíveis ao sair da casa (i, j) chegando com direção d."""
        if not node[j][i] or by_air:
            return [d]  # voando (ou pousando depois de um vão): segue reto
        opts = E.get((i, j), [])
        back = (-d[0], -d[1])
        fwd = [o for o in opts if o != back]
        if len(opts) >= 4:
            return [d]  # cruzamento: segue reto
        if not fwd:
            return [d]  # ponta solta: salta reto
        return fwd

    best_cycle = None
    sys.setrecursionlimit(10000)

    def dfs(i, j, d, path, used, air, by_air=False):
        nonlocal best_cycle
        if len(path) > 120:
            return
        for nd in options(i, j, d, by_air):
            ni, nj = i + nd[0], j + nd[1]
            if not (0 <= ni < N and 0 <= nj < N):
                continue
            key = frozenset(((i, j), (ni, nj)))
            if key in used:
                continue
            nair = 0 if node[nj][ni] else air + 1
            if nair > 3:
                continue
            if (ni, nj) == (fi, fj) and nd == arrow:
                cyc = path + [(i, j, nd)]
                cover = len({(a, b) for a, b, _ in cyc if node[b][a]})
                sc = (cover, len(cyc))
                if best_cycle is None or sc > best_cycle[0]:
                    best_cycle = (sc, cyc)
                continue
            used.add(key)
            path.append((i, j, nd))
            linked = node[j][i] and nd in E.get((i, j), [])
            dfs(ni, nj, nd, path, used, nair, not linked)
            path.pop()
            used.discard(key)

    dfs(fi, fj, arrow, [], set(), 0)
    if not best_cycle:
        raise RuntimeError('nenhum circuito fecha na largada')
    cyc = best_cycle[1]
    tiles = [(a, b, 'road' if node[b][a] else 'gap') for a, b, _ in cyc]
    dirs = [arrow] + [nd for _, _, nd in cyc[:-1]]

    # códigos: curva quando a direção de saída difere da de entrada
    n = len(tiles)
    codes = []
    for k in range(n):
        din = dirs[k]
        dout = dirs[(k + 1) % n]
        if tiles[k][2] == 'gap':
            codes.append('G')
            continue
        if din == dout:
            codes.append('S')
        else:
            # tela: x para a direita, y para baixo. Esquerda = anti-horário na tela.
            cross = din[0] * dout[1] - din[1] * dout[0]
            codes.append('R' if cross > 0 else 'L')
    # casa antes de um vão vira rampa de salto
    for k in range(n):
        if codes[k] == 'G' and codes[k - 1] not in ('G',):
            if codes[k - 1] == 'S':
                codes[k - 1] = 'J'
            elif codes[k - 1] == 'F':
                pass
            else:
                raise RuntimeError(f'vão depois de curva na casa {k}')
    # casas percorridas duas vezes = cruzamento no mesmo nível (as duas passagens têm de ser retas)
    seen = {}
    for k, t in enumerate(tiles):
        seen.setdefault((t[0], t[1]), []).append(k)
    for ks in seen.values():
        if len(ks) > 1:
            for k in ks:
                if codes[k] not in ('S', 'G'):
                    raise RuntimeError(f'cruzamento com curva na casa {tiles[k][:2]}')
                if codes[k] == 'S':
                    codes[k] = 'X'
            for k in ks:
                if codes[k - 1] == 'J' and codes[k] == 'X':
                    pass
    if codes[0] != 'S':
        k = next((k for k in list(range(-1, -n, -1)) if codes[k] == 'S'), None)
        if k is None:
            raise RuntimeError('sem reta para a largada')
        codes = codes[k:] + codes[:k]
        tiles = tiles[k:] + tiles[:k]
    codes[0] = 'F'
    unused = [(a, b) for (a, b) in E if all((t[0], t[1]) != (a, b) for t in tiles)]
    start_tile = tiles[0]
    return {'codes': codes, 'tiles': tiles, 'start': (start_tile[0], start_tile[1]), 'off': list(OFF), 'unused': unused, 'E': E, 'node': node}


def arrow_of(fname):
    im = Image.open(MAPS + fname).convert('RGB')
    red = [(x, y) for x in range(0, 90) for y in range(0, 90) if (lambda p: p[0] > 200 and p[1] < 60 and p[2] < 60)(im.getpixel((x, y)))]
    if not red:
        return None, None
    xs = [p[0] for p in red]
    ys = [p[1] for p in red]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    if x1 - x0 >= y1 - y0:
        # horizontal: a ponta (cabeça) é o lado com colunas mais altas
        col = {}
        for x, y in red:
            col[x] = col.get(x, 0) + 1
        left = sum(col.get(x, 0) for x in range(x0, x0 + 3))
        right = sum(col.get(x, 0) for x in range(x1 - 2, x1 + 1))
        return ((-1, 0) if left > right else (1, 0)), ((x0 + x1) / 2, (y0 + y1) / 2)
    row = {}
    for x, y in red:
        row[y] = row.get(y, 0) + 1
    top = sum(row.get(y, 0) for y in range(y0, y0 + 3))
    bot = sum(row.get(y, 0) for y in range(y1 - 2, y1 + 1))
    return ((0, -1) if top > bot else (0, 1)), ((x0 + x1) / 2, (y0 + y1) / 2)


def main():
    out = sys.argv[1]
    dbg = sys.argv[2] if len(sys.argv) > 2 else None
    im = Image.open(SRC).convert('RGB')
    res = []
    for pi, planet in enumerate(PLANETS):
        for ri in range(COUNTS[pi]):
            fname = f'{FILES[pi]}-DivisionsBA-Track{ri + 1}.png'
            arrow, apos = arrow_of(fname)
            entry = {'planet': planet, 'race': ri + 1, 'arrow': arrow}
            try:
                r = build(im, pi, ri, arrow)
                entry.update(layout=' '.join(r['codes']), tiles=len(r['codes']), unused=r['unused'])
            except Exception as e:  # noqa: BLE001
                r = None
                entry['erro'] = str(e)
            res.append(entry)
            print(planet, ri + 1, arrow, entry.get('tiles'), entry.get('erro', ''), ('SOBRAM ' + str(entry.get('unused'))) if entry.get('unused') else '')
            if dbg:
                S = 8
                img = Image.new('RGB', (79 * S, 79 * S), 'white')
                dr = ImageDraw.Draw(img)
                m, corr, marker, w, h = analyse(im, 92 + ri * CELL, 35 + pi * CELL)
                for y in range(h):
                    for x in range(w):
                        c = (60, 60, 60) if m[y][x] else (225, 225, 225) if corr[y][x] else None
                        if c:
                            dr.rectangle([x * S, y * S, x * S + S - 1, y * S + S - 1], fill=c)
                if r:
                    pts = r['tiles']
                    for k in range(len(pts)):
                        a = pts[k]
                        b = pts[(k + 1) % len(pts)]
                        col = (230, 0, 230) if a[2] == 'gap' or b[2] == 'gap' else (0, 160, 0)
                        dr.line([ctr(a[0]) * S + 4, ctr(a[1], 1) * S + 4, ctr(b[0]) * S + 4, ctr(b[1], 1) * S + 4], fill=col, width=5)
                    for k, (a, b2, _) in enumerate(pts):
                        dr.text((ctr(a) * S + 8, ctr(b2, 1) * S - 12), r['codes'][k], fill=(200, 0, 0))
                    fi, fj = r['start']
                    dr.ellipse([ctr(fi) * S - 10, ctr(fj, 1) * S - 10, ctr(fi) * S + 18, ctr(fj, 1) * S + 18], outline=(0, 90, 255), width=4)
                dr.text((10, 10), f"{planet} {ri + 1} seta {arrow} {entry.get('erro', '')}", fill=(0, 0, 0))
                img.save(f'{dbg}/{planet}_{ri + 1}.png')
    json.dump(res, open(out, 'w', encoding='utf8'), indent=1, ensure_ascii=False)


main()
