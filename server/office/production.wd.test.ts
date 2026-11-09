import { createTestHarness, unstable_readConfig } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildSeed } from '../../src/data/seed';
import type { State } from '../../src/api/store';
import { hashPassword } from '../auth/own/password';
import { testPrivateJwk } from '../auth/own/testKeys';
import { OPS_SECRET_HEADER } from '../entries/officeWorker';
import { importOffice } from '../../scripts/office/import';
import { opsOf } from '../../scripts/office/ops';
import { registerCompany } from '../../scripts/office/register-company';
import { stateSource } from '../../scripts/office/source';
import { ADMIN_SQL, DIRECTORY_SQL } from '../../scripts/office/register-company';
import type { PgQuery } from '../../scripts/office/source';

/**
 * The order of the move of VADO on a Worker shaped like production before the switch (plan E, lead steps L7 to L9): the bindings OFFICE and
 * PLATFORM and the Cron, no MADAR_DATA. It runs the real bundle entry (workerMain.ts) on local workerd:
 *   1. the register script writes the company row and the directory of ent_001, then the import fills ent_001 with the mode empty;
 *   2. a Cron run does nothing, because the word is not office;
 *   3. the word becomes office (scripts/deploy/worker.sh does this at the switch): an imported person signs in with the old password, the token
 *      names ent_001, session.get gives that enterprise, and the Google row and the push device came over.
 */

const TODAY = new Date().toISOString().slice(0, 10);
const NAME = 'madar-production-shape';
const OPS = 'ops-secret-of-this-run';
const EXPORT = 'export-secret-of-this-run';
const JOBS = 'jobs-secret-of-this-run';
const PASSWORD = 'The old password 1';
const AUTH_ID = '9a000000-0000-4000-8000-000000000001';
const ADDRESS = '203.0.113.77';
const BASE = 'https://madar.test';
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

const PUSH_DEVICE = {
  id: 'pdv_001', userId: 'usr_001', endpoint: 'https://fcm.googleapis.com/fcm/send/move-test-1', label: 'iPhone', createdAt: '2026-10-21T08:00:00.000Z',
  lastPushAt: null, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
};
const GOOGLE = {
  id: 'gcn_001', user_id: 'usr_001', sealed_token: 'v1.sealed', calendar_id: 'cal', state: 'ok' as const,
  connected_at: '2026-10-21T08:00:00.000Z', last_error: null, last_error_at: null, changed_at: '2026-10-22T09:30:00.000Z',
};

type Worker = ReturnType<ReturnType<typeof createTestHarness>['getWorker']>;
type WorkerInit = Parameters<Worker['fetch']>[1];

describe('the move of VADO on a Worker shaped like production (plan E)', () => {
  let server: ReturnType<typeof createTestHarness>;
  let state: State;
  let email: string;
  let secrets: Record<string, string>;

  const worker = () => server.getWorker();
  const send = ((url: string, init?: RequestInit) => {
    const target = new URL(url);
    return worker().fetch(`${target.pathname}${target.search}`, init as WorkerInit);
  }) as unknown as typeof fetch;
  const storage = async (binding: 'OFFICE' | 'PLATFORM', name: string) => worker().getDurableObjectStorage(binding, { name });
  const rows = async (binding: 'OFFICE' | 'PLATFORM', name: string, text: string) => (await storage(binding, name)).exec(text);

  /** The Postgres of the production copy, as the register script reads it: the people of the sample office and their sign-in. */
  const postgres: PgQuery = async (text) => {
    const humans = Object.values(state.users).filter((user) => user.kind === 'human');
    if (text === DIRECTORY_SQL.people) return humans.map((user) => ({ id: user.id, email: user.email, name: user.name }));
    if (text === DIRECTORY_SQL.linked) return [{ email }];
    if (text === ADMIN_SQL) return [{ name: state.users.usr_001.name, email }];
    return [];
  };

  beforeAll(async () => {
    state = { ...(await buildSeed(TODAY, async () => undefined)), pushDevices: { [PUSH_DEVICE.id]: PUSH_DEVICE } } as State;
    email = state.users.usr_001.email;
    secrets = {
      MADAR_OPS_SECRET: OPS, MADAR_EXPORT_SECRET: EXPORT, JOBS_SECRET: JOBS, MADAR_AUTH_PRIVATE_JWK: await testPrivateJwk(),
      MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', RESEND_API_KEY: 're_test_not_a_key', R2_ACCOUNT_ID: '0'.repeat(32), R2_ACCESS_KEY_ID: 'test-not-a-key', R2_SECRET_ACCESS_KEY: 'test-not-a-key',
    };
    server = createTestHarness({
      workers: [{ configPath: new URL('./test/live/wrangler.production.toml', import.meta.url), secrets, bindingOverrides: { SELF: NAME } }],
    });
    await server.listen();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
  });

  it('is shaped like [env.production] of wrangler.server.toml: the same bindings, migrations, Cron and SELF, and no MADAR_DATA', () => {
    const file = fileURLToPath(new URL('../../wrangler.server.toml', import.meta.url));
    const production = unstable_readConfig({ config: file, env: 'production' }, { hideWarnings: true });
    const shaped = unstable_readConfig({ config: fileURLToPath(new URL('./test/live/wrangler.production.toml', import.meta.url)) }, { hideWarnings: true });
    expect(shaped.durable_objects.bindings).toEqual(production.durable_objects.bindings);
    expect(shaped.migrations).toEqual(production.migrations);
    expect(shaped.triggers.crons).toEqual(production.triggers.crons);
    expect(shaped.services?.map((one: { binding: string }) => one.binding)).toEqual(production.services?.map((one: { binding: string }) => one.binding));
    expect(shaped.vars.MADAR_CRON_TRANSPORT).toBe(production.vars.MADAR_CRON_TRANSPORT);
    expect(shaped.vars.MADAR_DATA).toBeUndefined();
    expect(production.vars.MADAR_DATA).toBeUndefined();
  });

  it('registers ent_001, imports into it with the mode empty, and the Cron does nothing while the word is not office', async () => {
    const signin = [{ id: AUTH_ID, email, password_hash: await hashPassword(PASSWORD), email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' }];
    const source = stateSource(state, { signin, server: { googleConnections: [GOOGLE] } });

    // The problem that this order solves: the import before the register is refused (the platform does not list ent_001), and it makes no object.
    const early = opsOf({ base: BASE, secret: OPS, header: OPS_SECRET_HEADER, office: 'ent_001', fetch: send });
    await expect(importOffice(early, source, { mode: 'empty', limit: NO_LIMIT })).rejects.toThrow(/answered 403/);
    expect(await worker().listDurableObjectIds('OFFICE')).toEqual([]);

    // Step 1: the company row and the directory. A second run is safe, and a pause by the platform in between survives it.
    const lines: string[] = [];
    await registerCompany({ base: BASE, secret: OPS, query: postgres, send, log: (line) => lines.push(line) });
    expect(await rows('PLATFORM', 'platform', "select id, address, name, name_ar, state, limits from enterprises")).toEqual([
      { id: 'ent_001', address: 'vados', name: "VADOs' Companies", name_ar: 'شركات فادو', state: 'active', limits: JSON.stringify({ people: null, storageBytes: null }) },
    ]);
    const humans = Object.values(state.users).filter((user) => user.kind === 'human').length;
    expect(await rows('PLATFORM', 'platform', "select count(*) as n from emails where ent = 'ent_001'")).toEqual([{ n: humans }]);
    expect(lines.join('\n')).not.toContain('@');
    await registerCompany({ base: BASE, secret: OPS, query: postgres, send });
    expect(await rows('PLATFORM', 'platform', 'select count(*) as n from enterprises')).toEqual([{ n: 1 }]);
    expect(await rows('PLATFORM', 'platform', "select count(*) as n from emails where ent = 'ent_001'")).toEqual([{ n: humans }]);

    // Step 2: the import into ent_001, mode empty. The platform list holds the id, so the op takes the name.
    const report = await importOffice(opsOf({ base: BASE, secret: OPS, header: OPS_SECRET_HEADER, office: 'ent_001', fetch: send }), source, { mode: 'empty', limit: NO_LIMIT });
    expect(report.records).toBe(source.records);
    expect(await rows('OFFICE', 'ent_001', "select id, state from enterprise")).toEqual([{ id: 'ent_001', state: 'active' }]);
    expect(await rows('OFFICE', 'ent_001', 'select count(*) as n from tasks')).toEqual([{ n: Object.keys(state.tasks).length }]);

    // Step 3: a Cron run with no MADAR_DATA. No leg, no status row, no job row, no object work.
    const before = {
      jobs: await rows('OFFICE', 'ent_001', 'select count(*) as n from job_runs'),
      outbox: await rows('OFFICE', 'ent_001', 'select count(*) as n from outbox'),
      status: await rows('PLATFORM', 'platform', 'select count(*) as n from status'),
    };
    await worker().scheduled({ cron: '*/15 * * * *', scheduledTime: new Date() });
    expect({
      jobs: await rows('OFFICE', 'ent_001', 'select count(*) as n from job_runs'),
      outbox: await rows('OFFICE', 'ent_001', 'select count(*) as n from outbox'),
      status: await rows('PLATFORM', 'platform', 'select count(*) as n from status'),
    }).toEqual(before);
    expect(before.status).toEqual([{ n: 0 }]);
  }, 300_000);

  it('after the word becomes office: the imported person signs in with the old password, the token names ent_001, session.get gives ent_001, the Cron runs, and the Google and push rows are there', async () => {
    await server.update((current) => ({
      ...current,
      workers: current.workers.map((one) => ('configPath' in one ? { ...one, vars: { MADAR_DATA: 'office' } } : one)),
    }));
    const signIn = await worker().fetch('/api/auth/token', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-madar-client-address': ADDRESS },
      body: JSON.stringify({ grant_type: 'password', email, password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);
    const { access_token: token } = (await signIn.json()) as { access_token: string };
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { ent?: string; sub?: string };
    expect(claims).toMatchObject({ ent: 'ent_001', sub: AUTH_ID });

    const batch = await worker().fetch('/api/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-madar-build': '2999.1.1', 'x-madar-client-address': ADDRESS },
      body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] }),
    });
    expect(batch.status).toBe(200);
    const answer = (await batch.json()) as { results: { ok: boolean; output?: { enterprise?: { id: string; name: string } } }[] };
    expect(answer.results[0].ok).toBe(true);
    // The name in the header comes from the Settings of the office (an absent name stays Madar), not from the platform row.
    expect(answer.results[0].output?.enterprise).toMatchObject({ id: 'ent_001' });

    expect(await rows('OFFICE', 'ent_001', 'select id, user_id, state from google_connections')).toEqual([{ id: 'gcn_001', user_id: 'usr_001', state: 'ok' }]);
    expect(await rows('OFFICE', 'ent_001', 'select id, user_id from push_devices')).toEqual([{ id: 'pdv_001', user_id: 'usr_001' }]);

    // Control for the Cron check of the first test: with the word office, the same Cron call reaches the object and writes the status row.
    await worker().scheduled({ cron: '*/15 * * * *', scheduledTime: new Date() });
    expect(await rows('PLATFORM', 'platform', "select count(*) as n from status where ent = 'ent_001'")).toEqual([{ n: 1 }]);
  }, 300_000);
});
