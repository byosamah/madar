import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_PING_MS, LIVE_PONG_WAIT_MS, LIVE_RETRY_MS, liveSocketSource, liveUrl, type LiveWebSocket } from './liveSocket';
import type { ChangeSignal } from './wire';

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
