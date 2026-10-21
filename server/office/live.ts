import { nowStamp } from '../../src/lib/dates';
import { resolveActor } from '../core/actor';
import type { LivePort, Logger, Query, SignalPort } from '../core/ports';
import type { ChangeSignal, OfficeSnapshot, RunError } from '../core/types';
import { onCommit } from '../data/lite/db';
import { errorResponse, runErrorOf } from '../http/errors';
import { SIGNAL_EVENT } from '../signal/realtime';
import { announceChanges, officeStates, retire, sendStates, type DeviceState } from './presence';

/**
 * Live updates on the sockets of the office object (exit wave 3; spec section 2, "Live updates"). The object holds every browser
 * socket with the Hibernation API, with two tags: "office" and "person:<id>". A save gives its signals to liveSignals inside the
 * transaction, and they go out after the commit (onCommit), so a rollback sends nothing, as realtime.send of Postgres does. The
 * rules of server/signal/realtime.ts stay: the save decides which channels get a signal (Diff.privateChange), the port only sends.
 *
 * - A browser socket cannot send a header, so it opens with a ticket from live.ticket: 32 random bytes in memory, 60 s, one use,
 *   for one person. The tags come from the ticket, never from the address.
 * - The runtime answers "ping" with "pong" and does not wake the object (setWebSocketAutoResponse; wave 0: 59 of 60). A socket that
 *   broke with no close frame stays in getWebSockets (wave 0: 17.7 minutes), so each delivery and each Cron run close a socket with
 *   no pong for LIVE_STALE_MS. The client pings each 30 s (src/api/remote/liveSocket.ts), so 150 s is 5 missed pings.
 * - The commit that turns a person off closes that person's sockets (closeOff), so no signal reaches a person who is off.
 * - The status of people rides on the same sockets (server/office/presence.ts, chat presence design): a socket keeps the state that its
 *   screen sent in its attachment, and a close of any kind (sweep, closeOff, the socket itself) tells the office when a person goes.
 */

export const LIVE_PING = 'ping';
export const LIVE_PONG = 'pong';
export const TICKET_MS = 60_000;
/** At most this many tickets wait in memory: a person opens one socket for each tab. */
export const TICKET_CAP = 200;
export const TICKET_SHAPE = /^[0-9a-f]{64}$/;
export const LIVE_STALE_MS = 150_000;
/** The close codes of the object: 4000 a socket with no pong, 4003 a person who is off. */
export const CLOSE_STALE = 4000;
export const CLOSE_OFF = 4003;

/** One answer for every ticket that does not open: it names no person and no reason. */
export const TICKET_REFUSED: RunError = { code: 'unauthenticated', message: 'This live ticket is not valid. Ask for a new one.' };

/** The part of a server socket of workerd that the object uses. */
export type LiveSocket = {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

/** The Hibernation API of the object state (server/office/office.ts), so node tests can use a fake (server/office/test/fakes.ts). */
export type Sockets = {
  accept(socket: LiveSocket, tags: string[]): void;
  list(tag?: string): LiveSocket[];
  lastPong(socket: LiveSocket): Date | null;
  pair(): { client: unknown; server: LiveSocket };
  upgraded(client: unknown): Response;
};

/** The note of a socket (its attachment): the person and the open time from the ticket, then the device state that the screen sent. */
export type SocketNote = { userId: string; openedAt: number; state?: DeviceState };

export function noteOf(socket: LiveSocket): SocketNote | undefined {
  const note = socket.deserializeAttachment() as Partial<SocketNote> | null;
  return note && typeof note.userId === 'string' && typeof note.openedAt === 'number'
    ? { userId: note.userId, openedAt: note.openedAt, ...(note.state === 'online' || note.state === 'away' ? { state: note.state } : {}) }
    : undefined;
}

export class LiveTickets implements LivePort {
  readonly #held = new Map<string, { userId: string; until: number }>();

  mint(userId: string, now: Date): { ticket: string; expiresAt: string } {
    const at = now.getTime();
    for (const [ticket, held] of this.#held) if (held.until < at) this.#held.delete(ticket);
    while (this.#held.size >= TICKET_CAP) this.#held.delete(this.#held.keys().next().value as string);
    const ticket = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const until = at + TICKET_MS;
    this.#held.set(ticket, { userId, until });
    return { ticket, expiresAt: nowStamp(new Date(until)) };
  }

  /** The person of a ticket, once. A ticket of the wrong shape, an unknown one and an old one give undefined. */
  take(ticket: string, now: Date): { userId: string } | undefined {
    if (!TICKET_SHAPE.test(ticket)) return undefined;
    const held = this.#held.get(ticket);
    this.#held.delete(ticket);
    if (!held || held.until < now.getTime()) return undefined;
    return { userId: held.userId };
  }
}

/** Closes each socket with no auto pong (or, if it never pinged, no open) for staleMs. Gives the count it closed. */
export function sweep(sockets: Sockets, now: Date, staleMs: number): number {
  const victims: { socket: LiveSocket; code: number; reason: string }[] = [];
  for (const socket of sockets.list()) {
    const last = sockets.lastPong(socket)?.getTime() ?? noteOf(socket)?.openedAt ?? 0;
    if (now.getTime() - last <= staleMs) continue;
    victims.push({ socket, code: CLOSE_STALE, reason: 'No pong for a long time.' });
  }
  return retire(sockets, victims);
}

/** Closes each socket whose person is not an active user of the office. Gives the count it closed. */
export function closeOff(sockets: Sockets, office: OfficeSnapshot): number {
  const victims: { socket: LiveSocket; code: number; reason: string }[] = [];
  for (const socket of sockets.list()) {
    const userId = noteOf(socket)?.userId;
    if (userId !== undefined && office.lists.users[userId]?.active === true) continue;
    victims.push({ socket, code: CLOSE_OFF, reason: 'The account is off.' });
  }
  return retire(sockets, victims);
}

export type LiveOptions = { sockets: Sockets; log: Logger; now: () => Date; staleMs: number };

/** Sends each signal to the sockets of its channel, after a sweep. A send that throws counts as a failed signal. */
export function deliver(o: LiveOptions, signals: readonly ChangeSignal[]): void {
  sweep(o.sockets, o.now(), o.staleMs);
  let failed = 0;
  for (const signal of signals) {
    const text = JSON.stringify({ event: SIGNAL_EVENT, payload: signal });
    for (const socket of o.sockets.list(signal.channel)) {
      try {
        socket.send(text);
      } catch {
        failed += 1;
      }
    }
  }
  if (failed === 0) return;
  o.log.warn('A change signal did not reach an open socket. The screen reloads when its socket opens again.', { failed });
}

/** The SignalPort of the office object: the signals of a transaction go out after its commit, and a rollback drops them. */
export function liveSignals(o: LiveOptions): SignalPort {
  return {
    async send(q: Query, signals: ChangeSignal[]): Promise<void> {
      if (signals.length === 0) return;
      const copy = signals.map((signal) => ({ ...signal }));
      onCommit(q, () => deliver(o, copy));
    },
  };
}

/** Opens the socket of a ticket: the person must still act now; the tags come from the ticket. */
export async function acceptLive(
  o: { sockets: Sockets; tickets: LiveTickets; office: () => Promise<OfficeSnapshot>; now: () => Date },
  request: Request,
): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('This address needs a WebSocket.', { status: 426 });
  const held = o.tickets.take(new URL(request.url).searchParams.get('ticket') ?? '', o.now());
  if (!held) return errorResponse(TICKET_REFUSED);
  try {
    resolveActor(await o.office(), { userId: held.userId });
  } catch (error) {
    return errorResponse(runErrorOf(error));
  }
  const { client, server } = o.sockets.pair();
  const before = officeStates(o.sockets);
  o.sockets.accept(server, ['office', `person:${held.userId}`]);
  server.serializeAttachment({ userId: held.userId, openedAt: o.now().getTime() } satisfies SocketNote);
  // The new socket gets the states of all in one event; the others hear of its person if that person was not here before (a socket
  // with no state yet counts as Away, and the state message that follows gives Online).
  const after = officeStates(o.sockets);
  sendStates(server, after);
  announceChanges(o.sockets, before, after, server);
  return o.sockets.upgraded(client);
}
