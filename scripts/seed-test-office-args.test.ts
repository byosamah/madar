import { describe, expect, it } from 'vitest';
import type { AuthUserInfo } from '../server/core/ports';
import type { Query } from '../server/core/ports';
import { emptyState, type State } from '../src/api/store';
import { buildSeed } from '../src/data/seed';
import { DEPLOY_ACCOUNTS, DEPLOY_ROLES } from '../tests/e2e-deploy/accounts';
import {
  KEEP_TABLES, PLATFORM_SEED_TABLES, PRESENT_SQL, RECORD_DELETES_SQL, SEED_LOCK_TIMEOUT_SQL, SeedRefused, TEST_REF, TRUNCATE_SQL, TRUNCATE_TABLES, parseArgs,
  planText, runSeed, seedAccounts, seedAuthPort, seedTarget, testOffice, type SeedAuth,
} from './seed-test-office';
import { OFFICE_LOCK_KEY } from './first-admin';
import { AUTH_LINK_SQL } from '../server/data/officeCache';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES } from '../server/data/tables';

/** The parts of scripts/seed-test-office.ts that need no stack (task X1). scripts/seed-test-office.test.ts runs it on the local stack. */

const TEST_URL = `https://${TEST_REF}.supabase.co`;
const PASSWORDS = {
  MADAR_TEST_PASSWORD_ADMIN: 'admin-pass-1', MADAR_TEST_PASSWORD_MANAGEMENT: 'management-pass-1',
  MADAR_TEST_PASSWORD_ACCOUNTING: 'accounting-pass-1', MADAR_TEST_PASSWORD_MEMBER: 'member-pass-1',
};
let seedCache: State | undefined;
const seed = async () => (seedCache ??= await buildSeed('2026-10-04', async () => undefined));

describe('seed-test-office: the arguments and the target', () => {
  it('runs on madar-test by default, and --dry-run changes nothing', () => {
    expect(parseArgs([])).toEqual({ target: TEST_URL, dryRun: false });
    expect(parseArgs(['--dry-run'])).toEqual({ target: TEST_URL, dryRun: true });
    expect(parseArgs(['--url', 'http://127.0.0.1:54321'])).toEqual({ target: 'http://127.0.0.1:54321', dryRun: false });
    expect(() => parseArgs(['--env', 'production'])).toThrow(/--env/);
  });

  it('accepts only madar-test, by URL or by ref', () => {
    expect(seedTarget(TEST_URL)).toEqual({ ref: TEST_REF, supabaseUrl: TEST_URL });
    expect(seedTarget(`${TEST_URL}/`)).toEqual({ ref: TEST_REF, supabaseUrl: TEST_URL });
    expect(seedTarget(TEST_REF)).toEqual({ ref: TEST_REF, supabaseUrl: TEST_URL });
  });

  it('refuses the local stack, the production project and every other place', () => {
    for (const target of ['http://127.0.0.1:54321', 'http://localhost:54321', 'oprkvdjudjxxhvodkzgs', 'https://oprkvdjudjxxhvodkzgs.supabase.co',
      'https://abcdefghijabcdefghij.supabase.co', `http://${TEST_REF}.supabase.co`, `https://${TEST_REF}.supabase.co.evil.test`, 'not a url']) {
      expect(() => seedTarget(target), target).toThrow(SeedRefused);
    }
    expect(() => seedTarget('http://127.0.0.1:54321')).toThrow(/runs only on madar-test \(qdgwpnesxppnqsaabqzd\), not on 127\.0\.0\.1:54321/);
  });
});

describe('seed-test-office: the 4 accounts', () => {
  it('names one person of the sample office for each office role, by the sample email', async () => {
    const state = await seed();
    const accounts = seedAccounts(state);
    expect(accounts.map((a) => a.role)).toEqual([...DEPLOY_ROLES]);
    for (const account of accounts) {
      const user = state.users[account.userId];
      expect(user, account.role).toMatchObject({ kind: 'human', active: true, systemRole: account.role, email: account.email });
      // The first person of the sample office with that role.
      const first = Object.values(state.users).find((u) => u.kind === 'human' && u.systemRole === account.role);
      expect(first?.id).toBe(account.userId);
    }
  });

  it('refuses a sample office whose people no longer match the account list', () => {
    const state = emptyState('2026-10-04');
    expect(() => seedAccounts(state)).toThrow(/usr_001.*admin/);
  });
});

describe('seed-test-office: the office of madar-test', () => {
  it('leaves out every agent of the sample office and the posts it wrote: a real agent needs a real approval', async () => {
    const state = await buildSeed('2026-10-04', async () => undefined);
    const agents = Object.values(state.users).filter((u) => u.kind === 'agent').map((u) => u.id);
    expect(agents.length).toBeGreaterThan(0);
    const office = testOffice(state);
    expect(Object.values(office.users).filter((u) => u.kind === 'agent')).toEqual([]);
    for (const id of agents) expect(JSON.stringify(office)).not.toMatch(new RegExp(`\\b${id}\\b`));
    // Every person and every other record stays as the sample office has it.
    expect(Object.keys(office.users)).toEqual(Object.keys(state.users).filter((id) => !agents.includes(id)));
    expect(Object.values(office.updates).every((u) => !agents.includes(u.authorId))).toBe(true);
    expect(Object.keys(office.updates).length).toBe(Object.values(state.updates).filter((u) => !agents.includes(u.authorId)).length);
    expect(office.tasks).toEqual(state.tasks);
    expect(office.counters).toEqual(state.counters);
    expect(seedAccounts(office).map((a) => a.userId)).toEqual(seedAccounts(state).map((a) => a.userId));
    // The sample office itself does not change.
    expect(Object.values(state.users).some((u) => u.kind === 'agent')).toBe(true);
  });

  it('refuses an office where another record still names a left-out agent, so no row points at a person who is not there', async () => {
    const state = await buildSeed('2026-10-04', async () => undefined);
    const agent = Object.values(state.users).find((u) => u.kind === 'agent')!;
    const task = Object.values(state.tasks)[0];
    task.ownerId = agent.id;
    expect(() => testOffice(state)).toThrow(new RegExp(`${agent.id}.*tasks ${task.id}`));
  });
});

describe('seed-test-office: the tables', () => {
  it('empties every office table, the counters and the per-office server tables, and keeps the ones that guard quotas and links', () => {
    const all = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...SERVER_TABLES, ...PLATFORM_SEED_TABLES].sort();
    expect([...TRUNCATE_TABLES, ...KEEP_TABLES].sort()).toEqual(all);
    expect([...KEEP_TABLES].sort()).toEqual(['job_runs', 'mail_log', 'office_deletes', 'office_meta', 'person_seq', 'platform_config', 'usage_month', 'usage_warnings']);
    expect(TRUNCATE_SQL).toBe(`truncate ${TRUNCATE_TABLES.join(', ')} restart identity`);
    expect(TRUNCATE_SQL).not.toMatch(/public\./);
  });

  it('empties the platform table agent_approvals too, so an approval never outlives the agent links of the old office', () => {
    // agent_links goes with the per-office server tables; an approval left behind would let the same client link again.
    expect([...PLATFORM_SEED_TABLES]).toEqual(['agent_approvals']);
    expect(TRUNCATE_TABLES).toContain('agent_approvals');
    expect(TRUNCATE_TABLES).toContain('agent_links');
    expect(KEEP_TABLES).not.toContain('agent_approvals');
  });

  it('records every office row as deleted under one new office version, so a warm office cache drops it', () => {
    for (const spec of TABLES.filter((s) => s.office)) expect(RECORD_DELETES_SQL).toContain(`select '${spec.table}' as tbl, id from ${spec.table}`);
    for (const spec of TABLES.filter((s) => !s.office)) expect(RECORD_DELETES_SQL).not.toContain(`from ${spec.table}`);
    expect(RECORD_DELETES_SQL).toMatch(/^with v as \(update office_meta set version = version \+ 1 returning version\) insert into office_deletes/);
  });
});

// ---------- runSeed with a fake database and a fake Auth ----------

type Fake = { sql: string[]; written: State[]; auth: string[] };

function fakeDb(o: { present?: boolean; busyOn?: string } = {}) {
  const fake: Fake = { sql: [], written: [], auth: [] };
  const present = o.present ?? true;
  const q = (async (text: string, values?: unknown[]) => {
    fake.sql.push(text);
    if (text === o.busyOn) throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    if (text === PRESENT_SQL) return (values![0] as string[]).map((t) => ({ t, present }));
    if (text.startsWith('select ') && text.includes('count(*)')) {
      return [...text.matchAll(/select '([a-z_]+)' as t, count\(\*\)::int as n/g)].map((m) => ({ t: m[1], n: m[1] === 'users' ? 12 : 3 }));
    }
    if (text === AUTH_LINK_SQL) return [{ id: values![0] }];
    return [];
  }) as Query;
  const db = {
    q,
    async tx<T>(work: (inner: Query) => Promise<T>): Promise<T> {
      fake.sql.push('begin');
      try {
        const result = await work(q);
        fake.sql.push('commit');
        return result;
      } catch (error) {
        fake.sql.push('rollback');
        throw error;
      }
    },
  };
  return { fake, db };
}

function fakeAuth(fake: Fake, users: AuthUserInfo[]): SeedAuth {
  let n = 0;
  return {
    async listUsers() {
      fake.auth.push('list');
      return users;
    },
    async createUser(email) {
      fake.auth.push(`create ${email}`);
      n += 1;
      return { authUserId: `00000000-0000-4000-8000-00000000000${n}` };
    },
    async setPassword(authUserId) {
      fake.auth.push(`password ${authUserId}`);
    },
    async deleteUser(authUserId) {
      fake.auth.push(`delete ${authUserId}`);
    },
  };
}

const HALA = '11111111-1111-4111-8111-111111111111';
const STRAY = '22222222-2222-4222-8222-222222222222';
const EXISTING: AuthUserInfo[] = [
  { authUserId: HALA, email: 'hala.nasser@madar.test', confirmed: true },
  { authUserId: STRAY, email: 'invited.last.run@madar.test', confirmed: false },
];

describe('seed-test-office: the dry run', () => {
  it('prints the plan, reads only, and never shows a password', async () => {
    const { fake, db } = fakeDb();
    const lines: string[] = [];
    const result = await runSeed({
      db, auth: fakeAuth(fake, EXISTING), seed: await seed(), ref: TEST_REF, env: PASSWORDS, dryRun: true, lockKey: OFFICE_LOCK_KEY,
      log: (line) => lines.push(line), writeOffice: async (_q, state) => void fake.written.push(state),
    });
    expect(result.changed).toBe(false);
    expect(fake.sql.every((text) => text.startsWith('select ') || text === PRESENT_SQL)).toBe(true);
    expect(fake.written).toEqual([]);
    expect(fake.auth).toEqual(['list']);
    const text = lines.join('\n');
    expect(text).toMatch(/Dry run on madar-test \(qdgwpnesxppnqsaabqzd\)/);
    expect(text).toMatch(/users: 12 rows now, 10 after/);
    expect(text).toMatch(/hala\.nasser@madar\.test \(admin, usr_001\): set a new password on the existing Auth user/);
    expect(text).toMatch(/turki\.al\.otaibi@madar\.test \(management, usr_010\): make a new Auth user/);
    expect(text).toMatch(/Remove 1 other Auth user.*invited\.last\.run@madar\.test/s);
    expect(text).toMatch(/Nothing changed/);
    for (const value of Object.values(PASSWORDS)) expect(text).not.toContain(value);
  });

  it('names the missing password secrets and the missing tables, and still changes nothing', async () => {
    const { fake, db } = fakeDb({ present: false });
    const lines: string[] = [];
    await runSeed({
      db, auth: fakeAuth(fake, []), seed: await seed(), ref: TEST_REF, env: { MADAR_TEST_PASSWORD_ADMIN: 'admin-pass-1' }, dryRun: true,
      lockKey: OFFICE_LOCK_KEY, log: (line) => lines.push(line), writeOffice: async () => undefined,
    });
    const text = lines.join('\n');
    expect(text).toMatch(/The Madar tables are missing/);
    expect(text).toMatch(/MADAR_TEST_PASSWORD_MANAGEMENT, MADAR_TEST_PASSWORD_ACCOUNTING, MADAR_TEST_PASSWORD_MEMBER/);
    expect(fake.sql.every((t) => t === PRESENT_SQL)).toBe(true);
  });
});

describe('seed-test-office: the run', () => {
  it('sets the accounts, then in one transaction under the office lock empties the tables, writes the office and links the accounts, then removes the other Auth users', async () => {
    const { fake, db } = fakeDb();
    const lines: string[] = [];
    const office = await seed();
    const result = await runSeed({
      db, auth: fakeAuth(fake, EXISTING), seed: office, ref: TEST_REF, env: PASSWORDS, dryRun: false, lockKey: OFFICE_LOCK_KEY,
      log: (line) => lines.push(line), writeOffice: async (_q, state) => void fake.written.push(state),
    });
    expect(result.changed).toBe(true);
    expect(fake.auth).toEqual([
      'list', `password ${HALA}`, 'create turki.al.otaibi@madar.test', 'create noura.al.shammari@madar.test', 'create faisal.al.harbi@madar.test',
      `delete ${STRAY}`,
    ]);
    const writes = fake.sql.slice(fake.sql.indexOf('begin'));
    expect(SEED_LOCK_TIMEOUT_SQL).toBe("set local lock_timeout = '5s'");
    expect(writes.slice(0, 5)).toEqual(['begin', SEED_LOCK_TIMEOUT_SQL, 'select pg_advisory_xact_lock($1::bigint)', RECORD_DELETES_SQL, TRUNCATE_SQL]);
    expect(writes.slice(5)).toEqual([AUTH_LINK_SQL, AUTH_LINK_SQL, AUTH_LINK_SQL, AUTH_LINK_SQL, 'commit']);
    expect(fake.written).toEqual([testOffice(office)]);
    expect(Object.values(fake.written[0].users).some((u) => u.kind === 'agent')).toBe(false);
    const text = lines.join('\n');
    expect(text).toMatch(/Seeded madar-test \(qdgwpnesxppnqsaabqzd\)/);
    expect(text).toMatch(/Linked hala\.nasser@madar\.test to usr_001/);
    expect(text).toMatch(/Removed the Auth user invited\.last\.run@madar\.test/);
    for (const value of Object.values(PASSWORDS)) expect(text).not.toContain(value);
  });

  it('refuses before any change when a password secret is missing or too short', async () => {
    for (const env of [{ ...PASSWORDS, MADAR_TEST_PASSWORD_MEMBER: undefined }, { ...PASSWORDS, MADAR_TEST_PASSWORD_ADMIN: 'short' }]) {
      const { fake, db } = fakeDb();
      const error = await runSeed({
        db, auth: fakeAuth(fake, EXISTING), seed: await seed(), ref: TEST_REF, env, dryRun: false, lockKey: OFFICE_LOCK_KEY,
        log: () => undefined, writeOffice: async () => undefined,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SeedRefused);
      expect(String((error as Error).message)).toMatch(/MADAR_TEST_PASSWORD_(MEMBER|ADMIN)/);
      expect(fake.sql).not.toContain('begin');
      expect(fake.auth).toEqual(['list']);
    }
  });

  it('stops with a clear message when madar-test is busy: the tables do not change and no other Auth user goes', async () => {
    // The office lock (pg_advisory_xact_lock) and TRUNCATE wait at most 5 seconds; both give Postgres 55P03 after that.
    for (const busyOn of ['select pg_advisory_xact_lock($1::bigint)', TRUNCATE_SQL]) {
      const { fake, db } = fakeDb({ busyOn });
      const written: State[] = [];
      const error = await runSeed({
        db, auth: fakeAuth(fake, EXISTING), seed: await seed(), ref: TEST_REF, env: PASSWORDS, dryRun: false, lockKey: OFFICE_LOCK_KEY,
        log: () => undefined, writeOffice: async (_q, state) => void written.push(state),
      }).catch((e: unknown) => e);
      expect(error, busyOn).toBeInstanceOf(SeedRefused);
      const message = (error as Error).message;
      expect(message).toMatch(/madar-test is busy/);
      expect(message).toMatch(/The Madar tables did not change/);
      expect(message).toMatch(/4 Auth accounts have their new passwords/);
      expect(message).toMatch(/Run the script again/);
      for (const value of Object.values(PASSWORDS)) expect(message).not.toContain(value);
      const writes = fake.sql.slice(fake.sql.indexOf('begin'));
      expect(writes[1]).toBe(SEED_LOCK_TIMEOUT_SQL);
      expect(writes.at(-1)).toBe('rollback');
      expect(writes).not.toContain('commit');
      if (busyOn !== TRUNCATE_SQL) expect(writes).not.toContain(TRUNCATE_SQL);
      expect(written).toEqual([]);
      expect(fake.auth.some((call) => call.startsWith('delete '))).toBe(false);
    }
  });

  it('passes on every other database error as it is', async () => {
    const { fake, db } = fakeDb();
    const boom = Object.assign(new Error('relation "users" does not exist'), { code: '42P01' });
    const error = await runSeed({
      db, auth: fakeAuth(fake, EXISTING), seed: await seed(), ref: TEST_REF, env: PASSWORDS, dryRun: false, lockKey: OFFICE_LOCK_KEY,
      log: () => undefined, writeOffice: async () => { throw boom; },
    }).catch((e: unknown) => e);
    expect(error).toBe(boom);
    expect(fake.auth.some((call) => call.startsWith('delete '))).toBe(false);
  });

  it('refuses before any change when the Madar tables are missing', async () => {
    const { fake, db } = fakeDb({ present: false });
    const error = await runSeed({
      db, auth: fakeAuth(fake, []), seed: await seed(), ref: TEST_REF, env: PASSWORDS, dryRun: false, lockKey: OFFICE_LOCK_KEY,
      log: () => undefined, writeOffice: async () => undefined,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeedRefused);
    expect(String((error as Error).message)).toMatch(/migrations/);
    expect(fake.sql).not.toContain('begin');
    expect(fake.auth).toEqual(['list']);
  });

  it('refuses every ref but madar-test even when called directly', async () => {
    const { fake, db } = fakeDb();
    await expect(runSeed({
      db, auth: fakeAuth(fake, []), seed: await seed(), ref: 'oprkvdjudjxxhvodkzgs', env: PASSWORDS, dryRun: true, lockKey: OFFICE_LOCK_KEY,
      log: () => undefined, writeOffice: async () => undefined,
    })).rejects.toBeInstanceOf(SeedRefused);
    expect(fake.sql).toEqual([]);
    expect(fake.auth).toEqual([]);
  });
});

describe('seed-test-office: the Auth admin calls', () => {
  it('sets a password with a confirmed email and no ban, and deletes by id, with the secret key and never in an error', async () => {
    const seen: string[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method} ${url} ${new Headers(init?.headers).get('authorization')} ${init?.body ?? ''}`);
      if (init?.method === 'DELETE') return new Response('{"msg":"nope"}', { status: 500 });
      return Response.json({ id: HALA });
    }) as typeof globalThis.fetch;
    const auth = seedAuthPort({ supabaseUrl: TEST_URL, secretKey: 'sb_secret_k', fetch });
    await auth.setPassword(HALA, 'admin-pass-1');
    expect(seen[0]).toBe(`PUT ${TEST_URL}/auth/v1/admin/users/${HALA} Bearer sb_secret_k {"password":"admin-pass-1","email_confirm":true,"ban_duration":"none"}`);
    const error = await auth.deleteUser(STRAY).catch((e: unknown) => e as Error);
    expect(seen[1]).toBe(`DELETE ${TEST_URL}/auth/v1/admin/users/${STRAY} Bearer sb_secret_k `);
    expect(String(error)).toMatch(/500/);
    expect(String(error)).not.toContain('sb_secret_k');
    await expect(auth.setPassword('not-an-id', 'x')).rejects.toThrow(/not an Auth user id/);
  });
});

describe('seed-test-office: the plan text', () => {
  it('lists each table with its rows now and after', () => {
    const text = planText({
      ref: TEST_REF, today: '2026-10-04', dryRun: true, missingTables: [],
      tables: [{ table: 'users', rowsNow: 3, rowsAfter: 11 }, { table: 'mail_log', rowsNow: 5, rowsAfter: 5, kept: true }],
      accounts: [{ ...DEPLOY_ACCOUNTS.admin, secretSet: true, authUserId: null }],
      removeAuth: [], missingSecrets: [], shortSecrets: [],
    });
    expect(text).toMatch(/users: 3 rows now, 11 after/);
    expect(text).toMatch(/mail_log: 5 rows, kept/);
    expect(text).toMatch(/sample office of 2026-10-04/);
  });
});
