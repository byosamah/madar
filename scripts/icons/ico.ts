/**
 * An icon file (.ico) that holds one PNG, for public/favicon.ico. Some tools ask a site only for /favicon.ico, and without that
 * file Cloudflare Pages answers with the page itself, so they took the icon of the parent domain vado.sa (owner, 2026-10-05).
 * The format: a 6-byte header (0, type 1, one image), one 16-byte entry (width, height, 0 colours, 0, 1 plane, 32 bits, the
 * byte count, the offset 22), then the PNG as it is.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function icoOf(png: Buffer, size: number): Buffer {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('icoOf needs a PNG file.');
  if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`An icon file cannot hold the size ${size}.`);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  // The format writes 256 as 0.
  head.writeUInt8(size === 256 ? 0 : size, 6);
  head.writeUInt8(size === 256 ? 0 : size, 7);
  head.writeUInt8(0, 8);
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}
