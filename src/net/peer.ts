import type { DataConnection, Peer as PeerType } from 'peerjs';
import { LEAVE_FLUSH_MS, REJOIN_MS, Rtt } from './session';
import { MAX_CLIENT_MSG } from './sync';

/**
 * Conexão P2P (WebRTC) entre navegadores via PeerJS. O servidor público do PeerJS só
 * apresenta os jogadores; depois os dados vão direto de um navegador para o outro.
 * A sala é o id do host: `rnrr3d-<código>`.
 */
const PREFIX = 'rnrr3d-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TIMEOUT_MS = 20000;

export function newRoomCode(): string {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

const TRIES = 3;

/**
 * Registra este navegador no servidor de apresentação. O id é sempre gerado aqui (o convidado
 * também), para não depender de mais uma chamada ao servidor público, que às vezes falha;
 * falhas de rede são tentadas de novo.
 */
async function createPeer(id = `${PREFIX}g-${Math.random().toString(36).slice(2, 12)}`): Promise<PeerType> {
  for (let i = 1; ; i++) {
    try {
      return await openPeer(id);
    } catch (err) {
      const type = (err as { type?: string })?.type;
      if (i >= TRIES || type === 'unavailable-id' || type === 'browser-incompatible') throw err;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}

let iceServers: Promise<RTCIceServer[] | undefined> | undefined;
let iceFetchedAt = 0;

/**
 * Servidores TURN da Cloudflare (via /api/turn do worker), para conectar quem está atrás de
 * NAT/CGNAT/4G. Sem eles (dev local, falha), o PeerJS usa os servidores públicos padrão.
 */
function getIceServers(): Promise<RTCIceServer[] | undefined> {
  // as credenciais valem 6 h (worker/index.ts); renova antes
  if (Date.now() - iceFetchedAt > 4 * 3600_000) iceServers = undefined;
  if (!iceServers) iceFetchedAt = Date.now();
  iceServers ??= fetch('/api/turn', { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : undefined))
    .then((d: { iceServers?: RTCIceServer[] } | undefined) => (d?.iceServers?.length ? d.iceServers : undefined))
    .catch(() => undefined)
    .then((list) => {
      if (!list) iceServers = undefined; // tenta de novo na próxima conexão
      return list;
    });
  return iceServers;
}

async function openPeer(id: string): Promise<PeerType> {
  const [{ Peer }, ice] = await Promise.all([import('peerjs'), getIceServers()]);
  return new Promise((resolve, reject) => {
    // ?netdebug na URL: logs do PeerJS no console
    const opts = {
      debug: new URLSearchParams(location.search).has('netdebug') ? 3 : 0,
      ...(ice && { config: { iceServers: ice } }),
    } as const;
    const peer = new Peer(id, opts);
    const timer = setTimeout(() => {
      peer.destroy();
      reject(new Error('timeout'));
    }, TIMEOUT_MS);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (err) => {
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    });
  });
}

/** Mensagem de erro amigável para falhas do PeerJS. */
export function netErrorText(err: unknown): string {
  const type = (err as { type?: string })?.type;
  if (type === 'peer-unavailable') return 'Sala não encontrada. Confira o código ou peça um link novo.';
  if (type === 'browser-incompatible') return 'Este navegador não suporta jogo online (WebRTC).';
  if ((err as Error)?.message === 'timeout') return 'A conexão demorou demais. Verifique a internet e tente de novo.';
  return 'Não foi possível conectar. Verifique a internet e tente de novo.';
}

/** Intervalo do ping e silêncio máximo antes de considerar a conexão perdida. */
export const PING_MS = 1000;
export const DROP_MS = 8000;
/** Espera pela resposta da conexão antiga quando a mesma ficha chega de outra aba. */
export const PROBE_MS = 1500;
/** Quem conecta e não se apresenta nesse prazo é desligado. */
const HELLO_MS = 10000;
/** Taxa máxima de mensagens do convidado (balde de fichas: 60/s, rajada de 120). */
const RATE = 60;
const BURST = 120;
/** Rótulo do segundo canal (sem ordem): estados e comandos, sem travar atrás de um pacote perdido. */
const FAST = 'fast';

/**
 * O PeerJS abre o canal "sem garantia" só sem ordem (ordered: false), mas ainda retransmitindo: um
 * estado velho reenviado atrasa os novos. Durante o `connect` (que cria o canal na hora), o canal
 * rápido sai com maxRetransmits: 0 (perdeu, perdeu: o próximo pacote já traz o estado novo).
 */
function withoutRetransmits<T>(open: () => T): T {
  const proto = (globalThis as { RTCPeerConnection?: { prototype: RTCPeerConnection } }).RTCPeerConnection?.prototype;
  const orig = proto?.createDataChannel;
  if (!proto || !orig) return open();
  proto.createDataChannel = function (this: RTCPeerConnection, label: string, init?: RTCDataChannelInit) {
    return orig.call(this, label, label === FAST ? { ...init, ordered: false, maxRetransmits: 0 } : init);
  };
  try {
    return open();
  } finally {
    proto.createDataChannel = orig;
  }
}

/**
 * O canal rápido é "cru" (sem a serialização do PeerJS): objetos vão como texto JSON e o estado do
 * host como binário (ArrayBuffer). No canal confiável (JSON), um binário vai como `{ t: 'bin', b }`
 * em base64 (enquanto o rápido não abriu).
 */
export function toWire(fast: boolean, msg: unknown): unknown {
  if (msg instanceof ArrayBuffer) return fast ? msg : { t: 'bin', b: toBase64(msg) };
  return fast ? JSON.stringify(msg) : msg;
}

/** Mensagem recebida: texto JSON (até `maxLen`), binário, ou `{ t: 'bin' }` do canal confiável. Inválida: undefined. */
export function fromWire(msg: unknown, maxLen: number, allowBinary: boolean): unknown {
  if (typeof msg === 'string') {
    if (msg.length > maxLen) return undefined;
    try {
      return JSON.parse(msg) as unknown;
    } catch {
      return undefined;
    }
  }
  if (msg instanceof ArrayBuffer) return allowBinary && msg.byteLength <= maxLen ? msg : undefined;
  if (allowBinary && kind(msg) === 'bin') {
    const b = (msg as { b?: unknown }).b;
    return typeof b === 'string' && b.length <= maxLen * 2 ? fromBase64(b) : undefined;
  }
  return msg;
}

function toBase64(buf: ArrayBuffer): string {
  let bin = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}

function fromBase64(s: string): ArrayBuffer | undefined {
  try {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  } catch {
    return undefined;
  }
}

/** Maior mensagem aceita do host (binário ou texto). */
const MAX_HOST_MSG = 65536;

type Msg = { t?: unknown; ts?: unknown } | null;
const kind = (m: unknown): unknown => (m as Msg)?.t;

/** Tamanho aproximado de uma mensagem já decodificada (JSON). */
function jsonSize(msg: unknown): number {
  try {
    return JSON.stringify(msg)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/** Resposta a um ping (o carimbo volta como veio, só se for um número). */
export function pong(m: unknown): { t: 'pong'; ts: number } | null {
  const ts = (m as Msg)?.ts;
  return typeof ts === 'number' && Number.isFinite(ts) ? { t: 'pong', ts } : null;
}

/** Amostra de ida e volta de um `pong` (carimbo do próprio relógio). */
function pongSample(m: unknown, now: number): number {
  const ts = (m as Msg)?.ts;
  return typeof ts === 'number' ? now - ts : NaN;
}

/** Balde de fichas por canal. */
function limiter(): () => boolean {
  let tokens = BURST;
  let refill = performance.now();
  return () => {
    const now = performance.now();
    tokens = Math.min(BURST, tokens + ((now - refill) / 1000) * RATE);
    refill = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

/** Host: dono da sala, recebe os amigos. */
export class NetHost {
  /** canal confiável (sala, largada, fim) de cada convidado */
  private conns = new Map<string, DataConnection>();
  /** canal rápido, sem ordem (estados e comandos) */
  private fast = new Map<string, DataConnection>();
  /** só estes recebem `broadcast` e têm as mensagens repassadas ao jogo (ver `accept`) */
  private accepted = new Set<string>();
  private lastSeen = new Map<string, number>();
  private drop = new Map<string, () => void>();
  /** silêncio tolerado por convidado (fora da tela: mais) */
  private patience = new Map<string, number>();
  private rtts = new Map<string, Rtt>();
  private timer: ReturnType<typeof setInterval>;
  onJoin: (peerId: string, msg: unknown) => void = () => {};
  onMessage: (peerId: string, msg: unknown) => void = () => {};
  onLeave: (peerId: string) => void = () => {};

  private constructor(
    private peer: PeerType,
    readonly code: string,
  ) {
    peer.on('connection', (conn) => (conn.label === FAST ? this.fastConn(conn) : this.mainConn(conn)));
    // se o servidor de apresentação cair, as conexões já abertas continuam; tenta voltar
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    // ping a cada 1 s; quem fica 8 s sem mandar nada caiu (fora da tela: 30 s)
    this.timer = setInterval(() => {
      const now = performance.now();
      for (const [id, c] of [...this.conns]) {
        if (now - (this.lastSeen.get(id) ?? now) > (this.patience.get(id) ?? DROP_MS)) {
          const gone = this.drop.get(id);
          c.close();
          gone?.(); // o canal pode já estar morto e não avisar
        } else this.sendFast(id, { t: 'ping', ts: now });
      }
    }, PING_MS);
  }

  private mainConn(conn: DataConnection): void {
    const id = conn.peer;
    let greeted = false;
    const allow = limiter();
    const helloTimer = setTimeout(() => {
      if (!greeted) conn.close();
    }, HELLO_MS);
    const gone = () => {
      clearTimeout(helloTimer);
      if (this.conns.get(id) !== conn) return;
      this.conns.delete(id);
      this.lastSeen.delete(id);
      this.drop.delete(id);
      this.patience.delete(id);
      this.rtts.delete(id);
      this.fast.get(id)?.close();
      this.fast.delete(id);
      if (this.accepted.delete(id)) this.onLeave(id);
    };
    conn.on('open', () => {
      // o mesmo id conectando de novo: a conexão antiga sai
      const old = this.conns.get(id);
      if (old && old !== conn) {
        this.drop.get(id)?.();
        old.close();
      }
      this.conns.set(id, conn);
      this.lastSeen.set(id, performance.now());
      this.drop.set(id, gone);
    });
    conn.on('data', (msg) => {
      if (this.conns.get(id) !== conn) return;
      this.lastSeen.set(id, performance.now());
      if (!allow()) return; // acima do limite de taxa: descarta
      if (this.control(id, conn, msg) || jsonSize(msg) > MAX_CLIENT_MSG) return;
      if (!greeted) {
        greeted = true;
        clearTimeout(helloTimer);
        this.onJoin(id, msg);
      } else if (this.accepted.has(id)) this.onMessage(id, msg);
    });
    conn.on('close', gone);
    conn.on('error', gone);
  }

  /** Canal rápido: só vale com o canal confiável aberto; mensagens só depois de aceito. */
  private fastConn(conn: DataConnection): void {
    const id = conn.peer;
    const allow = limiter();
    conn.on('open', () => {
      if (!this.conns.has(id)) return conn.close();
      const old = this.fast.get(id);
      if (old && old !== conn) old.close();
      this.fast.set(id, conn);
    });
    conn.on('data', (raw) => {
      if (this.fast.get(id) !== conn || !this.accepted.has(id)) return;
      this.lastSeen.set(id, performance.now());
      if (!allow()) return;
      // texto JSON curto; binário do convidado não existe
      const msg = fromWire(raw, MAX_CLIENT_MSG, false);
      if (msg === undefined || this.control(id, conn, msg) || jsonSize(msg) > MAX_CLIENT_MSG) return;
      this.onMessage(id, msg);
    });
    const gone = () => {
      if (this.fast.get(id) === conn) this.fast.delete(id);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  /** Ping/pong (não chegam ao jogo). */
  private control(id: string, conn: DataConnection, msg: unknown): boolean {
    const t = kind(msg);
    if (t === 'ping') {
      const p = pong(msg);
      if (p && conn.open) void conn.send(toWire(conn.label === FAST, p));
      return true;
    }
    if (t === 'pong') {
      let r = this.rtts.get(id);
      if (!r) this.rtts.set(id, (r = new Rtt()));
      r.add(pongSample(msg, performance.now()));
      return true;
    }
    return false;
  }

  /** @internal Sala sobre um peer já aberto (os testes usam um transporte simulado). */
  static withPeer(peer: PeerType, code: string): NetHost {
    return new NetHost(peer, code);
  }

  /** Cria a sala; se o código já estiver em uso, sorteia outro. */
  static async create(): Promise<NetHost> {
    for (let i = 0; ; i++) {
      const code = newRoomCode();
      try {
        return new NetHost(await createPeer(PREFIX + code), code);
      } catch (err) {
        if ((err as { type?: string })?.type !== 'unavailable-id' || i >= 4) throw err;
      }
    }
  }

  /** O jogo aceitou o convidado: passa a receber o estado e ter os comandos repassados. */
  accept(peerId: string): void {
    if (this.conns.has(peerId)) this.accepted.add(peerId);
  }

  /** Quantos convidados estão na sala. */
  get guests(): number {
    return this.accepted.size;
  }

  /** Ping (ms) do convidado, ou null se ainda não medido. */
  rtt(peerId: string): number | null {
    return this.rtts.get(peerId)?.value ?? null;
  }

  /** Convidado fora da tela: tolera um silêncio maior antes de considerar que caiu. */
  setAway(peerId: string, away: boolean): void {
    if (away) this.patience.set(peerId, REJOIN_MS);
    else this.patience.delete(peerId);
  }

  /** Canal confiável. */
  send(peerId: string, msg: unknown): void {
    const c = this.conns.get(peerId);
    if (c?.open) void c.send(toWire(false, msg));
  }

  /** Canal rápido (cai no confiável enquanto ele não abriu). Aceita binário (ArrayBuffer). */
  sendFast(peerId: string, msg: unknown): void {
    const f = this.fast.get(peerId);
    if (f?.open) void f.send(toWire(true, msg));
    else this.send(peerId, msg);
  }

  /** O convidado está conectado (canal confiável aberto)? */
  connected(peerId: string): boolean {
    return !!this.conns.get(peerId)?.open;
  }

  /**
   * A conexão de `peerId` ainda responde? Manda um ping e espera `ms`: qualquer mensagem dela nesse
   * prazo (a resposta ou outra) conta. Usado para recusar a mesma ficha aberta em outra aba.
   */
  probe(peerId: string, ms = PROBE_MS): Promise<boolean> {
    const c = this.conns.get(peerId);
    if (!c?.open) return Promise.resolve(false);
    const sent = performance.now();
    void c.send({ t: 'ping', ts: sent });
    this.sendFast(peerId, { t: 'ping', ts: sent });
    return new Promise((resolve) => setTimeout(() => resolve((this.lastSeen.get(peerId) ?? -Infinity) >= sent), ms));
  }

  /** Manda só para os convidados aceitos na sala (canal confiável). */
  broadcast(msg: unknown): void {
    for (const id of this.accepted) this.send(id, msg);
  }

  /** Como `broadcast`, pelo canal rápido. */
  broadcastFast(msg: unknown): void {
    for (const id of this.accepted) this.sendFast(id, msg);
  }

  kick(peerId: string): void {
    this.accepted.delete(peerId);
    this.conns.get(peerId)?.close();
    this.fast.get(peerId)?.close();
    this.conns.delete(peerId);
    this.fast.delete(peerId);
    this.lastSeen.delete(peerId);
    this.drop.delete(peerId);
    this.patience.delete(peerId);
    this.rtts.delete(peerId);
  }

  close(): void {
    clearInterval(this.timer);
    this.peer.destroy();
    this.conns.clear();
    this.fast.clear();
    this.accepted.clear();
  }
}

/** Convidado: entra na sala do host pelo código. */
export class NetClient {
  onMessage: (msg: unknown) => void = () => {};
  /** a conexão com o host acabou (caiu, ou o host fechou) */
  onClose: () => void = () => {};
  readonly rtt = new Rtt();
  private closed = false;
  private lastSeen = performance.now();
  private patience = DROP_MS;
  private fast: DataConnection | null = null;
  private timer: ReturnType<typeof setInterval>;

  private constructor(
    private peer: PeerType,
    private conn: DataConnection,
    readonly code: string,
  ) {
    const onData = (raw: unknown, c: DataConnection) => {
      this.lastSeen = performance.now();
      const msg = fromWire(raw, MAX_HOST_MSG, true);
      if (msg === undefined) return;
      const t = kind(msg);
      if (t === 'ping') {
        const p = pong(msg);
        if (p && c.open) void c.send(toWire(c.label === FAST, p));
      } else if (t === 'pong') this.rtt.add(pongSample(msg, performance.now()));
      else if (!this.closed) this.onMessage(msg);
    };
    conn.on('data', (msg) => onData(msg, conn));
    const gone = () => {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.timer);
      this.peer.destroy();
      this.onClose();
    };
    conn.on('close', gone);
    conn.on('error', gone);
    // canal rápido, sem ordem, para estados e comandos (sem ele, tudo vai pelo confiável)
    try {
      const f = withoutRetransmits(() => peer.connect(PREFIX + code, { reliable: false, serialization: 'raw', label: FAST }));
      f.on('open', () => {
        if (!this.closed) this.fast = f;
      });
      f.on('data', (msg) => onData(msg, f));
      const off = () => {
        if (this.fast === f) this.fast = null;
      };
      f.on('close', off);
      f.on('error', off);
    } catch {
      /* segue só com o confiável */
    }
    // ping a cada 1 s (mede o ping e avisa o host que ainda estamos aqui); silêncio longo: caiu
    this.timer = setInterval(() => {
      const now = performance.now();
      if (now - this.lastSeen > this.patience) gone();
      else this.sendFast({ t: 'ping', ts: now });
    }, PING_MS);
  }

  /** @internal Convidado sobre uma conexão já aberta (os testes usam um transporte simulado). */
  static withConn(peer: PeerType, conn: DataConnection, code: string): NetClient {
    return new NetClient(peer, conn, code);
  }

  /** Conecta e manda a primeira mensagem (`hello`). */
  static async join(code: string, hello: unknown): Promise<NetClient> {
    // sala inexistente não adianta repetir; queda de rede sim
    for (let i = 1; ; i++) {
      try {
        return await NetClient.tryJoin(code, hello);
      } catch (err) {
        if (i >= TRIES || (err as { type?: string })?.type === 'peer-unavailable') throw err;
      }
    }
  }

  /** Uma tentativa só (a reconexão controla as próprias esperas). */
  static async tryJoin(code: string, hello: unknown): Promise<NetClient> {
    const peer = await createPeer();
    return new Promise((resolve, reject) => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      const fail = (err: unknown) => {
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('timeout')), TIMEOUT_MS);
      peer.once('error', fail);
      conn.once('open', () => {
        clearTimeout(timer);
        peer.off('error', fail);
        void conn.send(hello);
        resolve(new NetClient(peer, conn, code));
      });
    });
  }

  /** Host fora da tela: espera mais antes de desistir dele (volta ao normal com `DROP_MS`). */
  setPatience(ms: number): void {
    this.patience = Math.max(DROP_MS, ms);
  }

  /** Canal confiável. */
  send(msg: unknown): void {
    if (this.conn.open) void this.conn.send(toWire(false, msg));
  }

  /** Canal rápido (cai no confiável enquanto ele não abriu). */
  sendFast(msg: unknown): void {
    if (this.fast?.open) void this.fast.send(toWire(true, msg));
    else this.send(msg);
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    this.peer.destroy();
  }

  /**
   * Saída de propósito: manda o "saí" pelo canal confiável e só fecha depois de um instante (destruir
   * o peer na hora descartava a mensagem, e o host guardava a vaga como se fosse queda).
   */
  leave(msg: unknown): void {
    if (this.closed) return;
    // fechado antes de mandar: o fim da conexão que vem depois não vira "caiu, reconectando"
    this.closed = true;
    clearInterval(this.timer);
    this.send(msg);
    setTimeout(() => this.peer.destroy(), LEAVE_FLUSH_MS);
  }
}
