import { Inflate } from 'fflate';

/**
 * The unpack of a ZIP file that trusts no number in it (tsk_495). A Word or Excel file is a ZIP file, and a crafted one can declare a
 * small size and unpack to gigabytes (a zip bomb). So this code:
 * - reads the central directory and refuses a file with too many parts or a declared size above the limits;
 * - compares the local header of each part with the central directory (a part that says two sizes is "bad");
 * - inflates each part in small steps and counts the REAL output. It stops at once when one part or all parts pass the limits, so a bomb
 *   never fills the memory. The real size must also equal the declared size;
 * - keeps the bytes only of the parts that the caller wants (`want`), so a picture that nobody reads costs no memory.
 * It handles STORE (0) and DEFLATE (8). Any other method is "bad". It runs in the worker of the preview (`officeWorker.ts`).
 */
export type ZipCheck = 'ok' | 'bad' | 'big';

export type ZipLimits = { entries: number; entryBytes: number; totalBytes: number };

/** The most that a file may unpack to. A real Word or Excel file is far below all three limits. */
export const ZIP_LIMITS: ZipLimits = { entries: 4000, entryBytes: 80 * 1024 * 1024, totalBytes: 150 * 1024 * 1024 };

export type Unpacked = { kind: 'ok'; entries: Record<string, Uint8Array> } | { kind: 'bad' | 'big' };

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIZE = 22;
/** The end record sits at the end of the file, after a comment of at most 65,535 bytes. */
const MAX_COMMENT = 0xffff;
/**
 * One step of input to the inflater. DEFLATE can expand a step about 1,030 times at most, so one step adds 16 MB of output at most before
 * the count can stop the run.
 */
const STEP = 16 * 1024;

type Part = { name: string; method: number; flags: number; packed: number; unpacked: number; local: number };

/** Thrown inside the inflater to stop it. It never leaves this file. */
class Stop extends Error {
  constructor(readonly reason: 'bad' | 'big') {
    super(reason);
  }
}

/** The parts of the central directory, or 'bad' or 'big' when the directory itself is refused. */
function readDirectory(bytes: ArrayBuffer, limits: ZipLimits): Part[] | 'bad' | 'big' {
  if (bytes.byteLength < END_SIZE) return 'bad';
  const view = new DataView(bytes);
  let end = -1;
  for (let i = bytes.byteLength - END_SIZE; i >= Math.max(0, bytes.byteLength - END_SIZE - MAX_COMMENT); i -= 1) {
    if (view.getUint32(i, true) === END_SIGNATURE) {
      end = i;
      break;
    }
  }
  if (end < 0) return 'bad';
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  // ZIP64 marks its counts and offsets with the largest value. Such a file is larger than the size limit of the preview anyway.
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) return 'big';
  if (count > limits.entries) return 'big';
  if (start + size > end) return 'bad';
  const parts: Part[] = [];
  const decoder = new TextDecoder();
  let total = 0;
  let at = start;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== ENTRY_SIGNATURE) return 'bad';
    const packed = view.getUint32(at + 20, true);
    const unpacked = view.getUint32(at + 24, true);
    if (packed === 0xffffffff || unpacked === 0xffffffff) return 'big';
    if (unpacked > limits.entryBytes) return 'big';
    total += unpacked;
    if (total > limits.totalBytes) return 'big';
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > end) return 'bad';
    parts.push({
      name: decoder.decode(new Uint8Array(bytes, at + 46, nameLength)),
      method: view.getUint16(at + 10, true),
      flags: view.getUint16(at + 8, true),
      packed,
      unpacked,
      local: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

/** The start of the data of a part, after the local header is compared with the central directory. */
function dataStart(view: DataView, part: Part): number {
  const at = part.local;
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_SIGNATURE) throw new Stop('bad');
  // Bit 3: the sizes follow the data, and the local header holds zeros. Then only the central directory has them.
  if ((view.getUint16(at + 6, true) & 8) === 0) {
    if (view.getUint32(at + 18, true) !== part.packed || view.getUint32(at + 22, true) !== part.unpacked) throw new Stop('bad');
  }
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  if (start + part.packed > view.byteLength) throw new Stop('bad');
  return start;
}

/** The real output of one DEFLATE part. It stops with `Stop('big')` as soon as the count passes `room`. */
function inflatePart(input: Uint8Array, room: number, keep: boolean): { size: number; bytes?: Uint8Array } {
  let size = 0;
  const chunks: Uint8Array[] = [];
  const inflater = new Inflate((chunk) => {
    size += chunk.length;
    if (size > room) throw new Stop('big');
    if (keep) chunks.push(chunk);
  });
  for (let at = 0; at < input.length; at += STEP) inflater.push(input.subarray(at, Math.min(at + STEP, input.length)), at + STEP >= input.length);
  if (input.length === 0) inflater.push(new Uint8Array(0), true);
  if (!keep) return { size };
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return { size, bytes: out };
}

/**
 * Unpacks the parts that `want` names and checks every part. "big": the file passes a limit by its declared or its real size. "bad": it
 * is no ZIP file, or a header lies, or a method is unknown.
 */
export function unpackZip(bytes: ArrayBuffer, o: { want?: (name: string) => boolean; limits?: ZipLimits } = {}): Unpacked {
  const limits = o.limits ?? ZIP_LIMITS;
  const parts = readDirectory(bytes, limits);
  if (parts === 'bad' || parts === 'big') return { kind: parts };
  const view = new DataView(bytes);
  const entries: Record<string, Uint8Array> = {};
  let total = 0;
  try {
    for (const part of parts) {
      if (part.name.endsWith('/')) continue;
      const start = dataStart(view, part);
      const keep = o.want?.(part.name) ?? false;
      const input = new Uint8Array(bytes, start, part.packed);
      let real: { size: number; bytes?: Uint8Array };
      if (part.method === 0) {
        if (part.packed !== part.unpacked) return { kind: 'bad' };
        real = { size: part.packed, bytes: keep ? input : undefined };
      } else if (part.method === 8) {
        real = inflatePart(input, Math.min(limits.entryBytes, limits.totalBytes - total), keep);
      } else {
        return { kind: 'bad' };
      }
      if (real.size !== part.unpacked) return { kind: 'bad' };
      total += real.size;
      if (total > limits.totalBytes) return { kind: 'big' };
      if (keep && real.bytes) entries[part.name] = real.bytes;
    }
  } catch (error) {
    if (error instanceof Stop) return { kind: error.reason };
    // The inflater throws its own error for broken data.
    return { kind: 'bad' };
  }
  return { kind: 'ok', entries };
}

/** The check alone, for a file that needs no bytes kept (a Word file: mammoth unpacks it again). */
export function checkZip(bytes: ArrayBuffer, limits: ZipLimits = ZIP_LIMITS): ZipCheck {
  return unpackZip(bytes, { limits }).kind;
}
