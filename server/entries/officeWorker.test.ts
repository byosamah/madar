import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { OfficeBatchInput } from '../office/batch';
import type { NetApi } from '../office/net';
import type { OfficeMcpInput } from '../office/parts';
import { recordingNet } from '../office/test/fakes';
import { fakeDeps, testConfig } from '../test/fakes/deps';
import { clientAddress } from '../auth/forgot';
import { hasOfficeBinding, LIVE_PATH, OFFICE_NAME, OFFICE_OPS_PREFIX, officeRoutes, servesOffice, type OfficeCall, type OfficeRoute, type OfficeStub } from './officeWorker';

const TICKET = 'a'.repeat(64);
const BODY = JSON.stringify({ v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] });
const ANSWER = '{"v":1,"serverTime":"2026-10-04T09:00:00.000+03:00","results":[]}';

function setup(o: { batch?: OfficeStub['batch']; routes?: OfficeRoute[]; mcp?: OfficeStub['mcp'] } = {}) {
  const deps = fakeDeps();
  const seen = { batch: [] as { input: OfficeBatchInput; net: NetApi }[], effects: [] as { ids: string[]; worker: number; net: NetApi }[], fetches: [] as Request[], health: 0, cron: [] as unknown[], signins: [] as { signin: string; input: unknown }[], mcps: [] as { input: OfficeMcpInput; net: NetApi }[] };
  const stub: OfficeStub = {
    batch: o.batch ?? (async (input, net) => (seen.batch.push({ input, net }), { ok: true, body: ANSWER, later: [] })),
    runEffects: async (input, net) => (seen.effects.push({ ...input, net }), { done: input.ids.length, failed: 0 }),
    health: async () => ((seen.health += 1), { schema: 3, lastJob: null }),
    cron: async (input, net) => (seen.cron.push({ ...input, net }), { ok: true, at: input.at, steps: [], closed: 0, day: null }),
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
    stub: () => stub,
    net: () => net,
    jobsSecret: () => 'jobs-secret',
    ...(o.routes ? { routes: o.routes } : {}),
  });
  const post = (headers: Record<string, string>, body = BODY, ctx?: { waitUntil(work: Promise<unknown>): void }) =>
    routes.fetch(new Request('https://madar-server.internal/api/batch', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), {}, ctx);
  const get = (path: string, headers: Record<string, string> = {}) => routes.fetch(new Request(`https://madar-server.internal${path}`, { headers }), {});
  return { deps, seen, routes, post, get, net, stub };
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

  it('mounts each route of the routes option under /api, with the office object, the network port and the after of its request', async () => {
    const got: { call: OfficeCall; address: string }[] = [];
    const route: OfficeRoute = {
      method: 'GET', path: '/auth/jwks', handler: async (request, call) => (got.push({ call, address: clientAddress(request) }), Response.json({ keys: [] })),
    };
    const { routes, net, stub, get } = setup({ routes: [route] });
    const answer = await routes.fetch(new Request('https://madar-server.internal/api/auth/jwks', { headers: { 'x-madar-client-address': '203.0.113.7' } }), {}, { waitUntil: () => undefined });
    expect(answer.status).toBe(200);
    expect(got).toHaveLength(1);
    expect([got[0].call.stub, got[0].call.net(), typeof got[0].call.after, got[0].address]).toEqual([stub, net, 'function', '203.0.113.7']);
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
    const stubFor = (name: string) => ({
      fetch: async (request: Request) => {
        seen.push({ name, path: new URL(request.url).pathname, header: request.headers.get('x-madar-office-name'), body: await request.text() });
        return Response.json({ ok: true });
      },
    });
    const routes = officeRoutes({
      deps: { config: testConfig(), clock: { now: () => new Date() }, log: quiet },
      verifyToken: async () => ({ authUserId: 'x' }),
      stub: () => stubFor('office') as never,
      stubOf: (_env, name) => stubFor(name) as never,
      net: () => ({}) as never,
      jobsSecret: () => 'jobs',
      exportSecret: () => 'export-secret-of-the-test',
      opsSecret: () => 'ops-secret-of-the-test',
    });
    return { routes, seen };
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
      { name: 'office', path: '/office/export', header: 'office', body: '{"step":"begin"}' },
      { name: 'rehearsal-20261020', path: '/office/import', header: 'rehearsal-20261020', body: '{"step":"begin"}' },
    ]);
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
      verifyToken: async () => ({ authUserId: 'x' }), stub: () => ({}) as never, net: () => ({}) as never, jobsSecret: () => undefined,
      exportSecret: () => undefined, opsSecret: () => undefined,
    });
    expect((await routes.fetch(post('/api/office/export', { 'x-madar-export-secret': '' }), {})).status).toBe(401);
    expect((await routes.fetch(post('/api/office/import', { 'x-madar-ops-secret': '' }), {})).status).toBe(401);
  });

  it('names the office object of a copy office, from this file', () => {
    expect(OFFICE_NAME).toBe('office');
  });
});
