"""
Locutor "radical" com Chatterbox TTS (Resemble AI, licença MIT): clona uma voz de referência HUMANA,
MASCULINA e GRAVE de apresentador de ringue (scripts/locutor/voz-referencia-luta.wav, recortada de
"Boxing announcement Ladies and Gentleman" de klankbeeld, Freesound 387839, CC-BY 4.0) com exagero
emocional moderado-alto (1,0–1,35) e CFG baixo (0,25–0,35): narrador de arena/luta livre gritando.
Exagero acima de ~1,4 empurra a voz para o agudo (F0 ~300 Hz, "estridente"): por isso a faixa menor.

Duas fases (a geração é lenta em CPU, ~100 s por take; rode em paralelo com --parte):
  1. gerar:    vários takes por frase e bordões gravados inteiros ("NOME jams into first!", "NOME gets
               HAMMERED!"...) vão para .tts/takes-luta/*.wav (+ .json com texto, exagero, cfg, semente).
               Ordem por prioridade (frases e "jams into first" antes dos outros bordões), em rodadas:
               se a geração for interrompida, tudo o que é essencial já tem versão. Retoma de onde parou.
  2. escolher: o Whisper confere o texto de cada take; entre os fiéis, fica com os de mais emoção NA
               FAIXA GRAVE (F0 mediano entre 130 e 220 Hz e faixa de F0 >= 12 semitons; medido pelo
               Praat), aplica o tratamento de arena e escreve public/audio/locutor/*.mp3 +
               manifest.json. Os nomes são recortados dos bordões fiéis; take que não bate com o texto
               nunca vai para o jogo.
Depois rode tratar.py --forcar (loudness igual, silêncio aparado).

Instalação (CPU basta):
  uv venv -p 3.11 .tts && uv pip install --python .tts/Scripts/python.exe chatterbox-tts faster-whisper scipy \
     --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
Uso: .tts/Scripts/python.exe scripts/locutor/gerar.py gerar [--parte 0/3] [--threads 4] [--chave start,lastLap]
     .tts/Scripts/python.exe scripts/locutor/gerar.py escolher
Saída: public/audio/locutor/*.mp3 + manifest.json (mesmo formato que o jogo lê, mais "combos").
"""
import difflib, glob, json, os, random, re, shutil, subprocess, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'audio', 'locutor')
REF = os.path.join(HERE, 'voz-referencia-luta.wav')
TAKES = os.path.join(HERE, '..', '..', '.tts', 'takes-luta')
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
EXAG = (1.0, 1.35)  # 0.5 = neutro; >1 = gritado/teatral (sorteado por take nesta faixa)
CFG = (0.25, 0.35)  # menor = fala mais solta e rápida (combina com exagero alto)
# Nome sozinho ("Viper!") com exagero alto alucina quase sempre (fala outra coisa): os nomes são
# recortados (Whisper, tempo por palavra) dos bordões "NOME jams into first!" fiéis ao texto.
TAKES_FRASE, TAKES_NOME = 4, 0
# bordões: "jams into first" dá os nomes (prioridade alta); os outros são extras (prioridade baixa)
TAKES_BORDAO = {'jamsFirst': 3}
TAKES_BORDAO_EXTRA = 1
# frases que saíram com poucos takes fiéis ganham mais tentativas
TAKES_EXTRA = {'spinOut': 6, 'launches': 6, 'finishSecond': 6, 'powersUp': 6, 'lost': 6, 'aboutToBlow': 5,
               'avoidMines': 5, 'hammered': 5, 'lightsUp': 5, 'fadesLast': 5}
MANTER_FRASE, MANTER_NOME = 3, 3
# voz grave de arena: F0 mediano entre 130 e 220 Hz (acima disso soa estridente) e entonação viva
F0_FAIXA, F0_MIN, F0_MAX, F0_ALVO, FIDEL = 12.0, 130.0, 220.0, 175.0, 0.85
# bordões gravados inteiros ("Viper jams into first!"): soam como uma frase só, sem emenda
BORDOES = {
    'jamsFirst': '{n} jams into first!',
    'hammered': '{n} gets HAMMERED!',
    'aboutToBlow': '{n} is about to BLOW!',
    'dominating': '{n} is DOMINATING the race!',
    'finishFirst': '{n} scores a first place KNOCKOUT!',
    'lightsUp': '{n} lights him UP!',
}

# Como no original: NOME + FRASE ("Olaf unleashes hot fury!"). Frases de nome começam minúsculas.
NAMES = ['Olaf', 'Ivan', 'Hawk', 'Kat', 'Snake', 'Jake', 'Tarquinn', 'Roadkill', 'Butcher', 'Slash', 'Rage', 'Grinder', 'Viper', 'Rip', 'Shred']
LINES = {
    'start': ['The stage is set... the green flag drops! LET\'S ROCK!', 'Let the CARNAGE begin!', 'Gentlemen... START YOUR ENGINES! Yeah!', 'Crank it up to eleven, baby!'],
    'lastLap': ['LAST LAP! This is it!', 'One lap to go! Floor it!', 'LAST LAP! Rock and roll, baby!'],
    'ouch': ['OUCH!', 'Ouch! That HURT!', "Oooh, that's gotta hurt!"],
    'wow': ['WOW!', 'WOW! Did you SEE that?!', 'Whoa, whoa, WHOA!'],
    'holyToledo': ['HOLY TOLEDO!', 'Holy TOLEDO!!', 'Holy smokes, what a HIT!'],
    'jamsFirst': ['jams into first!', 'TAKES THE LEAD!', 'blasts into first place! Yeah!'],
    'fadesLast': ['fades into last!', 'drops to the back of the pack!'],
    'dominating': ['is DOMINATING the race!', 'is in another time zone!', 'is UNSTOPPABLE!'],
    'finishFirst': ['scores a first place KNOCKOUT!', 'WINS IT! What a RACE!'],
    'finishSecond': ['finishes second!', 'takes second place!'],
    'finishThird': ['takes a weak third!', 'limps home in third!'],
    'hotFury': ['unleashes HOT FURY!', 'lets it RIP!', 'brings the THUNDER!'],
    'lightsUp': ['lights him UP!', 'LIGHTS HIM UP!', 'lights up the competition!'],
    'hammered': ['gets HAMMERED!', 'takes a BEATING!', 'gets totally WRECKED!'],
    'aboutToBlow': ['is about to BLOW!', 'is gonna BLOW!'],
    'avoidMines': ['should avoid mines!', 'hits a mine! KABOOM!'],
    'wipedOut': ['is WIPED OUT!', 'is TOAST!', 'goes up in SMOKE!'],
    'launches': ['launches himself!', 'takes to the AIR!', 'FLIES!'],
    'warp': ['hits the warp!', 'hits the warp! ZOOM!'],
    'powersUp': ['powers UP!', 'POWERS UP! Oh yeah!'],
    'spinOut': ['spins OUT!', 'LOSES IT!', 'spins like a RECORD!'],
    'wrongWay': ['is headed the WRONG WAY!', 'wrong way, BUDDY!'],
    'lost': ['looks LOST out there!', 'needs a MAP!'],
    'powerOff': ['is out of AMMO!', 'is running on EMPTY!'],
}


# tratamento de arena: corpo, presença +2 dB, compressão leve e um eco só, curto (28 ms; rodada 11: os
# ecos de 45 e 110 ms borravam as sílabas do grito). Rodada 12: sem saturação e presença menor (era
# +4 dB): a emoção vem do take gritado, não de EQ/saturação sobre o TTS
ARENA_FILTER = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
                'highpass=f=85,equalizer=f=220:t=q:w=0.8:g=2,equalizer=f=3000:t=q:w=0.9:g=2,'
                'acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2,'
                'aecho=0.8:0.5:28:0.08,apad=pad_dur=0.15,alimiter=limit=0.89')
# grito (itens 32/53): taxa mínima de sílabas e F0 mediano máximo aceitável antes do tratar.py
# (que baixa até 4 semitons o que passar de 225 Hz)
TAXA_MIN, F0_TETO_REFAZER = 4.5, 265.0
# rodada 12: faixa de F0 mínima (semitons) e loudness momentâneo máximo da fala tratada (LUFS)
FAIXA_MIN_REFAZER, LOUD_MIN_REFAZER = 8.0, -15.0


def slug(n):
    return re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')


for _n in NAMES:
    LINES['name:' + slug(_n)] = [f'{_n}!']


def jobs_all():
    """
    (id, chave, texto) de todos os takes; ids estáveis para retomar e dividir entre processos.
    Ordem em rodadas (o 1º take de tudo, depois o 2º...): se a geração for interrompida, todas as
    frases já têm alguma versão nova.
    """
    by_round = {}
    for key, lst in LINES.items():
        n = TAKES_NOME if key.startswith('name:') else TAKES_EXTRA.get(key, TAKES_FRASE)
        for t in range(n):
            i = t % len(lst)
            by_round.setdefault(t, []).append((f"{key.replace(':', '_')}__{i}__{t}", key, lst[i]))
    extra = {}
    for key, tpl in BORDOES.items():
        for n in NAMES:
            for t in range(TAKES_BORDAO.get(key, TAKES_BORDAO_EXTRA)):
                job = (f'combo_{key}_{slug(n)}__0__{t}', f'combo:{key}:{slug(n)}', tpl.format(n=n))
                # "jams into first" (dá os nomes) entra nas rodadas principais; os demais bordões depois
                (by_round if key in TAKES_BORDAO else extra).setdefault(t, []).append(job)
    return [j for t in sorted(by_round) for j in by_round[t]] + [j for t in sorted(extra) for j in extra[t]]


def gerar():
    import perth
    if perth.PerthImplicitWatermarker is None:
        perth.PerthImplicitWatermarker = perth.DummyWatermarker
    import torch, torchaudio as ta
    from chatterbox.tts import ChatterboxTTS
    if '--threads' in sys.argv:
        torch.set_num_threads(int(sys.argv[sys.argv.index('--threads') + 1]))
    part, parts = 0, 1
    if '--parte' in sys.argv:
        part, parts = map(int, sys.argv[sys.argv.index('--parte') + 1].split('/'))
    ordem = sys.argv[sys.argv.index('--chave') + 1].split(',') if '--chave' in sys.argv else []
    only = set(ordem) or None
    os.makedirs(TAKES, exist_ok=True)
    # --exag 1.5,1.9 --takes 6: takes EXTRAS (ids novos, a partir do 10º) com mais exagero para as
    # chaves de --chave (itens 32/53: largada e "hot fury" precisam soar gritados)
    exag = tuple(map(float, sys.argv[sys.argv.index('--exag') + 1].split(','))) if '--exag' in sys.argv else EXAG
    extra = int(sys.argv[sys.argv.index('--takes') + 1]) if '--takes' in sys.argv else 0
    desde = int(sys.argv[sys.argv.index('--desde') + 1]) if '--desde' in sys.argv else 10
    jobs = jobs_all()
    if extra and only:
        # na ordem de --chave (prioridade: largada, ataque, explosão, vitória...)
        jobs = [(f"{key}__{t % len(LINES[key])}__{desde + t}", key, LINES[key][t % len(LINES[key])]) for key in ordem for t in range(extra)]
    todo = [j for k, j in enumerate(jobs) if k % parts == part and (not only or j[1] in only or j[1].split(':')[-1] in only)]
    todo = [j for j in todo if not os.path.exists(os.path.join(TAKES, j[0] + '.json'))]
    print(len(todo), 'takes nesta parte', flush=True)
    model = ChatterboxTTS.from_pretrained(device='cpu')
    model.prepare_conditionals(REF, exaggeration=sum(EXAG) / 2)
    # exagero alto + CFG baixo às vezes "dispara" (não para de falar até 1000 tokens, ~40 s e
    # ~10 min de CPU): limita os tokens de fala pelo tamanho do texto (~25 tokens/s)
    cap = {'n': 1000}
    t3_inference = model.t3.inference
    model.t3.inference = lambda *a, **kw: t3_inference(*a, **{**kw, 'max_new_tokens': cap['n']})
    for k, (jid, key, text) in enumerate(todo):
        seed = zlib.crc32(jid.encode()) % 100000
        rnd = random.Random(seed)
        ex, cfg = round(rnd.uniform(*exag), 2), round(rnd.uniform(*CFG), 2)
        torch.manual_seed(seed)
        cap['n'] = int(25 * (1.4 + 0.6 * len(text.split()))) + 15
        w = model.generate(text, exaggeration=ex, cfg_weight=cfg, temperature=0.8)
        ta.save(os.path.join(TAKES, jid + '.wav'), w, model.sr)
        json.dump({'key': key, 'text': text, 'exag': ex, 'cfg': cfg, 'seed': seed},
                  open(os.path.join(TAKES, jid + '.json'), 'w', encoding='utf8'))
        print(f'{k + 1}/{len(todo)} {jid} "{text}" ex {ex} cfg {cfg} {w.shape[-1] / model.sr:.1f}s', flush=True)


def escolher():
    sys.path.insert(0, HERE)
    from tratar import f0
    from faster_whisper import WhisperModel
    whisper = WhisperModel('small.en', device='cpu', compute_type='int8')
    norm = lambda t: re.sub(r'[^a-z]', '', t.lower().replace('11', 'eleven'))
    FILTER = ARENA_FILTER
    # análise (Whisper com tempo por palavra + F0) em cache: rodar de novo só analisa takes novos
    cpath = os.path.join(TAKES, 'analise.json')
    cache = json.load(open(cpath, encoding='utf8')) if os.path.exists(cpath) else {}
    by_key = {}
    for meta in sorted(glob.glob(os.path.join(TAKES, '*__*.json'))):
        m = json.load(open(meta, encoding='utf8'))
        wav = meta[:-5] + '.wav'
        jid = os.path.basename(meta)[:-5]
        if jid not in cache:
            segs, _ = whisper.transcribe(wav, beam_size=3, word_timestamps=True)
            segs = list(segs)
            words = [(w.word, w.start, w.end) for sg in segs for w in (sg.words or [])]
            med, rng = f0(wav)
            cache[jid] = {'heard': ' '.join(x.text for x in segs).strip(), 'words': words, 'med': med, 'rng': rng}
            json.dump(cache, open(cpath, 'w', encoding='utf8'), ensure_ascii=False)
        c = cache[jid]
        fid = difflib.SequenceMatcher(None, norm(c['heard']), norm(m['text'])).ratio()
        heard, cut = c['heard'], None
        # take bom com "lixo" no fim ("What a race! What a re-"): corta depois do trecho fiel ao texto
        words = c['words']
        for k in range(1, len(words)):
            pre = ''.join(w[0] for w in words[:k])
            r = difflib.SequenceMatcher(None, norm(pre), norm(m['text'])).ratio()
            if r > fid + 0.02 and r >= FIDEL and len(norm(pre)) >= len(norm(m['text'])):  # sem perder a última palavra
                fid, heard, cut = r, pre.strip() + ' [cortado]', words[k - 1][2] + 0.12
        if cut:
            cw = os.path.join(TAKES, 'cortes', jid + '.wav')
            os.makedirs(os.path.dirname(cw), exist_ok=True)
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', wav, '-af', f'atrim=0:{cut:.3f},afade=t=out:st={cut - 0.06:.3f}:d=0.06', cw], check=True)
            wav = cw
        m.update(wav=wav, fid=fid, med=c['med'], rng=c['rng'], heard=heard, words=c['words'], ok=fid >= FIDEL,
                 emo=c['rng'] >= F0_FAIXA and F0_MIN <= c['med'] <= F0_MAX)
        by_key.setdefault(m['key'], []).append(m)
        print(f"{jid:36s} fid {fid:.2f} F0 {m['med']:4.0f} Hz faixa {m['rng']:4.1f} st {'EMO' if m['emo'] else '   '} {m['heard']!r}", flush=True)

    if '--so-analise' in sys.argv:  # só adianta o cache (Whisper + F0) enquanto a geração roda
        print('análise em cache:', len(cache), 'takes')
        return

    # nomes: recortados dos bordões fiéis ("Viper jams into first!" -> "Viper"), com folga nas pontas.
    # Uma palavra só tem pouca curva de entonação: o critério de faixa de F0 cai pela metade.
    tmp = os.path.join(TAKES, 'nomes')
    os.makedirs(tmp, exist_ok=True)
    for n in NAMES:
        for t in by_key.get(f'combo:jamsFirst:{slug(n)}', []):
            if not t['ok'] or not t['words']:
                continue
            w0, st, en = t['words'][0]
            if difflib.SequenceMatcher(None, norm(w0), norm(n)).ratio() < 0.6 or len(norm(w0)) > len(norm(n)) + 1:
                continue
            a, b = max(0.0, st - 0.04), en + 0.07
            nw = os.path.join(tmp, os.path.basename(t['wav']))
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', t['wav'], '-af',
                            f'atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,afade=t=out:st={b - a - 0.04:.3f}:d=0.04', nw], check=True)
            med, rng = f0(nw)
            by_key.setdefault(f'name:{slug(n)}', []).append(
                {'key': f'name:{slug(n)}', 'text': n + '!', 'wav': nw, 'fid': 1.0, 'med': med, 'rng': rng, 'heard': w0.strip(),
                 'ok': True, 'emo': rng >= F0_FAIXA / 2 and F0_MIN <= med <= F0_MAX, 'exag': t['exag'], 'cfg': t['cfg']})

    # só takes fiéis ao texto vão para o jogo; chave sem nenhum fica com as falas anteriores
    # (cópia em .tts/locutor-anterior)
    prev_dir = os.path.join(TAKES, '..', 'locutor-anterior')
    old = json.load(open(os.path.join(prev_dir, 'manifest.json'), encoding='utf8'))
    for f in glob.glob(os.path.join(OUT, '*.mp3')):
        os.remove(f)
    manifest = {'voice': 'Chatterbox (MIT) clonando voz masculina de apresentador de ringue (klankbeeld, Freesound 387839, CC-BY 4.0), exagero %.2f-%.2f, cfg %.2f-%.2f' % (*EXAG, *CFG),
                'names': [slug(n) for n in NAMES], 'lines': {}, 'combos': {}}
    rel = {}
    for key in sorted(set(by_key) | set(old['lines'])):
        takes = by_key.get(key, [])
        combo = key.startswith('combo:')
        keep = 1 if combo else MANTER_NOME if key.startswith('name:') else MANTER_FRASE
        good = [t for t in takes if t['ok']]
        # bordão só entra se sair fiel E com entonação viva, sem passar muito do teto de F0 (tratar.py
        # baixa até 4 semitons o que ficar agudo); senão o jogo emenda nome + frase
        pool = [t for t in good if t['rng'] >= F0_FAIXA and F0_MIN <= t['med'] <= F0_MAX + 40] if combo else good
        # emoção na faixa grave primeiro; depois mais entonação e F0 perto do alvo (nem grave morto, nem estridente)
        pool.sort(key=lambda t: (t['emo'], t['rng'] - abs(t['med'] - F0_ALVO) / 12), reverse=True)
        chosen = []
        for t in pool:  # variedade: um take por texto antes de repetir texto
            if len(chosen) < keep and t['text'] not in [c['text'] for c in chosen]:
                chosen.append(t)
        for t in pool:  # completa só com takes que também passaram no critério de emoção
            if len(chosen) < keep and t not in chosen and t['emo']:
                chosen.append(t)
        files = []
        for i, t in enumerate(chosen):
            f = f"{key.replace(':', '_')}_{i}.mp3"
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', t['wav'], '-af', FILTER, '-ar', '44100', '-ac', '1',
                            '-c:a', 'libmp3lame', '-b:a', '96k', os.path.join(OUT, f)], check=True)
            files.append(f)
            rel[f] = {k: t[k] for k in ('text', 'exag', 'cfg', 'fid', 'med', 'rng', 'emo', 'heard')}
        if combo:
            _, line, who = key.split(':')
            if files:
                manifest['combos'].setdefault(line, {})[who] = files
            print(f"{key:26s} {len(files)} de {len(takes)} takes ({len(good)} fiéis)")
            continue
        if not files and key in old['lines']:
            for f in old['lines'][key]:
                shutil.copy(os.path.join(prev_dir, f), os.path.join(OUT, f))
                files.append(f)
            print(f"{key:26s} sem take novo fiel: mantidas {len(files)} falas anteriores")
        else:
            print(f"{key:26s} {len(files)} de {len(takes)} takes ({len(good)} fiéis, {sum(t['emo'] for t in good)} fiéis com emoção)")
        manifest['lines'][key] = files
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf8'), indent=2, ensure_ascii=False)
    json.dump(rel, open(os.path.join(TAKES, 'escolha.json'), 'w', encoding='utf8'), indent=1, ensure_ascii=False)
    print('pronto')


def refazer():
    """
    Regrava só as chaves de --chave (ex.: start,hotFury ou combo:jamsFirst:viper) com os takes que
    passam no GRITO (rodada 12): texto fiel (Whisper), F0 mediano até F0_TETO_REFAZER (sem voz fina),
    faixa de F0 >= FAIXA_MIN_REFAZER semitons, loudness momentâneo máximo >= LOUD_MIN_REFAZER LUFS e
    >= TAXA_MIN sílabas/s — as três últimas medidas na fala já com o tratamento de arena e normalizada
    como o tratar.py faz (o "cru" de som() em scripts/evidencias.mjs). Chave sem take aprovado fica
    com as falas atuais (listadas em .tts/takes-luta/refazer.json, "mantidas").
    Análise em cache (.tts/takes-luta/analise-r12.json); --so-analise só mede. Troca os mp3 e o
    manifest só dessas chaves; depois rode tratar.py --so <chaves>.
    """
    sys.path.insert(0, HERE)
    from tratar import f0, emocao, loudness_max, duration, EXCLAMACAO
    keys = sys.argv[sys.argv.index('--chave') + 1].split(',')
    so_analise = '--so-analise' in sys.argv
    whisper = None
    norm = lambda t: re.sub(r'[^a-z]', '', t.lower().replace('11', 'eleven'))
    ref_esf, ref_taxa = map(float, emocao(REF, so_gritado=True))
    print(f'referência gritada: esforço {ref_esf} dB, {ref_taxa} sílabas/s (mínimo exigido {TAXA_MIN})')
    mpath = os.path.join(OUT, 'manifest.json')
    man = json.load(open(mpath, encoding='utf8'))
    cpath = os.path.join(TAKES, 'analise-r12.json')
    cache = json.load(open(cpath, encoding='utf8')) if os.path.exists(cpath) else {}
    rpath = os.path.join(TAKES, 'refazer.json')
    rel = json.load(open(rpath, encoding='utf8')) if os.path.exists(rpath) else {}
    rel.setdefault('chaves', {})
    rel.setdefault('mantidas', {})
    rel['referencia'] = {'esforco': ref_esf, 'silabas': ref_taxa}
    rel['criterio'] = {'faixaF0_st': FAIXA_MIN_REFAZER, 'loudnessCruMax_LUFS': LOUD_MIN_REFAZER, 'silabasPorSeg': TAXA_MIN,
                       'f0Teto_Hz': F0_TETO_REFAZER, 'fidelidade': FIDEL}
    tmp = os.path.join(TAKES, 'arena-r12')
    os.makedirs(tmp, exist_ok=True)
    for key in keys:
        combo = key.startswith('combo:')
        base = key.replace(':', '_')
        takes = []
        for meta in sorted(glob.glob(os.path.join(TAKES, f'{base}__*.json'))):
            m = json.load(open(meta, encoding='utf8'))
            wav = meta[:-5] + '.wav'
            jid = os.path.basename(meta)[:-5]
            if not os.path.exists(wav):
                continue
            if jid not in cache:
                if whisper is None:
                    from faster_whisper import WhisperModel
                    whisper = WhisperModel('small.en', device='cpu', compute_type='int8')
                heard = ' '.join(x.text for x in whisper.transcribe(wav, beam_size=3)[0]).strip()
                med, rng = f0(wav)
                arena = os.path.join(tmp, jid + '.wav')
                subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', wav, '-af', ARENA_FILTER, '-ar', '44100', '-ac', '1', arena], check=True)
                esf, taxa = emocao(arena)
                cache[jid] = {'heard': heard, 'med': round(med), 'rng': round(rng, 1), 'esforco': esf, 'silabas': taxa, 'lufs': loudness_max(arena)}
                json.dump(cache, open(cpath, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
            c = cache[jid]
            if 'dur' not in c:
                arena = os.path.join(tmp, jid + '.wav')
                c['dur'] = round(duration(arena) - 0.15, 2) if os.path.exists(arena) else 0.0
                json.dump(cache, open(cpath, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
            fid = difflib.SequenceMatcher(None, norm(c['heard']), norm(m['text'])).ratio()
            t = {**m, **c, 'wav': wav, 'fid': round(fid, 2)}
            # o tratar.py acelera frases longas (até 1,25x, tom igual): a taxa no jogo sobe junto
            k0 = key.split(':')[1] if combo else key
            alvo = 1.5 if k0 in EXCLAMACAO else 3.0 if k0 == 'start' else 2.2
            tempo = min(1.25, c['dur'] / alvo) if c['dur'] > alvo * 1.03 else 1.0
            t['silabas'] = round(c['silabas'] * tempo, 2)
            t['aprovado'] = bool(fid >= FIDEL and 0 < t['med'] <= F0_TETO_REFAZER and t['rng'] >= FAIXA_MIN_REFAZER
                                 and t['lufs'] >= LOUD_MIN_REFAZER and t['silabas'] >= TAXA_MIN)
            takes.append(t)
            print(f"{jid:34s} fid {fid:.2f} F0 {t['med']:4.0f} faixa {t['rng']:4.1f} LUFS {t['lufs']:5.1f} esforço {t['esforco']:6.1f} "
                  f"sílabas {t['silabas']:4.2f} {'OK' if t['aprovado'] else '  '} {c['heard']!r}", flush=True)
        if so_analise:
            continue
        pool = [t for t in takes if t['aprovado']]
        # mais perto do esforço da referência gritada (nem abafado, nem estridente), mais entonação e
        # fala mais rápida; um take por texto antes de repetir
        pool.sort(key=lambda t: t['rng'] / 3 + 2 * min(t['silabas'], 6) - abs(t['esforco'] - ref_esf), reverse=True)
        if combo:
            _, line, who = key.split(':')
            cur = man.get('combos', {}).get(line, {}).get(who, [])
        else:
            cur = man['lines'].get(key, [])
        keep = 1 if combo else len(cur) or MANTER_FRASE
        chosen = []
        for t in pool:
            if len(chosen) < keep and t['text'] not in [c['text'] for c in chosen]:
                chosen.append(t)
        for t in pool:
            if len(chosen) < keep and t not in chosen:
                chosen.append(t)
        if not chosen:
            print(key, f'sem take aprovado ({len(takes)} takes): mantidas as falas atuais')
            rel['mantidas'][key] = cur
            continue
        rel['mantidas'].pop(key, None)
        for f in cur:
            try:
                os.remove(os.path.join(OUT, f))
            except FileNotFoundError:
                pass
        files = []
        for i, t in enumerate(chosen):
            f = f'{base}_{i}.mp3'
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', t['wav'], '-af', ARENA_FILTER, '-ar', '44100', '-ac', '1',
                            '-c:a', 'libmp3lame', '-b:a', '96k', os.path.join(OUT, f)], check=True)
            files.append(f)
        if combo:
            man.setdefault('combos', {}).setdefault(line, {})[who] = files
        else:
            man['lines'][key] = files
        rel['chaves'][key] = {f: {k: t[k] for k in ('text', 'exag', 'cfg', 'fid', 'med', 'rng', 'lufs', 'esforco', 'silabas')} for f, t in zip(files, chosen)}
        print(key, '->', files)
    if so_analise:
        return
    man['tratado'] = False
    json.dump(man, open(mpath, 'w', encoding='utf8'), indent=2, ensure_ascii=False)
    json.dump(rel, open(rpath, 'w', encoding='utf8'), indent=1, ensure_ascii=False)
    print('pronto; agora: python scripts/locutor/tratar.py --so', ','.join(k.replace(':', '_') for k in keys))


if __name__ == '__main__':
    if 'refazer' in sys.argv:
        refazer()
    else:
        escolher() if 'escolher' in sys.argv else gerar()
