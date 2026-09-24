"""
Pós-tratamento das falas do locutor (roda depois de gerar.py; só precisa de ffmpeg, numpy e scipy).

  1. Rejeita takes sem emoção (F0 mediano < 150 Hz ou faixa de entonação estreita) quando a frase
     tem outras versões: tira do manifest e apaga o mp3. A lista vem da medição de F0 abaixo e da
     avaliação de som (`REJEITAR`).
  2. Apara silêncio no começo/fim e encurta pausas internas longas (sem cortar palavras).
  3. Nomes com voz grave demais (F0 < 150 Hz) sobem de tom (rubberband, preservando formantes):
     o nome não tem outra versão para trocar.
  4. Exclamações longas ficam mais rápidas (sem mudar o tom), até 1,25x: exclamações ≤ 1,5 s,
     largada ≤ 2,5 s, demais frases ≤ 2,2 s, quando possível.
  5. Normaliza o loudness de todas as falas para o mesmo nível (LOUD_ALVO LUFS) e limita o pico.

Uso: python scripts/locutor/tratar.py [--medir]   (--medir só imprime duração, LUFS e F0)
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
REJEITAR = {'hotFury_0.mp3', 'fadesLast_0.mp3', 'start_3.mp3', 'wipedOut_2.mp3', 'jamsFirst_0.mp3'}
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
    r = run([FFMPEG, '-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-']).stderr
    v = re.findall(r'I:\s+(-?[\d.]+) LUFS', r)
    return float(v[-1]) if v else -70.0


def f0(path):
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
    if m.get('tratado') and '--forcar' not in sys.argv:
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
    used = sorted({f for lst in m['lines'].values() for f in lst})

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
        # 3. nome grave demais sobe de tom
        med, _ = f0(a)
        if name and 0 < med < 150:
            semis = 3 if med < 135 else 1.5
            chain.append(f'rubberband=pitch={2 ** (semis / 12):.4f}:formant=preserved')
            print(f'{f}: F0 {med:.0f} Hz, +{semis} semitons')
        # 4. frases longas mais rápidas (tom igual)
        d = duration(a)
        alvo = 1.5 if k in EXCLAMACAO else 2.5 if k == 'start' else 2.2
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
    m['tratamento'] = f'tratar.py: {LOUD_ALVO} LUFS, silêncio aparado, nomes graves afinados, frases longas aceleradas'
    json.dump(m, open(mpath, 'w', encoding='utf8'), indent=2, ensure_ascii=False)
    print('ok:', len(used), 'falas')


if __name__ == '__main__':
    main()
