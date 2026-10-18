import { describe, expect, it } from 'vitest';
import { bytesOfDataUrl, centreSquare, containSquare, encodePngSmallest, encodeSmallest, hasSeeThrough, PICTURE_MAX_BYTES, pictureType, safePicture } from './picture';

describe('the profile picture helpers (owner item 10, 2026-10-05)', () => {
  it('shows only picture data and https addresses', () => {
    expect(safePicture('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
    expect(safePicture('https://example.com/a.png')).toBe('https://example.com/a.png');
    for (const bad of [null, undefined, '', 'javascript:alert(1)', 'http://example.com/a.png', 'data:image/svg+xml;base64,AAAA', '/a.png']) {
      expect(safePicture(bad), String(bad)).toBeNull();
    }
  });

  it('cuts the centre square of a wide and of a tall picture', () => {
    expect(centreSquare(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
    expect(centreSquare(300, 900)).toEqual({ sx: 0, sy: 300, side: 300 });
    expect(centreSquare(128, 128)).toEqual({ sx: 0, sy: 0, side: 128 });
  });

  it('counts the bytes of base64 data', () => {
    expect(bytesOfDataUrl('data:image/png;base64,AAAA')).toBe(3);
    expect(bytesOfDataUrl('data:image/png;base64,AAA=')).toBe(2);
    expect(bytesOfDataUrl('data:image/png;base64,AA==')).toBe(1);
  });

  it('takes WebP at the best quality that fits in 16 KB', () => {
    const tries: string[] = [];
    const big = `data:image/webp;base64,${'A'.repeat(30_000)}`;
    const small = `data:image/webp;base64,${'A'.repeat(8_000)}`;
    const picked = encodeSmallest((type, quality) => {
      tries.push(`${type}@${quality}`);
      return quality > 0.7 ? big : small;
    });
    expect(picked).toBe(small);
    expect(tries[0]).toBe('image/webp@0.85');
    expect(bytesOfDataUrl(picked!)).toBeLessThanOrEqual(PICTURE_MAX_BYTES);
  });

  it('takes JPEG where the browser cannot make WebP (it gives PNG instead)', () => {
    const tries: string[] = [];
    const picked = encodeSmallest((type, quality) => {
      tries.push(type);
      return type === 'image/webp' ? 'data:image/png;base64,AAAA' : `data:image/jpeg;base64,AAAA${quality}`.replace('.', '');
    });
    expect(picked?.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(tries[0]).toBe('image/webp');
    expect(tries[1]).toBe('image/jpeg');
  });

  it('gives null when no quality fits', () => {
    expect(encodeSmallest(() => `data:image/webp;base64,${'A'.repeat(40_000)}`)).toBeNull();
  });

  it('finds the see-through parts: an alpha under 250 counts, a nearly opaque one does not', () => {
    expect(hasSeeThrough(new Uint8ClampedArray([255, 255, 255, 255]))).toBe(false);
    expect(hasSeeThrough(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255]))).toBe(true);
    expect(hasSeeThrough(new Uint8ClampedArray([9, 9, 9, 250]))).toBe(false);
    expect(hasSeeThrough(new Uint8ClampedArray([9, 9, 9, 249]))).toBe(true);
  });

  it('see-through: keeps the see-through parts when the browser cannot make WebP', () => {
    expect(pictureType(false, true)).toBe('png');
    expect(pictureType(true, true)).toBe('webp');
    expect(pictureType(false, false)).toBe('jpeg');
    expect(pictureType(true, false)).toBe('webp');
  });

  it('takes the first PNG side that fits 16 KB, from 128 px down to 64 px', () => {
    const sides: number[] = [];
    const picked = encodePngSmallest((side) => {
      sides.push(side);
      return side === 112 ? `data:image/png;base64,${'A'.repeat(16_000)}` : `data:image/png;base64,${'A'.repeat(27_000)}`;
    });
    expect(picked).toBe(`data:image/png;base64,${'A'.repeat(16_000)}`);
    expect(sides).toEqual([128, 112]);
  });

  it('gives null for PNG when no side fits', () => {
    const sides: number[] = [];
    const picked = encodePngSmallest((side) => {
      sides.push(side);
      return `data:image/png;base64,${'A'.repeat(40_000)}`;
    });
    expect(picked).toBeNull();
    expect(sides).toEqual([128, 112, 96, 80, 64]);
  });

  it('fits the whole picture inside the square, centred, with see-through space around it', () => {
    expect(containSquare(256, 128)).toEqual({ dx: 0, dy: 32, w: 128, h: 64 });
    expect(containSquare(64, 256)).toEqual({ dx: 48, dy: 0, w: 32, h: 128 });
    expect(containSquare(128, 128)).toEqual({ dx: 0, dy: 0, w: 128, h: 128 });
    expect(containSquare(0, 0)).toEqual({ dx: 0, dy: 0, w: 0, h: 0 });
  });
});
