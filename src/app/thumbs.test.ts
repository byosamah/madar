import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadAdapter, type PutSender } from '../api/remote/upload';
import type { AdapterCtx } from '../api/remote/wire';
import { BIG_PICTURE_BYTES, makeThumb, THUMB_EDGE } from './thumbs';

type Drawn = { width: number; height: number; type?: string; quality?: number };

/**
 * A browser that decodes every picture to the given size, and a canvas that records what it drew. "out" is the picture that the
 * canvas writes: one for every type, or one for each type that the screen asks for.
 */
function stubBrowser(size: { width: number; height: number } | Error, out: Blob | null | ((type?: string) => Blob | null) = new Blob(['webp'], { type: 'image/webp' })) {
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
    done(typeof out === 'function' ? out(type) : out);
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

/** The canvas of Safari and of every browser on an iPhone or iPad: it cannot write WebP and gives a PNG for it, but it writes JPEG. */
const safari = (type?: string): Blob | null => {
  if (type === 'image/webp') return new Blob(['png-bytes'], { type: 'image/png' });
  if (type === 'image/jpeg') return new Blob(['jpeg'], { type: 'image/jpeg' });
  return null;
};

/** A phone photo: larger than the small picture that the stub canvas writes. */
const photo = () => new Blob(['x'.repeat(5000)], { type: 'image/jpeg' });

describe('makeThumb where the browser cannot write WebP (Safari, iPhone and iPad; performance audit BGR-M1)', () => {
  it('makes a JPEG small picture of a JPEG photo, of at most 960 px on the long side', async () => {
    const browser = stubBrowser({ width: 4032, height: 3024 }, safari);
    const thumb = await makeThumb(photo());
    expect(thumb?.type).toBe('image/jpeg');
    expect(browser.drawn).toEqual([
      { width: THUMB_EDGE, height: 720, type: 'image/webp', quality: 0.8 },
      { width: THUMB_EDGE, height: 720, type: 'image/jpeg', quality: 0.8 },
    ]);
    expect(browser.closed()).toBe(1);
  });

  it('gives null for a PNG, a GIF or another picture, because a JPEG turns their clear parts black', async () => {
    const browser = stubBrowser({ width: 2000, height: 1000 }, safari);
    for (const type of ['image/png', 'image/gif', 'image/webp', 'image/avif']) {
      expect(await makeThumb(new Blob(['x'.repeat(5000)], { type })), type).toBeNull();
    }
    expect(browser.drawn.map((d) => d.type)).toEqual(['image/webp', 'image/webp', 'image/webp', 'image/webp']);
  });

  it('gives null when the JPEG is not smaller than the photo, or the browser cannot write JPEG either', async () => {
    stubBrowser({ width: 800, height: 600 }, safari);
    expect(await makeThumb(new Blob(['j'], { type: 'image/jpeg' }))).toBeNull();
    vi.restoreAllMocks();
    stubBrowser({ width: 800, height: 600 }, (type) => (type === 'image/webp' ? new Blob(['png'], { type: 'image/png' }) : null));
    expect(await makeThumb(photo())).toBeNull();
    vi.restoreAllMocks();
    stubBrowser({ width: 800, height: 600 }, () => new Blob(['png'], { type: 'image/png' }));
    expect(await makeThumb(photo())).toBeNull();
  });

  it('keeps WebP where the browser writes WebP, also for a JPEG photo', async () => {
    const browser = stubBrowser({ width: 4032, height: 3024 });
    expect((await makeThumb(photo()))?.type).toBe('image/webp');
    expect(browser.drawn.map((d) => d.type)).toEqual(['image/webp']);
  });

  it('gives the upload a JPEG small picture: files.uploadStart names image/jpeg, and the small picture goes to its signed link', async () => {
    stubBrowser({ width: 4032, height: 3024 }, safari);
    const PUT = { url: 'https://store.test/up/upl_1/file', headers: { 'Content-Type': 'image/jpeg' }, expiresAt: '2026-10-08T12:00:00+03:00' };
    const THUMB_PUT = { url: 'https://store.test/up/upl_1/thumb', headers: { 'Content-Type': 'image/jpeg' }, expiresAt: PUT.expiresAt };
    const steps: string[] = [];
    const inputs: Record<string, unknown> = {};
    const ctx: AdapterCtx = {
      meta: {},
      call: async (name, input) => {
        steps.push(name);
        inputs[name] = input;
        if (name === 'files.uploadStart') return { uploadId: 'upl_1', put: PUT, thumbPut: THUMB_PUT };
        if (name === 'files.upload') return { file: { id: 'fil_9' } };
        throw new Error(`unexpected ${name}`);
      },
    };
    const sent: { url: string; body: Blob }[] = [];
    const put: PutSender = async (signed, body) => {
      steps.push(`PUT ${signed.url}`);
      sent.push({ url: signed.url, body });
      return { status: 200, body: '' };
    };
    await uploadAdapter({ makeThumb, put })({ projectId: 'prj_001', name: 'IMG_0412.jpg', blob: photo() }, ctx);
    expect(inputs['files.uploadStart']).toMatchObject({ mimeType: 'image/jpeg', thumb: { size: 4, mimeType: 'image/jpeg' } });
    expect(steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, `PUT ${THUMB_PUT.url}`, 'files.upload']);
    expect(sent[1].body.type).toBe('image/jpeg');
  });
});

describe('makeThumb of a big photo (owner, 2026-10-22: a 48 MP phone photo held about 190 MB before the upload started)', () => {
  const big = () => new Blob([new Uint8Array(BIG_PICTURE_BYTES + 1)], { type: 'image/jpeg' });

  it('asks the browser to decode a big photo straight to the small width', async () => {
    const browser = stubBrowser({ width: THUMB_EDGE, height: 720 });
    const file = big();
    await makeThumb(file);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledWith(file, { resizeWidth: THUMB_EDGE, resizeQuality: 'high' });
    expect(browser.drawn[0]).toMatchObject({ width: THUMB_EDGE, height: 720 });
  });

  it('keeps a tall photo at 960 px on the long side after the small decode', async () => {
    // Only the width goes to the browser, so it keeps the shape: a tall photo comes back 960 by 1280.
    const browser = stubBrowser({ width: THUMB_EDGE, height: 1280 });
    await makeThumb(big());
    expect(browser.drawn[0]).toMatchObject({ width: 720, height: THUMB_EDGE });
  });

  it('decodes a small file at its own size, so a small picture never grows', async () => {
    stubBrowser({ width: 300, height: 600 });
    const file = new Blob(['png'], { type: 'image/png' });
    await makeThumb(file);
    expect(createImageBitmap).toHaveBeenCalledWith(file);
  });

  it('decodes the big photo at full size when the browser refuses the size options', async () => {
    const drawn = stubBrowser({ width: 4000, height: 3000 }).drawn;
    const plain = createImageBitmap as unknown as ReturnType<typeof vi.fn>;
    const full = plain.getMockImplementation();
    plain.mockImplementationOnce(async () => { throw new TypeError('options not supported'); });
    plain.mockImplementation(full as never);
    const file = big();
    expect(await makeThumb(file)).not.toBeNull();
    expect(plain).toHaveBeenNthCalledWith(2, file);
    expect(drawn[0]).toMatchObject({ width: THUMB_EDGE, height: 720 });
  });
});
