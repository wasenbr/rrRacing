import { describe, expect, it } from 'vitest';
import { pong } from './peer';
import { backoffMs, canCloseRace, FINISH_GRACE_MS, isToken, JitterBuffer, newToken, pingTone, REJOIN_MS, RejoinBook, Rtt, SNAP_BUFFER_MAX, SNAP_BUFFER_MIN } from './session';
import { parseHello, parseLobbyPlayers, parseRacerList, validateEvents } from './sync';

describe('reconexão', () => {
  it('ficha de sessão: 16 caracteres, só letras minúsculas e números', () => {
    const t = newToken();
    expect(isToken(t)).toBe(true);
    expect(newToken()).not.toBe(t);
    expect(isToken('<script>')).toBe(false);
    expect(isToken(42)).toBe(false);
  });

  it('quem cai volta para a mesma vaga e o mesmo carro dentro de 30 s', () => {
    const book = new RejoinBook<{ name: string }>();
    const t = newToken();
    book.add(t, 'peer-a', { name: 'Ana' });
    book.setRacer('peer-a', 3);
    expect(book.tokenOf('peer-a')).toBe(t);
    const seat = book.left('peer-a', 1000);
    expect(seat?.racer).toBe(3);
    expect(book.tokenOf('peer-a')).toBeUndefined();
    expect(book.waiting().length).toBe(1);
    const back = book.rejoin(t, 'peer-b', 1000 + REJOIN_MS - 1);
    expect(back?.racer).toBe(3);
    expect(back?.peerId).toBe('peer-a'); // id antigo (para derrubar a conexão velha)
    expect(back?.player.name).toBe('Ana');
    expect(book.tokenOf('peer-b')).toBe(t);
  });

  it('vaga vence depois de 30 s; ficha errada não serve', () => {
    const book = new RejoinBook<string>();
    const t = newToken();
    book.add(t, 'p', 'x', 1);
    book.left('p', 0);
    expect(book.rejoin('aaaaaaaaaaaaaaaa', 'q', 10)).toBeUndefined();
    expect(book.rejoin({}, 'q', 10)).toBeUndefined();
    expect(book.expire(REJOIN_MS - 1)).toEqual([]);
    expect(book.expire(REJOIN_MS + 1).length).toBe(1);
    expect(book.rejoin(t, 'q', REJOIN_MS + 2)).toBeUndefined();
  });

  it('voltar antes do host notar a queda também devolve a vaga', () => {
    const book = new RejoinBook<string>();
    const t = newToken();
    book.add(t, 'old', 'x', 2);
    const s = book.rejoin(t, 'new', 5);
    expect(s?.peerId).toBe('old');
    expect(s?.racer).toBe(2);
    book.clearRacers();
    expect(book.rejoin(t, 'newer', 6)?.racer).toBeUndefined();
  });

  it('tentativas com espera crescente, até 5 s', () => {
    expect([0, 1, 2, 3, 4, 8].map(backoffMs)).toEqual([1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it('hello com a ficha de volta passa pela validação', () => {
    const h = parseHello({ t: 'hello', name: 'Zé', color: 1, vehicleId: 'nope', rejoin: 'abc' }, ['marauder']);
    expect(h?.rejoin).toBe('abc');
    expect(h?.vehicleId).toBe('marauder');
  });
});

describe('placar online', () => {
  it('host volta à sala sem perguntar só com todos os humanos na chegada ou depois do prazo', () => {
    expect(canCloseRace([true, false], null, 0)).toBe(false);
    expect(canCloseRace([true, false], 1000, 1000 + FINISH_GRACE_MS - 1)).toBe(false);
    expect(canCloseRace([true, false], 1000, 1000 + FINISH_GRACE_MS)).toBe(true);
    expect(canCloseRace([true, true], 1000, 1001)).toBe(true);
  });

  it('eventos e listas de carros vindos do host são conferidos', () => {
    expect(validateEvents([{ type: 'finish', racer: 1, place: 1 }, { type: 'finish', racer: 9 }, { type: 'xss' }, 'x'], 4)).toEqual([{ type: 'finish', racer: 1, place: 1 }]);
    expect(validateEvents('nada', 4)).toEqual([]);
    expect(parseRacerList([0, 3, 4, -1, 1.5, '2'], 4)).toEqual([0, 3]);
    expect(parseRacerList(null, 4)).toEqual([]);
  });
});

describe('ping', () => {
  it('média móvel ignora amostras absurdas', () => {
    const r = new Rtt();
    expect(r.value).toBeNull();
    r.add(100);
    expect(r.value).toBe(100);
    r.add(NaN);
    r.add(-5);
    r.add(1e9);
    expect(r.value).toBe(100);
    r.add(200);
    expect(r.value).toBe(125);
  });

  it('cor do indicador', () => {
    expect(pingTone(null)).toBe('none');
    expect(pingTone(40)).toBe('good');
    expect(pingTone(120)).toBe('ok');
    expect(pingTone(400)).toBe('bad');
  });

  it('pong devolve só carimbos numéricos', () => {
    expect(pong({ t: 'ping', ts: 12.5 })).toEqual({ t: 'pong', ts: 12.5 });
    expect(pong({ t: 'ping', ts: '<b>' })).toBeNull();
    expect(pong({ t: 'ping', ts: Infinity })).toBeNull();
    expect(pong(null)).toBeNull();
  });

  it('ping de cada piloto na sala: só números válidos', () => {
    const ps = parseLobbyPlayers(
      [
        { id: 'host', name: 'A', color: 1, vehicleId: 'm' },
        { id: 'g', name: 'B', color: 1, vehicleId: 'm', ping: 87.6, away: true },
        { id: 'h', name: 'C', color: 1, vehicleId: 'm', ping: 'x' },
        { id: 'i', name: 'D', color: 1, vehicleId: 'm', ping: -3 },
      ],
      [1],
      ['m'],
    );
    expect(ps?.map((p) => p.ping)).toEqual([undefined, 88, undefined, undefined]);
    expect(ps?.[1].away).toBe(true);
  });
});

describe('folga de reprodução do convidado', () => {
  it('rede lisa: 2 estados; rede irregular: mais, até 5', () => {
    const smooth = new JitterBuffer();
    for (let k = 0; k < 100; k++) smooth.add(k, 1000 + k * 50 + (k % 2) * 3, 50);
    expect(smooth.packets).toBe(SNAP_BUFFER_MIN);
    const bursty = new JitterBuffer();
    // rajadas: a cada 4 estados, chegam 3 atrasados ~120 ms
    for (let k = 0; k < 100; k++) bursty.add(k, 1000 + k * 50 + (k % 4 ? 120 : 0), 50);
    expect(bursty.packets).toBeGreaterThan(SNAP_BUFFER_MIN);
    expect(bursty.packets).toBeLessThanOrEqual(SNAP_BUFFER_MAX);
    const awful = new JitterBuffer();
    for (let k = 0; k < 100; k++) awful.add(k, 1000 + k * 50 + (k % 3) * 900, 50);
    expect(awful.packets).toBe(SNAP_BUFFER_MAX);
    awful.reset();
    expect(awful.packets).toBe(SNAP_BUFFER_MIN);
    awful.add(NaN, 1, 50);
    expect(awful.packets).toBe(SNAP_BUFFER_MIN);
  });
});
