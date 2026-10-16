import { MAX_SHOT_BYTES } from '../../src/api/contract/server';
import { ApiError, invalid } from '../../src/api/errors';
import type { FilesPort } from '../core/ports';
import { HEAD_TIMEOUT_MS, baseMimeType, isPictureType, storedMimeType } from './links';

/**
 * The preflight check of an uploaded object (plan 5.2, step 3; proof.md, Z0a item 6; task F2), before the office lock:
 *
 *   1. head on the final key (3 s limit). When it holds an object, an earlier attempt already copied it (a retry after a busy
 *      lock, a staging removal that failed, or a head that timed out after a good copy): the check runs on that object, the
 *      staging leftover goes quietly, and nothing is copied. Storage refuses a copy onto a key that holds an object, and R2
 *      would replace it, so a confirmed version never changes.
 *   2. head on the staging key, compared with the intent: the size, and the type in lower case without parameters against
 *      storedMimeType of the declared type. The signed link does not fix the type on Storage, so this is the only type guard
 *      there. An R2 link signs the type, so R2 refuses a PUT with another type; the check still runs.
 *   3. copy to the empty final key, then head on the final key and the same comparison: the copy result is what a file version uses.
 *   4. remove the staging key.
 *
 * A second PUT to the staging link: Supabase Storage signs the links without upsert, so it refuses a PUT to a staging key that
 * holds an object. R2 (S3) has no such rule: a second PUT replaces the staged object, also between steps 2 and 3. The guard on
 * both stores is the head of the final key after the copy (step 3): the object that the version uses must have the declared
 * size and type, so a replaced object passes only when it matches the intent. Only the person who started the upload has the
 * link. server/it/files.it.test.ts pins both stores.
 *
 * A mismatch refuses the call and removes the object.
 */

type Found = { size: number; mimeType: string };
type Accept = (object: Found) => ApiError | null;
type Remove = (keys: string[]) => Promise<void>;

export function fileTooLarge(field: string, limit: number): ApiError {
  return new ApiError('invalid_input', 'This file is larger than the limit.', { fields: [field], reason: 'file_too_large', limit });
}

const notTheFile = (field: string) => invalid(field, 'The file that arrived is not the file you chose. Upload it again.');
const notArrived = (field: string) => invalid(field, 'The file did not arrive. Upload it again.');

/** A removal never hides the answer of the check: a key left behind is an old staging object, and the job deletes those. */
async function quietly(remove: Remove, keys: string[]): Promise<void> {
  try {
    await remove(keys);
  } catch {
    // The job deletes every up/ object older than 2 hours 10 minutes (proof.md, Z0a item 6).
  }
}

/** true when the final key now holds an accepted object; false when nothing arrived. */
async function confirmObject(files: FilesPort, o: { staging: string; final: string; field: string; accept: Accept; remove: Remove }): Promise<boolean> {
  const done = await files.head(o.final, { timeoutMs: HEAD_TIMEOUT_MS });
  if (done) {
    const refused = o.accept(done);
    if (refused) {
      await quietly(o.remove, [o.final]);
      throw refused;
    }
    await quietly(o.remove, [o.staging]);
    return true;
  }
  const staged = await files.head(o.staging, { timeoutMs: HEAD_TIMEOUT_MS });
  if (!staged) return false;
  const refused = o.accept(staged);
  if (refused) {
    await quietly(o.remove, [o.staging]);
    throw refused;
  }
  await files.copy(o.staging, o.final);
  const copied = await files.head(o.final, { timeoutMs: HEAD_TIMEOUT_MS });
  const wrong = copied ? o.accept(copied) : notArrived(o.field);
  if (wrong) {
    await quietly(o.remove, [o.staging, o.final]);
    throw wrong;
  }
  await quietly(o.remove, [o.staging]);
  return true;
}

/** The file of an upload: exactly the declared size and stored type, and within the limit of the active store. */
export async function confirmUpload(
  files: FilesPort,
  o: { staging: string; final: string; field: string; want: { size: number; mimeType: string }; maxBytes: number; remove: Remove },
): Promise<void> {
  const type = storedMimeType(o.want.mimeType);
  const accept: Accept = (object) => {
    if (object.size > o.maxBytes) return fileTooLarge(o.field, o.maxBytes);
    if (object.size !== o.want.size || baseMimeType(object.mimeType) !== type) return notTheFile(o.field);
    return null;
  };
  if (!(await confirmObject(files, { ...o, accept }))) throw notArrived(o.field);
}

/** The small picture of an upload: an inline-safe picture of 10 MB or less. None arrived: the version has no thumb. */
export async function confirmThumb(files: FilesPort, o: { staging: string; final: string; field: string; remove: Remove }): Promise<boolean> {
  const accept: Accept = (object) => (isPictureType(object.mimeType) && object.size >= 1 && object.size <= MAX_SHOT_BYTES ? null : notTheFile(o.field));
  return confirmObject(files, { ...o, accept });
}
