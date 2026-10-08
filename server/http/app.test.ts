import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { MAX_BODY_BYTES, type WireCall, type WireResponse } from '../../src/api/remote/wire';
import { runInHost } from '../core/after';
import type { Db } from '../core/ports';
import type { OfficeSnapshot, RunRequest, RunResult } from '../core/types';
import { fakeDeps } from '../test/fakes/deps';
import { apiApp, type AppOptions } from './app';
import { CORS_MAX_AGE } from './cors';

const ORIGIN = 'http://127.0.0.1:5173';
const office = { version: 7, lists: {} } as unknown as OfficeSnapshot;

type Harness = { app: ReturnType<typeof apiApp>; deps: ReturnType<typeof fakeDeps>; seen: RunRequest[]; order: string[] };

/** The app with a fake runCall that echoes each call, a token check that knows "Bearer good", and the fake ports. */
function harness(o: Partial<AppOptions> & { minClientBuild?: string } = {}): Harness {
  const deps = fakeDeps({ config: { minClientBuild: o.minClientBuild ?? '0' } });
  const seen: RunRequest[] = [];
  const order: string[] = [];
  const countRequest = deps.meter.countRequest.bind(deps.meter);
  deps.meter.countRequest = async (db) => {
    order.push('count');
    return countRequest(db);
  };
  const runCall = async (_d: unknown, req: RunRequest): Promise<RunResult> => {
    seen.push(req);
    order.push(`start:${req.name}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
    order.push(`end:${req.name}`);
    if (req.name === 'tasks.bad') return { ok: false, error: { code: 'invalid_input', message: 'Some fields are not valid.', details: { fields: ['title'] } } };
    if (req.name === 'tasks.throws') throw new Error('database password is pw-123');
    return { ok: true, output: { name: req.name, input: req.input }, changed: false };
  };
  const app = apiApp(deps, {
    runCall,
    verifyToken: async (header) => {
      if (header !== 'Bearer good') throw new ApiError('unauthenticated', 'Sign in again.');
      return { authUserId: 'auth-1' };
    },
    principalOf: (authUserId) => ({ userId: authUserId === 'auth-1' ? 'usr_001' : 'usr_404' }),
    readOffice: async () => office,
    ...o,
  });
  return { app, deps, seen, order };
}

function batch(h: Harness, calls: unknown[] | string, headers: Record<string, string> = {}) {
  const body = typeof calls === 'string' ? calls : JSON.stringify({ v: 1, calls });
  return h.app.fetch(new Request('http://127.0.0.1/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer good', Origin: ORIGIN, ...headers },
    body,
  }));
}

const call = (i: number, name: string, input: unknown = {}, extra: Partial<WireCall> = {}): WireCall => ({ i, name, input, ...extra });

describe('POST /batch', () => {
  it('runs each entry in the order sent and answers in that order, with the server time in Riyadh time', async () => {
    const h = harness();
    const response = await batch(h, [
      call(0, 'projects.get', { id: 'prj_004' }),
      call(1, 'tasks.create', { title: 'A' }, { story: { ref: 'cor_ui_1' }, key: 'key-1' }),
      call(2, 'tasks.get', { id: 'tsk_001' }, { story: { id: 'sty_1' } }),
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as WireResponse;
    expect(body.v).toBe(1);
    expect(body.serverTime).toMatch(/\+03:00$/);
    expect(body.results.map((r) => r.i)).toEqual([0, 1, 2]);
    expect(body.results[1]).toEqual({ i: 1, ok: true, output: { name: 'tasks.create', input: { title: 'A' } }, changed: false });
    expect(h.order).toEqual(['start:projects.get', 'end:projects.get', 'start:tasks.create', 'end:tasks.create', 'start:tasks.get', 'end:tasks.get', 'count']);
    expect(h.seen.map((r) => [r.name, r.story, r.key])).toEqual([
      ['projects.get', undefined, undefined],
      ['tasks.create', { ref: 'cor_ui_1' }, 'key-1'],
      ['tasks.get', { id: 'sty_1' }, undefined],
    ]);
    // One sign-in for the batch, one scope shared by its entries, with the office read once.
    expect(new Set(h.seen.map((r) => r.batch)).size).toBe(1);
    expect(h.seen[0].principal).toEqual({ userId: 'usr_001' });
    expect(h.seen[0].batch.office).toBe(office);
    expect(h.seen[0].batch.storyRefs).toBeInstanceOf(Map);
  });

  it('keeps the other entries when one is refused or throws, and never shows the thrown message', async () => {
    const h = harness();
    const body = (await (await batch(h, [call(0, 'tasks.bad'), call(1, 'tasks.throws'), call(2, 'tasks.get')])).json()) as WireResponse;
    expect(body.results[0]).toEqual({ i: 0, ok: false, error: { code: 'invalid_input', message: 'Some fields are not valid.', details: { fields: ['title'] } } });
    expect(body.results[1]).toMatchObject({ i: 1, ok: false, error: { code: 'failed' } });
    expect(JSON.stringify(body)).not.toContain('pw-123');
    expect(body.results[2]).toMatchObject({ i: 2, ok: true });
    expect(h.deps.logs.some((l) => l.level === 'error' && l.fields?.name === 'tasks.throws')).toBe(true);
  });

  it('answers 413 for 13 entries, before any call runs', async () => {
    const h = harness();
    const response = await batch(h, Array.from({ length: 13 }, (_, i) => call(i, 'tasks.get', { id: `tsk_${i}` })));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_input', details: { reason: 'too_many_calls' } } });
    expect(h.seen).toEqual([]);
  });

  it('takes 12 entries', async () => {
    const h = harness();
    const response = await batch(h, Array.from({ length: 12 }, (_, i) => call(i, 'tasks.get', { id: `tsk_${i}` })));
    expect(response.status).toBe(200);
    expect(h.seen).toHaveLength(12);
  });

  it('answers 413 for two overview calls, and counts tasks.list only without projectId', async () => {
    const h = harness();
    const two = await batch(h, [call(0, 'projects.list'), call(1, 'dashboard.get')]);
    expect(two.status).toBe(413);
    expect(await two.json()).toMatchObject({ error: { details: { reason: 'too_many_overviews' } } });
    const fine = await batch(h, [call(0, 'projects.list'), call(1, 'tasks.list', { projectId: 'prj_001' })]);
    expect(fine.status).toBe(200);
    expect(h.seen[0].batch.overviewCalls).toBe(1);
  });

  it('answers 413 for a body over 256 KB', async () => {
    const h = harness();
    const big = JSON.stringify({ v: 1, calls: [call(0, 'comments.create', { text: 'x'.repeat(MAX_BODY_BYTES) })] });
    const response = await batch(h, big);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { details: { reason: 'too_large' } } });
    expect(h.seen).toEqual([]);
  });

  it('answers 400 for a body that is not a batch', async () => {
    const h = harness();
    for (const body of ['not json', JSON.stringify({ v: 2, calls: [] }), JSON.stringify({ v: 1, calls: [{ i: 'a', name: 1 }] }), JSON.stringify({ v: 1, calls: [call(0, 'a'), call(0, 'b')] })]) {
      const response = await batch(h, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_input' } });
    }
    expect(h.seen).toEqual([]);
  });

  it('answers 409 client_outdated when X-Madar-Build is older than MIN_CLIENT_BUILD, or missing', async () => {
    const h = harness({ minClientBuild: '2026.10.4' });
    const old = await batch(h, [call(0, 'tasks.get')], { 'X-Madar-Build': '2026.9.30' });
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({ error: { code: 'failed', details: { reason: 'client_outdated' } } });
    expect((await batch(h, [call(0, 'tasks.get')])).status).toBe(409);
    expect((await batch(h, [call(0, 'tasks.get')], { 'X-Madar-Build': '2026.10.4' })).status).toBe(200);
    expect((await batch(h, [call(0, 'tasks.get')], { 'X-Madar-Build': '2026.10.12' })).status).toBe(200);
    expect(h.seen).toHaveLength(2);
  });

  it('answers 401 with WWW-Authenticate without a valid token, and runs nothing', async () => {
    const h = harness();
    const response = await batch(h, [call(0, 'tasks.get')], { Authorization: 'Bearer bad' });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(await response.json()).toMatchObject({ error: { code: 'unauthenticated' } });
    expect(h.seen).toEqual([]);
    expect(h.order).toEqual([]);
  });

  it('answers 403 account_off for a person whose account is off', async () => {
    const h = harness({
      principalOf: () => {
        throw new ApiError('unauthenticated', 'Your account is off.', { reason: 'account_off' });
      },
    });
    const response = await batch(h, [call(0, 'tasks.get')]);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthenticated', details: { reason: 'account_off' } } });
  });

  it('answers 429 with Retry-After when a check before the calls is rate limited', async () => {
    const h = harness({
      verifyToken: async () => {
        throw new ApiError('failed', 'Too many requests.', { reason: 'rate_limited', retryAfterMs: 30_500 });
      },
    });
    const response = await batch(h, [call(0, 'tasks.get')]);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('31');
  });

  it('answers 500 without the message when a check before the calls throws something else', async () => {
    const h = harness({ readOffice: async () => { throw new Error('db host 10.0.0.1 refused'); } });
    const response = await batch(h, [call(0, 'tasks.get')]);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('10.0.0.1');
  });

  it('counts one request after the last entry, outside every call, and a meter failure does not fail the batch', async () => {
    const h = harness();
    let running = 0;
    const runCall: AppOptions['runCall'] = async (_d, req) => {
      running += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return { ok: true, output: req.name, changed: false };
    };
    const counts: number[] = [];
    const deps = fakeDeps();
    deps.meter.countRequest = async () => {
      counts.push(running);
      throw new Error('meter down');
    };
    const app = apiApp(deps, { runCall, verifyToken: async () => ({ authUserId: 'a' }), principalOf: () => ({ userId: 'usr_001' }), readOffice: async () => office });
    const response = await app.fetch(new Request('http://127.0.0.1/batch', { method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify({ v: 1, calls: [call(0, 'a'), call(1, 'b')] }) }));
    expect(response.status).toBe(200);
    expect(counts).toEqual([0]);
    expect(deps.logs.some((l) => l.level === 'warn' && l.message.includes('meter'))).toBe(true);
    void h;
  });
});

describe('POST /batch: the work after the answer (performance audit SRV-4, SRV-M2, SRV-6)', () => {
  const plain = (calls: unknown[]) =>
    new Request('http://127.0.0.1/batch', { method: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ v: 1, calls }) });

  it('hands the meter to after when the host has one: the answer does not wait for it, and the count still runs once', async () => {
    const h = harness();
    let release: () => void = () => undefined;
    let counted = 0;
    h.deps.meter.countRequest = () => {
      counted += 1;
      return new Promise<void>((resolve) => (release = resolve));
    };
    const later: Promise<unknown>[] = [];
    const response = await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => h.app.fetch(plain([call(0, 'tasks.get')])));
    expect(response.status).toBe(200);
    expect((await response.json() as WireResponse).results).toHaveLength(1);
    expect([counted, later.length]).toEqual([1, 1]);
    release();
    await Promise.all(later);
    expect(counted).toBe(1);
  });

  it('keeps the warning of a meter that fails after the answer, and never fails the batch', async () => {
    const h = harness();
    h.deps.meter.countRequest = async () => {
      throw new Error('meter down');
    };
    const later: Promise<unknown>[] = [];
    const response = await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => h.app.fetch(plain([call(0, 'tasks.get')])));
    expect(response.status).toBe(200);
    await Promise.all(later);
    expect(h.deps.logs).toContainEqual({ level: 'warn', message: 'The usage meter did not count the request.', fields: { error: 'meter down' } });
  });

  it('counts before the answer when the host has no after, as before', async () => {
    const h = harness();
    let done = false;
    h.deps.meter.countRequest = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done = true;
    };
    await h.app.fetch(plain([call(0, 'tasks.get')]));
    expect(done).toBe(true);
  });

  /** A Db whose warm is recorded beside the steps of the sign-in. */
  function warmHarness(o: { write?: boolean; token?: string } = {}) {
    const steps: string[] = [];
    let officeDone: () => void = () => undefined;
    const db = { warm: async (mode: string) => void steps.push(`warm:${mode}`) } as unknown as Db;
    const deps = fakeDeps({ db });
    const app = apiApp(deps, {
      runCall: async (_d, req) => ({ ok: true, output: req.name, changed: false }),
      verifyToken: async (header) => {
        steps.push('token');
        if (header !== 'Bearer good') throw new ApiError('unauthenticated', 'Sign in again.');
        return { authUserId: 'auth-1' };
      },
      principalOf: () => ({ userId: 'usr_001' }),
      readOffice: () => {
        steps.push('office:start');
        return new Promise<OfficeSnapshot>((resolve) => {
          officeDone = () => {
            steps.push('office:end');
            resolve(office);
          };
          setTimeout(officeDone, 5);
        });
      },
      hasWrite: (name) => name === 'tasks.update',
    });
    const fetch = (calls: unknown[], token = o.token ?? 'Bearer good') =>
      app.fetch(new Request('http://127.0.0.1/batch', { method: 'POST', headers: { Authorization: token }, body: JSON.stringify({ v: 1, calls }) }));
    return { steps, fetch };
  }

  it('opens the write connection after the token check and beside the sign-in read, for a batch with a write', async () => {
    const h = warmHarness();
    expect((await h.fetch([call(0, 'tasks.get'), call(1, 'tasks.update', { id: 'tsk_001', patch: {} })])).status).toBe(200);
    expect(h.steps).toEqual(['token', 'warm:write', 'office:start', 'office:end']);
  });

  it('opens no write connection for a read batch or a refused token', async () => {
    const reads = warmHarness();
    expect((await reads.fetch([call(0, 'tasks.get'), call(1, 'projects.get')])).status).toBe(200);
    expect(reads.steps).toEqual(['token', 'office:start', 'office:end']);
    const refused = warmHarness({ token: 'Bearer bad' });
    expect((await refused.fetch([call(0, 'tasks.update', { id: 'tsk_001', patch: {} })])).status).toBe(401);
    expect(refused.steps).toEqual(['token']);
  });

  it('runs a run of adjacent files.link entries side by side, keeps the order of the answers, and keeps each error to its entry', async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const deps = fakeDeps();
    const app = apiApp(deps, {
      runCall: async (_d, req) => {
        const id = (req.input as { id: string }).id;
        order.push(`start:${id}`);
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running -= 1;
        order.push(`end:${id}`);
        if (id === 'fil_bad') throw new Error('storage key k-123 is gone');
        if (id === 'fil_404') return { ok: false, error: { code: 'not_found', message: 'File not found.' } };
        return { ok: true, output: { id }, changed: false };
      },
      verifyToken: async () => ({ authUserId: 'a' }),
      principalOf: () => ({ userId: 'usr_001' }),
      readOffice: async () => office,
    });
    const links = ['fil_1', 'fil_bad', 'fil_2', 'fil_404', 'fil_3', 'fil_4'];
    const started = performance.now();
    const response = await app.fetch(plain(links.map((id, i) => call(i, 'files.link', { id }))));
    const took = performance.now() - started;
    const body = (await response.json()) as WireResponse;
    expect(body.results.map((r) => r.i)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(body.results.map((r) => r.ok)).toEqual([true, false, true, false, true, true]);
    expect(body.results[1]).toMatchObject({ ok: false, error: { code: 'failed' } });
    expect(JSON.stringify(body)).not.toContain('k-123');
    expect(body.results[3]).toEqual({ i: 3, ok: false, error: { code: 'not_found', message: 'File not found.' } });
    expect(body.results[5]).toEqual({ i: 5, ok: true, output: { id: 'fil_4' }, changed: false });
    expect(most).toBe(6);
    // Six links of 20 ms each take about one delay, not six.
    expect(took).toBeLessThan(100);
    expect(deps.logs.some((l) => l.level === 'error' && l.fields?.name === 'files.link')).toBe(true);
  });

  it('keeps every other call in order, one at a time, around a run of links', async () => {
    const h = harness();
    await batch(h, [
      call(0, 'projects.get', { id: 'prj_001' }), call(1, 'files.link', { id: 'a' }), call(2, 'files.link', { id: 'b' }), call(3, 'tasks.get', { id: 't' }),
      call(4, 'files.link', { id: 'c' }),
    ]);
    expect(h.order).toEqual([
      'start:projects.get', 'end:projects.get', 'start:files.link', 'start:files.link', 'end:files.link', 'end:files.link',
      'start:tasks.get', 'end:tasks.get', 'start:files.link', 'end:files.link', 'count',
    ]);
  });
});

describe('CORS', () => {
  it('answers OPTIONS without a sign-in, for an allowed origin, with a max age of 7200 s', async () => {
    const h = harness();
    const response = await h.app.fetch(new Request('http://127.0.0.1/batch', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, x-madar-build' },
    }));
    expect(response.status).toBe(204);
    expect(CORS_MAX_AGE).toBe(7200);
    expect(response.headers.get('Access-Control-Max-Age')).toBe('7200');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const allowed = (response.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    for (const name of ['authorization', 'content-type', 'x-madar-build']) expect(allowed).toContain(name);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(h.seen).toEqual([]);
  });

  it('gives the CORS headers only to an allowed origin', async () => {
    const h = harness();
    const allowed = await batch(h, [call(0, 'tasks.get')]);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(allowed.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect(allowed.headers.get('Vary')).toContain('Origin');
    const other = await batch(h, [call(0, 'tasks.get')], { Origin: 'https://evil.example' });
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const preflight = await h.app.fetch(new Request('http://127.0.0.1/batch', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } }));
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('gives the CORS headers to a refusal too, so the screen can read it', async () => {
    const h = harness();
    const response = await batch(h, [call(0, 'tasks.get')], { Authorization: 'Bearer bad' });
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});

describe('the other routes of the api app', () => {
  it('mounts each route of the registry', async () => {
    const h = harness({
      routes: [{ method: 'POST', path: '/auth/forgot', handler: async (request) => Response.json({ got: await request.json() }) }],
    });
    const response = await h.app.fetch(new Request('http://127.0.0.1/auth/forgot', { method: 'POST', headers: { Origin: ORIGIN }, body: JSON.stringify({ email: 'a@b.c' }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ got: { email: 'a@b.c' } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('maps an ApiError of a route to its status', async () => {
    const h = harness({ routes: [{ method: 'POST', path: '/auth/forgot', handler: async () => { throw new ApiError('invalid_input', 'Bad email.', { fields: ['email'] }); } }] });
    const response = await h.app.fetch(new Request('http://127.0.0.1/auth/forgot', { method: 'POST' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_input', details: { fields: ['email'] } } });
  });

  it('answers GET /health from the health check', async () => {
    const h = harness({ health: async () => ({ status: 200, body: { ok: true } }) });
    const response = await h.app.fetch(new Request('http://127.0.0.1/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers 404 as JSON for an unknown path', async () => {
    const h = harness();
    const response = await h.app.fetch(new Request('http://127.0.0.1/nothing', { method: 'POST' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
