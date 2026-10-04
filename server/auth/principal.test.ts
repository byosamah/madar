import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { ApiError } from '../../src/api/errors';
import { snapshotOf } from '../data/officeCache';
import { OFFICE_COLLECTIONS, type OfficeCollection } from '../core/types';
import { apiApp } from '../http/app';
import { fakeDeps } from '../test/fakes/deps';
import { principalOf } from './principal';

function thrown(work: () => unknown): unknown {
  try {
    work();
  } catch (e) {
    return e;
  }
  return undefined;
}

const human = (id: string, active = true): User => ({ id, kind: 'human', active, ownerId: null, name: id } as unknown as User);

function office(users: User[], auth: [string, string][]) {
  const lists = Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, {}])) as Record<OfficeCollection, unknown>;
  lists.users = Object.fromEntries(users.map((u) => [u.id, u]));
  return snapshotOf(lists as never, 1, new Map(auth));
}

describe('principalOf (plan 5.1, the person lookup)', () => {
  const agent = { id: 'usr_009', kind: 'agent', active: true, ownerId: 'usr_001', name: 'usr_009' } as unknown as User;
  const snap = office(
    [human('usr_001'), human('usr_002', false), human('usr_003'), agent],
    [['auth-1', 'usr_001'], ['auth-2', 'usr_002'], ['auth-gone', 'usr_404'], ['auth-agent', 'usr_009']],
  );

  it('gives the users row linked to the sign-in, never as an agent', () => {
    expect(principalOf('auth-1', snap)).toEqual({ userId: 'usr_001' });
  });

  it('refuses a turned-off person, or a link to a users row that is gone, with account_off before any call', () => {
    for (const authUserId of ['auth-2', 'auth-gone']) {
      const error = thrown(() => principalOf(authUserId, snap));
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('unauthenticated');
      expect((error as ApiError).details).toMatchObject({ reason: 'account_off' });
    }
  });

  it('refuses a sign-in linked to an agent row with forbidden: a browser sign-in never acts as an agent', () => {
    const error = thrown(() => principalOf('auth-agent', snap));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('forbidden');
  });

  it('makes the real batch route answer 403 account_off for a turned-off person, and runs no call', async () => {
    const runCall = vi.fn();
    const app = apiApp(fakeDeps(), { runCall, verifyToken: async () => ({ authUserId: 'auth-2' }), readOffice: async () => snap });
    const response = await app.fetch(new Request('http://127.0.0.1/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer good' },
      body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'tasks.get', input: {} }] }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthenticated', details: { reason: 'account_off' } } });
    expect(runCall).not.toHaveBeenCalled();
  });

  it('refuses a sign-in that no users row holds with unauthenticated (401)', () => {
    for (const authUserId of ['auth-9', '', 'usr_003']) {
      const error = thrown(() => principalOf(authUserId, snap));
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('unauthenticated');
    }
  });
});
