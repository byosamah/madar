import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { ChangeSignal } from '../../api/remote/wire';
import type { ChangeListener, ChangeOrigin, ChangeSource } from '../signals';

/**
 * The change signals of the real build over Supabase Realtime (plan 5.3, client map 7.3). The server sends each signal with
 * realtime.send(payload, 'changed', topic, true) inside the save transaction (track N1): one on the private channel "office" and
 * one on "person:<userId>" for each person it names. The policies on realtime.messages let a person read only these two topics.
 *
 * - setAuth() runs before each join, so a private channel joins with the person's token. supabase-js sets the token again after
 *   each refresh by itself.
 * - status() is open only while both channels are joined (the "No connection" banner reads it).
 * - Realtime keeps no message for a later join. So the listeners get an empty list, which reloads every list, when both channels
 *   have joined for the first time (a change saved while the screen loaded its lists and joined), and each time a channel joins
 *   again after an error, a time-out or a close. The empty list comes with the origin 'join', so the screen merges the joins of
 *   both channels after one drop into one pass (src/app/signals.ts, performance audit FET-4).
 * - realtime-js gives back the channel of a topic until its leave is answered, and a leaving channel never joins. So a start
 *   waits for the leave of every channel of its topics that this client still removes (a quick stop and start, or a sign-in as
 *   another person on the same client).
 * - Realtime joins a channel again by itself after an error or a time-out. A channel that the server closed (for example at the
 *   end of a token) does not, so this source makes a new one after a short wait, and waits longer after each try.
 */
const TOPICS = (me: string) => ['office', `person:${me}`];
const REJOIN_MS = [1000, 2000, 5000, 10_000, 30_000];

/** The leaves that the server has not answered yet, for each client and topic. */
const leaving = new WeakMap<SupabaseClient, Map<string, Promise<void>>>();

type Joined = { channel: RealtimeChannel; subscribed: boolean; joinedBefore: boolean; tries: number; timer?: ReturnType<typeof setTimeout> };

/** True for a change signal of the wire form that came on the channel it names. */
function isSignal(value: unknown, topic: string): value is ChangeSignal {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string');
  return s.v === 1 && typeof s.id === 'string' && s.channel === topic && typeof s.seq === 'number' && Number.isFinite(s.seq)
    && strings(s.projects) && typeof s.office === 'boolean' && strings(s.kinds) && strings(s.people);
}

export function supabaseChangeSource(supabase: SupabaseClient, me: string): ChangeSource {
  const listeners = new Set<ChangeListener>();
  const joined = new Map<string, Joined>();
  let running = false;
  // Each start counts up, so a join that waited for the token never runs after a stop and a new start.
  let generation = 0;
  // True once both channels of this start have joined.
  let opened = false;

  const tell = (signals: ChangeSignal[], origin: ChangeOrigin = 'channel') => {
    for (const listener of [...listeners]) listener(signals, origin);
  };

  /** Leaves a channel, and keeps the wait for its answer, so the next join of the topic on this client waits for it. */
  function remove(topic: string, channel: RealtimeChannel): Promise<void> {
    const waits = leaving.get(supabase) ?? new Map<string, Promise<void>>();
    leaving.set(supabase, waits);
    const done: Promise<void> = supabase.removeChannel(channel).then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      if (waits.get(topic) === done) waits.delete(topic);
    });
    waits.set(topic, done);
    return done;
  }

  const allJoined = () => TOPICS(me).every((topic) => joined.get(topic)?.subscribed);

  /** Makes the channel of one topic. before: the channel it replaces, whose join history it keeps. */
  function open(topic: string, before?: Joined): void {
    const channel = supabase.channel(topic, { config: { private: true } });
    const entry: Joined = { channel, subscribed: false, joinedBefore: before?.joinedBefore ?? false, tries: before?.tries ?? 0 };
    joined.set(topic, entry);
    const current = () => running && joined.get(topic) === entry;
    channel
      .on('broadcast', { event: 'changed' }, (message: { payload?: unknown }) => {
        if (current() && isSignal(message.payload, topic)) tell([message.payload]);
      })
      .subscribe((status: string) => {
        if (!current()) return;
        if (status === 'SUBSCRIBED') {
          const again = entry.joinedBefore;
          entry.subscribed = true;
          entry.joinedBefore = true;
          entry.tries = 0;
          const first = !opened && allJoined();
          if (first) opened = true;
          if (again || first) tell([], 'join');
          return;
        }
        entry.subscribed = false;
        if (status === 'CLOSED') rejoin(topic, entry);
      });
  }

  function rejoin(topic: string, entry: Joined): void {
    if (entry.timer !== undefined) return;
    const wait = REJOIN_MS[Math.min(entry.tries, REJOIN_MS.length - 1)];
    entry.tries += 1;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (!running || joined.get(topic) !== entry) return;
      void (async () => {
        await remove(topic, entry.channel);
        await supabase.realtime.setAuth().catch(() => undefined);
        if (running && joined.get(topic) === entry) open(topic, entry);
      })();
    }, wait);
  }

  function start(): void {
    running = true;
    opened = false;
    const mine = ++generation;
    void (async () => {
      await Promise.all(TOPICS(me).map((topic) => leaving.get(supabase)?.get(topic)));
      if (!running || mine !== generation) return;
      await supabase.realtime.setAuth().catch(() => undefined);
      if (!running || mine !== generation) return;
      for (const topic of TOPICS(me)) open(topic);
    })();
  }

  function stop(): void {
    running = false;
    generation += 1;
    for (const [topic, entry] of joined) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      void remove(topic, entry.channel);
    }
    joined.clear();
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
    status() {
      if (!running) return 'closed';
      return allJoined() ? 'open' : 'closed';
    },
  };
}
