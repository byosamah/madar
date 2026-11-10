import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './crypto';
import { passwordSignIn } from './ops';
import { untag } from '../../enterprise/ids';
import { addSignIn, bareToken, signinDepsOf, signinOffice } from './testOffice';

const ADDRESS = '203.0.113.7';

async function setup(password = 'a good password') {
  const t = await signinOffice();
  const authId = await addSignIn(t, 'usr_002', { password });
  const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
  return { t, authId, email, deps: await signinDepsOf(t) };
}

const errorOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    const e = error as { code: string; message: string; details: Record<string, unknown> };
    return { code: e.code, message: e.message, reason: e.details.reason };
  }
  throw new Error('The step did not fail.');
};

describe('the password sign-in of the own stack (server/auth/own/ops.ts)', () => {
  it('gives a browser token of 15 minutes and a refresh token, and keeps only the sha256 of the refresh token', async () => {
    const { t, authId, email, deps } = await setup();
    const answer = await passwordSignIn(deps, { email: email.toUpperCase(), password: 'a good password', address: ADDRESS });
    expect(answer).toMatchObject({ token_type: 'bearer', expires_in: 900, user: { id: authId } });
    const claims = decodeJwt(answer.access_token);
    expect(claims).toMatchObject({ sub: authId, aud: 'authenticated', role: 'authenticated', iss: 'http://127.0.0.1:54321/functions/v1/mcp' });
    expect((claims.exp as number) - (claims.iat as number)).toBe(900);
    expect(t.raw.prepare('select id, auth_id, client_id, amr, refresh_hash, expires_at from auth_sessions').all()).toEqual([
      { id: claims.session_id, auth_id: authId, client_id: null, amr: 'password', refresh_hash: await sha256Hex(bareToken(answer.refresh_token)), expires_at: '2026-11-16T06:00:00.000Z' },
    ]);
  });

  it('gives a token with the claim ent and a refresh token that untag reads as {ent, secret}', async () => {
    const { email, deps } = await setup();
    const answer = await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
    expect(decodeJwt(answer.access_token).ent).toBe(deps.ent);
    expect(untag(answer.refresh_token)).toEqual({ ent: deps.ent, secret: bareToken(answer.refresh_token) });
    expect(bareToken(answer.refresh_token)).not.toContain('.');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { email, deps } = await setup();
    const wrong = await errorOf(passwordSignIn(deps, { email, password: 'not it', address: ADDRESS }));
    const unknown = await errorOf(passwordSignIn(deps, { email: 'nobody@madar.test', password: 'not it', address: ADDRESS }));
    expect(wrong).toEqual(unknown);
    expect(wrong).toEqual({ code: 'unauthenticated', message: 'The email or the password is not right.', reason: 'invalid_credentials' });
  });

  it('gives the same answer for a person with no password yet', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_004');
    const email = (t.raw.prepare('select email from auth_users').get() as { email: string }).email;
    expect(await errorOf(passwordSignIn(await signinDepsOf(t), { email, password: 'anything', address: ADDRESS }))).toMatchObject({ reason: 'invalid_credentials' });
  });

  it('marks the password as set on a sign-in, for users.invites', async () => {
    const { t, authId, email, deps } = await setup();
    t.raw.prepare('update auth_users set password_set = 0 where id = ?').run(authId);
    await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
    expect(t.raw.prepare('select password_set from auth_users where id = ?').get(authId)).toEqual({ password_set: 1 });
  });

  it('says account_off for a banned or turned-off person, but only after the right password', async () => {
    const { t, authId, email, deps } = await setup();
    t.raw.prepare('update auth_users set banned = 1 where id = ?').run(authId);
    expect(await errorOf(passwordSignIn(deps, { email, password: 'not it', address: ADDRESS }))).toMatchObject({ reason: 'invalid_credentials' });
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ reason: 'account_off' });
    t.raw.prepare('update auth_users set banned = 0 where id = ?').run(authId);
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_002' })).ok).toBe(true);
    t.raw.prepare('update auth_users set banned = 0 where id = ?').run(authId);
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ reason: 'account_off' });
    expect(t.raw.prepare('select count(*) as n from auth_sessions').get()).toEqual({ n: 0 });
  });

  it('the same address stops at 10 tries for one email in 15 minutes, also with the right password, and rate_limits holds no email', async () => {
    // Review 2026-11-10 (owner): the 10 count the email and the address together, so the 10 tries come from one address now.
    const { t, email, deps } = await setup();
    for (let i = 0; i < 10; i += 1) await errorOf(passwordSignIn(deps, { email, password: 'not it', address: '198.51.100.1' }));
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: '198.51.100.1' }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    expect(JSON.stringify(t.raw.prepare('select key from rate_limits').all())).not.toContain(email);
  });

  it('a stranger does not lock the person out: 10 wrong passwords from one address, then the right one from another address (review 2026-11-10, finding 3)', async () => {
    const { email, deps } = await setup();
    for (let i = 0; i < 10; i += 1) expect(await errorOf(passwordSignIn(deps, { email, password: 'not it', address: '198.51.100.1' }))).toMatchObject({ reason: 'invalid_credentials' });
    expect(await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS })).toMatchObject({ token_type: 'bearer' });
  });

  it('counts an IPv6 address as its /64 block: 10 tries from 10 addresses of one block stop the 11th address of that block (task D3b)', async () => {
    const { email, deps } = await setup();
    for (let i = 1; i <= 10; i += 1) {
      expect(await errorOf(passwordSignIn(deps, { email, password: 'not it', address: `2001:db8:1:2::${i.toString(16)}` }))).toMatchObject({ reason: 'invalid_credentials' });
    }
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: '2001:db8:1:2:ffff::b' }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    // Another /64 block is another machine: it still signs in.
    expect(await passwordSignIn(deps, { email, password: 'a good password', address: '2001:db8:1:3::1' })).toMatchObject({ token_type: 'bearer' });
  });

  it('the office path: a stranger does not lock the person out with addressChecked on every call', async () => {
    const { email, deps } = await setup();
    for (let i = 0; i < 10; i += 1) await errorOf(passwordSignIn(deps, { email, password: 'not it', address: '198.51.100.1', addressChecked: true }));
    expect(await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS, addressChecked: true })).toMatchObject({ token_type: 'bearer' });
  });

  it('the total stop: 100 tries for one email from 10 addresses stop the 101st, also with the right password from a new address', async () => {
    const { email, deps } = await setup();
    for (let a = 0; a < 10; a += 1) {
      for (let i = 0; i < 10; i += 1) expect(await errorOf(passwordSignIn(deps, { email, password: 'not it', address: `198.51.100.${a}` }))).toMatchObject({ reason: 'invalid_credentials' });
    }
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
  }, 120_000);

  describe('the known address (review 2026-11-10, open item)', () => {
    /** 100 wrong tries for the email from 10 addresses that the person never used, 10 from each. The last ones meet the total stop. */
    const strangers = async (deps: Awaited<ReturnType<typeof setup>>['deps'], email: string) => {
      for (let a = 0; a < 10; a += 1) {
        for (let i = 0; i < 10; i += 1) await errorOf(passwordSignIn(deps, { email, password: 'not it', address: `198.51.100.${a}` }));
      }
    };

    it('a known address signs in while strangers hit the total stop', async () => {
      const { email, deps } = await setup();
      await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
      await strangers(deps, email);
      expect(await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS })).toMatchObject({ token_type: 'bearer' });
    }, 120_000);

    it('an unknown address still meets the total stop', async () => {
      const { email, deps } = await setup();
      await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
      await strangers(deps, email);
      expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: '192.0.2.44' }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    }, 120_000);

    it('a known address still stops at 10 wrong tries of its own', async () => {
      const { email, deps } = await setup();
      await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
      for (let i = 0; i < 10; i += 1) await errorOf(passwordSignIn(deps, { email, password: 'not it', address: ADDRESS }));
      expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    });

    it('a wrong password, an unknown email and a banned person make no known row', async () => {
      const { t, authId, email, deps } = await setup();
      const known = () => t.raw.prepare('select count(*) as n from auth_known_addresses').get();
      await errorOf(passwordSignIn(deps, { email, password: 'not it', address: ADDRESS }));
      await errorOf(passwordSignIn(deps, { email: 'nobody@madar.test', password: 'a good password', address: ADDRESS }));
      t.raw.prepare('update auth_users set banned = 1 where id = ?').run(authId);
      expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ reason: 'account_off' });
      expect(known()).toEqual({ n: 0 });
    });

    it('an address last seen 91 days ago is not known', async () => {
      const { t, email, deps } = await setup();
      await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
      const old = new Date(t.deps.clock.now().getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
      t.raw.prepare('update auth_known_addresses set seen_at = ?').run(old);
      await strangers(deps, email);
      expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    }, 120_000);

    it('the row holds no email and no address', async () => {
      const { t, email, deps } = await setup();
      await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
      const rows = t.raw.prepare('select * from auth_known_addresses').all() as { pair_key: string; seen_at: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].pair_key).toMatch(/^known:[0-9a-f]{64}$/);
      expect(rows[0].seen_at).toBe('2026-10-17T06:00:00.000Z');
      expect(JSON.stringify(rows)).not.toContain(email);
      expect(JSON.stringify(rows)).not.toContain(ADDRESS);
    });

    it('a sign-in from one address of an IPv6 /64 block makes every address of that block known', async () => {
      const { email, deps } = await setup();
      await passwordSignIn(deps, { email, password: 'a good password', address: '2001:db8:1:2::1' });
      await strangers(deps, email);
      expect(await passwordSignIn(deps, { email, password: 'a good password', address: '2001:db8:1:2:ffff::b' })).toMatchObject({ token_type: 'bearer' });
    }, 120_000);
  });

  it('stops at 30 tries for one network address in 15 minutes', async () => {
    const { deps } = await setup();
    for (let i = 0; i < 30; i += 1) await errorOf(passwordSignIn(deps, { email: `p${i}@madar.test`, password: 'x', address: ADDRESS }));
    expect(await errorOf(passwordSignIn(deps, { email: 'p31@madar.test', password: 'x', address: ADDRESS }))).toMatchObject({ reason: 'too_many' });
  });
});
