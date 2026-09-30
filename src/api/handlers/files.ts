import { z } from 'zod';
import { defineCall } from '../registry';
import { FileId, FileVersion, MAX_FILE_BYTES, ProjectId, StageId, TaskId, type FileRec, type FileVersion as Version } from '../contract/entities';
import { FileView } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { can, principalOf } from '../permissions';
import { nextId } from '../store';
import { fileViewOf } from '../views';
import { assertCan, requireProject, requireStage, roleIn, touch } from './shared';

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
      .map((f) => fileViewOf(ctx.state, f))
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
    return { file: fileViewOf(ctx.state, file), version: prepared.version, blob: prepared.blob };
  },
});

export const filesUpload = defineCall({
  input: z
    .object({
      projectId: ProjectId,
      name: z.string().trim().min(1).max(200),
      blob: z.instanceof(Blob),
      stageId: StageId.nullable().default(null),
      taskId: TaskId.nullable().default(null),
      asCover: z.boolean().default(false),
    })
    .refine((value) => value.blob.size <= MAX_FILE_BYTES, { path: ['blob'], message: 'Files must be 25 MB or smaller.' }),
  output: FileView,
  async prepare(input, p) {
    const blobKey = `blob_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await p.persister.putBlob(blobKey, input.blob);
    return { blobKey };
  },
  run(input, ctx, prepared) {
    const project = requireProject(ctx, input.projectId);
    const role = roleIn(ctx, project.id);
    assertCan(ctx, 'content.post', { projectRole: role });
    if (input.asCover) assertCan(ctx, 'project.edit', { projectRole: role });
    if (input.stageId) requireStage(ctx, project.id, input.stageId);
    if (input.taskId && ctx.state.tasks[input.taskId]?.projectId !== project.id) throw invalid('taskId', 'This task is not in the project.');
    const version: Version = {
      letter: 'A', blobKey: prepared.blobKey, mimeType: input.blob.type || 'application/octet-stream', size: input.blob.size,
      uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp,
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
    touch(ctx, project.id);
    return fileViewOf(ctx.state, file);
  },
});

export const filesDelete = defineCall({
  input: z.object({ id: FileId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const file = ctx.state.files[input.id];
    if (!file) throw notFound('File', input.id);
    const role = roleIn(ctx, file.projectId);
    const allowed = can(ctx.authority, 'task.delete', { projectRole: role })
      || can(ctx.authority, 'content.editOwn', { projectRole: role, authorId: principalOf(ctx.state, file.versions[0].uploadedBy) });
    if (!allowed) throw forbidden('Only the uploader or the project leader can delete this file.');
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
};
