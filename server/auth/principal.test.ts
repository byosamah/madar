import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { ApiError } from '../../src/api/errors';
import { snapshotOf } from '../data/officeCache';
import { OFFICE_COLLECTIONS, type OfficeCollection } from '../core/types';
import { principalOf } from './principal';

const human = (id: string, active = true): User => ({ id, kind: 'human', active, ownerId: null, name: id } as unknown as User);

function office(users: User[], auth: [string, string][]) {
  const lists = Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, {}])) as Record<OfficeCollection, unknown>;
  lists.users = Object.fromEntries(users.map((u) => [u.id, u]));
  return snapshotOf(lists as never, 1, new Map(auth));
}

describe('principalOf (plan 5.1, the person lookup)', () => {
  const snap = office([human('usr_001'), human('usr_002', false), human('usr_003')], [['auth-1', 'usr_001'], ['auth-2', 'usr_002']]);

  it('gives the users row linked to the sign-in, never as an agent', () => {
    expect(principalOf('auth-1', snap)).toEqual({ userId: 'usr_001' });
  });

  it('gives a turned-off person too: runCall refuses that person with account_off (server/core/actor.ts)', () => {
    expect(principalOf('auth-2', snap)).toEqual({ userId: 'usr_002' });
  });

  it('refuses a sign-in that no users row holds with unauthenticated (401)', () => {
    for (const authUserId of ['auth-9', '', 'usr_003']) {
      let error: unknown;
      try {
        principalOf(authUserId, snap);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('unauthenticated');
    }
  });
});
