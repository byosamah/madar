import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TYPING_EVENT, type TypingSignal } from '../../api/remote/wire';
import type { LivePort } from '../live/types';
import type { ChangeSource } from '../signals';
import { supabaseChangeSource } from './channel';
import { attachLive, supabaseLive, switchedLive } from './presence';

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
type Track = 'ok' | 'error' | 'timed out';

/**
 * A Supabase client with the Realtime parts that the presence adapter uses: a private channel for each topic with a presence key, the
 * sync listener, presenceState, track and untrack. As in realtime-js 2.117, channel(topic) gives back the channel of that topic until
 * its leave is answered. trackResult sets what track answers for a topic (the real server answers "error" for the topic of another person).
 */
function stubSupabase(o: { holdLeave?: boolean; trackResult?: (topic: string) => Track } = {}) {
  const steps: string[] = [];
  type Entry = {
    topic: string;
    config: { private?: boolean; presence?: { key?: string } } | undefined;
    sync?: () => void;
    changed?: (message: { payload: unknown }) => void;
    typing?: (message: { payload: unknown }) => void;
    status?: (status: Status, error?: Error) => void;
    state: Record<string, { presence_ref: string; state?: unknown }[]>;
    tracks: unknown[];
    untracks: number;
    removed: boolean;
    channel: Record<string, unknown>;
  };
  const channels: Entry[] = [];
  const waiting: (() => void)[] = [];
  const client = {
    realtime: { setAuth: vi.fn(async () => { steps.push('setAuth'); }) },
    channel: vi.fn((topic: string, options?: { config?: Entry['config'] }) => {
      const same = channels.find((c) => c.topic === topic && !c.removed);
      if (same) return same.channel;
      const entry: Entry = { topic, config: options?.config, state: {}, tracks: [], untracks: 0, removed: false, channel: {} };
      channels.push(entry);
      const channel = {
        on(type: string, filter: { event: string }, callback: (message: { payload: unknown }) => void) {
          steps.push(`on:${topic}:${type}:${filter.event}`);
          if (type === 'presence') entry.sync = callback as () => void;
          else if (filter.event === TYPING_EVENT) entry.typing = callback;
          else entry.changed = callback;
          return channel;
        },
        subscribe(callback: (status: Status, error?: Error) => void) {
          if (entry.status) return channel;
          steps.push(`subscribe:${topic}`);
          entry.status = callback;
          return channel;
        },
        presenceState: () => entry.state,
        track: vi.fn(async (payload: unknown) => {
          steps.push(`track:${topic}:${JSON.stringify(payload)}`);
          entry.tracks.push(payload);
          return o.trackResult ? o.trackResult(topic) : 'ok';
        }),
        untrack: vi.fn(async () => {
          steps.push(`untrack:${topic}`);
          entry.untracks += 1;
          return 'ok';
        }),
        topic,
      };
      entry.channel = channel;
      return channel;
    }),
    removeChannel: vi.fn(async (channel: { topic: string }) => {
      steps.push(`remove:${channel.topic}`);
      if (o.holdLeave) await new Promise<void>((resolve) => waiting.push(resolve));
      const entry = channels.find((c) => c.channel === channel);
      if (entry) entry.removed = true;
      return 'ok';
    }),
  };
  const live = (topic: string) => channels.filter((c) => c.topic === topic && !c.removed).at(-1);
  const release = () => {
    for (const resolve of waiting.splice(0)) resolve();
  };
  /** The server tells the channel its presence: one key for each device, with the state of the device. */
  const present = (topic: string, devices: Record<string, string>) => {
    const entry = live(topic)!;
    entry.state = Object.fromEntries(Object.entries(devices).map(([key, state], i) => [key, [{ presence_ref: `ref${i}`, state }]]));
    entry.sync?.();
  };
  return { client: client as unknown as SupabaseClient, steps, channels, live, release, present };
}

type Stub = ReturnType<typeof stubSupabase>;
const topicsOf = (stub: Stub) => stub.channels.filter((c) => !c.removed).map((c) => c.topic);
const flush = () => vi.advanceTimersByTimeAsync(0);
/** Joins a topic: the server says SUBSCRIBED. */
const joined = (stub: Stub, topic: string) => stub.live(topic)?.status?.('SUBSCRIBED');
const typingSignal = (o: Partial<TypingSignal> = {}): TypingSignal => ({ v: 1, conversationId: 'cnv_1', userId: 'usr_002', typing: true, at: '2026-10-21T08:00:00.000Z', ...o });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('supabaseLive: the status of people on Realtime Presence (chat presence design, L2)', () => {
  it('joins one private status topic for each watched person, and leaves a person who is gone', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001', 'usr_002', 'usr_003']);
    await flush();
    expect(stub.steps[0]).toBe('setAuth');
    expect(topicsOf(stub)).toEqual(['status:usr_001', 'status:usr_002', 'status:usr_003']);
    for (const channel of stub.channels) {
      expect(channel.config?.private).toBe(true);
      expect(channel.config?.presence?.key).toMatch(/\S+/);
    }
    // One key for this tab on every topic.
    expect(new Set(stub.channels.map((c) => c.config?.presence?.key)).size).toBe(1);
    live.watch(['usr_001', 'usr_003', 'usr_004']);
    await flush();
    expect(stub.channels.find((c) => c.topic === 'status:usr_002')?.removed).toBe(true);
    expect(topicsOf(stub)).toEqual(['status:usr_001', 'status:usr_003', 'status:usr_004']);
  });

  it('always joins the own topic, also when the list leaves the own id out, and joins nothing for an empty list', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_002']);
    await flush();
    expect(topicsOf(stub)).toEqual(['status:usr_002', 'status:usr_001']);
    live.watch([]);
    await flush();
    expect(topicsOf(stub)).toEqual([]);
  });

  it('shows the state of a person from the devices on the topic, and offline before the topic joined', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    const listener = vi.fn();
    live.subscribeStates(listener);
    live.watch(['usr_001', 'usr_002']);
    await flush();
    expect(live.stateOf('usr_002')).toBe('offline');
    joined(stub, 'status:usr_002');
    stub.present('status:usr_002', { phone: 'away' });
    expect(live.stateOf('usr_002')).toBe('away');
    expect(listener).toHaveBeenCalledTimes(1);
    stub.present('status:usr_002', { phone: 'away', desk: 'online' });
    expect(live.stateOf('usr_002')).toBe('online');
    expect(live.stateOf('usr_003')).toBe('offline');
  });

  it('joins two devices of one person: online wins, then away, then offline after the last leave', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001', 'usr_002']);
    await flush();
    joined(stub, 'status:usr_002');
    stub.present('status:usr_002', { a: 'away', b: 'online' });
    expect(live.stateOf('usr_002')).toBe('online');
    stub.present('status:usr_002', { a: 'away' });
    expect(live.stateOf('usr_002')).toBe('away');
    stub.present('status:usr_002', {});
    expect(live.stateOf('usr_002')).toBe('offline');
  });

  it('reads two states of one key and ignores a state that is not online or away', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001', 'usr_002']);
    await flush();
    joined(stub, 'status:usr_002');
    const entry = stub.live('status:usr_002')!;
    entry.state = { a: [{ presence_ref: '1', state: 'busy' }, { presence_ref: '2', state: 'away' }], b: [{ presence_ref: '3' }] };
    entry.sync?.();
    expect(live.stateOf('usr_002')).toBe('away');
    entry.state = { a: [{ presence_ref: '1', state: 'busy' }] };
    entry.sync?.();
    expect(live.stateOf('usr_002')).toBe('offline');
  });

  it('does not tell a listener when a sync leaves the state as it was', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001', 'usr_002']);
    await flush();
    joined(stub, 'status:usr_002');
    stub.present('status:usr_002', { a: 'online' });
    const listener = vi.fn();
    live.subscribeStates(listener);
    stub.present('status:usr_002', { a: 'online', b: 'away' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('tracks the state of this device on the own topic once it joined, and on each change', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.setMine('online');
    live.watch(['usr_001', 'usr_002']);
    await flush();
    // Nothing is tracked before the join, and never on the topic of another person.
    expect(stub.steps.some((step) => step.startsWith('track'))).toBe(false);
    joined(stub, 'status:usr_001');
    joined(stub, 'status:usr_002');
    await flush();
    expect(stub.live('status:usr_001')?.tracks).toEqual([{ state: 'online' }]);
    expect(stub.live('status:usr_002')?.tracks).toEqual([]);
    live.setMine('away');
    live.setMine('away');
    expect(stub.live('status:usr_001')?.tracks).toEqual([{ state: 'online' }, { state: 'away' }]);
  });

  it('tracks away at once when the page hides, with no wait', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001']);
    live.setMine('online');
    await flush();
    joined(stub, 'status:usr_001');
    stub.steps.length = 0;
    live.setMine('away');
    // No timer ran: the track went out in the same turn.
    expect(stub.steps).toEqual(['track:status:usr_001:{"state":"away"}']);
  });

  it('shows the own state at once, without the round trip of the server', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001']);
    await flush();
    expect(live.stateOf('usr_001')).toBe('offline');
    live.setMine('online');
    expect(live.stateOf('usr_001')).toBe('online');
    joined(stub, 'status:usr_001');
    stub.present('status:usr_001', { other: 'away' });
    expect(live.stateOf('usr_001')).toBe('online');
    live.setMine('away');
    expect(live.stateOf('usr_001')).toBe('away');
    // The old note of this tab on the topic does not keep the person Online.
    const key = stub.live('status:usr_001')!.config!.presence!.key!;
    stub.present('status:usr_001', { [key]: 'online' });
    expect(live.stateOf('usr_001')).toBe('away');
  });

  it('tracks again after the topic joins again, because the server forgot this device', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.setMine('online');
    live.watch(['usr_001']);
    await flush();
    joined(stub, 'status:usr_001');
    stub.live('status:usr_001')?.status?.('TIMED_OUT');
    joined(stub, 'status:usr_001');
    await flush();
    expect(stub.live('status:usr_001')?.tracks).toEqual([{ state: 'online' }, { state: 'online' }]);
  });

  it('answers error on a track of a topic that is not the own one: logs it once and never retries', async () => {
    const stub = stubSupabase({ trackResult: () => 'error' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001']);
    live.setMine('online');
    await flush();
    joined(stub, 'status:usr_001');
    await flush();
    live.setMine('away');
    live.setMine('online');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(warn).toHaveBeenCalledTimes(1);
    // Three tracks for three changes, none for a retry.
    expect(stub.live('status:usr_001')?.tracks).toHaveLength(3);
    warn.mockRestore();
  });

  it('rests: untracks and leaves every status topic, then joins and tracks again on wake', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.setMine('away');
    live.watch(['usr_001', 'usr_002']);
    await flush();
    joined(stub, 'status:usr_001');
    joined(stub, 'status:usr_002');
    stub.present('status:usr_002', { a: 'online' });
    expect(live.stateOf('usr_002')).toBe('online');
    stub.steps.length = 0;
    live.setResting(true);
    await flush();
    // The own topic untracks first and leaves after it, so the others see one leave.
    expect(stub.steps[0]).toBe('untrack:status:usr_001');
    expect([...stub.steps].sort()).toEqual(['remove:status:usr_001', 'remove:status:usr_002', 'untrack:status:usr_001']);
    expect(stub.steps.indexOf('untrack:status:usr_001')).toBeLessThan(stub.steps.indexOf('remove:status:usr_001'));
    expect(topicsOf(stub)).toEqual([]);
    expect(live.stateOf('usr_002')).toBe('offline');
    // A change of the list while it rests joins nothing.
    live.watch(['usr_001', 'usr_002', 'usr_003']);
    live.setMine('online');
    await flush();
    expect(topicsOf(stub)).toEqual([]);
    stub.steps.length = 0;
    live.setResting(false);
    await flush();
    expect(topicsOf(stub)).toEqual(['status:usr_001', 'status:usr_002', 'status:usr_003']);
    joined(stub, 'status:usr_001');
    await flush();
    expect(stub.live('status:usr_001')?.tracks).toEqual([{ state: 'online' }]);
  });

  it('waits for the leave of a topic before it joins the topic again (a quick wake)', async () => {
    const stub = stubSupabase({ holdLeave: true });
    const live = supabaseLive(stub.client, 'usr_001');
    live.setMine('online');
    live.watch(['usr_001']);
    await flush();
    joined(stub, 'status:usr_001');
    live.setResting(true);
    await flush();
    live.setResting(false);
    await flush();
    // The leave is not answered: the old channel is not taken again.
    expect(stub.steps.filter((step) => step.startsWith('subscribe'))).toEqual(['subscribe:status:usr_001']);
    stub.release();
    await flush();
    expect(stub.steps.filter((step) => step.startsWith('subscribe'))).toEqual(['subscribe:status:usr_001', 'subscribe:status:usr_001']);
    expect(topicsOf(stub)).toEqual(['status:usr_001']);
  });

  it('shows offline for a person whose topic dropped, until the topic joins and syncs again', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001', 'usr_002']);
    await flush();
    joined(stub, 'status:usr_002');
    stub.present('status:usr_002', { a: 'online' });
    stub.live('status:usr_002')?.status?.('CHANNEL_ERROR', new Error('down'));
    expect(live.stateOf('usr_002')).toBe('offline');
    joined(stub, 'status:usr_002');
    stub.present('status:usr_002', { a: 'away' });
    expect(live.stateOf('usr_002')).toBe('away');
  });

  it('joins again after a close, with the REJOIN_MS waits and a fresh token', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.setMine('online');
    live.watch(['usr_001']);
    await flush();
    joined(stub, 'status:usr_001');
    stub.live('status:usr_001')?.status?.('CLOSED');
    stub.steps.length = 0;
    await vi.advanceTimersByTimeAsync(999);
    expect(stub.steps).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stub.steps).toEqual(['remove:status:usr_001', 'setAuth', 'on:status:usr_001:presence:sync', 'subscribe:status:usr_001']);
    // A second close in a row waits longer.
    stub.live('status:usr_001')?.status?.('CLOSED');
    stub.steps.length = 0;
    await vi.advanceTimersByTimeAsync(1999);
    expect(stub.steps).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stub.steps).toContain('subscribe:status:usr_001');
    joined(stub, 'status:usr_001');
    await flush();
    expect(stub.live('status:usr_001')?.tracks).toEqual([{ state: 'online' }]);
  });

  it('does not join again after the stop, and leaves every topic', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001', 'usr_002']);
    await flush();
    const first = stub.live('status:usr_002')!;
    live.stop();
    first.status?.('CLOSED');
    stub.steps.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stub.steps.filter((step) => step.startsWith('subscribe'))).toEqual([]);
    expect(topicsOf(stub)).toEqual([]);
    live.watch(['usr_001']);
    await flush();
    expect(topicsOf(stub)).toEqual([]);
  });

  it('joins a topic once when the list changes before the token is set', async () => {
    const stub = stubSupabase();
    const live = supabaseLive(stub.client, 'usr_001');
    live.watch(['usr_001', 'usr_002']);
    live.watch(['usr_001', 'usr_002', 'usr_003']);
    await flush();
    expect(stub.channels.map((c) => c.topic)).toEqual(['status:usr_001', 'status:usr_002', 'status:usr_003']);
    live.watch(['usr_001']);
    live.watch(['usr_001', 'usr_002']);
    await flush();
    expect(topicsOf(stub)).toEqual(['status:usr_001', 'status:usr_002']);
  });
});

describe('supabaseLive: typing', () => {
  it('passes a typing signal from person:<me>, and drops its own', () => {
    const live = supabaseLive(stubSupabase().client, 'usr_001');
    const heard: TypingSignal[] = [];
    const stop = live.subscribeTyping((signal) => heard.push(signal));
    live.typing(typingSignal());
    live.typing(typingSignal({ userId: 'usr_001' }));
    live.typing(typingSignal({ typing: false }));
    expect(heard).toEqual([typingSignal(), typingSignal({ typing: false })]);
    stop();
    live.typing(typingSignal());
    expect(heard).toHaveLength(2);
  });

  it('keeps hearing typing while it rests, because the typing listener stays on person:<me>', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001', { onTyping: () => undefined });
    const live = supabaseLive(stub.client, 'usr_001');
    const heard: TypingSignal[] = [];
    live.subscribeTyping((s) => heard.push(s));
    source.subscribe(() => undefined);
    live.watch(['usr_001']);
    await flush();
    live.setResting(true);
    await flush();
    expect(topicsOf(stub)).toEqual(['office', 'person:usr_001']);
    live.typing(typingSignal());
    expect(heard).toHaveLength(1);
  });
});

describe('switchedLive: one port for the runtime, one adapter for each signed-in person', () => {
  const inner = () => {
    const log: string[] = [];
    const states = new Set<() => void>();
    const typing = new Set<(s: TypingSignal) => void>();
    const port: LivePort = {
      setMine: (s) => { log.push(`mine:${s}`); },
      setResting: (r) => { log.push(`rest:${r}`); },
      watch: (ids) => { log.push(`watch:${ids.join(',')}`); },
      stateOf: () => 'online',
      subscribeStates: (l) => { states.add(l); return () => states.delete(l); },
      subscribeTyping: (l) => { typing.add(l); return () => typing.delete(l); },
      stop: () => { log.push('stop'); },
    };
    return { port, log, states, typing };
  };

  it('says offline and forgets the calls until an adapter comes, then replays the last of each', () => {
    const live = switchedLive();
    live.watch(['usr_001', 'usr_002']);
    live.setMine('away');
    live.setMine('online');
    live.setResting(false);
    expect(live.stateOf('usr_002')).toBe('offline');
    const a = inner();
    live.use(a.port);
    expect(a.log).toEqual(['watch:usr_001,usr_002', 'mine:online']);
    expect(live.stateOf('usr_002')).toBe('online');
  });

  it('forwards the states and the typing, and stops the old adapter when a new one comes', () => {
    const live = switchedLive();
    const a = inner();
    const b = inner();
    const states = vi.fn();
    const heard: TypingSignal[] = [];
    live.subscribeStates(states);
    live.subscribeTyping((s) => heard.push(s));
    live.use(a.port);
    states.mockClear();
    a.states.forEach((l) => l());
    expect(states).toHaveBeenCalledTimes(1);
    a.typing.forEach((l) => l(typingSignal()));
    expect(heard).toHaveLength(1);
    live.use(b.port);
    expect(a.log).toContain('stop');
    expect(a.states.size).toBe(0);
    a.states.forEach((l) => l());
    a.typing.forEach((l) => l(typingSignal()));
    expect(heard).toHaveLength(1);
    b.typing.forEach((l) => l(typingSignal({ userId: 'usr_003' })));
    expect(heard).toHaveLength(2);
    live.use(null);
    expect(b.log).toContain('stop');
    expect(live.stateOf('usr_002')).toBe('offline');
  });

  it('attachLive joins an adapter to the life of a change source: in at the first listener, out at the last', () => {
    const live = switchedLive();
    const a = inner();
    let subscribed = 0;
    let left = 0;
    const source: ChangeSource = { subscribe: () => { subscribed += 1; return () => { left += 1; }; }, status: () => 'open' };
    const attached = attachLive(live, a.port, source);
    expect(attached.status()).toBe('open');
    live.watch(['usr_002']);
    expect(a.log).toEqual([]);
    const stop = attached.subscribe(() => undefined);
    expect(subscribed).toBe(1);
    expect(a.log).toEqual(['watch:usr_002']);
    stop();
    expect(left).toBe(1);
    expect(a.log).toContain('stop');
    // A later adapter is not stopped by the leave of an older source.
    const b = inner();
    const stopB = attachLive(live, b.port, source).subscribe(() => undefined);
    stop();
    stopB();
    expect(b.log).toContain('stop');
  });
});
