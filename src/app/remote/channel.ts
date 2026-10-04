import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { ChangeSignal } from '../../api/remote/wire';
import type { ChangeListener, ChangeSource } from '../signals';

/**
 * The change signals of the real build over Supabase Realtime (plan 5.3, client map 7.3). The server sends each signal with
 * realtime.send(payload, 'changed', topic, true) inside the save transaction (track N1): one on the private channel "office" and
 * one on "person:<userId>" for each person it names. The policies on realtime.messages let a person read only these two topics.
 *
 * - setAuth() runs before each join, so a private channel joins with the person's token. supabase-js sets the token again after
 *   each refresh by itself.
 * - status() is open only while both channels are joined (the "No connection" banner reads it).
 * - A channel that joins again after an error, a time-out or a close may have missed signals: the listeners get an empty list,
 *   which reloads every list. The first join does not, because the screen has just loaded its lists.
 * - Realtime joins a channel again by itself after an error or a time-out. A channel that the server closed (for example at the
 *   end of a token) does not, so this source makes a new one after a short wait, and waits longer after each try.
 */
const TOPICS = (me: string) => ['office', `person:${me}`];
const REJOIN_MS = [1000, 2000, 5000, 10_000, 30_000];

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

  const tell = (signals: ChangeSignal[]) => {
    for (const listener of [...listeners]) listener(signals, 'channel');
  };

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
          if (again) tell([]);
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
        await supabase.removeChannel(entry.channel).catch(() => undefined);
        await supabase.realtime.setAuth().catch(() => undefined);
        if (running && joined.get(topic) === entry) open(topic, entry);
      })();
    }, wait);
  }

  function start(): void {
    running = true;
    void (async () => {
      await supabase.realtime.setAuth().catch(() => undefined);
      if (!running) return;
      for (const topic of TOPICS(me)) open(topic);
    })();
  }

  function stop(): void {
    running = false;
    for (const entry of joined.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      void supabase.removeChannel(entry.channel).catch(() => undefined);
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
      return TOPICS(me).every((topic) => joined.get(topic)?.subscribed) ? 'open' : 'closed';
    },
  };
}
