import { describe, expect, it } from 'vitest';
import { makeZip } from '../../../lib/zip';
import { deflateSync } from 'fflate';
import { storeZip } from './officeFixtures';
import { checkZip, unpackZip, ZIP_LIMITS } from './zipGuard';

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

/** A small limit set, so a test makes a bomb of a few MB and not of 150 MB. */
const SMALL = { entries: 50, entryBytes: 1024 * 1024, totalBytes: 2 * 1024 * 1024 };
const bytes = (value: string) => new TextEncoder().encode(value);
const zeros = (size: number) => new Uint8Array(size);
const deflated = (name: string, data: Uint8Array, extra: { declared?: number; localDeclared?: number } = {}) => ({ name, data, packed: deflateSync(data), ...extra });

describe('checkZip trusts no declared size (a zip bomb, tsk_495 review)', () => {
  it('says "big" for a part that unpacks to more than the limit while its header declares a small size', () => {
    const bomb = storeZip([deflated('a.xml', zeros(3 * 1024 * 1024), { declared: 100 })]);
    expect(checkZip(bomb, SMALL)).toBe('big');
  });

  it('says "big" when the real output of all parts passes the total limit, although the declared sizes fit', () => {
    const limits = { entries: 50, entryBytes: 1024 * 1024, totalBytes: 1.5 * 1024 * 1024 };
    const honest = deflated('a.xml', zeros(900 * 1024));
    const liar = deflated('b.xml', zeros(900 * 1024), { declared: 100, localDeclared: 100 });
    expect(checkZip(storeZip([honest, liar]), limits)).toBe('big');
  });

  it('stops the unpack at the limit and does not inflate the whole bomb', () => {
    const bomb = storeZip([deflated('a.xml', zeros(40 * 1024 * 1024), { declared: 100 })]);
    const started = Date.now();
    expect(checkZip(bomb, SMALL)).toBe('big');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('says "bad" when the local header and the central directory declare different sizes', () => {
    const data = bytes('<a>hello</a>');
    expect(checkZip(storeZip([{ name: 'a.xml', data, localDeclared: data.length + 5 }]), SMALL)).toBe('bad');
  });

  it('says "bad" when the real unpacked size is not the declared size', () => {
    const data = bytes('<a>hello</a>'.repeat(50));
    expect(checkZip(storeZip([{ ...deflated('a.xml', data), declared: data.length - 3, localDeclared: data.length - 3 }]), SMALL)).toBe('bad');
  });

  it('says "bad" for a compression method that is not STORE or DEFLATE', () => {
    const zip = storeZip([{ name: 'a.xml', data: bytes('<a/>') }]);
    const view = new DataView(zip);
    for (let i = 0; i < zip.byteLength - 4; i += 1) {
      if (view.getUint32(i, true) === 0x04034b50) view.setUint16(i + 8, 12, true);
      if (view.getUint32(i, true) === 0x02014b50) view.setUint16(i + 10, 12, true);
    }
    expect(checkZip(zip, SMALL)).toBe('bad');
  });

  it('accepts a real deflated file', () => {
    const data = bytes('<sheet>'.repeat(5000));
    expect(checkZip(storeZip([deflated('a.xml', data), deflated('b.xml', data)]), SMALL)).toBe('ok');
  });
});

describe('unpackZip', () => {
  it('gives the unpacked bytes of the parts that the caller wants, and drops the others', () => {
    const data = bytes('<sheet>'.repeat(300));
    const zip = storeZip([deflated('xl/a.xml', data), { name: 'media/p.png', data: bytes('PNG') }, { name: 'xl/b.xml', data: bytes('<b/>') }]);
    const out = unpackZip(zip, { want: (name) => name.endsWith('.xml'), limits: SMALL });
    if (out.kind !== 'ok') throw new Error(`Expected ok, got ${out.kind}.`);
    expect(Object.keys(out.entries).sort()).toEqual(['xl/a.xml', 'xl/b.xml']);
    expect(new TextDecoder().decode(out.entries['xl/a.xml'])).toBe('<sheet>'.repeat(300));
  });

  it('says "big" for a bomb, also for a part that the caller does not want', () => {
    const bomb = storeZip([deflated('media/p.png', zeros(3 * 1024 * 1024), { declared: 100 })]);
    expect(unpackZip(bomb, { want: () => false, limits: SMALL }).kind).toBe('big');
  });
});
