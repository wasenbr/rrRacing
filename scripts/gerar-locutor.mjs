// Gera as falas do locutor com TTS neural (Kokoro-82M, Apache-2.0) rodando no Chrome (WASM),
// no estilo empolgado de locutor de arena, com tratamento de "estádio" e exporta em MP3.
// Uso: node scripts/gerar-locutor.mjs [--so-faltando]
// Saída: public/audio/locutor/*.mp3 + manifest.json. Precisa de ffmpeg no PATH ou em FFMPEG.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = 'public/audio/locutor';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const VOICE = process.env.VOICE ?? 'am_michael';
const onlyMissing = process.argv.includes('--so-faltando');
fs.mkdirSync(OUT, { recursive: true });

/**
 * Como no original, a fala é montada como NOME + FRASE ("Olaf unleashes hot fury!").
 * Nomes: apelidos dos pilotos e rivais usados pelo locutor do original.
 */
const NAMES = ['Olaf', 'Ivan', 'Hawk', 'Kat', 'Snake', 'Jake', 'Tarquinn', 'Roadkill', 'Butcher', 'Slash', 'Rage', 'Grinder', 'Viper', 'Rip', 'Shred'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** chave -> frases. Frases "de nome" começam em minúscula e são tocadas logo depois do nome. */
const LINES = {
  // largada e voltas (sozinhas)
  start: ['The stage is set, the green flag drops!', 'Let the carnage begin!', 'Gentlemen... start your engines!'],
  lastLap: ['Last lap!', 'LAST LAP! This is it!', 'One lap to go!'],
  // interjeições (sozinhas)
  ouch: ['Ouch!', 'OUCH! That hurt!', "Ooh, that's gotta hurt!"],
  wow: ['Wow!', 'WOW! Did you see that?!', 'Whoa!'],
  holyToledo: ['Holy Toledo!', 'HOLY TOLEDO!!', 'Holy smokes!'],
  // posição (nome + frase)
  jamsFirst: ['jams into first!', 'TAKES THE LEAD!', 'blasts into first place!'],
  fadesLast: ['fades into last!', 'drops to the back!'],
  dominating: ['is dominating the race!', 'is in another time zone!', 'is UNSTOPPABLE!'],
  finishFirst: ['scores a first place knock-out!', 'WINS IT! What a race!'],
  finishSecond: ['finishes second!', 'takes second place!'],
  finishThird: ['takes a weak third!', 'limps home in third!'],
  // combate (nome + frase)
  hotFury: ['unleashes hot fury!', 'UNLEASHES HOT FURY!', 'lets it rip!'],
  lightsUp: ['lights him up!', 'LIGHTS HIM UP!', 'lights up the competition!'],
  hammered: ['gets hammered!', 'gets HAMMERED!', 'takes a beating!'],
  aboutToBlow: ['is about to blow!', 'is gonna BLOW!'],
  avoidMines: ['should avoid mines!', 'hits a mine! BOOM!'],
  wipedOut: ['wiped out!', 'is WIPED OUT!', 'is toast!'],
  // pilotagem (nome + frase)
  launches: ['launches himself!', 'takes to the air!', 'FLIES!'],
  warp: ['hits the warp!', 'hits the warp! Zoom!'],
  powersUp: ['powers up!', 'POWERS UP!'],
  spinOut: ['spins out!', 'SPINS OUT!', 'loses it!'],
  wrongWay: ['is headed the wrong way!', 'wrong way, buddy!'],
  lost: ['looks lost out there!', 'needs a map!'],
  powerOff: ['is out of ammo!', 'is running on empty!'],
};
for (const n of NAMES) LINES[`name:${slug(n)}`] = [`${n}...`];

const jobs = [];
const manifest = { voice: `Kokoro-82M ${VOICE}`, names: NAMES.map(slug), lines: {} };
for (const [key, list] of Object.entries(LINES)) {
  manifest.lines[key] = [];
  list.forEach((text, i) => {
    const file = `${key.replace(':', '_')}_${i}.mp3`;
    manifest.lines[key].push(file);
    if (!onlyMissing || !fs.existsSync(path.join(OUT, file))) jobs.push({ text, file });
  });
}
console.log(`${jobs.length} falas para gerar`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
// página neutra (fora do Vite, que recarrega quando os arquivos mudam)
await page.goto('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/package.json');
await page.evaluate(async (voice) => {
  const { KokoroTTS } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');
  window.tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' });
  window.voice = voice;
  /** Tratamento de locutor de arena: grave um pouco mais grosso, presença, saturação, compressão e eco de estádio. */
  window.stadium = async (samples, sr) => {
    const rate = 0.95; // abaixa ~1 semitom e dá peso
    const len = Math.ceil((samples.length / rate) + sr * 0.9);
    const c = new OfflineAudioContext(1, len, 44100);
    const buf = c.createBuffer(1, samples.length, sr);
    buf.copyToChannel(samples, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.gain.value = 3; body.Q.value = 0.8;
    const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2800; pres.gain.value = 5; pres.Q.value = 0.9;
    const air = c.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 7000; air.gain.value = -2;
    const drive = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
    drive.curve = curve;
    const pre = c.createGain(); pre.gain.value = 1.6;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -24; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12; comp.knee.value = 6;
    // eco de estádio: resposta ao impulso sintética com pré-atraso
    const ir = c.createBuffer(2, Math.round(44100 * 1.4), 44100);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const t = i / 44100;
        d[i] = t < 0.035 ? 0 : (Math.random() * 2 - 1) * Math.exp(-t * 4.2) * (0.6 + 0.4 * Math.exp(-t * 18));
      }
    }
    const verb = c.createConvolver(); verb.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.16;
    const dry = c.createGain(); dry.gain.value = 1;
    const out = c.createGain(); out.gain.value = 0.9;
    src.connect(hp); hp.connect(body); body.connect(pres); pres.connect(air); air.connect(pre); pre.connect(drive); drive.connect(comp);
    comp.connect(dry); comp.connect(verb); verb.connect(wet); dry.connect(out); wet.connect(out); out.connect(c.destination);
    src.start();
    const r = await c.startRendering();
    const d = r.getChannelData(0);
    // normaliza em -1 dBFS e corta o silêncio do fim
    let peak = 0, last = 0, first = -1;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); if (a > 0.003) { last = i; if (first < 0) first = i; } }
    first = Math.max(0, first - 200);
    const g = peak > 0 ? 0.89 / peak : 1;
    const end = Math.min(d.length, last + Math.round(44100 * 0.3));
    const n = end - first;
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const fade = i > n - 2000 ? (n - i) / 2000 : 1;
      pcm[i] = Math.max(-1, Math.min(1, d[first + i] * g * fade)) * 32767;
    }
    let bin = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
}, VOICE);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'locutor-'));
let k = 0;
for (const job of jobs) {
  const b64 = await page.evaluate(async (text) => {
    const a = await window.tts.generate(text, { voice: window.voice, speed: 1.12 });
    return window.stadium(a.audio, a.sampling_rate);
  }, job.text);
  const raw = path.join(tmp, 'x.pcm');
  fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '44100', '-ac', '1', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '80k', path.join(OUT, job.file)]);
  console.log(`${++k}/${jobs.length} ${job.file}  "${job.text}"`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
console.log('pronto');
