import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WireEntry, WireResponse } from '../../src/api/remote/wire';
import { createForgotRoute } from '../auth/forgot';
import { setEnvSource } from '../env';
import { apiApp } from '../http/app';
import { authOf, linkIn, localStack, PASSWORD } from './authStack';
import { applyMigrations, dropSchema, localClient } from './migrate';
import { startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 3 of TM 7, sign-in, on the local stack (plan 5.1; task P2) [Docker]: the real api app with the real token check, person
 * lookup and runCall, on the sample office as madar_server, with Supabase Auth of the local stack. Mail goes to the fake.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const stack = localStack();
const auth = authOf(stack, 'p2auth');

let office: ItOffice;
let deps: ReturnType<ItOffice['isolate']>;
let app: ReturnType<typeof apiApp>;
const tokens: Record<string, string> = {};

/**
 * Gives a person of the sample office an Auth user with an email of this run: the users row takes the same email and the link,
 * with a new office version, as the save step and setAuthUserId write them (plan 4.7).
 */
const RELINK_SQL =
  "with v as (update office_meta set version = version + 1 returning version) update users set doc = jsonb_set(doc, '{email}', to_jsonb($2::text)), auth_user_id = $3::uuid, chg = (select version from v) where id = $1";

async function link(userId: string, label: string): Promise<string> {
  const email = auth.email(label);
  const { authUserId } = await auth.admin.createUser(email, PASSWORD);
  await office.sql(RELINK_SQL, [userId, email, authUserId]);
  const signedIn = await auth.signIn(email);
  expect(signedIn.status).toBe(200);
  tokens[userId] = auth.tokenOf(signedIn);
  return email;
}

async function batch(token: string | null, calls: { name: string; input: unknown }[]): Promise<Response> {
  return app.fetch(new Request('http://127.0.0.1/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ v: 1, calls: calls.map((call, i) => ({ i, ...call })) }),
  }));
}

async function entry(token: string, name: string, input: unknown = {}): Promise<WireEntry> {
  const response = await batch(token, [{ name, input }]);
  expect(response.status).toBe(200);
  return ((await response.json()) as WireResponse).results[0];
}

const forgot = (email: string, ip: string) => app.fetch(new Request('http://127.0.0.1/auth/forgot', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ email }),
}));

beforeAll(async () => {
  setEnvSource({ SUPABASE_URL: stack.apiUrl });
  office = await startOffice('p2auth');
  deps = office.isolate();
  deps.authAdmin = auth.admin as unknown as typeof deps.authAdmin;
  app = apiApp(deps, { routes: [{ method: 'POST', path: '/auth/forgot', handler: createForgotRoute({ minMs: 0 }) }] });
  await link('usr_001', 'admin');
  await link('usr_002', 'member');
  await link('usr_005', 'sara');
}, 60_000);

afterAll(async () => {
  setEnvSource(undefined);
  await auth.cleanup();
  await office?.close();
});

describe('suite 3: sign-in on the local stack', () => {
  it('signs in with email and password, and the token runs calls as the linked person', async () => {
    const result = await entry(tokens.usr_001, 'session.get');
    expect(result).toMatchObject({ ok: true, output: { user: { id: 'usr_001', systemRole: 'admin' } } });
  });

  it('refuses open sign-up', async () => {
    const answer = await auth.auth('POST', '/signup', { body: { email: auth.email('signup'), password: PASSWORD } });
    expect([answer.status, auth.codeOf(answer)]).toEqual([422, 'signup_disabled']);
  });

  it('answers 401 with no token and with a bad token, before any call runs', async () => {
    for (const token of [null, 'not-a-token']) {
      const response = await batch(token, [{ name: 'session.get', input: {} }]);
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
    }
  });

  it('takes the role from the users row, not from the token: the same token gets more rights after a role change', async () => {
    const before = await entry(tokens.usr_002, 'users.invites');
    expect(before).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await entry(tokens.usr_001, 'users.update', { id: 'usr_002', patch: { systemRole: 'management' } })).toMatchObject({ ok: true });
    const after = await entry(tokens.usr_002, 'users.invites');
    expect(after).toMatchObject({ ok: true });
    expect(await entry(tokens.usr_001, 'users.update', { id: 'usr_002', patch: { systemRole: 'member' } })).toMatchObject({ ok: true });
  });

  it('gives a turned-off person\'s valid token 403 account_off on the next call, and Auth bans the person', async () => {
    expect(await entry(tokens.usr_001, 'users.deactivate', { id: 'usr_005' })).toMatchObject({ ok: true });
    const response = await batch(tokens.usr_005, [{ name: 'session.get', input: {} }]);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthenticated', details: { reason: 'account_off' } } });
    const banned = await auth.signIn(auth.email('sara'));
    expect([banned.status, auth.codeOf(banned)]).toEqual([400, 'user_banned']);
    // On again: the ban goes, and the person signs in.
    expect(await entry(tokens.usr_001, 'users.reactivate', { id: 'usr_005' })).toMatchObject({ ok: true });
    expect((await auth.signIn(auth.email('sara'))).status).toBe(200);
  });

  it('forgot: the same answer for a person and an unknown email, a reset mail that works, and 429 after 3 in one window for one email', async () => {
    const member = auth.email('member');
    const sent = deps.mail.sent.length;
    const known = await forgot(member, '198.51.100.1');
    const unknown = await forgot(auth.email('nobody'), '198.51.100.1');
    expect([known.status, await known.text()]).toEqual([unknown.status, await unknown.text()]);
    expect(known.status).toBe(200);
    const mail = deps.mail.sent[sent];
    expect(deps.mail.sent).toHaveLength(sent + 1);
    expect(mail.subject).toBe('Reset your Madar password');
    // S1: the reset mail counts against the daily mail quota as sign-in mail.
    expect(await office.sql<{ kind: string }>('select kind from mail_log where ref = $1', [mail.idempotencyKey])).toEqual([{ kind: 'signin' }]);
    const resetLink = linkIn(mail.text);
    expect(resetLink.pathname).toBe('/reset');
    const used = await auth.useLink('recovery', resetLink.searchParams.get('token_hash')!);
    expect(used.status).toBe(200);
    expect(await auth.setPassword(auth.tokenOf(used), 'Madar-local-new-pass-2')).toBe(200);
    expect((await auth.signIn(auth.email('member'), 'Madar-local-new-pass-2')).status).toBe(200);

    for (let i = 0; i < 2; i += 1) expect((await forgot(member, `198.51.100.${10 + i}`)).status).toBe(200);
    const over = await forgot(member, '198.51.100.20');
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await over.json()).error.details.reason).toBe('too_many_resets_email');
    const keys = await office.sql<{ key: string }>('select key from rate_limits');
    expect(keys.some((row) => row.key.includes('@'))).toBe(false);
  });

  it('first-admin.ts run twice on an empty office makes one Admin', async () => {
    const schema = `madar_p2fa_${process.pid}`;
    const admin = await localClient();
    await applyMigrations(admin, schema);
    const run = (email: string) => new Promise<{ code: number; out: string }>((resolve) => {
      const child = execFile('npx', ['tsx', 'scripts/first-admin.ts', '--env', 'local', '--schema', schema, '--email', email, '--name', 'Hala', '--language', 'en', '--gender', 'female', '--password-stdin'], { cwd: ROOT }, (error, stdout, stderr) => {
        resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` });
      });
      child.stdin?.end(`${PASSWORD}\n`);
    });
    try {
      const first = await run(auth.email('first'));
      expect(first).toMatchObject({ code: 0 });
      expect(first.out).toContain('Made the first Admin usr_001');
      const second = await run(auth.email('again'));
      expect(second.code).toBe(1);
      expect(second.out).toContain('An Admin exists');
      expect((await admin.query(`select id, doc->>'systemRole' as role from ${schema}.users`)).rows).toEqual([{ id: 'usr_001', role: 'admin' }]);
    } finally {
      await dropSchema(admin, schema);
      await admin.end();
    }
  }, 60_000);
});
