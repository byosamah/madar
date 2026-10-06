import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { FileId, FileVersion, MAX_FILE_BYTES, ProjectId, StageId, TaskId, type FileRec, type FileVersion as Version, type Task } from '../contract/entities';
import { FileView, TrackerRow } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { nextId } from '../store';
import { fileViewOf, mayDeleteFile, mayViewFile, trackerRowOf } from '../views';
import { assertCan, requireProject, requireStage, requireTask, roleIn, taskRole, touch } from './shared';
import { addTrackerEntry } from './tracker';

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
      .filter((f) => f.projectId === projectId && (!input.stageId || f.stageId === input.stageId) && (!input.taskId || f.taskId === input.taskId))
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
    if (!file || !mayViewFile(ctx.state, ctx.authority, file)) throw notFound('File', input.id);
    return { file: fileViewOf(ctx.state, file, ctx.authority), version: prepared.version, blob: prepared.blob };
  },
});

/** The fields of an upload that both forms share. */
const UploadFields = z.object({
  /** None: a file of the office task taskId (owner, 2026-10-06). */
  projectId: ProjectId.optional(),
  name: z.string().trim().min(1).max(200),
  stageId: StageId.nullable().default(null),
  taskId: TaskId.nullable().default(null),
  asCover: z.boolean().default(false),
  /** The client sent this file: the upload also logs a File entry on the tracker. */
  receivedFromClient: z.boolean().default(false),
});

/** A new file or a new version: the same name on the same place (a project, or one office task) adds the next letter. */
function addVersion(ctx: Ctx, place: { projectId: string | null; stageId: string | null; taskId: string | null }, name: string, version: Version): FileRec {
  const same = Object.values(ctx.state.files).find((f) => f.projectId === place.projectId
    && (place.projectId !== null || f.taskId === place.taskId) && f.name.toLowerCase() === name.toLowerCase());
  if (same) {
    version.letter = nextLetter(same.versions[same.versions.length - 1].letter);
    const before = { versions: structuredClone(same.versions) };
    same.versions.push(version);
    writeEvent(ctx, { projectId: place.projectId, verb: 'file.version_added', targetType: 'file', targetId: same.id, before, after: { versions: structuredClone(same.versions) } });
    return same;
  }
  const id = nextId(ctx.state, 'fil');
  const file: FileRec = { id, projectId: place.projectId, stageId: place.stageId, taskId: place.taskId, name, versions: [version] };
  ctx.state.files[id] = file;
  recordCreate(ctx, { projectId: place.projectId, verb: 'file.added', targetType: 'file', targetId: id, entity: file });
  return file;
}

/**
 * A file of an office task (owner, 2026-10-06): a person who sees the task adds it. It has no stage, no cover and no Tracker entry.
 */
function uploadOfficeFile(ctx: Ctx, input: { name: string; stageId: string | null; taskId: string | null; asCover: boolean; receivedFromClient: boolean }, prepared: UploadPrepared): FileView {
  const task = officeTaskOfCall(ctx, input.taskId);
  assertCan(ctx, 'content.post', taskRole(ctx, task));
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
 * What run() needs from the stored data. The prototype makes it from the blob in "prepare"; the real build makes it from the upload intent
 * in its server prepare hook (plan 5.2).
 */
export type UploadPrepared = { blobKey: string; size: number; mimeType: string; thumbKey?: string };

export const filesUpload = defineCall({
  // The screens send the blob (prototype) or an upload ID from files.uploadStart (real build): exactly one (plan 5.2).
  input: UploadFields.extend({ blob: z.instanceof(Blob).optional(), uploadId: z.string().min(1).max(80).optional() })
    .refine((value) => value.blob !== undefined || value.uploadId !== undefined, { path: ['blob'], message: 'Choose a file.' })
    .refine((value) => value.blob === undefined || value.uploadId === undefined, { path: ['uploadId'], message: 'Send the file or its upload, not both.' })
    .refine((value) => value.blob === undefined || value.blob.size <= MAX_FILE_BYTES, { path: ['blob'], message: 'Files must be 250 MB or smaller.' }),
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
    if (input.projectId === undefined) return uploadOfficeFile(ctx, input, prepared);
    const project = requireProject(ctx, input.projectId);
    const role = roleIn(ctx, project.id);
    assertCan(ctx, 'content.post', { projectRole: role });
    if (input.asCover) assertCan(ctx, 'project.edit', { projectRole: role });
    if (input.stageId) requireStage(ctx, project.id, input.stageId);
    if (input.taskId && ctx.state.tasks[input.taskId]?.projectId !== project.id) throw invalid('taskId', 'This task is not in the project.');
    if (input.asCover && !prepared.mimeType.startsWith('image/')) throw invalid('asCover', 'The cover must be an image.', 'cover_not_image');
    const version: Version = {
      letter: 'A', blobKey: prepared.blobKey, mimeType: prepared.mimeType, size: prepared.size,
      uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp, ...(prepared.thumbKey ? { thumbKey: prepared.thumbKey } : {}),
    };
    const file = addVersion(ctx, { projectId: project.id, stageId: input.stageId, taskId: input.taskId }, input.name, version);
    if (input.asCover) {
      applyPatch(ctx, project, { coverFileId: file.id }, { projectId: project.id, verb: 'project.cover_changed', targetType: 'project', targetId: project.id });
    }
    if (input.receivedFromClient) {
      const letter = file.versions[file.versions.length - 1].letter;
      addTrackerEntry(ctx, {
        projectId: project.id, type: 'file', direction: 'in', title: file.name, note: `Version ${letter}`, fileIds: [file.id], auto: 'upload',
      });
    }
    touch(ctx, project.id);
    return fileViewOf(ctx.state, file, ctx.authority);
  },
});

export const filesMarkDelivered = defineCall({
  input: z.object({ id: FileId }),
  output: TrackerRow,
  run(input, ctx) {
    const file = ctx.state.files[input.id];
    if (!file || !mayViewFile(ctx.state, ctx.authority, file)) throw notFound('File', input.id);
    // An office task has no client, so its files are never delivered (owner, 2026-10-06).
    if (file.projectId === null) throw invalid('id', 'A file of an office task stays on its task.', 'file_office_task');
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, file.projectId) });
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
    if (!mayDeleteFile(ctx.state, ctx.authority, file)) throw forbidden('Only the uploader or the project leader can delete this file.');
    const project = file.projectId === null ? undefined : ctx.state.projects[file.projectId];
    if (project?.coverFileId === file.id) {
      applyPatch(ctx, project, { coverFileId: null }, { projectId: project.id, verb: 'project.cover_changed', targetType: 'project', targetId: project.id });
    }
    recordDelete(ctx, { projectId: file.projectId, verb: 'file.deleted', targetType: 'file', targetId: file.id, entity: file });
    delete ctx.state.files[file.id];
    touch(ctx, file.projectId);
    return { deleted: true as const };
  },
});

export const fileCalls = {
  'files.list': filesList,
  'files.get': filesGet,
  'files.upload': filesUpload,
  'files.delete': filesDelete,
  'files.markDelivered': filesMarkDelivered,
};
