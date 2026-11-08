import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLive } from './test/live/harness';

/** The platform object on local workerd (Madar enterprises, plan B Task 7). */
describe('the platform object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('resolveEmail reads 1 row for a hit and at most 1 for a miss', async () => {
    await live.platform('reserveEmail', { ent: 'ent_002', email: 'hala@globex.test' });
    expect(await live.platform('resolveRows', 'hala@globex.test')).toEqual({ ent: 'ent_002', rows: 1 });
    const miss = await live.platform<{ ent: string | null; rows: number }>('resolveRows', 'nobody@globex.test');
    expect(miss.ent).toBeNull();
    expect(miss.rows).toBeLessThanOrEqual(1);
  });

  it('the class answers the methods over RPC after an evict', async () => {
    await live.platform('register', {
      row: {
        id: 'ent_002', address: 'globex', name: 'Globex', nameAr: 'جلوبكس', state: 'active', limits: { people: null, storageBytes: null },
        createdAt: '2026-11-08T08:00:00.000Z', firstAdmin: { name: 'Hana', email: 'hana@globex.test' },
      },
      emails: ['hana@globex.test'],
    });
    await live.evictPlatform();
    expect(await live.platform('listed')).toEqual(['ent_002']);
    expect(await live.platform('resolveEmail', { email: 'hana@globex.test' })).toEqual({ ent: 'ent_002' });
    expect(await live.platform('resolveAddress', { address: 'globex' })).toEqual({ ent: 'ent_002' });
    expect(await live.platform('health')).toEqual({ schema: 4 });
  });

  it('refuses an unknown email like a wrong password, with real crypto', async () => {
    const answer = await live.platform<{ ok: boolean; error?: { details?: { reason?: string } } }>('refuseSignin', {
      signin: 'auth.password', input: { email: 'ghost@globex.test', password: 'a wrong password', address: '203.0.113.9' },
    });
    expect(answer).toMatchObject({ ok: false, error: { details: { reason: 'invalid_credentials' } } });
  });

  it('hitAddress counts the address over RPC and keeps the count after an evict', async () => {
    for (let i = 0; i < 10; i += 1) expect(await live.platform('hitAddress', { step: 'forgot', address: '203.0.113.44' })).toEqual({ ok: true });
    await live.evictPlatform();
    expect(await live.platform('hitAddress', { step: 'forgot', address: '203.0.113.44' })).toMatchObject({ ok: false });
    expect(await live.platform('hitAddress', { step: 'renew', address: '203.0.113.44' })).toEqual({ ok: true });
  });

  it('platform accounts: create, sign in with real PBKDF2, rotate a refresh token after an evict, and sign out', async () => {
    const made = await live.platform<{ id: string }>('platformAccounts', { action: 'create', email: 'owner@madar.test', name: 'The Owner', password: 'a good long password' });
    expect(made.id).toMatch(/^pla_\d{3,}$/);
    const signed = await live.platform<{ access_token: string; refresh_token: string; expires_in: number }>('platformSignIn', { email: 'owner@madar.test', password: 'a good long password', address: '203.0.113.50' });
    expect(signed.expires_in).toBe(900);
    await live.evictPlatform();
    const again = await live.platform<{ access_token: string; refresh_token: string }>('platformRefresh', { refreshToken: signed.refresh_token });
    expect(again.refresh_token).not.toBe(signed.refresh_token);
    const sid = JSON.parse(atob(again.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sid as string;
    await live.platform('platformSignOut', { sessionId: sid });
    expect(await live.platform('platformAccount', { accountId: made.id })).toMatchObject({ state: 'active', email: 'owner@madar.test' });
  });
});
