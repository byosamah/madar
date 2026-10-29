import { describe, expect, it } from 'vitest';
import { makeZip } from '../../../lib/zip';
import { checkZip, ZIP_LIMITS } from './zipGuard';

const text = (value: string, type = 'text/plain') => new Blob([value], { type });
const zipOf = async (entries: { name: string; blob: Blob }[]) => (await makeZip(entries)).arrayBuffer();

/** Writes a number into the first central directory record of a ZIP file: the declared size of its first file. */
function declareSize(buffer: ArrayBuffer, offsetInRecord: number, value: number) {
  const view = new DataView(buffer);
  for (let i = 0; i < buffer.byteLength - 4; i += 1) {
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + offsetInRecord, value, true);
      return;
    }
  }
  throw new Error('No central directory record.');
}

describe('checkZip (tsk_495): a Word or Excel file is a ZIP file, and a small file can unpack to a huge one', () => {
  it('accepts a normal ZIP file', async () => {
    expect(checkZip(await zipOf([{ name: 'a.xml', blob: text('<a/>') }, { name: 'b.xml', blob: text('<b/>') }]))).toBe('ok');
  });

  it('says "bad" for bytes that are no ZIP file, an empty buffer and a cut file', async () => {
    expect(checkZip(new TextEncoder().encode('Hello, this is not a ZIP file at all.').buffer as ArrayBuffer)).toBe('bad');
    expect(checkZip(new ArrayBuffer(0))).toBe('bad');
    const whole = await zipOf([{ name: 'a.xml', blob: text('<a/>') }]);
    expect(checkZip(whole.slice(0, whole.byteLength - 10))).toBe('bad');
  });

  it('says "big" when one file declares more than the limit for one file', async () => {
    const zip = await zipOf([{ name: 'a.xml', blob: text('<a/>') }]);
    declareSize(zip, 24, ZIP_LIMITS.entryBytes + 1);
    expect(checkZip(zip)).toBe('big');
  });

  it('says "big" when the files together declare more than the limit in total', async () => {
    const zip = await zipOf(Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.xml`, blob: text('<a/>') })));
    const view = new DataView(zip);
    const each = Math.floor(ZIP_LIMITS.totalBytes / 3);
    let seen = 0;
    for (let i = 0; i < zip.byteLength - 4; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, each, true);
        seen += 1;
      }
    }
    expect(seen).toBe(4);
    expect(checkZip(zip)).toBe('big');
  });

  it('says "big" for a ZIP64 marker and for too many files', async () => {
    const zip = await zipOf([{ name: 'a.xml', blob: text('<a/>') }]);
    declareSize(zip, 24, 0xffffffff);
    expect(checkZip(zip)).toBe('big');
    const many = await zipOf(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({ name: `f${i}.xml`, blob: text('x') })));
    expect(checkZip(many)).toBe('big');
  });
});
