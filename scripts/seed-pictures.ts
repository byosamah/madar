// The sample pictures of the test office of madar-test, as PNG files (2026-10-06). The real file store serves an SVG only as a
// download (server/files/links.ts), so a sample SVG never showed as a cover picture there. A PNG here draws the same scene as
// renderSvg (src/data/assets.ts) at half size, without the title text. Node only: it uses node:zlib.
import { crc32, deflateSync } from 'node:zlib';
import { sceneOf, type Hsl, type Scene } from '../src/data/assets';
import type { SeedPicture } from '../src/data/seed';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The RGB (0 to 255) of a CSS hsl() colour. */
export function rgbOf([h, s, l]: Hsl): [number, number, number] {
  const light = l / 100;
  const a = (s / 100) * Math.min(light, 1 - light);
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** One PNG chunk: the length, the type, the data and the CRC of the type and the data. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG (8-bit RGB) of a scene of 1600 x 900 at the given scale. The sky goes from its top colour to its bottom colour. */
export function scenePng(scene: Scene, scale = 0.5): Buffer {
  const width = Math.round(1600 * scale);
  const height = Math.round(900 * scale);
  const [top, bottom] = [rgbOf(scene.sky[0]), rgbOf(scene.sky[1])];
  const ground = rgbOf(scene.ground.fill);
  const groundY = Math.round(scene.ground.y * scale);
  const blocks = scene.blocks.map((block) => ({
    x0: Math.round(block.x * scale), x1: Math.round((block.x + block.width) * scale),
    y0: Math.round(block.y * scale), y1: Math.round((block.y + block.height) * scale), rgb: rgbOf(block.fill),
  }));
  const stride = 1 + width * 3;
  // Each row starts with the filter byte 0 (none), which Buffer.alloc already holds.
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const sky = top.map((value, i) => Math.round(value + (bottom[i] - value) * t));
    for (let x = 0; x < width; x += 1) {
      const block = blocks.find((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
      raw.set(y >= groundY ? ground : (block?.rgb ?? sky), y * stride + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // 8 bits, RGB (colour type 2), deflate, filter method 0, no interlace.
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The PNG pictures for buildSeed. */
export const PNG_PICTURES: SeedPicture = { extension: 'png', type: 'image/png', render: (hue, variant) => scenePng(sceneOf(hue, variant)) };
