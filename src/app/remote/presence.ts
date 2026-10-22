import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { TypingSignal } from '../../api/remote/wire';
import { combineStates, type DeviceState, type LivePort, type PersonState } from '../live/types';
import type { ChangeSource } from '../signals';
import { REJOIN_MS, leaveChannel, leaveWait } from './channel';

/**
 * The status of people on Supabase Realtime Presence (chat presence design, "How the live parts travel"; proof.md "Chat presence: the
 * Realtime probe"). One private topic for each person, status:<Madar id>. Only that person may track on it (the policy of the migration
 * 20261022000200), and every active person may join it to read. Each device of the person tracks { state } with its own presence key,
 * and the screens join the states of one topic into one (combineStates: Online wins, then Away, no device is Offline).
 *
 * - A track on the topic of another person does not fail the join. It fails at the track call, which answers "error" (the probe). This
 *   adapter reads that answer, logs it once and never tries again by itself.
 * - setResting(true) untracks and leaves every status topic (a resting page costs no message). The typing listener stays: it sits on
 *   person:<me> in the change source (channel.ts), not here. setResting(false) joins the topics and tracks again.
 * - A topic that is not joined, or has not synced since its last join, shows its person Offline: a mark that may be old is not shown.
 * - The own state shows at once from setMine, without the round trip. The own device is left out of the entries of the topic by its key,
 *   so an old note of this tab never holds the person Online.
 * - The topics join after setAuth, wait for the leave of the same topic that this client still removes, and join again after a close
 *   with the waits of the change source (REJOIN_MS). Realtime joins again by itself after an error or a time-out.
 */

const TOPIC = (id: string) => `status:${id}`;

const isDevice = (value: unknown): value is DeviceState => value === 'online' || value === 'away';

type Joined = {
  id: string;
  channel: RealtimeChannel;
  subscribed: boolean;
  /** True from the first presence sync after a join until the topic drops. */
  synced: boolean;
  tries: number;
  timer?: ReturnType<typeof setTimeout>;
  /** The state that this tab tracked on this channel, so the same state is not sent twice. Null: nothing tracked. */
  tracked: DeviceState | null;
};

function tabKey(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

export function supabaseLive(supabase: SupabaseClient, me: string): LivePort & { typing(signal: TypingSignal): void } {
  const key = tabKey();
  const entries = new Map<string, Joined>();
  /** The people whose topic should be joined, with the id of this person always among them. Empty: nothing. */
  let wanted: string[] = [];
  /** Topics whose join waits for a leave or for the token: the ticket tells a stale wait to stop. */
  const joining = new Map<string, object>();
  const states = new Map<string, PersonState>();
  const stateListeners = new Set<() => void>();
  const typingListeners = new Set<(signal: TypingSignal) => void>();
  let mine: DeviceState | null = null;
  let resting = false;
  let stopped = false;
  const warned = new Set<string>();

  const warnOnce = (what: string) => {
    if (warned.has(what)) return;
    warned.add(what);
    console.warn(`Madar status: ${what}. It is not tried again.`);
  };
  const tell = () => stateListeners.forEach((listener) => listener());
  const active = () => !stopped && !resting;
  const wants = (id: string) => active() && wanted.includes(id);

  /** The state of one person from the entries of the topic, plus this device for this person. */
  function recompute(id: string): boolean {
    const entry = entries.get(id);
    const devices: DeviceState[] = [];
    if (entry?.subscribed && entry.synced) {
      const state = entry.channel.presenceState<{ state?: unknown }>();
      for (const [other, metas] of Object.entries(state)) {
        if (other === key) continue;
        for (const meta of metas) if (isDevice(meta.state)) devices.push(meta.state);
      }
    }
    if (id === me && mine !== null && !resting && !stopped) devices.push(mine);
    const next = combineStates(devices);
    if ((states.get(id) ?? 'offline') === next) return false;
    states.set(id, next);
    tell();
    return true;
  }

  function trackNow(entry: Joined): void {
    if (mine === null || !active() || !entry.subscribed || entry.tracked === mine) return;
    const state = mine;
    entry.tracked = state;
    entry.channel.track({ state }).then(
      (answer) => {
        if (answer !== 'ok') warnOnce(`a track on ${TOPIC(entry.id)} answered "${answer}"`);
      },
      () => warnOnce(`a track on ${TOPIC(entry.id)} failed`),
    );
  }

  /** Makes the channel of one topic. before: the channel it replaces, whose number of tries it keeps. */
  function open(id: string, before?: Joined): void {
    const topic = TOPIC(id);
    const channel = supabase.channel(topic, { config: { private: true, presence: { key } } });
    const entry: Joined = { id, channel, subscribed: false, synced: false, tries: before?.tries ?? 0, tracked: null };
    entries.set(id, entry);
    const current = () => !stopped && entries.get(id) === entry;
    channel.on('presence', { event: 'sync' }, () => {
      if (!current()) return;
      entry.synced = true;
      recompute(id);
    });
    channel.subscribe((status: string) => {
      if (!current()) return;
      if (status === 'SUBSCRIBED') {
        entry.subscribed = true;
        entry.tries = 0;
        // The server forgot this device when the topic dropped, so a join always tracks again.
        entry.tracked = null;
        if (id === me) trackNow(entry);
        recompute(id);
        return;
      }
      entry.subscribed = false;
      entry.synced = false;
      entry.tracked = null;
      recompute(id);
      if (status === 'CLOSED') rejoin(id, entry);
    });
  }

  function rejoin(id: string, entry: Joined): void {
    if (entry.timer !== undefined) return;
    const wait = REJOIN_MS[Math.min(entry.tries, REJOIN_MS.length - 1)];
    entry.tries += 1;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (stopped || entries.get(id) !== entry) return;
      void (async () => {
        await leaveChannel(supabase, TOPIC(id), entry.channel);
        await supabase.realtime.setAuth().catch(() => undefined);
        if (!stopped && entries.get(id) === entry) open(id, entry);
      })();
    }, wait);
  }

  /** Leaves the topic of one person. The own topic untracks first, so the others see the leave once. True when a state went. */
  function close(id: string): boolean {
    joining.delete(id);
    const entry = entries.get(id);
    if (!entry) return false;
    entries.delete(id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    const untrack = id === me && entry.subscribed && entry.tracked !== null ? entry.channel.untrack() : undefined;
    void leaveChannel(supabase, TOPIC(id), entry.channel, untrack);
    return states.delete(id);
  }

  /** Joins the topics that are wanted and not there yet, in one pass: the leaves first, then the token, then the joins. */
  function joinMissing(): void {
    const missing = wanted.filter((id) => !entries.has(id) && !joining.has(id));
    if (missing.length === 0 || !active()) return;
    const ticket = {};
    for (const id of missing) joining.set(id, ticket);
    void (async () => {
      await Promise.all(missing.map((id) => leaveWait(supabase, TOPIC(id))));
      await supabase.realtime.setAuth().catch(() => undefined);
      for (const id of missing) {
        if (joining.get(id) !== ticket) continue;
        joining.delete(id);
        if (wants(id) && !entries.has(id)) open(id);
      }
    })();
  }

  function reconcile(): void {
    let dropped = false;
    for (const id of [...entries.keys()]) if (!wants(id)) dropped = close(id) || dropped;
    for (const id of [...joining.keys()]) if (!wants(id)) joining.delete(id);
    joinMissing();
    // The own state shows from setMine alone (a rest takes it away, a wake gives it back), so it needs no topic.
    const own = recompute(me);
    if (dropped && !own) tell();
  }

  return {
    setMine(state) {
      if (stopped || mine === state) return;
      mine = state;
      recompute(me);
      const own = entries.get(me);
      if (own) trackNow(own);
    },
    setResting(next) {
      if (stopped || next === resting) return;
      resting = next;
      reconcile();
    },
    watch(ids) {
      if (stopped) return;
      wanted = ids.length === 0 ? [] : [...new Set([...ids, me])];
      reconcile();
    },
    stateOf: (userId) => states.get(userId) ?? 'offline',
    // A state is known from the first presence sync of its topic until the topic drops. A resting page or a person not watched is not.
    knowsState(userId) {
      if (!active()) return false;
      const entry = entries.get(userId);
      return userId === me || (entry?.subscribed === true && entry.synced);
    },
    subscribeStates(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeTyping(listener) {
      typingListeners.add(listener);
      return () => typingListeners.delete(listener);
    },
    typing(signal) {
      // The server names the members, so a signal of the own person is a twin device of this person: its line is for the others.
      if (stopped || signal.userId === me) return;
      typingListeners.forEach((listener) => listener(signal));
    },
    stop() {
      if (stopped) return;
      for (const id of [...entries.keys()]) close(id);
      stopped = true;
      joining.clear();
      states.clear();
      wanted = [];
    },
  };
}

/**
 * The port of the runtime, which exists before anybody signs in. The adapters need the id of the person, so each one comes with the
 * sign-in (use) and goes with the sign-out (use(null)). Until an adapter is in, every person is Offline and nothing is sent. The last
 * list, the last device state and the rest flag are kept, and given to each new adapter, so the order of the first calls does not matter.
 */
export type SwitchedLive = LivePort & {
  use(inner: LivePort | null): void;
  /** True while this adapter is the one in use. */
  isUsing(inner: LivePort): boolean;
};

export function switchedLive(): SwitchedLive {
  let inner: LivePort | null = null;
  let stopInner: (() => void) | undefined;
  let watched: readonly string[] = [];
  let mine: DeviceState | null = null;
  let resting = false;
  const stateListeners = new Set<() => void>();
  const typingListeners = new Set<(signal: TypingSignal) => void>();
  return {
    use(next) {
      if (next === inner) return;
      stopInner?.();
      stopInner = undefined;
      inner?.stop();
      inner = next;
      if (next) {
        const offStates = next.subscribeStates(() => stateListeners.forEach((listener) => listener()));
        const offTyping = next.subscribeTyping((signal) => typingListeners.forEach((listener) => listener(signal)));
        stopInner = () => {
          offStates();
          offTyping();
        };
        next.watch(watched);
        if (resting) next.setResting(true);
        if (mine !== null) next.setMine(mine);
      }
      stateListeners.forEach((listener) => listener());
    },
    isUsing: (port) => inner === port,
    setMine(state) {
      mine = state;
      inner?.setMine(state);
    },
    setResting(next) {
      resting = next;
      inner?.setResting(next);
    },
    watch(ids) {
      watched = [...ids];
      inner?.watch(ids);
    },
    stateOf: (userId) => inner?.stateOf(userId) ?? 'offline',
    knowsState: (userId) => inner?.knowsState?.(userId) ?? false,
    subscribeStates(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeTyping(listener) {
      typingListeners.add(listener);
      return () => typingListeners.delete(listener);
    },
    afterTypingCall(signal) {
      inner?.afterTypingCall?.(signal);
    },
    stop() {
      this.use(null);
    },
  };
}

/**
 * Ties an adapter to the life of a change source: the adapter comes in with the first listener of the source and goes out with the
 * last one (the sign-out), so each signed-in person has one adapter.
 */
export function attachLive(live: SwitchedLive, inner: LivePort, source: ChangeSource): ChangeSource {
  return {
    subscribe(listener) {
      const stop = source.subscribe(listener);
      live.use(inner);
      return () => {
        stop();
        if (live.isUsing(inner)) live.use(null);
      };
    },
    status: () => source.status(),
  };
}
