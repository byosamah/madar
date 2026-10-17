import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { hashPassword } from '../auth/own/password';
import { testPrivateJwk } from '../auth/own/testKeys';
import { startOffice } from './test/harness';

const NOW = '2026-10-17T06:00:00Z';
const SIGN_IN = { email: 'copied@madar.test', password: 'a copied password', address: '203.0.113.7' };
const row = (id: string, hash: string) => ({ id, email: SIGN_IN.email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_002' });

describe('the own sign-in in the office object on local workerd (Supabase exit, wave 2)', () => {
  let office: Awaited<ReturnType<typeof startOffice>>;
  let jwk: string;
  beforeAll(async () => {
    office = await startOffice();
    jwk = await testPrivateJwk();
  }, 120_000);
  afterAll(async () => {
    await office?.server.close();
  });

  it('signs in with a PBKDF2 hash of 100,000 rounds and signs an ES256 token inside the object', async () => {
    const o = office.office('signin-pbkdf2');
    await o.writeState(await buildSeed('2026-10-17', async () => undefined));
    await o.importSignins([row('11111111-1111-4111-8111-111111111111', await hashPassword(SIGN_IN.password))], NOW);
    expect(await o.signin('auth.password', SIGN_IN, jwk, NOW)).toMatchObject({ ok: true, value: { token_type: 'bearer', expires_in: 900 } });
    expect(await o.signin('auth.password', { ...SIGN_IN, password: 'wrong' }, jwk, NOW)).toMatchObject({ ok: false, error: { details: { reason: 'invalid_credentials' } } });
  });

  // Owner decision 4 (Task 14): leave this test out when the owner chooses a new password for each person.
  it('checks a copied bcrypt hash with nodejs_compat once, then holds a PBKDF2 hash', async () => {
    const o = office.office('signin-bcrypt');
    await o.writeState(await buildSeed('2026-10-17', async () => undefined));
    await o.importSignins([row('22222222-2222-4222-8222-222222222222', bcrypt.hashSync(SIGN_IN.password, 10))], NOW);
    expect(await o.signin('auth.password', SIGN_IN, jwk, NOW)).toMatchObject({ ok: true });
    const [stored] = (await o.peek("select password_hash from auth_users where id = '22222222-2222-4222-8222-222222222222'")) as { password_hash: string }[];
    expect(stored.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await o.signin('auth.password', SIGN_IN, jwk, '2026-10-17T06:00:05Z')).toMatchObject({ ok: true });
  });

  it('refuses a statement other than a select in peek', async () => {
    // Through fetch: the Node RPC proxy of miniflare 5.20261001.0-alpha cannot carry a rejected call (it asserts the result type
    // "Promise" before it reads the status 500), so a refusal reaches the test only on the /rpc path of officeByFetch.
    await expect(office.officeByFetch('signin-pbkdf2').peek('delete from auth_users')).rejects.toThrow('peek runs a select only.');
  });
});
