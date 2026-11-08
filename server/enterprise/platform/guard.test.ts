import { describe, expect, it } from 'vitest';
import { ownerOf } from './guard';

const people: Record<string, { userId: string } | null> = { 'ent_001/a-owner': { userId: 'usr_001' }, 'ent_001/a-admin': { userId: 'usr_002' }, 'ent_001/a-off': null, 'ent_002/a-boss': { userId: 'usr_001' } };
const office = (ent: string) => ({
  person: async ({ authUserId }: { authUserId: string }) => {
    const found = people[`${ent}/${authUserId}`];
    if (found === undefined) throw new Error('The object has no such person.');
    return found;
  },
});
const platform = (pairs: [string, string][]) => ({ isOwner: async ({ ent, userId }: { ent: string; userId: string }) => pairs.some(([e, u]) => e === ent && u === userId) });

describe('ownerOf', () => {
  it('passes a platform owner', async () => {
    expect(await ownerOf({ token: { authUserId: 'a-owner', ent: 'ent_001' }, office, platform: platform([['ent_001', 'usr_001']]) })).toEqual({ ent: 'ent_001', userId: 'usr_001' });
  });

  it('gives null for an Admin who is no owner', async () => {
    expect(await ownerOf({ token: { authUserId: 'a-admin', ent: 'ent_001' }, office, platform: platform([['ent_001', 'usr_001']]) })).toBeNull();
  });

  it('gives null for a person of another enterprise with the same person id', async () => {
    // usr_001 of ent_002 is not the owner: only the pair (ent_001, usr_001) is.
    expect(await ownerOf({ token: { authUserId: 'a-boss', ent: 'ent_002' }, office, platform: platform([['ent_001', 'usr_001']]) })).toBeNull();
  });

  it('gives null for a turned-off or removed owner with a good token (person gives null), and for an object that throws', async () => {
    const pairs: [string, string][] = [['ent_001', 'usr_001']];
    expect(await ownerOf({ token: { authUserId: 'a-off', ent: 'ent_001' }, office, platform: platform(pairs) })).toBeNull();
    expect(await ownerOf({ token: { authUserId: 'nobody', ent: 'ent_001' }, office, platform: platform(pairs) })).toBeNull();
  });
});
