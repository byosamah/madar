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
    await live.platform('setOwners', { owners: [{ ent: 'ent_002', userId: 'usr_001' }] });
    await live.evictPlatform();
    expect(await live.platform('listed')).toEqual(['ent_002']);
    expect(await live.platform('resolveEmail', { email: 'hana@globex.test' })).toEqual({ ent: 'ent_002' });
    expect(await live.platform('resolveAddress', { address: 'globex' })).toEqual({ ent: 'ent_002' });
    expect(await live.platform('isOwner', { ent: 'ent_002', userId: 'usr_001' })).toBe(true);
    expect(await live.platform('health')).toEqual({ schema: 1 });
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
});
