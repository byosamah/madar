import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { fileLimitOf } from '../contract/limits';
import { ConversationId, FileId, FileVersion, FolderId, MeetingId, ProjectId, StageId, TaskId, type FileRec, type FileVersion as Version, type Task } from '../contract/entities';
import { FileView, TrackerRow } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { nextId } from '../store';
import { chatForUpload } from '../chatState';
import { minutesRefusal, requireMeeting } from './meetings';
import { assertAgentMayOpenChatFile, fileViewOf, mayDeleteFile, mayOpenFile, mayViewFile, trackerRowOf } from '../views';
import { assertCan, requireProject, requireStage, requireTask, roleIn, taskRole, touch } from './shared';
import { addTrackerEntry } from './tracker';
import { assertFitsLockedFolder, checkPlace } from './folders';
import { fileHiddenByLock, fileInLockedFolder, foldersFor } from '../folderLock';

/** A, B, ... Z, AA, AB: the version letters. */
export function nextLetter(previous: string): string {
  let n = 0;
  for (const ch of previous) n = n * 26 + (ch.charCodeAt(0) - 64);
  n += 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * The office task of a file call with no project: the task must be an office task that the person sees (owner, 2026-10-06). A call
 * names a project, or an office task alone.
 */
export function officeTaskOfCall(ctx: Ctx, taskId: string | null | undefined): Task {
  if (!taskId) throw invalid('projectId', 'Name the project, or the office task of the file.', 'office_needs_task');
  const task = requireTask(ctx, taskId);
  if (task.projectId !== null) throw invalid('projectId', 'This task belongs to a project. Name the project.', 'office_needs_task');
  return task;
}

export const filesList = defineCall({
  /** No projectId: the files of one office task (taskId) that the person sees (owner, 2026-10-06). */
  input: z.object({ projectId: ProjectId.optional(), stageId: StageId.optional(), taskId: TaskId.optional() }),
  output: z.array(FileView),
  readOnly: true,
  run(input, ctx) {
    const projectId = input.projectId ?? null;
    if (projectId === null) officeTaskOfCall(ctx, input.taskId);
    else requireProject(ctx, projectId);
    return Object.values(ctx.state.files)
      .filter((f) => f.meetingId === undefined && f.conversationId === undefined && f.projectId === projectId
        && (!input.stageId || f.stageId === input.stageId) && (!input.taskId || f.taskId === input.taskId)
        // A file in a locked folder shows only to the people who hold the switch "Locked folders" (fbk_074).
        && !fileHiddenByLock(ctx.state, ctx.authority, f))
      .map((f) => fileViewOf(ctx.state, f, ctx.authority))
      .sort((a, b) => b.latest.uploadedAt.localeCompare(a.latest.uploadedAt));
  },
});

export const filesGet = defineCall({
  input: z.object({ id: FileId, letter: z.string().regex(/^[A-Z]+$/).optional() }),
  output: z.object({ file: FileView, version: FileVersion, blob: z.instanceof(Blob) }),
  readOnly: true,
  async prepare(input, p) {
    const file = p.state.files[input.id];
    if (!file) throw notFound('File', input.id);
    const version = input.letter ? file.versions.find((v) => v.letter === input.letter) : file.versions[file.versions.length - 1];
    if (!version) throw notFound('Version', input.letter ?? '');
    const blob = await p.persister.getBlob(version.blobKey);
    if (!blob) throw notFound('File data', version.blobKey);
    return { blob, version };
  },
  run(input, ctx, prepared) {
    const file = ctx.state.files[input.id];
    // An agent never opens the file of a meeting with no project (owner, 2026-10-19). A chat file follows its person (owner, 2026-10-26).
    if (!file || !mayOpenFile(ctx.state, ctx.authority, ctx.actor, file)) throw notFound('File', input.id);
    assertAgentMayOpenChatFile(ctx.state, ctx.actor, ctx.authority, file);
    return { file: fileViewOf(ctx.state, file, ctx.authority), version: prepared.version, blob: prepared.blob };
  },
});

/** The fields of an upload that both forms share. */
const UploadFields = z.object({
  /** None: a file of the office task taskId (owner, 2026-10-06), or of the direct chat or group conversationId (owner, 2026-10-19). */
  projectId: ProjectId.optional(),
  /** A direct chat or a group. The file stays in that chat: no project, no stage, no task, no cover. */
  conversationId: ConversationId.optional(),
  /** A meeting with no project (fbk_022, wave 2). The file stays with that meeting: no project, no stage, no task, no cover. */
  meetingId: MeetingId.optional(),
  name: z.string().trim().min(1).max(200),
  stageId: StageId.nullable().default(null),
  /** A folder of the stage (fbk_066). The file takes the stage of the folder; a stage that differs is refused. Optional, so older calls still parse. */
  folderId: FolderId.nullable().optional(),
  taskId: TaskId.nullable().default(null),
  asCover: z.boolean().default(false),
  /** The client sent this file: the upload also logs a File entry on the tracker. */
  receivedFromClient: z.boolean().default(false),
});

/** A new file or a new version: the same name on the same place (a project, or one office task) adds the next letter. */
function addVersion(ctx: Ctx, place: { projectId: string | null; stageId: string | null; taskId: string | null; folderId?: string | null }, name: string, version: Version): FileRec {
  // A file in a locked folder that the person may not see is not a match: the upload makes a new file, and so tells nothing about the locked one (fbk_074).
  // A locked folder keeps its own files: a file of the same name in another place is no match for an upload into the folder, and a locked file is no
  // match for an upload outside it (fbk_074).
  const lockedPlace = fileInLockedFolder(ctx.state, { projectId: place.projectId, folderId: place.folderId });
  const same = Object.values(ctx.state.files).find((f) => f.projectId === place.projectId
    && (place.projectId !== null || f.taskId === place.taskId) && f.name.toLowerCase() === name.toLowerCase() && !fileHiddenByLock(ctx.state, ctx.authority, f)
    && ((!lockedPlace && !fileInLockedFolder(ctx.state, f)) || (f.folderId ?? null) === (place.folderId ?? null)));
  if (same) {
    version.letter = nextLetter(same.versions[same.versions.length - 1].letter);
    const before = { versions: structuredClone(same.versions) };
    same.versions.push(version);
    writeEvent(ctx, { projectId: place.projectId, verb: 'file.version_added', targetType: 'file', targetId: same.id, before, after: { versions: structuredClone(same.versions) } });
    return same;
  }
  const id = nextId(ctx.state, 'fil');
  const file: FileRec = { id, projectId: place.projectId, stageId: place.stageId, taskId: place.taskId, ...(place.folderId ? { folderId: place.folderId } : {}), name, versions: [version] };
  ctx.state.files[id] = file;
  recordCreate(ctx, { projectId: place.projectId, verb: 'file.added', targetType: 'file', targetId: id, entity: file });
  return file;
}

/**
 * A file of an office task (owner, 2026-10-06): a person who sees the task adds it. It has no stage, no cover and no Tracker entry.
 */
function uploadOfficeFile(ctx: Ctx, input: { name: string; stageId: string | null; taskId: string | null; asCover: boolean; receivedFromClient: boolean }, prepared: UploadPrepared): FileView {
  const task = officeTaskOfCall(ctx, input.taskId);
  assertCan(ctx, 'file.upload', taskRole(ctx, task));
  if (input.stageId) throw invalid('stageId', 'An office task belongs to no project, so it has no stage.', 'office_no_stage');
  if (input.asCover || input.receivedFromClient) throw invalid(input.asCover ? 'asCover' : 'receivedFromClient', 'A file of an office task stays on its task.', 'file_office_task');
  const version: Version = {
    letter: 'A', blobKey: prepared.blobKey, mimeType: prepared.mimeType, size: prepared.size,
    uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp, ...(prepared.thumbKey ? { thumbKey: prepared.thumbKey } : {}),
  };
  const file = addVersion(ctx, { projectId: null, stageId: null, taskId: task.id }, input.name, version);
  return fileViewOf(ctx.state, file, ctx.authority);
}

/**
 * A file of a direct chat or a group (owner, 2026-10-19): a member who may send in that chat adds it (chatForUpload). It has no stage,
 * no cover and no Tracker entry, and it writes no History event, because it shows only in the messages of its chat. A second file with
 * the same name is a new file, not a new version: an old message keeps the file that it carried.
 */
function uploadChatFile(ctx: Ctx, input: { name: string; stageId: string | null; taskId: string | null; asCover: boolean; receivedFromClient: boolean; conversationId?: string }, prepared: UploadPrepared): FileView {
  const conversation = chatForUpload(ctx.state, input.conversationId ?? '', ctx.authority, ctx.actor);
  const misuse = input.stageId ? 'stageId' : input.taskId ? 'taskId' : input.asCover ? 'asCover' : input.receivedFromClient ? 'receivedFromClient' : null;
  if (misuse) throw invalid(misuse, 'A file of a chat belongs to no stage, no task and no cover. It stays in its chat.', 'file_chat');
  const id = nextId(ctx.state, 'fil');
  const file: FileRec = {
    id, projectId: null, stageId: null, taskId: null, conversationId: conversation.id, name: input.name,
    versions: [{
      letter: 'A', blobKey: prepared.blobKey, mimeType: prepared.mimeType, size: prepared.size,
      uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp, ...(prepared.thumbKey ? { thumbKey: prepared.thumbKey } : {}),
    }],
  };
  ctx.state.files[id] = file;
  return fileViewOf(ctx.state, file, ctx.authority);
}

/**
 * A file of a meeting with no project (fbk_022, wave 2, owner 2026-10-19): a person who may write the minutes adds it, after the end
 * (minutesRefusal). It has no stage, no cover and no Tracker entry, and it writes no History event: it shows only in the minutes of its
 * meeting, which write the event (meetings.saveMinutes). A second file with the same name is a new file, not a new version.
 */
function uploadMeetingFile(ctx: Ctx, input: { name: string; stageId: string | null; taskId: string | null; asCover: boolean; receivedFromClient: boolean; meetingId?: string }, prepared: UploadPrepared): FileView {
  const meeting = requireMeeting(ctx, input.meetingId ?? '');
  // A project meeting, also a team meeting, uses the files of its project.
  if (meeting.projectId !== null) throw invalid('meetingId', 'A meeting with a project uses the files of its project. Name the project.', 'file_meeting');
  const refusal = minutesRefusal(ctx.state, meeting, ctx.authority, ctx.now);
  if (refusal) throw refusal;
  const misuse = input.stageId ? 'stageId' : input.taskId ? 'taskId' : input.asCover ? 'asCover' : input.receivedFromClient ? 'receivedFromClient' : null;
  if (misuse) throw invalid(misuse, 'A file of a meeting belongs to no stage, no task and no cover. It stays with its meeting.', 'file_meeting');
  const id = nextId(ctx.state, 'fil');
  const file: FileRec = {
    id, projectId: null, stageId: null, taskId: null, meetingId: meeting.id, name: input.name,
    versions: [{
      letter: 'A', blobKey: prepared.blobKey, mimeType: prepared.mimeType, size: prepared.size,
      uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp, ...(prepared.thumbKey ? { thumbKey: prepared.thumbKey } : {}),
    }],
  };
  ctx.state.files[id] = file;
  return fileViewOf(ctx.state, file, ctx.authority);
}

/**
 * What run() needs from the stored data. The prototype makes it from the blob in "prepare"; the real build makes it from the upload intent
 * in its server prepare hook (plan 5.2).
 */
export type UploadPrepared = { blobKey: string; size: number; mimeType: string; thumbKey?: string };

export const filesUpload = defineCall({
  // The screens send the blob (prototype) or an upload ID from files.uploadStart (real build): exactly one (plan 5.2).
  input: UploadFields.extend({ blob: z.instanceof(Blob).optional(), uploadId: z.string().min(1).max(80).optional() })
    .refine((value) => value.blob !== undefined || value.uploadId !== undefined, { path: ['blob'], message: 'Choose a file.' })
    .refine((value) => value.blob === undefined || value.uploadId === undefined, { path: ['uploadId'], message: 'Send the file or its upload, not both.' })
    // 500 MB for the files of a project, 250 MB for the files of a chat, a meeting and an office to-do (fbk_070).
    .refine((value) => value.blob === undefined || value.blob.size <= fileLimitOf(value), { path: ['blob'], message: 'This file is larger than the limit of its place.' }),
  output: FileView,
  wire: { input: UploadFields.extend({ uploadId: z.string().min(1).max(80) }).strict() },
  async prepare(input, p): Promise<UploadPrepared> {
    // The prototype keeps the data in this browser, so it has no uploads to confirm.
    if (input.uploadId !== undefined || !input.blob) throw invalid('uploadId', 'Send the file itself.');
    // The cover must be a picture, as in projects.update. The check comes before the data is stored (audit 2026-10-03, API-16).
    if (input.asCover && !input.blob.type.startsWith('image/')) throw invalid('asCover', 'The cover must be an image.', 'cover_not_image');
    const blobKey = `blob_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await p.persister.putBlob(blobKey, input.blob);
    return { blobKey, size: input.blob.size, mimeType: input.blob.type || 'application/octet-stream' };
  },
  run(input, ctx, prepared) {
    if (input.meetingId !== undefined) {
      if (input.projectId !== undefined || input.conversationId !== undefined) throw invalid('meetingId', 'Name the project, the chat or the meeting of the file, only one.', 'file_meeting');
      return uploadMeetingFile(ctx, input, prepared);
    }
    if (input.conversationId !== undefined) {
      if (input.projectId !== undefined) throw invalid('conversationId', 'Name the project, or the chat of the file, not both.', 'file_chat');
      return uploadChatFile(ctx, input, prepared);
    }
    if (input.projectId === undefined) return uploadOfficeFile(ctx, input, prepared);
    const project = requireProject(ctx, input.projectId);
    const role = roleIn(ctx, project.id);
    assertCan(ctx, 'file.upload', { projectRole: role });
    // "Received from the client" also writes a Tracker line, so it needs the delivery switch. The cover changes the project details.
    if (input.receivedFromClient) assertCan(ctx, 'file.deliver', { projectRole: role });
    if (input.asCover) assertCan(ctx, 'project.details', { projectRole: role });
    // A folder fixes the stage of the file (fbk_066): without a stage, the file takes the stage of the folder.
    const folderId = input.folderId ?? null;
    const stageId = input.stageId ?? (folderId ? (foldersFor(ctx.state, ctx.authority, project.folders).find((item) => item.id === folderId)?.stageId ?? null) : null);
    checkPlace(ctx, project, stageId, folderId);
    // A locked folder holds no file of a to-do, no cover and no file that the Tracker names (fbk_074).
    assertFitsLockedFolder(ctx, project, { id: '', taskId: input.taskId }, folderId);
    if (folderId && project.folders?.find((item) => item.id === folderId)?.locked === true) {
      if (input.asCover) throw invalid('asCover', 'The cover of the project cannot go in a locked folder.', 'folder_locked_cover');
      if (input.receivedFromClient) throw invalid('receivedFromClient', 'A file of a locked folder cannot be named on the Tracker.', 'folder_locked_tracker');
    }
    if (input.taskId && ctx.state.tasks[input.taskId]?.projectId !== project.id) throw invalid('taskId', 'This task is not in the project.');
    if (input.asCover && !prepared.mimeType.startsWith('image/')) throw invalid('asCover', 'The cover must be an image.', 'cover_not_image');
    const version: Version = {
      letter: 'A', blobKey: prepared.blobKey, mimeType: prepared.mimeType, size: prepared.size,
      uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp, ...(prepared.thumbKey ? { thumbKey: prepared.thumbKey } : {}),
    };
    const file = addVersion(ctx, { projectId: project.id, stageId, taskId: input.taskId, folderId }, input.name, version);
    // A new version of a file that already sits in a locked folder keeps the file there, so the cover and the Tracker line refuse it too.
    const locked = fileInLockedFolder(ctx.state, file);
    if (locked && input.asCover) throw invalid('asCover', 'The cover of the project cannot go in a locked folder.', 'folder_locked_cover');
    if (locked && input.receivedFromClient) throw invalid('receivedFromClient', 'A file of a locked folder cannot be named on the Tracker.', 'folder_locked_tracker');
    if (input.asCover) {
      applyPatch(ctx, project, { coverFileId: file.id }, { projectId: project.id, verb: 'project.cover_changed', targetType: 'project', targetId: project.id });
    }
    if (input.receivedFromClient) {
      const letter = file.versions[file.versions.length - 1].letter;
      addTrackerEntry(ctx, {
        projectId: project.id, type: 'file', direction: 'in', title: file.name, note: `Version ${letter}`, fileIds: [file.id], auto: 'upload',
      });
    }
    // A file in a locked folder is no news for the people who cannot see it: the "last update" of the project stays as it is.
    if (!locked) touch(ctx, project.id);
    return fileViewOf(ctx.state, file, ctx.authority);
  },
});

export const filesMarkDelivered = defineCall({
  input: z.object({ id: FileId }),
  output: TrackerRow,
  run(input, ctx) {
    const file = ctx.state.files[input.id];
    if (!file || !mayViewFile(ctx.state, ctx.authority, file)) throw notFound('File', input.id);
    if (file.conversationId !== undefined) throw invalid('id', 'A file of a chat stays in its chat.', 'file_chat');
    if (file.meetingId !== undefined) throw invalid('id', 'A file of a meeting stays with its meeting.', 'file_meeting');
    // An office task has no client, so its files are never delivered (owner, 2026-10-06).
    if (file.projectId === null) throw invalid('id', 'A file of an office task stays on its task.', 'file_office_task');
    // The Tracker line names the file, and the Tracker shows to the whole project (fbk_074).
    if (fileInLockedFolder(ctx.state, file)) throw invalid('id', 'A file of a locked folder cannot be named on the Tracker.', 'folder_locked_tracker');
    assertCan(ctx, 'file.deliver', { projectRole: roleIn(ctx, file.projectId) });
    const letter = file.versions[file.versions.length - 1].letter;
    const entry = addTrackerEntry(ctx, {
      projectId: file.projectId, type: 'file', direction: 'out', title: file.name, note: `Version ${letter}`, fileIds: [file.id], auto: 'delivered',
    });
    return trackerRowOf(ctx.state, entry, ctx.authority);
  },
});

export const filesDelete = defineCall({
  input: z.object({ id: FileId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const file = ctx.state.files[input.id];
    if (!file || !mayViewFile(ctx.state, ctx.authority, file)) throw notFound('File', input.id);
    if (file.conversationId !== undefined) throw invalid('id', 'A file of a chat stays in its chat.', 'file_chat');
    if (file.meetingId !== undefined) throw invalid('id', 'A file of a meeting stays with its meeting.', 'file_meeting');
    if (!mayDeleteFile(ctx.state, ctx.authority, file)) throw forbidden('Only the uploader or the project leader can delete this file.');
    const project = file.projectId === null ? undefined : ctx.state.projects[file.projectId];
    if (project?.coverFileId === file.id) {
      applyPatch(ctx, project, { coverFileId: null }, { projectId: project.id, verb: 'project.cover_changed', targetType: 'project', targetId: project.id });
    }
    const locked = fileInLockedFolder(ctx.state, file);
    recordDelete(ctx, { projectId: file.projectId, verb: 'file.deleted', targetType: 'file', targetId: file.id, entity: file });
    delete ctx.state.files[file.id];
    if (!locked) touch(ctx, file.projectId);
    return { deleted: true as const };
  },
});

/**
 * Moves a file to another stage, another folder, or both (fbk_066, owner 2026-10-26): one call for a drag, for "Move to" and for a drop. The place
 * is a stage of the project (null: No stage) and a folder of that stage (null: the root). The task of the file stays. The person who may upload
 * may move.
 */
export const filesMove = defineCall({
  input: z.object({ id: FileId, stageId: StageId.nullable(), folderId: FolderId.nullable().default(null) }),
  output: FileView,
  run(input, ctx) {
    const file = ctx.state.files[input.id];
    if (!file || !mayViewFile(ctx.state, ctx.authority, file)) throw notFound('File', input.id);
    if (file.conversationId !== undefined) throw invalid('id', 'A file of a chat stays in its chat.', 'file_chat');
    if (file.meetingId !== undefined) throw invalid('id', 'A file of a meeting stays with its meeting.', 'file_meeting');
    if (file.projectId === null) throw invalid('id', 'A file of an office task stays on its task.', 'file_office_task');
    const project = requireProject(ctx, file.projectId);
    assertCan(ctx, 'file.upload', { projectRole: roleIn(ctx, project.id) });
    checkPlace(ctx, project, input.stageId, input.folderId);
    assertFitsLockedFolder(ctx, project, file, input.folderId);
    if (file.stageId === input.stageId && (file.folderId ?? null) === input.folderId) return fileViewOf(ctx.state, file, ctx.authority);
    // A file saved before folders has no folderId. The event keeps the old value, so the Undo can put it back.
    if (file.folderId === undefined) file.folderId = null;
    // Organizing is no news: the move leaves the "last update" of the project as it is (no touch).
    applyPatch(ctx, file, { stageId: input.stageId, folderId: input.folderId }, { projectId: project.id, verb: 'file.moved', targetType: 'file', targetId: file.id });
    return fileViewOf(ctx.state, file, ctx.authority);
  },
});

export const fileCalls = {
  'files.list': filesList,
  'files.get': filesGet,
  'files.upload': filesUpload,
  'files.delete': filesDelete,
  'files.markDelivered': filesMarkDelivered,
  'files.move': filesMove,
};
