import { MAX_FILE_BYTES } from '../../src/api/contract/entities';
import { invalid, notFound } from '../../src/api/errors';
import type { UploadPrepared } from '../../src/api/handlers/files';
import type { ServerHooks } from '../../src/api/registry';
import type { Deps } from '../core/ports';
import type { ServerCall } from '../core/types';
import { confirmThumb, confirmUpload, fileTooLarge } from '../files/confirm';
import { projectBlobKeys, removeNowOrLater, stashProjectKeys } from '../files/effects';
import { checkIntent, declaredType, insertIntents, intentExpiry, newUploadId, readIntents, useIntents } from '../files/intents';
import { stagingKey, stagingThumbKey, uploadKey, uploadThumbKey } from '../files/keys';
import { isPictureType } from '../files/links';
import { projectOfTask, readFile } from '../files/records';
import { assertMayPost, assertMayView, authorityOf } from '../files/rights';

/**
 * The file calls of the server (plan 5.2; plan 2b, points 1 and 7; proof.md, Z0a item 6; task F2), on the active store
 * (Supabase Storage or R2 behind FilesPort).
 *
 * Every call and hook that signs a link checks the rights right before it signs (server/files/rights.ts): an inactive person or an
 * agent whose person is off gets no link, even when the call runs outside runCall.
 */

/** Every small picture passed isPictureType at the start and in the preflight, so its link follows the screen's choice. */
const THUMB_LINK_TYPE = 'image/webp';

/** The largest file of the active store, never above the shared ceiling (plan 2b, point 1). */
const fileLimit = (deps: Deps) => Math.min(deps.files.maxFileBytes, MAX_FILE_BYTES);

/**
 * files.uploadStart: the rights and the size first, then a signed PUT for the staging key (and one for the small picture), then
 * the intent with the final key. The final key is named by the intent (server/files/keys.ts), because the file id comes later.
 */
export const filesUploadStart: ServerCall<'files.uploadStart'> = async (input, ctx) => {
  const { deps, office, now } = ctx;
  const userId = ctx.principal.userId;
  authorityOf((id) => office.lists.users[id], userId);
  const project = office.lists.projects[input.projectId];
  if (!project) throw notFound('Project', input.projectId);
  assertMayPost(office, userId, project.id);
  if (input.stageId && office.lists.stages[input.stageId]?.projectId !== project.id) throw invalid('stageId', 'This stage is not in the project.');
  if (input.taskId && (await projectOfTask(deps.db, input.taskId)) !== project.id) throw invalid('taskId', 'This task is not in the project.');
  const limit = fileLimit(deps);
  if (input.size > limit) throw fileTooLarge('size', limit);
  if (input.thumb && !isPictureType(input.thumb.mimeType)) throw invalid('thumb', 'The small picture must be a PNG, JPEG, GIF, WebP or AVIF picture.');

  const id = newUploadId();
  const put = await deps.files.presignPut(stagingKey(id), { mimeType: input.mimeType, size: input.size });
  const thumbPut = input.thumb ? await deps.files.presignPut(stagingThumbKey(id), { mimeType: input.thumb.mimeType, size: input.thumb.size }) : undefined;
  await insertIntents(deps.db, [{
    id, actorId: userId, projectId: project.id, stagingKey: stagingKey(id), key: uploadKey(project.id, id),
    thumbKey: input.thumb ? uploadThumbKey(project.id, id) : null, size: input.size, mimeType: declaredType(input.mimeType),
    expiresAt: intentExpiry(now, deps.files.kind), usedAt: null,
  }]);
  return { output: { uploadId: id, put, ...(thumbPut ? { thumbPut } : {}) }, changed: false };
};

/**
 * files.link: a 10-minute download link to one version or its small picture. The person check comes before any read, the view
 * right before the signing. The store makes every type outside the inline safe list a download (server/files/links.ts).
 */
export const filesLink: ServerCall<'files.link'> = async (input, ctx) => {
  const { deps, office } = ctx;
  const userId = ctx.principal.userId;
  authorityOf((id) => office.lists.users[id], userId);
  const file = await readFile(deps.db, input.id);
  if (!file) throw notFound('File', input.id);
  if (!office.lists.projects[file.projectId]) throw notFound('Project', file.projectId);
  assertMayView(office, userId, file.projectId);
  const version = input.letter ? file.versions.find((v) => v.letter === input.letter) : file.versions[file.versions.length - 1];
  if (!version) throw notFound('Version', input.letter ?? '');
  const thumb = input.variant === 'thumb' && version.thumbKey !== undefined;
  const link = await deps.files.presignGet(thumb ? version.thumbKey! : version.blobKey, {
    disposition: input.disposition, filename: file.name, mimeType: thumb ? THUMB_LINK_TYPE : version.mimeType,
  });
  return { output: { url: link.url, expiresAt: link.expiresAt, name: file.name, mimeType: version.mimeType, size: version.size }, changed: false };
};

type UploadInput = { projectId: string; uploadId: string };

/**
 * files.upload on the server. The preflight (before the lock) checks the intent, then the object and its copy on the final key
 * (server/files/confirm.ts); a mismatch refuses and removes the object. A used intent skips the store, for the key replay. prepare (inside the lock) marks the intent used, once, and
 * gives run() the final key, the size, the declared type and the small picture.
 */
export const filesUploadHooks: ServerHooks<unknown, UploadPrepared, Deps> = {
  async preflight(input, { actorId, now, deps }): Promise<UploadPrepared> {
    const { projectId, uploadId } = input as UploadInput;
    const intent = checkIntent((await readIntents(deps.db, [uploadId])).get(uploadId), { id: uploadId, actorId, now, field: 'uploadId', projectId, allowUsed: true });
    // A used intent: a retry of a call that committed. No store call, because a late second PUT may sit on the staging key; runCall
    // replays the stored answer of the key, and without one prepare refuses with conflict.
    if (intent.usedAt !== null) return { blobKey: intent.key, size: intent.size, mimeType: intent.mimeType, ...(intent.thumbKey ? { thumbKey: intent.thumbKey } : {}) };
    const remove = (keys: string[]) => removeNowOrLater(deps, keys);
    await confirmUpload(deps.files, { staging: intent.stagingKey, final: intent.key, field: 'uploadId', want: intent, maxBytes: fileLimit(deps), remove });
    const thumb = intent.thumbKey !== null && (await confirmThumb(deps.files, { staging: stagingThumbKey(intent.id), final: intent.thumbKey, field: 'uploadId', remove }));
    return { blobKey: intent.key, size: intent.size, mimeType: intent.mimeType, ...(thumb && intent.thumbKey ? { thumbKey: intent.thumbKey } : {}) };
  },
  async prepare(input, { actorId, now, q }, preflight): Promise<UploadPrepared> {
    await useIntents(q, [(input as UploadInput).uploadId], actorId, now);
    return preflight as UploadPrepared;
  },
};

/**
 * projects.delete on the server (plan 5.2, the prepare for projects.delete): inside the lock, the stored data keys of the project's
 * files and file events. The outbox row of the same transaction removes, after the commit, the ones that no other record uses
 * (server/files/effects.ts).
 */
export const projectsDeleteHooks: ServerHooks<unknown, { blobKeys: string[] }, Deps> = {
  async prepare(input, { q }) {
    const blobKeys = await projectBlobKeys(q, (input as { id: string }).id);
    stashProjectKeys(q, blobKeys);
    return { blobKeys };
  },
};
