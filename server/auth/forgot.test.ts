import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { LOCK_SQL } from '../core/lock';
import type { Db, Query } from '../core/ports';
import { AUTH_LINK_SQL } from '../data/officeCache';
import { apiApp } from '../http/app';
import { fakeDeps } from '../test/fakes/deps';
import { fakeAuth } from './fakeAuth';
import { createForgotRoute, FORGOT_EMAIL_PER_HOUR, FORGOT_IP_PER_HOUR, FORGOT_OFFICE_PER_HOUR, FORGOT_PERSON_SQL } from './forgot';
import { RATE_SQL } from './rateLimit';

/** POST /api/auth/forgot (plan 5.1; task P2). server/it/auth.it.test.ts runs it on the local stack. */

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function memoryDb(users: Record<string, { doc: User; auth: string | null }>) {
  const rates = new Map<string, number>();
  const relinks: unknown[][] = [];
  const q = (async (text: string, values: unknown[] = []) => {
    if (text === RATE_SQL) {
      const id = `${values[0]}|${values[1]}`;
      rates.set(id, (rates.get(id) ?? 0) + 1);
      return [{ count: rates.get(id) }];
    }
    if (text === FORGOT_PERSON_SQL) {
      const found = Object.entries(users).find(([, row]) => row.doc.email.toLowerCase() === values[0]);
      return found ? [{ id: found[0], doc: found[1].doc, auth: found[1].auth }] : [];
    }
    if (text === LOCK_SQL) return [];
    if (text === AUTH_LINK_SQL) {
      relinks.push(values);
      users[String(values[0])].auth = String(values[1]);
      return [{ id: values[0] }];
    }
    throw new Error(`No answer for: ${text.slice(0, 60)}`);
  }) as Query;
  const db: Db = {
    tx: async (_mode, work) => work(q),
    savepoint: async (inner, work) => work(inner),
    statement: async (_mode, text, values) => q(text, values),
  };
  return { db, rates, relinks };
}

async function setup() {
  const auth = fakeAuth();
  const linked = async (user: User) => ({ doc: user, auth: (await auth.generateLink('invite', user.email)).authUserId });
  const users: Record<string, { doc: User; auth: string | null }> = {
    usr_002: await linked(seed.users.usr_002),
    usr_005: await linked({ ...seed.users.usr_005, preferences: { ...seed.users.usr_005.preferences, language: 'ar' } }),
    usr_006: await linked({ ...seed.users.usr_006, active: false }),
    usr_007: { doc: seed.users.usr_007, auth: null },
    usr_009: { doc: seed.users.usr_009, auth: null },
  };
  auth.links.length = 0;
  const mem = memoryDb(users);
  const deps = fakeDeps({ db: mem.db, config: { appUrl: 'https://madar.test' } });
  deps.authAdmin = auth;
  const slept: number[] = [];
  const route = createForgotRoute({ minMs: 0, sleep: async (ms) => void slept.push(ms) });
  const app = apiApp(deps, { routes: [{ method: 'POST', path: '/auth/forgot', handler: route }] });
  const post = (body: unknown, ip = '203.0.113.7') =>
    app.fetch(new Request('http://127.0.0.1/auth/forgot', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
  return { auth, deps, mem, post, slept, users };
}

describe('POST /auth/forgot', () => {
  it('gives the same answer for a person, an unknown email, a turned-off person, a person with no sign-in yet and an agent; only the person gets a mail', async () => {
    const { auth, deps, post } = await setup();
    const answers = [];
    for (const email of ['Faisal.Al.Harbi@madar.test', 'nobody@madar.test', 'yousef.saleh@madar.test', 'lina.mansour@madar.test', 'assistant@madar.test']) {
      const response = await post({ email });
      answers.push([response.status, await response.text()]);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    expect(auth.links.map((l) => [l.type, l.email])).toEqual([['recovery', 'faisal.al.harbi@madar.test']]);
    expect(deps.mail.sent).toHaveLength(1);
    const [mail] = deps.mail.sent;
    expect(mail).toMatchObject({ to: 'faisal.al.harbi@madar.test', subject: 'Reset your Madar password', tag: 'reset', idempotencyKey: expect.stringMatching(/^reset:[0-9a-f]{64}$/) });
    // The key goes to the mail sender and its logs: it never holds the token hash, which is the live sign-in credential.
    expect(mail.idempotencyKey).not.toContain(auth.links[0].tokenHash);
    expect(mail.text).toContain(`https://madar.test/reset?token_hash=${auth.links[0].tokenHash}&type=recovery`);
  });

  it('writes the reset mail in the person\'s language, with the feminine Arabic forms for a woman', async () => {
    const { deps, post } = await setup();
    expect((await post({ email: 'sara.al.qahtani@madar.test' })).status).toBe(200);
    expect(deps.mail.sent[0].subject).toBe('إعادة تعيين كلمة المرور في مدار');
    expect(deps.mail.sent[0].text).toContain('افتحي الرابط');
  });

  it(`answers 429 after ${FORGOT_EMAIL_PER_HOUR} requests an hour for one email, known or not, and keeps no email in the table`, async () => {
    const { deps, mem, post } = await setup();
    for (const email of ['faisal.al.harbi@madar.test', 'nobody@madar.test']) {
      for (let i = 0; i < FORGOT_EMAIL_PER_HOUR; i += 1) expect((await post({ email }, `198.51.100.${i}`)).status).toBe(200);
      const over = await post({ email }, '198.51.100.99');
      expect(over.status).toBe(429);
      expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    }
    expect(deps.mail.sent).toHaveLength(FORGOT_EMAIL_PER_HOUR);
    expect([...mem.rates.keys()].some((key) => key.includes('@') || key.includes('198.51'))).toBe(false);
  });

  it(`answers 429 after ${FORGOT_IP_PER_HOUR} requests an hour from one address`, async () => {
    const { post } = await setup();
    for (let i = 0; i < FORGOT_IP_PER_HOUR; i += 1) expect((await post({ email: `p${i}@madar.test` })).status).toBe(200);
    expect((await post({ email: 'p99@madar.test' })).status).toBe(429);
    expect((await post({ email: 'p99@madar.test' }, '192.0.2.1')).status).toBe(200);
  });

  it('refuses a body with no valid email with 400, and a failure of Auth still gives the same answer', async () => {
    const { auth, deps, post } = await setup();
    expect((await post('not json')).status).toBe(400);
    expect((await post({ email: 'not an email' })).status).toBe(400);
    auth.failNext(new Error('Auth is down'));
    const response = await post({ email: 'faisal.al.harbi@madar.test' });
    expect([response.status, await response.text()]).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    expect(deps.logs.some((line) => line.level === 'warn' && line.fields?.error === 'Auth is down')).toBe(true);
  });

  it('never moves the sign-in link and sends no mail when the recovery link names another Auth user (no sign-in needed here)', async () => {
    const { deps, mem, post, users } = await setup();
    users.usr_002.auth = '00000000-0000-4000-8000-0000000000ff';
    const response = await post({ email: 'faisal.al.harbi@madar.test' });
    expect([response.status, await response.text()]).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    expect(mem.relinks).toEqual([]);
    expect(deps.mail.sent).toEqual([]);
    expect(deps.logs.some((line) => line.level === 'warn' && line.fields?.userId === 'usr_002')).toBe(true);
  });

  it(`sends at most ${FORGOT_OFFICE_PER_HOUR} reset mails an hour for the whole office, and still gives the same answer`, async () => {
    const { deps, mem, post } = await setup();
    // A forged x-forwarded-for gets past the address limit; 3 an hour for each email still holds. The office limit caps the rest.
    const people = ['faisal.al.harbi@madar.test', 'sara.al.qahtani@madar.test'];
    let n = 0;
    for (let round = 0; round < FORGOT_EMAIL_PER_HOUR; round += 1) {
      for (const email of people) expect((await post({ email }, `198.51.100.${(n += 1)}`)).status).toBe(200);
    }
    for (let i = 0; i < FORGOT_EMAIL_PER_HOUR; i += 1) expect((await post({ email: 'nobody@madar.test' }, `192.0.2.${i}`)).status).toBe(200);
    expect(deps.mail.sent).toHaveLength(6);
    // Only a mail that would go out counts: the unknown email did not use the office limit.
    const office = [...mem.rates.entries()].find(([key]) => key.startsWith('forgot:all|'));
    expect(office?.[1]).toBe(6);
    mem.rates.set(office![0], FORGOT_OFFICE_PER_HOUR);
    for (const key of [...mem.rates.keys()]) if (key.startsWith('forgot:email:')) mem.rates.delete(key);
    const over = await post({ email: people[0] }, '192.0.2.200');
    expect([over.status, await over.text()]).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    expect(deps.mail.sent).toHaveLength(6);
    expect(deps.logs.some((line) => line.level === 'warn' && /office/.test(line.message))).toBe(true);
  });

  it('waits until the answer takes at least minMs, so the time does not tell whether the email has an account', async () => {
    const deps = fakeDeps({ db: memoryDb({}).db });
    const slept: number[] = [];
    const route = createForgotRoute({ minMs: 1500, sleep: async (ms) => void slept.push(ms) });
    const response = await route(new Request('http://127.0.0.1/auth/forgot', { method: 'POST', body: JSON.stringify({ email: 'a@madar.test' }) }), deps);
    expect(response.status).toBe(200);
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThan(1000);
    expect(slept[0]).toBeLessThanOrEqual(1500);
  });
});
