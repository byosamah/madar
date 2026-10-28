import { beforeAll, describe, expect, it } from 'vitest';
import { countComments, countFiles, feedFor, mayDeleteFile, mayViewFile, taskRowOf, updateItemOf } from './views';
import type { FileRec } from './contract/entities';
import { commentCountKey, fileCountKey, type State } from './store';
import { buildSeed } from '../data/seed';
import { makeTask, makeUser, makeWorld, STAMP, TODAY } from '../test/factories';

/** The counts a server loader puts in the state: one for each comment target and each task with files. */
function countsOf(state: State): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const comment of Object.values(state.comments)) counts[commentCountKey(comment.targetId)] = (counts[commentCountKey(comment.targetId)] ?? 0) + 1;
  for (const file of Object.values(state.files)) if (file.taskId) counts[fileCountKey(file.taskId)] = (counts[fileCountKey(file.taskId)] ?? 0) + 1;
  return counts;
}

let full: State;
beforeAll(async () => {
  full = await buildSeed(TODAY, async () => undefined);
  // The sample office has no files on tasks and no comments on posts, so the test adds some.
  const tasks = Object.values(full.tasks).slice(0, 3);
  const file = Object.values(full.files)[0];
  tasks.forEach((task, n) => {
    for (let i = 0; i <= n; i += 1) full.files[`fil_9${n}${i}`] = { ...structuredClone(file), id: `fil_9${n}${i}`, projectId: task.projectId, taskId: task.id };
  });
  const comment = Object.values(full.comments)[0];
  Object.values(full.updates).slice(0, 2).forEach((update, n) => {
    for (let i = 0; i <= n; i += 1) full.comments[`cmt_9${n}${i}`] = { ...structuredClone(comment), id: `cmt_9${n}${i}`, targetType: 'update', targetId: update.id };
  });
});

describe('counts (plan 4.13, A4; AM 7.4)', () => {
  it('names the keys of the counts map', () => {
    expect(commentCountKey('tsk_001')).toBe('comments:tsk_001');
    expect(fileCountKey('tsk_001')).toBe('files:tsk_001');
  });

  it('gives the numbers of a full scan when a loader puts counts in the state and leaves the rows out', () => {
    const viewer = full.users[full.session.currentUserId];
    const scanned = Object.values(full.tasks).map((task) => taskRowOf(full, task, TODAY, viewer));
    const posts = Object.values(full.updates).map((update) => updateItemOf(full, update, viewer));
    expect(scanned.some((row) => row.commentCount > 0)).toBe(true);
    expect(scanned.some((row) => row.fileCount > 0)).toBe(true);
    expect(posts.some((post) => post.kind === 'update' && post.commentCount > 0)).toBe(true);

    const scoped: State = { ...structuredClone(full), counts: countsOf(full), comments: {}, files: {} };
    expect(Object.values(scoped.tasks).map((task) => {
      const row = taskRowOf(scoped, task, TODAY, viewer);
      return [row.commentCount, row.fileCount];
    })).toEqual(scanned.map((row) => [row.commentCount, row.fileCount]));
    expect(Object.values(scoped.updates).map((update) => (updateItemOf(scoped, update, viewer) as { commentCount: number }).commentCount))
      .toEqual(posts.map((post) => (post as { commentCount: number }).commentCount));
  });

  it('reads a zero from the map as zero, and scans a target the map does not name', () => {
    const state: State = { ...structuredClone(full), counts: { 'comments:tsk_zero': 0, 'files:tsk_zero': 0 } };
    expect(countComments(state, 'task', 'tsk_zero')).toBe(0);
    expect(countFiles(state, 'tsk_zero')).toBe(0);
    const someComment = Object.values(full.comments)[0];
    expect(countComments(state, someComment.targetType, someComment.targetId)).toBe(countComments(full, someComment.targetType, someComment.targetId));
  });

  it('keeps the behaviour without counts: a scan of the comments and files in the state', () => {
    const viewer = full.users[full.session.currentUserId];
    expect(full.counts).toBeUndefined();
    for (const task of Object.values(full.tasks)) {
      const row = taskRowOf(full, task, TODAY, viewer);
      expect(row.commentCount).toBe(Object.values(full.comments).filter((c) => c.targetType === 'task' && c.targetId === task.id).length);
      expect(row.fileCount).toBe(Object.values(full.files).filter((f) => f.taskId === task.id).length);
    }
    const projectId = Object.keys(full.projects)[0];
    for (const item of feedFor(full, projectId, 'posts', 50, viewer)) {
      if (item.kind === 'update') expect(item.commentCount).toBe(countComments(full, 'update', item.id));
    }
  });
});

describe('the file rules attach the office rights themselves', () => {
  // A person who arrives as a plain User (no officeRights) must still get the rights of the role. The office to-do rules read task.officeAll
  // with holdsRight, which fails closed without attached rights.
  function officeFileWorld() {
    const state = makeWorld();
    state.settings.roles = { custom: [{ id: 'rol_001', name: 'Office reader', nameAr: 'قارئ المكتب', rights: ['task.officeAll'] }] };
    state.users.usr_007 = makeUser('usr_007', { roleId: 'rol_001' });
    state.users.usr_008 = makeUser('usr_008');
    // An office to-do that Omar (usr_004) made and Sara (usr_003) leads, with a file that Omar uploaded.
    state.tasks.tsk_900 = makeTask({ id: 'tsk_900', projectId: null, stageId: null, title: 'Office errand', ownerId: 'usr_003', createdBy: 'usr_004', needsReview: false });
    const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_004', uploadedAt: STAMP };
    const file: FileRec = { id: 'fil_900', projectId: null, stageId: null, taskId: 'tsk_900', name: 'Errand.pdf', versions: [version] };
    state.files.fil_900 = file;
    return { state, file };
  }

  it('shows and deletes the file of an office to-do for a holder of task.officeAll who arrives as a plain User', () => {
    const { state, file } = officeFileWorld();
    const holder = state.users.usr_007;
    expect('officeRights' in holder).toBe(false);
    expect(mayViewFile(state, holder, file)).toBe(true);
    expect(mayDeleteFile(state, holder, file)).toBe(true);
  });

  it('still shows and deletes nothing for a Member without task.officeAll', () => {
    const { state, file } = officeFileWorld();
    const member = state.users.usr_008;
    expect(mayViewFile(state, member, file)).toBe(false);
    expect(mayDeleteFile(state, member, file)).toBe(false);
  });
});
