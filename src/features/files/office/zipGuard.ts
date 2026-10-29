/**
 * A look at the directory of a ZIP file before any library unpacks it (tsk_495). A Word or Excel file is a ZIP file, and a small file
 * can declare a huge unpacked size. The check reads only the central directory (a few bytes for each file) and refuses a file that
 * would fill the memory of the tab. It runs before mammoth or read-excel-file touch the bytes.
 */
export type ZipCheck = 'ok' | 'bad' | 'big';

/** The most that a file may unpack to. A real Word or Excel file is far below all three limits. */
export const ZIP_LIMITS = { entries: 4000, entryBytes: 80 * 1024 * 1024, totalBytes: 150 * 1024 * 1024 } as const;

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const END_SIZE = 22;
/** The end record sits at the end of the file, after a comment of at most 65,535 bytes. */
const MAX_COMMENT = 0xffff;

/** "bad": no readable ZIP directory. "big": the directory declares more than the limits, or needs ZIP64. "ok": a library may unpack it. */
export function checkZip(bytes: ArrayBuffer): ZipCheck {
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
  if (count > ZIP_LIMITS.entries) return 'big';
  if (start + size > end) return 'bad';
  let total = 0;
  let at = start;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== ENTRY_SIGNATURE) return 'bad';
    const packed = view.getUint32(at + 20, true);
    const unpacked = view.getUint32(at + 24, true);
    if (packed === 0xffffffff || unpacked === 0xffffffff) return 'big';
    if (unpacked > ZIP_LIMITS.entryBytes) return 'big';
    total += unpacked;
    if (total > ZIP_LIMITS.totalBytes) return 'big';
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return 'ok';
}
