import { describe, expect, it } from 'vitest';
import { ADDRESS_NAME } from '../../../server/enterprise/ids';
import { fakePlatform } from '../platformFake';
import { ADDRESS_NAME_RULE, EnterpriseView, PLATFORM_CALL_NAMES, platformContracts } from './platform';

const admin = { name: 'Sara', email: 'sara@acme.test', language: 'en' as const };
const limits = { people: 5, storageBytes: 1024 };
const create = (address: string) => platformContracts['platform.enterprises.create'].input.safeParse({ name: 'Acme', nameAr: 'أكمي', address, limits, admin });

describe('the platform contract', () => {
  it('names the 8 calls in order', () => {
    expect([...PLATFORM_CALL_NAMES]).toEqual([
      'platform.me', 'platform.enterprises.list', 'platform.enterprises.create', 'platform.enterprises.update',
      'platform.enterprises.pause', 'platform.enterprises.resume', 'platform.enterprises.resendInvite', 'platform.meter.get',
    ]);
    expect(Object.keys(platformContracts)).toEqual([...PLATFORM_CALL_NAMES]);
  });

  it('checks the address name of a new enterprise', () => {
    for (const bad of ['A', 'ab', '1abc', 'ab_c', 'a'.repeat(33)]) expect({ bad, ok: create(bad).success }).toEqual({ bad, ok: false });
    for (const good of ['vados', 'acme-co']) expect({ good, ok: create(good).success }).toEqual({ good, ok: true });
  });

  it('keeps the address rule in step with the server rule', () => expect(ADDRESS_NAME_RULE.source).toBe(ADDRESS_NAME.source));

  it('refuses a key that is not a field of a patch (the state changes only through pause and resume)', () => {
    const input = platformContracts['platform.enterprises.update'].input;
    expect(input.safeParse({ id: 'ent_002', patch: { name: 'New' } }).success).toBe(true);
    expect(input.safeParse({ id: 'ent_002', patch: { state: 'paused' } }).success).toBe(false);
  });

  it('pins the 14 keys of a row: no person data', () => {
    expect(Object.keys(EnterpriseView.shape).sort()).toEqual([
      'address', 'createdAt', 'firstAdmin', 'hasOwner', 'id', 'invited', 'lastWriteAt', 'limits', 'logo', 'name', 'nameAr', 'people', 'state', 'storageBytes',
    ]);
  });

  it('takes only picture data as a logo', () => {
    const input = platformContracts['platform.enterprises.update'].input;
    expect(input.safeParse({ id: 'ent_002', patch: { logo: 'data:image/png;base64,AAAA' } }).success).toBe(true);
    expect(input.safeParse({ id: 'ent_002', patch: { logo: null } }).success).toBe(true);
    expect(input.safeParse({ id: 'ent_002', patch: { logo: 'http://x' } }).success).toBe(false);
    expect(input.safeParse({ id: 'ent_002', patch: { logo: 'data:text/html;base64,AAAA' } }).success).toBe(false);
  });

  it('keeps the fake closed: every method answers not_found', async () => {
    for (const name of PLATFORM_CALL_NAMES) {
      await expect((fakePlatform[name] as (input: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ code: 'not_found' });
    }
  });
});
