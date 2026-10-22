/**
 * A small ZIP writer for the "Download all" buttons (fbk_050). It runs in the browser and has no package.
 * It uses the STORE method only: drawings and photos are compressed already, so a second pass would cost time and save nothing.
 * It writes UTF-8 names (general purpose bit 11), so Arabic names stay right. It has no ZIP64, so the whole file must stay under 4 GB.
 * The output is a Blob made from parts. Each stored file keeps its own Blob, so a big set never needs one large array.
 */

/** The error for a set of files that does not fit in a ZIP file without ZIP64. */
export class ZipTooLargeError extends Error {
  constructor() {
    super('The files are larger than 4 GB in total. A ZIP file cannot hold them.');
    this.name = 'ZipTooLargeError';
  }
}

export type ZipEntry = { name: string; blob: Blob };

const LIMIT = 0xffffffff;
/** The most entries that the end record counts without ZIP64. */
const MAX_ENTRIES = 0xfffe;
/** A file is read in pieces of this size to compute its CRC, so only one piece is in memory at a time. */
const PIECE = 4 * 1024 * 1024;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Continues a CRC-32 over more bytes. Start with 0 and give the result back for the next piece. */
export function crc32Update(previous: number, bytes: Uint8Array): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The CRC-32 of the bytes (the check value of "123456789" is 0xCBF43926). */
export function crc32(bytes: Uint8Array): number {
  return crc32Update(0, bytes);
}

/** A name that every file system accepts: the characters / \ : * ? " < > | and the control characters become a dash. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim();
  return clean === '' ? 'file' : clean;
}

/** Gives a repeated name " (2)", " (3)" before its extension. Two names that differ only in letter case count as the same name. */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot) : '';
      let n = 2;
      do {
        candidate = `${stem} (${n})${extension}`;
        n += 1;
      } while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** The DOS date and time of a moment (local time, 2 second steps). A year before 1980 becomes 1980-01-01. */
function dosStamp(at: Date): { time: number; date: number } {
  if (at.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

async function crcOf(blob: Blob): Promise<number> {
  let crc = 0;
  for (let from = 0; from < blob.size; from += PIECE) {
    crc = crc32Update(crc, new Uint8Array(await blob.slice(from, from + PIECE).arrayBuffer()));
  }
  return crc;
}

/**
 * Puts the files into one ZIP file. The files keep their order. A name that repeats gets a number, and a name with a path character
 * gets a dash in its place. It throws ZipTooLargeError before it reads any file when the result would need ZIP64.
 */
export async function makeZip(entries: ZipEntry[], at: Date = new Date()): Promise<Blob> {
  const encoder = new TextEncoder();
  const names = uniqueNames(entries.map((entry) => safeFileName(entry.name))).map((name) => encoder.encode(name));
  let total = 22;
  for (let i = 0; i < entries.length; i += 1) total += 30 + 46 + 2 * names[i].length + entries[i].blob.size;
  if (total > LIMIT || entries.length > MAX_ENTRIES) throw new ZipTooLargeError();

  const stamp = dosStamp(at);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const { blob } = entries[i];
    const name = names[i];
    const crc = await crcOf(blob);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, blob.size, true);
    lv.setUint32(22, blob.size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, blob);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, blob.size, true);
    cv.setUint32(24, blob.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);

    offset += local.length + blob.size;
  }

  const directorySize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
