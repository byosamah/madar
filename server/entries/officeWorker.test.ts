import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { OfficeBatchInput } from '../office/batch';
import type { NetApi } from '../office/net';
import { recordingNet } from '../office/test/fakes';
import { fakeDeps } from '../test/fakes/deps';
import { LIVE_PATH, officeRoutes, type OfficeStub } from './officeWorker';

const TICKET = 'a'.repeat(64);
const BODY = JSON.stringify({ v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] });
const ANSWER = '{"v":1,"serverTime":"2026-10-04T09:00:00.000+03:00","results":[]}';

function setup(o: { batch?: OfficeStub['batch'] } = {}) {
  const deps = fakeDeps();
  const seen = { batch: [] as { input: OfficeBatchInput; net: NetApi }[], effects: [] as { ids: string[]; worker: number; net: NetApi }[], fetches: [] as Request[], health: 0, cron: [] as unknown[], signins: [] as { signin: string; input: unknown }[] };
  const stub: OfficeStub = {
    batch: o.batch ?? (async (input, net) => (seen.batch.push({ input, net }), { ok: true, body: ANSWER, later: [] })),
    runEffects: async (input, net) => (seen.effects.push({ ...input, net }), { done: input.ids.length, failed: 0 }),
    health: async () => ((seen.health += 1), { schema: 3, lastJob: null }),
    cron: async (input, net) => (seen.cron.push({ ...input, net }), { ok: true, at: input.at, steps: [], closed: 0, day: null }),
    signin: async (body) => (seen.signins.push(body), { ok: true, value: { echo: body.signin } }),
    fetch: async (request) => (seen.fetches.push(request), { status: 101, webSocket: {} } as unknown as Response),
  };
  const net = recordingNet();
  const routes = officeRoutes({
    deps,
    verifyToken: async (header) => {
      if (header !== 'Bearer good') throw new ApiError('unauthenticated', 'Sign in again.');
      return { authUserId: 'auth-1' };
    },
    stub: () => stub,
    net: () => net,
    jobsSecret: () => 'jobs-secret',
  });
  const post = (headers: Record<string, string>, body = BODY, ctx?: { waitUntil(work: Promise<unknown>): void }) =>
    routes.fetch(new Request('https://madar-server.internal/api/batch', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), {}, ctx);
  const get = (path: string, headers: Record<string, string> = {}) => routes.fetch(new Request(`https://madar-server.internal${path}`, { headers }), {});
  return { deps, seen, routes, post, get, net };
}

describe('the Worker routes of the office path (server/entries/officeWorker.ts)', () => {
  it('refuses an old build, a body that is no batch and a bad token, before any office object call', async () => {
    const { deps, seen, post } = setup();
    deps.config.minClientBuild = '2026.10.17';
    expect((await post({ 'X-Madar-Build': '2026.10.1', authorization: 'Bearer good' })).status).toBe(409);
    deps.config.minClientBuild = '0';
    expect((await post({ authorization: 'Bearer good' }, '{"v":1}')).status).toBe(400);
    expect((await post({ authorization: 'Bearer bad' })).status).toBe(401);
    expect(seen.batch).toEqual([]);
  });

  it('gives the whole batch to the office object in one call, with what the token check gave, and answers its body as it is', async () => {
    const { seen, post, net } = setup();
    const answer = await post({ authorization: 'Bearer good' });
    expect([answer.status, answer.headers.get('content-type'), await answer.text()]).toEqual([200, 'application/json', ANSWER]);
    expect(seen.batch).toHaveLength(1);
    expect(seen.batch[0].input).toEqual({ who: { kind: 'browser', authUserId: 'auth-1' }, calls: [{ i: 0, name: 'session.get', input: {} }], overviewCalls: 0, worker: 1 });
    expect(seen.batch[0].net).toBe(net);
  });

  it('answers a refusal of the office object with its status', async () => {
    const { post } = setup({ batch: async () => ({ ok: false, error: { code: 'unauthenticated', message: 'Off.', details: { reason: 'account_off' } } }) });
    expect((await post({ authorization: 'Bearer good' })).status).toBe(403);
  });

  it('runs the mails and pushes after the answer, with the same network port', async () => {
    const { seen, post, net } = setup({ batch: async () => ({ ok: true, body: ANSWER, later: ['7', '8'] }) });
    const waits: Promise<unknown>[] = [];
    const answer = await post({ authorization: 'Bearer good' }, BODY, { waitUntil: (work) => waits.push(work) });
    expect(answer.status).toBe(200);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(seen.effects).toEqual([{ ids: ['7', '8'], worker: 0, net }]);
  });

  it('maps an overloaded or reset office object to busy, and any other error to a hidden failure', async () => {
    const overloaded = setup({ batch: async () => { throw Object.assign(new Error('Durable Object is overloaded.'), { overloaded: true }); } });
    const busy = (await (await overloaded.post({ authorization: 'Bearer good' })).json()) as { error: { details?: { reason?: string } } };
    expect(busy.error.details?.reason).toBe('busy');
    const reset = setup({ batch: async () => { throw Object.assign(new Error('Durable Object reset because its code was updated.'), { retryable: true }); } });
    expect(((await (await reset.post({ authorization: 'Bearer good' })).json()) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('busy');
    const broken = setup({ batch: async () => { throw new Error('SQLITE_FULL'); } });
    const hidden = await broken.post({ authorization: 'Bearer good' });
    expect([hidden.status, await hidden.json()]).toEqual([500, { v: 1, error: { code: 'failed', message: 'Something went wrong. Try again.' } }]);
    expect(broken.deps.logs.some((line) => line.level === 'error' && line.message === 'The office object failed.')).toBe(true);
  });

  it('refuses a socket with no upgrade and a ticket of the wrong shape, with no office object call', async () => {
    const { seen, get } = setup();
    expect((await get(`${LIVE_PATH}?ticket=${TICKET}`)).status).toBe(426);
    expect((await get(`${LIVE_PATH}?ticket=abc`, { upgrade: 'websocket' })).status).toBe(401);
    expect(seen.fetches).toEqual([]);
  });

  it('hands a socket upgrade with a ticket of the right shape to the office object, and gives its answer back as it is', async () => {
    const { seen, get } = setup();
    const answer = await get(`${LIVE_PATH}?ticket=${TICKET}`, { upgrade: 'websocket' });
    expect(answer.status).toBe(101);
    expect(seen.fetches).toHaveLength(1);
  });

  it('counts every request it saw in the next office object call', async () => {
    const { seen, get, post } = setup();
    await get('/api/nothing');
    await get(`${LIVE_PATH}?ticket=abc`, { upgrade: 'websocket' });
    await post({ authorization: 'Bearer good' });
    expect(seen.batch[0].input.worker).toBe(3);
  });

  it('answers health with no office object call without the jobs secret, and names the schema and the last job with it', async () => {
    const { seen, get, deps } = setup();
    const open = await get('/api/health');
    expect(await open.json()).toEqual({ ok: true, region: deps.config.region, host: 'office', calls: expect.any(Number) });
    expect(seen.health).toBe(0);
    expect((await get('/api/health', { 'x-madar-jobs-secret': 'wrong' })).status).toBe(401);
    const checked = await get('/api/health', { 'x-madar-jobs-secret': 'jobs-secret' });
    expect(((await checked.json()) as { office: unknown }).office).toEqual({ schema: 3, lastJob: null });
    expect(seen.health).toBe(1);
  });

  it('gives a Cron run to the office object with the requests it saw, and the network port', async () => {
    const { seen, routes, get, net } = setup();
    await get('/api/nothing');
    const at = new Date('2026-10-04T05:00:00Z');
    expect(await routes.scheduled(at, {})).toMatchObject({ ok: true });
    expect(seen.cron).toEqual([{ at: at.toISOString(), worker: 2, net }]);
  });
});
