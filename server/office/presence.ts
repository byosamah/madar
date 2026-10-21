import { TYPING_EVENT, type TypingSignal } from '../../src/api/remote/wire';
import type { TypingPort } from '../core/ports';
import type { LiveSocket, Sockets } from './live';

/**
 * The status of people and the typing signals on the sockets of the office object (chat presence design, "The office path"). The object
 * knows the person of each socket from its ticket. A screen sends { "t": "state", "state": "online" | "away" } on its socket, the object
 * keeps the state in the attachment of the socket (so it outlives a hibernation) and tells every "office" socket when the combined state
 * of a person changes. A new socket gets the states of all in one event. Nothing here is saved in the database.
 *
 * - A person shows Online when any of their sockets is Online, else Away when they have a socket, else Offline (the screens read a
 *   person with no entry as Offline). A socket that has sent no state counts as Away: Madar is open there.
 * - A closed, errored or swept socket and a turned-off person leave the count. The note of such a socket says "closing", because the
 *   runtime may still list a socket for a moment after its close started.
 * - The person is always the one of the ticket. The message names no person, so no socket can set the state of another person.
 * - server/ may not import src/app, so the three types and combineStates of src/app/live/types.ts are copied here (one line of rule).
 */

export const PRESENCE_EVENT = 'presence';
/** A state message is a few bytes; a longer text is not one. */
export const STATE_MESSAGE_MAX = 200;

export type DeviceState = 'online' | 'away';
export type PersonState = DeviceState | 'offline';

/** The state of a person from their devices (a copy of combineStates in src/app/live/types.ts). */
export function combineStates(devices: readonly DeviceState[]): PersonState {
  if (devices.includes('online')) return 'online';
  return devices.length > 0 ? 'away' : 'offline';
}

type Reading = { userId: string; state: DeviceState; closing: boolean };

/** The person, the state and the closing mark of a socket. A broken note counts for nobody. A socket with no state is Away. */
function readingOf(socket: LiveSocket): Reading | undefined {
  const note = socket.deserializeAttachment() as { userId?: unknown; state?: unknown; closing?: unknown } | null;
  if (!note || typeof note.userId !== 'string') return undefined;
  return { userId: note.userId, state: note.state === 'online' ? 'online' : 'away', closing: note.closing === true };
}

/** Writes a change into the note of a socket and keeps the rest of it. Gives false when the socket cannot take it (it is closed). */
function amend(socket: LiveSocket, change: Record<string, unknown>): boolean {
  try {
    const note = (socket.deserializeAttachment() ?? {}) as Record<string, unknown>;
    socket.serializeAttachment({ ...note, ...change });
    return true;
  } catch {
    return false;
  }
}

/**
 * The state of each person who has a socket. extra: sockets that the list may not hold (a socket whose close handler runs). A socket
 * marked as closing does not count.
 */
export function officeStates(sockets: Sockets, extra: readonly LiveSocket[] = []): Record<string, PersonState> {
  const list = sockets.list();
  const devices = new Map<string, DeviceState[]>();
  for (const socket of [...list, ...extra.filter((one) => !list.includes(one))]) {
    const reading = readingOf(socket);
    if (!reading || reading.closing) continue;
    devices.set(reading.userId, [...(devices.get(reading.userId) ?? []), reading.state]);
  }
  const states: Record<string, PersonState> = {};
  for (const [userId, own] of devices) states[userId] = combineStates(own);
  return states;
}

const send = (socket: LiveSocket, text: string): void => {
  try {
    socket.send(text);
  } catch {
    // A socket that is gone gets the new state when it opens again.
  }
};

/** Tells every office socket (except one) each person whose state differs between the two readings. Gives the count of changes. */
export function announceChanges(sockets: Sockets, before: Record<string, PersonState>, after: Record<string, PersonState>, except?: LiveSocket): number {
  const changes: { userId: string; state: PersonState }[] = [];
  for (const userId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[userId] ?? 'offline';
    const now = after[userId] ?? 'offline';
    if (was !== now) changes.push({ userId, state: now });
  }
  if (changes.length === 0) return 0;
  for (const socket of sockets.list('office')) {
    if (socket === except) continue;
    for (const change of changes) send(socket, JSON.stringify({ event: PRESENCE_EVENT, payload: { v: 1, ...change } }));
  }
  return changes.length;
}

/** Gives one socket the states of all people (the snapshot of a new socket). */
export function sendStates(socket: LiveSocket, states: Record<string, PersonState>): void {
  send(socket, JSON.stringify({ event: PRESENCE_EVENT, payload: { v: 1, states } }));
}

/**
 * A message of a socket. Gives true when it was a state message: { "t": "state", "state": "online" | "away" } and nothing else of note.
 * The state goes into the note of the socket, and the office hears of a change of the person. Anything else gives false and changes nothing.
 */
export function stateMessage(sockets: Sockets, socket: LiveSocket, message: string | ArrayBuffer): boolean {
  if (typeof message !== 'string' || message.length > STATE_MESSAGE_MAX) return false;
  let body: { t?: unknown; state?: unknown } | null;
  try {
    body = JSON.parse(message) as { t?: unknown; state?: unknown } | null;
  } catch {
    return false;
  }
  if (typeof body !== 'object' || body === null || body.t !== 'state' || (body.state !== 'online' && body.state !== 'away')) return false;
  const reading = readingOf(socket);
  if (!reading || reading.closing) return false;
  const before = officeStates(sockets, [socket]);
  if (!amend(socket, { state: body.state })) return false;
  announceChanges(sockets, before, officeStates(sockets, [socket]));
  return true;
}

/**
 * A socket closed or failed (the close and error handlers of the object). The person may have another device, so the office hears of a
 * change only when the combined state changes. Call this before the socket is closed by the object, or after: both give the same count.
 */
export function socketClosed(sockets: Sockets, socket: LiveSocket): void {
  const before = officeStates(sockets, [socket]);
  amend(socket, { closing: true });
  announceChanges(sockets, before, officeStates(sockets));
}

/**
 * Closes the sockets in the list with the code, and tells the office which people went Offline or Away because of it. Each socket is
 * marked first, so the count is right whether or not the runtime still lists it. Gives the count of sockets closed.
 */
export function retire(sockets: Sockets, victims: readonly { socket: LiveSocket; code: number; reason: string }[]): number {
  if (victims.length === 0) return 0;
  const before = officeStates(sockets);
  for (const { socket } of victims) amend(socket, { closing: true });
  for (const { socket, code, reason } of victims) {
    try {
      socket.close(code, reason);
    } catch {
      // The socket is closed already.
    }
  }
  announceChanges(sockets, before, officeStates(sockets));
  return victims.length;
}

/**
 * The typing signals on the office sockets (chat presence design B). The server call names the members who may see the signal; each one
 * gets it on the sockets of their person:<id> tag, with its own event name beside "changed". It is no change signal and is never saved.
 * It never throws: a lost signal ends by itself on the screen.
 */
export function officeTyping(o: { sockets: Sockets }): TypingPort {
  return {
    async send(people: string[], signal: TypingSignal): Promise<void> {
      if (people.length === 0) return;
      const text = JSON.stringify({ event: TYPING_EVENT, payload: signal });
      for (const id of new Set(people)) for (const socket of o.sockets.list(`person:${id}`)) send(socket, text);
    },
  };
}
