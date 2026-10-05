import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { After, RequestHost } from '../core/after';
import { LOCK_SQL } from '../core/lock';
import type { Mail } from '../core/ports';
import { AUTH_LINK_SQL } from '../data/officeCache';
import { apiApp } from '../http/app';
import { memoryMailDb } from '../mail/memoryMailDb';
import { QUOTA_LIMITS } from '../mail/quota';
import { fakeDeps } from '../test/fakes/deps';
import { fakeAuth } from './fakeAuth';
import { clientAddress, createForgotRoute, FORGOT_EMAIL_PER_WINDOW, FORGOT_EMAIL_WINDOW_MS, FORGOT_IP_PER_HOUR, FORGOT_PERSON_SQL } from './forgot';
import { RATE_SQL } from './rateLimit';

/** POST /api/auth/forgot (plan 5.1; task P2). server/it/auth.it.test.ts runs it on the local stack. */

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

/** The users rows and the rate limits in memory, on the mail database of N2 (the quota and the outbox statements). */
function memoryDb(users: Record<string, { doc: User; auth: string | null }>) {
  const rates = new Map<string, number>();
  const relinks: unknown[][] = [];
  const mem = memoryMailDb((text, values) => {
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
    return undefined;
  });
  return { db: mem.db, mem, rates, relinks };
}

async function setup(o: { host?: () => RequestHost } = {}) {
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
  const route = createForgotRoute({ minMs: 0, sleep: async (ms) => void slept.push(ms), host: o.host });
  const app = apiApp(deps, { routes: [{ method: 'POST', path: '/auth/forgot', handler: route }] });
  const post = (body: unknown, ip = '203.0.113.7') =>
    app.fetch(new Request('http://127.0.0.1/auth/forgot', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
  return { auth, deps, mem, post, route, slept, users };
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

  it('names the person in the language of the reset mail (owner item 12)', async () => {
    const { deps, post, users } = await setup();
    users.usr_005.doc = { ...users.usr_005.doc, nameAr: 'سارة القحطاني' };
    users.usr_002.doc = { ...users.usr_002.doc, nameAr: 'فيصل الحربي' };
    expect((await post({ email: 'sara.al.qahtani@madar.test' })).status).toBe(200);
    expect(deps.mail.sent[0].text).toContain('سارة القحطاني');
    expect((await post({ email: 'faisal.al.harbi@madar.test' })).status).toBe(200);
    expect(deps.mail.sent[1].text).toContain(users.usr_002.doc.name);
    expect(deps.mail.sent[1].text).not.toContain('فيصل الحربي');
  });

  it('starts the reset mail with the Madar mark at the app address and the name, as the N2 mails do (wave 6, V)', async () => {
    const { deps, post } = await setup();
    expect((await post({ email: 'sara.al.qahtani@madar.test' })).status).toBe(200);
    expect(deps.mail.sent[0].html).toContain('<img src="https://madar.test/icons/madar-192.png" width="28" height="28" alt=""');
    expect(deps.mail.sent[0].html).toMatch(/>مدار<\/td>/);
  });

  it(`answers 429 after ${FORGOT_EMAIL_PER_WINDOW} requests in one window for one email, known or not, and keeps no email in the table`, async () => {
    const { deps, mem, post } = await setup();
    for (const email of ['faisal.al.harbi@madar.test', 'nobody@madar.test']) {
      for (let i = 0; i < FORGOT_EMAIL_PER_WINDOW; i += 1) expect((await post({ email }, `198.51.100.${i}`)).status).toBe(200);
      const over = await post({ email }, '198.51.100.99');
      expect(over.status).toBe(429);
      expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
      // Its own reason: the person already holds reset mails, so the screen says to use the newest one (S1 review).
      expect((await over.json()).error.details.reason).toBe('too_many_resets_email');
    }
    expect(deps.mail.sent).toHaveLength(FORGOT_EMAIL_PER_WINDOW);
    expect([...mem.rates.keys()].some((key) => key.includes('@') || key.includes('198.51'))).toBe(false);
  });

  it(`answers 429 after ${FORGOT_IP_PER_HOUR} requests an hour from one address`, async () => {
    const { post } = await setup();
    for (let i = 0; i < FORGOT_IP_PER_HOUR; i += 1) expect((await post({ email: `p${i}@madar.test` })).status).toBe(200);
    const over = await post({ email: 'p99@madar.test' });
    expect(over.status).toBe(429);
    expect((await over.json()).error).toMatchObject({ message: 'Too many tries. Wait a few minutes, then try again.', details: { reason: 'too_many_resets' } });
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

describe('clientAddress (S1): only the value that Cloudflare writes', () => {
  const request = (headers: Record<string, string>) => new Request('http://127.0.0.1/auth/forgot', { method: 'POST', headers });

  it('reads cf-connecting-ip on both hosts: Cloudflare sits in front of Workers and of Supabase, and refuses a request that sends its own', () => {
    expect(clientAddress(request({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.7');
    expect(clientAddress(request({ 'cf-connecting-ip': ' 203.0.113.8 ' }))).toBe('203.0.113.8');
  });

  it('never reads x-forwarded-for (its last entry is a rotating proxy address) or true-client-ip (it passes through forged); no value is "unknown" (local runs)', () => {
    expect(clientAddress(request({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9, 13.248.1.1' }))).toBe('unknown');
    expect(clientAddress(request({ 'true-client-ip': '203.0.113.9' }))).toBe('unknown');
    expect(clientAddress(request({}))).toBe('unknown');
  });
});

describe('POST /auth/forgot (S1): the limits a sender cannot get past, the mail quota, and the time of the answer', () => {
  it(`a sender who forges x-forwarded-for and true-client-ip still stops after ${FORGOT_IP_PER_HOUR} an hour`, async () => {
    const { deps } = await setup();
    const route = createForgotRoute({ minMs: 0, sleep: async () => undefined });
    const forged = (n: number, email: string) => route(new Request('http://127.0.0.1/auth/forgot', {
      method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.50', 'x-forwarded-for': `198.51.100.${n}`, 'true-client-ip': `192.0.2.${n}` }, body: JSON.stringify({ email }),
    }), deps);
    for (let i = 0; i < FORGOT_IP_PER_HOUR; i += 1) expect((await forged(i, `p${i}@madar.test`)).status).toBe(200);
    expect((await forged(77, 'p77@madar.test')).status).toBe(429);
  });

  it(`has no office-wide cap: 31 reset requests for 11 people in one window all send, and request ${FORGOT_EMAIL_PER_WINDOW + 1} for one email in that window gets 429`, async () => {
    const { auth, deps, mem, post, users } = await setup();
    for (let i = 0; i < 11; i += 1) {
      const email = `p${i}@madar.test`;
      users[`usr_9${String(i).padStart(2, '0')}`] = { doc: { ...seed.users.usr_002, email }, auth: (await auth.generateLink('invite', email)).authUserId };
    }
    let n = 0;
    for (let i = 0; i < 31; i += 1) expect((await post({ email: `p${i % 11}@madar.test` }, `198.51.100.${(n += 1)}`)).status).toBe(200);
    expect(deps.mail.sent).toHaveLength(31);
    expect(mem.mem.log.filter((row) => row.kind === 'signin')).toHaveLength(31);
    expect([...mem.rates.keys()].some((key) => key.startsWith('forgot:all') || key.startsWith('forgot:day'))).toBe(false);
    // p0 got 3 in this window (requests 1, 12 and 23); the 4th is refused, whatever the address.
    expect((await post({ email: 'p0@madar.test' }, '192.0.2.250')).status).toBe(429);
    // The next window.
    deps.clock.set(new Date(deps.clock.now().getTime() + FORGOT_EMAIL_WINDOW_MS));
    expect((await post({ email: 'p0@madar.test' }, '192.0.2.251')).status).toBe(200);
  });

  it('counts the reset mail against the daily mail quota as sign-in mail, and sends none when the day is full (same answer)', async () => {
    const { deps, mem, post } = await setup();
    expect((await post({ email: 'faisal.al.harbi@madar.test' })).status).toBe(200);
    expect(mem.mem.log.map((row) => [row.kind, row.user_id, row.resend_id])).toEqual([['signin', 'usr_002', 'mail_1']]);
    mem.mem.fill('notice', QUOTA_LIMITS.signin - 1, deps.clock.now().toISOString().slice(0, 10));
    const full = await post({ email: 'sara.al.qahtani@madar.test' }, '192.0.2.5');
    expect([full.status, await full.text()]).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    expect(deps.mail.sent).toHaveLength(1);
    expect(deps.logs.some((line) => line.level === 'warn' && /quota/.test(line.message) && line.fields?.userId === 'usr_005')).toBe(true);
  });

  it('checks the mail quota before Auth: a full day makes no recovery link, so the link that the person got earlier still works (same answer)', async () => {
    const { auth, deps, mem, post } = await setup();
    expect((await post({ email: 'faisal.al.harbi@madar.test' })).status).toBe(200);
    expect(auth.links).toHaveLength(1);
    mem.mem.fill('notice', QUOTA_LIMITS.signin - 1, deps.clock.now().toISOString().slice(0, 10));
    const full = await post({ email: 'faisal.al.harbi@madar.test' }, '192.0.2.6');
    expect([full.status, await full.text()]).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    // Auth keeps one recovery token for each person: a new link on a full day would end the link of the first mail.
    expect(auth.links).toHaveLength(1);
    expect(deps.mail.sent).toHaveLength(1);
    expect(deps.logs.some((line) => line.level === 'warn' && /quota/.test(line.message) && line.fields?.userId === 'usr_002')).toBe(true);
  });

  it('keeps the window of each email no longer than the life of a reset link (otp_expiry), so the newest mailed link still works when the 429 ends', async () => {
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
    const email = config.slice(config.indexOf('[auth.email]'), config.indexOf('[auth.sms]'));
    const linkLifeMs = Number(/^otp_expiry\s*=\s*(\d+)/m.exec(email)?.[1]) * 1000;
    expect(linkLifeMs).toBeGreaterThan(0);
    expect(FORGOT_EMAIL_WINDOW_MS).toBeLessThanOrEqual(linkLifeMs);
    // The worst case: the 3 requests come at the start of a window, the 4th at its last moment.
    const { auth, deps, post } = await setup();
    const start = Math.floor(deps.clock.now().getTime() / FORGOT_EMAIL_WINDOW_MS) * FORGOT_EMAIL_WINDOW_MS;
    deps.clock.set(new Date(start));
    for (let i = 0; i < FORGOT_EMAIL_PER_WINDOW; i += 1) expect((await post({ email: 'faisal.al.harbi@madar.test' }, `198.51.100.${i}`)).status).toBe(200);
    const newestSentAt = deps.clock.now().getTime();
    expect(auth.links).toHaveLength(FORGOT_EMAIL_PER_WINDOW);
    deps.clock.set(new Date(start + FORGOT_EMAIL_WINDOW_MS - 1));
    const over = await post({ email: 'faisal.al.harbi@madar.test' }, '198.51.100.99');
    expect(over.status).toBe(429);
    // The newest link (the last one mailed) still works until the window ends and a new request goes through.
    const retryAt = deps.clock.now().getTime() + Number((await over.json()).error.details.retryAfterMs);
    expect(newestSentAt + linkLifeMs).toBeGreaterThanOrEqual(retryAt);
    deps.clock.set(new Date(start + FORGOT_EMAIL_WINDOW_MS));
    expect((await post({ email: 'faisal.al.harbi@madar.test' }, '198.51.100.98')).status).toBe(200);
  });

  it('with an after, answers before the lookup and the send: a send that takes 3 s does not show that the email has an account', async () => {
    const later: Promise<unknown>[] = [];
    const after: After = (work) => void later.push(work);
    const { deps, route } = await setup({ host: () => ({ host: 'supabase', after }) });
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const send = deps.mail.send.bind(deps.mail);
    // The send of a real person takes 3 s here: it waits until the test lets it go.
    deps.mail.send = async (mail: Mail) => {
      await slow;
      return send(mail);
    };
    const ask = (email: string) => route(new Request('http://127.0.0.1/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }), deps);
    const timed = async (email: string) => {
      const started = performance.now();
      const response = await Promise.race([ask(email), new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), 500))]);
      return { answer: response === 'late' ? 'late' : [response.status, await response.text()], ms: performance.now() - started };
    };
    const person = await timed('faisal.al.harbi@madar.test');
    const nobody = await timed('nobody@madar.test');
    expect(person.answer).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    expect(nobody.answer).toEqual(person.answer);
    expect(Math.abs(person.ms - nobody.ms)).toBeLessThan(100);
    expect(deps.mail.sent).toHaveLength(0);
    expect(later).toHaveLength(2);
    release();
    await Promise.all(later);
    expect(deps.mail.sent.map((mail) => mail.to)).toEqual(['faisal.al.harbi@madar.test']);
  });

  it('with no after (tests, local runs), keeps the lookup and the send inline, before the answer', async () => {
    const { deps, post } = await setup({ host: () => ({ host: 'other' }) });
    expect((await post({ email: 'faisal.al.harbi@madar.test' })).status).toBe(200);
    expect(deps.mail.sent).toHaveLength(1);
  });

  it('logs a failure of the work after the answer, and the answer stays the same', async () => {
    const later: Promise<unknown>[] = [];
    const { auth, deps, post } = await setup({ host: () => ({ host: 'supabase', after: (work) => void later.push(work) }) });
    auth.failNext(new Error('Auth is down'));
    const response = await post({ email: 'faisal.al.harbi@madar.test' });
    expect([response.status, await response.text()]).toEqual([200, JSON.stringify({ v: 1, ok: true })]);
    await Promise.all(later);
    expect(deps.logs.some((line) => line.level === 'warn' && line.fields?.error === 'Auth is down')).toBe(true);
  });
});
