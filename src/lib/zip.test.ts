import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseZip } from '../test/zipRead';
import { crc32, crc32Update, makeZip, safeFileName, uniqueNames, ZipTooLargeError } from './zip';

const text = (value: string) => new Blob([value], { type: 'text/plain' });

describe('crc32', () => {
  it('gives the known value for "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('gives 0 for no bytes', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('gives the same value in parts as in one piece', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) % 256);
    let running = 0;
    running = crc32Update(running, bytes.subarray(0, 333));
    running = crc32Update(running, bytes.subarray(333));
    expect(running).toBe(crc32(bytes));
    expect(running).toBe(nodeCrc32(bytes));
  });
});

describe('safeFileName', () => {
  it('replaces the characters that a file system refuses with a dash', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('keeps Arabic letters and spaces', () => {
    expect(safeFileName('مخطط الموقع 1.pdf')).toBe('مخطط الموقع 1.pdf');
  });

  it('gives a name to an empty name', () => {
    expect(safeFileName('   ')).toBe('file');
  });
});

describe('uniqueNames', () => {
  it('keeps names that differ', () => {
    expect(uniqueNames(['a.pdf', 'b.pdf'])).toEqual(['a.pdf', 'b.pdf']);
  });

  it('adds (2) and (3) before the extension of a name that repeats', () => {
    expect(uniqueNames(['Plan.pdf', 'Plan.pdf', 'Plan.pdf'])).toEqual(['Plan.pdf', 'Plan (2).pdf', 'Plan (3).pdf']);
  });

  it('adds the number at the end of a name with no extension', () => {
    expect(uniqueNames(['Notes', 'Notes'])).toEqual(['Notes', 'Notes (2)']);
  });

  it('counts a letter case difference as the same name', () => {
    expect(uniqueNames(['A.PDF', 'a.pdf'])).toEqual(['A.PDF', 'a (2).pdf']);
  });

  it('does not make a name that another file already has', () => {
    expect(uniqueNames(['Plan.pdf', 'Plan (2).pdf', 'Plan.pdf'])).toEqual(['Plan.pdf', 'Plan (2).pdf', 'Plan (3).pdf']);
  });

  it('treats a leading dot as part of the name, not as an extension', () => {
    expect(uniqueNames(['.env', '.env'])).toEqual(['.env', '.env (2)']);
  });
});

describe('makeZip', () => {
  const at = new Date(2026, 9, 22, 14, 30, 8);

  it('writes a ZIP that reads back: names, sizes, bytes and CRC', async () => {
    const zip = await makeZip([
      { name: 'one.txt', blob: text('hello') },
      { name: 'two.bin', blob: new Blob([Uint8Array.from([0, 1, 2, 250, 251, 252])]) },
    ], at);
    expect(zip.type).toBe('application/zip');
    const parsed = await parseZip(zip);
    expect(parsed.total).toBe(2);
    expect(parsed.entries.map((entry) => entry.name)).toEqual(['one.txt', 'two.bin']);
    expect(new TextDecoder().decode(parsed.entries[0].bytes)).toBe('hello');
    expect([...parsed.entries[1].bytes]).toEqual([0, 1, 2, 250, 251, 252]);
    for (const entry of parsed.entries) {
      expect(entry.method).toBe(0);
      expect(entry.crc).toBe(nodeCrc32(entry.bytes));
    }
  });

  it('writes the CRC of a file that is larger than one read', async () => {
    const big = Uint8Array.from({ length: 9 * 1024 * 1024 + 17 }, (_, i) => (i * 31 + 5) % 251);
    const parsed = await parseZip(await makeZip([{ name: 'big.bin', blob: new Blob([big]) }], at));
    expect(parsed.entries[0].bytes.length).toBe(big.length);
    expect(parsed.entries[0].crc).toBe(nodeCrc32(big));
  });

  it('writes Arabic names as UTF-8 and sets the language flag', async () => {
    const parsed = await parseZip(await makeZip([{ name: 'مخطط الموقع.pdf', blob: text('x') }], at));
    expect(parsed.entries[0].name).toBe('مخطط الموقع.pdf');
    expect(parsed.entries[0].flags & 0x0800).toBe(0x0800);
  });

  it('keeps an empty file', async () => {
    const parsed = await parseZip(await makeZip([{ name: 'empty.txt', blob: new Blob([]) }], at));
    expect(parsed.entries[0].bytes.length).toBe(0);
    expect(parsed.entries[0].crc).toBe(0);
  });

  it('gives the names of a repeat a number', async () => {
    const parsed = await parseZip(await makeZip([
      { name: 'Plan.pdf', blob: text('a') },
      { name: 'Plan.pdf', blob: text('b') },
    ], at));
    expect(parsed.entries.map((entry) => entry.name)).toEqual(['Plan.pdf', 'Plan (2).pdf']);
  });

  it('writes the time of the given date in DOS form', async () => {
    const parsed = await parseZip(await makeZip([{ name: 'a.txt', blob: text('a') }], at));
    const { dosDate, dosTime } = parsed.entries[0];
    expect(((dosDate >> 9) & 0x7f) + 1980).toBe(2026);
    expect((dosDate >> 5) & 0x0f).toBe(10);
    expect(dosDate & 0x1f).toBe(22);
    expect((dosTime >> 11) & 0x1f).toBe(14);
    expect((dosTime >> 5) & 0x3f).toBe(30);
    expect((dosTime & 0x1f) * 2).toBe(8);
  });

  it('writes a valid ZIP for no files', async () => {
    const parsed = await parseZip(await makeZip([], at));
    expect(parsed.total).toBe(0);
  });

  it('keeps a path character out of a name inside the ZIP', async () => {
    const parsed = await parseZip(await makeZip([{ name: '../up/x.txt', blob: text('x') }], at));
    expect(parsed.entries[0].name).toBe('..-up-x.txt');
  });

  it('refuses a total of 4 GB or more, with a clear error', async () => {
    const huge = { size: 0xffffffff, slice: () => new Blob([]), type: '' } as unknown as Blob;
    await expect(makeZip([{ name: 'huge.bin', blob: huge }], at)).rejects.toBeInstanceOf(ZipTooLargeError);
    const half = { size: 2_500_000_000, slice: () => new Blob([]), type: '' } as unknown as Blob;
    await expect(makeZip([{ name: 'a', blob: half }, { name: 'b', blob: half }], at)).rejects.toThrow(/4 GB/);
  });
});
