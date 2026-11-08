import { describe, expect, it } from 'vitest';
import { RESERVED_ADDRESSES } from '../../server/enterprise/ids';
import { PLATFORM_CALL_NAMES, platformContracts, type PlatformCallName } from './contract/platform';
import { defaultDirectory, memoryDirectory } from './fakeDirectory';
import { createPlatformFake, platformApiOf, RESERVED_FAKE_ADDRESSES } from './platformFake';

const NOW = new Date('2026-11-08T09:00:00Z');
const admin = { name: 'Sami Hakim', email: 'sami@acme.test', language: 'en' as const };
const limits = { people: 5, storageBytes: 1024 };
const create = { name: 'Acme', nameAr: 'أكمي', address: 'acme', limits, admin };

function setup(ownerMode = true) {
  const dir = memoryDirectory(defaultDirectory('2026-11-08'));
  const fake = createPlatformFake(dir, () => NOW, { ownerMode: () => ownerMode });
  return { dir, fake };
}

describe('the platform fake', () => {
  it('answers every one of the eight names in the shape of the contract', async () => {
    const { fake } = setup();
    const inputs: Record<PlatformCallName, unknown> = {
      'platform.me': {},
      'platform.enterprises.list': {},
      'platform.enterprises.create': create,
      'platform.enterprises.update': { id: 'ent_002', patch: { name: 'Oasis' } },
      'platform.enterprises.pause': { id: 'ent_002', confirmName: 'Oasis' },
      'platform.enterprises.resume': { id: 'ent_002' },
      'platform.enterprises.resendInvite': { id: 'ent_003' },
      'platform.meter.get': {},
    };
    expect(Object.keys(inputs)).toEqual([...PLATFORM_CALL_NAMES]);
    for (const name of PLATFORM_CALL_NAMES) {
      const out = await fake(name, inputs[name]);
      expect(platformContracts[name].output.safeParse(out).success).toBe(true);
    }
  });

  it('answers me with the owner only in the mode Platform owner', async () => {
    expect(await setup(true).fake('platform.me', {})).toEqual({ owner: true, ent: 'ent_001', createOpen: true });
    await expect(setup(false).fake('platform.me', {})).rejects.toMatchObject({ code: 'not_found' });
  });

  it('answers not_found for every call when the mode is off', async () => {
    const { fake } = setup(false);
    for (const name of PLATFORM_CALL_NAMES) await expect(fake(name, {})).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lists the two enterprises with no email of the directory', async () => {
    const rows = (await setup().fake('platform.enterprises.list', {})) as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual(['ent_001', 'ent_002']);
    expect(rows.map((row) => row.hasOwner)).toEqual([true, false]);
    for (const row of rows) expect(row).not.toHaveProperty('emails');
  });

  it('creates an enterprise with the next id, and a second create with the same address is refused', async () => {
    const { fake } = setup();
    expect(await fake('platform.enterprises.create', create)).toMatchObject({ id: 'ent_003', address: 'acme', state: 'active', invited: 1, firstAdmin: { email: 'sami@acme.test' } });
    await expect(fake('platform.enterprises.create', { ...create, admin: { ...admin, email: 'other@acme.test' } })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['address'], reason: 'address_taken' },
    });
  });

  it('refuses a reserved address name', async () => {
    await expect(setup().fake('platform.enterprises.create', { ...create, address: 'admin' })).rejects.toMatchObject({ details: { reason: 'address_taken' } });
  });

  it('keeps the reserved words in step with the server', () => expect([...RESERVED_FAKE_ADDRESSES]).toEqual([...RESERVED_ADDRESSES]));

  it('create refuses a taken email without naming the other enterprise', async () => {
    const { fake } = setup();
    for (const email of ['hala.nasser@madar.test', ' Layla.Hassan@Oasis.test ']) {
      const error = await fake('platform.enterprises.create', { ...create, admin: { ...admin, email } }).catch((one: unknown) => one);
      expect(error).toMatchObject({ code: 'invalid_input', details: { fields: ['admin.email'], reason: 'email_taken' } });
      const text = JSON.stringify([(error as Error).message, (error as { details: unknown }).details]);
      expect(text).not.toMatch(/vado|oasis|ent_00/i);
    }
  });

  it('pause is refused for the enterprise of the owner', async () => {
    await expect(setup().fake('platform.enterprises.pause', { id: 'ent_001', confirmName: "VADOs' Companies" })).rejects.toMatchObject({
      code: 'forbidden', details: { reason: 'owner_enterprise' },
    });
  });

  it('pause needs the typed name, in English or in Arabic', async () => {
    const { fake } = setup();
    await expect(fake('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Oas' })).rejects.toMatchObject({ details: { reason: 'name_mismatch' } });
    expect(await fake('platform.enterprises.pause', { id: 'ent_002', confirmName: ' واحة للإنشاءات ' })).toMatchObject({ state: 'paused' });
  });

  it('resume reverses pause, and a paused enterprise takes no update', async () => {
    const { fake } = setup();
    await fake('platform.enterprises.pause', { id: 'ent_002', confirmName: 'Oasis Builders' });
    await expect(fake('platform.enterprises.update', { id: 'ent_002', patch: { name: 'X' } })).rejects.toMatchObject({ details: { reason: 'enterprise_paused' } });
    expect(await fake('platform.enterprises.resume', { id: 'ent_002' })).toMatchObject({ state: 'active' });
    expect(await fake('platform.enterprises.update', { id: 'ent_002', patch: { name: 'Oasis', limits: { people: 20 } } })).toMatchObject({
      name: 'Oasis', limits: { people: 20, storageBytes: 1_073_741_824 },
    });
  });

  it('keeps a change in the directory', async () => {
    const { dir, fake } = setup();
    await fake('platform.enterprises.update', { id: 'ent_002', patch: { nameAr: 'واحة' } });
    expect(dir.read().enterprises[1].nameAr).toBe('واحة');
  });

  it('resendInvite answers ok only for an Admin who has not signed in', async () => {
    const { fake } = setup();
    await expect(fake('platform.enterprises.resendInvite', { id: 'ent_002' })).rejects.toMatchObject({ details: { reason: 'already_accepted' } });
    await fake('platform.enterprises.create', create);
    expect(await fake('platform.enterprises.resendInvite', { id: 'ent_003' })).toEqual({ sentAt: NOW.toISOString() });
    await expect(fake('platform.enterprises.resendInvite', { id: 'ent_099' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('meter.get answers fixed Free-plan numbers whose total is the sum of the enterprises', async () => {
    const out = (await setup().fake('platform.meter.get', {})) as { day: string; limits: { requests: number; mails: number }; total: { requests: number }; enterprises: { day: { requests: number } }[]; stop: boolean };
    expect(out.day).toBe('2026-11-08');
    expect(out.limits).toMatchObject({ requests: 100_000, mails: 100 });
    expect(out.total.requests).toBe(out.enterprises.reduce((sum, row) => sum + row.day.requests, 0));
    expect(out.stop).toBe(false);
  });

  it('refuses a bad input with invalid_input and an unknown name with not_found', async () => {
    const { fake } = setup();
    await expect(fake('platform.enterprises.create', { name: 'x' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(fake('platform.enterprises.nope' as PlatformCallName, {})).rejects.toMatchObject({ code: 'not_found' });
  });

  it('builds the api object with one method for each name', async () => {
    const api = platformApiOf(setup().fake);
    expect(Object.keys(api)).toEqual([...PLATFORM_CALL_NAMES]);
    expect((await api['platform.enterprises.list']({})).length).toBe(2);
  });
});
