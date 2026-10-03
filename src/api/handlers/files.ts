import { z } from 'zod';
import { defineCall } from '../registry';
import { FileId, FileVersion, MAX_FILE_BYTES, ProjectId, StageId, TaskId, type FileRec, type FileVersion as Version } from '../contract/entities';
import { FileView, TrackerRow } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { nextId } from '../store';
import { fileViewOf, mayDeleteFile, trackerRowOf } from '../views';
import { assertCan, requireProject, requireStage, roleIn, touch } from './shared';
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

export const filesList = defineCall({
  input: z.object({ projectId: ProjectId, stageId: StageId.optional(), taskId: TaskId.optional() }),
  output: z.array(FileView),
  readOnly: true,
  run(input, ctx) {
    requireProject(ctx, input.projectId);
    return Object.values(ctx.state.files)
      .filter((f) => f.projectId === input.projectId && (!input.stageId || f.stageId === input.stageId) && (!input.taskId || f.taskId === input.taskId))
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
    if (!file) throw notFound('File', input.id);
    return { file: fileViewOf(ctx.state, file, ctx.authority), version: prepared.version, blob: prepared.blob };
  },
});

/** The fields of an upload that both forms share. */
const UploadFields = z.object({
  projectId: ProjectId,
  name: z.string().trim().min(1).max(200),
  stageId: StageId.nullable().default(null),
  taskId: TaskId.nullable().default(null),
  asCover: z.boolean().default(false),
  /** The client sent this file: the upload also logs a File entry on the tracker. */
  receivedFromClient: z.boolean().default(false),
});

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
    const same = Object.values(ctx.state.files).find((f) => f.projectId === project.id && f.name.toLowerCase() === input.name.toLowerCase());
    let file: FileRec;
    if (same) {
      version.letter = nextLetter(same.versions[same.versions.length - 1].letter);
      const before = { versions: structuredClone(same.versions) };
      same.versions.push(version);
      writeEvent(ctx, { projectId: project.id, verb: 'file.version_added', targetType: 'file', targetId: same.id, before, after: { versions: structuredClone(same.versions) } });
      file = same;
    } else {
      const id = nextId(ctx.state, 'fil');
      file = { id, projectId: project.id, stageId: input.stageId, taskId: input.taskId, name: input.name, versions: [version] };
      ctx.state.files[id] = file;
      recordCreate(ctx, { projectId: project.id, verb: 'file.added', targetType: 'file', targetId: id, entity: file });
    }
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
    if (!file) throw notFound('File', input.id);
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
    if (!file) throw notFound('File', input.id);
    if (!mayDeleteFile(ctx.state, ctx.authority, file)) throw forbidden('Only the uploader or the project leader can delete this file.');
    const project = ctx.state.projects[file.projectId];
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
