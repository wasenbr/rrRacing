"""
Pós-tratamento das falas do locutor (roda depois de gerar.py; só precisa de ffmpeg, numpy e scipy).

  1. Rejeita takes reprovados na avaliação de ouvido (`REJEITAR`) quando a frase tem outras versões:
     tira do manifest e apaga o mp3. (gerar.py escolher já prefere takes com F0 mediano entre 130 e
     220 Hz e faixa de entonação >= 12 semitons.)
  2. Apara silêncio no começo/fim e encurta pausas internas longas (sem cortar palavras).
  3. Nada sobe de tom (afinar para cima deixava a voz estridente). Só o contrário: take que ficou
     agudo demais (F0 mediano > 225 Hz) desce até 4 semitons (rubberband, formantes preservados),
     para toda a narração ficar na mesma voz grave de arena.
  4. Exclamações longas ficam mais rápidas (sem mudar o tom), até 1,25x: exclamações ≤ 1,5 s,
     largada ≤ 3,0 s, demais frases ≤ 2,2 s, quando possível.
  5. Normaliza o loudness de todas as falas para o mesmo nível (LOUD_ALVO LUFS) e limita o pico.

Uso: python scripts/locutor/tratar.py [--medir] [--forcar] [--so start]   (--medir só imprime duração, LUFS e F0)
O manifest ganha "tratado": true; rodar de novo não reprocessa (use --forcar depois de gerar.py).
"""
import json, os, re, subprocess, sys, tempfile
import numpy as np
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, '..', '..', 'public', 'audio', 'locutor')
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
LOUD_ALVO = -18.0
PICO = 0.79  # ~ -2 dBFS
# gerar.py escolher já descarta takes sem emoção (F0); aqui só os que a avaliação de ouvido reprovar
REJEITAR: set = set()
AGUDO_MAX, AGUDO_ALVO = 225.0, 205.0
EXCLAMACAO = {'wow', 'ouch', 'holyToledo', 'lastLap'}
SR = 16000


def run(args):
    return subprocess.run(args, capture_output=True, text=True)


def pcm(path):
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.int16).astype(float) / 32768


def duration(path):
    return len(pcm(path)) / SR


def loudness(path):
    # a medida integrada precisa de >= 400 ms: nomes curtos ("Kat!") são medidos repetidos 3x
    r = run([FFMPEG, '-hide_banner', '-i', path, '-af', 'aloop=loop=2:size=2000000,ebur128', '-f', 'null', '-']).stderr
    v = re.findall(r'I:\s+(-?[\d.]+) LUFS', r)
    return float(v[-1]) if v else -70.0


def f0(path):
    """
    F0 mediano (Hz) e faixa de entonação (semitons, percentis 10–90). Usa o Praat (parselmouth,
    GPL; `pip install praat-parselmouth`), que acerta a oitava em voz gritada; sem ele, cai numa
    autocorrelação simples.
    """
    try:
        import parselmouth
    except ImportError:
        return f0_autocorr(path)
    snd = parselmouth.Sound(pcm(path), sampling_frequency=SR)
    a = snd.to_pitch_ac(time_step=0.01, pitch_floor=70, pitch_ceiling=600).selected_array['frequency']
    a = a[a > 0]
    if len(a) < 5:
        return 0.0, 0.0
    return float(np.median(a)), float(12 * np.log2(np.percentile(a, 90) / np.percentile(a, 10)))


def f0_autocorr(path):
    """F0 mediano (Hz) e faixa de entonação (semitons, percentis 10–90) por autocorrelação."""
    x = pcm(path)
    y = sosfilt(butter(4, 900, 'low', fs=SR, output='sos'), x)
    w, hop = int(0.04 * SR), int(0.01 * SR)
    thr = 0.03 * np.abs(x).max()
    out = []
    for i in range(0, len(y) - w, hop):
        if np.sqrt((x[i:i + w] ** 2).mean()) < thr:
            continue
        seg = y[i:i + w] - y[i:i + w].mean()
        ac = np.correlate(seg, seg, 'full')[w - 1:]
        lo, hi = int(SR / 450), int(SR / 70)
        if ac[0] <= 0:
            continue
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] / ac[0] > 0.45:
            out.append(SR / k)
    if len(out) < 5:
        return 0.0, 0.0
    a = np.array(out)
    return float(np.median(a)), float(12 * np.log2(np.percentile(a, 90) / np.percentile(a, 10)))


def gritado(x, db=8.0):
    """Só os trechos gritados: janelas de 400 ms com energia a até `db` do máximo (emendadas)."""
    w, hop = int(0.4 * SR), int(0.1 * SR)
    lv = [10 * np.log10(np.mean(x[s:s + w] ** 2) + 1e-12) for s in range(0, max(1, len(x) - w), hop)]
    top, keep = max(lv), np.zeros(len(x), bool)
    for k, v in enumerate(lv):
        if v > top - db:
            keep[k * hop:k * hop + w] = True
    return x[keep]


def emocao(path, so_gritado=False):
    """
    Métricas de grito (itens 32/53), as mesmas de som() em scripts/evidencias.mjs: esforço vocal =
    energia 2–4 kHz menos 300–800 Hz nos quadros com voz (dB; grito sobe os agudos), sílabas/s =
    picos do envelope 300–3000 Hz (≥ 4 dB de proeminência, ≥ 100 ms entre si) por segundo de fala.
    """
    x = pcm(path)
    if so_gritado:
        x = gritado(x)
    bp = lambda lo, hi: sosfilt(butter(4, [lo, hi], 'band', fs=SR, output='sos'), x)
    fr = int(0.02 * SR)
    nf = len(x) // fr
    e = lambda a, i: float(np.mean(a[i * fr:(i + 1) * fr] ** 2))
    E = np.array([e(x, i) for i in range(nf)])
    hi, lo, sp = bp(2000, 4000), bp(300, 800), bp(300, 3000)
    voz = [i for i in range(nf) if E[i] > E.max() * 1e-3]
    esforco = 10 * np.log10(sum(e(hi, i) for i in voz) / max(1e-12, sum(e(lo, i) for i in voz)))
    h = int(0.01 * SR)
    nb = len(sp) // h
    env = np.array([10 * np.log10(np.mean(sp[i * h:i * h + 4 * h] ** 2) + 1e-12) for i in range(nb)])
    top = env.max()
    picos, ult = 0, -99
    for i in range(1, nb - 1):
        if env[i] >= env[i - 1] and env[i] > env[i + 1] and env[i] > top - 20 and i - ult >= 10:
            if env[i] - max(env[max(0, i - 30):i + 1].min(), env[i:i + 30].min()) >= 4:
                picos, ult = picos + 1, i
    ativo = max(0.1, np.sum(env > top - 25) * 0.01)
    return round(float(esforco), 1), round(float(picos / ativo), 2)


def ffmpeg_filter(src, dst, af):
    r = run([FFMPEG, '-v', 'error', '-y', '-i', src, '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', dst])
    if r.returncode:
        raise RuntimeError(r.stderr)


def key_of(f):
    return f.rsplit('_', 1)[0]


def main():
    mpath = os.path.join(DIR, 'manifest.json')
    m = json.load(open(mpath, encoding='utf8'))
    files = sorted(f for f in os.listdir(DIR) if f.endswith('.mp3'))
    if '--medir' in sys.argv:
        for f in files:
            p = os.path.join(DIR, f)
            med, rng = f0(p)
            print(f'{f:24s} {duration(p):5.2f} s  {loudness(p):6.1f} LUFS  F0 {med:4.0f} Hz  faixa {rng:4.1f} st')
        return
    if m.get('tratado') and '--forcar' not in sys.argv and '--so' not in sys.argv:
        print('já tratado (use --forcar)')
        return

    # 1. rejeitar takes sem emoção, só se a frase tiver outra versão
    for k, lst in m['lines'].items():
        keep = [f for f in lst if f not in REJEITAR]
        if keep and len(keep) < len(lst):
            for f in set(lst) - set(keep):
                print('rejeitado', f)
                try:
                    os.remove(os.path.join(DIR, f))
                except FileNotFoundError:
                    pass
            m['lines'][k] = keep
    used = sorted({f for lst in m['lines'].values() for f in lst} |
                  {f for by in m.get('combos', {}).values() for lst in by.values() for f in lst})

    # --so start,lastLap: trata só essas chaves (as outras falas já tratadas não são recodificadas)
    if '--so' in sys.argv:
        only = set(sys.argv[sys.argv.index('--so') + 1].split(','))
        used = [f for f in used if key_of(f) in only]
    tmp = tempfile.mkdtemp()
    for f in used:
        p = os.path.join(DIR, f)
        k = key_of(f)
        name = f.startswith('name_')
        # 2. silêncio nas pontas e pausas internas longas (> 0,18 s viram 0,1 s)
        trim = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,'
                'areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,'
                'silenceremove=stop_periods=-1:stop_duration=0.18:stop_threshold=-42dB:stop_silence=0.1')
        a = os.path.join(tmp, 'a.mp3')
        ffmpeg_filter(p, a, trim)
        chain = []
        # 3. take agudo demais desce de tom (nunca sobe)
        med, _ = f0(a)
        if med > AGUDO_MAX:
            semis = min(4.0, 12 * np.log2(med / AGUDO_ALVO))
            chain.append(f'rubberband=pitch={2 ** (-semis / 12):.4f}:formant=preserved')
            print(f'{f}: F0 {med:.0f} Hz, -{semis:.1f} semitons')
        # 4. frases longas mais rápidas (tom igual)
        d = duration(a)
        alvo = 1.5 if k in EXCLAMACAO else 3.0 if k == 'start' else 2.2  # largada: acelerar embolava "carnage"
        if not name and d > alvo:
            tempo = min(1.25, d / alvo)
            if tempo > 1.03:
                chain.append(f'rubberband=tempo={tempo:.3f}')
                print(f'{f}: {d:.2f} s -> {d / tempo:.2f} s')
        b = os.path.join(tmp, 'b.mp3')
        ffmpeg_filter(a, b, ','.join(chain) if chain else 'anull')
        # 5. loudness igual para todas + limitador de pico
        gain = LOUD_ALVO - loudness(b)
        ffmpeg_filter(b, p, f'volume={gain:.2f}dB,alimiter=limit={PICO}:attack=1:release=40:level=disabled')
    m['tratado'] = True
    m['tratamento'] = f'tratar.py: {LOUD_ALVO} LUFS, silêncio aparado, takes agudos baixados (> 225 Hz), frases longas aceleradas'
    json.dump(m, open(mpath, 'w', encoding='utf8'), indent=2, ensure_ascii=False)
    print('ok:', len(used), 'falas')


if __name__ == '__main__':
    main()
