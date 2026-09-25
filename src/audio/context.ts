/**
 * AudioContext compartilhado — só pode ser criado/retomado após um gesto do usuário.
 *
 * Mixagem:
 *   motor   (engineBus) ─► duck de impacto ─────────────┐
 *   locutor (voiceBus) ─────────────────────────────────┼─► cama ─► cola ─┐
 *   música  (musicBus) ─► duck do locutor ─► duck de impacto ┘             ├─► pré-limitador ─► limitador ─► soft clip ─► master
 *   efeitos (sfxBus) ───────────────────────────────────────────────────┘
 * Os efeitos NÃO passam pelo compressor de cola: se passassem, cada explosão abaixaria a própria
 * mixagem e o impacto sumiria. A "cama" (música, motor, locutor) fica bem abaixo do limitador e
 * ainda abaixa por um instante (ducking) a cada tiro, batida e explosão, para eles saltarem
 * (meta: +4 dB na janela de 150 ms). O pré-limitador deixa folga; o soft clip é só rede de segurança.
 */
import { preloadSfx } from './samples';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let engineBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let voiceBus: GainNode | null = null;
/** surround (5.1/7.1): efeitos e motores que vêm de trás vão às caixas traseiras */
let rearSfxBus: GainNode | null = null;
let rearEngineBus: GainNode | null = null;
/** canais da saída em uso (2 = estéreo, 6 = 5.1, 8 = 7.1) */
let outChannels = 2;
/** estéreo com as traseiras codificadas em matriz (Dolby Surround / Pro Logic II do receiver) */
let matrixOn = false;
let musicDuck: GainNode | null = null;
let impactDuck: GainNode | null = null;
let engineDuck: GainNode | null = null;
/** realce transitório dos efeitos (explosões, mísseis): +2–3 dB por um instante */
let sfxLift: GainNode | null = null;
let muted = false;
let sfxOn = true;
/** cama → compressor de cola (modo normal) ou direto ao pré-limitador (modo leve) */
let bedOut: BiquadFilterNode | null = null;
let glueNode: DynamicsCompressorNode | null = null;
let preLimitNode: GainNode | null = null;
/**
 * Modo leve de áudio (toque / qualidade baixa): um compressor só no master, reverb curto mono na
 * trilha, distorção sem oversampling, 1 rival com motor e camadas do motor desligadas. Padrão:
 * aparelhos de toque (ponteiro grosso) ou com até 4 núcleos. O jogo pode forçar com setAudioLite().
 */
let lite: boolean = (() => {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8;
    return coarse || cores <= 4;
  } catch {
    return false;
  }
})();

/** Modo leve de áudio ativo? (toque / qualidade baixa) */
export function isAudioLite(): boolean {
  return lite;
}

/**
 * Liga/desliga o modo leve (chamar ao mudar o nível de qualidade: baixo/toque → true). O master
 * troca na hora; trilha e motor leem o modo ao serem criados (vale a partir da próxima corrida).
 */
export function setAudioLite(on: boolean): void {
  if (on === lite) return;
  lite = on;
  if (!bedOut || !glueNode || !preLimitNode) return;
  bedOut.disconnect();
  bedOut.connect(on ? preLimitNode : glueNode);
}

/** Nível fixo da música na mixagem (o volume do jogador multiplica isto). */
// rodada 11: cama (música + motor) ~-19 dB RMS, para batidas e explosões saltarem +5–8 dB sobre ela
const MUSIC_TRIM = 0.2;
const SFX_TRIM = 1;
const ENGINE_TRIM = 0.14;
const VOICE_TRIM = 1.1;

export interface AudioOut {
  ctx: AudioContext;
  /** efeitos sonoros */
  out: GainNode;
  /** motor e pneus */
  engine: GainNode;
  /** música */
  music: GainNode;
  /** locutor */
  voice: GainNode;
  /** caixas traseiras (null em estéreo): efeitos e motores */
  rearOut: GainNode | null;
  rearEngine: GainNode | null;
}

export function audio(): AudioOut | null {
  return ctx && sfxBus && musicBus && engineBus && voiceBus ? { ctx, out: sfxBus, engine: engineBus, music: musicBus, voice: voiceBus, rearOut: rearSfxBus, rearEngine: rearEngineBus } : null;
}

/** Teto do master: -1 dBFS. */
export const CEIL = Math.pow(10, -1 / 20);

/** Curva do soft clip do master: linear até `knee`, satura (tanh) até no máximo `ceil`. */
export function ceilingCurve(knee: number, ceil: number, n = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    curve[i] = ax < knee ? x : Math.sign(x) * (knee + (ceil - knee) * Math.tanh((ax - knee) / (ceil - knee)));
  }
  return curve;
}

function buildGraph(c: BaseAudioContext): void {
  ctx = c as AudioContext;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  // limitador em -1,5 dB: só segura picos raros (em -3 dB achatava os golpes contra a cama)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  // compressor de "cola" só para a cama (música, motor, locutor): junta sem esmagar
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -10;
  glue.knee.value = 8;
  glue.ratio.value = 3;
  glue.attack.value = 0.004;
  glue.release.value = 0.18;
  const bed = ctx.createGain();
  // corta o infrassom antes do compressor: não se ouve e só faria a mixagem "bombear"
  const rumbleCut = ctx.createBiquadFilter();
  rumbleCut.type = 'highpass';
  rumbleCut.frequency.value = 30;
  rumbleCut.Q.value = 0.7;
  bed.connect(rumbleCut);
  // pré-limitador: ~1 dB de folga (volume geral agradável), o limitador só segura picos raros
  const preLimit = ctx.createGain();
  preLimit.gain.value = 0.89;
  // modo leve: a cama vai direto ao pré-limitador (um compressor só, o limitador)
  rumbleCut.connect(lite ? preLimit : glue);
  bedOut = rumbleCut;
  glueNode = glue;
  preLimitNode = preLimit;
  glue.connect(preLimit);
  preLimit.connect(limiter);
  // teto do master: o compressor do navegador deixa passar o transitório do ataque (a mixagem
  // chegava a -0,2 dBFS). O soft clip é linear até 0,8 e satura assintoticamente em CEIL
  // (-1 dBFS): nenhuma amostra passa de ~-1 dBFS, mesmo com entrada acima de 0 dBFS.
  const clip = ctx.createWaveShaper();
  clip.curve = ceilingCurve(0.8, CEIL);
  clip.oversample = 'none';
  // o compressor do navegador aplica ganho de compensação automático (~+1,5 dB aqui): desconta
  const postLimit = ctx.createGain();
  postLimit.gain.value = 0.84;
  limiter.connect(postLimit);
  postLimit.connect(clip);
  // surround: a saída do Windows configurada em 5.1/7.1 (o Chrome informa em maxChannelCount).
  // A mixagem de sempre vai às caixas da frente; um caminho próprio leva o que vem de trás às
  // traseiras (os compressores do Web Audio são só estéreo: as traseiras têm o seu limitador)
  const max = ctx.destination.maxChannelCount || 2;
  outChannels = max >= 8 ? 8 : max >= 6 ? 6 : 2;
  rearSfxBus = ctx.createGain();
  rearSfxBus.gain.value = sfxOn ? SFX_TRIM : 0;
  rearEngineBus = ctx.createGain();
  rearEngineBus.gain.value = sfxOn ? ENGINE_TRIM : 0;
  if (outChannels === 2) {
    // estéreo: as traseiras entram no par L/R em matriz (coeficientes do codificador Pro Logic II,
    // com inversão de polaridade no lugar dos ±90°). Um decodificador Dolby Surround / Pro Logic
    // (receiver ou soundbar ligado à TV) manda a diferença L−R às caixas traseiras; o lado sai da
    // proporção entre os dois canais. Só soa quando a opção está ligada (ver SpatialPan.set)
    const split = ctx.createChannelSplitter(2);
    const enc = ctx.createChannelMerger(2);
    const rearMix = ctx.createGain();
    rearSfxBus.connect(rearMix);
    rearEngineBus.connect(rearMix);
    rearMix.connect(split);
    const coef: [number, number, number][] = [
      [0, 0, -0.87],
      [1, 0, -0.49],
      [0, 1, 0.49],
      [1, 1, 0.87],
    ];
    for (const [from, to, k] of coef) {
      const g = ctx.createGain();
      g.gain.value = k;
      split.connect(g, from);
      g.connect(enc, 0, to);
    }
    enc.connect(preLimit);
  }
  if (outChannels > 2) {
    const dest = ctx.destination;
    dest.channelCount = outChannels;
    dest.channelCountMode = 'explicit';
    dest.channelInterpretation = 'discrete';
    // ordem do Windows: FL FR C LFE (5.1: SL SR) (7.1: BL BR SL SR)
    const merger = ctx.createChannelMerger(outChannels);
    const front = ctx.createChannelSplitter(2);
    clip.connect(front);
    front.connect(merger, 0, 0);
    front.connect(merger, 1, 1);
    // mesmo caminho da frente: pré-limitador, limitador, compensação e soft clip
    const rearIn = ctx.createGain();
    rearIn.gain.value = 0.89;
    rearSfxBus.connect(rearIn);
    rearEngineBus.connect(rearIn);
    const rearLimiter = ctx.createDynamicsCompressor();
    rearLimiter.threshold.value = -1.5;
    rearLimiter.knee.value = 0;
    rearLimiter.ratio.value = 20;
    rearLimiter.attack.value = 0.001;
    rearLimiter.release.value = 0.12;
    const rearPost = ctx.createGain();
    rearPost.gain.value = 0.84;
    const rearClip = ctx.createWaveShaper();
    rearClip.curve = ceilingCurve(0.8, CEIL);
    rearClip.oversample = 'none';
    rearIn.connect(rearLimiter);
    rearLimiter.connect(rearPost);
    rearPost.connect(rearClip);
    const rear = ctx.createChannelSplitter(2);
    rearClip.connect(rear);
    // 7.1: traseiras e laterais recebem o mesmo par, 3 dB abaixo cada
    const pairs = outChannels === 8 ? [4, 6] : [4];
    const pairGain = pairs.length > 1 ? Math.SQRT1_2 : 1;
    for (const first of pairs) {
      const l = ctx.createGain();
      const r = ctx.createGain();
      rear.connect(l, 0);
      rear.connect(r, 1);
      l.gain.value = r.gain.value = pairGain;
      l.connect(merger, 0, first);
      r.connect(merger, 0, first + 1);
    }
    merger.connect(master);
    master.channelCount = outChannels;
    master.channelCountMode = 'explicit';
    master.channelInterpretation = 'discrete';
  } else clip.connect(master);
  master.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxOn ? SFX_TRIM : 0;
  const sfxCut = ctx.createBiquadFilter();
  sfxCut.type = 'highpass';
  sfxCut.frequency.value = 25;
  sfxCut.Q.value = 0.7;
  sfxLift = ctx.createGain();
  sfxBus.connect(sfxLift);
  sfxLift.connect(sfxCut);
  sfxCut.connect(preLimit);
  engineDuck = ctx.createGain();
  engineDuck.connect(bed);
  engineBus = ctx.createGain();
  engineBus.gain.value = sfxOn ? ENGINE_TRIM : 0;
  engineBus.connect(engineDuck);
  impactDuck = ctx.createGain();
  impactDuck.connect(bed);
  musicDuck = ctx.createGain();
  musicDuck.gain.value = MUSIC_TRIM;
  musicDuck.connect(impactDuck);
  musicBus = ctx.createGain();
  musicBus.connect(musicDuck);
  voiceBus = ctx.createGain();
  voiceBus.gain.value = VOICE_TRIM;
  voiceBus.connect(bed);
  void preloadSfx(ctx);
}

export function unlockAudio(): void {
  if (ctx) {
    // pausado de propósito (suspendAudio): só resumeAudio() retoma; um toque no menu de pausa não
    if (!userSuspended && (ctx.state as string) !== 'running') void resumeAudio();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  // buffer de áudio maior ('balanced') em todos os aparelhos. Com o mínimo ('interactive'), qualquer
  // engasgo da CPU esvaziava o buffer e o som picotava (também no PC); o atraso extra (~20 ms) não se percebe
  let c: AudioContext;
  try {
    c = new AC({ latencyHint: 'balanced' });
  } catch {
    c = new AC();
  }
  buildGraph(c);
  watchState(c);
}

/** O áudio foi pausado por suspendAudio() (pausa/aba oculta): resumeAudio() só retoma nesse caso. */
let userSuspended = false;

/**
 * Pausa o áudio (pausa do jogo, aba oculta): `ctx.suspend()` libera a CPU/bateria de áudio.
 * Seguro de chamar sem contexto ou já suspenso.
 */
export function suspendAudio(): Promise<void> {
  userSuspended = true;
  if (!ctx || ctx.state === 'closed' || typeof ctx.suspend !== 'function') return Promise.resolve();
  return ctx.suspend().catch(() => undefined);
}

/**
 * Retoma o áudio (volta da pausa, aba visível de novo, reinício/saída da corrida). Trata o estado
 * `interrupted` do iOS (ligação, Siri, outro app tocando): nele o `resume()` pode falhar ou ficar
 * pendente; tenta de novo no próximo gesto do usuário (toque/tecla), que o Safari exige.
 */
export function resumeAudio(): Promise<void> {
  userSuspended = false;
  // sem contexto ainda: nada a retomar (ele nasce no primeiro gesto, em unlockAudio)
  if (!ctx) return Promise.resolve();
  if ((ctx.state as string) === 'running' || ctx.state === 'closed') return Promise.resolve();
  const c = ctx;
  return c
    .resume()
    .catch(() => undefined)
    .then(() => {
      if ((c.state as string) !== 'running') retryOnGesture();
    });
}

let gestureArmed = false;
function retryOnGesture(): void {
  if (gestureArmed || typeof window === 'undefined') return;
  gestureArmed = true;
  const retry = (): void => {
    gestureArmed = false;
    window.removeEventListener('pointerdown', retry, true);
    window.removeEventListener('keydown', retry, true);
    window.removeEventListener('touchend', retry, true);
    if (!userSuspended) void resumeAudio();
  };
  window.addEventListener('pointerdown', retry, true);
  window.addEventListener('keydown', retry, true);
  window.addEventListener('touchend', retry, true);
}

/** Estado atual do contexto ('running', 'suspended', 'interrupted' no iOS, 'closed') ou null. */
export function audioState(): string | null {
  return ctx ? (ctx.state as string) : null;
}

function watchState(c: AudioContext): void {
  // iOS: fim da interrupção (ligação/Siri) deixa o contexto 'suspended'/'interrupted'; se o jogo
  // não pausou o áudio de propósito, retoma sozinho (ou no próximo toque)
  c.addEventListener?.('statechange', () => {
    if (!userSuspended && (c.state as string) !== 'running' && c.state !== 'closed') void resumeAudio();
  });
}

/**
 * Abaixa a música (e um pouco o motor) por um instante, para um efeito saltar na mixagem.
 * `amount` 0..1 = quanto abaixa; volta ao normal em `recover` segundos. Usa um ganho próprio,
 * separado do ducking do locutor, para um tiro não cancelar a fala abaixando a música.
 * Efeitos em sequência (rajada, explosão logo após o míssil) REFORÇAM o ducking: cada um abaixa
 * a cama a partir do nível atual, então o segundo também ganha contraste (antes era ignorado).
 * `liftDb` realça os próprios efeitos por um instante (explosões): soma ao contraste do ducking.
 */
export function duck(amount: number, recover = 0.8, liftDb = 0): void {
  if (!ctx || !impactDuck || !engineDuck || !sfxLift) return;
  const t = ctx.currentTime;
  const k = Math.min(0.9, Math.max(0, amount));
  // o motor também abaixa quase tanto quanto a música (antes 60%: o ronco tapava as batidas)
  for (const [g, depth] of [[impactDuck.gain, k], [engineDuck.gain, k * 0.85]] as const) {
    const cur = g.value;
    // já abaixado: afunda mais, proporcionalmente (piso de ~-18 dB para a cama não sumir)
    const low = Math.max(0.12, Math.min(1 - depth, cur * (1 - depth * 0.55)));
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(low, t + 0.012);
    g.setTargetAtTime(1, t + 0.1, recover / 3);
  }
  if (liftDb > 0) {
    const g = sfxLift.gain;
    const peak = Math.max(g.value, Math.pow(10, Math.min(4, liftDb) / 20));
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + 0.005);
    g.setValueAtTime(peak, t + 0.12);
    g.setTargetAtTime(1, t + 0.12, 0.12);
  }
}

/** Abaixa a música enquanto o locutor fala (`seconds` de fala). */
export function duckFor(amount: number, seconds: number): void {
  if (!ctx || !musicDuck) return;
  const t = ctx.currentTime;
  const g = musicDuck.gain;
  const low = MUSIC_TRIM * (1 - Math.min(0.85, Math.max(0, amount)));
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(low, t + 0.06);
  g.setValueAtTime(low, t + seconds);
  g.setTargetAtTime(MUSIC_TRIM, t + seconds, 0.25);
}

export function toggleMute(): boolean {
  muted = !muted;
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  if (muted) window.speechSynthesis?.cancel();
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

export function setSfxEnabled(on: boolean): void {
  sfxOn = on;
  if (ctx && sfxBus && engineBus) {
    sfxBus.gain.setTargetAtTime(on ? SFX_TRIM : 0, ctx.currentTime, 0.05);
    engineBus.gain.setTargetAtTime(on ? ENGINE_TRIM : 0, ctx.currentTime, 0.05);
    rearSfxBus?.gain.setTargetAtTime(on ? SFX_TRIM : 0, ctx.currentTime, 0.05);
    rearEngineBus?.gain.setTargetAtTime(on ? ENGINE_TRIM : 0, ctx.currentTime, 0.05);
  }
}

/**
 * Liga a matriz Dolby Surround na saída estéreo (vale a partir do próximo som; os motores dos rivais
 * mudam no quadro seguinte). Sem efeito quando a saída já é 5.1/7.1.
 */
export function setSurroundMatrix(on: boolean): void {
  matrixOn = on;
}

/** As caixas traseiras recebem som: saída 5.1/7.1 ou matriz ligada. */
function rearActive(): boolean {
  return outChannels > 2 || matrixOn;
}

/** Canais da saída de som em uso: 2 (estéreo), 6 (5.1) ou 8 (7.1). Só sabe depois do primeiro gesto. */
export function audioChannels(): number {
  return outChannels;
}

/** Pan de um efeito: só o lado (-1..1) ou o lado e o quanto a fonte está atrás (0..1). */
export type Pan = number | { side: number; rear: number };

/**
 * Pan de uma fonte posicional: `side` (-1 esquerda .. 1 direita) e `rear` (0 na frente .. 1 atrás).
 * Em estéreo o `rear` é ignorado (a mixagem de sempre). Em surround divide a fonte entre as caixas
 * da frente e as traseiras com potência constante.
 */
export class SpatialPan {
  readonly input: StereoPannerNode;
  private readonly front: GainNode;
  private readonly back: GainNode | null;
  private attached = true;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly frontBus: AudioNode,
    private readonly rearBus: AudioNode | null,
    side = 0,
    rear = 0,
  ) {
    this.input = ctx.createStereoPanner();
    this.front = ctx.createGain();
    this.input.connect(this.front);
    this.front.connect(frontBus);
    this.back = rearBus ? ctx.createGain() : null;
    if (this.back && rearBus) {
      this.input.connect(this.back);
      this.back.connect(rearBus);
    }
    this.set(side, rear);
  }

  set(side: number, rear: number, smooth = 0): void {
    const t = this.ctx.currentTime;
    const s = Math.max(-1, Math.min(1, side));
    const r = this.back && rearActive() ? Math.max(0, Math.min(1, rear)) : 0;
    const f = Math.cos((r * Math.PI) / 2);
    const b = Math.sin((r * Math.PI) / 2);
    if (smooth > 0) {
      this.input.pan.setTargetAtTime(s, t, smooth);
      this.front.gain.setTargetAtTime(f, t, smooth);
      this.back?.gain.setTargetAtTime(b, t, smooth);
    } else {
      this.input.pan.value = s;
      this.front.gain.value = f;
      if (this.back) this.back.gain.value = b;
    }
  }

  /** Liga/desliga as saídas do grafo (voz calada não gasta CPU de áudio). */
  attach(on: boolean): void {
    if (on === this.attached) return;
    this.attached = on;
    if (on) {
      this.front.connect(this.frontBus);
      if (this.back && this.rearBus) this.back.connect(this.rearBus);
    } else {
      this.front.disconnect();
      this.back?.disconnect();
    }
  }
}

/** Só para medição (scripts/evidencias.mjs): o nó final da mixagem, antes do destino. */
export function audioOutputForTest(): AudioNode | null {
  return master;
}

/**
 * Só para gravação offline (scripts/evidencias.mjs): passa a usar um contexto já criado,
 * por exemplo um OfflineAudioContext, para renderizar efeitos, motor e música em arquivo.
 */
export function useAudioContextForTest(c: BaseAudioContext): Promise<void> {
  buildGraph(c);
  return preloadSfx(c);
}
