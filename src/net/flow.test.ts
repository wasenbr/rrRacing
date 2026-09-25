import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataConnection, Peer as PeerType } from 'peerjs';
import { DROP_MS, NetClient, NetHost } from './peer';
import {
  cpuTakesOver, CPU_TAKEOVER_MS, guestDropPlan, LEAVE_FLUSH_MS, loadSession, LocalEcho, newToken, onlineMenuToggle, REJOIN_MS, RejoinBook, saveSession, SESSION_KEY, StallGuard, STALL_MS, STALL_STEPS,
} from './session';
import { parseHello } from './sync';

/* ------------------------------------------------------------------ */
/* Transporte simulado: peers e conexões em memória (sem WebRTC)       */
/* ------------------------------------------------------------------ */

type Fn = (...a: unknown[]) => void;

class Emitter {
  private hs = new Map<string, Fn[]>();
  on(ev: string, fn: Fn): this {
    this.hs.set(ev, [...(this.hs.get(ev) ?? []), fn]);
    return this;
  }
  once(ev: string, fn: Fn): this {
    const w: Fn = (...a) => {
      this.off(ev, w);
      fn(...a);
    };
    return this.on(ev, w);
  }
  off(ev: string, fn: Fn): this {
    this.hs.set(ev, (this.hs.get(ev) ?? []).filter((f) => f !== fn));
    return this;
  }
  emit(ev: string, ...a: unknown[]): void {
    for (const f of [...(this.hs.get(ev) ?? [])]) f(...a);
  }
}

class FakeConn extends Emitter {
  open = false;
  other!: FakeConn;
  /** rede cortada: nada passa e ninguém é avisado (como um cabo puxado) */
  cut = false;
  constructor(
    readonly peer: string,
    readonly label: string,
  ) {
    super();
  }
  send(msg: unknown): void {
    if (!this.open || this.cut) return;
    const copy = JSON.parse(JSON.stringify(msg)) as unknown;
    this.other.emit('data', copy);
  }
  close(): void {
    if (!this.open) return;
    this.open = this.other.open = false;
    this.emit('close');
    this.other.emit('close');
  }
}

class FakeNet {
  peers = new Map<string, FakePeer>();
  peer(id: string): FakePeer {
    const p = new FakePeer(id, this);
    this.peers.set(id, p);
    return p;
  }
}

class FakePeer extends Emitter {
  destroyed = false;
  conns: FakeConn[] = [];
  constructor(
    readonly id: string,
    private net: FakeNet,
  ) {
    super();
  }
  connect(target: string, opts: { label?: string } = {}): FakeConn {
    const label = opts.label ?? 'main';
    const mine = new FakeConn(target, label);
    const theirs = new FakeConn(this.id, label);
    mine.other = theirs;
    theirs.other = mine;
    this.conns.push(mine);
    const t = this.net.peers.get(target);
    if (t && !t.destroyed) {
      t.conns.push(theirs);
      t.emit('connection', theirs);
      mine.open = theirs.open = true;
      theirs.emit('open');
      mine.emit('open');
    }
    return mine;
  }
  destroy(): void {
    this.destroyed = true;
    for (const c of this.conns) c.close();
  }
  reconnect(): void {}
  /** rede do aparelho caiu: todas as conexões ficam mudas */
  unplug(): void {
    for (const c of this.conns) c.cut = c.other.cut = true;
  }
}

const asPeer = (p: FakePeer) => p as unknown as PeerType;
const asConn = (c: FakeConn) => c as unknown as DataConnection;

/**
 * Host mínimo com as mesmas regras do jogo (game.ts): fichas de sessão, vaga guardada para quem cai,
 * "saí" libera a vaga na hora e o carro vira CPU.
 */
function makeHost(net: FakeNet) {
  const host = NetHost.withPeer(asPeer(net.peer('rnrr3d-ABCD')), 'ABCD');
  const seats = new RejoinBook<{ name: string }>();
  const log: string[] = [];
  const racerOf = new Map<string, number>();
  let nextRacer = 1;
  host.onJoin = (id, msg) => {
    const h = parseHello(msg, ['marauder']);
    if (!h) return host.kick(id);
    const back = seats.rejoin(h.rejoin, id, performance.now());
    if (back) {
      if (back.peerId !== id) host.kick(back.peerId);
      racerOf.delete(back.peerId);
      if (back.racer !== undefined) racerOf.set(id, back.racer);
      log.push(`volta:${h.name}:${back.racer}`);
    } else {
      const token = newToken();
      seats.add(token, id, { name: h.name }, nextRacer);
      racerOf.set(id, nextRacer++);
      log.push(`entra:${h.name}`);
    }
    host.accept(id);
    host.send(id, { t: 'lobby', you: id, token: seats.tokenOf(id) });
  };
  const leave = (id: string) => {
    const seat = seats.left(id, performance.now());
    log.push(seat ? `caiu:${seat.player.name}` : `saiu:${id}`);
    racerOf.delete(id);
  };
  host.onLeave = leave;
  host.onMessage = (id, msg) => {
    if ((msg as { t?: string }).t === 'leave') {
      seats.remove(id);
      leave(id);
      host.kick(id);
    }
  };
  return { host, seats, log, racerOf };
}

/** Convidado entrando como o jogo faz (tryJoin): conecta, manda o hello, guarda a ficha que chegar. */
function join(net: FakeNet, name: string, rejoin?: string) {
  const gp = net.peer(`g-${name}-${Math.random().toString(36).slice(2, 6)}`);
  const conn = gp.connect('rnrr3d-ABCD');
  const client = NetClient.withConn(asPeer(gp), asConn(conn), 'ABCD');
  const got: { token?: string; msgs: unknown[]; closed: boolean } = { msgs: [], closed: false };
  client.onMessage = (m) => {
    got.msgs.push(m);
    const t = (m as { token?: string }).token;
    if (t) got.token = t;
  };
  client.onClose = () => (got.closed = true);
  // (o transporte simulado entrega na hora: o hello sai depois de o convidado estar ouvindo)
  conn.send({ t: 'hello', name, color: 1, vehicleId: 'marauder', ...(rejoin && { rejoin }) });
  return { gp, client, got };
}

describe('fluxos da sessão online (transporte simulado)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queda e volta: o host guarda a vaga e devolve o mesmo carro', () => {
    const net = new FakeNet();
    const h = makeHost(net);
    const a = join(net, 'Ana');
    // a ficha chega junto com a sala (lobby) — é dela que a volta depende
    vi.advanceTimersByTime(0);
    expect(a.got.token).toBeTruthy();
    expect(h.racerOf.size).toBe(1);
    // rede cai: ninguém avisa ninguém; os dois lados percebem pelo silêncio
    a.gp.unplug();
    vi.advanceTimersByTime(DROP_MS + 2000);
    expect(h.log).toContain('caiu:Ana');
    expect(a.got.closed).toBe(true);
    expect(h.seats.waiting().length).toBe(1);
    // convidado com ficha: tenta voltar
    expect(guestDropPlan({ gone: false, token: true, racing: true, resultsOpen: false, reconnecting: false })).toBe('retry');
    const b = join(net, 'Ana', a.got.token);
    expect(h.log.at(-1)).toBe('volta:Ana:1');
    expect(h.host.guests).toBe(1);
    expect(b.got.token).toBe(a.got.token);
  });

  it('recarregar: a ficha guardada na aba leva de volta (antes mesmo de o host notar a queda)', () => {
    const net = new FakeNet();
    const h = makeHost(net);
    const a = join(net, 'Bia');
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    saveSession(store, { code: 'ABCD', token: a.got.token!, name: 'Bia', color: 1, vehicleId: 'marauder' });
    // página recarregada: a conexão velha ainda não caiu do lado do host
    const saved = loadSession(store);
    expect(saved).toEqual({ code: 'ABCD', token: a.got.token, name: 'Bia', color: 1, vehicleId: 'marauder' });
    const b = join(net, saved!.name, saved!.token);
    expect(h.log).toEqual(['entra:Bia', 'volta:Bia:1']);
    expect(h.host.guests).toBe(1);
    expect(b.got.closed).toBe(false);
    // ficha adulterada no armazenamento não serve
    mem.set(SESSION_KEY, JSON.stringify({ code: 'ABCD', token: '<script>' }));
    expect(loadSession(store)).toBeNull();
    mem.set(SESSION_KEY, '{quebrado');
    expect(loadSession(store)).toBeNull();
    saveSession(store, null);
    expect(mem.has(SESSION_KEY)).toBe(false);
  });

  it('host sai: a despedida chega antes de a conexão fechar e o convidado não tenta voltar', () => {
    const net = new FakeNet();
    const h = makeHost(net);
    const a = join(net, 'Caio');
    h.host.broadcast({ t: 'end', bye: true });
    setTimeout(() => h.host.close(), 400);
    vi.advanceTimersByTime(500);
    expect(a.got.msgs.some((m) => (m as { bye?: boolean }).bye === true)).toBe(true);
    expect(a.got.closed).toBe(true);
    // placar na tela: só fecha a rede; correndo: placar com aviso; na sala: volta ao menu
    expect(guestDropPlan({ gone: true, token: true, racing: false, resultsOpen: true, reconnecting: false })).toBe('close');
    expect(guestDropPlan({ gone: true, token: true, racing: true, resultsOpen: false, reconnecting: false })).toBe('giveUp');
    expect(guestDropPlan({ gone: true, token: true, racing: false, resultsOpen: false, reconnecting: false })).toBe('lost');
    // sem ficha não dá para voltar; já tentando: não começa outra tentativa
    expect(guestDropPlan({ gone: false, token: false, racing: true, resultsOpen: false, reconnecting: false })).toBe('giveUp');
    expect(guestDropPlan({ gone: false, token: false, racing: false, resultsOpen: false, reconnecting: false })).toBe('lost');
    expect(guestDropPlan({ gone: false, token: true, racing: true, resultsOpen: false, reconnecting: true })).toBe('none');
  });

  it('"Sair da sala": o "saí" chega antes do fim da conexão e a vaga não fica guardada', () => {
    const net = new FakeNet();
    const h = makeHost(net);
    const a = join(net, 'Duda');
    const token = a.got.token!;
    a.client.leave({ t: 'leave' });
    // o "saí" já chegou; a conexão ainda está aberta até o prazo
    expect(h.log).toEqual(['entra:Duda', `saiu:${[...net.peers.keys()].find((k) => k.startsWith('g-Duda'))}`]);
    expect(a.gp.destroyed).toBe(false);
    vi.advanceTimersByTime(LEAVE_FLUSH_MS);
    expect(a.gp.destroyed).toBe(true);
    // o fim da conexão não vira "caiu": não há vaga guardada nem volta com a ficha
    expect(h.log.filter((l) => l.startsWith('caiu')).length).toBe(0);
    expect(h.seats.waiting().length).toBe(0);
    expect(h.host.guests).toBe(0);
    expect(a.got.closed).toBe(false); // saída de propósito não dispara "reconectando"
    join(net, 'Duda', token);
    expect(h.log.at(-1)).toBe('entra:Duda');
  });

  it('vaga guardada vence em 30 s', () => {
    const net = new FakeNet();
    const h = makeHost(net);
    const a = join(net, 'Eva');
    a.gp.unplug();
    vi.advanceTimersByTime(DROP_MS + 2000);
    vi.advanceTimersByTime(REJOIN_MS + 1);
    expect(h.seats.expire(performance.now()).length).toBe(1);
    join(net, 'Eva', a.got.token);
    expect(h.log.at(-1)).toBe('entra:Eva');
  });
});

describe('menu e placar online', () => {
  it('Esc com o placar na tela não abre o menu (o placar e o "Voltar à sala" ficam)', () => {
    expect(onlineMenuToggle('finished', true, false)).toBe('ignore');
    expect(onlineMenuToggle('menu', false, false)).toBe('ignore');
    // nos 3 s antes do placar abre; quando o placar entra o jogo zera o menu e o Esc volta a ser ignorado
    expect(onlineMenuToggle('finished', false, false)).toBe('open');
    expect(onlineMenuToggle('racing', false, false)).toBe('open');
    expect(onlineMenuToggle('racing', false, true)).toBe('close');
    expect(onlineMenuToggle('finished', true, true)).toBe('close');
  });
});

describe('conexão instável', () => {
  it('convidado: previsão anda sozinha só ~250 ms depois de 500 ms sem estado', () => {
    const g = new StallGuard();
    expect(g.step(100)).toBe(true);
    expect(g.stalled).toBe(false);
    let steps = 0;
    for (let k = 0; k < 60; k++) if (g.step(STALL_MS + 1 + k * 16)) steps++;
    expect(g.stalled).toBe(true);
    expect(steps).toBe(STALL_STEPS);
    // estado novo chegou: volta ao normal
    expect(g.step(10)).toBe(true);
    expect(g.stalled).toBe(false);
  });

  it('host: a CPU assume depois de 1,5 s sem comandos ou com a aba do convidado oculta', () => {
    expect(cpuTakesOver(1000, 900, false)).toBe(false);
    expect(cpuTakesOver(1000 + CPU_TAKEOVER_MS + 1, 1000, false)).toBe(true);
    expect(cpuTakesOver(1000, 999, true)).toBe(true);
    expect(cpuTakesOver(1000, undefined, false)).toBe(true);
  });
});

describe('retorno local de tiro, bomba e turbo', () => {
  it('o evento do host que confirma um toque já mostrado é engolido (um por toque)', () => {
    const e = new LocalEcho();
    e.played(0, 0);
    e.played(0, 100);
    expect(e.count(0, 200)).toBe(2);
    expect(e.echo(0, 300)).toBe(true);
    expect(e.echo(0, 300)).toBe(true);
    expect(e.echo(0, 300)).toBe(false); // terceiro tiro não foi mostrado: toca normal
    expect(e.echo(1, 300)).toBe(false);
  });

  it('toque que o host não confirmou em 1,5 s não engole o evento seguinte', () => {
    const e = new LocalEcho();
    e.played(2, 0);
    expect(e.echo(2, 2000)).toBe(false);
    expect(e.count(2, 2000)).toBe(0);
  });
});
