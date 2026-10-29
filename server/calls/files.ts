import { fileLimitOf, type FileRec, type Task, type UploadPlace } from '../../src/api/contract/entities';
import { forbidden, invalid, notFound } from '../../src/api/errors';
import type { UploadPrepared } from '../../src/api/handlers/files';
import { fileHiddenByLock } from '../../src/api/folderLock';
import { can, taskResource } from '../../src/api/permissions';
import type { ServerHooks } from '../../src/api/registry';
import type { State } from '../../src/api/store';
import type { Deps } from '../core/ports';
import type { BatchScope, Principal, ServerCall } from '../core/types';
import { confirmThumb, confirmUpload, fileTooLarge } from '../files/confirm';
import { projectBlobKeys, removeNowOrLater, stashProjectKeys } from '../files/effects';
import { checkIntent, declaredType, insertIntents, intentExpiry, newUploadId, readIntents, useIntents } from '../files/intents';
import { chatUploadKey, chatUploadThumbKey, meetingUploadKey, meetingUploadThumbKey, officeUploadKey, officeUploadThumbKey, stagingKey, stagingThumbKey, uploadKey, uploadThumbKey } from '../files/keys';
import { isPictureType } from '../files/links';
import { projectOfTask, readFile, readFiles, readMeeting, readTask } from '../files/records';
import { assertMayPost, assertMayUploadToChat, assertMayUploadToMeeting, assertMayView, assertMayViewChatFile, assertMayViewMeetingFile, assertMayViewOfficeFile, authorityOf, mayViewOfficeTask } from '../files/rights';

/**
 * The file calls of the server (plan 5.2; plan 2b, points 1 and 7; proof.md, Z0a item 6; task F2), on the active store
 * (Supabase Storage or R2 behind FilesPort).
 *
 * Every call and hook that signs a link checks the rights right before it signs (server/files/rights.ts): an inactive person or an
 * agent whose person is off gets no link, even when the call runs outside runCall.
 */

/** Every small picture passed isPictureType at the start and in the preflight, so its link follows the screen's choice. */
const THUMB_LINK_TYPE = 'image/webp';

/**
 * The largest file for a place (plan 2b, point 1; fbk_070): 500 MB for the files of a project, 250 MB for a direct chat, a group, a meeting
 * and an office to-do, never above the limit of the active store.
 */
const fileLimit = (deps: Deps, place: UploadPlace) => fileLimitOf(place, deps.files.maxFileBytes);

/**
 * files.uploadStart: the rights and the size first, then a signed PUT for the staging key (and one for the small picture), then
 * the intent with the final key. The final key is named by the intent (server/files/keys.ts), because the file id comes later.
 */
export const filesUploadStart: ServerCall<'files.uploadStart'> = async (input, ctx) => {
  const { deps, office, now } = ctx;
  const userId = ctx.principal.userId;
  authorityOf((id) => office.lists.users[id], userId);
  // The place of the upload: a project, or one office task (owner, 2026-10-06). It names the final key.
  let place: { projectId: string | null; key: (intent: string) => string; thumb: (intent: string) => string };
  if (input.meetingId !== undefined) {
    // A file of a meeting with no project (wave 2): a person who may write its minutes now, and no project, chat, stage or task.
    if (input.projectId !== undefined || input.conversationId !== undefined) throw invalid('meetingId', 'Name the project, the chat or the meeting of the file, only one.', 'file_meeting');
    const meeting = assertMayUploadToMeeting(office, userId, await readMeeting(deps.db, input.meetingId), input.meetingId, now);
    if (input.stageId || input.taskId) throw invalid(input.stageId ? 'stageId' : 'taskId', 'A file of a meeting belongs to no stage and no task. It stays with its meeting.', 'file_meeting');
    place = { projectId: null, key: (intent) => meetingUploadKey(meeting.id, intent), thumb: (intent) => meetingUploadThumbKey(meeting.id, intent) };
  } else if (input.conversationId !== undefined) {
    // A file of a direct chat or a group (owner, 2026-10-19): a member who may send in that chat, and no project, stage or task.
    if (input.projectId !== undefined) throw invalid('conversationId', 'Name the project, or the chat of the file, not both.', 'file_chat');
    const chat = assertMayUploadToChat(office, userId, input.conversationId);
    if (input.stageId || input.taskId) throw invalid(input.stageId ? 'stageId' : 'taskId', 'A file of a chat belongs to no stage and no task. It stays in its chat.', 'file_chat');
    place = { projectId: null, key: (intent) => chatUploadKey(chat.id, intent), thumb: (intent) => chatUploadThumbKey(chat.id, intent) };
  } else if (input.projectId === undefined) {
    const task = await officeTaskOfUpload(ctx, input.taskId ?? undefined);
    if (input.stageId) throw invalid('stageId', 'An office task belongs to no project, so it has no stage.', 'office_no_stage');
    place = { projectId: null, key: (intent) => officeUploadKey(task.id, intent), thumb: (intent) => officeUploadThumbKey(task.id, intent) };
  } else {
    const project = office.lists.projects[input.projectId];
    if (!project) throw notFound('Project', input.projectId);
    assertMayPost(office, userId, project.id);
    if (input.stageId && office.lists.stages[input.stageId]?.projectId !== project.id) throw invalid('stageId', 'This stage is not in the project.');
    if (input.taskId && (await projectOfTask(deps.db, input.taskId)) !== project.id) throw invalid('taskId', 'This task is not in the project.');
    place = { projectId: project.id, key: (intent) => uploadKey(project.id, intent), thumb: (intent) => uploadThumbKey(project.id, intent) };
  }
  const limit = fileLimit(deps, input);
  if (input.size > limit) throw fileTooLarge('size', limit);
  if (input.thumb && !isPictureType(input.thumb.mimeType)) throw invalid('thumb', 'The small picture must be a PNG, JPEG, GIF, WebP or AVIF picture.');

  const id = newUploadId();
  const put = await deps.files.presignPut(stagingKey(id), { mimeType: input.mimeType, size: input.size });
  const thumbPut = input.thumb ? await deps.files.presignPut(stagingThumbKey(id), { mimeType: input.thumb.mimeType, size: input.thumb.size }) : undefined;
  await insertIntents(deps.db, [{
    id, actorId: userId, projectId: place.projectId, stagingKey: stagingKey(id), key: place.key(id),
    thumbKey: input.thumb ? place.thumb(id) : null, size: input.size, mimeType: declaredType(input.mimeType),
    expiresAt: intentExpiry(now, deps.files.kind), usedAt: null,
  }]);
  return { output: { uploadId: id, put, ...(thumbPut ? { thumbPut } : {}) }, changed: false };
};

/**
 * The office task of an upload with no project (owner, 2026-10-06), as files.upload reads it (src/api/handlers/files.ts): a task
 * that the person does not see reads as missing, a project task needs its project, and the person must upload there (file.upload).
 */
async function officeTaskOfUpload(ctx: Parameters<ServerCall<'files.uploadStart'>>[1], taskId: string | undefined): Promise<Task> {
  if (!taskId) throw invalid('projectId', 'Name the project, or the office task of the file.', 'office_needs_task');
  const task = await readTask(ctx.deps.db, taskId);
  const { authority, sees } = mayViewOfficeTask(ctx.office, ctx.principal.userId, task);
  if (!task || !sees) throw notFound('Task', taskId);
  if (task.projectId !== null) throw invalid('projectId', 'This task belongs to a project. Name the project.', 'office_needs_task');
  if (!can(authority, 'file.upload', taskResource(ctx.office.lists as unknown as State, task, authority.id))) throw forbidden('You cannot do this.', { action: 'file.upload' });
  return task;
}

/**
 * files.link: a 10-minute download link to one version or its small picture. The person check comes before any read, the view
 * right before the signing. The store makes every type outside the inline safe list a download (server/files/links.ts).
 */
export const filesLink: ServerCall<'files.link'> = async (input, ctx) => {
  const { deps, office } = ctx;
  const userId = ctx.principal.userId;
  authorityOf((id) => office.lists.users[id], userId);
  // The record may already be in the batch: handleBatch read the files of a run of adjacent links with one statement (SV-11).
  const held = ctx.batch.files;
  const file = held?.has(input.id) ? held.get(input.id) : await readFile(deps.db, input.id);
  if (!file) throw notFound('File', input.id);
  // A file of a meeting with no project: the people who see that meeting, right before the signing (wave 2).
  if (file.meetingId !== undefined) assertMayViewMeetingFile(office, userId, await readMeeting(deps.db, file.meetingId), file.id);
  // A file of a direct chat or a group: the people who read its messages, right before the signing (owner, 2026-10-19).
  else if (file.conversationId !== undefined) assertMayViewChatFile(office, userId, file.conversationId, file.id);
  // A file of an office task: the view right on that task, right before the signing (owner, 2026-10-06).
  else if (file.projectId === null) assertMayViewOfficeFile(office, userId, file.taskId ? await readTask(deps.db, file.taskId) : undefined, file.id);
  else {
    if (!office.lists.projects[file.projectId]) throw notFound('Project', file.projectId);
    // A file of a hidden project reads as a missing file, never as a refusal (hidden projects, owner 2026-10-22).
    const authority = assertMayView(office, userId, file.projectId, () => notFound('File', file.id));
    // A file in a locked folder reads as a missing file for a person without the switch "Locked folders" (fbk_074).
    if (fileHiddenByLock(office.lists, authority, file)) throw notFound('File', file.id);
  }
  const version = input.letter ? file.versions.find((v) => v.letter === input.letter) : file.versions[file.versions.length - 1];
  if (!version) throw notFound('Version', input.letter ?? '');
  const thumb = input.variant === 'thumb' && version.thumbKey !== undefined;
  const link = await deps.files.presignGet(thumb ? version.thumbKey! : version.blobKey, {
    disposition: input.disposition, filename: file.name, mimeType: thumb ? THUMB_LINK_TYPE : version.mimeType,
  });
  return { output: { url: link.url, expiresAt: link.expiresAt, name: file.name, mimeType: version.mimeType, size: version.size }, changed: false };
};

/** The most files that one run of links reads at once. A longer run reads the rest one by one. */
const LINK_RUN_MAX = 200;

/**
 * handleBatch calls it before a run of adjacent files.link entries (SV-11): one statement reads the files of the whole run into
 * batch.files, so each link finds its record and sends no read of its own. It reads nothing for a person who may not act, or when
 * the batch holds no office, and it never throws: any miss leaves every link to read its own file, with its own error. The view
 * right and the signing stay in filesLink, per link.
 */
export async function prefetchLinkRun(deps: Deps, batch: BatchScope, principal: Principal, run: { input: unknown }[]): Promise<void> {
  const office = batch.office;
  if (!office) return;
  try {
    authorityOf((id) => office.lists.users[id], principal.userId);
    const ids = [...new Set(run.flatMap(({ input }) => {
      const id = (input as { id?: unknown } | null)?.id;
      return typeof id === 'string' ? [id] : [];
    }))].slice(0, LINK_RUN_MAX);
    if (ids.length < 2) return;
    const found = await readFiles(deps.db, ids);
    batch.files = new Map<string, FileRec | undefined>(ids.map((id) => [id, found.get(id)]));
  } catch {
    batch.files = undefined;
  }
}

/** No projectId: an upload of the office task taskId (owner, 2026-10-06), of the chat conversationId (owner, 2026-10-19), or of the meeting meetingId (wave 2). */
type UploadInput = { projectId?: string; uploadId: string; taskId?: string | null; conversationId?: string; meetingId?: string };

/**
 * files.upload on the server. The preflight (before the lock) checks the intent, then the object and its copy on the final key
 * (server/files/confirm.ts); a mismatch refuses and removes the object. A used intent skips the store, for the key replay. prepare (inside the lock) marks the intent used, once, and
 * gives run() the final key, the size, the declared type and the small picture.
 */
export const filesUploadHooks: ServerHooks<unknown, UploadPrepared, Deps> = {
  async preflight(input, { actorId, now, deps }): Promise<UploadPrepared> {
    const { projectId, uploadId, taskId, conversationId, meetingId } = input as UploadInput;
    // No project: the intent must be one of the meeting the call names (wave 2), of the chat it names (owner, 2026-10-19), or of the office task it names (owner, 2026-10-06).
    const place = meetingId !== undefined ? { projectId: projectId ?? null, meetingId, ...(conversationId !== undefined ? { conversationId } : {}) }
      : conversationId !== undefined ? { projectId: projectId ?? null, conversationId }
      : projectId !== undefined ? { projectId } : { projectId: null, officeTaskId: taskId ?? '' };
    const intent = checkIntent((await readIntents(deps.db, [uploadId])).get(uploadId), { id: uploadId, actorId, now, field: 'uploadId', ...place, allowUsed: true });
    // A used intent: a retry of a call that committed. No store call, because a late second PUT may sit on the staging key; runCall
    // replays the stored answer of the key, and without one prepare refuses with conflict.
    if (intent.usedAt !== null) return { blobKey: intent.key, size: intent.size, mimeType: intent.mimeType, ...(intent.thumbKey ? { thumbKey: intent.thumbKey } : {}) };
    const remove = (keys: string[]) => removeNowOrLater(deps, keys);
    await confirmUpload(deps.files, { staging: intent.stagingKey, final: intent.key, field: 'uploadId', want: intent, maxBytes: fileLimit(deps, { projectId, conversationId, meetingId }), remove });
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
