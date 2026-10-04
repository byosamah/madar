import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { State } from '../src/api/store';
import { buildSeed } from '../src/data/seed';
import type { AuthUserInfo, Query } from '../server/core/ports';
import { createOfficeCache } from '../server/data/officeCache';
import { TABLES } from '../server/data/tables';
import { loadWhole } from '../server/data/whole';
import { authOf, localStack, type Stack } from '../server/it/authStack';
import { applyMigrations, dropSchema, localClient } from '../server/it/migrate';
import { DEPLOY_ACCOUNTS, DEPLOY_ROLES } from '../tests/e2e-deploy/accounts';
import { clientDb } from './first-admin';
import { runSeed, seedAuthPort, TEST_REF, type SeedAuth } from './seed-test-office';

/**
 * Task X1 on the local stack [Docker]: the seed writes the sample office, makes and links the 4 accounts, removes the other Auth
 * users, and a second run over a changed office leaves exactly the sample office again, also in a warm office cache. The office is
 * the non-platform migrations in a schema of its own; Auth is the real local Auth. runSeed takes the madar-test ref as its guard
 * and gets the local database and Auth from the test, which the command line never does (it refuses the local stack).
 *
 * It runs only with MADAR_IT=1 (npm run test:it, after the merge lead adds it to DOCKER_SCRIPT_TESTS of vite.config.ts).
 */

const ON = process.env.MADAR_IT === '1';
const TODAY = '2026-10-04';
const LOCK_KEY = 7_350_001;
const run = `x1-${randomUUID().slice(0, 8)}`;
const EMAILS = new Set(DEPLOY_ROLES.map((role) => DEPLOY_ACCOUNTS[role].email));
const ENV = Object.fromEntries(DEPLOY_ROLES.map((role) => [DEPLOY_ACCOUNTS[role].passwordSecret, `Madar-local-${role}-pass-1`]));
const schema = `madar_x1_${process.pid}`;

let stack: Stack;
let client: pg.Client;
let auth: SeedAuth;
let seed: State;
const lines: string[] = [];

/** Auth as the seed sees it: only the 4 accounts and the users of this run, so the shared local Auth keeps everyone else. */
function scopedAuth(real: SeedAuth): SeedAuth {
  return { ...real, listUsers: async () => (await real.listUsers()).filter((u) => u.email && (EMAILS.has(u.email) || u.email.startsWith(`${run}-`))) };
}

const q = (async (text: string, values?: unknown[]) => (await client.query(text, values)).rows) as Query;
const seedOnce = () => runSeed({
  db: clientDb(client), auth, seed, ref: TEST_REF, env: ENV, dryRun: false, lockKey: LOCK_KEY, log: (line) => lines.push(line),
});
const accounts = async (): Promise<AuthUserInfo[]> => (await auth.listUsers()).filter((u) => EMAILS.has(u.email ?? ''));

beforeAll(async () => {
  if (!ON) return;
  stack = localStack();
  auth = scopedAuth(seedAuthPort({ supabaseUrl: stack.apiUrl, secretKey: stack.secretKey }));
  client = await localClient();
  await applyMigrations(client, schema);
  await client.query(`set search_path to ${schema}`);
  seed = await buildSeed(TODAY, async () => undefined);
}, 60_000);

afterAll(async () => {
  if (!ON) return;
  for (const user of await auth.listUsers()) await auth.deleteUser(user.authUserId);
  await dropSchema(client, schema);
  await client.end();
});

describe.skipIf(!ON)('seed-test-office on the local stack', () => {
  it('writes the sample office, makes and links the 4 accounts, and removes the other Auth users', async () => {
    const orphan = await auth.createUser(`${run}-orphan@madar.test`, 'Madar-local-orphan-1');
    const result = await seedOnce();
    expect(result.changed).toBe(true);

    const back = await loadWhole(q, { today: TODAY });
    for (const spec of TABLES) {
      const want = spec.collection === 'settings' ? seed.settings : (seed[spec.collection] ?? {});
      expect(back[spec.collection], spec.table).toEqual(want);
    }
    expect(back.counters).toEqual(seed.counters);

    const made = await accounts();
    expect(made.map((u) => u.email).sort()).toEqual([...EMAILS].sort());
    expect(made.every((u) => u.confirmed)).toBe(true);
    const links = (await client.query('select id, auth_user_id::text as auth from users where auth_user_id is not null order by id')).rows;
    expect(links).toEqual(DEPLOY_ROLES.map((role) => DEPLOY_ACCOUNTS[role])
      .map((a) => ({ id: a.userId, auth: made.find((u) => u.email === a.email)!.authUserId }))
      .sort((a, b) => a.id.localeCompare(b.id)));
    expect((await auth.listUsers()).some((u) => u.authUserId === orphan.authUserId)).toBe(false);

    // Each account signs in with the password of its secret.
    const signIn = authOf(stack, run).signIn;
    for (const role of DEPLOY_ROLES) {
      const answer = await signIn(DEPLOY_ACCOUNTS[role].email, ENV[DEPLOY_ACCOUNTS[role].passwordSecret]);
      expect(answer.status, role).toBe(200);
    }
    expect(lines.join('\n')).not.toMatch(/Madar-local-/);
  });

  it('a second run over a changed office leaves the sample office again, keeps the Auth users, and a warm office cache drops the stray rows', async () => {
    const before = await accounts();
    const cache = createOfficeCache();
    const deps = { db: clientDb(client), meter: { addBytes() {}, async countRequest() {}, signalsFailed() {} } } as never;
    const stray = { ...seed.users.usr_002, id: 'usr_099', name: 'Stray Person', email: 'stray@madar.test' };
    await client.query(
      'with v as (update office_meta set version = version + 1 returning version) insert into users (id, doc, chg) select $1, $2::jsonb, v.version from v',
      ['usr_099', JSON.stringify(stray)],
    );
    await client.query("insert into stories (id, actor_id) values ('sty_stray', 'usr_099')");
    expect(Object.keys((await cache.read(deps, q)).lists.users)).toContain('usr_099');
    const { rows: [{ version: v1 }] } = await client.query('select version from office_meta');

    await seedOnce();

    const warm = await cache.read(deps, q);
    expect(Object.keys(warm.lists.users)).toEqual(Object.keys(seed.users));
    expect(warm.lists.projects).toEqual(seed.projects);
    expect(Number((await client.query('select version from office_meta')).rows[0].version)).toBeGreaterThan(Number(v1));
    expect((await client.query('select count(*)::int as n from stories')).rows).toEqual([{ n: 0 }]);
    expect((await client.query('select count(*)::int as n from events')).rows).toEqual([{ n: Object.keys(seed.events).length }]);
    const after = await accounts();
    expect(after.map((u) => u.authUserId).sort()).toEqual(before.map((u) => u.authUserId).sort());
  });
});
