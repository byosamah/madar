import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { ApiError } from '../../src/api/errors';
import { snapshotOf } from '../data/officeCache';
import { OFFICE_COLLECTIONS, type OfficeCollection } from './types';
import { resolveActor } from './actor';

const human = (id: string, active = true): User => ({ id, kind: 'human', active, ownerId: null, name: id } as unknown as User);
const agent = (id: string, ownerId: string | null, active = true): User => ({ id, kind: 'agent', active, ownerId, name: id } as unknown as User);

function office(users: User[]) {
  const lists = Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, {}])) as Record<OfficeCollection, unknown>;
  lists.users = Object.fromEntries(users.map((u) => [u.id, u]));
  return snapshotOf(lists as never, 1);
}

function refusal(work: () => unknown): ApiError {
  try {
    work();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('It did not refuse.');
}

describe('resolveActor (plan 4.5, the actor)', () => {
  const snap = office([human('usr_001'), human('usr_002', false), agent('usr_009', 'usr_001'), agent('usr_010', 'usr_002'), agent('usr_011', null), agent('usr_012', 'usr_001', false)]);

  it('gives the active person of a principal', () => {
    expect(resolveActor(snap, { userId: 'usr_001' }).id).toBe('usr_001');
  });

  it('refuses a person that is missing or turned off with unauthenticated and the reason account_off', () => {
    for (const userId of ['usr_404', 'usr_002']) {
      const error = refusal(() => resolveActor(snap, { userId }));
      expect([error.code, error.details.reason]).toEqual(['unauthenticated', 'account_off']);
    }
  });

  it('gives an agent whose owner is an active person', () => {
    expect(resolveActor(snap, { userId: 'usr_009', agent: { clientId: 'cli-a' } }).id).toBe('usr_009');
  });

  it('refuses an agent whose owner is off or missing, and an agent that is off', () => {
    for (const userId of ['usr_010', 'usr_011', 'usr_012']) {
      const error = refusal(() => resolveActor(snap, { userId, agent: { clientId: 'cli-a' } }));
      expect([error.code, error.details.reason], userId).toEqual(['unauthenticated', 'account_off']);
    }
  });

  it('refuses a principal whose kind does not match the user: a browser sign-in of an agent, an agent token of a person', () => {
    expect(refusal(() => resolveActor(snap, { userId: 'usr_009' })).code).toBe('forbidden');
    expect(refusal(() => resolveActor(snap, { userId: 'usr_001', agent: { clientId: 'cli-a' } })).code).toBe('forbidden');
  });
});
