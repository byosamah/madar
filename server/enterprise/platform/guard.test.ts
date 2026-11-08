import { describe, expect, it } from 'vitest';
import { platformCaller } from './guard';

const accounts: Record<string, { id: string; name: string; email: string; state: 'active' | 'off' }> = {
  pla_001: { id: 'pla_001', name: 'Owner', email: 'owner@madar.test', state: 'active' },
  pla_002: { id: 'pla_002', name: 'Off', email: 'off@madar.test', state: 'off' },
};
const platform = { platformAccount: async ({ accountId }: { accountId: string }) => accounts[accountId] ?? null };
const failure = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    const e = error as { code: string; message: string; details: Record<string, unknown> };
    return { code: e.code, message: e.message, reason: e.details?.reason };
  }
  throw new Error('The guard did not fail.');
};

describe('platformCaller', () => {
  it('passes an account that is on', async () => {
    expect(await platformCaller({ token: { accountId: 'pla_001', sessionId: 's-1' }, platform })).toEqual({ accountId: 'pla_001', name: 'Owner', email: 'owner@madar.test' });
  });

  it('refuses an account that is off with account_off', async () => {
    expect(await failure(platformCaller({ token: { accountId: 'pla_002', sessionId: 's-1' }, platform }))).toMatchObject({ code: 'unauthenticated', reason: 'account_off' });
  });

  it('refuses an unknown account with the answer of a bad token', async () => {
    expect(await failure(platformCaller({ token: { accountId: 'pla_099', sessionId: 's-1' }, platform }))).toEqual({ code: 'unauthenticated', message: 'Sign in to continue.', reason: undefined });
  });

  it('asks the platform object only: it takes no company object', async () => {
    // The guard has no company input at all, so a company object cannot be called from it.
    expect(platformCaller.length).toBe(1);
  });
});
