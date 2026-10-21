import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_PING_MS, LIVE_PONG_WAIT_MS, LIVE_RETRY_MS, isPresencePayload, liveSocketSource, liveUrl, type LiveWebSocket, type PresencePayload } from './liveSocket';
import type { ChangeSignal, TypingSignal } from './wire';

class FakeSocket implements LiveWebSocket {
  readyState = 0;
  sent: string[] = [];
  closedWith?: number;
  onopen: LiveWebSocket['onopen'] = null;
  onmessage: LiveWebSocket['onmessage'] = null;
  onclose: LiveWebSocket['onclose'] = null;
  onerror: LiveWebSocket['onerror'] = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  /** The office object accepts the socket. */
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(data: string) {
    this.onmessage?.({ data });
  }
  /** The connection breaks with no close frame. */
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const signal = (channel: string): ChangeSignal => ({ v: 1, id: 'sig_1', channel: channel as ChangeSignal['channel'], seq: 1, projects: [], office: true, kinds: ['tasks'], people: [] });

function setup(o: { failFirstTicket?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  let n = 0;
  const ticket = vi.fn(async () => {
    n += 1;
    if (o.failFirstTicket && n === 1) throw new Error('The network is down.');
    return { ticket: `t${n}`, expiresAt: '2026-10-04T09:01:00.000+03:00' };
  });
  const heard: { signals: ChangeSignal[]; origin?: string }[] = [];
  let showTab: () => void = () => undefined;
  const source = liveSocketSource({
    me: 'usr_005',
    ticket,
    url: (t) => `wss://madar.test/api/live?ticket=${t}`,
    open: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    page: { visible: () => true, onVisible: (listener) => ((showTab = listener), () => undefined) },
  });
  const stop = source.subscribe((signals, origin) => heard.push({ signals, origin }));
  return { sockets, ticket, heard, source, stop, showTab: () => showTab() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the live socket of the screens (src/api/remote/liveSocket.ts)', () => {
  it('asks a ticket, opens the socket with it, and reloads every list once it is open', async () => {
    const { sockets, ticket, heard, source } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(sockets.map((s) => s.url)).toEqual(['wss://madar.test/api/live?ticket=t1']);
    expect(source.status()).toBe('closed');
    sockets[0].accept();
    expect(heard).toEqual([{ signals: [], origin: 'join' }]);
    expect(source.status()).toBe('open');
  });

  it('passes on a change signal of its own channels and drops every other message', async () => {
    const { sockets, heard } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    sockets[0].message(JSON.stringify({ event: 'changed', payload: signal('office') }));
    sockets[0].message(JSON.stringify({ event: 'changed', payload: signal('person:usr_005') }));
    sockets[0].message(JSON.stringify({ event: 'changed', payload: signal('person:usr_002') }));
    sockets[0].message('not json');
    sockets[0].message(JSON.stringify({ event: 'other', payload: signal('office') }));
    expect(heard.slice(1).map((h) => [h.origin, h.signals[0].channel])).toEqual([['channel', 'office'], ['channel', 'person:usr_005']]);
  });

  it('pings each 30 s, and opens again and reloads when no pong comes in 10 s', async () => {
    const { sockets, heard, ticket } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    await vi.advanceTimersByTimeAsync(LIVE_PING_MS);
    expect(sockets[0].sent).toEqual(['ping']);
    sockets[0].message('pong');
    await vi.advanceTimersByTimeAsync(LIVE_PING_MS);
    expect(sockets[0].sent).toEqual(['ping', 'ping']);
    await vi.advanceTimersByTimeAsync(LIVE_PONG_WAIT_MS);
    expect(sockets[0].closedWith).toBe(4000);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    expect(ticket).toHaveBeenCalledTimes(2);
    sockets[1].accept();
    expect(heard.filter((h) => h.origin === 'join')).toHaveLength(2);
  });

  it('opens again after a drop with a new ticket, and waits longer after each try', async () => {
    const { sockets, ticket } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].drop();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0] - 1);
    expect(ticket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticket).toHaveBeenCalledTimes(2);
    sockets[1].drop();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[1]);
    expect(ticket).toHaveBeenCalledTimes(3);
    sockets[2].accept();
    sockets[2].drop();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    expect(ticket).toHaveBeenCalledTimes(4);
  });

  it('tries the ticket again when it fails', async () => {
    const { sockets, ticket } = setup({ failFirstTicket: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toEqual([]);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    expect(ticket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
  });

  it('pings at once when the tab shows again', async () => {
    const { sockets, showTab } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    showTab();
    expect(sockets[0].sent).toEqual(['ping']);
  });

  it('closes the socket and stops every timer at the last unsubscribe', async () => {
    const { sockets, ticket, stop } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    stop();
    expect(sockets[0].closedWith).toBe(1000);
    await vi.advanceTimersByTimeAsync(10 * LIVE_PING_MS);
    expect(sockets[0].sent).toEqual([]);
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the address of the live socket', () => {
  it('is the page host with ws or wss, the api path and the ticket', () => {
    expect(liveUrl('/api', 'https://madar.vado.sa/projects')('t1')).toBe('wss://madar.vado.sa/api/live?ticket=t1');
    expect(liveUrl('/api/', 'http://127.0.0.1:4174/')('t2')).toBe('ws://127.0.0.1:4174/api/live?ticket=t2');
  });
});

const typing = (o: Partial<TypingSignal> = {}): TypingSignal => ({ v: 1, conversationId: 'cnv_1', userId: 'usr_002', typing: true, at: '2026-10-21T08:00:00.000Z', ...o });

/** A source with the presence and typing hooks of chat presence (L4). */
function setupLive() {
  const sockets: FakeSocket[] = [];
  const presence: PresencePayload[] = [];
  const typed: TypingSignal[] = [];
  const changes: { signals: ChangeSignal[]; origin?: string }[] = [];
  const log: string[] = [];
  const source = liveSocketSource({
    me: 'usr_005',
    ticket: async () => ({ ticket: `t${sockets.length + 1}`, expiresAt: '2026-10-04T09:01:00.000+03:00' }),
    url: (t) => `wss://madar.test/api/live?ticket=${t}`,
    open: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    page: { visible: () => true, onVisible: () => () => undefined },
    onPresence: (payload) => presence.push(payload),
    onTyping: (signal) => typed.push(signal),
    onDrop: () => log.push('drop'),
  });
  const stop = source.subscribe((signals, origin) => changes.push({ signals, origin }));
  return { sockets, presence, typed, changes, log, source, stop };
}

describe('the status and the typing on the live socket (chat presence design, L4)', () => {
  it('sends the state when the socket opens, and again after a new open', async () => {
    const { sockets, source } = setupLive();
    // A state set before the socket opens waits for the open.
    source.sendState?.('online');
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0].sent).toEqual([]);
    sockets[0].accept();
    expect(sockets[0].sent).toEqual([JSON.stringify({ t: 'state', state: 'online' })]);
    // A change goes out at once while the socket is open.
    source.sendState?.('away');
    expect(sockets[0].sent.at(-1)).toBe(JSON.stringify({ t: 'state', state: 'away' }));
    // The socket breaks: the new socket gets the last state, not the first.
    sockets[0].drop();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    sockets[1].accept();
    expect(sockets[1].sent).toEqual([JSON.stringify({ t: 'state', state: 'away' })]);
  });

  it('sends no state before one is set, and nothing on a socket that is not open', async () => {
    const { sockets, source } = setupLive();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    expect(sockets[0].sent).toEqual([]);
    sockets[0].drop();
    source.sendState?.('online');
    expect(sockets[0].sent).toEqual([]);
  });

  it('takes a snapshot and then each change', async () => {
    const { sockets, presence, changes } = setupLive();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    sockets[0].message(JSON.stringify({ event: 'presence', payload: { v: 1, states: { usr_002: 'online', usr_003: 'away' } } }));
    sockets[0].message(JSON.stringify({ event: 'presence', payload: { v: 1, userId: 'usr_003', state: 'offline' } }));
    expect(presence).toEqual([
      { v: 1, states: { usr_002: 'online', usr_003: 'away' } },
      { v: 1, userId: 'usr_003', state: 'offline' },
    ]);
    // A presence event is no change signal.
    expect(changes.map((c) => c.origin)).toEqual(['join']);
  });

  it('drops a presence payload of a wrong shape', async () => {
    const { sockets, presence } = setupLive();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    const bad: unknown[] = [
      null, 'x', { v: 2, states: {} }, { v: 1 }, { v: 1, states: [] }, { v: 1, states: { usr_002: 'busy' } }, { v: 1, states: { usr_002: 3 } },
      { v: 1, userId: 'usr_002' }, { v: 1, userId: 5, state: 'online' }, { v: 1, userId: 'usr_002', state: 'busy' },
    ];
    for (const payload of bad) sockets[0].message(JSON.stringify({ event: 'presence', payload }));
    expect(presence).toEqual([]);
    expect(bad.map(isPresencePayload)).toEqual(bad.map(() => false));
  });

  it('passes a typing signal on, and drops a payload that is not one', async () => {
    const { sockets, typed, changes } = setupLive();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    sockets[0].message(JSON.stringify({ event: 'typing', payload: typing() }));
    sockets[0].message(JSON.stringify({ event: 'typing', payload: typing({ typing: false }) }));
    for (const payload of [null, 'typing', { v: 2 }, { ...typing(), typing: 'yes' }, signal('office')]) sockets[0].message(JSON.stringify({ event: 'typing', payload }));
    expect(typed).toEqual([typing(), typing({ typing: false })]);
    expect(changes.map((c) => c.origin)).toEqual(['join']);
  });

  it('the change listener still gets only changed signals', async () => {
    const { sockets, changes } = setupLive();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    sockets[0].message(JSON.stringify({ event: 'changed', payload: signal('office') }));
    sockets[0].message(JSON.stringify({ event: 'presence', payload: { v: 1, userId: 'usr_003', state: 'online' } }));
    sockets[0].message(JSON.stringify({ event: 'typing', payload: typing() }));
    sockets[0].message(JSON.stringify({ event: 'changed', payload: typing() }));
    expect(changes.map((c) => [c.origin, c.signals.length])).toEqual([['join', 0], ['channel', 1]]);
  });

  it('works with no hooks: a source made as before ignores presence and typing', async () => {
    const { sockets, heard } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    sockets[0].message(JSON.stringify({ event: 'presence', payload: { v: 1, userId: 'usr_003', state: 'online' } }));
    sockets[0].message(JSON.stringify({ event: 'typing', payload: typing() }));
    expect(heard).toEqual([{ signals: [], origin: 'join' }]);
  });

  it('tells onDrop when the socket drops or times out, and not when the source stops by itself', async () => {
    const { sockets, log, stop } = setupLive();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].accept();
    sockets[0].drop();
    expect(log).toEqual(['drop']);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS[0]);
    sockets[1].accept();
    await vi.advanceTimersByTimeAsync(LIVE_PING_MS + LIVE_PONG_WAIT_MS);
    expect(log).toEqual(['drop', 'drop']);
    stop();
    expect(log).toEqual(['drop', 'drop']);
  });
});
