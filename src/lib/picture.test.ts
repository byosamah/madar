import { describe, expect, it } from 'vitest';
import { bytesOfDataUrl, centreSquare, encodeSmallest, PICTURE_MAX_BYTES, safePicture } from './picture';

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
});
