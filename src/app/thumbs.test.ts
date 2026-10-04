import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeThumb, THUMB_EDGE } from './thumbs';

type Drawn = { width: number; height: number; type?: string; quality?: number };

/** A browser that decodes every picture to the given size, and a canvas that records what it drew. */
function stubBrowser(size: { width: number; height: number } | Error, out: Blob | null = new Blob(['webp'], { type: 'image/webp' })) {
  const drawn: Drawn[] = [];
  let closed = 0;
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    if (size instanceof Error) throw size;
    return { ...size, close: () => { closed += 1; } };
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return { drawImage: () => undefined } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, done: BlobCallback, type?: string, quality?: number) {
    drawn.push({ width: this.width, height: this.height, type, quality });
    done(out);
  });
  return { drawn, closed: () => closed };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('makeThumb (plan 5.2)', () => {
  it('makes a WebP picture of at most 960 px on the long side, and keeps the shape', async () => {
    const browser = stubBrowser({ width: 4000, height: 3000 });
    const thumb = await makeThumb(new Blob(['png'], { type: 'image/png' }));
    expect(thumb?.type).toBe('image/webp');
    expect(browser.drawn).toEqual([{ width: THUMB_EDGE, height: 720, type: 'image/webp', quality: 0.8 }]);
    expect(browser.closed()).toBe(1);
  });

  it('never makes a small picture larger than the original', async () => {
    const browser = stubBrowser({ width: 300, height: 600 });
    await makeThumb(new Blob(['png'], { type: 'image/png' }));
    expect(browser.drawn[0]).toMatchObject({ width: 300, height: 600 });
  });

  it('gives null for a file that is not a picture, a drawing (SVG), or a picture the browser cannot read', async () => {
    stubBrowser(new Error('cannot decode'));
    expect(await makeThumb(new Blob(['%PDF'], { type: 'application/pdf' }))).toBeNull();
    expect(await makeThumb(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).toBeNull();
    expect(await makeThumb(new Blob(['raw'], { type: 'image/x-canon-cr2' }))).toBeNull();
  });

  it('gives null when the browser cannot write WebP or has no picture tools', async () => {
    stubBrowser({ width: 100, height: 100 }, new Blob(['png'], { type: 'image/png' }));
    expect(await makeThumb(new Blob(['png'], { type: 'image/png' }))).toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await makeThumb(new Blob(['png'], { type: 'image/png' }))).toBeNull();
  });
});
