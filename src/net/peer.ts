import type { DataConnection, Peer as PeerType } from 'peerjs';

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

/** Host: dono da sala, recebe os amigos. */
export class NetHost {
  private conns = new Map<string, DataConnection>();
  onJoin: (peerId: string, msg: unknown) => void = () => {};
  onMessage: (peerId: string, msg: unknown) => void = () => {};
  onLeave: (peerId: string) => void = () => {};

  private constructor(
    private peer: PeerType,
    readonly code: string,
  ) {
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
      });
      let greeted = false;
      conn.on('data', (msg) => {
        if (!greeted) {
          greeted = true;
          this.onJoin(conn.peer, msg);
        } else this.onMessage(conn.peer, msg);
      });
      const gone = () => {
        if (!this.conns.delete(conn.peer)) return;
        this.onLeave(conn.peer);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    // se o servidor de apresentação cair, as conexões já abertas continuam; tenta voltar
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
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

  send(peerId: string, msg: unknown): void {
    const c = this.conns.get(peerId);
    if (c?.open) void c.send(msg);
  }

  broadcast(msg: unknown): void {
    for (const c of this.conns.values()) if (c.open) void c.send(msg);
  }

  kick(peerId: string): void {
    this.conns.get(peerId)?.close();
    this.conns.delete(peerId);
  }

  close(): void {
    this.peer.destroy();
    this.conns.clear();
  }
}

/** Convidado: entra na sala do host pelo código. */
export class NetClient {
  onMessage: (msg: unknown) => void = () => {};
  onClose: () => void = () => {};
  private closed = false;

  private constructor(
    private peer: PeerType,
    private conn: DataConnection,
    readonly code: string,
  ) {
    conn.on('data', (msg) => this.onMessage(msg));
    const gone = () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose();
    };
    conn.on('close', gone);
    conn.on('error', gone);
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
    this.peer.destroy();
  }
}
