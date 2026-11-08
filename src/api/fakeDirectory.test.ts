import { describe, expect, it, vi } from 'vitest';
import { defaultDirectory, FakeDirectory, memoryDirectory, openDirectory } from './fakeDirectory';
import { ADDRESS_NAME, ENT_VADO } from '../../server/enterprise/ids';
import { VADO_ENTERPRISE } from './vadoEnterprise';

describe('the fake directory', () => {
  it('has the two companies and no platform owner (design 12, D12)', () => {
    const directory = defaultDirectory('2026-11-08');
    expect(FakeDirectory.safeParse(directory).success).toBe(true);
    expect(directory.enterprises.map((row) => [row.id, row.name, row.nameAr, row.address, row.state])).toEqual([
      ['ent_001', "VADOs' Companies", 'شركات فادو', 'vados', 'active'],
      ['ent_002', 'Oasis Builders', 'واحة للإنشاءات', 'oasis', 'active'],
    ]);
    expect(directory).not.toHaveProperty('owners');
    expect(directory.enterprises.every((row) => row.logo === null)).toBe(true);
  });

  it('uses address names that pass the address rule', () => {
    for (const row of defaultDirectory('2026-11-08').enterprises) expect(ADDRESS_NAME.test(row.address)).toBe(true);
  });

  it('keeps the id of VADOs Companies in step with the server', () => expect(VADO_ENTERPRISE).toBe(ENT_VADO));

  it('holds no email twice', () => {
    const emails = defaultDirectory('2026-11-08').enterprises.flatMap((row) => row.emails);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('keeps a written directory in memory and hands back a copy', async () => {
    const handle = memoryDirectory(defaultDirectory('2026-11-08'));
    const next = structuredClone(handle.read());
    next.enterprises[1].name = 'Changed';
    await handle.write(next);
    next.enterprises[1].name = 'Changed again';
    expect(handle.read().enterprises[1].name).toBe('Changed');
  });

  it('keeps the directory in IndexedDB across opens', async () => {
    const first = await openDirectory('2026-11-08', 'madar-test-directory');
    const next = structuredClone(first.read());
    next.enterprises[1].name = 'Saved';
    await first.write(next);
    expect((await openDirectory('2026-11-08', 'madar-test-directory')).read().enterprises[1].name).toBe('Saved');
  });

  it('gives memory when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try {
      const handle = await openDirectory('2026-11-08', 'madar-test-directory-none');
      expect(handle.read().enterprises).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
