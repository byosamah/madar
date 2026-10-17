import type { ChangeSignal } from './wire';

/**
 * The live updates of the real build on the office object (exit wave 3; spec section 2, "Live updates"). One socket carries the
 * two channels of a person, "office" and "person:<id>". The Supabase build keeps Realtime (src/app/remote/channel.ts).
 *
 * - Open: ask live.ticket, then open <api>/live?ticket=<ticket> (a browser socket cannot send a header). Once it is open, the
 *   listeners get an empty list with the origin 'join', which reloads every list: a socket keeps no message for a later open.
 * - Each 30 s the socket sends "ping"; the office object answers "pong" with no wake. No pong in 10 s means the socket died with no
 *   close frame (a phone that slept): this source closes it and opens a new one, which reloads (wave 0 change 4).
 * - A drop opens again after 1, 2, 5, 10, then 30 s, each time with a new ticket. A tab that shows again pings at once.
 * - Only a signal of its own two channels passes. This file imports nothing from src/app (root rule): its listener matches the
 *   ChangeListener of src/app/signals.ts.
 */

export type LiveOrigin = 'channel' | 'join';
export type LiveListener = (signals: ChangeSignal[], origin?: LiveOrigin) => void;
export type LiveSource = { subscribe(listener: LiveListener): () => void; status(): 'open' | 'closed' };

/** The part of a browser WebSocket that the source uses, so a test can pass a fake. */
export type LiveWebSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type LiveSocketOptions = {
  me: string;
  ticket: () => Promise<{ ticket: string; expiresAt: string }>;
  url: (ticket: string) => string;
  open?: (url: string) => LiveWebSocket;
  page?: { visible(): boolean; onVisible(listener: () => void): () => void };
};

export const LIVE_PING_MS = 30_000;
export const LIVE_PONG_WAIT_MS = 10_000;
export const LIVE_RETRY_MS = [1000, 2000, 5000, 10_000, 30_000] as const;
const OPEN = 1;

/** True for a change signal of the wire form on one of the topics. */
export function isChangeSignal(value: unknown, topics: readonly string[]): value is ChangeSignal {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string');
  return s.v === 1 && typeof s.id === 'string' && typeof s.channel === 'string' && topics.includes(s.channel)
    && typeof s.seq === 'number' && Number.isFinite(s.seq) && strings(s.projects) && typeof s.office === 'boolean'
    && strings(s.kinds) && strings(s.people);
}

/** The socket address for a ticket: the api address of the build (the page's own /api) on the page host, with ws or wss. */
export function liveUrl(apiUrl: string, page: string): (ticket: string) => string {
  const base = new URL(`${apiUrl.replace(/\/+$/, '')}/live`, page);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return (ticket) => {
    const url = new URL(base);
    url.searchParams.set('ticket', ticket);
    return url.toString();
  };
}

function browserPage(): LiveSocketOptions['page'] {
  if (typeof document === 'undefined') return undefined;
  return {
    visible: () => document.visibilityState === 'visible',
    onVisible: (listener) => {
      const shown = () => {
        if (document.visibilityState === 'visible') listener();
      };
      document.addEventListener('visibilitychange', shown);
      return () => document.removeEventListener('visibilitychange', shown);
    },
  };
}

export function liveSocketSource(o: LiveSocketOptions): LiveSource {
  const listeners = new Set<LiveListener>();
  const open = o.open ?? ((url: string) => new WebSocket(url) as unknown as LiveWebSocket);
  const page = o.page ?? browserPage();
  const topics = ['office', `person:${o.me}`];
  let running = false;
  let generation = 0;
  let socket: LiveWebSocket | undefined;
  let tries = 0;
  let pinger: ReturnType<typeof setInterval> | undefined;
  let pongWait: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopPage: (() => void) | undefined;

  const tell = (signals: ChangeSignal[], origin: LiveOrigin = 'channel') => {
    for (const listener of [...listeners]) listener(signals, origin);
  };

  function clearTimers(): void {
    if (pinger !== undefined) clearInterval(pinger);
    if (pongWait !== undefined) clearTimeout(pongWait);
    pinger = undefined;
    pongWait = undefined;
  }

  /** The socket is gone: a drop, an error, or no pong. Only the current socket counts, once. */
  function dropped(ws: LiveWebSocket): void {
    if (socket !== ws) return;
    socket = undefined;
    clearTimers();
    if (running) schedule();
  }

  function ping(): void {
    const ws = socket;
    if (!ws || ws.readyState !== OPEN || pongWait !== undefined) return;
    ws.send('ping');
    pongWait = setTimeout(() => {
      pongWait = undefined;
      ws.close(4000, 'No pong.');
      dropped(ws);
    }, LIVE_PONG_WAIT_MS);
  }

  function schedule(): void {
    if (retry !== undefined) return;
    const wait = LIVE_RETRY_MS[Math.min(tries, LIVE_RETRY_MS.length - 1)];
    tries += 1;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, wait);
  }

  function connect(): void {
    const mine = ++generation;
    o.ticket().then(
      ({ ticket }) => {
        if (!running || mine !== generation) return;
        const ws = open(o.url(ticket));
        socket = ws;
        ws.onopen = () => {
          if (socket !== ws) return;
          tries = 0;
          clearTimers();
          pinger = setInterval(ping, LIVE_PING_MS);
          tell([], 'join');
        };
        ws.onmessage = (event) => {
          if (socket !== ws) return;
          const text = String(event.data);
          if (text === 'pong') {
            if (pongWait !== undefined) clearTimeout(pongWait);
            pongWait = undefined;
            return;
          }
          let message: { event?: unknown; payload?: unknown } | null;
          try {
            message = JSON.parse(text) as { event?: unknown; payload?: unknown } | null;
          } catch {
            return;
          }
          if (message?.event === 'changed' && isChangeSignal(message.payload, topics)) tell([message.payload]);
        };
        ws.onclose = () => dropped(ws);
        ws.onerror = () => dropped(ws);
      },
      () => {
        if (running && mine === generation) schedule();
      },
    );
  }

  function start(): void {
    running = true;
    tries = 0;
    stopPage = page?.onVisible(() => ping());
    connect();
  }

  function stop(): void {
    running = false;
    generation += 1;
    clearTimers();
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    stopPage?.();
    stopPage = undefined;
    const ws = socket;
    socket = undefined;
    ws?.close(1000, 'Done.');
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!running) start();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    status: () => (running && socket?.readyState === OPEN ? 'open' : 'closed'),
  };
}
