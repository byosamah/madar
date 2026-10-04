import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { verifyBrowserToken } from '../server/auth/verify';
import { setEnvSource } from '../server/env';
import { authOf, localStack, PASSWORD } from '../server/it/authStack';
import { applyMigrations, dropSchema, localClient } from '../server/it/migrate';
import { clientDb, FirstAdminRefused, makeFirstAdmin } from './first-admin';

/**
 * Task P3 on the local stack [Docker]: a run makes one Admin with the given language and gender, and a second run refuses and
 * makes nothing. The office is the non-platform migrations in a schema of its own; Auth is the real local Auth.
 * server/it/auth.it.test.ts runs the command line twice.
 */

const stack = localStack();
const auth = authOf(stack, 'p3');
const schema = `madar_p3_${process.pid}`;
const NOW = new Date('2026-10-04T06:00:00Z');
let client: pg.Client;

beforeAll(async () => {
  client = await localClient();
  await applyMigrations(client, schema);
  await client.query(`set search_path to ${schema}`);
}, 60_000);

afterAll(async () => {
  setEnvSource(undefined);
  await auth.cleanup();
  await dropSchema(client, schema);
  await client.end();
});

describe('first-admin on the local stack', () => {
  it('makes usr_001, an Admin with the language and gender, the counter, the user.created event and the sign-in link', async () => {
    const email = auth.email('hala');
    const made = await makeFirstAdmin(
      { db: clientDb(client), authAdmin: auth.admin, now: NOW, lockKey: 7_340_001 },
      { email, name: 'هالة ناصر', language: 'ar', gender: 'female', discipline: 'Admin', password: PASSWORD },
    );
    expect(made.userId).toBe('usr_001');
    const rows = (await client.query('select doc, auth_user_id::text as auth from users')).rows as { doc: Record<string, unknown>; auth: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].doc).toMatchObject({ id: 'usr_001', email, systemRole: 'admin', kind: 'human', active: true, gender: 'female', preferences: { language: 'ar' } });
    expect(rows[0].auth).toBe(made.authUserId);
    expect((await client.query("select n from counters where prefix = 'usr'")).rows).toEqual([{ n: 1 }]);
    const events = (await client.query('select doc from events')).rows as { doc: Record<string, unknown> }[];
    expect(events.map((e) => [e.doc.verb, e.doc.actorId, e.doc.targetId])).toEqual([['user.created', 'usr_001', 'usr_001']]);
    expect((await client.query('select actor_id from stories where id = $1', [events[0].doc.correlationId])).rows).toEqual([{ actor_id: 'usr_001' }]);

    // The Admin signs in with the password, and the token passes the server's check as that Auth user.
    setEnvSource({ SUPABASE_URL: stack.apiUrl });
    const signedIn = await auth.signIn(email);
    expect(signedIn.status).toBe(200);
    await expect(verifyBrowserToken(`Bearer ${auth.tokenOf(signedIn)}`)).resolves.toEqual({ authUserId: made.authUserId });
  });

  it('refuses a second run before any change: no second Auth user, no second person', async () => {
    const email = auth.email('second');
    const error = await makeFirstAdmin(
      { db: clientDb(client), authAdmin: auth.admin, now: NOW, lockKey: 7_340_001 },
      { email, name: 'Second', language: 'en', gender: 'male', discipline: 'Admin', password: PASSWORD },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FirstAdminRefused);
    expect(String((error as Error).message)).toMatch(/An Admin exists/);
    expect((await auth.admin.listUsers()).some((user) => user.email === email)).toBe(false);
    expect((await client.query('select count(*)::int as n from users')).rows).toEqual([{ n: 1 }]);
  });
});
