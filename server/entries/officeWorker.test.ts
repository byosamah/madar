import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { OfficeBatchInput } from '../office/batch';
import type { NetApi } from '../office/net';
import type { OfficeMcpInput } from '../office/parts';
import { recordingNet } from '../office/test/fakes';
import { fakeDeps, testConfig } from '../test/fakes/deps';
import { clientAddress } from '../auth/forgot';
import { TICKET_REFUSE_MIN_MS, TICKET_REFUSED } from '../office/live';
import { hasOfficeBinding, LIVE_PATH, OFFICE_NAME, OFFICE_OPS_PREFIX, officeRoutes, servesOffice, type OfficeCall, type OfficeRoute, type OfficeStub } from './officeWorker';

const STATUS = { ent: 'ent_001', people: 0, invited: 0, storageBytes: 0, lastWriteAt: null, day: { requests: 0, rowsRead: 0, rowsWritten: 0, mails: 0 }, name: '', nameAr: '' };
/** A platform object that lists ENT_VADO and one more enterprise, and counts its reads. */
const PLATFORM = { listed: async () => ['ent_001', 'ent_002'], resolveAddress: async ({ address }: { address: string }) => (address === 'globex' ? { ent: 'ent_002' } : null) };
const TICKET = 'a'.repeat(64);
const BODY = JSON.stringify({ v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] });
const ANSWER = '{"v":1,"serverTime":"2026-10-04T09:00:00.000+03:00","results":[]}';

function setup(o: { batch?: OfficeStub['batch']; routes?: OfficeRoute[]; mcp?: OfficeStub['mcp'] } = {}) {
  const deps = fakeDeps();
  const seen = { batch: [] as { input: OfficeBatchInput; net: NetApi }[], effects: [] as { ids: string[]; worker: number; net: NetApi }[], fetches: [] as Request[], health: 0, cron: [] as unknown[], signins: [] as { signin: string; input: unknown }[], mcps: [] as { input: OfficeMcpInput; net: NetApi }[], created: [] as string[], sleeps: [] as number[] };
  const stub: OfficeStub = {
    batch: o.batch ?? (async (input, net) => (seen.batch.push({ input, net }), { ok: true, body: ANSWER, later: [] })),
    runEffects: async (input, net) => (seen.effects.push({ ...input, net }), { done: input.ids.length, failed: 0 }),
    health: async () => ((seen.health += 1), { schema: 3, lastJob: null }),
    status: async () => STATUS,
    init: async () => ({ ok: true, value: { adminUserId: 'usr_001' } }),
    setState: async () => undefined,
    setLimits: async () => undefined,
    setIdentity: async () => undefined,
    setPlatformOwners: async () => undefined,
    person: async () => ({ userId: 'usr_001' }),
    brand: async () => ({ name: 'Madar', nameAr: 'مدار', logo: null }),
    reinvite: async () => ({ ok: true, value: { sentAt: '2026-10-04T09:00:00.000Z' } }),
    cron: async (input, net) => (seen.cron.push({ ...input, net }), { ok: true, at: input.at, steps: [], closed: 0, day: null, status: STATUS }),
    signin: async (body) => (seen.signins.push(body), { ok: true, value: { echo: body.signin } }),
    mailRoute: async () => ({ status: 200, body: '{"v":1,"ok":true}' }),
    mailWork: async () => undefined,
    mcp: o.mcp ?? (async (input, net) => (seen.mcps.push({ input, net }), { status: 200, headers: [['content-type', 'application/json'], ['x-test', '1']], body: '{"jsonrpc":"2.0","id":1,"result":{}}', later: [] })),
    fetch: async (request) => (seen.fetches.push(request), { status: 101, webSocket: {} } as unknown as Response),
  };
  const net = recordingNet();
  const routes = officeRoutes({
    deps,
    verifyToken: async (header) => {
      if (header !== 'Bearer good') throw new ApiError('unauthenticated', 'Sign in again.');
      return { authUserId: 'auth-1' };
    },
    stubFor: (_env, ent) => (seen.created.push(ent), stub),
    platform: () => PLATFORM as never,
    net: () => net,
    jobsSecret: () => 'jobs-secret',
    sleep: async (ms) => void seen.sleeps.push(ms),
    ...(o.routes ? { routes: o.routes } : {}),
  });
  const post = (headers: Record<string, string>, body = BODY, ctx?: { waitUntil(work: Promise<unknown>): void }) =>
    routes.fetch(new Request('https://madar-server.internal/api/batch', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), {}, ctx);
  const get = (path: string, headers: Record<string, string> = {}) => routes.fetch(new Request(`https://madar-server.internal${path}`, { headers }), {});
  return { deps, seen, routes, post, get, net, stub };
}

describe('the enterprise of a request (Madar enterprises)', () => {
  /** A Worker whose token check gives the ent that the test names, and whose object stubs record the ent they got. */
  function world(token: { authUserId: string; ent?: string }) {
    const got: { name: string; ent: unknown }[] = [];
    const objectOf = (name: string) => ({
      batch: async (input: OfficeBatchInput) => (got.push({ name, ent: input.ent }), { ok: true as const, body: ANSWER, later: [] }),
      health: async () => ({ schema: 14, lastJob: null }),
    });
    const asked: string[] = [];
    const routes = officeRoutes({
      deps: fakeDeps(),
      verifyToken: async () => token,
      stubFor: (_env, ent) => (asked.push(ent), objectOf(ent) as unknown as OfficeStub),
      platform: () => PLATFORM as never,
      net: () => recordingNet(),
      jobsSecret: () => 'jobs-secret',
    });
    return { got, asked, routes };
  }
  const send = (routes: ReturnType<typeof world>['routes'], path: string, init: RequestInit = {}) =>
    routes.fetch(new Request(`https://madar-server.internal${path}`, { method: 'POST', body: BODY, ...init, headers: { 'content-type': 'application/json', authorization: 'Bearer x', ...(init.headers as Record<string, string> | undefined) } }), {});

  it('a batch goes to the stub of the ent in the token, and a token with no ent goes to ENT_VADO', async () => {
    const two = world({ authUserId: 'auth-2', ent: 'ent_002' });
    expect((await send(two.routes, '/api/batch')).status).toBe(200);
    expect(two.got).toEqual([{ name: 'ent_002', ent: 'ent_002' }]);
    const old = world({ authUserId: 'auth-1' });
    await send(old.routes, '/api/batch');
    expect(old.got).toEqual([{ name: 'ent_001', ent: 'ent_001' }]);
  });

  it('a header x-madar-ent, a query ent and a body ent change nothing', async () => {
    const t = world({ authUserId: 'auth-2', ent: 'ent_002' });
    const body = JSON.stringify({ v: 1, ent: 'ent_001', calls: [{ i: 0, name: 'session.get', input: { ent: 'ent_001' } }] });
    await send(t.routes, '/api/batch?ent=ent_001&enterprise=ent_001', { body, headers: { 'x-madar-ent': 'ent_001', 'x-madar-enterprise': 'ent_001', 'x-madar-office-name': 'ent_001' } });
    expect(t.got).toEqual([{ name: 'ent_002', ent: 'ent_002' }]);
    expect(t.asked).toEqual(['ent_002']);
  });

  it('health names no enterprise and, with the secret, shows only ENT_VADO', async () => {
    const t = world({ authUserId: 'a', ent: 'ent_002' });
    const open = await t.routes.fetch(new Request('https://madar-server.internal/api/health'), {});
    const base = (await open.json()) as Record<string, unknown>;
    expect(Object.keys(base).sort()).toEqual(['calls', 'host', 'ok', 'region']);
    const secret = await t.routes.fetch(new Request('https://madar-server.internal/api/health', { headers: { 'x-madar-jobs-secret': 'jobs-secret' } }), {});
    expect(await secret.json()).toEqual({ ...base, office: { schema: 14, lastJob: null } });
    expect(t.asked).toEqual(['ent_001']);
  });

  it('health leaves out the office when the platform does not list ENT_VADO', async () => {
    const asked: string[] = [];
    const routes = officeRoutes({
      deps: fakeDeps(), verifyToken: async () => ({ authUserId: 'a' }), stubFor: (_env, ent) => (asked.push(ent), {} as OfficeStub),
      platform: () => ({ listed: async () => [], resolveAddress: async () => null }) as never, net: () => recordingNet(), jobsSecret: () => 'jobs-secret',
    });
    const answer = await routes.fetch(new Request('https://madar-server.internal/api/health', { headers: { 'x-madar-jobs-secret': 'jobs-secret' } }), {});
    expect(Object.keys((await answer.json()) as object).sort()).toEqual(['calls', 'host', 'ok', 'region']);
    expect(asked).toEqual([]);
  });
});

describe('the Cron fan-out and the status report (Madar enterprises)', () => {
  const AT = new Date('2026-10-04T05:00:00Z');
  const CRON_URL = 'https://madar-server.internal/api/internal/cron';
  const status = (ent: string) => ({ ...STATUS, ent, people: ent === 'ent_002' ? 7 : 3 });

  function cronWorld(o: { listed?: () => Promise<string[]>; cronFails?: string[]; secret?: string | undefined; statusFails?: string[] } = {}) {
    const seen = { cron: [] as { ent: string; at: string; worker: number }[], reports: [] as unknown[], meters: [] as unknown[], sweeps: [] as string[], statuses: [] as string[], legs: [] as { ent: string; at: string }[] };
    const objectOf = (name: string) => ({
      cron: async (input: { ent: string; at: string; worker: number }) => {
        seen.cron.push({ ent: input.ent, at: input.at, worker: input.worker });
        if (o.cronFails?.includes(name)) throw new ApiError('forbidden', 'Madar is paused for this company.', { reason: 'enterprise_paused' });
        return { ok: true, at: input.at, steps: [], closed: 0, day: null, status: status(name) };
      },
      status: async ({ ent }: { ent: string }) => {
        seen.statuses.push(ent);
        if (o.statusFails?.includes(name)) throw new Error('The object is gone.');
        return status(name);
      },
    });
    const platform = {
      // The legs find their enterprise in the listed ids (a paused one too); the run starts a leg for each active id only.
      listed: async () => ['ent_001', 'ent_002', 'ent_003'],
      activeIds: o.listed ?? (async () => ['ent_001', 'ent_002']),
      resolveAddress: async () => null,
      report: async (input: unknown) => void seen.reports.push(input),
      meter: async (input: unknown) => void seen.meters.push(input),
      sweep: async ({ at }: { at: string }) => void seen.sweeps.push(at),
    };
    const deps = fakeDeps();
    const routes = officeRoutes({
      deps,
      verifyToken: async () => ({ authUserId: 'x' }),
      stubFor: (_env, ent) => objectOf(ent) as never,
      platform: () => platform as never,
      net: () => recordingNet(),
      jobsSecret: () => ('secret' in o ? o.secret : 'jobs-secret'),
      // The legs go straight into the routes of the same isolate, as the binding SELF does between two invocations.
      fanout: () => async (leg) => (seen.legs.push(leg), routes.fetch(new Request(CRON_URL, { method: 'POST', headers: { 'x-madar-jobs-secret': 'jobs-secret' }, body: JSON.stringify(leg) }), {})),
    });
    return { seen, routes, deps };
  }

  it('scheduled lists the enterprises and sends one leg for each id, in order', async () => {
    const { seen, routes } = cronWorld();
    const out = await routes.scheduled(AT, {});
    expect(out?.legs.map((leg) => [leg.ent, leg.ok])).toEqual([['ent_001', true], ['ent_002', true]]);
    expect(seen.legs.map((leg) => leg.ent)).toEqual(['ent_001', 'ent_002']);
    expect(seen.cron.map((one) => one.ent)).toEqual(['ent_001', 'ent_002']);
  });

  it('a first leg that fails does not stop the second', async () => {
    const { seen, routes } = cronWorld({ cronFails: ['ent_001'] });
    const out = await routes.scheduled(AT, {});
    expect(out?.legs.map((leg) => [leg.ent, leg.ok])).toEqual([['ent_001', false], ['ent_002', true]]);
    expect(seen.cron.map((one) => one.ent)).toEqual(['ent_001', 'ent_002']);
  });

  it('a leg reports the status and the meter of its enterprise to the platform', async () => {
    const { seen, routes } = cronWorld();
    await routes.scheduled(AT, {});
    expect(seen.reports).toEqual([status('ent_001'), status('ent_002')]);
    expect(seen.meters).toEqual([
      { ent: 'ent_001', day: '2026-10-04', counts: STATUS.day }, { ent: 'ent_002', day: '2026-10-04', counts: STATUS.day },
    ]);
  });

  it('a paused enterprise (cron throws) still reports its status, and no meter', async () => {
    const { seen, routes } = cronWorld({ cronFails: ['ent_002'] });
    await routes.scheduled(AT, {});
    expect(seen.statuses).toEqual(['ent_002']);
    expect(seen.reports).toEqual([status('ent_001'), status('ent_002')]);
    expect(seen.meters.map((one) => (one as { ent: string }).ent)).toEqual(['ent_001']);
  });

  it('a leg whose object answers neither the jobs nor the status is a failed leg and logs the id and no secret', async () => {
    const { seen, routes, deps } = cronWorld({ cronFails: ['ent_001'], statusFails: ['ent_001'] });
    const out = await routes.scheduled(AT, {});
    expect(out?.legs.map((leg) => leg.ok)).toEqual([false, true]);
    expect(seen.reports).toEqual([status('ent_002')]);
    const text = JSON.stringify(deps.logs);
    expect(text).toContain('ent_001');
    expect(text).not.toContain('jobs-secret');
  });

  it('the cron route gives 401 without the jobs secret and 404 for an unlisted id, and runs no job', async () => {
    const { seen, routes } = cronWorld();
    const send = (body: unknown, headers: Record<string, string> = {}) => routes.fetch(new Request(CRON_URL, { method: 'POST', headers, body: JSON.stringify(body) }), {});
    expect((await send({ ent: 'ent_001', at: AT.toISOString() })).status).toBe(401);
    expect((await send({ ent: 'ent_001', at: AT.toISOString() }, { 'x-madar-jobs-secret': 'wrong' })).status).toBe(401);
    expect((await routes.fetch(new Request(CRON_URL, { headers: { 'x-madar-jobs-secret': 'jobs-secret' } }), {})).status).toBe(401);
    const ok = { 'x-madar-jobs-secret': 'jobs-secret' };
    expect((await send({ ent: 'ent_009', at: AT.toISOString() }, ok)).status).toBe(404);
    expect((await send({ ent: 'ENT_001', at: AT.toISOString() }, ok)).status).toBe(404);
    expect((await send({ ent: 'ent_001', at: 'later' }, ok)).status).toBe(400);
    expect(seen.cron).toEqual([]);
  });

  it('the first run after 00:00 UTC calls sweep once; the run at 06:15 does not', async () => {
    const { seen, routes } = cronWorld();
    await routes.scheduled(new Date('2026-10-05T00:05:00Z'), {});
    expect(seen.sweeps).toEqual(['2026-10-05T00:05:00.000Z']);
    await routes.scheduled(new Date('2026-10-05T06:15:00Z'), {});
    expect(seen.sweeps).toHaveLength(1);
  });

  it('starts a leg for each active enterprise only: a paused one (listed, not active) gets no cron call (plan C)', async () => {
    const { seen, routes } = cronWorld({ listed: async () => ['ent_001'] });
    await routes.scheduled(AT, {});
    expect(seen.legs.map((leg) => leg.ent)).toEqual(['ent_001']);
    expect(seen.cron.map((one) => one.ent)).toEqual(['ent_001']);
  });

  it('logs and returns when the list of enterprises does not load, and starts no leg', async () => {
    const { seen, routes, deps } = cronWorld({ listed: async () => { throw new Error('The platform is down.'); } });
    expect(await routes.scheduled(AT, {})).toBeUndefined();
    expect(seen.legs).toEqual([]);
    expect(deps.logs.some((line) => line.level === 'error' && line.message.includes('did not load'))).toBe(true);
  });

  it('starts no leg when the Worker has no jobs secret, and uses the self transport by default', async () => {
    const plain = officeRoutes({
      deps: fakeDeps(), verifyToken: async () => ({ authUserId: 'x' }), stubFor: () => ({}) as never, platform: () => ({ listed: async () => ['ent_001'], activeIds: async () => ['ent_001'], sweep: async () => undefined }) as never,
      net: () => recordingNet(), jobsSecret: () => undefined,
    });
    expect(await plain.scheduled(AT, {})).toBeUndefined();
    // With the secret and no binding SELF, the leg fails with the clear error and the run goes on.
    const selfless = officeRoutes({
      deps: fakeDeps(), verifyToken: async () => ({ authUserId: 'x' }), stubFor: () => ({}) as never, platform: () => ({ listed: async () => ['ent_001'], activeIds: async () => ['ent_001'], sweep: async () => undefined }) as never,
      net: () => recordingNet(), jobsSecret: () => 'jobs-secret',
    });
    const out = await selfless.scheduled(AT, {});
    expect(out?.legs).toEqual([{ ent: 'ent_001', ok: false, ms: expect.any(Number), status: null }]);
  });
});

describe('the probe routes of spike S1', () => {
  const TOOLS = { MADAR_TEST_TOOLS: 'on', APP_URL: 'http://127.0.0.1:5173', SUPABASE_URL: 'http://127.0.0.1:54321' };
  const send = (env: Record<string, unknown>, path: string, headers: Record<string, string> = {}) =>
    setup().routes.fetch(new Request(`https://madar-server.internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"count":2,"outside":0}' }), env);

  it('answers 404 with no test tools and 401 with a wrong secret', async () => {
    expect((await send({}, '/api/internal/probe/fanout', { 'x-madar-jobs-secret': 'jobs-secret' })).status).toBe(404);
    expect((await send({}, '/api/internal/probe/leg')).status).toBe(404);
    expect((await send(TOOLS, '/api/internal/probe/fanout', { 'x-madar-jobs-secret': 'wrong' })).status).toBe(401);
    expect((await send(TOOLS, '/api/internal/probe/leg')).status).toBe(401);
  });

  it('runs a leg with the right secret and no outside calls', async () => {
    const answer = await send(TOOLS, '/api/internal/probe/leg', { 'x-madar-jobs-secret': 'jobs-secret' });
    expect([answer.status, await answer.json()]).toEqual([200, { outside: 0, worked: 0 }]);
  });
});

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
    expect(seen.batch[0].input).toEqual({ ent: 'ent_001', who: { kind: 'browser', authUserId: 'auth-1' }, calls: [{ i: 0, name: 'session.get', input: {} }], overviewCalls: 0, worker: 1 });
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
    expect(seen.effects).toEqual([{ ent: 'ent_001', ids: ['7', '8'], worker: 0, net }]);
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
    const answer = await get(`${LIVE_PATH}?ticket=ent_001.${TICKET}`, { upgrade: 'websocket' });
    expect(answer.status).toBe(101);
    expect(seen.fetches).toHaveLength(1);
  });

  it('a ticket with a bad shape or an unlisted tag gets TICKET_REFUSED, waits the minimum time and makes no stub', async () => {
    const { seen, get } = setup();
    const bad = [`${TICKET}`, `ent_009.${TICKET}`, `ENT_001.${TICKET}`, `ent_001.${'a'.repeat(63)}`, `ent_001.${TICKET}.x`, `ent_001.${'a'.repeat(5000)}`, 'abc', ''];
    const answers: string[] = [];
    for (const ticket of bad) {
      const answer = await get(`${LIVE_PATH}?ticket=${ticket}`, { upgrade: 'websocket' });
      expect(answer.status, ticket.slice(0, 20)).toBe(401);
      answers.push(await answer.text());
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toContain(TICKET_REFUSED.message);
    expect(seen.sleeps).toHaveLength(bad.length);
    for (const wait of seen.sleeps) expect(wait).toBeGreaterThan(TICKET_REFUSE_MIN_MS - 20);
    expect(seen.created).toEqual([]);
    expect(seen.fetches).toEqual([]);
  });

  it('a listed tag reaches that object', async () => {
    const { seen, get } = setup();
    expect((await get(`${LIVE_PATH}?ticket=ent_002.${TICKET}`, { upgrade: 'websocket' })).status).toBe(101);
    expect(seen.created).toEqual(['ent_002']);
  });

  it('a refusal of the object waits the minimum time too', async () => {
    const { seen, get, stub } = setup();
    stub.fetch = async () => new Response('{"v":1,"error":{"code":"unauthenticated","message":"x"}}', { status: 401 });
    const answer = await get(`${LIVE_PATH}?ticket=ent_001.${TICKET}`, { upgrade: 'websocket' });
    expect(answer.status).toBe(401);
    expect(await answer.text()).toContain(TICKET_REFUSED.message);
    expect(seen.sleeps).toHaveLength(1);
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

  it('mounts each route of the routes option under /api, with the office object, the network port and the after of its request', async () => {
    const got: { call: OfficeCall; address: string }[] = [];
    const route: OfficeRoute = {
      method: 'GET', path: '/auth/jwks', handler: async (request, call) => (got.push({ call, address: clientAddress(request) }), Response.json({ keys: [] })),
    };
    const { routes, net, stub, get } = setup({ routes: [route] });
    const answer = await routes.fetch(new Request('https://madar-server.internal/api/auth/jwks', { headers: { 'x-madar-client-address': '203.0.113.7' } }), {}, { waitUntil: () => undefined });
    expect(answer.status).toBe(200);
    expect(got).toHaveLength(1);
    expect([got[0].call.router.stub('ent_001'), got[0].call.net(), typeof got[0].call.after, got[0].address]).toEqual([stub, net, 'function', '203.0.113.7']);
    expect((await get('/auth/jwks')).status).toBe(404);
  });

  describe('the MCP address on the office path (merge of exit waves 2 and 3)', () => {
    const mcpPost = (routes: ReturnType<typeof setup>['routes'], path: string, body: string, ctx?: { waitUntil(work: Promise<unknown>): void }) =>
      routes.fetch(new Request(`https://madar-server.internal${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer agent-token', origin: 'https://evil.test' }, body,
      }), {}, ctx);

    it('hands each /mcp request to the office object in one call, as it came, and answers its answer as it is', async () => {
      const { seen, routes, net } = setup();
      const answer = await mcpPost(routes, '/mcp', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
      expect([answer.status, answer.headers.get('x-test'), answer.headers.get('access-control-allow-origin'), await answer.text()]).toEqual([200, '1', null, '{"jsonrpc":"2.0","id":1,"result":{}}']);
      expect(seen.mcps).toHaveLength(1);
      const { input } = seen.mcps[0];
      expect([input.url, input.method, input.body, input.worker, seen.mcps[0].net]).toEqual(['https://madar-server.internal/mcp', 'POST', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', 1, net]);
      expect(Object.fromEntries(input.headers)).toMatchObject({ authorization: 'Bearer agent-token', origin: 'https://evil.test' });
      expect(seen.batch).toEqual([]);
    });

    it('hands the OAuth routes under /mcp with no body for a GET, and runs the mails of a tool call after the answer', async () => {
      const { seen, routes, net } = setup({ mcp: async (input, n) => (seen.mcps.push({ input, net: n }), { status: 200, headers: [], body: '{}', later: ['9'] }) });
      const metadata = await routes.fetch(new Request('https://madar-server.internal/mcp/.well-known/oauth-authorization-server'), {});
      expect([metadata.status, seen.mcps[0].input.method, seen.mcps[0].input.body]).toEqual([200, 'GET', null]);
      const waits: Promise<unknown>[] = [];
      await mcpPost(routes, '/mcp', '{"jsonrpc":"2.0","id":2,"method":"tools/call"}', { waitUntil: (work) => waits.push(work) });
      expect(waits).toHaveLength(1);
      await Promise.all(waits);
      expect(seen.effects.map((e) => [e.ids, e.net])).toEqual([[['9'], net], [['9'], net]]);
    });

    it('an unknown address gets the 401 of a missing token with the challenge of that address, and makes no stub', async () => {
      const { seen, routes } = setup();
      for (const path of ['/mcp/nope', '/mcp/Globex', '/mcp/a', '/mcp/g%6Cobex', '/mcp/mcp']) {
        const answer = await mcpPost(routes, path, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
        expect(answer.status, path).toBe(401);
        expect(await answer.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: 401 } });
        expect(answer.headers.get('www-authenticate'), path).toMatch(/^Bearer resource_metadata="http:\/\/127\.0\.0\.1:54321\/functions\/v1\/mcp(\/nope)?\/oauth-protected-resource"/);
      }
      expect(seen.created).toEqual([]);
      expect(seen.mcps).toEqual([]);
    });

    it('an unknown address answers a request with no token as the object does, and a request with a token as an unreadable token', async () => {
      const { routes } = setup();
      const none = await routes.fetch(new Request('https://madar-server.internal/mcp/nope', { method: 'POST', body: '{}' }), {});
      expect((await none.json()) as { error: { message: string } }).toMatchObject({ error: { message: 'Send the Madar access token in the Authorization header.' } });
      const some = await mcpPost(routes, '/mcp/nope', '{}');
      expect(some.headers.get('www-authenticate')).toContain('error="invalid_token"');
    });

    it('the object gets the rewritten path and mcpUrl = <config.mcpUrl>/globex, with the query kept', async () => {
      const { seen, routes, deps } = setup();
      const answer = await mcpPost(routes, '/mcp/globex/oauth/register?x=1', '{}');
      expect(answer.status).toBe(200);
      expect(seen.created).toEqual(['ent_002']);
      expect(seen.mcps).toHaveLength(1);
      expect(seen.mcps[0].input).toMatchObject({ ent: 'ent_002', mcpUrl: `${deps.config.mcpUrl}/globex`, url: 'https://madar-server.internal/mcp/oauth/register?x=1' });
    });

    it('/mcp/oauth/token and the metadata paths go to ENT_VADO with the mcpUrl of the copy', async () => {
      const { seen, routes, deps } = setup();
      await mcpPost(routes, '/mcp/oauth/token', '{}');
      await routes.fetch(new Request('https://madar-server.internal/mcp/oauth-protected-resource'), {});
      await routes.fetch(new Request('https://madar-server.internal/mcp/.well-known/openid-configuration'), {});
      expect(seen.mcps.map((one) => [one.input.ent, one.input.mcpUrl, new URL(one.input.url).pathname])).toEqual([
        ['ent_001', deps.config.mcpUrl, '/mcp/oauth/token'], ['ent_001', deps.config.mcpUrl, '/mcp/oauth-protected-resource'], ['ent_001', deps.config.mcpUrl, '/mcp/.well-known/openid-configuration'],
      ]);
      expect(seen.created).toEqual(['ent_001', 'ent_001', 'ent_001']);
    });

    it('a header, a query value or a body that names an enterprise changes nothing: only the address does', async () => {
      const { seen, routes } = setup();
      await routes.fetch(new Request('https://madar-server.internal/mcp?ent=ent_002&enterprise=ent_002', { method: 'POST', headers: { 'x-madar-ent': 'ent_002', host: 'globex.madar.test' }, body: '{"ent":"ent_002"}' }), {});
      expect(seen.mcps[0].input.ent).toBe('ent_001');
    });

    it('answers a JSON-RPC refusal when the office object is busy, with no answer of the object', async () => {
      const { routes } = setup({ mcp: async () => { throw Object.assign(new Error('Durable Object is overloaded.'), { overloaded: true }); } });
      const answer = await mcpPost(routes, '/mcp', '{}');
      expect(answer.status).toBe(503);
      expect(await answer.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: 503 } });
    });
  });
});

describe('which path of the Worker serves a request (exit wave 4)', () => {
  const OFFICE = { idFromName: () => 'id', get: () => ({}) };
  it('serves every path from the office object with MADAR_DATA = office and the binding', () => {
    expect(servesOffice({ MADAR_DATA: 'office', OFFICE }, '/api/batch')).toBe(true);
  });
  it('serves /api/office/* from the office object whenever the binding exists, and nothing else', () => {
    expect(OFFICE_OPS_PREFIX).toBe('/api/office/');
    expect(servesOffice({ OFFICE }, '/api/office/export')).toBe(true);
    expect(servesOffice({ OFFICE }, '/api/batch')).toBe(false);
    expect(servesOffice({ OFFICE }, '/api/officers')).toBe(false);
  });
  it('serves nothing from the office object with no binding (production before wave 6)', () => {
    expect(servesOffice({ MADAR_DATA: 'office' }, '/api/office/export')).toBe(false);
    expect(hasOfficeBinding({})).toBe(false);
    expect(hasOfficeBinding({ OFFICE: { idFromName: 'x' } })).toBe(false);
  });
});

describe('the office ops behind their secrets (exit wave 4)', () => {
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  function opsRoutes() {
    const seen: { name: string; path: string; header: string | null; body: string }[] = [];
    const created: string[] = [];
    const platformCalls: { method: string; input: unknown }[] = [];
    const stubFor = (name: string) => (created.push(name), {
      fetch: async (request: Request) => {
        seen.push({ name, path: new URL(request.url).pathname, header: request.headers.get('x-madar-office-name'), body: await request.text() });
        return Response.json({ ok: true });
      },
    });
    const routes = officeRoutes({
      deps: { config: testConfig(), clock: { now: () => new Date() }, log: quiet },
      verifyToken: async () => ({ authUserId: 'x' }),
      stubFor: (_env, name) => stubFor(name) as never,
      platform: () => ({ ...PLATFORM, register: async (input: unknown) => void platformCalls.push({ method: 'register', input }), setOwners: async (input: unknown) => void platformCalls.push({ method: 'setOwners', input }) }) as never,
      net: () => ({}) as never,
      jobsSecret: () => 'jobs',
      exportSecret: () => 'export-secret-of-the-test',
      opsSecret: () => 'ops-secret-of-the-test',
    });
    return { routes, seen, created, platformCalls };
  }
  const post = (path: string, headers: Record<string, string>) => new Request(`https://w.test${path}`, { method: 'POST', headers, body: '{"step":"begin"}' });

  it('refuses an op with no secret, a wrong secret, or the secret of the other op', async () => {
    const { routes, seen } = opsRoutes();
    const tries: Record<string, string>[] = [{}, { 'x-madar-export-secret': 'no' }, { 'x-madar-ops-secret': 'export-secret-of-the-test' }];
    for (const headers of tries) {
      expect((await routes.fetch(post('/api/office/export', headers), {})).status).toBe(401);
    }
    expect((await routes.fetch(post('/api/office/import', { 'x-madar-export-secret': 'export-secret-of-the-test' }), {})).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('hands export to the named object with the export secret, and import with the ops secret, with the body as it came', async () => {
    const { routes, seen } = opsRoutes();
    expect((await routes.fetch(post('/api/office/export', { 'x-madar-export-secret': 'export-secret-of-the-test' }), {})).status).toBe(200);
    expect((await routes.fetch(post('/api/office/import?office=rehearsal-20261020', { 'x-madar-ops-secret': 'ops-secret-of-the-test' }), {})).status).toBe(200);
    expect(seen).toEqual([
      { name: 'ent_001', path: '/office/export', header: 'ent_001', body: '{"step":"begin"}' },
      { name: 'rehearsal-20261020', path: '/office/import', header: 'rehearsal-20261020', body: '{"step":"begin"}' },
    ]);
  });

  it('export of ent_002 reaches the ent_002 stub; export of an unlisted ent_009 gives 403 and makes no stub', async () => {
    const { routes, seen, created } = opsRoutes();
    const exportOp = { 'x-madar-export-secret': 'export-secret-of-the-test' };
    expect((await routes.fetch(post('/api/office/export?office=ent_002', exportOp), {})).status).toBe(200);
    expect(seen).toEqual([{ name: 'ent_002', path: '/office/export', header: 'ent_002', body: '{"step":"begin"}' }]);
    for (const name of ['ent_009', 'ENT_002', 'ent_2', 'ent_002.x']) expect((await routes.fetch(post(`/api/office/export?office=${name}`, exportOp), {})).status, name).toBe(403);
    expect(created).toEqual(['ent_002']);
  });

  it('import takes the old name office, a rehearsal name and a listed id, and nothing else', async () => {
    const { routes, created } = opsRoutes();
    const ops = { 'x-madar-ops-secret': 'ops-secret-of-the-test' };
    for (const name of ['office', 'rehearsal-20261020', 'ent_001', 'ent_002']) expect((await routes.fetch(post(`/api/office/import?office=${name}`, ops), {})).status, name).toBe(200);
    expect((await routes.fetch(post('/api/office/import?office=ent_009', ops), {})).status).toBe(403);
    expect(created).toEqual(['office', 'rehearsal-20261020', 'ent_001', 'ent_002']);
  });

  it('peek without ?office= reaches ENT_VADO, and a drop of an enterprise id gives 403', async () => {
    const { routes, seen } = opsRoutes();
    const ops = { 'x-madar-ops-secret': 'ops-secret-of-the-test' };
    expect((await routes.fetch(post('/api/office/peek', ops), {})).status).toBe(200);
    expect(seen.map((one) => one.name)).toEqual(['ent_001']);
    expect((await routes.fetch(post('/api/office/drop?office=ent_001', ops), {})).status).toBe(403);
    expect((await routes.fetch(post('/api/office/drop?office=ent_002', ops), {})).status).toBe(403);
    expect(seen).toHaveLength(1);
  });

  describe('the ops of the platform object', () => {
    const row = {
      id: 'ent_002', address: 'globex', name: 'Globex', nameAr: 'جلوبكس', state: 'active', limits: { people: null, storageBytes: null },
      createdAt: '2026-11-08T08:00:00.000Z', firstAdmin: { name: 'Hana', email: 'hana@globex.test' },
    };
    const send = (routes: ReturnType<typeof opsRoutes>['routes'], op: string, body: unknown, headers: Record<string, string> = { 'x-madar-ops-secret': 'ops-secret-of-the-test' }) =>
      routes.fetch(new Request(`https://w.test/api/office/${op}?office=ent_002`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), {});

    it('platform-register needs the ops secret (401 otherwise), refuses a bad row with 400, and calls platform.register', async () => {
      const { routes, platformCalls, created } = opsRoutes();
      expect((await send(routes, 'platform-register', { row, emails: ['hana@globex.test'] }, {})).status).toBe(401);
      expect((await send(routes, 'platform-register', { row, emails: [] }, { 'x-madar-export-secret': 'export-secret-of-the-test' })).status).toBe(401);
      for (const bad of [{ row: { ...row, id: 'ENT_2' }, emails: [] }, { row: { ...row, address: 'oauth' }, emails: [] }, { row: { ...row, state: 'gone' }, emails: [] }, { row, emails: 'x' }, { emails: [] }, 'text']) {
        expect((await send(routes, 'platform-register', bad)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
      }
      expect(platformCalls).toEqual([]);
      const ok = await send(routes, 'platform-register', { row, emails: ['hana@globex.test'] });
      expect([ok.status, await ok.json()]).toEqual([200, { ok: true }]);
      expect(platformCalls).toEqual([{ method: 'register', input: { row, emails: ['hana@globex.test'] } }]);
      // The op takes no ?office= and makes no object.
      expect(created).toEqual([]);
    });

    it('platform-owners needs the ops secret, refuses a bad body, and calls platform.setOwners', async () => {
      const { routes, platformCalls } = opsRoutes();
      const owners = [{ ent: 'ent_001', userId: 'usr_001' }];
      expect((await send(routes, 'platform-owners', { owners }, {})).status).toBe(401);
      for (const bad of [{ owners: [{ ent: 'x', userId: 'usr_001' }] }, { owners: [{ ent: 'ent_001', userId: 'someone' }] }, { owners: 'x' }, {}]) expect((await send(routes, 'platform-owners', bad)).status).toBe(400);
      expect(platformCalls).toEqual([]);
      expect((await send(routes, 'platform-owners', { owners })).status).toBe(200);
      expect(platformCalls).toEqual([{ method: 'setOwners', input: { owners } }]);
    });
  });

  it('drops only a rehearsal object, and peeks only into the office of the copy', async () => {
    const { routes, seen } = opsRoutes();
    const ops = { 'x-madar-ops-secret': 'ops-secret-of-the-test' };
    expect((await routes.fetch(post('/api/office/drop', ops), {})).status).toBe(403);
    expect((await routes.fetch(post('/api/office/peek?office=rehearsal-20261020', ops), {})).status).toBe(403);
    expect((await routes.fetch(post('/api/office/export?office=other', { 'x-madar-export-secret': 'export-secret-of-the-test' }), {})).status).toBe(403);
    expect((await routes.fetch(post('/api/office/drop?office=rehearsal-20261020', ops), {})).status).toBe(200);
    expect(seen.map((s) => s.path)).toEqual(['/office/drop']);
  });

  it('answers 404 for an op that does not exist and for a GET, with no object call', async () => {
    const { routes, seen } = opsRoutes();
    expect((await routes.fetch(post('/api/office/nothing', { 'x-madar-ops-secret': 'ops-secret-of-the-test' }), {})).status).toBe(404);
    expect((await routes.fetch(new Request('https://w.test/api/office/export', { headers: { 'x-madar-export-secret': 'export-secret-of-the-test' } }), {})).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('answers 401 when the copy has no secret for the op at all', async () => {
    const routes = officeRoutes({
      deps: { config: testConfig(), clock: { now: () => new Date() }, log: quiet },
      verifyToken: async () => ({ authUserId: 'x' }), stubFor: () => ({}) as never, platform: () => PLATFORM as never, net: () => ({}) as never, jobsSecret: () => undefined,
      exportSecret: () => undefined, opsSecret: () => undefined,
    });
    expect((await routes.fetch(post('/api/office/export', { 'x-madar-export-secret': '' }), {})).status).toBe(401);
    expect((await routes.fetch(post('/api/office/import', { 'x-madar-ops-secret': '' }), {})).status).toBe(401);
  });

  it('names the office object of a copy office, from this file', () => {
    expect(OFFICE_NAME).toBe('office');
  });
});
