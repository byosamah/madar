import { describe, expect, it, vi } from 'vitest';
import { MAX_FILE_BYTES } from '../contract/entities';
import { ApiError } from '../errors';
import { putFailure, uploadAdapter, type PutResult, type PutSender } from './upload';
import type { AdapterCtx } from './wire';

const MB = 1024 * 1024;
const PUT = { url: 'https://store.test/up/upl_1', headers: { 'Content-Type': 'image/png' }, expiresAt: '2026-10-04T12:00:00+03:00' };
const THUMB_PUT = { url: 'https://store.test/up/upl_1/thumb', headers: { 'Content-Type': 'image/webp' }, expiresAt: PUT.expiresAt };

/** A wire stub: it records each call in order and answers like the server. */
function wire(o: { limit?: number; start?: unknown } = {}) {
  const steps: string[] = [];
  const inputs: Record<string, unknown> = {};
  const ctx: AdapterCtx = {
    meta: {},
    call: async (name, input) => {
      steps.push(name);
      inputs[name] = input;
      if (name === 'files.uploadStart') return o.start ?? { uploadId: 'upl_1', put: PUT, thumbPut: THUMB_PUT };
      if (name === 'files.upload') return { file: { id: 'fil_9' } };
      if (name === 'session.get') return { limits: o.limit === undefined ? undefined : { maxFileBytes: o.limit } };
      throw new Error(`unexpected ${name}`);
    },
  };
  return { ctx, steps, inputs };
}

/** A PUT stub: it records each upload in the step list of the wire, so the test sees one order for both. */
function sender(steps: string[], answer: (url: string) => PutResult = () => ({ status: 200, body: '' })): { put: PutSender; bodies: Blob[]; headers: Record<string, string>[] } {
  const bodies: Blob[] = [];
  const headers: Record<string, string>[] = [];
  return {
    bodies,
    headers,
    put: async (put, body) => {
      steps.push(`PUT ${put.url}`);
      bodies.push(body);
      headers.push(put.headers);
      return answer(put.url);
    },
  };
}

const picture = () => new File(['png-bytes'], 'Site photo.png', { type: 'image/png' });
const SCREEN_INPUT = { projectId: 'prj_001', name: 'Site photo.png', stageId: 'stg_002', taskId: null, asCover: true, receivedFromClient: false };

describe('the upload adapter (plan 5.2)', () => {
  it('runs files.uploadStart, the uploads and files.upload in order, and passes the small picture', async () => {
    const { ctx, steps, inputs } = wire();
    const thumb = new Blob(['webp'], { type: 'image/webp' });
    const { put, bodies, headers } = sender(steps);
    const file = picture();
    const output = await uploadAdapter({ makeThumb: async () => thumb, put })({ ...SCREEN_INPUT, blob: file }, ctx);
    expect(steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, `PUT ${THUMB_PUT.url}`, 'files.upload']);
    expect(inputs['files.uploadStart']).toEqual({
      projectId: 'prj_001', name: 'Site photo.png', size: file.size, mimeType: 'image/png', stageId: 'stg_002', taskId: null,
      thumb: { size: thumb.size, mimeType: 'image/webp' },
    });
    expect(bodies).toEqual([file, thumb]);
    expect(headers).toEqual([PUT.headers, THUMB_PUT.headers]);
    // The wire form is strict: the upload ID and the shared fields, never the blob.
    expect(inputs['files.upload']).toEqual({ projectId: 'prj_001', name: 'Site photo.png', stageId: 'stg_002', taskId: null, asCover: true, receivedFromClient: false, uploadId: 'upl_1' });
    expect(output).toEqual({ file: { id: 'fil_9' } });
  });

  it('makes no small picture for a file that is not a picture, and sends a file with no type as plain data', async () => {
    const { ctx, steps, inputs } = wire({ start: { uploadId: 'upl_2', put: PUT } });
    let asked = 0;
    const { put } = sender(steps);
    await uploadAdapter({ makeThumb: async () => { asked += 1; return null; }, put })({ projectId: 'prj_001', name: 'Model.rvt', blob: new Blob(['x']) }, ctx);
    expect(asked).toBe(0);
    expect(inputs['files.uploadStart']).toEqual({ projectId: 'prj_001', name: 'Model.rvt', size: 1, mimeType: 'application/octet-stream' });
    expect(inputs['files.upload']).toEqual({ projectId: 'prj_001', name: 'Model.rvt', uploadId: 'upl_2' });
    expect(steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, 'files.upload']);
  });

  it('leaves the small picture out when the browser cannot make one, or when it is over 10 MB', async () => {
    for (const thumb of [null, Object.defineProperty(new Blob(['x'], { type: 'image/webp' }), 'size', { value: 10 * MB + 1 })]) {
      const { ctx, steps, inputs } = wire({ start: { uploadId: 'upl_3', put: PUT } });
      await uploadAdapter({ makeThumb: async () => thumb, put: sender(steps).put })({ ...SCREEN_INPUT, blob: picture() }, ctx);
      expect(inputs['files.uploadStart']).not.toHaveProperty('thumb');
      expect(steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, 'files.upload']);
    }
  });

  it('still saves the file when only the small picture fails to upload or cannot be made', async () => {
    const { ctx, steps } = wire();
    const { put } = sender(steps, (url) => (url === THUMB_PUT.url ? { status: 0, body: '' } : { status: 200, body: '' }));
    await uploadAdapter({ makeThumb: async () => new Blob(['w'], { type: 'image/webp' }), put })({ ...SCREEN_INPUT, blob: picture() }, ctx);
    expect(steps.at(-1)).toBe('files.upload');
    const broken = wire();
    await uploadAdapter({ makeThumb: async () => { throw new Error('decode'); }, put: sender(broken.steps).put })({ ...SCREEN_INPUT, blob: picture() }, broken.ctx);
    expect(broken.steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, 'files.upload']);
  });

  it('turns a failed upload of the file into failed, so the screen offers Retry, and never calls files.upload', async () => {
    for (const answer of [{ status: 0, body: '' }, { status: 500, body: 'oops' }, { status: 400, body: '{"statusCode":"403","code":"InvalidJWT"}' }]) {
      const { ctx, steps } = wire();
      const error = await uploadAdapter({ makeThumb: async () => null, put: sender(steps, () => answer).put })({ ...SCREEN_INPUT, blob: picture() }, ctx)
        .then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'failed', details: { reason: 'upload_failed' } });
      expect(steps).not.toContain('files.upload');
    }
  });

  it('turns the Storage size refusal into file_too_large with the limit that session.get gives (proof Z0a, item 6)', async () => {
    const refusal = { status: 400, body: JSON.stringify({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }) };
    const { ctx, steps } = wire({ limit: 50 * MB });
    const error = await uploadAdapter({ makeThumb: async () => null, put: sender(steps, () => refusal).put })({ ...SCREEN_INPUT, blob: picture() }, ctx)
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_input', details: { fields: ['blob'], reason: 'file_too_large', limit: 50 * MB } });
    expect(steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, 'session.get']);
  });

  it('uses the ceiling of the contract when session.get names no limit, and reads the code form of the refusal', async () => {
    const { ctx, steps } = wire();
    const error = await uploadAdapter({ makeThumb: async () => null, put: sender(steps, () => ({ status: 400, body: '{"code":"EntityTooLarge"}' })).put })({ ...SCREEN_INPUT, blob: picture() }, ctx)
      .then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_input', details: { reason: 'file_too_large', limit: MAX_FILE_BYTES } });
  });
  it('a Retry after a lost answer of files.upload sends the same upload ID with the same key, and uploads nothing again (plan 4.10)', async () => {
    const steps: string[] = [];
    const saves: { input: unknown; key?: string }[] = [];
    let n = 0;
    let lose = true;
    let thumbs = 0;
    const ctx: AdapterCtx = {
      meta: { key: 'up-retry-1' },
      call: async (name, input, meta) => {
        steps.push(name);
        if (name === 'files.uploadStart') {
          n += 1;
          return { uploadId: `upl_${n}`, put: PUT, thumbPut: THUMB_PUT };
        }
        saves.push({ input, key: meta?.key });
        if (lose) {
          lose = false;
          throw new ApiError('failed', 'The server did not answer.');
        }
        return { file: { id: 'fil_9' } };
      },
    };
    const raw = { ...SCREEN_INPUT, blob: picture() };
    const adapter = uploadAdapter({ makeThumb: async () => { thumbs += 1; return new Blob(['w'], { type: 'image/webp' }); }, put: sender(steps).put });
    await expect(adapter(raw, ctx)).rejects.toMatchObject({ code: 'failed' });
    expect(await adapter(raw, ctx)).toEqual({ file: { id: 'fil_9' } });
    expect(steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, `PUT ${THUMB_PUT.url}`, 'files.upload', 'files.upload']);
    expect(thumbs).toBe(1);
    const saved = { projectId: 'prj_001', name: 'Site photo.png', stageId: 'stg_002', taskId: null, asCover: true, receivedFromClient: false, uploadId: 'upl_1' };
    expect(saves).toEqual([{ input: saved, key: 'up-retry-1.upload' }, { input: saved, key: 'up-retry-1.upload' }]);
  });

  it('uploads again on the next Retry when files.upload is refused with no Retry, or when the file is another one', async () => {
    const steps: string[] = [];
    let n = 0;
    let refuse = true;
    const ctx: AdapterCtx = {
      meta: { key: 'up-retry-2' },
      call: async (name) => {
        steps.push(name);
        if (name === 'files.uploadStart') {
          n += 1;
          return { uploadId: `upl_${n}`, put: PUT };
        }
        if (refuse) {
          refuse = false;
          throw new ApiError('conflict', 'This upload is already used, or it has ended. Upload the file again.');
        }
        throw new ApiError('failed', 'The server did not answer.');
      },
    };
    const adapter = uploadAdapter({ makeThumb: async () => null, put: sender(steps).put });
    const raw = { ...SCREEN_INPUT, blob: picture() };
    await expect(adapter(raw, ctx)).rejects.toMatchObject({ code: 'conflict' });
    await expect(adapter(raw, ctx)).rejects.toMatchObject({ code: 'failed' });
    // The stored upload belongs to the first file: another file with the same key uploads again.
    await expect(adapter({ ...raw, blob: picture() }, ctx)).rejects.toMatchObject({ code: 'failed' });
    expect(steps.filter((step) => step === 'files.uploadStart')).toHaveLength(3);
  });
});

describe('the two uploads of a picture at the same time (performance audit BGR-M2)', () => {
  /** A PUT stub that holds each upload until the test ends it, and records each start in the step list of the wire. */
  function heldSender(steps: string[], reject?: string) {
    const held = new Map<string, { end: (result: PutResult) => void; fail: (error: Error) => void }>();
    const put: PutSender = (signed) => new Promise((resolve, fail) => {
      steps.push(`PUT ${signed.url}`);
      held.set(signed.url, { end: resolve, fail });
    });
    const end = (url: string, result: PutResult = { status: 200, body: '' }) => {
      const upload = held.get(url);
      if (!upload) throw new Error(`no upload to ${url}`);
      if (url === reject) upload.fail(new Error('the network broke'));
      else upload.end(result);
    };
    return { put, held, end };
  }
  const webp = () => new Blob(['webp'], { type: 'image/webp' });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('starts the upload of the small picture before the file upload ends, and sends files.upload only after both end', async () => {
    const { ctx, steps } = wire();
    const { put, held, end } = heldSender(steps);
    const done = uploadAdapter({ makeThumb: async () => webp(), put })({ ...SCREEN_INPUT, blob: picture() }, ctx);
    await vi.waitFor(() => expect([...held.keys()]).toEqual([PUT.url, THUMB_PUT.url]));
    end(PUT.url);
    await settle();
    expect(steps).not.toContain('files.upload');
    end(THUMB_PUT.url);
    expect(await done).toEqual({ file: { id: 'fil_9' } });
    expect(steps).toEqual(['files.uploadStart', `PUT ${PUT.url}`, `PUT ${THUMB_PUT.url}`, 'files.upload']);
  });

  it('waits for the file upload also when the small picture ends first', async () => {
    const { ctx, steps } = wire();
    const { put, held, end } = heldSender(steps);
    const done = uploadAdapter({ makeThumb: async () => webp(), put })({ ...SCREEN_INPUT, blob: picture() }, ctx);
    await vi.waitFor(() => expect(held.size).toBe(2));
    end(THUMB_PUT.url);
    await settle();
    expect(steps).not.toContain('files.upload');
    end(PUT.url);
    expect(await done).toEqual({ file: { id: 'fil_9' } });
  });

  it('a file upload that the store refuses as too large throws the same too_large, also while the small picture still loads', async () => {
    const refusal = { status: 400, body: JSON.stringify({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }) };
    const { ctx, steps } = wire({ limit: 50 * MB });
    const { put, held, end } = heldSender(steps);
    const done = uploadAdapter({ makeThumb: async () => webp(), put })({ ...SCREEN_INPUT, blob: picture() }, ctx).then(() => null, (e: unknown) => e);
    await vi.waitFor(() => expect(held.has(PUT.url)).toBe(true));
    end(PUT.url, refusal);
    const error = await done;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_input', message: 'This file is larger than the limit.', details: { fields: ['blob'], reason: 'file_too_large', limit: 50 * MB } });
    expect(steps).not.toContain('files.upload');
    if (held.has(THUMB_PUT.url)) end(THUMB_PUT.url);
    await settle();
    expect(steps).not.toContain('files.upload');
  });

  it('a failed file upload throws failed, and a small picture upload that breaks after it leaves no stray error', async () => {
    const { ctx, steps } = wire();
    const { put, held, end } = heldSender(steps, THUMB_PUT.url);
    const done = uploadAdapter({ makeThumb: async () => webp(), put })({ ...SCREEN_INPUT, blob: picture() }, ctx).then(() => null, (e: unknown) => e);
    await vi.waitFor(() => expect(held.has(PUT.url)).toBe(true));
    end(PUT.url, { status: 0, body: '' });
    expect(await done).toMatchObject({ code: 'failed', message: 'The file did not upload. Try again.', details: { reason: 'upload_failed', status: 0 } });
    if (held.has(THUMB_PUT.url)) end(THUMB_PUT.url);
    await settle();
    expect(steps).not.toContain('files.upload');
  });
});

describe('putFailure', () => {
  it('reads each form of the size refusal, and nothing else', () => {
    expect(putFailure({ status: 400, body: '{"statusCode":"413","code":"EntityTooLarge"}' })).toBe('too_large');
    expect(putFailure({ status: 400, body: '{"statusCode":413}' })).toBe('too_large');
    expect(putFailure({ status: 413, body: '' })).toBe('too_large');
    // R2 and MinIO answer in S3 XML.
    expect(putFailure({ status: 400, body: '<?xml version="1.0"?><Error><Code>EntityTooLarge</Code></Error>' })).toBe('too_large');
    expect(putFailure({ status: 400, body: '{"statusCode":"400","code":"InvalidKey"}' })).toBe('failed');
    expect(putFailure({ status: 400, body: 'not json' })).toBe('failed');
    expect(putFailure({ status: 0, body: '' })).toBe('failed');
    expect(putFailure({ status: 200, body: '' })).toBeNull();
    expect(putFailure({ status: 204, body: '' })).toBeNull();
  });
});
