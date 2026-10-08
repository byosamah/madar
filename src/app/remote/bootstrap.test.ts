import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../../api/errors';
import { canFollow, type FollowApi } from '../../api/remote/remoteApi';
import type { ChangeSignal } from '../../api/remote/wire';
import type { AuthPort, AuthStatus } from '../auth';
import type { ChangeListener, ChangeSource } from '../signals';
import { bootstrapRemote, firstLanguage, personChangeSource, remoteConfig } from './bootstrap';

// The file adapters of track F (src/app/files.ts), replaced by markers so the test sees which adapters the bootstrap hands RemoteApi.
const fileAdapters = vi.hoisted(() => ({
  'files.upload': async (input: unknown) => ({ adapter: 'files.upload', input }),
  'feedback.send': async (input: unknown) => ({ adapter: 'feedback.send', input }),
}));
vi.mock('../files', () => ({ remoteFileAdapters: () => fileAdapters }));

type Listener = (status: AuthStatus, change?: 'left' | 'person') => void;

/** A sign-in port the test drives: it says when the session starts, ends or changes person. */
function stubAuth(signedIn = true) {
  let status: AuthStatus = signedIn ? 'signed_in' : 'signed_out';
  const listeners = new Set<Listener>();
  const auth = {
    status: () => status,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    accessToken: vi.fn(async () => (status === 'signed_in' ? 'token-1' : null)),
  } as unknown as AuthPort;
  const set = (next: AuthStatus, change?: 'left' | 'person') => {
    status = next;
    for (const listener of [...listeners]) listener(next, change);
  };
  return { auth, set, listeners };
}

/** A change source for one person that records its life. */
function recordingOpen() {
  const log: string[] = [];
  const emit = new Map<string, ChangeListener>();
  const open = (me: string): ChangeSource => ({
    subscribe(listener) {
      log.push(`join:${me}`);
      emit.set(me, listener);
      return () => {
        log.push(`leave:${me}`);
        emit.delete(me);
      };
    },
    status: () => 'open',
  });
  return { log, emit, open };
}

const signal = (o: Partial<ChangeSignal> = {}): ChangeSignal => ({
  v: 1, id: 'sig-1', channel: 'office', seq: 1, projects: [], office: true, kinds: ['clients'], people: [], storyId: 'cor_1', actorId: 'usr_001', ...o,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the settings of the real screens', () => {
  it('reads the public values, and names each missing one', () => {
    expect(remoteConfig({ VITE_SUPABASE_URL: 'https://ref.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toEqual({
      supabaseUrl: 'https://ref.supabase.co', publishableKey: 'sb_publishable_x', apiUrl: 'https://ref.supabase.co/functions/v1/api', build: '0',
    });
    expect(remoteConfig({
      VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k', VITE_API_URL: 'https://api.test/api', VITE_MADAR_BUILD: '2026.10.4',
    })).toMatchObject({ apiUrl: 'https://api.test/api', build: '2026.10.4' });
    expect(() => remoteConfig({})).toThrow(/VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it('takes the batch address of the same-host forwarder only when VITE_BATCH_URL is set (performance audit FET-10)', () => {
    const base = { VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' };
    expect(remoteConfig(base).batchUrl).toBeUndefined();
    expect(remoteConfig({ ...base, VITE_BATCH_URL: ' ' }).batchUrl).toBeUndefined();
    expect(remoteConfig({ ...base, VITE_BATCH_URL: '/api/batch' }).batchUrl).toBe('/api/batch');
  });

  it('opens in the saved language, else in the language of the browser (client map 7.4)', () => {
    expect(firstLanguage('ar', ['en-US'])).toBe('ar');
    expect(firstLanguage('en', ['ar-SA'])).toBe('en');
    expect(firstLanguage(null, ['fr-FR', 'ar-SA', 'en'])).toBe('ar');
    expect(firstLanguage('xx', ['en-GB'])).toBe('en');
    expect(firstLanguage(null, [])).toBe('en');
  });
});

describe('the change source of the signed-in person', () => {
  it('joins the channels of the person once the session names them, and leaves them at the sign-out', async () => {
    const stub = stubAuth();
    const rec = recordingOpen();
    const source = personChangeSource({ auth: stub.auth, person: async () => 'usr_001', open: rec.open });
    expect(source.status()).toBe('closed');
    const stop = source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.log).toEqual(['join:usr_001']);
    expect(source.status()).toBe('open');
    stub.set('signed_out', 'left');
    expect(rec.log).toEqual(['join:usr_001', 'leave:usr_001']);
    expect(source.status()).toBe('closed');
    stop();
    expect(stub.listeners.size).toBe(0);
  });

  it('joins nothing while signed out, and joins the next person after a sign-in', async () => {
    const stub = stubAuth(false);
    const rec = recordingOpen();
    let person = 'usr_001';
    const source = personChangeSource({ auth: stub.auth, person: async () => person, open: rec.open });
    source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.log).toEqual([]);
    stub.set('signed_in');
    await vi.advanceTimersByTimeAsync(0);
    person = 'usr_003';
    stub.set('signed_in', 'person');
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.log).toEqual(['join:usr_001', 'leave:usr_001', 'join:usr_003']);
  });

  it('hands over the signals of the channels and of own answers, and the reload of all that a new join asks for', async () => {
    const stub = stubAuth();
    const rec = recordingOpen();
    const source = personChangeSource({ auth: stub.auth, person: async () => 'usr_001', open: rec.open });
    const seen: unknown[] = [];
    source.subscribe((signals, origin) => seen.push([signals.length, origin]));
    await vi.advanceTimersByTimeAsync(0);
    rec.emit.get('usr_001')?.([signal()], 'channel');
    source.own([signal({ id: 'sig-2' })]);
    expect(seen).toEqual([[1, 'channel'], [1, 'own']]);
    // The session ended and the same person signed in again: signals may have been lost meanwhile. The new channels ask for the
    // reload of all once they have joined (channel.ts); a reload before the join would miss a change saved during the join.
    stub.set('signed_out');
    stub.set('signed_in');
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(2);
    rec.emit.get('usr_001')?.([], 'channel');
    expect(seen.at(-1)).toEqual([0, 'channel']);
  });

  it('asks the session once when a sign-in comes while the first question still waits', async () => {
    const stub = stubAuth();
    const rec = recordingOpen();
    let asked = 0;
    let answer: (id: string) => void = () => undefined;
    const source = personChangeSource({
      auth: stub.auth, open: rec.open,
      person: () => {
        asked += 1;
        return new Promise((resolve) => { answer = resolve; });
      },
    });
    source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    stub.set('signed_in');
    answer('usr_001');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(1);
    expect(rec.log).toEqual(['join:usr_001']);
  });

  it('asks the session again after a failure, while the person stays signed in', async () => {
    const stub = stubAuth();
    const rec = recordingOpen();
    let fail = true;
    const source = personChangeSource({
      auth: stub.auth, retryMs: 5000, open: rec.open,
      person: async () => {
        if (fail) throw new ApiError('failed', 'offline');
        return 'usr_001';
      },
    });
    source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.log).toEqual([]);
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.log).toEqual(['join:usr_001']);
  });

  it('drops a session answer that comes after a sign-out', async () => {
    const stub = stubAuth();
    const rec = recordingOpen();
    let answer: (id: string) => void = () => undefined;
    const source = personChangeSource({ auth: stub.auth, open: rec.open, person: () => new Promise((resolve) => { answer = resolve; }) });
    source.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    stub.set('signed_out', 'left');
    answer('usr_001');
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.log).toEqual([]);
  });
});

describe('the remote runtime (plan R2)', () => {
  // RemoteApi sends each batch on a timer of 0 ms, so these tests run on the real clock.
  beforeEach(() => {
    vi.useRealTimers();
  });
  const config = { supabaseUrl: 'https://ref.supabase.co', publishableKey: 'sb_publishable_x', apiUrl: 'https://ref.supabase.co/functions/v1/api', build: '2026.10.4' };
  const supabase = {
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: async () => 'ok',
    auth: { refreshSession: vi.fn(async () => ({ data: {}, error: null })) },
  } as unknown as SupabaseClient;

  it('sends the calls in one batch to Frankfurt with the token, the build and the public key', async () => {
    const requests: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { calls: { i: number; name: string }[] };
      requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
      const results = body.calls.map((call) => ({
        i: call.i, ok: true, output: call.name === 'session.get' ? { user: { id: 'usr_001' } } : [], storyId: 'cor_srv_1', changed: false,
      }));
      return new Response(JSON.stringify({ v: 1, serverTime: '2026-10-04T09:00:00.000+03:00', results }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const runtime = await bootstrapRemote({ config, supabase, auth: stubAuth().auth, fetch });
    expect(runtime.mode).toBe('remote');
    expect(runtime.store).toBeUndefined();
    const [clients, teams] = await Promise.all([runtime.api.call('clients.list', {}), runtime.api.call('teams.list', {})]);
    expect([clients, teams]).toEqual([[], []]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://ref.supabase.co/functions/v1/api/batch?forceFunctionRegion=eu-central-1');
    expect(requests[0].headers).toMatchObject({ Authorization: 'Bearer token-1', 'X-Madar-Build': '2026.10.4', apikey: 'sb_publishable_x' });
  });

  it('sends the batch to the same-host forwarder when the config names it', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(url));
      const body = JSON.parse(String(init?.body)) as { calls: { i: number }[] };
      const results = body.calls.map((call) => ({ i: call.i, ok: true, output: [], storyId: 'cor_srv_1', changed: false }));
      return new Response(JSON.stringify({ v: 1, serverTime: '2026-10-04T09:00:00.000+03:00', results }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const runtime = await bootstrapRemote({ config: { ...config, batchUrl: '/api/batch' }, supabase, auth: stubAuth().auth, fetch });
    await runtime.api.call('clients.list', {});
    expect(urls).toEqual(['/api/batch?forceFunctionRegion=eu-central-1']);
  });

  it('makes the Supabase sign-in port, whose reset request also runs in Frankfurt', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof globalThis.fetch;
    const withAuth = {
      ...supabase,
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    } as unknown as SupabaseClient;
    const runtime = await bootstrapRemote({ config, supabase: withAuth, fetch });
    expect(runtime.auth.status()).toBe('signed_out');
    await runtime.auth.requestReset('hala@office.test');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://ref.supabase.co/functions/v1/api/auth/forgot?forceFunctionRegion=eu-central-1');
  });

  it('turns a file upload and a feedback with pictures into the file adapters of src/app/files.ts, never into JSON', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const runtime = await bootstrapRemote({ config, supabase, auth: stubAuth().auth, fetch });
    const blob = new Blob(['x'], { type: 'text/plain' });
    await expect(runtime.api.call('files.upload', { projectId: 'prj_001', name: 'a.txt', blob } as never)).resolves.toMatchObject({ adapter: 'files.upload' });
    await expect(runtime.api.call('feedback.send', { kind: 'bug', title: 'x', body: 'y', screenshots: [blob] } as never)).resolves.toMatchObject({ adapter: 'feedback.send' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hands the signals of an own write to the change listeners at once', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { calls: { i: number; name: string }[] };
      const results = body.calls.map((call) => (call.name === 'session.get'
        ? { i: call.i, ok: true, output: { user: { id: 'usr_001' } } }
        : { i: call.i, ok: true, output: {}, storyId: 'cor_srv_1', changed: true, signals: [signal()] }));
      return new Response(JSON.stringify({ v: 1, serverTime: '', results }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const runtime = await bootstrapRemote({ config, supabase, auth: stubAuth().auth, fetch });
    const seen: unknown[] = [];
    runtime.changes.subscribe((signals, origin) => seen.push([signals.map((s) => s.id), origin]));
    await runtime.api.call('clients.create', { name: 'Gulf' } as never);
    expect(seen).toContainEqual([['sig-1'], 'own']);
  });

  it('hands the change listeners the reads that ran after an own write in its request (performance audit FET-3)', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { calls: { i: number; name: string }[] };
      const results = body.calls.map((call) => (call.name === 'clients.create'
        ? { i: call.i, ok: true, output: {}, storyId: 'cor_srv_1', changed: true, signals: [signal()] }
        : { i: call.i, ok: true, output: call.name === 'session.get' ? { user: { id: 'usr_001' } } : [] }));
      return new Response(JSON.stringify({ v: 1, serverTime: '', results }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const runtime = await bootstrapRemote({ config, supabase, auth: stubAuth().auth, fetch });
    const seen: unknown[] = [];
    runtime.changes.subscribe((signals, origin, fresh) => seen.push([signals.map((s) => s.id), origin, fresh]));
    const api = runtime.api as unknown as FollowApi;
    expect(canFollow(api)).toBe(true);
    const tag = {};
    await api.follow(() => runtime.api.call('clients.create', { name: 'Gulf' } as never), () => {
      void runtime.api.call('clients.list', {});
    }, tag);
    expect(seen).toContainEqual([['sig-1'], 'own', { tag, reads: [{ name: 'clients.list', input: {} }] }]);
  });
});
