import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CloudflareAnswer, CloudflareApi, CloudflareInit } from './cloudflare.ts';
import { ORIGIN_CONNECTION_LIMIT, corsRulesOf, hyperdriveProblems, runSetup, type SetupRun } from './cloudflare-setup.ts';

/** scripts/deploy/cloudflare-setup.ts (owner, 2026-10-16) on a fake Cloudflare API. No test reaches the network. */
const TEST = 'qdgwpnesxppnqsaabqzd';
const PRODUCTION = 'oprkvdjudjxxhvodkzgs';
const SERVER_PASSWORD = 'Server-Password-1234';
const CA_ID = 'ca-0001';
const CA_PEM = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
const TOML = readFileSync(new URL('../../wrangler.server.toml', import.meta.url), 'utf8');
const CORS = JSON.stringify({ rules: [{ allowed: { origins: ['https://preview.madar-46r.pages.dev'], methods: ['PUT', 'GET'], headers: ['Content-Type'] }, maxAgeSeconds: 7200 }] });

const secretsFile = (ref: string) => [
  `DATABASE_URL=postgresql://madar_server.${ref}:${SERVER_PASSWORD}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`,
  'APP_URL=https://preview.madar-46r.pages.dev',
  'MAIL_FROM=Madar <madar@vado.sa>',
  'MAIL_DRIVER=outbox',
  'JOBS_SECRET=jobs-secret-value-1',
].join('\n');

type State = {
  cas: { id: string; name: string; ca: boolean }[];
  configs: Record<string, unknown>[];
  r2: 'off' | 'missing' | 'exists';
  worker: boolean;
  services: Record<string, Record<string, { service: string; environment?: string }>>;
};
type Call = { method: string; path: string; body?: unknown; headers?: Record<string, string> };

const ok = <T>(result: T, status = 200): CloudflareAnswer<T> => ({ status, success: true, errors: [], result });
const no = (status: number, code: number, message: string): CloudflareAnswer<never> => ({ status, success: false, errors: [{ code, message }], result: undefined as never });

function goodConfig(name: string, ref: string, more: Record<string, unknown> = {}) {
  return {
    id: `${name}-id`, name,
    origin: { host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, user: `madar_server.${ref}`, database: 'postgres' },
    caching: { disabled: true }, mtls: { ca_certificate_id: CA_ID, sslmode: 'verify-full' }, origin_connection_limit: 10, ...more,
  };
}

/** A fake of the account API: it answers from a small state and records every call. */
function fakeApi(state: State): { api: CloudflareApi; calls: Call[] } {
  const calls: Call[] = [];
  const api = (async (path: string, init: CloudflareInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, path, ...(init.body === undefined ? {} : { body: init.body }), ...(init.headers ? { headers: init.headers } : {}) });
    if (path === '/mtls_certificates' && method === 'GET') return ok(state.cas);
    if (path === '/mtls_certificates' && method === 'POST') return ok({ id: CA_ID, name: 'supabase-root-2021-ca', ca: true });
    if (path === '/hyperdrive/configs' && method === 'GET') return ok(state.configs.map((c) => ({ id: c.id, name: c.name })));
    if (path.startsWith('/hyperdrive/configs/') && method === 'GET') return ok(state.configs.find((c) => path.endsWith(String(c.id))));
    if (path === '/hyperdrive/configs' && method === 'POST') return ok({ id: 'made-hyperdrive-id', name: (init.body as { name: string }).name });
    if (path.startsWith('/r2/')) {
      if (state.r2 === 'off') return no(403, 10042, 'Please enable R2 through the Cloudflare Dashboard.');
      if (method === 'GET') return state.r2 === 'exists' ? ok({ name: 'b' }) : no(404, 10006, 'The specified bucket does not exist.');
      return ok({});
    }
    if (path.startsWith('/workers/scripts/')) return state.worker ? ok({}) : no(404, 10007, 'This Worker does not exist on your account.');
    if (path === '/pages/projects/madar' && method === 'GET') {
      return ok({ deployment_configs: Object.fromEntries(Object.entries(state.services).map(([env, services]) => [env, { services, env_vars: { KEEP: { value: 'x' } } }])) });
    }
    if (path === '/pages/projects/madar' && method === 'PATCH') return ok({});
    return no(404, 7003, 'No route.');
  }) as CloudflareApi;
  return { api, calls };
}

function setup(o: { target?: 'test' | 'production'; state?: Partial<State>; answer?: string; env?: Record<string, string>; cors?: string | null } = {}) {
  const target = o.target ?? 'test';
  const ref = target === 'test' ? TEST : PRODUCTION;
  const state: State = {
    cas: [{ id: CA_ID, name: 'supabase-root-2021-ca', ca: true }],
    configs: [goodConfig(`madar-db-${target}`, ref)],
    r2: 'exists',
    worker: true,
    services: { preview: {}, production: {} },
    ...o.state,
  };
  const { api, calls } = fakeApi(state);
  const logs: string[] = [];
  const asked: string[] = [];
  const run: SetupRun = {
    target, api, secretsText: secretsFile(ref), caPem: CA_PEM, toml: TOML, env: o.env ?? {},
    ...(o.cors === null ? {} : { corsText: o.cors ?? CORS }),
    ask: async (question) => (asked.push(question), o.answer ?? ''),
    log: (line) => void logs.push(line),
  };
  return { run, calls, logs, asked, state };
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET');

describe('cloudflare-setup.ts', () => {
  it('changes nothing when every part exists: it only reads, and prints the names and ids', async () => {
    const h = setup({ state: { services: { preview: { MADAR_SERVER_TEST: { service: 'madar-server-test', environment: 'production' } }, production: {} } } });
    const { hyperdriveId } = await runSetup(h.run);
    expect(hyperdriveId).toBe('madar-db-test-id');
    expect(writes(h.calls).filter((call) => !call.path.endsWith('/cors'))).toEqual([]);
    const text = h.logs.join('\n');
    expect(text).toContain('CA supabase-root-2021-ca: exists (ca-0001).');
    expect(text).toContain('Hyperdrive madar-db-test: exists (madar-db-test-id).');
    expect(text).toContain('Pages binding MADAR_SERVER_TEST (preview) to madar-server-test: exists.');
  });

  it('uploads the CA when it is missing, as a CA, by its name', async () => {
    const h = setup({ state: { cas: [{ id: 'other', name: 'supabase-root-2021-ca', ca: false }] } });
    await runSetup(h.run);
    expect(writes(h.calls)[0]).toEqual({ method: 'POST', path: '/mtls_certificates', body: { name: 'supabase-root-2021-ca', ca: true, certificates: CA_PEM } });
  });

  it('makes the Hyperdrive config on the session pooler, caching off, verify-full with the CA, limit 10, and never prints the password', async () => {
    const h = setup({ state: { configs: [] } });
    const { hyperdriveId } = await runSetup(h.run);
    expect(hyperdriveId).toBe('made-hyperdrive-id');
    expect(h.calls.find((call) => call.method === 'POST' && call.path === '/hyperdrive/configs')?.body).toEqual({
      name: 'madar-db-test',
      origin: { scheme: 'postgres', host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, database: 'postgres', user: `madar_server.${TEST}`, password: SERVER_PASSWORD },
      caching: { disabled: true },
      mtls: { ca_certificate_id: CA_ID, sslmode: 'verify-full' },
      origin_connection_limit: ORIGIN_CONNECTION_LIMIT,
    });
    expect(h.logs.join('\n')).not.toContain(SERVER_PASSWORD);
    expect(h.logs.join('\n')).toContain('Next: put id = "made-hyperdrive-id" into [[env.test.hyperdrive]] of wrangler.server.toml');
  });

  it('warns about a config that exists but differs, and changes nothing', async () => {
    const h = setup({ state: { configs: [goodConfig('madar-db-test', TEST, { origin: { host: 'aws-1-eu-central-1.pooler.supabase.com', port: 6543, user: `madar_server.${TEST}` }, caching: { disabled: false } })] } });
    await runSetup(h.run);
    expect(h.logs.join('\n')).toMatch(/Warning: Hyperdrive madar-db-test differs from the setup: the origin is not the session pooler .*; caching is on/);
    expect(writes(h.calls).filter((call) => call.path.startsWith('/hyperdrive'))).toEqual([]);
  });

  it('says that wrangler.server.toml already has the id of madar-db-test', async () => {
    const h = setup({ state: { configs: [{ ...goodConfig('madar-db-test', TEST), id: '1c4fc4b830234fad8956b6e80c52f4fc' }] } });
    await runSetup(h.run);
    expect(h.logs.at(-1)).toBe('wrangler.server.toml already binds [env.test] DB to 1c4fc4b830234fad8956b6e80c52f4fc.');
  });

  it('skips R2 with a clear line while R2 is off (error 10042), and goes on to the Pages binding', async () => {
    const h = setup({ state: { r2: 'off' } });
    await runSetup(h.run);
    expect(h.logs.join('\n')).toContain('Skip R2: R2 is not on for the account (error 10042).');
    expect(h.calls.some((call) => call.path === '/pages/projects/madar')).toBe(true);
  });

  it('makes the bucket of the copy in the EU jurisdiction and sets its CORS rule from the file, both with the jurisdiction header', async () => {
    const h = setup({ state: { r2: 'missing' } });
    await runSetup(h.run);
    const r2 = h.calls.filter((call) => call.path.startsWith('/r2/'));
    expect(r2.map((call) => [call.method, call.path, call.headers])).toEqual([
      ['GET', '/r2/buckets/madar-files-test', { 'cf-r2-jurisdiction': 'eu' }],
      ['POST', '/r2/buckets', { 'cf-r2-jurisdiction': 'eu' }],
      ['PUT', '/r2/buckets/madar-files-test/cors', { 'cf-r2-jurisdiction': 'eu' }],
    ]);
    expect(r2[1].body).toEqual({ name: 'madar-files-test' });
    expect(r2[2].body).toEqual(JSON.parse(CORS));
  });

  it('uses the bucket madar-files for production, and skips the CORS rule with a clear line when its file is not there', async () => {
    const h = setup({ target: 'production', answer: 'production', cors: null, state: { r2: 'missing' } });
    await runSetup(h.run);
    expect(h.calls.find((call) => call.method === 'POST' && call.path === '/r2/buckets')?.body).toEqual({ name: 'madar-files' });
    expect(h.logs.join('\n')).toContain('Skip the R2 CORS rule: config/r2-cors.production.json is not in this checkout');
  });

  it('sets the Pages binding of the test copy on the preview environment only, and keeps the other bindings there', async () => {
    const h = setup({ state: { services: { preview: { OTHER: { service: 'other-worker' } }, production: { MADAR_SERVER_PRODUCTION: { service: 'madar-server-production' } } } } });
    await runSetup(h.run);
    const patch = h.calls.find((call) => call.method === 'PATCH')!;
    expect(patch).toEqual({
      method: 'PATCH',
      path: '/pages/projects/madar',
      body: { deployment_configs: { preview: { services: { OTHER: { service: 'other-worker' }, MADAR_SERVER_TEST: { service: 'madar-server-test', environment: 'production' } } } } },
    });
  });

  it('sets the production binding on the production environment only, to the production Worker', async () => {
    const h = setup({ target: 'production', answer: 'production' });
    await runSetup(h.run);
    const patch = h.calls.find((call) => call.method === 'PATCH')!;
    expect(patch.body).toEqual({ deployment_configs: { production: { services: { MADAR_SERVER_PRODUCTION: { service: 'madar-server-production', environment: 'production' } } } } });
    expect(JSON.stringify(h.calls)).not.toContain('madar-server-test');
    expect(JSON.stringify(h.calls)).not.toContain(TEST);
  });

  it('waits for the Worker before the Pages binding, with a clear line', async () => {
    const h = setup({ state: { worker: false } });
    await runSetup(h.run);
    expect(h.calls.some((call) => call.method === 'PATCH')).toBe(false);
    expect(h.logs.join('\n')).toContain('Skip the Pages binding MADAR_SERVER_TEST: the Worker madar-server-test does not exist yet.');
  });

  it('asks for the typed word for production and refuses CI, before any call', async () => {
    const word = setup({ target: 'production', answer: 'yes' });
    await expect(runSetup(word.run)).rejects.toThrow(/typed word/);
    expect(word.asked).toHaveLength(1);
    const ci = setup({ target: 'production', answer: 'production', env: { CI: 'true' } });
    await expect(runSetup(ci.run)).rejects.toThrow(/from the Mac only/);
    expect([word.calls, ci.calls]).toEqual([[], []]);
  });

  it('names the step and the error codes when the API refuses, never a value', async () => {
    const h = setup({ state: { configs: [] } });
    const api = h.run.api;
    h.run.api = (async (path: string, init?: CloudflareInit) => (path === '/hyperdrive/configs' && init?.method === 'POST' ? no(400, 2015, 'Failed to connect to the provided database') : api(path, init))) as CloudflareApi;
    const error = await runSetup(h.run).then(() => '', (e: unknown) => String(e));
    expect(error).toMatch(/refused the Hyperdrive config madar-db-test .*2015 Failed to connect/);
    expect(error).not.toContain(SERVER_PASSWORD);
  });
});

describe('the checks of the setup', () => {
  it('finds each difference of a Hyperdrive config', () => {
    expect(hyperdriveProblems(goodConfig('madar-db-test', TEST), TEST, CA_ID)).toEqual([]);
    expect(hyperdriveProblems({ ...goodConfig('x', TEST), origin_connection_limit: 5, mtls: { sslmode: 'require' } }, TEST, CA_ID)).toEqual([
      'it does not use verify-full with the CA supabase-root-2021-ca', 'the origin connection limit is under 10',
    ]);
    expect(hyperdriveProblems(goodConfig('x', PRODUCTION), TEST, CA_ID)).toEqual([`the user is not madar_server.${TEST}`]);
  });

  it('takes the R2 form of the CORS file and refuses the S3 form', () => {
    expect(corsRulesOf(CORS)).toEqual(JSON.parse(CORS));
    expect(() => corsRulesOf('{"CORSRules":[{"AllowedOrigins":["x"]}]}')).toThrow(/rules array/);
    expect(() => corsRulesOf('{"rules":[{"AllowedOrigins":["x"]}]}')).toThrow(/allowed\.origins/);
  });
});
