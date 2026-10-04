import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { After, RequestHost } from '../core/after';
import { processOutbox, writeOutbox } from '../core/effects';
import { LOCK_SQL } from '../core/lock';
import type { Mail } from '../core/ports';
import { AUTH_LINK_SQL } from '../data/officeCache';
import { apiApp } from '../http/app';
import { ROUTES } from '../http/routes';
import { memoryMailDb } from '../mail/memoryMailDb';
import { QUOTA_LIMITS } from '../mail/quota';
import { fakeDeps } from '../test/fakes/deps';
import './effects';
import { fakeAuth } from './fakeAuth';
import { inviteRow, NEWER_LINK_SQL, PAYLOAD_MERGE_SQL, PERSON_SQL, RENEW_KEY_SQL, RENEW_PARAM, SENT_SQL } from './invite';
import { RATE_SQL } from './rateLimit';
import { createRenewRoute, RENEW_IP_PER_HOUR, RENEW_KEY_PER_HOUR, RENEW_PATH, RENEW_PERSON_PER_DAY, RENEW_ROW_SQL } from './renew';

/** POST /api/auth/renew-invite (security fix 7). server/it/renew.it.test.ts runs it on the local stack with the real Auth. */

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type Row = { doc: User; auth: string | null };
type Rec = Record<string, unknown>;

/** The users rows, the outbox, the quota and the rate limits in memory, on the mail database of N2. */
function memoryDb(users: Record<string, Row>) {
  const rates = new Map<string, number>();
  const statements: { text: string; values: unknown[] }[] = [];
  const mem = memoryMailDb((text, values) => {
    statements.push({ text, values });
    const byInvite = (id: unknown) => mem.outbox.find((r) => r.payload.inviteId === id);
    const linkKinds = ['auth.invite', 'auth.email'];
    if (text === RATE_SQL) {
      const id = `${values[0]}|${values[1]}`;
      rates.set(id, (rates.get(id) ?? 0) + 1);
      return [{ count: rates.get(id) }];
    }
    if (text === LOCK_SQL) return [];
    if (text === RENEW_ROW_SQL) {
      const found = mem.outbox
        .filter((r) => linkKinds.includes(r.kind) && ((r.payload.renewKeys as string[] | undefined) ?? []).includes(String(values[0])))
        .sort((a, b) => b.id - a.id)[0];
      return found ? [{ id: String(found.id), user_id: found.payload.userId, invite_id: found.payload.inviteId, renewed: 'renewedAt' in found.payload }] : [];
    }
    if (text === PERSON_SQL) {
      const row = users[String(values[0])];
      return row ? [{ doc: row.doc, auth: row.auth }] : [];
    }
    if (text === NEWER_LINK_SQL) {
      const mine = byInvite(values[1]);
      const newer = mem.outbox.some((r) => linkKinds.includes(r.kind) && r.payload.userId === values[0] && 'linkType' in r.payload && mine !== undefined && r.id > mine.id);
      return newer ? [{ found: 1 }] : [];
    }
    if (text === PAYLOAD_MERGE_SQL) {
      const row = byInvite(values[0]);
      if (row) Object.assign(row.payload, JSON.parse(String(values[1])) as Rec);
      return [];
    }
    if (text === SENT_SQL) {
      const row = byInvite(values[0]);
      if (row) {
        delete row.payload.tokenHash;
        Object.assign(row.payload, JSON.parse(String(values[1])) as Rec);
      }
      return [];
    }
    if (text === RENEW_KEY_SQL) {
      const row = byInvite(values[0]);
      const keys = (row?.payload.renewKeys as string[] | undefined) ?? [];
      if (row && !keys.includes(String(values[1]))) row.payload.renewKeys = [...keys, String(values[1])];
      return [];
    }
    if (text === AUTH_LINK_SQL) {
      users[String(values[0])].auth = String(values[1]);
      return [{ id: values[0] }];
    }
    return undefined;
  });
  return { mem, rates, statements };
}

const keyIn = (mail: Mail) => new URL(/https:\/\/madar\.test\/\S+/.exec(mail.text)![0]).searchParams.get(RENEW_PARAM)!;
const tokenIn = (mail: Mail) => new URL(/https:\/\/madar\.test\/\S+/.exec(mail.text)![0]).searchParams.get('token_hash')!;
const OK = JSON.stringify({ v: 1, ok: true });

async function setup(o: { host?: () => RequestHost } = {}) {
  const auth = fakeAuth();
  const users: Record<string, Row> = {
    usr_002: { doc: seed.users.usr_002, auth: null },
    usr_005: { doc: { ...seed.users.usr_005, preferences: { ...seed.users.usr_005.preferences, language: 'ar' } }, auth: null },
  };
  const db = memoryDb(users);
  const deps = fakeDeps({ db: db.mem.db, config: { appUrl: 'https://madar.test' } });
  deps.authAdmin = auth;
  const slept: number[] = [];
  const route = createRenewRoute({ minMs: 0, sleep: async (ms) => void slept.push(ms), host: o.host });
  const app = apiApp(deps, { routes: [{ method: 'POST', path: RENEW_PATH, handler: route }] });
  let n = 0;
  const post = (body: unknown, ip = `203.0.113.${(n += 1)}`) =>
    app.fetch(new Request(`http://127.0.0.1${RENEW_PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
  /** The Admin invites the person: the auth.invite row and its effect, as users.create does. Gives the mail. */
  const invite = async (userId: string) => {
    const ids = await db.mem.db.tx('write', (q) => writeOutbox(q, [inviteRow(userId)]));
    await processOutbox(deps, ids);
    return deps.mail.sent.at(-1)!;
  };
  return { auth, db, deps, invite, post, route, slept, users };
}

describe('POST /auth/renew-invite (security fix 7)', () => {
  it('is mounted on the api function', () => {
    expect(ROUTES.some((route) => route.method === 'POST' && route.path === RENEW_PATH)).toBe(true);
  });

  it('a good key sends a new invitation to the same person, at the address Madar holds, with a new link and a new key', async () => {
    const { auth, db, deps, invite, post } = await setup();
    const first = await invite('usr_002');
    const response = await post({ key: keyIn(first) });
    expect([response.status, await response.text()]).toEqual([200, OK]);
    expect(deps.mail.sent).toHaveLength(2);
    const renewed = deps.mail.sent[1];
    expect(renewed).toMatchObject({ to: 'faisal.al.harbi@madar.test', subject: 'Your invitation to Madar', tag: 'invite' });
    expect(auth.links.map((link) => link.type)).toEqual(['invite', 'invite']);
    expect(tokenIn(renewed)).toBe(auth.links[1].tokenHash);
    expect(keyIn(renewed)).not.toBe(keyIn(first));
    // The renewal counts against the daily mail quota as sign-in mail.
    expect(db.mem.log.map((row) => [row.kind, row.user_id])).toEqual([['signin', 'usr_002']]);
    // The first row is marked, so its key works once.
    expect(db.mem.outbox[0].payload).toHaveProperty('renewedAt');
  });

  it('gives the same answer and sends nothing for an unknown key, a used key, a removed person, an accepted person, and a key that a newer invitation replaced', async () => {
    type Case = (o: Awaited<ReturnType<typeof setup>>) => Promise<string>;
    const cases: Record<string, Case> = {
      unknown: async () => 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst',
      used: async ({ invite, post }) => {
        const key = keyIn(await invite('usr_002'));
        expect((await post({ key })).status).toBe(200);
        return key;
      },
      removed: async ({ invite, users }) => {
        const key = keyIn(await invite('usr_002'));
        users.usr_002.doc = { ...users.usr_002.doc, active: false };
        return key;
      },
      accepted: async ({ auth, invite, users }) => {
        const key = keyIn(await invite('usr_002'));
        auth.accept(users.usr_002.auth!);
        return key;
      },
      replaced: async ({ invite }) => {
        const key = keyIn(await invite('usr_002'));
        await invite('usr_002');
        return key;
      },
    };
    const answers: string[] = [];
    for (const [name, prepare] of Object.entries(cases)) {
      const o = await setup();
      const key = await prepare(o);
      const [sent, links] = [o.deps.mail.sent.length, o.auth.links.length];
      const response = await o.post({ key });
      answers.push(`${response.status} ${await response.text()}`);
      expect([name, o.deps.mail.sent.length, o.auth.links.length]).toEqual([name, sent, links]);
    }
    expect(new Set(answers)).toEqual(new Set([`200 ${OK}`]));
  });

  it('never takes an address from the request: an email in the body changes nothing', async () => {
    const { deps, invite, post } = await setup();
    const key = keyIn(await invite('usr_002'));
    expect((await post({ key, email: 'someone.else@example.test', to: 'someone.else@example.test' })).status).toBe(200);
    expect(deps.mail.sent.map((mail) => mail.to)).toEqual(['faisal.al.harbi@madar.test', 'faisal.al.harbi@madar.test']);
  });

  it(`answers 429 after ${RENEW_KEY_PER_HOUR} tries an hour for one key, known or not, before the lookup; the limits keep only a sha256`, async () => {
    const { db, invite, post } = await setup();
    const known = keyIn(await invite('usr_002'));
    for (const key of [known, 'unknownunknownunknownunknownunknownunknownunknownunk']) {
      for (let i = 0; i < RENEW_KEY_PER_HOUR; i += 1) expect((await post({ key })).status).toBe(200);
      const over = await post({ key });
      expect(over.status).toBe(429);
      expect((await over.json()).error.details.reason).toBe('too_many');
    }
    const kept = [...db.rates.keys()].join('\n');
    expect(kept).not.toContain(known);
    expect(kept).not.toContain('203.0.113');
    // The outbox keeps the sha256 of the key, never the key.
    expect(JSON.stringify(db.mem.outbox)).not.toContain(known);
  });

  it(`answers 429 after ${RENEW_IP_PER_HOUR} an hour from one network address (cf-connecting-ip only)`, async () => {
    const { post, route, deps } = await setup();
    for (let i = 0; i < RENEW_IP_PER_HOUR; i += 1) expect((await post({ key: `k${i}` }, '198.51.100.7')).status).toBe(200);
    expect((await post({ key: 'k99' }, '198.51.100.7')).status).toBe(429);
    expect((await post({ key: 'k99' }, '198.51.100.8')).status).toBe(200);
    // A forged x-forwarded-for does not make another address.
    const forged = await route(new Request(`http://127.0.0.1${RENEW_PATH}`, {
      method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '192.0.2.1', 'true-client-ip': '192.0.2.2' }, body: JSON.stringify({ key: 'k100' }),
    }), deps);
    expect(forged.status).toBe(429);
  });

  it(`sends at most ${RENEW_PERSON_PER_DAY} renewals a day to one person, and the answer stays the same`, async () => {
    const { deps, invite, post } = await setup();
    let mail = await invite('usr_002');
    for (let i = 0; i < RENEW_PERSON_PER_DAY; i += 1) {
      expect((await post({ key: keyIn(mail) })).status).toBe(200);
      expect(deps.mail.sent).toHaveLength(i + 2);
      mail = deps.mail.sent.at(-1)!;
    }
    const over = await post({ key: keyIn(mail) });
    expect([over.status, await over.text()]).toEqual([200, OK]);
    expect(deps.mail.sent).toHaveLength(RENEW_PERSON_PER_DAY + 1);
    // The next day the newest key works.
    deps.clock.set(new Date(deps.clock.now().getTime() + 24 * 60 * 60 * 1000));
    expect((await post({ key: keyIn(mail) })).status).toBe(200);
    expect(deps.mail.sent).toHaveLength(RENEW_PERSON_PER_DAY + 2);
  });

  it('a full mail day sends nothing and makes no new link, and the key still works on a day with room (same answer)', async () => {
    const { auth, db, deps, invite, post } = await setup();
    const key = keyIn(await invite('usr_002'));
    db.mem.fill('notice', QUOTA_LIMITS.signin, deps.clock.now().toISOString().slice(0, 10));
    const full = await post({ key });
    expect([full.status, await full.text()]).toEqual([200, OK]);
    expect([deps.mail.sent.length, auth.links.length]).toEqual([1, 1]);
    expect(deps.logs.some((line) => line.level === 'warn' && /quota/.test(line.message) && line.fields?.userId === 'usr_002')).toBe(true);
    deps.clock.set(new Date(deps.clock.now().getTime() + 24 * 60 * 60 * 1000));
    expect((await post({ key })).status).toBe(200);
    expect(deps.mail.sent).toHaveLength(2);
  });

  it('refuses a body with no key with 400', async () => {
    const { post } = await setup();
    expect((await post('not json')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ key: '' })).status).toBe(400);
  });

  it('waits until the answer takes at least minMs', async () => {
    const deps = fakeDeps({ db: memoryDb({}).mem.db });
    const slept: number[] = [];
    const route = createRenewRoute({ minMs: 1500, sleep: async (ms) => void slept.push(ms) });
    const response = await route(new Request(`http://127.0.0.1${RENEW_PATH}`, { method: 'POST', body: JSON.stringify({ key: 'nothing' }) }), deps);
    expect(response.status).toBe(200);
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThan(1000);
    expect(slept[0]).toBeLessThanOrEqual(1500);
  });

  it('with an after, answers before the lookup and the send: a good key and an unknown key take the same time', async () => {
    const later: Promise<unknown>[] = [];
    const after: After = (work) => void later.push(work);
    const { deps, invite, route } = await setup({ host: () => ({ host: 'supabase', after }) });
    const key = keyIn(await invite('usr_002'));
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const send = deps.mail.send.bind(deps.mail);
    deps.mail.send = async (mail: Mail) => {
      await slow;
      return send(mail);
    };
    const ask = (k: string) => route(new Request(`http://127.0.0.1${RENEW_PATH}`, { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.9' }, body: JSON.stringify({ key: k }) }), deps);
    const timed = async (k: string) => {
      const started = performance.now();
      const response = await Promise.race([ask(k), new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), 500))]);
      return { answer: response === 'late' ? 'late' : [response.status, await response.text()], ms: performance.now() - started };
    };
    const good = await timed(key);
    const unknown = await timed('unknownunknownunknownunknownunknownunknownunknownunk');
    expect(good.answer).toEqual([200, OK]);
    expect(unknown.answer).toEqual(good.answer);
    expect(Math.abs(good.ms - unknown.ms)).toBeLessThan(100);
    expect(deps.mail.sent).toHaveLength(1);
    expect(later).toHaveLength(2);
    release();
    await Promise.all(later);
    expect(deps.mail.sent.map((mail) => mail.to)).toEqual(['faisal.al.harbi@madar.test', 'faisal.al.harbi@madar.test']);
  });

  it('logs a failure of Auth after the answer, and the answer stays the same', async () => {
    const later: Promise<unknown>[] = [];
    const { auth, deps, invite, post } = await setup({ host: () => ({ host: 'supabase', after: (work) => void later.push(work) }) });
    const key = keyIn(await invite('usr_002'));
    auth.failNext(new Error('Auth is down'));
    const response = await post({ key });
    expect([response.status, await response.text()]).toEqual([200, OK]);
    await Promise.all(later);
    expect(deps.logs.some((line) => line.level === 'warn' && line.fields?.error === 'Auth is down')).toBe(true);
  });
});
