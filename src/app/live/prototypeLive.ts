import type { TypingSignal } from '../../api/remote/wire';
import { combineStates, type DeviceState, type LivePort, type PersonState } from './types';

/**
 * The live port of the prototype (chat presence design, "The prototype"). It has no server. The tabs of one browser share status and
 * typing through a BroadcastChannel, so two tabs that preview two people show each other. A sample person with no open tab gets a
 * fixed sample state, and every other person is Offline. Without a BroadcastChannel (an artifact frame) only the own tab and the
 * samples show.
 *
 * Messages (all of them carry only plain data):
 * - { t: 'state', tab, userId, state }: this tab is open for this person with this state. It replaces the earlier note of the tab.
 * - { t: 'leave', tab, userId }: this tab is gone (pagehide or stop).
 * - { t: 'hello', tab }: a tab that opened asks every other tab for its state.
 * - { t: 'typing', signal }: the typing signal of a call that worked.
 */

/** The people of the sample office who show a state when no tab is open for them. */
export const SAMPLE_STATES: Readonly<Record<string, DeviceState>> = { usr_002: 'online', usr_003: 'online', usr_007: 'away' };

type Channel = { postMessage(m: unknown): void; addEventListener(t: 'message', f: (e: { data: unknown }) => void): void; close(): void };

export type PrototypeLiveOptions = {
  /** The person on this tab now. It changes when the prototype previews another person. */
  me: () => string;
  /** The channel to the other tabs. Left out: a BroadcastChannel named "madar-live" (null when the browser has none). */
  channel?: Channel | null;
  /** Tells the port that the person on this tab may have changed (the store changed). The state then moves to the new person. */
  subscribeMe?: (listener: () => void) => () => void;
  /** True when this tab may show the signal (the person on this tab is a member of the chat). Left out: every signal shows. */
  accepts?: (signal: TypingSignal) => boolean;
};

function defaultChannel(): Channel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('madar-live');
  } catch {
    return null;
  }
}

function tabId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isDeviceState = (value: unknown): value is DeviceState => value === 'online' || value === 'away';

function isTypingSignal(value: unknown): value is TypingSignal {
  return isRecord(value) && value.v === 1 && typeof value.conversationId === 'string' && typeof value.userId === 'string'
    && typeof value.typing === 'boolean' && typeof value.at === 'string';
}

export function prototypeLive(o: PrototypeLiveOptions): LivePort {
  const channel = o.channel === undefined ? defaultChannel() : o.channel;
  const tab = tabId();
  /** The other tabs: tab id -> the person on that tab and its state. */
  const tabs = new Map<string, { userId: string; state: DeviceState }>();
  const stateListeners = new Set<() => void>();
  const typingListeners = new Set<(signal: TypingSignal) => void>();
  let mine: DeviceState | null = null;
  let mineUser = o.me();
  let stopped = false;

  const tell = () => stateListeners.forEach((listener) => listener());
  const post = (message: unknown) => {
    try {
      channel?.postMessage(message);
    } catch {
      // A closed channel: the other tabs just do not hear.
    }
  };
  const postState = () => {
    if (mine !== null) post({ t: 'state', tab, userId: mineUser, state: mine });
  };

  channel?.addEventListener('message', (event) => {
    const message = event.data;
    if (stopped || !isRecord(message)) return;
    if (message.t === 'state' && typeof message.tab === 'string' && message.tab !== tab && typeof message.userId === 'string' && isDeviceState(message.state)) {
      tabs.set(message.tab, { userId: message.userId, state: message.state });
      tell();
    } else if (message.t === 'leave' && typeof message.tab === 'string') {
      if (tabs.delete(message.tab)) tell();
    } else if (message.t === 'hello' && typeof message.tab === 'string' && message.tab !== tab) {
      postState();
    } else if (message.t === 'typing' && isTypingSignal(message.signal)) {
      const signal = message.signal;
      // A signal of the person on this tab came from a twin tab of that person: the line is for the others.
      if (signal.userId === o.me() || (o.accepts && !o.accepts(signal))) return;
      typingListeners.forEach((listener) => listener(signal));
    }
  });

  /** The person on this tab may have changed (a preview as another person): the old person loses this tab, the new one gets it. */
  const syncMe = () => {
    const now = o.me();
    if (now === mineUser) return;
    mineUser = now;
    postState();
    tell();
  };
  const stopMe = o.subscribeMe?.(syncMe);

  const leave = () => post({ t: 'leave', tab });
  const back = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) {
      postState();
      post({ t: 'hello', tab });
    }
  };
  const target = typeof window === 'undefined' ? undefined : window;
  target?.addEventListener('pagehide', leave);
  target?.addEventListener('pageshow', back);
  post({ t: 'hello', tab });

  return {
    setMine(state) {
      if (stopped) return;
      syncMe();
      mine = state;
      postState();
      tell();
    },
    // The prototype has no quota to save, so a resting page keeps its state.
    setResting() {},
    watch() {},
    stateOf(userId): PersonState {
      const devices: DeviceState[] = [];
      for (const other of tabs.values()) if (other.userId === userId) devices.push(other.state);
      if (mine !== null && mineUser === userId) devices.push(mine);
      if (devices.length > 0) return combineStates(devices);
      return SAMPLE_STATES[userId] ?? 'offline';
    },
    subscribeStates(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeTyping(listener) {
      typingListeners.add(listener);
      return () => typingListeners.delete(listener);
    },
    afterTypingCall(signal) {
      if (!stopped) post({ t: 'typing', signal });
    },
    stop() {
      if (stopped) return;
      leave();
      stopped = true;
      stopMe?.();
      target?.removeEventListener('pagehide', leave);
      target?.removeEventListener('pageshow', back);
      tabs.clear();
      try {
        channel?.close();
      } catch {
        // The channel is closed already.
      }
    },
  };
}
