import { expect } from 'vitest';

/** A ZIP file read back for the tests of the "Download all" buttons (fbk_050). It trusts nothing from the writer but the bytes. */
export type Parsed = { name: string; bytes: Uint8Array; crc: number; flags: number; method: number; dosTime: number; dosDate: number; offset: number };

export async function parseZip(blob: Blob): Promise<{ entries: Parsed[]; total: number; directoryOffset: number; directorySize: number }> {
  const all = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(all.buffer);
  const end = all.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const total = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(total);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  expect(directoryOffset + directorySize).toBe(end);
  expect(view.getUint16(end + 20, true)).toBe(0);
  const entries: Parsed[] = [];
  let at = directoryOffset;
  for (let i = 0; i < total; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const dosTime = view.getUint16(at + 12, true);
    const dosDate = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const csize = view.getUint32(at + 20, true);
    const usize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(all.subarray(at + 46, at + 46 + nameLength));
    // The local header must say the same as the central one.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 6, true)).toBe(flags);
    expect(view.getUint16(offset + 8, true)).toBe(method);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    expect(view.getUint32(offset + 18, true)).toBe(csize);
    expect(view.getUint32(offset + 22, true)).toBe(usize);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    expect(localName).toBe(nameLength);
    const start = offset + 30 + localName + localExtra;
    expect(csize).toBe(usize);
    entries.push({ name, bytes: all.slice(start, start + usize), crc, flags, method, dosTime, dosDate, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  expect(at).toBe(end);
  return { entries, total, directoryOffset, directorySize };
}
