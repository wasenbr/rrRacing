"""
Locutor "radical" com Chatterbox TTS (Resemble AI, licença MIT): clona a voz de referência
(Kokoro am_michael, Apache-2.0, gerada por scripts/gerar-locutor.mjs) e aplica EXAGERO emocional alto,
para soar como narrador de arena gritando, não como leitura monótona.

Instalação (CPU basta, ~30 s por fala):
  uv venv -p 3.11 .tts && uv pip install --python .tts/Scripts/python.exe chatterbox-tts \
     --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
Opcional (confere cada fala e refaz as que saírem erradas): uv pip install faster-whisper
Uso: .tts/Scripts/python.exe scripts/locutor/gerar.py [--so-faltando] [--chave start,lastLap]
Saída: public/audio/locutor/*.mp3 + manifest.json (mesmo formato que o jogo lê).
"""
import difflib, json, os, re, subprocess, sys, tempfile
import perth
if perth.PerthImplicitWatermarker is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker
import torch, torchaudio as ta
from chatterbox.tts import ChatterboxTTS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'audio', 'locutor')
REF = os.path.join(HERE, 'voz-referencia.wav')
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
EXAG = 1.1   # 0.5 = neutro; >1 = gritado/teatral
CFG = 0.3    # menor = fala mais solta e rápida (combina com exagero alto)

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
for n in NAMES:
    LINES['name:' + re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')] = [f'{n}!']

only_missing = '--so-faltando' in sys.argv
only_keys = None
if '--chave' in sys.argv:
    only_keys = set(sys.argv[sys.argv.index('--chave') + 1].split(','))

os.makedirs(OUT, exist_ok=True)
manifest = {'voice': 'Chatterbox (MIT) clonando Kokoro am_michael, exagero %.1f' % EXAG,
            'names': [re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-') for n in NAMES], 'lines': {}}
jobs = []
for key, lst in LINES.items():
    manifest['lines'][key] = []
    for i, text in enumerate(lst):
        f = f"{key.replace(':', '_')}_{i}.mp3"
        manifest['lines'][key].append(f)
        if only_keys and key not in only_keys:
            continue
        if not only_missing or not os.path.exists(os.path.join(OUT, f)):
            jobs.append((text, f))
print(len(jobs), 'falas', flush=True)

model = ChatterboxTTS.from_pretrained(device='cpu')
model.prepare_conditionals(REF, exaggeration=EXAG)
# tratamento de arena: corpo, presença, compressão forte, eco curto de estádio, pico em -1 dBFS
FILTER = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
          'highpass=f=85,equalizer=f=220:t=q:w=0.8:g=2,equalizer=f=3000:t=q:w=0.9:g=4,'
          'acompressor=threshold=-22dB:ratio=5:attack=3:release=120:makeup=4,'
          'aecho=0.8:0.6:45|110:0.18|0.10,apad=pad_dur=0.15,alimiter=limit=0.89')
# conferência: o Whisper transcreve cada fala; se não bater com o texto, gera de novo
try:
    from faster_whisper import WhisperModel
    whisper = WhisperModel('small.en', device='cpu', compute_type='int8')
except ImportError:
    whisper = None
norm = lambda t: re.sub(r'[^a-z]', '', t.lower().replace('11', 'eleven'))

def score(path, text):
    if whisper is None:
        return 1.0
    segs, _ = whisper.transcribe(path, beam_size=3)
    heard = ' '.join(x.text for x in segs)
    return difflib.SequenceMatcher(None, norm(heard), norm(text)).ratio()

tmp = tempfile.mkdtemp()
for k, (text, f) in enumerate(jobs):
    words = len(text.split())
    best, best_score = None, -1.0
    wav = os.path.join(tmp, 'x.wav')
    # frases curtas às vezes "alucinam": tenta até 5 vezes e fica com a mais fiel ao texto
    for attempt in range(5):
        torch.manual_seed(1000 * k + attempt)
        w = model.generate(text, exaggeration=EXAG, cfg_weight=CFG, temperature=0.8)
        dur = w.shape[-1] / model.sr
        ta.save(wav, w, model.sr)
        sc = score(wav, text) if dur < 1.2 + words * 0.8 else 0.0
        if sc > best_score:
            best, best_score = w, sc
        if sc >= 0.8:
            break
    ta.save(wav, best, model.sr)
    dur = best.shape[-1] / model.sr
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', wav, '-af', FILTER, '-ar', '44100', '-ac', '1',
                    '-c:a', 'libmp3lame', '-b:a', '96k', os.path.join(OUT, f)], check=True)
    print(f'{k + 1}/{len(jobs)} {f} "{text}" {dur:.1f}s fidelidade {best_score:.2f}', flush=True)

with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as fh:
    json.dump(manifest, fh, indent=2)
print('pronto')
