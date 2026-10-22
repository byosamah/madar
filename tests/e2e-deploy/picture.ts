import type { Browser, Locator } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/**
 * The test picture of the walk (tests/e2e-deploy/walk.spec.ts), made at run time, and the check that a preview shows its pixels.
 * The wave 4 walk uploaded a fixed PNG whose data stream was broken: the preview showed a blank panel and its check
 * (naturalWidth) still passed. So the picture is encoded here from its pixels, and the check reads the pixels back from a
 * screenshot of the shown picture.
 */

export type Rgb = readonly [number, number, number];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A truecolour PNG (8 bits, no alpha, no interlace) of width x height, with the colour of each pixel from colorAt. */
export function pngOf(width: number, height: number, colorAt: (x: number, y: number) => Rgb | number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) raw.set(colorAt(x, y).slice(0, 3), row + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type Quarter = { name: string; x: number; y: number; rgb: Rgb };

const QUARTERS: Quarter[] = [
  { name: 'top left', x: 0.25, y: 0.25, rgb: [214, 48, 49] },
  { name: 'top right', x: 0.75, y: 0.25, rgb: [9, 132, 227] },
  { name: 'bottom left', x: 0.25, y: 0.75, rgb: [0, 148, 50] },
  { name: 'bottom right', x: 0.75, y: 0.75, rgb: [253, 203, 110] },
];

/** 64 x 64 in four coloured quarters. x and y of a quarter are the share of the width and height at its middle. */
export const WALK_PICTURE = {
  width: 64,
  height: 64,
  quarters: QUARTERS,
  png(): Buffer {
    return pngOf(64, 64, (x, y) => QUARTERS[(y < 32 ? 0 : 2) + (x < 32 ? 0 : 1)].rgb);
  },
};

/** True when a shown colour is within `room` of the expected one on each channel (the screen scales and smooths the picture). */
export function closeTo(want: Rgb | number[], got: Rgb | number[], room = 24): boolean {
  return want.every((value, i) => Math.abs(value - got[i]) <= room);
}

type Size = { width: number; height: number };

/**
 * The points of a picture shown with object-fit: contain, as shares of its element box. Such a picture fills its box on one side
 * only and sits in the middle (the full screen viewer on a phone), so a share of the box can fall on the backdrop beside it.
 */
export function containShares<P extends { x: number; y: number }>(box: Size, natural: Size, points: P[]): P[] {
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = (natural.width * scale) / box.width;
  const height = (natural.height * scale) / box.height;
  return points.map((p) => ({ ...p, x: (1 - width) / 2 + p.x * width, y: (1 - height) / 2 + p.y * height }));
}

/** containShares for a picture on the page: the points stay as they are when the picture does not use object-fit: contain. */
export async function shownShares<P extends { x: number; y: number }>(picture: Locator, points: P[]): Promise<P[]> {
  const sizes = await picture.evaluate((img: HTMLImageElement) => (getComputedStyle(img).objectFit === 'contain'
    ? { box: { width: img.clientWidth, height: img.clientHeight }, natural: { width: img.naturalWidth, height: img.naturalHeight } }
    : null));
  return sizes ? containShares(sizes.box, sizes.natural, points) : points;
}

/**
 * The colours that the screen shows at points of an element (x and y as shares of its box), read from a screenshot of the
 * element. The screenshot is decoded on a blank page of its own, so the CSP of the app and the origin of the picture do not
 * matter. A broken or blank picture gives the colour of the panel behind it.
 */
export async function shownColors(browser: Browser, element: Locator, points: { x: number; y: number }[]): Promise<number[][]> {
  const shot = await element.screenshot();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return await page.evaluate(async ({ data, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const draw = canvas.getContext('2d')!;
      draw.drawImage(image, 0, 0);
      return points.map((p) => [...draw.getImageData(Math.floor(p.x * canvas.width), Math.floor(p.y * canvas.height), 1, 1).data.slice(0, 3)]);
    }, { data: shot.toString('base64'), points });
  } finally {
    await context.close();
  }
}
