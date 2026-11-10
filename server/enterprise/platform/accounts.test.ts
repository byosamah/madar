import { decodeJwt } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { testPrivateJwk } from '../../auth/own/testKeys';
import { hashedKey, limitAddress } from '../../auth/rateLimit';
import { nodeHost } from '../../data/lite/host';
import { NODE_OFFICE_ENV } from '../../office/test/nodeOffice';
import { fixedClock } from '../../test/fakes/clock';
import { isPlatformAccountId } from '../ids';
import { valueOfOutcome } from './accounts';
import { platformParts, type PlatformParts } from './parts';
import { applyPlatformSchema } from './schema';

const NOW = '2026-11-08T08:00:00.000Z';
const ADDRESS = '203.0.113.7';
const PASSWORD = 'a good long password';

/** The three methods that can refuse return data (PlatformOutcome). The tests below read a refusal as a throw, so they unwrap it here. */
function unwrapped(parts: PlatformParts) {
  return {
    ...parts,
    platformSignIn: async (input: Parameters<PlatformParts['platformSignIn']>[0]) => valueOfOutcome(await parts.platformSignIn(input)),
    platformRefresh: async (input: Parameters<PlatformParts['platformRefresh']>[0]) => valueOfOutcome(await parts.platformRefresh(input)),
    platformAccounts: async (input: Parameters<PlatformParts['platformAccounts']>[0]) => valueOfOutcome(await parts.platformAccounts(input)),
  };
}

async function platform() {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyPlatformSchema(host);
  const jwk = await testPrivateJwk();
  const clock = fixedClock(NOW);
  const real = platformParts({ host, read: (name) => (name === 'MADAR_AUTH_PRIVATE_JWK' ? jwk : NODE_OFFICE_ENV[name]), clock });
  return { raw, real, parts: unwrapped(real), clock };
}

async function withAccount() {
  const t = await platform();
  const made = await t.parts.platformAccounts({ action: 'create', email: 'Owner@Madar.test', name: 'The Owner', password: PASSWORD });
  return { ...t, made };
}

const failure = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    const e = error as { code: string; message: string; details: Record<string, unknown> };
    return { code: e.code, message: e.message, reason: e.details?.reason };
  }
  throw new Error('The step did not fail.');
};

describe('platform accounts: create and read', () => {
  it('creates an account with an id pla_NNN, a normalized email, and a PBKDF2 hash that is not the password', async () => {
    const { made, raw, parts } = await withAccount();
    expect(isPlatformAccountId(made.id)).toBe(true);
    expect(made).toEqual({ id: 'pla_001', email: 'owner@madar.test', name: 'The Owner', state: 'active' });
    const stored = raw.prepare('select password_hash from platform_accounts').get() as { password_hash: string };
    expect(stored.password_hash.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(stored.password_hash).not.toContain(PASSWORD);
    expect(await parts.platformAccount({ accountId: 'pla_001' })).toEqual({ id: 'pla_001', name: 'The Owner', email: 'owner@madar.test', state: 'active' });
    expect(await parts.platformAccount({ accountId: 'pla_002' })).toBeNull();
    const second = await parts.platformAccounts({ action: 'create', email: 'two@madar.test', name: 'Two', password: PASSWORD });
    expect(second.id).toBe('pla_002');
  });

  it('refuses a second account with the same email, a short password, a bad email and a missing name', async () => {
    const { parts } = await withAccount();
    expect(await failure(parts.platformAccounts({ action: 'create', email: 'owner@madar.test', name: 'X', password: PASSWORD }))).toMatchObject({ code: 'conflict', reason: 'email_taken' });
    expect(await failure(parts.platformAccounts({ action: 'create', email: 'new@madar.test', name: 'X', password: 'short' }))).toMatchObject({ code: 'invalid_input', reason: 'weak' });
    expect(await failure(parts.platformAccounts({ action: 'create', email: 'nope', name: 'X', password: PASSWORD }))).toMatchObject({ code: 'invalid_input' });
    expect(await failure(parts.platformAccounts({ action: 'create', email: 'new@madar.test', password: PASSWORD }))).toMatchObject({ code: 'invalid_input' });
  });

  it('an action on an unknown email gives not_found', async () => {
    const { parts } = await withAccount();
    for (const action of ['off', 'on'] as const) expect(await failure(parts.platformAccounts({ action, email: 'ghost@madar.test' }))).toMatchObject({ code: 'not_found' });
    expect(await failure(parts.platformAccounts({ action: 'password', email: 'ghost@madar.test', password: PASSWORD }))).toMatchObject({ code: 'not_found' });
  });
});

describe('platform sign-in', () => {
  it('gives a platform token (audience madar-platform, no ent, sid, 15 minutes) and a refresh token, and keeps only a hash of the refresh token', async () => {
    const { parts, raw } = await withAccount();
    const answer = await parts.platformSignIn({ email: ' OWNER@madar.test ', password: PASSWORD, address: ADDRESS });
    expect(answer).toMatchObject({ expires_in: 900, account: { id: 'pla_001', name: 'The Owner', email: 'owner@madar.test' } });
    const claims = decodeJwt(answer.access_token);
    expect(claims).toMatchObject({ sub: 'pla_001', aud: 'madar-platform' });
    expect(claims.ent).toBeUndefined();
    expect(typeof claims.sid).toBe('string');
    expect((claims.exp as number) - (claims.iat as number)).toBe(900);
    const sessions = raw.prepare('select id, account_id, refresh_hash from platform_sessions').all() as { id: string; account_id: string; refresh_hash: string }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(claims.sid);
    expect(sessions[0].refresh_hash).not.toContain(answer.refresh_token);
    expect(JSON.stringify(raw.prepare('select * from platform_sessions').all())).not.toContain(answer.refresh_token);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { parts } = await withAccount();
    const wrong = await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'not it at all', address: ADDRESS }));
    const unknown = await failure(parts.platformSignIn({ email: 'ghost@madar.test', password: 'not it at all', address: ADDRESS }));
    expect(wrong).toEqual(unknown);
    expect(wrong).toEqual({ code: 'unauthenticated', message: 'The email or the password is not right.', reason: 'invalid_credentials' });
  });

  it('an account that is off refuses the right password with account_off, and a wrong password still gives invalid_credentials', async () => {
    const { parts } = await withAccount();
    await parts.platformAccounts({ action: 'off', email: 'owner@madar.test' });
    expect(await failure(parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS }))).toMatchObject({ reason: 'account_off' });
    expect(await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'wrong wrong wrong', address: ADDRESS }))).toMatchObject({ reason: 'invalid_credentials' });
    await parts.platformAccounts({ action: 'on', email: 'owner@madar.test' });
    expect(await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS })).toMatchObject({ expires_in: 900 });
  });

  it('stops one email after 10 tries from one address and one address after 30 tries in 15 minutes, with a retry time', async () => {
    // Review 2026-11-10 (owner): the 10 count the email and the address together, so the 10 tries come from one address now.
    const { parts } = await withAccount();
    for (let i = 0; i < 10; i += 1) await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'wrong wrong wrong', address: '198.51.100.1' }));
    expect(await failure(parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: '198.51.100.1' }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    const address = await platform();
    for (let i = 0; i < 30; i += 1) await failure(address.parts.platformSignIn({ email: `ghost${i}@madar.test`, password: 'wrong wrong wrong', address: ADDRESS }));
    expect(await failure(address.parts.platformSignIn({ email: 'ghost99@madar.test', password: 'wrong wrong wrong', address: ADDRESS }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
  });

  it('a stranger does not lock the account out: 10 wrong passwords from one address, then the right one from another (review 2026-11-10, finding 3)', async () => {
    const { parts } = await withAccount();
    for (let i = 0; i < 10; i += 1) {
      expect(await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'wrong wrong wrong', address: '198.51.100.1' }))).toMatchObject({ reason: 'invalid_credentials' });
    }
    expect(await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS })).toMatchObject({ expires_in: 900 });
  });

  describe('the known address (review 2026-11-10, open item)', () => {
    /** 100 wrong tries for the account from 10 addresses that the owner never used, 10 from each. The last ones meet the total stop. */
    const strangers = async (parts: Awaited<ReturnType<typeof withAccount>>['parts']) => {
      for (let a = 0; a < 10; a += 1) {
        for (let i = 0; i < 10; i += 1) await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'wrong wrong wrong', address: `198.51.100.${a}` }));
      }
    };

    it('a known address signs in while strangers hit the total stop', async () => {
      const { parts } = await withAccount();
      await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
      await strangers(parts);
      expect(await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS })).toMatchObject({ expires_in: 900 });
    }, 120_000);

    it('an unknown address still meets the total stop', async () => {
      const { parts } = await withAccount();
      await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
      await strangers(parts);
      expect(await failure(parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: '192.0.2.44' }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    }, 120_000);

    it('a known address still stops at 10 wrong tries of its own', async () => {
      const { parts } = await withAccount();
      await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
      for (let i = 0; i < 10; i += 1) await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'wrong wrong wrong', address: ADDRESS }));
      expect(await failure(parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    });

    it('the row holds no email and no address, and a wrong password makes none', async () => {
      const { parts, raw } = await withAccount();
      await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'wrong wrong wrong', address: ADDRESS }));
      expect(raw.prepare('select count(*) as n from platform_known_addresses').get()).toEqual({ n: 0 });
      await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
      const rows = raw.prepare('select * from platform_known_addresses').all() as { pair_key: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].pair_key).toMatch(/^pknown:[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toContain('owner@madar.test');
      expect(JSON.stringify(rows)).not.toContain(ADDRESS);
    });
  });

  describe('the pair key is an HMAC under the server secret (review 2026-11-10, K2b)', () => {
    const pairKeys = (raw: Awaited<ReturnType<typeof withAccount>>['raw']) =>
      (raw.prepare('select pair_key from platform_known_addresses').all() as { pair_key: string }[]).map((row) => row.pair_key);

    it('the pair key cannot be computed without the server secret', async () => {
      const { parts, raw } = await withAccount();
      await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
      const keys = pairKeys(raw);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^pknown:[0-9a-f]{64}$/);
      expect(keys[0]).not.toBe(await hashedKey('pknown', `owner@madar.test|${limitAddress(ADDRESS)}`));
    });

    it('the address unknown never becomes known', async () => {
      const { parts, raw } = await withAccount();
      for (const address of ['unknown', ' Unknown ', '']) {
        expect(await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address })).toMatchObject({ expires_in: 900 });
      }
      expect(pairKeys(raw)).toEqual([]);
    });
  });

  it('the limits of the platform sign-in do not touch the limit of the company sign-in address', async () => {
    const { parts, raw } = await withAccount();
    await failure(parts.platformSignIn({ email: 'owner@madar.test', password: 'wrong wrong wrong', address: ADDRESS }));
    const keys = (raw.prepare('select key from rate_limits').all() as { key: string }[]).map((row) => row.key);
    // Review 2026-11-10: three keys now (the address, the email with the address, and the total of the email).
    expect(keys.length).toBe(3);
    expect(keys.every((key) => key.startsWith('psignin:'))).toBe(true);
    // The company address step (hitAddress) still counts its own key.
    expect(await parts.hitAddress({ step: 'auth.password', address: ADDRESS })).toEqual({ ok: true });
  });
});

describe('platform refresh and sign-out', () => {
  it('rotates: the new refresh token works, the old one works again once in the reuse window, and the old one after the window ends the session', async () => {
    const { parts, clock } = await withAccount();
    const first = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    const second = await parts.platformRefresh({ refreshToken: first.refresh_token });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(second.access_token).sid).toBe(decodeJwt(first.access_token).sid);
    // Within the reuse window the old token rotates again (two tabs).
    clock.advance(5_000);
    const third = await parts.platformRefresh({ refreshToken: first.refresh_token });
    expect(third.refresh_token).not.toBe(second.refresh_token);
    // After the window, a reuse of the previous token (second) ends the whole session, also the newest token.
    clock.advance(60_000);
    expect(await failure(parts.platformRefresh({ refreshToken: second.refresh_token }))).toMatchObject({ code: 'unauthenticated', reason: 'session_ended' });
    expect(await failure(parts.platformRefresh({ refreshToken: third.refresh_token }))).toMatchObject({ reason: 'session_ended' });
  });

  it('a platform session keeps the 10 s window: a retry 30 s after a rotation ends the session, 5 s keeps it (task D5b)', async () => {
    const live = (raw: DatabaseSync, now: Date) => raw.prepare('select ends_at > ? as live from platform_sessions').get(now.toISOString());
    const late = await withAccount();
    const first = await late.parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    await late.parts.platformRefresh({ refreshToken: first.refresh_token });
    late.clock.advance(30_000);
    expect(await failure(late.parts.platformRefresh({ refreshToken: first.refresh_token }))).toMatchObject({ reason: 'session_ended' });
    expect(live(late.raw, late.clock.now())).toEqual({ live: 0 });
    const soon = await withAccount();
    const one = await soon.parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    await soon.parts.platformRefresh({ refreshToken: one.refresh_token });
    soon.clock.advance(5_000);
    expect(await soon.parts.platformRefresh({ refreshToken: one.refresh_token })).toMatchObject({ expires_in: 900 });
    expect(live(soon.raw, soon.clock.now())).toEqual({ live: 1 });
  });

  it('a displaced token ends the session of a thief (review 2026-11-10, open item)', async () => {
    const { parts, raw, clock } = await withAccount();
    const first = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    const second = await parts.platformRefresh({ refreshToken: first.refresh_token });
    // The thief holds a copy of the first token and uses it inside the reuse window.
    clock.advance(5_000);
    const third = await parts.platformRefresh({ refreshToken: first.refresh_token });
    const fourth = await parts.platformRefresh({ refreshToken: third.refresh_token });
    // The token of the owner (second) is now neither the current hash nor the previous hash of the session.
    expect(await failure(parts.platformRefresh({ refreshToken: second.refresh_token }))).toMatchObject({ code: 'unauthenticated', reason: 'session_ended' });
    expect(raw.prepare('select ends_at > ? as live from platform_sessions').get(clock.now().toISOString())).toEqual({ live: 0 });
    expect(await failure(parts.platformRefresh({ refreshToken: fourth.refresh_token }))).toMatchObject({ reason: 'session_ended' });
  });

  it('a displaced hash of an ended session gives the plain answer, and an unknown token ends nothing', async () => {
    const { parts, raw, clock } = await withAccount();
    const first = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    const sessions = () => raw.prepare('select * from platform_sessions').all();
    const second = await parts.platformRefresh({ refreshToken: first.refresh_token });
    clock.advance(5_000);
    const third = await parts.platformRefresh({ refreshToken: first.refresh_token });
    await parts.platformRefresh({ refreshToken: third.refresh_token });
    const before = sessions();
    expect(await failure(parts.platformRefresh({ refreshToken: 'a token that no session ever held' }))).toMatchObject({ reason: 'session_ended' });
    expect(sessions()).toEqual(before);
    await parts.platformSignOut({ sessionId: decodeJwt(first.access_token).sid as string });
    const ended = sessions();
    clock.advance(1_000);
    expect(await failure(parts.platformRefresh({ refreshToken: second.refresh_token }))).toMatchObject({ reason: 'session_ended' });
    expect(sessions()).toEqual(ended);
  });

  it('an unknown refresh token gives session_ended', async () => {
    const { parts } = await withAccount();
    expect(await failure(parts.platformRefresh({ refreshToken: 'nothing' }))).toMatchObject({ reason: 'session_ended' });
  });

  it('a session ends 30 days after the last refresh', async () => {
    const { parts, clock } = await withAccount();
    const first = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    clock.advance(29 * 86_400_000);
    const second = await parts.platformRefresh({ refreshToken: first.refresh_token });
    clock.advance(29 * 86_400_000);
    const third = await parts.platformRefresh({ refreshToken: second.refresh_token });
    clock.advance(31 * 86_400_000);
    expect(await failure(parts.platformRefresh({ refreshToken: third.refresh_token }))).toMatchObject({ reason: 'session_ended' });
  });

  it('sign-out ends the session: its refresh token fails', async () => {
    const { parts } = await withAccount();
    const answer = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    await parts.platformSignOut({ sessionId: decodeJwt(answer.access_token).sid as string });
    expect(await failure(parts.platformRefresh({ refreshToken: answer.refresh_token }))).toMatchObject({ reason: 'session_ended' });
  });

  it('off refuses refresh with account_off, and it does not rotate the token; on lets the same session refresh again', async () => {
    const { parts } = await withAccount();
    const answer = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    await parts.platformAccounts({ action: 'off', email: 'owner@madar.test' });
    expect(await failure(parts.platformRefresh({ refreshToken: answer.refresh_token }))).toMatchObject({ code: 'unauthenticated', reason: 'account_off' });
    await parts.platformAccounts({ action: 'on', email: 'owner@madar.test' });
    expect(await parts.platformRefresh({ refreshToken: answer.refresh_token })).toMatchObject({ expires_in: 900 });
  });

  it('a password change ends every session of the account and the old password stops working', async () => {
    const { parts } = await withAccount();
    const one = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    const two = await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    await parts.platformAccounts({ action: 'password', email: 'owner@madar.test', password: 'another long password' });
    for (const old of [one, two]) expect(await failure(parts.platformRefresh({ refreshToken: old.refresh_token }))).toMatchObject({ reason: 'session_ended' });
    expect(await failure(parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS }))).toMatchObject({ reason: 'invalid_credentials' });
    expect(await parts.platformSignIn({ email: 'owner@madar.test', password: 'another long password', address: ADDRESS })).toMatchObject({ expires_in: 900 });
  });

  it('a password change refuses a short password', async () => {
    const { parts } = await withAccount();
    expect(await failure(parts.platformAccounts({ action: 'password', email: 'owner@madar.test', password: 'short' }))).toMatchObject({ reason: 'weak' });
  });
});

describe('platform accounts hold no company data', () => {
  it('the platform account tables hold no company id, and the company sign-in tables of the platform stay empty', async () => {
    const { parts, raw } = await withAccount();
    await parts.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS });
    for (const table of ['auth_users', 'auth_sessions', 'auth_links']) expect(raw.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 0 });
    expect(raw.prepare('select count(*) as n from emails').get()).toEqual({ n: 0 });
  });
});

describe('the refusals come back as data', () => {
  it('the platform object returns a refusal as { ok: false, error }, not as a throw', async () => {
    const { real } = await withAccount();
    expect(await real.platformSignIn({ email: 'ghost@madar.test', password: 'a wrong long password', address: ADDRESS })).toEqual({
      ok: false, error: { code: 'unauthenticated', message: 'The email or the password is not right.', details: { reason: 'invalid_credentials' } },
    });
    expect(await real.platformRefresh({ refreshToken: 'nothing' })).toMatchObject({ ok: false, error: { details: { reason: 'session_ended' } } });
    expect(await real.platformAccounts({ action: 'create', email: 'owner@madar.test', name: 'Again', password: PASSWORD })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await real.platformSignIn({ email: 'owner@madar.test', password: PASSWORD, address: ADDRESS })).toMatchObject({ ok: true, value: { expires_in: 900 } });
  });

  it('a defect that is no ApiError stays a throw', async () => {
    const { real } = await withAccount();
    await expect(real.platformAccounts(null as never)).rejects.toThrow();
  });
});
