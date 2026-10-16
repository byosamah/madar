import { describe, expect, it, vi } from 'vitest';
import type { Calls } from '../calls';
import { ApiError } from '../errors';
import { REQUEST_TIMEOUT_MS, canFollow, createRemoteApi, regionUrl, type FollowApi, type RemoteApiOptions } from './remoteApi';
import { isRead } from './keys';
import type { Adapter, ChangeSignal, WireCall, WireEntry, WireRequest } from './wire';

type Sent = { url: string; headers: Record<string, string>; body: WireRequest };
type Answer = { status?: number; body?: unknown; headers?: Record<string, string> } | 'hang' | 'network';

/** A stand-in for fetch: it records each request and answers with what the test's handler returns. */
function stubFetch(handler: (body: WireRequest, n: number) => Answer = (body) => ({ body: okAll(body) })) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as WireRequest;
    sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body });
    const answer = handler(body, sent.length - 1);
    if (answer === 'network') throw new TypeError('Failed to fetch');
    if (answer === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    }
    const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? null);
    return new Response(text, { status: answer.status ?? 200, headers: answer.headers });
  });
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

function okAll(body: WireRequest, extra: (call: WireCall) => Partial<WireEntry> = () => ({})) {
  return { v: 1, serverTime: '2026-10-03T09:00:00.000+03:00', results: body.calls.map((call) => ({ i: call.i, ok: true, output: { name: call.name }, ...extra(call) })) };
}

function remote(fetch: typeof globalThis.fetch, more: Partial<RemoteApiOptions<Calls>> = {}) {
  return createRemoteApi<Calls>({ url: 'https://ref.supabase.co/functions/v1/api', build: '2026.10.03', token: async () => 'tok-1', fetch, ...more });
}

const PROJECT = { id: 'prj_001' };

describe('the request', () => {
  it('posts one batch to the Frankfurt function with the token and the build', async () => {
    const { sent, fetch } = stubFetch();
    await remote(fetch).call('projects.get', PROJECT);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://ref.supabase.co/functions/v1/api/batch?forceFunctionRegion=eu-central-1');
    expect(sent[0].headers).toMatchObject({ Authorization: 'Bearer tok-1', 'Content-Type': 'application/json', 'X-Madar-Build': '2026.10.03' });
    expect(sent[0].body).toEqual({ v: 1, calls: [{ i: 0, name: 'projects.get', input: PROJECT }] });
  });

  it('puts the region parameter on every URL, also one with a query already', () => {
    expect(regionUrl('https://x.supabase.co/functions/v1/api/auth/forgot')).toBe('https://x.supabase.co/functions/v1/api/auth/forgot?forceFunctionRegion=eu-central-1');
    expect(regionUrl('https://x.supabase.co/functions/v1/api/batch?a=1')).toBe('https://x.supabase.co/functions/v1/api/batch?a=1&forceFunctionRegion=eu-central-1');
    expect(regionUrl('https://x.supabase.co/api/batch?forceFunctionRegion=eu-central-1')).toBe('https://x.supabase.co/api/batch?forceFunctionRegion=eu-central-1');
  });

  it('puts the region parameter only on a Supabase function host: the page api of the Worker and other hosts stay as they are (owner, 2026-10-16)', () => {
    expect(regionUrl('/api/batch')).toBe('/api/batch');
    expect(regionUrl('/api/auth/forgot?a=1')).toBe('/api/auth/forgot?a=1');
    expect(regionUrl('https://madar.vado.sa/api/batch')).toBe('https://madar.vado.sa/api/batch');
    expect(regionUrl('http://127.0.0.1:54321/functions/v1/api/batch')).toBe('http://127.0.0.1:54321/functions/v1/api/batch');
    expect(regionUrl('https://x.supabase.co.evil.example/api/batch')).toBe('https://x.supabase.co.evil.example/api/batch');
  });

  it('posts the batch to the page api when the build names /api (the Worker host)', async () => {
    const { sent, fetch } = stubFetch();
    await remote(fetch, { url: '/api' }).call('projects.get', PROJECT);
    expect(sent[0].url).toBe('/api/batch');
  });

  it('sends nothing when the person is signed out: the call fails at once with the reason no_session (2026-10-05)', async () => {
    // A list that loads again after a sign-out must not reach the server: its late 401 opened "Your session ended" over the
    // next sign-in on the test copy. The session listener hears nothing, because the sign-in status already says signed out.
    const { sent, fetch } = stubFetch();
    const onAuthError = vi.fn();
    const error = await remote(fetch, { token: async () => null, onAuthError }).call('projects.get', PROJECT).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'unauthenticated', details: { reason: 'no_session' } });
    expect(sent).toHaveLength(0);
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('sends the calls of one moment in one request and answers each from its own entry', async () => {
    const { sent, fetch } = stubFetch((body) => ({ body: { ...okAll(body), results: okAll(body).results.reverse() } }));
    const api = remote(fetch);
    const [a, b] = await Promise.all([api.call('session.get', {}), api.call('projects.get', PROJECT)]);
    expect(sent).toHaveLength(1);
    expect(a).toEqual({ name: 'session.get' });
    expect(b).toEqual({ name: 'projects.get' });
  });

  it('sends two overview calls in two requests', async () => {
    const { sent, fetch } = stubFetch();
    const api = remote(fetch);
    await Promise.all([api.call('projects.list', {}), api.call('dashboard.get', {}), api.call('tasks.list', { projectId: 'prj_001' })]);
    expect(sent.map((s) => s.body.calls.map((c) => c.name))).toEqual([['projects.list'], ['dashboard.get', 'tasks.list']]);
  });

  it('adds no wait of its own', async () => {
    const { fetch } = stubFetch();
    const started = Date.now();
    await remote(fetch).call('projects.get', PROJECT);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe('idempotency keys (plan 4.10)', () => {
  it('gives each write call a new key, also for the same input object, and gives a read none', async () => {
    const { sent, fetch } = stubFetch();
    const api = remote(fetch);
    const input = { id: 'tsk_013' };
    await api.call('tasks.complete', input);
    await api.call('tasks.complete', input);
    await api.call('tasks.get', input);
    const [first, second, read] = sent.map((s) => s.body.calls[0]);
    expect(first.key).toMatch(/\S/);
    expect(second.key).toMatch(/\S/);
    expect(second.key).not.toBe(first.key);
    expect(read.key).toBeUndefined();
  });

  it('sends the key of the meta, which only a Retry passes', async () => {
    const { sent, fetch } = stubFetch();
    await remote(fetch).call('tasks.complete', { id: 'tsk_013' }, { key: 'key-of-first-try' });
    expect(sent[0].body.calls[0].key).toBe('key-of-first-try');
  });
});

describe('stories (client map 2.4)', () => {
  it('sends a placeholder as a ref, then the server story ID', async () => {
    const { sent, fetch } = stubFetch((body) => ({ body: okAll(body, (call) => (call.story ? { storyId: 'sty_SERVER', changed: true } : {})) }));
    const api = remote(fetch);
    await api.call('projects.update', { id: 'prj_001', patch: {} }, { correlationId: 'cor_ui_edit' });
    await api.call('stages.replace', { projectId: 'prj_001', stages: [] }, { correlationId: 'cor_ui_edit' });
    expect(sent[0].body.calls[0].story).toEqual({ ref: 'cor_ui_edit' });
    expect(sent[1].body.calls[0].story).toEqual({ id: 'sty_SERVER' });
  });

  it('sends two calls with one new placeholder in one request as the same ref', async () => {
    const { sent, fetch } = stubFetch((body) => ({ body: okAll(body, () => ({ storyId: 'sty_SERVER' })) }));
    const api = remote(fetch);
    await Promise.all([
      api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_ui_two' }),
      api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'cor_ui_two' }),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.calls.map((c) => c.story)).toEqual([{ ref: 'cor_ui_two' }, { ref: 'cor_ui_two' }]);
  });

  it('sends a call with no story ID with no story, and run() returns the story the server made', async () => {
    const { sent, fetch } = stubFetch((body) => ({ body: okAll(body, () => ({ storyId: 'sty_NEW', changed: true })) }));
    const result = await remote(fetch).run('tasks.complete', { id: 'tsk_013' });
    expect(sent[0].body.calls[0].story).toBeUndefined();
    expect(result).toEqual({ output: { name: 'tasks.complete' }, storyId: 'sty_NEW', changed: true });
  });

  it('reports no change when the server says so or says nothing', async () => {
    const { fetch } = stubFetch((body) => ({ body: okAll(body, () => ({ storyId: 'sty_NEW', changed: false })) }));
    expect((await remote(fetch).run('tasks.move', { id: 'tsk_013', status: 'todo' })).changed).toBe(false);
    const quiet = stubFetch();
    expect((await remote(quiet.fetch).run('tasks.get', { id: 'tsk_013' })).changed).toBe(false);
  });
});

describe('errors (client map 2.3)', () => {
  it('rebuilds an entry error, and one refused entry does not refuse the others', async () => {
    const { fetch } = stubFetch((body) => ({
      body: { v: 1, serverTime: '', results: [
        { i: 0, ok: false, error: { code: 'invalid_input', message: 'Some fields are not valid.', details: { fields: ['name'] } } },
        { i: 1, ok: true, output: { fine: true } },
      ].slice(0, body.calls.length) },
    }));
    const api = remote(fetch);
    const [bad, good] = await Promise.allSettled([api.call('tasks.create', { projectId: 'prj_001', title: '' } as never), api.call('projects.get', PROJECT)]);
    expect(bad.status).toBe('rejected');
    const error = (bad as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_input', details: { fields: ['name'] } });
    expect(good).toEqual({ status: 'fulfilled', value: { fine: true } });
  });

  it('refreshes the token once and sends again after a 401', async () => {
    const tokens: string[] = [];
    const { sent, fetch } = stubFetch((body, n) => (n === 0 ? { status: 401 } : { body: okAll(body) }));
    const output = await remote(fetch, { token: async () => 'old', refresh: async () => 'new' }).call('tasks.complete', { id: 'tsk_013' });
    for (const s of sent) tokens.push(s.headers.Authorization);
    expect(output).toEqual({ name: 'tasks.complete' });
    expect(tokens).toEqual(['Bearer old', 'Bearer new']);
    expect(sent[1].body.calls[0].key).toBe(sent[0].body.calls[0].key);
  });

  it('gives unauthenticated after the second 401, and tells the session listener once', async () => {
    const onAuthError = vi.fn();
    const { sent, fetch } = stubFetch(() => ({ status: 401 }));
    const api = remote(fetch, { onAuthError });
    const results = await Promise.allSettled([api.call('projects.get', PROJECT), api.call('session.get', {})]);
    expect(sent).toHaveLength(2);
    for (const r of results) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'unauthenticated' });
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError.mock.calls[0][0]).toMatchObject({ code: 'unauthenticated' });
  });

  it.each([
    [403, {}, { code: 'unauthenticated', details: { reason: 'account_off' } }],
    [409, {}, { code: 'failed', details: { reason: 'client_outdated' } }],
    [429, { 'Retry-After': '4' }, { code: 'failed', details: { retryAfterMs: 4000 } }],
    [500, {}, { code: 'failed' }],
  ])('maps HTTP %i', async (status, headers, expected) => {
    const { sent, fetch } = stubFetch(() => ({ status, headers }));
    await expect(remote(fetch).call('tasks.complete', { id: 'tsk_013' })).rejects.toMatchObject(expected);
    expect(sent).toHaveLength(1);
  });

  it('tells the session listener about a turned-off account', async () => {
    const onAuthError = vi.fn();
    const { fetch } = stubFetch(() => ({ status: 403 }));
    await remote(fetch, { onAuthError }).call('projects.get', PROJECT).catch(() => undefined);
    expect(onAuthError.mock.calls[0][0]).toMatchObject({ details: { reason: 'account_off' } });
  });

  it('fails an entry that the answer leaves out, and a whole answer that is not JSON', async () => {
    const missing = stubFetch(() => ({ body: { v: 1, serverTime: '', results: [] } }));
    await expect(remote(missing.fetch).call('projects.get', PROJECT)).rejects.toMatchObject({ code: 'failed' });
    const garbled = stubFetch(() => ({ body: '<html>' }));
    await expect(remote(garbled.fetch).call('projects.get', PROJECT)).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('no answer', () => {
  it(`waits ${REQUEST_TIMEOUT_MS / 1000} s by default`, () => {
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  it('fails a write after the time limit and never sends it again', async () => {
    const { sent, fetch } = stubFetch(() => 'hang');
    await expect(remote(fetch, { timeoutMs: 20 }).call('tasks.complete', { id: 'tsk_013' })).rejects.toMatchObject({ code: 'failed', details: { cause: 'timeout' } });
    expect(sent).toHaveLength(1);
  });

  it('sends a read again once when no answer came back', async () => {
    const { sent, fetch } = stubFetch((body, n) => (n === 0 ? 'network' : { body: okAll(body) }));
    expect(await remote(fetch).call('projects.get', PROJECT)).toEqual({ name: 'projects.get' });
    expect(sent).toHaveLength(2);
  });

  it('gives up on a read after the second time with no answer', async () => {
    const { sent, fetch } = stubFetch(() => 'network');
    await expect(remote(fetch).call('projects.get', PROJECT)).rejects.toMatchObject({ code: 'failed', details: { cause: 'network' } });
    expect(sent).toHaveLength(2);
  });

  it('sends only the read again when a read and a write lose their answer together', async () => {
    const { sent, fetch } = stubFetch((body, n) => (n === 0 ? 'hang' : { body: okAll(body) }));
    const api = remote(fetch, { timeoutMs: 20 });
    const [write, read] = await Promise.allSettled([api.call('tasks.complete', { id: 'tsk_013' }), api.call('projects.get', PROJECT)]);
    expect(write.status).toBe('rejected');
    expect(read).toEqual({ status: 'fulfilled', value: { name: 'projects.get' } });
    expect(sent.map((s) => s.body.calls.map((c) => c.name))).toEqual([['tasks.complete', 'projects.get'], ['projects.get']]);
  });

  it('does not send a read again after an answer with an error status', async () => {
    const { sent, fetch } = stubFetch(() => ({ status: 502 }));
    await expect(remote(fetch).call('projects.get', PROJECT)).rejects.toMatchObject({ code: 'failed' });
    expect(sent).toHaveLength(1);
  });

  it('lets the next call with a placeholder claim it again after a write lost its answer', async () => {
    const { sent, fetch } = stubFetch((body, n) => (n === 0 ? 'network' : { body: okAll(body, () => ({ storyId: 'sty_LATER' })) }));
    const api = remote(fetch);
    await api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_ui_x' }).catch(() => undefined);
    await api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'cor_ui_x' });
    expect(sent[1].body.calls[0].story).toEqual({ ref: 'cor_ui_x' });
  });
});

describe('change signals', () => {
  it('hands the signals of each entry to the listener', async () => {
    const signal: ChangeSignal = { v: 1, id: 'sig_1', channel: 'office', seq: 4, projects: ['prj_001'], office: false, kinds: ['tasks'], people: [], storyId: 'sty_1', actorId: 'usr_002' };
    const onSignals = vi.fn();
    const { fetch } = stubFetch((body) => ({ body: okAll(body, () => ({ storyId: 'sty_1', changed: true, signals: [signal] })) }));
    await remote(fetch, { onSignals }).call('tasks.complete', { id: 'tsk_013' });
    expect(onSignals).toHaveBeenCalledWith([signal]);
  });
});

describe('a listener that throws (review of rb/R1)', () => {
  const signal: ChangeSignal = { v: 1, id: 'sig_1', channel: 'office', seq: 4, projects: ['prj_001'], office: false, kinds: ['tasks'], people: [], storyId: 'sty_1', actorId: 'usr_002' };

  it('still answers every call of the batch when onSignals throws, and the placeholder can go again', async () => {
    const onSignals = vi.fn(() => { throw new Error('listener bug'); });
    const { sent, fetch } = stubFetch((body) => ({ body: okAll(body, () => ({ storyId: 'sty_1', changed: true, signals: [signal] })) }));
    const api = remote(fetch, { onSignals });
    const results = await Promise.all([
      api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_ui_both' }),
      api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'cor_ui_other' }),
    ]);
    expect(results).toEqual([{ name: 'tasks.complete' }, { name: 'tasks.complete' }]);
    expect(onSignals).toHaveBeenCalledTimes(2);
    await api.call('tasks.complete', { id: 'tsk_003' }, { correlationId: 'cor_ui_other' });
    expect(sent).toHaveLength(2);
    expect(sent[1].body.calls[0].story).toEqual({ id: 'sty_1' });
  });

  it('still refuses every call of the batch when onAuthError throws, and the placeholder can go again', async () => {
    const onAuthError = vi.fn(() => { throw new Error('listener bug'); });
    const { sent, fetch } = stubFetch((body, n) => (n < 2 ? { status: 401 } : { body: okAll(body) }));
    const api = remote(fetch, { onAuthError });
    const results = await Promise.allSettled([
      api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_ui_auth' }),
      api.call('projects.get', PROJECT),
    ]);
    for (const r of results) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'unauthenticated' });
    await api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'cor_ui_auth' });
    expect(sent).toHaveLength(3);
    expect(sent[2].body.calls[0].story).toEqual({ ref: 'cor_ui_auth' });
  });

  it('counts a token() that throws at once as no session, and does not leave the call waiting', async () => {
    const { sent, fetch } = stubFetch();
    const token = (() => { throw new Error('token bug'); }) as unknown as RemoteApiOptions<Calls>['token'];
    await expect(remote(fetch, { token }).call('projects.get', PROJECT)).rejects.toMatchObject({ details: { reason: 'no_session' } });
    expect(sent).toHaveLength(0);
  });

  it('fails every call of the batch with failed when send() itself throws, and the placeholder can go again', async () => {
    let broken = true;
    const now = () => {
      if (broken) throw new Error('clock bug');
      return Date.now();
    };
    const { sent, fetch } = stubFetch((body, n) => (n < 2 ? { status: 500 } : { body: okAll(body) }));
    const api = remote(fetch, { now });
    const results = await Promise.allSettled([
      api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_ui_bug' }),
      api.call('projects.get', PROJECT),
    ]);
    for (const r of results) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'failed' });
    broken = false;
    await api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'cor_ui_bug' }).catch(() => undefined);
    expect(sent[1].body.calls[0].story).toEqual({ ref: 'cor_ui_bug' });
  });
});

describe('adapters (the slots that track F fills)', () => {
  it('runs the adapter in place of the call, and its own calls go on the wire unadapted', async () => {
    const { sent, fetch } = stubFetch((body) => ({ body: okAll(body, (call) => (call.name === 'files.upload' ? { output: { file: { id: 'fil_9' } }, storyId: 'sty_UP', changed: true } : { output: { uploadId: 'upl_1' }, storyId: 'sty_UP', changed: true })) }));
    const upload: Adapter = async (input, ctx) => {
      const started = (await ctx.call('files.uploadStart', { projectId: 'prj_001' })) as { uploadId: string };
      return ctx.call('files.upload', { ...(input as object), uploadId: started.uploadId, blob: undefined });
    };
    const api = remote(fetch, { adapters: { 'files.upload': upload } });
    const result = await api.run('files.upload', { projectId: 'prj_001', name: 'A.pdf', blob: new Blob(['x']) });
    expect(sent.map((s) => s.body.calls[0].name)).toEqual(['files.uploadStart', 'files.upload']);
    expect(sent[1].body.calls[0].input).toMatchObject({ uploadId: 'upl_1' });
    expect(result).toEqual({ output: { file: { id: 'fil_9' } }, storyId: 'sty_UP', changed: true });
  });

  it('puts every write of one adapted call in one story, also when the screen passed none', async () => {
    const { sent, fetch } = stubFetch((body) => ({ body: okAll(body, () => ({ storyId: 'sty_ONE', changed: true })) }));
    const both: Adapter = async (_input, ctx) => {
      await ctx.call('files.uploadStart', {});
      return ctx.call('files.upload', {});
    };
    await remote(fetch, { adapters: { 'files.upload': both } }).call('files.upload', {} as never);
    const [first, second] = sent.map((s) => s.body.calls[0]);
    expect(first.story).toEqual({ ref: expect.stringMatching(/^cor_ui_/) });
    expect(second.story).toEqual({ id: 'sty_ONE' });
  });

  it('keeps the screen story, and gives each inner write a key made from the Retry key', async () => {
    const { sent, fetch } = stubFetch((body) => ({ body: okAll(body, () => ({ storyId: 'sty_S' })) }));
    const both: Adapter = async (_input, ctx) => {
      await ctx.call('files.uploadStart', {});
      return ctx.call('files.upload', {});
    };
    const api = remote(fetch, { adapters: { 'files.upload': both } });
    await api.call('files.upload', {} as never, { correlationId: 'cor_ui_files', key: 'k1' });
    expect(sent[0].body.calls[0]).toMatchObject({ story: { ref: 'cor_ui_files' }, key: 'k1.1' });
    expect(sent[1].body.calls[0]).toMatchObject({ story: { id: 'sty_S' }, key: 'k1.2' });
  });

  it('gives the adapter the meta of the screen', async () => {
    const { fetch } = stubFetch();
    const seen: unknown[] = [];
    const spy: Adapter = async (_input, ctx) => { seen.push(ctx.meta); return null; };
    await remote(fetch, { adapters: { 'feedback.send': spy } }).call('feedback.send', {} as never, { correlationId: 'cor_ui_fb' });
    expect(seen).toEqual([{ correlationId: 'cor_ui_fb' }]);
  });
});

describe('reads after an own write (performance audit FET-3)', () => {
  const signal: ChangeSignal = { v: 1, id: 'sig_1', channel: 'office', seq: 4, projects: ['prj_001'], office: false, kinds: ['tasks'], people: [], storyId: 'sty_1', actorId: 'usr_002' };
  const changedWrites = (body: WireRequest) => ({
    body: okAll(body, (call) => (isRead(call.name) ? {} : { storyId: 'sty_1', changed: true, signals: [signal] })),
  });
  /** The api of the real build with its follow step, as the runtime finds it (canFollow). */
  const followable = (fetch: typeof globalThis.fetch, more: Partial<RemoteApiOptions<Calls>> = {}) => {
    const api = remote(fetch, more);
    if (!canFollow(api)) throw new Error('The remote api has no follow step.');
    return api as typeof api & FollowApi;
  };
  const TASK = { id: 'tsk_013' };
  const LIST = { projectId: 'prj_001' };

  it('sends the reads of the follow step right after the write, in its request, and names them to the change listener', async () => {
    const onSignals = vi.fn();
    const { sent, fetch } = stubFetch(changedWrites);
    const api = followable(fetch, { onSignals });
    const tag = {};
    const reads: Promise<unknown>[] = [];
    // A read of the same moment that the screen sends before the write stays before it.
    const before = api.call('projects.get', PROJECT);
    const output = await api.follow(() => api.call('tasks.complete', TASK), () => {
      reads.push(api.call('tasks.get', TASK), api.call('tasks.list', LIST));
    }, tag);
    await Promise.all([before, ...reads]);
    expect(output).toEqual({ name: 'tasks.complete' });
    expect(sent.map((s) => s.body.calls.map((c) => c.name))).toEqual([['projects.get', 'tasks.complete', 'tasks.get', 'tasks.list']]);
    expect(onSignals).toHaveBeenCalledTimes(1);
    expect(onSignals).toHaveBeenCalledWith([signal], { tag, reads: [{ name: 'tasks.get', input: TASK }, { name: 'tasks.list', input: LIST }] });
  });

  it('works the same for run(), which the undoable actions use', async () => {
    const onSignals = vi.fn();
    const { sent, fetch } = stubFetch(changedWrites);
    const api = followable(fetch, { onSignals });
    const tag = {};
    const result = await api.follow(() => api.run('tasks.complete', TASK), () => {
      void api.call('tasks.get', TASK);
    }, tag);
    expect(result).toEqual({ output: { name: 'tasks.complete' }, storyId: 'sty_1', changed: true });
    expect(sent[0].body.calls.map((c) => c.name)).toEqual(['tasks.complete', 'tasks.get']);
    expect(onSignals).toHaveBeenCalledWith([signal], { tag, reads: [{ name: 'tasks.get', input: TASK }] });
  });

  it('names no read that the server refused, and no read that the screen sent outside the follow step', async () => {
    const onSignals = vi.fn();
    const { fetch } = stubFetch((body) => ({
      body: { v: 1, serverTime: '', results: body.calls.map((call) => (call.name === 'tasks.list'
        ? { i: call.i, ok: false, error: { code: 'failed', message: 'The call failed. Try again.' } }
        : { i: call.i, ok: true, output: { name: call.name }, ...(call.name === 'tasks.complete' ? { changed: true, signals: [signal] } : {}) })) },
    }));
    const api = followable(fetch, { onSignals });
    const tag = {};
    const done = api.follow(() => api.call('tasks.complete', TASK), () => {
      void api.call('tasks.get', TASK);
      void api.call('tasks.list', LIST).catch(() => undefined);
    }, tag);
    const outside = api.call('projects.get', PROJECT);
    await Promise.all([done, outside]);
    expect(onSignals).toHaveBeenCalledWith([signal], { tag, reads: [{ name: 'tasks.get', input: TASK }] });
  });

  it('still answers the reads of a refused write, with no signals and no names', async () => {
    const onSignals = vi.fn();
    const { sent, fetch } = stubFetch((body) => ({
      body: { v: 1, serverTime: '', results: body.calls.map((call) => (call.name === 'tasks.complete'
        ? { i: call.i, ok: false, error: { code: 'invalid_input', message: 'Some fields are not valid.', details: { reason: 'needs_lead' } } }
        : { i: call.i, ok: true, output: { name: call.name } })) },
    }));
    const api = followable(fetch, { onSignals });
    let read: Promise<unknown> = Promise.resolve();
    const write = api.follow(() => api.call('tasks.complete', TASK), () => {
      read = api.call('tasks.get', TASK);
    }, {});
    await expect(write).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await read).toEqual({ name: 'tasks.get' });
    expect(sent).toHaveLength(1);
    expect(onSignals).not.toHaveBeenCalled();
  });

  it('runs no follow step when the call put no single write on the wire at once (an adapter writes later)', async () => {
    const { sent, fetch } = stubFetch();
    const late: Adapter = async (input, ctx) => {
      await Promise.resolve();
      return ctx.call('files.upload', input);
    };
    const api = followable(fetch, { adapters: { 'files.upload': late } });
    const step = vi.fn();
    await api.follow(() => api.call('files.upload', {} as never), step, {});
    await api.follow(() => Promise.resolve('nothing'), step, {});
    expect(step).not.toHaveBeenCalled();
    expect(sent.map((s) => s.body.calls.map((c) => c.name))).toEqual([['files.upload']]);
  });

  it('names no read that did not fit in the request of the write (a second overview call)', async () => {
    const onSignals = vi.fn();
    const { sent, fetch } = stubFetch(changedWrites);
    const api = followable(fetch, { onSignals });
    const tag = {};
    const reads: Promise<unknown>[] = [];
    const first = api.call('projects.list', {});
    await api.follow(() => api.call('tasks.complete', TASK), () => {
      reads.push(api.call('dashboard.get', {}), api.call('tasks.get', TASK));
    }, tag);
    await Promise.all([first, ...reads]);
    expect(sent.map((s) => s.body.calls.map((c) => c.name))).toEqual([['projects.list', 'tasks.complete', 'tasks.get'], ['dashboard.get']]);
    expect(onSignals).toHaveBeenCalledWith([signal], { tag, reads: [{ name: 'tasks.get', input: TASK }] });
  });

  it('names nothing when the request lost its answer: the read goes again alone, after the write failed', async () => {
    const onSignals = vi.fn();
    const { sent, fetch } = stubFetch((body, n) => (n === 0 ? 'network' : changedWrites(body)));
    const api = followable(fetch, { onSignals });
    let read: Promise<unknown> = Promise.resolve();
    const write = api.follow(() => api.call('tasks.complete', TASK), () => {
      read = api.call('tasks.get', TASK);
    }, {});
    await expect(write).rejects.toMatchObject({ code: 'failed' });
    expect(await read).toEqual({ name: 'tasks.get' });
    expect(sent.map((s) => s.body.calls.map((c) => c.name))).toEqual([['tasks.complete', 'tasks.get'], ['tasks.get']]);
    expect(onSignals).not.toHaveBeenCalled();
  });

  it('marks the api of the real build as one that can follow a write', () => {
    expect(canFollow(remote(stubFetch().fetch))).toBe(true);
    expect(canFollow({ call: () => undefined, run: () => undefined })).toBe(false);
  });
});
