import { beforeAll, describe, expect, it } from 'vitest';
import { emptyReactions, type Event, type Notification, type Task } from '../../../src/api/contract/entities';
import { isReferenced } from '../../../src/api/references';
import { sharedCalls, type SharedCallName } from '../../../src/api/sharedCalls';
import { chatReadKey, type State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { runBoth, runOn, type Run } from './compare';
import { LOADER_OF } from './index';
import { readSweep, trapOffice, writeSweep } from './sweep';

/**
 * Task C2: each loader gives the handler the same answer as the whole office (plan 4.6, "Safety net"). runBoth runs the call on
 * the whole sample office and on the State its loader reads, and compares the answer and the rows the save step would write.
 * One test for each of the 18 places of AM 6, where a partial load would give a wrong answer, each with a trap: a record that
 * only a complete load sees.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
let seed: State;

beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

/** A copy of the sample office, changed by the setup of one test. */
function office(setup?: (state: State) => void): State {
  const state = structuredClone(seed);
  setup?.(state);
  return state;
}

/** Runs a call on a test office in place, as setup. It must succeed. */
function apply(state: State, name: SharedCallName, input: unknown, actorId: string, o: { now?: Date; story?: string; prepared?: unknown } = {}): unknown {
  const outcome = runOn(state, name, sharedCalls[name].input.parse(input), actorId, { now: o.now ?? NOW, correlationId: o.story ?? `cor_setup_${name}`, prepared: o.prepared });
  if (outcome.error) throw new Error(`Setup ${name} failed: ${outcome.error.message}`);
  return outcome.output;
}

/** Runs one call both ways and expects the same answer and the same writes. Returns the run on the whole office. */
async function same(state: State, name: SharedCallName, input: unknown, actorId: string, o: { prepared?: unknown; now?: Date } = {}): Promise<Run> {
  const { whole, scoped } = await runBoth(state, name, input, actorId, { now: o.now ?? NOW, correlationId: 'cor_test', prepared: o.prepared });
  expect(scoped, `${name} as ${actorId}`).toEqual(whole);
  return whole;
}

const deleted = (run: Run, table: string) => (Array.isArray(run.changes) ? run.changes.find((c) => c.table === table)?.deleted ?? [] : []);
const inserted = (run: Run, table: string) => (Array.isArray(run.changes) ? run.changes.find((c) => c.table === table)?.inserted ?? [] : []);
const docs = (run: Run, table: string) => (Array.isArray(run.changes) ? run.changes.find((c) => c.table === table)?.docs ?? [] : []) as Record<string, unknown>[];
const humans = () => Object.values(seed.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id);
const tasksOfProject = (state: State, projectId: string) => Object.values(state.tasks).filter((t) => t.projectId === projectId);

describe('the loader table', () => {
  it('has a loader for every call that the server runs, and for nothing else', () => {
    expect(Object.keys(LOADER_OF).sort()).toEqual(Object.keys(sharedCalls).sort());
    for (const [name, spec] of Object.entries(LOADER_OF)) expect(typeof spec.load, name).toBe('function');
  });
});

describe('the sweep: every read call on the sample office for every person and record, and one write of each kind', () => {
  it('reads', async () => {
    const calls = readSweep(seed);
    expect(calls.length).toBeGreaterThan(500);
    for (const [name, input, actor] of calls) await same(seed, name, input, actor);
  }, 30_000);

  it('writes', async () => {
    for (const [name, input, actor, prepared] of writeSweep(seed)) {
      const run = await same(seed, name, input, actor, { prepared });
      expect(run.outcome.error?.code, name).not.toBe('crash');
    }
  });

  it('reads and writes on the office with the extra records of the database test', async () => {
    const traps = trapOffice(seed);
    for (const [name, input, actor, prepared] of [...readSweep(traps), ...writeSweep(traps)]) await same(traps, name, input, actor, { prepared });
  }, 30_000);
});

describe('the 18 places of AM 6', () => {
  it('rows 1 and 2: projects.delete removes the comments and notices of its own tasks and posts only', async () => {
    const run = await same(seed, 'projects.delete', { id: 'prj_001', confirm: true }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
    const ownTasks = new Set(tasksOfProject(seed, 'prj_001').map((t) => t.id));
    const ownPosts = new Set(Object.values(seed.updates).filter((u) => u.projectId === 'prj_001').map((u) => u.id));
    const goneComments = deleted(run, 'comments');
    expect(goneComments.length).toBeGreaterThan(0);
    for (const id of goneComments) {
      const comment = seed.comments[id];
      expect(comment.targetType === 'task' ? ownTasks.has(comment.targetId) : ownPosts.has(comment.targetId), id).toBe(true);
    }
    expect(Object.values(seed.comments).filter((c) => !goneComments.includes(c.id)).length).toBeGreaterThan(0);
  });

  it('row 3: the Undo of a file upload sees a direct chat message that still carries the file', async () => {
    const event = Object.values(seed.events).find((e) => e.verb === 'file.added' && !isReferenced(seed, 'file', e.targetId)
      && !Object.values(seed.events).some((other) => other.targetId === e.targetId && other.seq > e.seq))!;
    expect(event).toBeDefined();
    const free = await same(office(), 'events.undo', { eventId: event.id }, event.actingForId);
    expect(free.outcome.error).toBeUndefined();
    const used = office((state) => {
      state.messages.msg_900 = {
        id: 'msg_900', conversationId: 'cnv_013', authorId: ADMIN, actingForId: ADMIN, body: 'here', mentions: [], fileIds: [event.targetId],
        createdAt: '2026-10-03T10:00:00.000+03:00', editedAt: null,
      };
    });
    const run = await same(used, 'events.undo', { eventId: event.id }, event.actingForId);
    expect(run.outcome.error).toMatchObject({ code: 'conflict', message: expect.stringContaining('Other items') });
  });

  it('row 4: an Undo sees a later change of the same task in another story', async () => {
    const state = office();
    const task = tasksOfProject(state, 'prj_001').find((t) => t.status !== 'done')!;
    apply(state, 'tasks.update', { id: task.id, patch: { title: 'First title' } }, ADMIN, { story: 'cor_first' });
    apply(state, 'tasks.update', { id: task.id, patch: { title: 'Second title' } }, ADMIN, { story: 'cor_second' });
    const first = Object.values(state.events).find((e) => e.correlationId === 'cor_first')!;
    const run = await same(state, 'events.undo', { eventId: first.id }, ADMIN);
    expect(run.outcome.error?.code).toBe('conflict');
  });

  it('row 5: an Undo of one change keeps the notices of a story that still stands', async () => {
    const state = office();
    const outsider = Object.values(state.users).find((u) => u.kind === 'human' && u.active && !state.members[`prj_001:${u.id}`] && state.projects.prj_001.leaderId !== u.id)!;
    apply(state, 'tasks.create', { projectId: 'prj_001', title: 'Survey', ownerId: outsider.id }, state.projects.prj_001.leaderId!, { story: 'cor_story' });
    const created = Object.values(state.events).find((e) => e.correlationId === 'cor_story' && e.verb === 'task.created')!;
    expect(Object.values(state.notifications).some((n) => n.correlationId === 'cor_story')).toBe(true);
    const run = await same(state, 'events.undo', { eventId: created.id }, state.projects.prj_001.leaderId!);
    expect(run.outcome.error).toBeUndefined();
    expect(deleted(run, 'notifications')).toEqual([]);
  });

  it('row 6: the Undo of a file delete sees the task that the file names', async () => {
    const state = office();
    const task = tasksOfProject(state, 'prj_002')[0];
    const upload = apply(state, 'files.upload', { projectId: 'prj_002', name: 'Detail.pdf', taskId: task.id, uploadId: 'upl_900' }, ADMIN, {
      prepared: { blobKey: 'blob_900', mimeType: 'application/pdf', size: 10 },
    }) as { file: { id: string } };
    apply(state, 'files.delete', { id: upload.file.id }, ADMIN, { story: 'cor_delete' });
    const gone = Object.values(state.events).find((e) => e.correlationId === 'cor_delete' && e.verb === 'file.deleted')!;
    const run = await same(state, 'events.undo', { eventId: gone.id }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
    expect(inserted(run, 'files')).toEqual([upload.file.id]);
    // The cover that an Undo brings back must still exist: a file that no event of the story targets.
    const cover = state.projects.prj_002.coverFileId!;
    apply(state, 'projects.update', { id: 'prj_002', patch: { coverFileId: null } }, ADMIN, { story: 'cor_cover' });
    const cleared = Object.values(state.events).find((e) => e.correlationId === 'cor_cover' && e.verb === 'project.updated')!;
    const back = await same(state, 'events.undo', { eventId: cleared.id }, ADMIN);
    expect(back.outcome.error).toBeUndefined();
    expect(docs(back, 'projects')[0]?.coverFileId).toBe(cover);
  });

  it('row 7: the Inbox reads a live task of a notice as live, and a deleted one from its delete event', async () => {
    const state = office();
    const notice = Object.values(state.notifications).find((n) => n.targetType === 'task')!;
    const live = await same(state, 'notifications.list', {}, notice.userId);
    expect((live.outcome.output as { notification: Notification; gone: boolean }[]).find((v) => v.notification.id === notice.id)?.gone).toBe(false);
    apply(state, 'tasks.delete', { id: notice.targetId }, ADMIN);
    const run = await same(state, 'notifications.list', {}, notice.userId);
    const view = (run.outcome.output as { notification: Notification; gone: boolean; target: string }[]).find((v) => v.notification.id === notice.id)!;
    expect(view).toMatchObject({ gone: true, target: seed.tasks[notice.targetId].title });
    await same(state, 'notifications.count', {}, notice.userId);
  });

  it('row 8: the counts of comments and files on a task and a post', async () => {
    const state = office();
    const comment = Object.values(state.comments).find((c) => c.targetType === 'task')!;
    const task = state.tasks[comment.targetId];
    apply(state, 'files.upload', { projectId: task.projectId, name: 'Count.pdf', taskId: task.id, uploadId: 'upl_901' }, ADMIN, { prepared: { blobKey: 'blob_901', mimeType: 'application/pdf', size: 1 } });
    const get = await same(state, 'tasks.get', { id: task.id }, ADMIN);
    expect(get.outcome.output).toMatchObject({ commentCount: expect.any(Number), fileCount: 1 });
    expect((get.outcome.output as { commentCount: number }).commentCount).toBeGreaterThan(0);
    const list = await same(state, 'tasks.list', { projectId: task.projectId }, ADMIN);
    expect((list.outcome.output as { task: Task; commentCount: number }[]).find((row) => row.task.id === task.id)?.commentCount).toBeGreaterThan(0);
    // A write counts its own new comment: rows, never a stale count.
    await same(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'One more' }, ADMIN);
    await same(state, 'tasks.update', { id: task.id, patch: { title: 'Renamed' } }, ADMIN);
  });

  it('row 9: attachments name their files, and a finished reply task logs the reply with the files of the entry', async () => {
    const state = office();
    const leader = state.projects.prj_003.leaderId!;
    const file = Object.values(state.files).find((f) => f.projectId === 'prj_003')!;
    const target = tasksOfProject(state, 'prj_003')[0];
    apply(state, 'comments.create', { targetType: 'task', targetId: target.id, body: 'See the file', fileIds: [file.id] }, leader);
    const comment = Object.values(state.comments).find((c) => (c.fileIds ?? []).length > 0)!;
    const list = await same(state, 'comments.list', { targetType: comment.targetType, targetId: comment.targetId }, ADMIN);
    expect(JSON.stringify(list.outcome.output)).toContain(state.files[comment.fileIds![0]].name);
    const row = apply(state, 'tracker.log', {
      projectId: 'prj_003', type: 'message', direction: 'in', title: 'Client asks', waiting: 'us', fileIds: [file.id], replyBy: { userId: leader, dueDate: '2026-10-10' },
    }, leader) as { entry: { replyTaskId: string } };
    const run = await same(state, 'tasks.complete', { id: row.entry.replyTaskId }, leader);
    expect(run.outcome.error).toBeUndefined();
    expect(docs(run, 'tracker').find((entry) => entry.auto === 'reply')?.fileIds).toEqual([file.id]);
  });

  it('row 10: a team member reads as team, from the whole project index', async () => {
    const member = Object.values(seed.members).find((m) => m.userId !== seed.projects[m.projectId].leaderId)!;
    const task = tasksOfProject(seed, member.projectId).find((t) => t.ownerId === member.userId && t.status !== 'done');
    const run = await same(seed, 'tasks.create', { projectId: member.projectId, title: 'Mine' }, member.userId);
    expect(run.outcome.error).toBeUndefined();
    if (task) await same(seed, 'tasks.move', { id: task.id, status: 'in_progress' }, member.userId);
  });

  it('row 11: adding a member who is on the team already is refused', async () => {
    const member = Object.values(seed.members)[0];
    const run = await same(seed, 'members.add', { projectId: member.projectId, userId: member.userId }, ADMIN);
    expect(run.outcome.error?.code).toBe('invalid_input');
  });

  it('row 12: an upload with the name of a file of the project adds version B', async () => {
    // Not the cover, which the project view loads anyway.
    const file = Object.values(seed.files).find((f) => f.projectId === 'prj_004' && f.id !== seed.projects.prj_004.coverFileId)!;
    const run = await same(seed, 'files.upload', { projectId: 'prj_004', name: file.name.toUpperCase(), uploadId: 'upl_902' }, ADMIN, {
      prepared: { blobKey: 'blob_902', mimeType: 'application/pdf', size: 5 },
    });
    expect(inserted(run, 'files')).toEqual([]);
    expect(docs(run, 'events').map((e) => e.verb)).toContain('file.version_added');
  });

  it('row 13: a stage with tasks stays, and a member with open tasks stays', async () => {
    const task = Object.values(seed.tasks).find((t) => t.status !== 'done')!;
    const stages = Object.values(seed.stages).filter((s) => s.projectId === task.projectId && s.id !== task.stageId);
    const replace = await same(seed, 'stages.replace', {
      projectId: task.projectId, stages: stages.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })),
    }, ADMIN);
    expect(replace.outcome.error?.code).toBeDefined();
    const remove = await same(seed, 'members.remove', { projectId: task.projectId, userId: task.ownerId }, ADMIN);
    expect(remove.outcome.error?.code).toBeDefined();
    const empty = Object.values(seed.stages).find((s) => !Object.values(seed.tasks).some((t) => t.stageId === s.id))!;
    const keep = Object.values(seed.stages).filter((s) => s.projectId === empty.projectId && s.id !== empty.id);
    const run = await same(seed, 'stages.replace', {
      projectId: empty.projectId, stages: keep.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })),
    }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
  });

  it('row 14: a direct chat that exists is found again', async () => {
    const direct = Object.values(seed.conversations).find((c) => c.kind === 'direct')!;
    const run = await same(seed, 'chats.openDirect', { userId: direct.memberIds[1] }, direct.memberIds[0]);
    expect(run.outcome.output).toEqual({ id: direct.id });
  });

  it('row 15: a task thread of a person who only commented on it, with its unread count after the read mark', async () => {
    const state = office();
    const task = Object.values(state.tasks).find((t) => t.ownerId !== 'usr_006' && state.projects[t.projectId].leaderId !== 'usr_006')!;
    const add = (id: string, authorId: string, at: string) => {
      state.comments[id] = { id, targetType: 'task', targetId: task.id, authorId, body: `Note ${id}`, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null };
    };
    add('cmt_901', task.ownerId, '2026-10-01T09:00:00.000+03:00');
    add('cmt_902', 'usr_006', '2026-10-02T09:00:00.000+03:00');
    add('cmt_903', task.ownerId, '2026-10-03T09:00:00.000+03:00');
    add('cmt_904', task.ownerId, '2026-10-03T11:00:00.000+03:00');
    add('cmt_905', task.ownerId, '2026-10-03T12:00:00.000+03:00');
    state.chatReads[chatReadKey(task.id, 'usr_006')] = { conversationId: task.id, userId: 'usr_006', lastReadAt: '2026-10-03T10:00:00.000+03:00' };
    const run = await same(state, 'chats.list', {}, 'usr_006');
    // Unread: after the own comment and after the mark, and not the newest only.
    expect((run.outcome.output as { id: string; unread: number }[]).find((row) => row.id === task.id)?.unread).toBe(2);
    await same(state, 'chats.unreadCount', {}, 'usr_006');
    await same(state, 'chats.markRead', { conversationId: task.id }, 'usr_006');
  });

  it('row 16: a task approved after review moves its dependents by the days it was late on the review day', async () => {
    const state = office();
    const leader = state.projects.prj_001.leaderId!;
    const stageId = state.projects.prj_001.currentStageId;
    const a = (apply(state, 'tasks.create', { projectId: 'prj_001', stageId, title: 'Plan A', dueDate: '2026-09-20', ownerId: leader }, leader) as { task: Task }).task;
    apply(state, 'tasks.update', { id: a.id, patch: { needsReview: true } }, leader);
    apply(state, 'tasks.create', {
      projectId: 'prj_001', stageId, title: 'Plan B', prerequisiteIds: [a.id], schedule: 'dynamic', startDate: '2026-09-21', durationDays: 5, ownerId: leader,
    }, leader);
    const member = Object.values(state.members).find((m) => m.projectId === 'prj_001' && m.userId !== leader)!.userId;
    apply(state, 'tasks.update', { id: a.id, patch: { ownerId: member } }, leader);
    apply(state, 'tasks.complete', { id: a.id }, member, { now: new Date('2026-09-22T06:00:00Z') });
    expect(state.tasks[a.id].status).toBe('in_review');
    const run = await same(state, 'tasks.approve', { id: a.id }, leader);
    expect(run.outcome.error).toBeUndefined();
    expect(docs(run, 'events').map((e) => e.verb)).toContain('task.dates_shifted');
  });

  it('row 17: the feed labels name their tasks, files and Tracker entries', async () => {
    const run = await same(seed, 'updates.list', { projectId: 'prj_003', filter: 'all', limit: 50 }, ADMIN);
    const events = (run.outcome.output as { kind: string; label?: string }[]).filter((item) => item.kind === 'event');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((item) => item.label !== '')).toBe(true);
    await same(seed, 'projects.list', { status: 'all' }, ADMIN);
  });

  it('row 18: the next project code, the mark and the unique names come from the whole office lists', async () => {
    const run = await same(seed, 'projects.create', { name: 'New tower', leader: 'me' }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
    const team = Object.values(seed.teams ?? {})[0];
    const twice = await same(seed, 'teams.create', { name: team.name, memberIds: [] }, ADMIN);
    expect(twice.outcome.error?.code).toBe('invalid_input');
  });
});

describe('the loaders keep what the handlers need', () => {
  it('an Undo of a whole story, and of a story with a stage move', async () => {
    const state = office();
    const leader = state.projects.prj_002.leaderId!;
    const task = tasksOfProject(state, 'prj_002').find((t) => t.status !== 'done' && t.ownerId === leader)
      ?? tasksOfProject(state, 'prj_002').find((t) => t.status !== 'done')!;
    apply(state, 'tasks.complete', { id: task.id }, ADMIN, { story: 'cor_done' });
    const run = await same(state, 'events.undoStory', { correlationId: 'cor_done' }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
  });

  it('events.list for an agent change, by story, by target and by time', async () => {
    const event = Object.values(seed.events).at(-1) as Event;
    await same(seed, 'events.list', { correlationId: event.correlationId }, ADMIN);
    await same(seed, 'events.list', { targetType: event.targetType, targetId: event.targetId }, ADMIN);
    await same(seed, 'events.list', { since: '2026-10-01T00:00:00+03:00', limit: 500 }, 'usr_005');
  });
});
