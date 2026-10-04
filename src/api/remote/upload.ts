import { MAX_FILE_BYTES } from '../contract/entities';
import { MAX_SHOT_BYTES, type SignedPut } from '../contract/server';
import { ApiError } from '../errors';
import type { Adapter, AdapterCtx } from './wire';

/**
 * files.upload in the real build (plan 5.2): files.uploadStart, the upload of the file (and its small picture), then files.upload
 * with the upload ID. makeThumb comes in as a parameter, so src/api never imports src/app.
 */

/** The answer of one upload to the file store. Status 0: no answer (no network, a CORS refusal or an abort). */
export type PutResult = { status: number; body: string };
export type PutSender = (put: SignedPut, body: Blob) => Promise<PutResult>;

/**
 * Sends one file to the signed link with XMLHttpRequest, with exactly the headers that the server signed. The browser goes
 * straight to the file store, so the API function never carries the file. It never throws: a failure is status 0.
 */
export const xhrPut: PutSender = (put, body) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const none = () => resolve({ status: 0, body: '' });
    try {
      xhr.open('PUT', put.url);
      for (const [name, value] of Object.entries(put.headers)) xhr.setRequestHeader(name, value);
      xhr.onload = () => resolve({ status: xhr.status, body: typeof xhr.responseText === 'string' ? xhr.responseText : '' });
      xhr.onerror = none;
      xhr.onabort = none;
      xhr.ontimeout = none;
      xhr.send(body);
    } catch {
      none();
    }
  });

/**
 * What an upload answer means: null for a stored file, too_large for the size refusal of the store, failed for the rest.
 * Supabase Storage answers a file over the bucket limit with HTTP 400 and statusCode "413" or code "EntityTooLarge" (proof Z0a,
 * item 6). R2 and MinIO answer in S3 XML with the code EntityTooLarge.
 */
export function putFailure(result: PutResult): 'too_large' | 'failed' | null {
  if (result.status >= 200 && result.status < 300) return null;
  if (result.status === 413) return 'too_large';
  if (result.status !== 400) return 'failed';
  if (/<Code>\s*EntityTooLarge\s*<\/Code>/.test(result.body)) return 'too_large';
  try {
    const body = JSON.parse(result.body) as { statusCode?: unknown; code?: unknown };
    if (String(body.statusCode) === '413' || body.code === 'EntityTooLarge') return 'too_large';
  } catch {
    // Not JSON: an ordinary failure.
  }
  return 'failed';
}

/** The refusal of an upload that did not reach the store. The screens offer Retry for failed. */
export function uploadFailed(status: number): ApiError {
  return new ApiError('failed', 'The file did not upload. Try again.', { reason: 'upload_failed', status });
}

/** The size refusal, in the form of the server refusal of files.uploadStart, so the screens name the limit. */
export function tooLarge(field: string, limit: number | undefined): ApiError {
  return new ApiError('invalid_input', 'This file is larger than the limit.', { fields: [field], reason: 'file_too_large', ...(limit ? { limit } : {}) });
}

/** The file limit of the active store from session.get. Without one, the ceiling of the contract; when the call fails, none. */
async function sessionLimit(ctx: AdapterCtx): Promise<number | undefined> {
  try {
    const session = (await ctx.call('session.get', {})) as { limits?: { maxFileBytes?: number } } | null;
    return session?.limits?.maxFileBytes ?? MAX_FILE_BYTES;
  } catch {
    return undefined;
  }
}

/** The fields of files.upload that go on the wire next to the upload ID (the wire form is strict). */
const SHARED_FIELDS = ['projectId', 'name', 'stageId', 'taskId', 'asCover', 'receivedFromClient'] as const;

type ScreenUpload = {
  projectId: string;
  name: string;
  blob: Blob;
  stageId?: string | null;
  taskId?: string | null;
  asCover?: boolean;
  receivedFromClient?: boolean;
};

/** A small picture only for a picture, and only one that the server takes (10 MB at most). A failure gives none. */
async function thumbOf(blob: Blob, makeThumb: (file: Blob) => Promise<Blob | null>): Promise<Blob | null> {
  if (!blob.type.startsWith('image/')) return null;
  try {
    const thumb = await makeThumb(blob);
    return thumb && thumb.size > 0 && thumb.size <= MAX_SHOT_BYTES && thumb.type.startsWith('image/') ? thumb : null;
  } catch {
    return null;
  }
}

export function uploadAdapter(o: {
  makeThumb: (file: Blob) => Promise<Blob | null>;
  put?: PutSender;
  /** The limit for the size refusal. The default asks session.get. */
  limit?: (ctx: AdapterCtx) => Promise<number | undefined>;
}): Adapter {
  const send = o.put ?? xhrPut;
  const limitOf = o.limit ?? sessionLimit;
  return async (raw, ctx) => {
    const input = raw as ScreenUpload;
    const blob = input.blob;
    const thumb = await thumbOf(blob, o.makeThumb);
    const fields: Record<string, unknown> = {};
    for (const name of SHARED_FIELDS) if (input[name] !== undefined) fields[name] = input[name];

    // Step 1: the server checks the rights and the size, and signs the uploads.
    const start = (await ctx.call('files.uploadStart', {
      projectId: input.projectId,
      name: input.name,
      size: blob.size,
      mimeType: blob.type || 'application/octet-stream',
      ...(input.stageId !== undefined ? { stageId: input.stageId } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      ...(thumb ? { thumb: { size: thumb.size, mimeType: thumb.type } } : {}),
    })) as { uploadId: string; put: SignedPut; thumbPut?: SignedPut };

    // Step 2: the browser sends the file straight to the store. Only the browser sees the size refusal of the store.
    const result = await send(start.put, blob);
    const failure = putFailure(result);
    if (failure === 'too_large') throw tooLarge('blob', await limitOf(ctx));
    if (failure) throw uploadFailed(result.status);
    // The small picture is extra: when it does not arrive, the server saves the version without one.
    if (thumb && start.thumbPut) await send(start.thumbPut, thumb);

    // Step 3: the server checks the stored object and saves the version.
    return ctx.call('files.upload', { ...fields, uploadId: start.uploadId });
  };
}
