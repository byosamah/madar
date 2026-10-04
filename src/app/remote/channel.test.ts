import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChangeSignal } from '../../api/remote/wire';
import { supabaseChangeSource } from './channel';

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

/** A Supabase client with only the Realtime parts that the source uses. Each channel records how it was made and used. */
function stubSupabase() {
  const steps: string[] = [];
  const channels: {
    topic: string;
    config: unknown;
    broadcast?: (message: { payload: unknown }) => void;
    status?: (status: Status, error?: Error) => void;
    removed: boolean;
  }[] = [];
  const client = {
    realtime: {
      setAuth: vi.fn(async () => {
        steps.push('setAuth');
      }),
    },
    channel: vi.fn((topic: string, options?: { config?: unknown }) => {
      const entry: (typeof channels)[number] = { topic, config: options?.config, removed: false };
      channels.push(entry);
      const channel = {
        on(type: string, filter: { event: string }, callback: (message: { payload: unknown }) => void) {
          steps.push(`on:${topic}:${type}:${filter.event}`);
          entry.broadcast = callback;
          return channel;
        },
        subscribe(callback: (status: Status, error?: Error) => void) {
          steps.push(`subscribe:${topic}`);
          entry.status = callback;
          return channel;
        },
        topic,
      };
      return channel;
    }),
    removeChannel: vi.fn(async (channel: { topic: string }) => {
      const entry = channels.find((c) => c.topic === channel.topic && !c.removed);
      if (entry) entry.removed = true;
      steps.push(`remove:${channel.topic}`);
      return 'ok';
    }),
  };
  const live = (topic: string) => channels.filter((c) => c.topic === topic && !c.removed).at(-1)!;
  return { client: client as unknown as SupabaseClient, steps, channels, live };
}

const signal = (o: Partial<ChangeSignal> = {}): ChangeSignal => ({
  v: 1, id: 'sig-1', channel: 'office', seq: 1, projects: ['prj_001'], office: false, kinds: ['tasks'], people: [], storyId: 'cor_1', actorId: 'usr_002', ...o,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the Realtime change source (plan 5.3, client map 7.3)', () => {
  it('sets the token, then joins the office and the person channels as private channels', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    expect(stub.channels).toHaveLength(0);
    const stop = source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.steps).toEqual([
      'setAuth',
      'on:office:broadcast:changed', 'subscribe:office',
      'on:person:usr_001:broadcast:changed', 'subscribe:person:usr_001',
    ]);
    expect(stub.channels.map((c) => c.config)).toEqual([{ private: true }, { private: true }]);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.channels.every((c) => c.removed)).toBe(true);
  });

  it('hands each change signal to the listeners, and drops a message that is not one', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    const seen: unknown[] = [];
    source.subscribe((signals, origin) => seen.push({ signals, origin }));
    await vi.advanceTimersByTimeAsync(0);
    stub.live('office').broadcast?.({ payload: signal() });
    stub.live('person:usr_001').broadcast?.({ payload: signal({ channel: 'person:usr_001', people: ['usr_001'] }) });
    stub.live('office').broadcast?.({ payload: { v: 2, id: 'x' } });
    stub.live('office').broadcast?.({ payload: 'changed' });
    stub.live('office').broadcast?.({ payload: signal({ seq: Number.NaN }) });
    // A signal must come on the channel it names.
    stub.live('office').broadcast?.({ payload: signal({ channel: 'person:usr_009', people: ['usr_009'] }) });
    expect(seen).toEqual([
      { signals: [signal()], origin: 'channel' },
      { signals: [signal({ channel: 'person:usr_001', people: ['usr_001'] })], origin: 'channel' },
    ]);
  });

  it('is open only while both channels are joined', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    expect(source.status()).toBe('closed');
    source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    stub.live('office').status?.('SUBSCRIBED');
    expect(source.status()).toBe('closed');
    stub.live('person:usr_001').status?.('SUBSCRIBED');
    expect(source.status()).toBe('open');
    stub.live('office').status?.('CHANNEL_ERROR', new Error('down'));
    expect(source.status()).toBe('closed');
  });

  it('asks for a reload of every list when a channel joins again, and not at the first join', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    const seen: unknown[][] = [];
    source.subscribe((signals) => seen.push(signals));
    await vi.advanceTimersByTimeAsync(0);
    stub.live('office').status?.('SUBSCRIBED');
    stub.live('person:usr_001').status?.('SUBSCRIBED');
    expect(seen).toEqual([]);
    for (const status of ['TIMED_OUT', 'CHANNEL_ERROR'] as const) {
      stub.live('office').status?.(status);
      stub.live('office').status?.('SUBSCRIBED');
    }
    expect(seen).toEqual([[], []]);
  });

  it('joins again with a fresh token when the server closes a channel', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    const seen: unknown[][] = [];
    source.subscribe((signals) => seen.push(signals));
    await vi.advanceTimersByTimeAsync(0);
    stub.live('person:usr_001').status?.('SUBSCRIBED');
    stub.live('person:usr_001').status?.('CLOSED');
    expect(source.status()).toBe('closed');
    stub.steps.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(stub.steps).toEqual(['remove:person:usr_001', 'setAuth', 'on:person:usr_001:broadcast:changed', 'subscribe:person:usr_001']);
    stub.live('person:usr_001').status?.('SUBSCRIBED');
    expect(seen).toEqual([[]]);
  });

  it('does not join again after the stop, also when the closed answer of the removal comes later', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    const stop = source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const office = stub.live('office');
    stop();
    office.status?.('CLOSED');
    stub.steps.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stub.steps.filter((step) => step.startsWith('subscribe'))).toEqual([]);
    expect(source.status()).toBe('closed');
  });

  it('joins one pair of channels when a listener goes and comes back before the token is set (React strict mode)', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    const stop = source.subscribe(() => undefined);
    stop();
    source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.channels.filter((c) => !c.removed).map((c) => c.topic)).toEqual(['office', 'person:usr_001']);
    expect(stub.channels).toHaveLength(2);
  });

  it('shares one pair of channels between listeners, and leaves them when the last listener goes', async () => {
    const stub = stubSupabase();
    const source = supabaseChangeSource(stub.client, 'usr_001');
    const a: unknown[] = [];
    const b: unknown[] = [];
    const stopA = source.subscribe((signals) => a.push(signals));
    const stopB = source.subscribe((signals) => b.push(signals));
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.channels).toHaveLength(2);
    stub.live('office').broadcast?.({ payload: signal() });
    expect([a.length, b.length]).toEqual([1, 1]);
    stopA();
    expect(stub.channels.some((c) => c.removed)).toBe(false);
    stopB();
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.channels.every((c) => c.removed)).toBe(true);
  });
});
