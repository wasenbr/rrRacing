import type { DataConnection, Peer as PeerType } from 'peerjs';
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
/** Quem conecta e não se apresenta nesse prazo é desligado. */
const HELLO_MS = 10000;
/** Taxa máxima de mensagens do convidado (balde de fichas: 60/s, rajada de 120). */
const RATE = 60;
const BURST = 120;

const isPing = (m: unknown) => (m as { t?: unknown } | null)?.t === 'ping';

/** Tamanho aproximado de uma mensagem já decodificada (JSON). */
function jsonSize(msg: unknown): number {
  try {
    return JSON.stringify(msg)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/** Host: dono da sala, recebe os amigos. */
export class NetHost {
  private conns = new Map<string, DataConnection>();
  /** só estes recebem `broadcast` e têm as mensagens repassadas ao jogo (ver `accept`) */
  private accepted = new Set<string>();
  private lastSeen = new Map<string, number>();
  private drop = new Map<string, () => void>();
  private timer: ReturnType<typeof setInterval>;
  onJoin: (peerId: string, msg: unknown) => void = () => {};
  onMessage: (peerId: string, msg: unknown) => void = () => {};
  onLeave: (peerId: string) => void = () => {};

  private constructor(
    private peer: PeerType,
    readonly code: string,
  ) {
    peer.on('connection', (conn) => {
      const id = conn.peer;
      let greeted = false;
      let tokens = BURST;
      let refill = performance.now();
      const helloTimer = setTimeout(() => {
        if (!greeted) conn.close();
      }, HELLO_MS);
      const gone = () => {
        clearTimeout(helloTimer);
        if (this.conns.get(id) !== conn) return;
        this.conns.delete(id);
        this.lastSeen.delete(id);
        this.drop.delete(id);
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
        const now = performance.now();
        this.lastSeen.set(id, now);
        tokens = Math.min(BURST, tokens + ((now - refill) / 1000) * RATE);
        refill = now;
        if (tokens < 1) return; // acima do limite de taxa: descarta
        tokens--;
        if (isPing(msg) || jsonSize(msg) > MAX_CLIENT_MSG) return;
        if (!greeted) {
          greeted = true;
          clearTimeout(helloTimer);
          this.onJoin(id, msg);
        } else if (this.accepted.has(id)) this.onMessage(id, msg);
      });
      conn.on('close', gone);
      conn.on('error', gone);
    });
    // se o servidor de apresentação cair, as conexões já abertas continuam; tenta voltar
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    // ping a cada 1 s; quem fica 8 s sem mandar nada caiu
    this.timer = setInterval(() => {
      const now = performance.now();
      for (const [id, c] of [...this.conns]) {
        if (now - (this.lastSeen.get(id) ?? now) > DROP_MS) {
          const gone = this.drop.get(id);
          c.close();
          gone?.(); // o canal pode já estar morto e não avisar
        } else if (c.open) void c.send({ t: 'ping' });
      }
    }, PING_MS);
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

  send(peerId: string, msg: unknown): void {
    const c = this.conns.get(peerId);
    if (c?.open) void c.send(msg);
  }

  /** Manda só para os convidados aceitos na sala. */
  broadcast(msg: unknown): void {
    for (const id of this.accepted) {
      const c = this.conns.get(id);
      if (c?.open) void c.send(msg);
    }
  }

  kick(peerId: string): void {
    this.accepted.delete(peerId);
    this.conns.get(peerId)?.close();
    this.conns.delete(peerId);
    this.lastSeen.delete(peerId);
    this.drop.delete(peerId);
  }

  close(): void {
    clearInterval(this.timer);
    this.peer.destroy();
    this.conns.clear();
    this.accepted.clear();
  }
}

/** Convidado: entra na sala do host pelo código. */
export class NetClient {
  onMessage: (msg: unknown) => void = () => {};
  /** `lost`: o host ficou 8 s sem responder */
  onClose: (lost: boolean) => void = () => {};
  private closed = false;
  private lastSeen = performance.now();
  private timer: ReturnType<typeof setInterval>;

  private constructor(
    private peer: PeerType,
    private conn: DataConnection,
    readonly code: string,
  ) {
    conn.on('data', (msg) => {
      this.lastSeen = performance.now();
      if (!isPing(msg)) this.onMessage(msg);
    });
    const gone = (lost = false) => {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.timer);
      this.onClose(lost);
    };
    conn.on('close', () => gone());
    conn.on('error', () => gone());
    // ping a cada 1 s (o host usa para saber que ainda estamos aqui); 8 s sem nada do host: caiu
    this.timer = setInterval(() => {
      if (performance.now() - this.lastSeen > DROP_MS) {
        gone(true);
        this.peer.destroy();
      } else this.send({ t: 'ping' });
    }, PING_MS);
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

  private static async tryJoin(code: string, hello: unknown): Promise<NetClient> {
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

  send(msg: unknown): void {
    if (this.conn.open) void this.conn.send(msg);
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    this.peer.destroy();
  }
}
