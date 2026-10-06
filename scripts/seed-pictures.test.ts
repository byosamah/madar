import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sceneOf } from '../src/data/assets';
import { PNG_PICTURES, rgbOf, scenePng } from './seed-pictures';

/** The width, the height and the RGB rows (without the filter byte) of a PNG that scenePng made. */
function decode(png: Uint8Array): { width: number; height: number; pixel(x: number, y: number): number[] } {
  const data = Buffer.from(png);
  expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = new Map<string, Buffer[]>();
  for (let at = 8; at < data.length;) {
    const length = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    chunks.set(type, [...(chunks.get(type) ?? []), data.subarray(at + 8, at + 8 + length)]);
    at += 12 + length;
  }
  const head = chunks.get('IHDR')![0];
  const width = head.readUInt32BE(0);
  const height = head.readUInt32BE(4);
  // 8 bits, RGB, no interlace.
  expect([head[8], head[9], head[12]]).toEqual([8, 2, 0]);
  expect(chunks.has('IEND')).toBe(true);
  const raw = inflateSync(Buffer.concat(chunks.get('IDAT')!));
  const stride = 1 + width * 3;
  return { width, height, pixel: (x, y) => [...raw.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3)] };
}

describe('seed-pictures: the PNG pictures of the test office', () => {
  it('turns a CSS hsl() colour into RGB', () => {
    expect(rgbOf([0, 100, 50])).toEqual([255, 0, 0]);
    expect(rgbOf([120, 100, 25])).toEqual([0, 128, 0]);
    expect(rgbOf([210, 50, 60])).toEqual([102, 153, 204]);
    expect(rgbOf([0, 0, 100])).toEqual([255, 255, 255]);
  });

  it('draws the scene of renderSvg at half size: the sky, the building blocks and the ground', () => {
    const scene = sceneOf(28, 1);
    const png = decode(scenePng(scene));
    expect([png.width, png.height]).toEqual([800, 450]);
    // The sky starts at its top colour and ends near its bottom colour.
    expect(png.pixel(2, 0)).toEqual(rgbOf(scene.sky[0]));
    const block = scene.blocks[0];
    expect(png.pixel(Math.round((block.x + block.width / 2) / 2), Math.round((block.y + block.height / 2) / 2))).toEqual(rgbOf(block.fill));
    expect(png.pixel(400, 449)).toEqual(rgbOf(scene.ground.fill));
    // Left of the first block, above the ground: sky.
    expect(png.pixel(10, 400)).not.toEqual(rgbOf(block.fill));
  });

  it('gives buildSeed a PNG for each picture (src/data/seed.ts, SeedPicture)', () => {
    expect(PNG_PICTURES.extension).toBe('png');
    expect(PNG_PICTURES.type).toBe('image/png');
    expect(decode(PNG_PICTURES.render(200, 3)).width).toBe(800);
  });
});
