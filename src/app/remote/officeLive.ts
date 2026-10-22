import type { PresencePayload } from '../../api/remote/liveSocket';
import type { TypingSignal } from '../../api/remote/wire';
import type { DeviceState, LivePort, PersonState } from '../live/types';

/**
 * The live port on the office socket (chat presence design, "The office path"). The socket is the one that carries the change signals
 * (src/api/remote/liveSocket.ts). This screen tells the object the state of its device (sendState), and the object tells every office
 * socket the states of all people in one first event and then each change (presence). The object joins the devices of a person into one
 * state, so a state here is already the state of the person, the own person included.
 *
 * - watch keeps nothing: the object sends every person, so the list does not change what arrives.
 * - setResting does nothing: the office path has no Realtime quota to save.
 * - reset is for a socket that dropped: the marks it fed may be old, and a new socket sends a new snapshot.
 * - Typing comes through the same server call as on Supabase. The object sends it on this socket, and a signal of the own person
 *   (a twin device) is dropped.
 */
export function officeLive(
  source: { sendState(state: DeviceState): void },
  me: string,
): LivePort & { presence(payload: PresencePayload): void; typing(signal: TypingSignal): void; reset(): void } {
  let states = new Map<string, PersonState>();
  const stateListeners = new Set<() => void>();
  const typingListeners = new Set<(signal: TypingSignal) => void>();
  let stopped = false;
  /** True after the snapshot of the object and until the socket drops: a person not in it is Offline for sure. */
  let snapshot = false;
  const tell = () => stateListeners.forEach((listener) => listener());

  /** True when the two readings differ. */
  const differ = (a: ReadonlyMap<string, PersonState>, b: ReadonlyMap<string, PersonState>) => {
    for (const id of new Set([...a.keys(), ...b.keys()])) if ((a.get(id) ?? 'offline') !== (b.get(id) ?? 'offline')) return true;
    return false;
  };

  return {
    setMine(state) {
      if (!stopped) source.sendState(state);
    },
    setResting() {},
    watch() {},
    stateOf: (userId) => states.get(userId) ?? 'offline',
    knowsState: () => snapshot && !stopped,
    subscribeStates(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeTyping(listener) {
      typingListeners.add(listener);
      return () => typingListeners.delete(listener);
    },
    presence(payload) {
      if (stopped) return;
      const next = new Map(states);
      if ('states' in payload) {
        snapshot = true;
        next.clear();
        for (const [id, state] of Object.entries(payload.states)) next.set(id, state);
      } else {
        next.set(payload.userId, payload.state);
      }
      const changed = differ(states, next);
      states = next;
      if (changed) tell();
    },
    typing(signal) {
      // A signal of the own person came from a twin device of that person: the line is for the others.
      if (stopped || signal.userId === me) return;
      typingListeners.forEach((listener) => listener(signal));
    },
    reset() {
      snapshot = false;
      if (states.size === 0) return;
      const changed = differ(states, new Map());
      states = new Map();
      if (changed) tell();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      states = new Map();
    },
  };
}
