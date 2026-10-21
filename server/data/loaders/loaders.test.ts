import { beforeAll, describe, expect, it } from 'vitest';
import { emptyReactions, type Event, type Notification, type Task } from '../../../src/api/contract/entities';
import { addGroupConversation } from '../../../src/api/chatState';
import { runScheduledTriggers } from '../../../src/api/notify';
import { isReferenced } from '../../../src/api/references';
import { sharedCalls, type SharedCallName } from '../../../src/api/sharedCalls';
import { chatReadKey, memberKey, type State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { mentionMarkup } from '../../../src/lib/text';
import { snapshotOf } from '../officeCache';
import { Load } from './build';
import { THREAD_COMMENT_FIELDS, THREAD_TASK_FIELDS } from './chat';
import { changesOf, runBoth, runOn, type Run } from './compare';
import { INBOX_TASK_FIELDS } from './inbox';
import { LOADER_OF } from './index';
import { loadJobs } from './jobs';
import { memorySource } from './memorySource';
import { AGENT_MADE_TASK, badgeTraps, ENDED_MEETING_TITLE, ENDED_PROJECT_MEETING_TITLE, ENDED_TEAM_MEETING_TITLE, findSweep, findTraps, MEETING_FILE_ID, meetingWrites, OFFICE_AGENT, officeWrites, readSweep, SERIES_PRIVATE_TITLE, SERIES_PROJECT_TITLE, seriesSweep, seriesTraps, trapOffice, writeSweep } from './sweep';

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
const todo = (state: State, projectId: string) => tasksOfProject(state, projectId).filter((t) => t.status === 'todo');

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

describe('the reads of track find on the scoped load', () => {
  it('gives the same answers as the whole office', async () => {
    const traps = office(findTraps);
    const calls = findSweep(traps);
    expect(calls.length).toBeGreaterThan(15);
    for (const [name, input, actor] of calls) await same(traps, name, input, actor);
  }, 30_000);

  it('finds the messages of the chats that the person may open, and only those (item 16)', async () => {
    const traps = office(findTraps);
    const ids = (run: Run) => (run.outcome.output as { messages: { id: string }[] }).messages.map((hit) => hit.id);
    // The Admin opens the project chat, not the group and not the direct chat of two others. The deleted message is never found.
    // The newest 5 of messages and comments together: the comment of the office task, three comments of the project task, one message.
    expect(ids(await same(traps, 'search.query', { text: 'riser' }, ADMIN))).toEqual(['cmt_2007', 'cmt_2006', 'cmt_2005', 'cmt_2004', 'msg_2007']);
    const group = Object.values(traps.conversations).find((c) => c.name === 'Find group')!;
    const member = ids(await same(traps, 'search.query', { text: 'riser' }, group.memberIds[0]));
    // The two newest comments of the project task come first, then the direct message and the group message.
    expect(member).toEqual(expect.arrayContaining(['cmt_2006', 'cmt_2005', 'msg_2010', 'msg_2009']));
    expect(member).not.toContain('msg_2008');
    // A comment of a deleted task and a comment on a post are never found.
    for (const id of ['cmt_2008', 'cmt_2009', 'cmt_2010']) expect(member).not.toContain(id);
    expect(ids(await same(traps, 'search.query', { text: 'اسعار' }, ADMIN))).toEqual(['msg_2011']);
    expect(ids(await same(traps, 'search.query', { text: 'ri' }, ADMIN))).toEqual([]);
  });

  it('finds a comment of an office task only for the people of the task and the Admin (item 16)', async () => {
    const traps = office(findTraps);
    const ids = (run: Run) => (run.outcome.output as { messages: { id: string }[] }).messages.map((hit) => hit.id);
    for (const person of ['usr_004', 'usr_005', 'usr_006', ADMIN]) expect(ids(await same(traps, 'search.query', { text: 'riser parts' }, person)), person).toEqual(['cmt_2007']);
    for (const person of ['usr_002', 'usr_003']) expect(ids(await same(traps, 'search.query', { text: 'riser parts' }, person)), person).toEqual([]);
  });

  it('shows an empty direct chat only for the person who opened it, on the scoped load too (item 18)', async () => {
    const traps = office(findTraps);
    const empty = Object.values(traps.conversations).find((c) => c.kind === 'direct' && c.createdAt === '2026-10-03T08:00:00.000+03:00' && !Object.values(traps.messages).some((m) => m.conversationId === c.id))!;
    const [a, b] = empty.memberIds;
    const listed = (run: Run) => (run.outcome.output as { id: string }[]).some((row) => row.id === empty.id);
    expect(listed(await same(traps, 'chats.list', {}, a))).toBe(false);
    const opened = await same(traps, 'chats.openDirect', { userId: b }, a);
    expect(inserted(opened, 'chat_reads')).toHaveLength(1);
    apply(traps, 'chats.openDirect', { userId: b }, a);
    expect(listed(await same(traps, 'chats.list', {}, a))).toBe(true);
    expect(listed(await same(traps, 'chats.list', {}, b))).toBe(false);
    expect(inserted(await same(traps, 'chats.openDirect', { userId: a }, b), 'chat_reads')).toHaveLength(1);
    // The second open of the first person changes nothing.
    expect(inserted(await same(traps, 'chats.openDirect', { userId: b }, a), 'chat_reads')).toHaveLength(0);
  });

  it('opens the group at an old message with the 20 before it and the 500 in all, and says that newer ones exist', async () => {
    const traps = office(findTraps);
    const group = Object.values(traps.conversations).find((c) => c.name === 'Find group')!;
    const run = await same(traps, 'chats.messages', { conversationId: group.id, around: 'msg_1030' }, group.memberIds[0]);
    const out = run.outcome.output as { messages: { message: { id: string } }[]; newer: boolean };
    // 540 messages, two deleted, so 538 are live. The 30th is the 29th live message: the page starts 20 before it.
    expect(out.messages[0].message.id).toBe('msg_1010');
    expect(out.messages).toHaveLength(500);
    expect(out.newer).toBe(true);
  });
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

  it('an Undo on rows from the database takes away a field that the change added, though JSON keeps no undefined (D2)', async () => {
    const state = office();
    const open = todo(state, 'prj_001').filter((t) => t.prerequisiteIds === undefined);
    const [task, first] = open;
    apply(state, 'tasks.update', { id: task.id, patch: { prerequisiteIds: [first.id] } }, ADMIN, { story: 'cor_wait' });
    const added = Object.values(state.events).find((e) => e.correlationId === 'cor_wait' && e.targetId === task.id)!;
    expect('prerequisiteIds' in (added.before as object)).toBe(true);
    // The rows as the database holds them: JSON, so the key of the undefined value is gone.
    const stored = JSON.parse(JSON.stringify(state)) as State;
    expect('prerequisiteIds' in (stored.events[added.id].before as object)).toBe(false);
    const { scoped } = await runBoth(stored, 'events.undo', { eventId: added.id }, ADMIN, { now: NOW, correlationId: 'cor_test' });
    const memory = await same(state, 'events.undo', { eventId: added.id }, ADMIN);
    expect(scoped.outcome.error).toBeUndefined();
    expect(docs(scoped, 'tasks')).toEqual(docs(memory, 'tasks'));
    expect(docs(scoped, 'tasks')[0].prerequisiteIds).toBeUndefined();
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
    const task = Object.values(state.tasks).find((t) => t.ownerId !== null && t.ownerId !== 'usr_006' && state.projects[t.projectId!].leaderId !== 'usr_006')!;
    const lead = task.ownerId as string;
    const add = (id: string, authorId: string, at: string) => {
      state.comments[id] = { id, targetType: 'task', targetId: task.id, authorId, body: `Note ${id}`, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null };
    };
    add('cmt_901', lead, '2026-10-01T09:00:00.000+03:00');
    add('cmt_902', 'usr_006', '2026-10-02T09:00:00.000+03:00');
    add('cmt_903', lead, '2026-10-03T09:00:00.000+03:00');
    add('cmt_904', lead, '2026-10-03T11:00:00.000+03:00');
    add('cmt_905', lead, '2026-10-03T12:00:00.000+03:00');
    state.chatReads[chatReadKey(task.id, 'usr_006')] = { conversationId: task.id, userId: 'usr_006', lastReadAt: '2026-10-03T10:00:00.000+03:00' };
    const run = await same(state, 'chats.list', {}, 'usr_006');
    // Unread: after the own comment and after the mark, and not the newest only.
    expect((run.outcome.output as { id: string; unread: number }[]).find((row) => row.id === task.id)?.unread).toBe(2);
    await same(state, 'chats.unreadCount', {}, 'usr_006');
    await same(state, 'chats.markRead', { conversationId: task.id }, 'usr_006');
  });

  // fbk_027 (owner, 2026-10-19): the quiet lines of reasons are in the thread, but never unread and never waiting for a reply.
  it('row 15: a quiet line of a reason is no unread message and no waiting reply, for the loader as for the whole office (fbk_027)', async () => {
    const state = office();
    const task = Object.values(state.tasks).find((t) => t.ownerId !== null && t.ownerId !== 'usr_006' && state.projects[t.projectId!].leaderId !== 'usr_006')!;
    const lead = task.ownerId as string;
    const move = { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-12' } };
    const add = (id: string, authorId: string, at: string, extra: Partial<State['comments'][string]> = {}) => {
      state.comments[id] = { id, targetType: 'task', targetId: task.id, authorId, body: `Note ${id}`, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null, ...extra };
    };
    add('cmt_901', lead, '2026-10-01T09:00:00.000+03:00');
    add('cmt_902', 'usr_006', '2026-10-02T09:00:00.000+03:00', { dates: move });
    add('cmt_903', lead, '2026-10-03T09:00:00.000+03:00');
    add('cmt_904', lead, '2026-10-03T11:00:00.000+03:00', { kind: 'reopened' });
    add('cmt_905', lead, '2026-10-03T12:00:00.000+03:00', { dates: { ...move, byTaskId: 'tsk_001', lateDays: 2 } });
    state.chatReads[chatReadKey(task.id, 'usr_006')] = { conversationId: task.id, userId: 'usr_006', lastReadAt: '2026-10-01T12:00:00.000+03:00' };
    for (const actor of ['usr_006', lead, ADMIN]) {
      const list = await same(state, 'chats.list', {}, actor);
      await same(state, 'chats.unreadCount', {}, actor);
      await same(state, 'chats.waiting', {}, actor);
      await same(state, 'chats.markRead', { conversationId: task.id }, actor);
      if (actor === 'usr_006') {
        // The only message after the mark is cmt_903. The lines before and after it count for nothing, also the line that the person wrote.
        const row = (list.outcome.output as { id: string; unread: number; previewKind: string | null }[]).find((item) => item.id === task.id);
        expect(row).toMatchObject({ unread: 1, previewKind: 'shifted' });
      }
    }
  });

  it('chats.archive: the loader gives the handler the same answer, for a project chat and for a task thread (owner, 2026-10-18)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project');
    const task = Object.values(state.tasks)[0];
    if (!room || !task) throw new Error('The sample office needs a project chat and a task.');
    const chat = await same(state, 'chats.archive', { conversationId: room.id, archived: true }, 'usr_001');
    expect(chat.outcome.output).toEqual({ archived: true });
    const thread = await same(state, 'chats.archive', { conversationId: task.id, archived: true }, 'usr_001');
    expect(thread.outcome.output).toEqual({ archived: true });
  });

  it('chats.markUnread: the loader gives the handler the same answer, and the unread mark counts in the list, the badge and the chat (fbk_028, owner 2026-10-23)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const task = tasksOfProject(state, 'prj_001').find((t) => t.ownerId === ADMIN) ?? tasksOfProject(state, 'prj_001')[0];
    // The person reads the chat and the thread first, so nothing is unread.
    apply(state, 'chats.markRead', { conversationId: room.id }, ADMIN);
    apply(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'A note.' }, ADMIN);
    apply(state, 'chats.markRead', { conversationId: task.id }, ADMIN);
    const before = (await same(state, 'chats.list', {}, ADMIN)).outcome.output as { id: string; unread: number }[];
    expect(before.find((row) => row.id === room.id)?.unread).toBe(0);
    for (const id of [room.id, task.id]) {
      const run = await same(state, 'chats.markUnread', { conversationId: id }, ADMIN);
      expect(run.outcome.output).toEqual({ unread: true });
      // The write changed only the own read mark of the person.
      expect(docs(run, 'chat_reads')).toHaveLength(1);
      apply(state, 'chats.markUnread', { conversationId: id }, ADMIN);
    }
    const list = (await same(state, 'chats.list', {}, ADMIN)).outcome.output as { id: string; unread: number }[];
    expect(list.find((row) => row.id === room.id)?.unread).toBe(1);
    expect(list.find((row) => row.id === task.id)?.unread).toBe(1);
    const badge = (await same(state, 'chats.unreadCount', {}, ADMIN)).outcome.output as { unread: number };
    expect(badge.unread).toBe(list.reduce((sum, row) => sum + row.unread, 0));
    const thread = (await same(state, 'chats.messages', { conversationId: room.id }, ADMIN)).outcome.output as { chat: { unread: number } };
    expect(thread.chat.unread).toBe(1);
    // Opening the chat again ends the mark, for the loader as for the whole office.
    for (const id of [room.id, task.id]) await same(state, 'chats.markRead', { conversationId: id }, ADMIN);
    apply(state, 'chats.markRead', { conversationId: room.id }, ADMIN);
    const after = (await same(state, 'chats.list', {}, ADMIN)).outcome.output as { id: string; unread: number }[];
    expect(after.find((row) => row.id === room.id)?.unread).toBe(0);
  });

  it('chats.markRead and chats.archive: the loader loads the unread mention notices of the chat, so the write marks them read (item 20)', async () => {
    const room = Object.values(seed.conversations).find((c) => c.kind === 'project')!;
    const task = Object.values(seed.tasks)[0];
    const notice = (id: string, targetType: 'chat' | 'task', targetId: string, trigger: Notification['trigger'] = 'mention'): Notification => ({
      id, userId: 'usr_001', trigger, actorId: 'usr_002', targetType, targetId, read: false, createdAt: '2026-10-04T08:00:00.000+03:00', dedupeKey: null,
    });
    const state = office((s) => {
      s.notifications.ntf_901 = notice('ntf_901', 'chat', room.id);
      s.notifications.ntf_902 = notice('ntf_902', 'task', task.id);
      s.notifications.ntf_903 = notice('ntf_903', 'chat', room.id, 'added_to_group');
    });
    const chat = await same(state, 'chats.markRead', { conversationId: room.id }, 'usr_001');
    expect(docs(chat, 'notifications').map((d) => [d.id, d.read])).toEqual([['ntf_901', true]]);
    const thread = await same(state, 'chats.markRead', { conversationId: task.id }, 'usr_001');
    expect(docs(thread, 'notifications').map((d) => [d.id, d.read])).toEqual([['ntf_902', true]]);
    const archived = await same(state, 'chats.archive', { conversationId: room.id, archived: true }, 'usr_001');
    expect(docs(archived, 'notifications').map((d) => d.id)).toEqual(['ntf_901']);
    const back = await same(state, 'chats.archive', { conversationId: room.id, archived: false }, 'usr_001');
    expect(docs(back, 'notifications')).toEqual([]);
  });

  it('chats.waiting: the loader gives the handler the same answer, for a project mention and a named task thread (fbk_011, owner 2026-10-18)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [person, commenter] = team;
    if (!person || !commenter) throw new Error('The sample office needs two team members on prj_001.');
    const named = mentionMarkup(state.users[person].name, person);
    const later = new Date(NOW.getTime() + 60_000);
    // The person does not lead this task, so the rule reads the mention in the body of the newer comment.
    const task = tasksOfProject(state, 'prj_001').find((t) => t.ownerId !== null && t.ownerId !== person)!;
    apply(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'I will check the wall.' }, person);
    apply(state, 'comments.create', { targetType: 'task', targetId: task.id, body: `${named} Please check the wall again.` }, commenter, { now: later });
    apply(state, 'chats.send', { conversationId: room.id, body: `${named} Please check the sections.` }, ADMIN, { now: later });
    const run = await same(state, 'chats.waiting', {}, person);
    const rows = run.outcome.output as { kind: string; id: string }[];
    expect(rows.map((row) => row.kind)).toEqual(expect.arrayContaining(['project', 'task']));
    expect(rows.find((row) => row.id === task.id)).toBeDefined();
  });

  // Design item 23: the Admin's other project chats count only the messages that name the Admin, in the grouped count too.
  it('chats.list, chats.unreadCount and chats.markRead: the scoped count of an Admin outside the project holds only the named messages (item 23)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    // Hala (the Admin) is not on prj_001. Two plain messages are unread for her already (the sample), and one more names her.
    apply(state, 'chats.send', { conversationId: room.id, body: `${mentionMarkup(state.users[ADMIN].name, ADMIN)} please approve 5513.` }, 'usr_002', { now: at(5) });
    const unreadOf = (run: Run) => (run.outcome.output as { id: string; unread: number }[]).find((row) => row.id === room.id)?.unread;
    expect(unreadOf(await same(state, 'chats.list', {}, ADMIN))).toBe(1);
    expect((await same(state, 'chats.unreadCount', {}, ADMIN)).outcome.output).toMatchObject({ unread: expect.any(Number) });
    // A person on the team keeps the count of every unread message.
    const sara = Object.values(state.members).find((m) => m.projectId === 'prj_001' && m.userId !== 'usr_002' && state.users[m.userId].kind === 'human')!.userId;
    state.chatReads[chatReadKey(room.id, sara)] = { conversationId: room.id, userId: sara, lastReadAt: '2026-10-03T11:00:00.000+03:00', notify: 'named' };
    expect(unreadOf(await same(state, 'chats.list', {}, sara))).toBe(3);
    // The Admin picks All messages: the count comes back.
    state.chatReads[chatReadKey(room.id, ADMIN)] = { ...state.chatReads[chatReadKey(room.id, ADMIN)], notify: 'all' };
    expect(unreadOf(await same(state, 'chats.list', {}, ADMIN))).toBe(3);
    state.chatReads[chatReadKey(room.id, ADMIN)] = { ...state.chatReads[chatReadKey(room.id, ADMIN)], notify: 'named' };
    const read = await same(state, 'chats.markRead', { conversationId: room.id }, ADMIN);
    expect(read.outcome.error).toBeUndefined();
  });

  // Owner, 2026-10-23: what reaches the Admin. The scoped load gives the same list, badge and read as the whole office for each choice.
  it('chats.list, chats.unreadCount and chats.markRead: the scoped load follows the Admin choice (mixed, mine, all)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    apply(state, 'chats.send', { conversationId: room.id, body: `${mentionMarkup(state.users[ADMIN].name, ADMIN)} please approve 7702.` }, 'usr_002', { now: at(5) });
    const rowOf = (run: Run) => (run.outcome.output as { id: string; unread: number }[]).find((row) => row.id === room.id);
    const unreadOf = (run: Run) => (run.outcome.output as { unread: number }).unread;
    // Today: the default. The Admin is not on prj_001, so the chat lists and counts only the named message.
    const mixed = await same(state, 'chats.list', {}, ADMIN);
    expect(rowOf(mixed)?.unread).toBe(1);
    const mixedBadge = unreadOf(await same(state, 'chats.unreadCount', {}, ADMIN));
    // Only my work: the chat leaves the list, and the badge drops by what the chat counted.
    state.users[ADMIN].preferences = { ...state.users[ADMIN].preferences, adminReach: 'mine' };
    expect(rowOf(await same(state, 'chats.list', {}, ADMIN))).toBeUndefined();
    expect(unreadOf(await same(state, 'chats.unreadCount', {}, ADMIN))).toBe(mixedBadge - 1);
    expect((await same(state, 'chats.markRead', { conversationId: room.id }, ADMIN)).outcome.error).toBeUndefined();
    expect((await same(state, 'chats.messages', { conversationId: room.id }, ADMIN)).outcome.error).toBeUndefined();
    expect((await same(state, 'chats.send', { conversationId: room.id, body: 'Seen, thanks 7703.' }, ADMIN, { now: at(6) })).outcome.error).toBeUndefined();
    expect((await same(state, 'chats.setNotify', { conversationId: room.id, notify: 'all' }, ADMIN)).outcome.error).toBeUndefined();
    expect((await same(state, 'chats.markUnread', { conversationId: room.id }, ADMIN)).outcome.error).toBeUndefined();
    expect((await same(state, 'chats.archive', { conversationId: room.id, archived: true }, ADMIN)).outcome.error).toBeUndefined();
    // Everything: every message counts.
    state.users[ADMIN].preferences = { ...state.users[ADMIN].preferences, adminReach: 'all' };
    const all = await same(state, 'chats.list', {}, ADMIN);
    expect(rowOf(all)?.unread).toBe(3);
    expect(unreadOf(await same(state, 'chats.unreadCount', {}, ADMIN))).toBeGreaterThan(mixedBadge);
    // A person who is not an Admin reads the same whatever is stored.
    const sara = Object.values(state.members).find((m) => m.projectId === 'prj_001' && m.userId !== 'usr_002' && state.users[m.userId].kind === 'human')!.userId;
    state.users[sara].preferences = { ...state.users[sara].preferences, adminReach: 'mine' };
    expect(rowOf(await same(state, 'chats.list', {}, sara))).toBeDefined();
  });

  // Owner, 2026-10-23: the copies for an Admin who picked "Everything". The scoped load makes the same copies as the whole office, and an
  // Undo of the story takes them back on both.
  it('the copies for an Admin who picked Everything: the scoped load makes the same copies, and the Undo of the story takes them back', async () => {
    const state = office();
    state.users[ADMIN].preferences = { ...state.users[ADMIN].preferences, adminReach: 'all' };
    const project = Object.values(state.projects).find((p) => p.id === 'prj_001')!;
    const lead = project.leaderId!;
    const people = Object.values(state.members).filter((m) => m.projectId === 'prj_001' && m.userId !== lead && state.users[m.userId].kind === 'human').map((m) => m.userId);
    const [first, second] = people;
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const copiesOf = (run: Run) => docs(run, 'notifications').filter((doc) => doc.userId === ADMIN && doc.forUserIds !== undefined);
    const task = tasksOfProject(state, 'prj_001').find((t) => t.status === 'todo' && t.ownerId === first)!;
    const calls: [SharedCallName, unknown, string, number][] = [
      ['tasks.create', { projectId: 'prj_001', title: 'Copy check 8801', ownerId: second }, lead, 1],
      ['tasks.complete', { id: task.id }, first, 2],
      ['chats.send', { conversationId: room.id, body: `${mentionMarkup(state.users[second].name, second)} please look.` }, lead, 3],
      ['comments.create', { targetType: 'task', targetId: task.id, body: `${mentionMarkup(state.users[second].name, second)} see this.` }, lead, 4],
      ['meetings.create', { kind: 'client', title: 'Copy meeting 8802', projectId: 'prj_001', startsAt: '2026-10-11T09:00:00+03:00', attendeeIds: [second] }, lead, 5],
    ];
    for (const [name, input, actor, minute] of calls) {
      const run = await same(state, name, input, actor, { now: at(minute) });
      expect(run.outcome.error, name).toBeUndefined();
      expect(copiesOf(run), name).toHaveLength(1);
      apply(state, name, input, actor, { now: at(minute), story: `cor_copy_${minute}` });
    }
    // The Undo of a story on the scoped load takes the copy back with the original.
    const created = apply(state, 'tasks.create', { projectId: 'prj_001', title: 'Copy check 8803', ownerId: second }, lead, { now: at(6), story: 'cor_copy_undo' }) as unknown;
    expect(created).toBeDefined();
    const copy = Object.values(state.notifications).find((n) => n.correlationId === 'cor_copy_undo' && n.userId === ADMIN);
    expect(copy?.forUserIds).toEqual([second]);
    const undone = await same(state, 'events.undoStory', { correlationId: 'cor_copy_undo' }, lead, { now: at(7) });
    expect(undone.outcome.error).toBeUndefined();
    expect(deleted(undone, 'notifications')).toEqual(expect.arrayContaining([copy!.id]));
    // The bell of the Admin lists the copy with the names, on the scoped load too.
    const bell = await same(state, 'notifications.list', {}, ADMIN);
    const view = (bell.outcome.output as { notification: { forUserIds?: string[] }; forPeople: { id: string }[] }[]).find((v) => v.notification.forUserIds !== undefined);
    expect(view?.forPeople.length).toBeGreaterThan(0);
  });

  // Design item 22: a group waits only for a message that names the person, a reply to a comment names its author, and a 👍 answers.
  it('chats.waiting: the scoped load gives the same answer for a group that names the person, a reply to a comment and a 👍 (item 22)', async () => {
    const state = office();
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [person, other] = team;
    if (!person || !other) throw new Error('The sample office needs two team members on prj_001.');
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const idOf = (view: unknown) => (view as { message: { id: string } }).message.id;
    const { id: group } = apply(state, 'chats.createGroup', { name: 'Item 22 team', memberIds: [person, ADMIN] }, other) as { id: string };
    apply(state, 'chats.send', { conversationId: group, body: 'Plain group note 6641.' }, other, { now: at(1) });
    const { id: direct } = apply(state, 'chats.openDirect', { userId: person }, other) as { id: string };
    const question = idOf(apply(state, 'chats.send', { conversationId: direct, body: 'Direct question 2231.' }, other, { now: at(2) }));
    const task = tasksOfProject(state, 'prj_001').find((t) => t.ownerId !== null && t.ownerId !== person)!;
    // The reply answers the first comment of the person, which is older than the newest comment of the person: only a load by key sees it.
    const first = apply(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'I will check the wall.' }, person, { now: at(3) }) as { comment: { id: string } };
    apply(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'Second note.' }, person, { now: at(4) });
    apply(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'Thanks.', replyToId: first.comment.id }, other, { now: at(5) });
    // The plain group note names nobody, so the group does not wait yet.
    const before = (await same(state, 'chats.waiting', {}, person)).outcome.output as { kind: string; id: string }[];
    expect(before.map((row) => row.id)).not.toContain(group);
    expect(before.map((row) => row.id)).toEqual(expect.arrayContaining([direct, task.id]));
    // The naming message is older than the newest message of the group: only the select of the newest naming message sees it.
    apply(state, 'chats.send', { conversationId: group, body: `${mentionMarkup(state.users[person].name, person)} Please look at 6641.` }, other, { now: at(6) });
    apply(state, 'chats.send', { conversationId: group, body: 'And a plain word after it.' }, other, { now: at(7) });
    const named = (await same(state, 'chats.waiting', {}, person)).outcome.output as { kind: string; id: string }[];
    expect(named.map((row) => row.id)).toContain(group);
    // A 👍 of the person on the question and on the comment that waits answers them.
    state.messages[question].reactions = { ...emptyReactions(), '👍': [person] };
    const answered = (await same(state, 'chats.waiting', {}, person)).outcome.output as { kind: string; id: string }[];
    expect(answered.map((row) => row.id)).not.toContain(direct);
    expect(answered.map((row) => row.id)).toContain(group);
  });

  // Base B3 (chat design 2026-10-19): a deleted message leaves every read path, also in the scoped load.
  it('chats reads: the scoped load leaves a deleted message out, as the handler does (base B3)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [person, other] = team;
    if (!person || !other) throw new Error('The sample office needs two team members on prj_001.');
    const named = mentionMarkup(state.users[person].name, person);
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const idOf = (view: unknown) => (view as { message: { id: string } }).message.id;
    // A live message that names the person, then a newer message that names the person too, and is deleted.
    apply(state, 'chats.send', { conversationId: room.id, body: `${named} Live note 4417.` }, other, { now: at(1) });
    const goneInRoom = idOf(apply(state, 'chats.send', { conversationId: room.id, body: `${named} Deleted note 7731.` }, ADMIN, { now: at(2) }));
    // A direct chat whose newest message is deleted.
    const { id: direct } = apply(state, 'chats.openDirect', { userId: person }, other) as { id: string };
    apply(state, 'chats.send', { conversationId: direct, body: 'Direct live 5521.' }, other, { now: at(3) });
    const goneInDirect = idOf(apply(state, 'chats.send', { conversationId: direct, body: 'Direct deleted 9921.' }, other, { now: at(4) }));
    for (const id of [goneInRoom, goneInDirect]) state.messages[id].deletedAt = '2026-10-04T09:30:00.000+03:00';
    for (const actor of [person, other, ADMIN]) {
      await same(state, 'chats.list', {}, actor);
      await same(state, 'chats.unreadCount', {}, actor);
      await same(state, 'chats.waiting', {}, actor);
      await same(state, 'chats.markRead', { conversationId: room.id }, actor);
      await same(state, 'chats.messages', { conversationId: room.id }, actor);
    }
    const page = await same(state, 'chats.messages', { conversationId: direct }, person);
    expect(JSON.stringify(page.outcome.output)).toContain('Direct live 5521.');
    expect(JSON.stringify(page.outcome.output)).not.toContain('9921');
    const list = (await same(state, 'chats.list', {}, person)).outcome.output as { id: string; preview: string; unread: number }[];
    expect(list.find((row) => row.id === direct)).toMatchObject({ preview: 'Direct live 5521.', unread: 1 });
    expect(JSON.stringify(list)).not.toContain('7731');
    const waits = (await same(state, 'chats.waiting', {}, person)).outcome.output as { id: string; body: string }[];
    expect(waits.find((row) => row.id === room.id)?.body).toContain('Live note 4417.');
    expect(JSON.stringify(waits)).not.toMatch(/7731|9921/);
  });

  // Base B5 (chat design 2026-10-19): a reply link reads an old message or comment that the scoped load may not hold yet.
  it('chats.messages: the scoped load brings the old message of a reply that is older than the page (base B5)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [person, other] = team;
    if (!person || !other) throw new Error('The sample office needs two team members on prj_001.');
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const idOf = (view: unknown) => (view as { message: { id: string } }).message.id;
    const old = idOf(apply(state, 'chats.send', { conversationId: room.id, body: `${mentionMarkup(state.users[person].name, person)} Old question 3318.\nSecond line.` }, other, { now: at(1) }));
    apply(state, 'chats.send', { conversationId: room.id, body: 'Middle one.' }, other, { now: at(2) });
    apply(state, 'chats.send', { conversationId: room.id, body: 'Middle two.' }, other, { now: at(3) });
    const last = idOf(apply(state, 'chats.send', { conversationId: room.id, body: 'The answer.' }, person, { now: at(4) }));
    state.messages[last].replyToId = old;
    for (const actor of [person, other, ADMIN]) {
      const run = await same(state, 'chats.messages', { conversationId: room.id, limit: 2 }, actor);
      const page = run.outcome.output as { messages: { message: { id: string }; replyTo: { firstLine: string; deleted: boolean } | null; namesMe: boolean }[]; notify: string; readUpTo: string | null };
      expect(page.messages, actor).toHaveLength(2);
      const reply = page.messages.find((view) => view.message.id === last)!;
      expect(reply.replyTo, actor).toMatchObject({ firstLine: expect.stringContaining('Old question 3318.'), deleted: false });
      expect(page.messages.some((view) => view.message.id === old), 'the old message is not on the page').toBe(false);
    }
  });

  // Chat presence base B2: the chat view gives the seen times of the other members, so the scoped load reads every read mark of the chat.
  it('chats.messages: the scoped load brings the seen times of every member of the chat (chat presence B2)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [person, other] = team;
    if (!person || !other) throw new Error('The sample office needs two team members on prj_001.');
    for (const [userId, seenAt] of [[person, '2026-10-04T08:00:00.000+03:00'], [other, '2026-10-04T08:30:00.000+03:00']] as const) {
      state.chatReads[chatReadKey(room.id, userId)] = { conversationId: room.id, userId, lastReadAt: seenAt, seenAt };
    }
    for (const actor of [person, other, ADMIN]) {
      const run = await same(state, 'chats.messages', { conversationId: room.id }, actor);
      const page = run.outcome.output as { seen: { userId: string; at: string }[]; seenUpTo: string | null; others: number };
      expect(page.seen.map((entry) => entry.userId), actor).toEqual([person, other].filter((id) => id !== actor).sort((a, b) => (a === other ? -1 : b === other ? 1 : 0)));
      expect(page.others, actor).toBeGreaterThanOrEqual(1);
    }
    // A look in use: the same answer and the same writes on the scoped load, for a member and for an Admin outside the team.
    for (const actor of [person, ADMIN]) await same(state, 'chats.markRead', { conversationId: room.id, seen: true }, actor);
  });

  it('comments.update and reactions.toggle: the scoped load brings the comment a reply answers (base B5)', async () => {
    const state = office();
    const task = Object.values(state.tasks).find((t) => t.projectId !== null && t.ownerId !== null)!;
    const lead = task.ownerId as string;
    const other = Object.values(state.members).filter((m) => m.projectId === task.projectId).map((m) => m.userId).find((id) => id !== lead && id !== ADMIN && state.users[id].kind === 'human')!;
    const add = (id: string, authorId: string, at: string, extra: Partial<State['comments'][string]> = {}) => {
      state.comments[id] = { id, targetType: 'task', targetId: task.id, authorId, body: `Note ${id} 6641`, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null, ...extra };
    };
    add('cmt_901', lead, '2026-10-01T09:00:00.000+03:00');
    add('cmt_902', other, '2026-10-02T09:00:00.000+03:00', { replyToId: 'cmt_901' });
    for (const [name, input, actor] of [
      ['comments.list', { targetType: 'task', targetId: task.id }, lead],
      ['comments.update', { id: 'cmt_902', body: 'A new word for the reply.' }, other],
      ['reactions.toggle', { commentId: 'cmt_902', emoji: '👍' }, lead],
    ] as const) {
      const run = await same(state, name, input, actor);
      expect(run.outcome.error, name).toBeUndefined();
    }
    const view = (await same(state, 'reactions.toggle', { commentId: 'cmt_902', emoji: '👍' }, lead)).outcome.output as { replyTo: { id: string; deleted: boolean } | null; namesMe: boolean };
    expect(view.replyTo).toMatchObject({ id: 'cmt_901', deleted: false });
    expect(view.namesMe).toBe(true);
  });

  // Base B6 (chat design 2026-10-19): a reply reads the old message or comment by key, and names its author.
  it('chats.send and comments.create with a reply: the scoped load gives the answer and the writes of the whole office (base B6)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [person, other] = team;
    if (!person || !other) throw new Error('The sample office needs two team members on prj_001.');
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const idOf = (view: unknown) => (view as { message: { id: string } }).message.id;
    const old = idOf(apply(state, 'chats.send', { conversationId: room.id, body: 'Old question 3318.' }, other, { now: at(1) }));
    for (let i = 0; i < 3; i += 1) apply(state, 'chats.send', { conversationId: room.id, body: `Newer ${i}.` }, other, { now: at(2 + i) });
    const sent = await same(state, 'chats.send', { conversationId: room.id, body: 'The answer.', replyToId: old }, person, { now: at(10) });
    expect(sent.outcome.error).toBeUndefined();
    expect(sent.outcome.output).toMatchObject({ message: { replyToId: old, mentions: [other] }, replyTo: { id: old, deleted: false } });
    expect(inserted(sent, 'notifications').length).toBe(1);
    const refused = await same(state, 'chats.send', { conversationId: room.id, body: 'The answer.', replyToId: 'msg_9999' }, person, { now: at(10) });
    expect(refused.outcome.error).toMatchObject({ code: 'invalid_input' });

    const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_001' && t.ownerId !== null)!;
    const another = Object.values(state.tasks).find((t) => t.projectId === 'prj_001' && t.id !== task.id)!;
    const add = (id: string, targetId: string, authorId: string, at2: string) => {
      state.comments[id] = { id, targetType: 'task', targetId, authorId, body: `Note ${id} 6641`, reactions: emptyReactions(), fileIds: [], createdAt: at2, editedAt: null };
    };
    add('cmt_901', task.id, other, '2026-10-01T09:00:00.000+03:00');
    add('cmt_902', another.id, other, '2026-10-01T10:00:00.000+03:00');
    for (const actor of [person, ADMIN]) {
      const made = await same(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'A reply.', replyToId: 'cmt_901' }, actor);
      expect(made.outcome.error, actor).toBeUndefined();
      const foreign = await same(state, 'comments.create', { targetType: 'task', targetId: task.id, body: 'A reply.', replyToId: 'cmt_902' }, actor);
      expect(foreign.outcome.error, actor).toMatchObject({ code: 'invalid_input' });
    }
  });

  // Track msg B8 (chat design 2026-10-19, item 11): an edit finds the names again. The notices of the message must be in the scoped load,
  // or the removal of a name would leave its notice behind, and the whole office would delete it.
  it('chats.editMessage: the scoped load adds the notice of a new name and takes away the notice of a removed name (B8)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [author, first, second] = team;
    if (!author || !first || !second) throw new Error('The sample office needs three team members on prj_001.');
    const idOf = (view: unknown) => (view as { message: { id: string } }).message.id;
    const sent = idOf(apply(state, 'chats.send', { conversationId: room.id, body: `${mentionMarkup(state.users[first].name, first)} look at the wall.` }, author, { now: new Date(NOW.getTime() + 60_000) }));
    expect(Object.values(state.notifications).filter((n) => n.messageId === sent && n.userId === first)).toHaveLength(1);
    const removed = await same(state, 'chats.editMessage', { id: sent, body: 'Look at the wall.' }, author);
    expect(removed.outcome.error).toBeUndefined();
    expect(deleted(removed, 'notifications')).toHaveLength(1);
    expect(inserted(removed, 'notifications')).toHaveLength(0);
    const swapped = await same(state, 'chats.editMessage', { id: sent, body: `${mentionMarkup(state.users[second].name, second)} look at the wall.` }, author);
    expect(swapped.outcome.error).toBeUndefined();
    expect(deleted(swapped, 'notifications')).toHaveLength(1);
    expect(inserted(swapped, 'notifications')).toHaveLength(1);
    const other = await same(state, 'chats.editMessage', { id: sent, body: 'Not mine' }, first);
    expect(other.outcome.error).toMatchObject({ code: 'forbidden' });
  });

  // Track msg B9 (chat design 2026-10-19, item 11): a delete takes the notices of the message away, and a restore writes them again, read.
  it('chats.deleteMessage: the scoped load takes the notices away, and the restore brings them back read (B9)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [author, first] = team;
    if (!author || !first) throw new Error('The sample office needs two team members on prj_001.');
    const idOf = (view: unknown) => (view as { message: { id: string } }).message.id;
    const sent = idOf(apply(state, 'chats.send', { conversationId: room.id, body: `${mentionMarkup(state.users[first].name, first)} Secret offer 8842.` }, author, { now: new Date(NOW.getTime() + 60_000) }));
    const gone = await same(state, 'chats.deleteMessage', { id: sent }, author);
    expect(gone.outcome.output).toEqual({ deleted: true });
    expect(deleted(gone, 'notifications')).toHaveLength(1);
    expect(docs(gone, 'messages')[0]).toMatchObject({ id: sent, deletedAt: expect.any(String) });
    apply(state, 'chats.deleteMessage', { id: sent }, author);
    expect(Object.values(state.notifications).filter((n) => n.messageId === sent)).toHaveLength(0);
    const back = await same(state, 'chats.deleteMessage', { id: sent, deleted: false }, author);
    expect(back.outcome.output).toEqual({ deleted: false });
    expect(docs(back, 'notifications')).toEqual([expect.objectContaining({ messageId: sent, userId: first, read: true })]);
    expect(docs(back, 'messages')[0]).not.toHaveProperty('deletedAt');
    // The page before the deleted message works on the scoped load too.
    const read = await same(state, 'chats.messages', { conversationId: room.id, before: sent, limit: 3 }, author);
    expect(read.outcome.error).toBeUndefined();
    expect(JSON.stringify(read.outcome.output)).not.toContain('8842');
  });

  // Track msg B10 (chat design 2026-10-19, item 12): a reaction on a message reads the message and the message it answers, and writes no notice.
  it('reactions.toggle on a message: the scoped load gives the view with its reply link, and writes the message only (B10)', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const team = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => m.userId).filter((id) => id !== ADMIN && state.users[id].kind === 'human');
    const [person, other] = team;
    if (!person || !other) throw new Error('The sample office needs two team members on prj_001.');
    const idOf = (view: unknown) => (view as { message: { id: string } }).message.id;
    const old = idOf(apply(state, 'chats.send', { conversationId: room.id, body: 'Old question 3318.' }, other, { now: new Date(NOW.getTime() + 60_000) }));
    const last = idOf(apply(state, 'chats.send', { conversationId: room.id, body: 'The answer.' }, person, { now: new Date(NOW.getTime() + 120_000) }));
    state.messages[last].replyToId = old;
    for (const actor of [person, other, ADMIN]) {
      const run = await same(state, 'reactions.toggle', { messageId: last, emoji: '👍' }, actor);
      expect(run.outcome.error, actor).toBeUndefined();
      expect(run.outcome.output, actor).toMatchObject({ message: { id: last, reactions: { '👍': [actor] } }, replyTo: { id: old, firstLine: 'Old question 3318.', deleted: false } });
      expect(docs(run, 'messages').map((doc) => doc.id), actor).toEqual([last]);
      expect(inserted(run, 'notifications'), actor).toHaveLength(0);
      expect(inserted(run, 'events'), actor).toHaveLength(0);
    }
    // A comment still takes the old input.
    const task = Object.values(state.tasks).find((t) => t.projectId !== null && t.ownerId !== null)!;
    state.comments.cmt_901 = { id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: person, body: 'A note', reactions: emptyReactions(), fileIds: [], createdAt: '2026-10-01T09:00:00.000+03:00', editedAt: null };
    const comment = await same(state, 'reactions.toggle', { commentId: 'cmt_901', emoji: '✅' }, ADMIN);
    expect(comment.outcome.error).toBeUndefined();
    expect(inserted(comment, 'events').length).toBe(1);
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

describe('the guarded reads of the review (2026-10-04)', () => {
  it('an undone status change leaves the feed, so the project view, the feed and the project list read past it', async () => {
    const state = office();
    const task = todo(state, 'prj_001')[0];
    apply(state, 'tasks.move', { id: task.id, status: 'in_progress' }, ADMIN, { story: 'cor_move' });
    const moved = Object.values(state.events).find((e) => e.correlationId === 'cor_move' && e.targetId === task.id)!;
    apply(state, 'events.undo', { eventId: moved.id }, ADMIN, { story: 'cor_undo_move' });
    await same(state, 'projects.get', { id: 'prj_001' }, ADMIN);
    await same(state, 'updates.list', { projectId: 'prj_001', filter: 'tasks', limit: 2 }, ADMIN);
    await same(state, 'projects.list', { status: 'all' }, ADMIN);
  });

  it('projects.delete removes the mention notices of its project chat', async () => {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const member = Object.values(state.members).filter((m) => m.projectId === 'prj_001').map((m) => state.users[m.userId])
      .find((u) => u.id !== ADMIN && u.kind === 'human' && u.active && u.preferences.notifications.mention)!;
    apply(state, 'chats.send', { conversationId: room.id, body: `See this @[${member.name}](${member.id})` }, ADMIN);
    const notices = Object.values(state.notifications).filter((n) => n.targetType === 'chat' && n.targetId === room.id).map((n) => n.id);
    expect(notices.length).toBeGreaterThan(0);
    const run = await same(state, 'projects.delete', { id: 'prj_001', confirm: true }, ADMIN);
    expect(deleted(run, 'notifications')).toEqual(expect.arrayContaining(notices));
  });

  it('feed events of one stamp keep their order when the ids pass evt_999', async () => {
    const state = office((s) => {
      s.counters.evt = 998;
    });
    const [a, b] = todo(state, 'prj_001');
    apply(state, 'tasks.move', { id: a.id, status: 'in_progress' }, ADMIN);
    apply(state, 'tasks.move', { id: b.id, status: 'in_progress' }, ADMIN);
    expect(state.events.evt_1000).toBeDefined();
    await same(state, 'updates.list', { projectId: 'prj_001', filter: 'tasks', limit: 1 }, ADMIN);
  });
});

describe('unread counts (plan 4.13, A9)', () => {
  const LONG = 5000;
  /** One stamp a minute from 1 September, in the +03:00 shape of the office. */
  const minute = (i: number) => {
    const at = new Date(Date.UTC(2026, 8, 1, 6, 0) + i * 60_000);
    const two = (n: number) => String(n).padStart(2, '0');
    return `2026-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}T${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:00.000+03:00`;
  };

  /**
   * A project chat of 5,000 messages by its leader and the leader's agent, and a task thread of 5,000 comments after one comment
   * of the Admin. The Admin has no read mark on either. Two messages share a stamp at the end.
   */
  function long(): { state: State; room: string; thread: string } {
    const state = office();
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    const leader = state.projects.prj_001.leaderId!;
    const agent = Object.values(state.users).find((u) => u.kind === 'agent' && u.ownerId === leader);
    // Item 23: the Admin counts every message of a chat only of a project that the Admin works on, so the Admin joins the team here.
    state.members[memberKey('prj_001', ADMIN)] = { projectId: 'prj_001', userId: ADMIN, discipline: 'Architect' };
    for (const key of Object.keys(state.chatReads)) if (state.chatReads[key].userId === ADMIN) delete state.chatReads[key];
    for (let i = 0; i < LONG; i += 1) {
      const id = `msg_${String(10_000 + i)}`;
      const authorId = agent && i % 7 === 0 ? agent.id : leader;
      state.messages[id] = {
        id, conversationId: room.id, authorId, actingForId: leader, body: `Message ${i}`, mentions: [], fileIds: [], createdAt: minute(Math.min(i, LONG - 2)), editedAt: null,
      };
    }
    // Two messages where the two rules of "not the leader's own" disagree. The office holds one agent, so the test adds an agent
    // of the leader and an agent of a third person.
    const third = Object.values(state.users).find((u) => u.kind === 'human' && u.active && u.id !== leader && u.id !== ADMIN)!;
    const agentOf = (id: string, ownerId: string) => {
      state.users[id] = { ...Object.values(state.users).find((u) => u.kind === 'agent')!, id, email: `${id}@madar.test`, ownerId };
      return id;
    };
    const leaderAgent = agent?.id ?? agentOf('usr_090', leader);
    const thirdAgent = agentOf('usr_091', third.id);
    const edge = (id: string, authorId: string, actingForId: string) => {
      state.messages[id] = {
        id, conversationId: room.id, authorId, actingForId, body: id, mentions: [], fileIds: [], createdAt: minute(LONG - 3), editedAt: null,
      };
    };
    // Only "acting for the leader" leaves this one out for the leader.
    edge('msg_09001', thirdAgent, leader);
    // Only "by the leader's agent" leaves this one out for the leader.
    edge('msg_09002', leaderAgent, third.id);
    const task = todo(state, 'prj_001')[0];
    const comment = (id: string, authorId: string, at: string) => {
      state.comments[id] = { id, targetType: 'task', targetId: task.id, authorId, body: id, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null };
    };
    comment('cmt_09999', ADMIN, minute(0));
    for (let i = 1; i <= LONG; i += 1) comment(`cmt_${String(10_000 + i)}`, leader, minute(Math.min(i, LONG - 1)));
    return { state, room: room.id, thread: task.id };
  }

  async function loadedBy(state: State, name: SharedCallName, input: unknown): Promise<State> {
    const { whole, scoped, loaded } = await runBoth(state, name, input, ADMIN, { now: NOW, correlationId: 'cor_test' });
    expect(scoped, name).toEqual(whole);
    expect(whole.outcome.error, name).toBeUndefined();
    return loaded;
  }

  it('loads at most the newest message of a chat of 5,000 messages with no read mark, and the newest comments of a long thread', async () => {
    const { state, room, thread } = long();
    const inRoom = (loaded: State) => Object.values(loaded.messages).filter((m) => m.conversationId === room).length;
    const onThread = (loaded: State) => Object.values(loaded.comments).filter((c) => c.targetId === thread).length;
    for (const name of ['chats.list', 'chats.unreadCount'] as const) {
      const loaded = await loadedBy(state, name, {});
      expect(inRoom(loaded), name).toBeLessThanOrEqual(1);
      expect(onThread(loaded), name).toBeLessThanOrEqual(2);
    }
    const rows = (await same(state, 'chats.list', {}, ADMIN)).outcome.output as { id: string; unread: number }[];
    expect(rows.find((row) => row.id === room)?.unread).toBeGreaterThanOrEqual(LONG);
    expect(rows.find((row) => row.id === thread)?.unread).toBeGreaterThanOrEqual(LONG);

    const paged = await loadedBy(state, 'chats.messages', { conversationId: room, limit: 2 });
    expect(inRoom(paged)).toBeLessThanOrEqual(2);
    const marked = await loadedBy(state, 'chats.markRead', { conversationId: room });
    expect(inRoom(marked)).toBeLessThanOrEqual(1);
    const markedThread = await loadedBy(state, 'chats.markRead', { conversationId: thread });
    // The mark of a thread reads its newest stamp, so the comments that share that stamp come too (two here), and the own one.
    const newestAt = minute(LONG - 1);
    const kept = Object.values(markedThread.comments).filter((c) => c.targetId === thread);
    expect(kept.every((c) => c.authorId === ADMIN || c.createdAt === newestAt)).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(3);
    }, 30_000);

  it('counts what the scan counts: not the person, not their agent, not a message for them, and after their own last comment', async () => {
    const { state, room, thread } = long();
    const leader = state.projects.prj_001.leaderId!;
    // The leader reads both halfway: the counts start at the mark, and leave out the leader's own and the agent's messages.
    state.chatReads[chatReadKey(room, leader)] = { conversationId: room, userId: leader, lastReadAt: minute(LONG / 2) };
    state.comments.cmt_09998 = { ...state.comments.cmt_09999, id: 'cmt_09998', authorId: leader, createdAt: minute(LONG - 1) };
    state.comments.cmt_09997 = { ...state.comments.cmt_09999, id: 'cmt_09997', authorId: ADMIN, createdAt: minute(LONG - 1) };
    // Same stamp as the Admin's own last comment but an id before it: it comes before it in the thread, so it is not unread.
    state.comments.cmt_09996 = { ...state.comments.cmt_09999, id: 'cmt_09996', authorId: leader, createdAt: minute(LONG - 1) };
    for (const actor of [ADMIN, leader]) {
      await same(state, 'chats.list', {}, actor);
      await same(state, 'chats.unreadCount', {}, actor);
      await same(state, 'chats.messages', { conversationId: room }, actor);
      await same(state, 'chats.markRead', { conversationId: thread }, actor);
      await same(state, 'chats.markRead', { conversationId: room }, actor);
    }
    }, 30_000);

  it('a write holds no unread count unless the call keeps it true (chats.markRead)', async () => {
    const state = office();
    const L = new Load({ src: memorySource(state), office: snapshotOf(state, 1), actorId: ADMIN, write: true });
    const count = { c: 'messages', per: 'conversation_id', where: [] } as const;
    await expect(L.countWhere(count, ['cnv_001'], (id) => id)).rejects.toThrow('A write reads rows, never counts');
    await expect(L.countWhere(count, ['cnv_001'], (id) => id, { inWrite: true })).resolves.toBeUndefined();
  });
});

describe('the jobs loader (plan 4.6, for track N3)', () => {
  it('gives runScheduledTriggers the same notices on its scoped load as on the whole office', async () => {
    const state = office();
    const [soon, late] = todo(state, 'prj_001');
    soon.dueDate = '2026-10-05';
    late.dueDate = '2026-09-30';
    const paused = Object.values(state.projects).find((p) => p.status === 'active' && p.id !== 'prj_001')!;
    paused.status = 'on_hold';
    paused.pause = { reason: 'Client', resumeOn: '2026-10-01', by: ADMIN, at: '2026-09-20T09:00:00.000+03:00' };
    // A notice the job wrote on an earlier run: the dedupe lookup must stop a second one.
    const key = `overdue:${late.id}:${late.dueDate}`;
    state.notifications.ntf_990 = {
      id: 'ntf_990', userId: late.ownerId!, trigger: 'overdue', actorId: null, targetType: 'task', targetId: late.id, read: false,
      createdAt: '2026-10-03T09:00:00.000+03:00', dedupeKey: `${key}:${late.ownerId}`,
    };

    const whole = structuredClone(state);
    const wholeBefore = structuredClone(whole);
    const count = runScheduledTriggers(whole, NOW);

    const loaded = await loadJobs({ src: memorySource(state), office: snapshotOf(state, 1) });
    expect(Object.keys(loaded.notifications)).toEqual([]);
    const scoped = structuredClone(loaded);
    const dedupeUsed = (k: string) => Object.values(state.notifications).some((n) => n.dedupeKey === k);
    expect(runScheduledTriggers(scoped, NOW, { dedupeUsed })).toBe(count);
    expect(changesOf(loaded, scoped)).toEqual(changesOf(wholeBefore, whole));

    const made = Object.values(whole.notifications).filter((n) => !state.notifications[n.id]);
    expect(new Set(made.map((n) => n.trigger))).toEqual(new Set(['due_tomorrow', 'overdue', 'resume_due']));
    expect(made.some((n) => n.dedupeKey === `${key}:${late.ownerId}`)).toBe(false);
  });
});

describe('office tasks (owner, 2026-10-06)', () => {
  it('the writes of the people of an office task succeed with the same answer on the scoped load; the outsider gets not_found', async () => {
    const traps = trapOffice(seed);
    const writes = officeWrites(traps);
    expect(writes.length).toBeGreaterThan(10);
    for (const [name, input, actor, prepared] of writes) {
      const run = await same(traps, name, input, actor, { prepared });
      if (actor === 'usr_003') expect(run.outcome.error, name).toMatchObject({ code: 'not_found' });
      else expect(run.outcome.error, `${name} ${JSON.stringify(input)}`).toBeUndefined();
    }
  });

  it('the reads of the outsider hold nothing of an office task; the reads of its agent hold what its person reads', async () => {
    const traps = trapOffice(seed);
    const ids = new Set(Object.values(traps.tasks).filter((t) => t.projectId === null).map((t) => t.id));
    expect(ids.size).toBe(2);
    const text = async (actor: string, name: SharedCallName, input: unknown) => JSON.stringify((await same(traps, name, input, actor)).outcome.output);
    for (const [name, input] of [['tasks.list', {}], ['search.query', { text: 'licence' }], ['events.list', { limit: 500 }], ['chats.list', {}], ['notifications.list', {}]] as const) {
      const seen = await text('usr_003', name, input);
      for (const id of ids) expect(seen, `${name} ${id}`).not.toContain(id);
      expect(await text(OFFICE_AGENT, name, input), name).toBe(await text('usr_005', name, input));
    }
    const admin = await text(ADMIN, 'tasks.list', {});
    for (const id of ids) expect(admin).toContain(id);
  });

  it('gives a holder of task.officeAll the office tasks on the scoped load, as the Admin has them, and a person without the switch none (role rights version 2)', async () => {
    const traps = trapOffice(seed);
    traps.settings.roles = { custom: [{ id: 'rol_900', name: 'Office reader', nameAr: 'قارئ المكتب', rights: ['task.officeAll'] }] };
    traps.users.usr_003 = { ...traps.users.usr_003, roleId: 'rol_900' };
    const ids = [...Object.values(traps.tasks).filter((t) => t.projectId === null).map((t) => t.id)];
    expect(ids).toHaveLength(2);
    const text = async (actor: string, name: SharedCallName, input: unknown) => JSON.stringify((await same(traps, name, input, actor)).outcome.output);
    for (const [name, input] of [['tasks.list', {}], ['search.query', { text: 'licence' }], ['events.list', { limit: 500 }]] as const) {
      const holder = await text('usr_003', name, input);
      const admin = await text(ADMIN, name, input);
      for (const id of ids) expect(holder.includes(id), `${name} ${id}`).toBe(admin.includes(id));
      const none = await text('usr_002', name, input);
      for (const id of ids) expect(none, `${name} ${id}`).not.toContain(id);
    }
    expect(await text('usr_003', 'tasks.list', {})).toContain(ids[0]);
    // The holder changes an office task as its maker does; a person without the switch gets not_found, on both loads.
    const first = ids[0];
    const done = await same(traps, 'tasks.update', { id: first, patch: { helperIds: [] } }, 'usr_003');
    expect(done.outcome.error).toBeUndefined();
    const refused = await same(traps, 'tasks.update', { id: first, patch: { helperIds: [] } }, 'usr_002');
    expect(refused.outcome.error).toMatchObject({ code: 'not_found' });
  });

  it('an Undo of a comment change after the delete of its office task stays private on the scoped load (review 2026-10-06)', async () => {
    const traps = trapOffice(seed);
    const task = Object.values(traps.tasks).find((t) => t.projectId === null && t.ownerId !== null)!;
    const created = Object.values(traps.events).find((e) => e.verb === 'comment.created' && e.officeTaskId === task.id)!;
    const comment = created.targetId;
    apply(traps, 'tasks.delete', { id: task.id }, task.createdBy);
    // The outsider: a comment of the deleted office task reads as a missing comment, on both loads.
    const hidden = await same(traps, 'comments.update', { id: comment, body: 'x' }, 'usr_003');
    expect(hidden.outcome.error).toEqual({ code: 'not_found', message: `Comment ${comment} does not exist.` });
    const run = await same(traps, 'events.undo', { eventId: created.id }, created.actingForId);
    expect(run.outcome.error).toBeUndefined();
    expect(docs(run, 'events').map((doc) => doc.officeTaskId)).toEqual([task.id]);
    apply(traps, 'events.undo', { eventId: created.id }, created.actingForId);
    const seen = await same(traps, 'events.list', { limit: 500 }, 'usr_003');
    expect(JSON.stringify(seen.outcome.output)).not.toContain(task.id);
  });

  it('the Undo of a story with a project part and an office part drops the notice of the project leader on both loads', async () => {
    const state = office();
    const task = Object.values(state.tasks).find((t) => t.projectId !== null && t.status === 'todo' && t.ownerId !== null && t.needsReview
      && state.projects[t.projectId].leaderId !== null && state.projects[t.projectId].leaderId !== t.ownerId)!;
    const leader = state.projects[task.projectId!].leaderId!;
    // An agent of the lead finishes the task (the leader gets a review notice) and makes an office task in the same story.
    state.users.usr_095 = { ...state.users.usr_009, id: 'usr_095', email: 'agent.lead@madar.test', ownerId: task.ownerId };
    apply(state, 'tasks.complete', { id: task.id }, 'usr_095', { story: 'cor_mix' });
    const other = Object.values(state.users).find((u) => u.kind === 'human' && u.active && u.id !== leader && u.id !== task.ownerId && u.systemRole === 'member')!;
    apply(state, 'tasks.create', { title: 'Order paper', ownerId: other.id }, 'usr_095', { story: 'cor_mix' });
    const notice = Object.values(state.notifications).find((n) => n.correlationId === 'cor_mix' && n.userId === leader)!;
    const run = await same(state, 'events.undoStory', { correlationId: 'cor_mix' }, leader);
    expect(run.outcome.error).toBeUndefined();
    expect(deleted(run, 'notifications')).toContain(notice.id);
  });

  it('the jobs load brings the open office tasks, so their people get the due reminders', async () => {
    const traps = trapOffice(seed);
    const whole = structuredClone(traps);
    const wholeBefore = structuredClone(whole);
    const count = runScheduledTriggers(whole, NOW);
    const loaded = await loadJobs({ src: memorySource(traps), office: snapshotOf(traps, 1) });
    const scoped = structuredClone(loaded);
    const dedupeUsed = (k: string) => Object.values(traps.notifications).some((n) => n.dedupeKey === k);
    expect(runScheduledTriggers(scoped, NOW, { dedupeUsed })).toBe(count);
    expect(changesOf(loaded, scoped)).toEqual(changesOf(wholeBefore, whole));
    const paper = Object.values(traps.tasks).find((t) => t.projectId === null && t.ownerId === null)!;
    // The task with no lead has nobody to remind; the licence task waits in review. A lead makes the reminder go.
    apply(traps, 'tasks.take', { taskId: paper.id }, paper.createdBy);
    const again = await loadJobs({ src: memorySource(traps), office: snapshotOf(traps, 1) });
    runScheduledTriggers(again, NOW, { dedupeUsed });
    expect(Object.values(again.notifications).filter((n) => n.targetId === paper.id).map((n) => [n.userId, n.trigger])).toEqual([[paper.createdBy, 'overdue']]);
  });
});

describe('repeating meetings on the scoped load (fbk_022, wave 3)', () => {
  const seriesOf = (state: State, title: string) => Object.values(state.meetings ?? {}).filter((m) => m.title === title).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  it('give the same answers as the whole office for the reads and the writes of a private series and a project series', async () => {
    const traps = office(seriesTraps);
    const calls = seriesSweep(traps);
    expect(calls.length).toBeGreaterThan(50);
    for (const [name, input, actor] of calls) {
      const run = await same(traps, name, input, actor);
      expect(run.outcome.error?.code, `${name} as ${actor}`).not.toBe('crash');
    }
  }, 30_000);

  it('the traps make a full private series with one meeting cancelled, and a daily series that stops at its last day', () => {
    const traps = office(seriesTraps);
    const priv = seriesOf(traps, SERIES_PRIVATE_TITLE);
    expect(priv.map((m) => m.startsAt.slice(0, 10))).toEqual(['2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
    expect(priv.map((m) => m.status)).toEqual(['scheduled', 'scheduled', 'cancelled', 'scheduled', 'scheduled', 'scheduled', 'scheduled', 'scheduled']);
    const open = seriesOf(traps, SERIES_PROJECT_TITLE);
    expect(open.map((m) => m.startsAt.slice(0, 10))).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
  });

  it('meetings.update and meetings.cancel with the scope "later" load the later meetings of the series, and the person who does not see the series gets not_found', async () => {
    const traps = office(seriesTraps);
    const priv = seriesOf(traps, SERIES_PRIVATE_TITLE);
    const organizer = priv[0].organizerId;
    const update = await same(traps, 'meetings.update', { id: priv[3].id, where: 'Room 7', scope: 'later' }, organizer);
    expect(update.outcome.error).toBeUndefined();
    // The fourth meeting and the four after it change; the third is cancelled and the first two are earlier.
    const updated = (Array.isArray(update.changes) ? update.changes.find((c) => c.table === 'meetings')?.updated : []) as string[];
    expect([...updated].sort()).toEqual(priv.slice(3).map((m) => m.id).sort());
    const cancel = await same(traps, 'meetings.cancel', { id: priv[3].id, scope: 'later' }, organizer);
    // The cancel records the last day on every meeting of the series, the earlier ones too (owner, 2026-10-23): all 8 change.
    expect((Array.isArray(cancel.changes) ? cancel.changes.find((c) => c.table === 'meetings')?.updated : []) as string[]).toHaveLength(8);
    for (const outsider of [ADMIN, 'usr_003', 'usr_002']) {
      for (const [name, input] of [
        ['meetings.update', { id: priv[3].id, where: 'No', scope: 'later' }], ['meetings.cancel', { id: priv[3].id, scope: 'later' }], ['meetings.extend', { seriesId: priv[0].seriesId }],
      ] as const) {
        const run = await same(traps, name, input, outsider);
        const expectedId = name === 'meetings.extend' ? priv[0].seriesId : priv[3].id;
        expect(run.outcome.error, `${name} as ${outsider}`).toEqual({ code: 'not_found', message: `Meeting ${expectedId} does not exist.` });
        expect(run.changes, `${name} as ${outsider}`).toEqual([]);
      }
    }
  });

  it('meetings.delete loads the meeting and the cancelled ones after it, changes no last day, and an outsider gets not_found', async () => {
    const traps = office(seriesTraps);
    const priv = seriesOf(traps, SERIES_PRIVATE_TITLE);
    const organizer = priv[0].organizerId;
    const updated = (run: Run) => ((Array.isArray(run.changes) ? run.changes.find((c) => c.table === 'meetings')?.updated : []) ?? []) as string[];
    // The third meeting is cancelled by the trap and later meetings stay: a delete of it changes no last day.
    const middle = await same(traps, 'meetings.delete', { id: priv[2].id }, organizer);
    expect(middle.outcome.output).toEqual({ deleted: 1 });
    expect(deleted(middle, 'meetings')).toEqual([priv[2].id]);
    expect(updated(middle)).toEqual([]);
    // Cancel from the fourth on, then delete from the fourth on: the cancel recorded the last day, the delete changes no row but the deleted ones.
    apply(traps, 'meetings.cancel', { id: priv[3].id, scope: 'later' }, organizer);
    const tail = await same(traps, 'meetings.delete', { id: priv[3].id, scope: 'later' }, organizer);
    expect(tail.outcome.output).toEqual({ deleted: 5 });
    expect([...deleted(tail, 'meetings')].sort()).toEqual(priv.slice(3).map((m) => m.id).sort());
    expect(updated(tail)).toEqual([]);
    // The attendee reads the series but may not change it. An outsider and the Admin who is not invited read nothing.
    expect((await same(traps, 'meetings.delete', { id: priv[3].id }, priv[0].attendeeIds[0])).outcome.error).toMatchObject({ code: 'forbidden' });
    for (const outsider of [ADMIN, 'usr_003', 'usr_002']) {
      const run = await same(traps, 'meetings.delete', { id: priv[3].id, scope: 'later' }, outsider);
      expect(run.outcome.error, outsider).toEqual({ code: 'not_found', message: `Meeting ${priv[3].id} does not exist.` });
      expect(run.changes, outsider).toEqual([]);
    }
  });

  it('the Undo of a delete of a meeting with no project asks for the last copy: its people take it back on both loads, an outsider gets not_found', async () => {
    const traps = office(seriesTraps);
    const priv = seriesOf(traps, SERIES_PRIVATE_TITLE);
    const organizer = priv[0].organizerId;
    apply(traps, 'meetings.delete', { id: priv[2].id }, organizer, { story: 'cor_trap_delete' });
    expect(traps.meetings![priv[2].id]).toBeUndefined();
    for (const outsider of [ADMIN, 'usr_003']) {
      expect((await same(traps, 'events.undoStory', { correlationId: 'cor_trap_delete' }, outsider)).outcome.error, outsider).toMatchObject({ code: 'not_found' });
    }
    const own = await same(traps, 'events.undoStory', { correlationId: 'cor_trap_delete' }, organizer);
    expect(own.outcome.error).toBeUndefined();
    expect(inserted(own, 'meetings')).toEqual([priv[2].id]);
  });

  it('meetings.extend adds the missing meeting after the last one, as the same rows on both loads, and nothing more on a second call', async () => {
    const traps = office(seriesTraps);
    const priv = seriesOf(traps, SERIES_PRIVATE_TITLE);
    const organizer = priv[0].organizerId;
    const run = await same(traps, 'meetings.extend', { seriesId: priv[0].seriesId }, organizer);
    expect(run.outcome.output).toEqual({ added: 1 });
    expect(inserted(run, 'meetings')).toHaveLength(1);
    expect(docs(run, 'meetings')[0]).toMatchObject({
      title: SERIES_PRIVATE_TITLE, seriesId: priv[0].seriesId, startsAt: '2026-12-06T09:00:00.000+03:00', endsAt: '2026-12-06T10:00:00.000+03:00', organizerId: organizer,
      attendeeIds: ['usr_006'], status: 'scheduled', rev: 1,
    });
    // The attendee reads the series but may not change it, so the call refuses on both loads (review 2026-10-20).
    expect((await same(traps, 'meetings.extend', { seriesId: priv[0].seriesId }, 'usr_006')).outcome.error).toMatchObject({ code: 'forbidden' });
    // A series that is full gets nothing: the 8 meetings of a new series are all ahead.
    const full = office((state) => apply(state, 'meetings.create', { kind: 'meeting', title: 'Full', startsAt: '2026-10-11T09:00:00+03:00', repeat: { every: 'week', until: null } }, 'usr_004'));
    const made = Object.values(full.meetings!)[0];
    expect((await same(full, 'meetings.extend', { seriesId: made.id }, 'usr_004')).outcome.output).toEqual({ added: 0 });
    // The daily series ends at its last day: nothing to add after 2026-10-22 (the 8 meetings made reach 2026-10-21, so one day is left).
    const open = seriesOf(traps, SERIES_PROJECT_TITLE);
    const daily = await same(traps, 'meetings.extend', { seriesId: open[0].seriesId }, open[0].organizerId);
    expect(daily.outcome.output).toEqual({ added: 1 });
    expect(docs(daily, 'meetings')[0]).toMatchObject({ startsAt: '2026-10-22T10:00:00.000+03:00' });
  });
});

describe('meetings (fbk_022, owner 2026-10-19)', () => {
  it('the writes on the traps give the same answer on the scoped load: the people succeed, the outsider and the Admin who is not invited get not_found', async () => {
    const traps = trapOffice(seed);
    const writes = meetingWrites(traps);
    expect(writes.length).toBeGreaterThan(8);
    const hidden = Object.values(traps.meetings!).find((m) => m.projectId === null && m.attendeeIds.length > 0 && m.createdBy === m.organizerId)!;
    for (const [name, input, actor] of writes) {
      const run = await same(traps, name, input, actor);
      const id = (input as { id?: string }).id;
      if (id === hidden.id && actor !== hidden.organizerId && !hidden.attendeeIds.includes(actor)) {
        expect(run.outcome.error, `${name} as ${actor}`).toEqual({ code: 'not_found', message: `Meeting ${hidden.id} does not exist.` });
      }
    }
  });

  it('meetings.list loads only the window and the meetings that the person may see, and not the private meeting of other people', async () => {
    const traps = trapOffice(seed);
    const [privateOne, privateTwo, projectOne] = Object.values(traps.meetings!);
    const loadedFor = async (actor: string, input: Record<string, unknown>) => {
      const { whole, loaded } = await runBoth(traps, 'meetings.list', input, actor, { now: NOW, correlationId: 'cor_test' });
      expect(whole.outcome.error).toBeUndefined();
      return { loaded: Object.keys(loaded.meetings ?? {}).sort(), rows: (whole.outcome.output as { id: string }[]).map((row) => row.id) };
    };
    // The organizer and the attendee of the first private meeting read it, with their own project meetings.
    expect(await loadedFor(privateOne.organizerId, { from: '2026-10-04', to: '2026-10-10' })).toEqual({ loaded: [privateOne.id], rows: [privateOne.id] });
    expect((await loadedFor(privateOne.attendeeIds[0], { from: '2026-10-04', to: '2026-10-10' })).rows).toEqual([privateOne.id]);
    // The Admin is on no private meeting: the project meeting of "not mine" only, and nothing else is loaded.
    expect(await loadedFor(ADMIN, { from: '2026-10-04', to: '2026-10-10', projectId: 'prj_001', mine: false })).toEqual({ loaded: [projectOne.id], rows: [projectOne.id] });
    expect(await loadedFor(ADMIN, { from: '2026-10-04', to: '2026-10-10' })).toEqual({ loaded: [], rows: [] });
    // The window: a day with no meeting loads no row, and a day after the last one loads none.
    expect(await loadedFor(privateTwo.organizerId, { from: '2026-10-08', to: '2026-10-09' })).toEqual({ loaded: [], rows: [] });
    // The agent of the organizer reads what its person reads.
    expect(await loadedFor(OFFICE_AGENT, { from: '2026-10-04', to: '2026-10-10' })).toEqual(await loadedFor('usr_005', { from: '2026-10-04', to: '2026-10-10' }));
  });

  it('events.list holds the events of a meeting with no project for its people only, the Admin who is not invited too, on both loads', async () => {
    const traps = trapOffice(seed);
    const [privateOne, privateTwo] = Object.values(traps.meetings!);
    const events = Object.values(traps.events).filter((e) => e.officeMeetingId !== undefined);
    // The third private meeting is the ended one of the meeting file trap (wave 2): usr_004 and usr_006, no one else.
    const ended = Object.values(traps.meetings!).find((m) => m.title === ENDED_MEETING_TITLE)!;
    expect([...new Set(events.map((e) => e.officeMeetingId))].sort()).toEqual([privateOne.id, privateTwo.id, ended.id].sort());
    const ids = async (actor: string) => ((await same(traps, 'events.list', { limit: 500 }, actor)).outcome.output as { event: { id: string } }[]).map((row) => row.event.id);
    const mine = events.find((e) => e.officeMeetingId === privateOne.id)!.id;
    expect(await ids(privateOne.organizerId)).toContain(mine);
    expect(await ids(privateOne.attendeeIds[0])).toContain(mine);
    for (const outsider of [ADMIN, 'usr_003', 'usr_002']) {
      for (const event of events) expect(await ids(outsider), `${outsider} ${event.id}`).not.toContain(event.id);
    }
    // The agent of the organizer of the second meeting reads what its person reads.
    expect(await ids(OFFICE_AGENT)).toEqual(await ids(privateTwo.organizerId));
    expect(await ids(OFFICE_AGENT)).toContain(events.find((e) => e.officeMeetingId === privateTwo.id)!.id);
  });

  it('the Undo of a meeting event asks for the meeting of the event: a person who is not in it gets not_found on both loads', async () => {
    const traps = trapOffice(seed);
    const [privateOne] = Object.values(traps.meetings!);
    const created = Object.values(traps.events).find((e) => e.verb === 'meeting.created' && e.targetId === privateOne.id)!;
    for (const outsider of [ADMIN, 'usr_003']) {
      const run = await same(traps, 'events.undo', { eventId: created.id }, outsider);
      expect(run.outcome.error, outsider).toMatchObject({ code: 'not_found' });
      const story = await same(traps, 'events.undoStory', { correlationId: created.correlationId }, outsider);
      expect(story.outcome.error, outsider).toMatchObject({ code: 'not_found' });
    }
    const own = await same(traps, 'events.undo', { eventId: created.id }, privateOne.organizerId);
    expect(own.outcome.error).toBeUndefined();
    expect(deleted(own, 'meetings')).toEqual([privateOne.id]);
  });

  it('the jobs load brings the meetings that start within the hour, so their people get the reminder, and no other meeting', async () => {
    const state = office();
    const at = new Date('2026-10-04T06:00:00Z');
    const plan = (title: string, startsAt: string, actor: string, more: Record<string, unknown> = {}) =>
      (apply(state, 'meetings.create', { kind: 'meeting', title, startsAt, attendeeIds: ['usr_004'], ...more }, actor) as { id: string }).id;
    // 09:00 Riyadh is the time of the run. The first starts in 20 minutes, the second in 45, the third in 2 hours, the fourth is over.
    const soon = plan('Soon', '2026-10-04T09:20:00+03:00', 'usr_003');
    const later = plan('Later today', '2026-10-04T09:45:00+03:00', 'usr_003', { projectId: null });
    plan('Far', '2026-10-04T11:00:00+03:00', 'usr_003');
    plan('Over', '2026-10-04T08:00:00+03:00', 'usr_003');
    const cancelled = plan('Cancelled', '2026-10-04T09:30:00+03:00', 'usr_003');
    apply(state, 'meetings.cancel', { id: cancelled }, 'usr_003');
    const whole = structuredClone(state);
    const wholeBefore = structuredClone(whole);
    const count = runScheduledTriggers(whole, at);
    const loaded = await loadJobs({ src: memorySource(state), office: snapshotOf(state, 1), now: at });
    expect(Object.keys(loaded.meetings ?? {}).sort()).toEqual([soon, later].sort());
    const scoped = structuredClone(loaded);
    const dedupeUsed = (k: string) => Object.values(state.notifications).some((n) => n.dedupeKey === k);
    expect(runScheduledTriggers(scoped, at, { dedupeUsed })).toBe(count);
    expect(changesOf(loaded, scoped)).toEqual(changesOf(wholeBefore, whole));
    const reminders = Object.values(scoped.notifications).filter((n) => n.trigger === 'meeting_soon');
    // Only the first meeting is inside the 30 minutes of the reminder; the second is loaded and waits for a later run.
    expect(reminders.map((n) => [n.targetId, n.userId]).sort()).toEqual([[soon, 'usr_003'], [soon, 'usr_004']]);
  });

  it('meetings.list keeps a meeting at 23:30 Riyadh on its own day on both loads', async () => {
    const state = office();
    const maker = 'usr_003';
    apply(state, 'meetings.create', { kind: 'meeting', title: 'Late call', startsAt: '2026-10-06T23:30:00+03:00' }, maker);
    apply(state, 'meetings.create', { kind: 'meeting', title: 'Early call', startsAt: '2026-10-07T00:10:00+03:00' }, maker);
    const day = async (from: string) => ((await same(state, 'meetings.list', { from, to: from }, maker)).outcome.output as { title: string }[]).map((row) => row.title);
    expect(await day('2026-10-06')).toEqual(['Late call']);
    expect(await day('2026-10-07')).toEqual(['Early call']);
  });

  it('meetings.get brings the Tracker line that the meeting names, so the detail is the same on both loads, and no minutes task is left', async () => {
    const state = office();
    const maker = 'usr_003';
    const made = apply(state, 'meetings.create', { kind: 'client', title: 'Review', projectId: 'prj_001', startsAt: '2026-10-06T10:00:00+03:00' }, state.projects.prj_001.leaderId!) as { id: string };
    const entry = Object.values(state.tracker!)[0];
    Object.assign(state.meetings![made.id], { trackerEntryId: entry.id });
    const run = await same(state, 'meetings.get', { id: made.id }, maker);
    expect(run.outcome.output).toMatchObject({ minutesTask: null, minutesBy: null, trackerEntry: { id: entry.id } });
  });

  it('meetings.settle makes the same Tracker line on both loads, writes nothing before the end, and reads a hidden meeting as missing', async () => {
    const state = office();
    const leader = state.projects.prj_001.leaderId!;
    const made = apply(state, 'meetings.create', { kind: 'client', title: 'Review', projectId: 'prj_001', startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: ['usr_003'] }, leader) as { id: string };
    const hidden = apply(state, 'meetings.create', { kind: 'meeting', title: 'Private talk', startsAt: '2026-10-06T12:00:00+03:00', attendeeIds: ['usr_003'] }, 'usr_004') as { id: string };
    // Before the end: the answer holds no mark and no row changes.
    const early = await same(state, 'meetings.settle', { id: made.id }, leader, { now: new Date('2026-10-06T06:59:00Z') });
    expect(early.outcome.output).toEqual({ settledAt: null, trackerEntryId: null });
    expect(inserted(early, 'tracker')).toEqual([]);
    // After the end: the mark and one Tracker line, with the same id on both loads.
    const after = new Date('2026-10-06T08:00:00Z');
    const run = await same(state, 'meetings.settle', { id: made.id }, leader, { now: after });
    const result = run.outcome.output as { settledAt: string; trackerEntryId: string };
    expect(result.settledAt).toBe('2026-10-06T11:00:00.000+03:00');
    expect(inserted(run, 'tracker')).toEqual([result.trackerEntryId]);
    expect(docs(run, 'tracker')[0]).toMatchObject({ type: 'meeting', auto: 'meeting', meetingId: made.id, minutes: null, peopleIds: [leader, 'usr_003'] });
    // A meeting with no project gets the mark only, for its people. The Admin who is not invited and an outsider get not_found.
    const mark = await same(state, 'meetings.settle', { id: hidden.id }, 'usr_003', { now: after });
    expect(mark.outcome.output).toMatchObject({ trackerEntryId: null });
    expect(inserted(mark, 'tracker')).toEqual([]);
    for (const outsider of [ADMIN, 'usr_002']) {
      const refused = await same(state, 'meetings.settle', { id: hidden.id }, outsider, { now: after });
      expect(refused.outcome.error, outsider).toEqual({ code: 'not_found', message: `Meeting ${hidden.id} does not exist.` });
    }
  });

  it('meetings.saveMinutes gives the same answer on both loads for a Tracker line and for a meeting with no project, and loads only the meeting, its line and its files', async () => {
    const traps = trapOffice(seed);
    const find = (title: string) => Object.values(traps.meetings!).find((m) => m.title === title)!;
    const line = find(ENDED_PROJECT_MEETING_TITLE);
    const solo = find(ENDED_MEETING_TITLE);
    const team = find(ENDED_TEAM_MEETING_TITLE);
    const loadedFor = async (id: string, actor: string, text: string, fileIds: string[] = []) => {
      const { whole, scoped, loaded } = await runBoth(traps, 'meetings.saveMinutes', { id, text, fileIds }, actor, { now: NOW, correlationId: 'cor_test' });
      expect(scoped).toEqual(whole);
      expect(whole.outcome.error).toBeUndefined();
      return { whole, loaded };
    };
    // A project meeting: the minutes change on the Tracker line, and nothing of the meeting row changes.
    const lined = await loadedFor(line.id, line.organizerId, 'Changed on the line');
    expect(docs(lined.whole, 'tracker').map((doc) => (doc.minutes as { text: string }).text)).toEqual(['Changed on the line']);
    expect(Object.keys(lined.loaded.meetings ?? {})).toEqual([line.id]);
    expect(Object.keys(lined.loaded.tracker ?? {})).toEqual([line.trackerEntryId]);
    expect(deleted(lined.whole, 'tracker')).toEqual([]);
    // A team meeting of a project and a meeting with no project: the minutes change on the meeting.
    for (const [meeting, actor] of [[team, 'usr_003'], [solo, solo.attendeeIds[0]]] as const) {
      const done = await loadedFor(meeting.id, actor, 'Changed on the meeting', meeting === solo ? [MEETING_FILE_ID] : []);
      expect(docs(done.whole, 'meetings').map((doc) => (doc.minutes as { text: string }).text)).toEqual(['Changed on the meeting']);
      expect(Object.keys(done.loaded.meetings ?? {})).toEqual([meeting.id]);
      expect(inserted(done.whole, 'tracker')).toEqual([]);
    }
    // The meeting file reaches the scoped load with its meeting, and an outsider and the Admin who is not invited read the meeting as missing.
    for (const outsider of [ADMIN, 'usr_002']) {
      const run = await same(traps, 'meetings.saveMinutes', { id: solo.id, text: 'Try', fileIds: [] }, outsider);
      expect(run.outcome.error, outsider).toEqual({ code: 'not_found', message: `Meeting ${solo.id} does not exist.` });
    }
  });

  it('projects.delete takes the meetings of the project and their notices, and leaves a meeting with no project', async () => {
    const traps = trapOffice(seed);
    const run = await same(traps, 'projects.delete', { id: 'prj_001', confirm: true }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
    // The client meeting of the traps, and the two that ended with minutes (wave 2): all go with the project, and the private ones stay.
    const ofProject = Object.values(traps.meetings!).filter((m) => m.projectId === 'prj_001').map((m) => m.id);
    expect(ofProject.length).toBeGreaterThan(1);
    expect(deleted(run, 'meetings').sort()).toEqual(ofProject.sort());
  });
});

describe('the file rows of a group message (fbk_011, security review 2026-10-18)', () => {
  it('chats.messages: the scoped load brings the office task of a file, so its people keep the row and every other reader loses it', async () => {
    const traps = trapOffice(seed);
    const task = Object.values(traps.tasks).find((t) => t.projectId === null && t.ownerId !== null)!;
    const lead = task.ownerId as string;
    const version = { letter: 'A', blobKey: 'blob_990', mimeType: 'application/pdf', size: 10, uploadedBy: lead, uploadedAt: '2026-10-03T12:00:00.000+03:00' };
    traps.files.fil_990 = { id: 'fil_990', projectId: null, stageId: null, taskId: task.id, name: 'Licence-scan.pdf', versions: [version] };
    const group = addGroupConversation(traps, 'Licence team', ADMIN, [ADMIN, lead, 'usr_003'], '2026-10-03T09:00:00.000+03:00');
    // The chat rules keep an office file out of a message, so the test plants the message.
    traps.messages.msg_990 = {
      id: 'msg_990', conversationId: group.id, authorId: lead, actingForId: lead, body: 'The scan.', mentions: [], fileIds: ['fil_990'],
      createdAt: '2026-10-03T12:00:00.000+03:00', editedAt: null,
    };
    const rows = async (actor: string) => {
      const run = await same(traps, 'chats.messages', { conversationId: group.id }, actor);
      return (run.outcome.output as { messages: { message: { id: string; fileIds: string[] }; files: unknown[] }[] }).messages.find((m) => m.message.id === 'msg_990')!;
    };
    for (const actor of [lead, ADMIN]) expect((await rows(actor)).files, actor).toEqual([{ id: 'fil_990', name: 'Licence-scan.pdf', mimeType: 'application/pdf' }]);
    const hidden = await rows('usr_003');
    expect(hidden.files).toEqual([]);
    expect(hidden.message.fileIds).toEqual([]);
  });
});

describe('tasks with no lead (owner, 2026-10-05)', () => {
  it('takes the lead off, lists, takes and gives back a task with the same answer as the whole office', async () => {
    const state = office();
    const leader = state.projects.prj_001.leaderId!;
    const member = Object.values(state.members).find((m) => m.projectId === 'prj_001' && m.userId !== leader)!.userId;
    const task = todo(state, 'prj_001')[0];
    const off = await same(state, 'tasks.update', { id: task.id, patch: { ownerId: null } }, leader);
    expect(off.outcome.error).toBeUndefined();
    apply(state, 'tasks.update', { id: task.id, patch: { ownerId: null } }, leader);
    const listed = await same(state, 'tasks.list', { projectId: 'prj_001', filter: 'no_lead', activeProjectsOnly: false }, member);
    expect((listed.outcome.output as { task: Task }[]).map((row) => row.task.id)).toEqual([task.id]);
    await same(state, 'tasks.list', { filter: 'no_lead' }, ADMIN);
    await same(state, 'tasks.get', { id: task.id }, member);
    const refused = await same(state, 'tasks.complete', { id: task.id }, leader);
    expect(refused.outcome.error).toMatchObject({ code: 'invalid_input', message: 'This task has no lead. Give it a lead first.' });
    const took = await same(state, 'tasks.take', { taskId: task.id }, member);
    expect(took.outcome.output).toMatchObject({ task: { ownerId: member } });
    await same(state, 'dashboard.get', {}, ADMIN);
  });
});

describe('the changes that the Dashboard reads (performance audit DB-5)', () => {
  it('reads only the changes to in_review of a task in review, with the same answer and review day as the whole office', async () => {
    const state = office();
    const leader = state.projects.prj_001.leaderId!;
    const stageId = state.projects.prj_001.currentStageId;
    const member = Object.values(state.members).find((m) => m.projectId === 'prj_001' && m.userId !== leader)!.userId;
    const day = (d: string) => ({ now: new Date(`${d}T06:00:00Z`) });
    const task = (apply(state, 'tasks.create', { projectId: 'prj_001', stageId, title: 'Review me', ownerId: member }, leader, day('2026-09-20')) as { task: Task }).task;
    apply(state, 'tasks.update', { id: task.id, patch: { needsReview: true, title: 'Review me now' } }, leader, day('2026-09-21'));
    apply(state, 'tasks.move', { id: task.id, status: 'in_progress' }, member, day('2026-09-22'));
    apply(state, 'tasks.move', { id: task.id, status: 'todo' }, member, day('2026-09-23'));
    apply(state, 'tasks.complete', { id: task.id }, member, { ...day('2026-09-24'), story: 'cor_sent_first' });
    // The first send to review is undone, so the review day is the day of the second send.
    const first = Object.values(state.events).find((e) => e.correlationId === 'cor_sent_first' && e.targetId === task.id)!;
    apply(state, 'events.undo', { eventId: first.id }, member, day('2026-09-25'));
    apply(state, 'tasks.update', { id: task.id, patch: { title: 'Review me again' } }, member, day('2026-09-26'));
    apply(state, 'tasks.complete', { id: task.id }, member, day('2026-09-27'));
    expect(state.tasks[task.id].status).toBe('in_review');

    for (const actor of [...humans(), 'usr_009']) await same(state, 'dashboard.get', {}, actor);
    const { loaded } = await runBoth(state, 'dashboard.get', {}, ADMIN, { now: NOW, correlationId: 'cor_test' });
    const changes = Object.values(state.events).filter((e) => e.targetType === 'task' && e.targetId === task.id);
    const read = Object.values(loaded.events).filter((e) => e.targetId === task.id);
    expect(changes.length).toBeGreaterThanOrEqual(7);
    expect(read.map((e) => e.id).sort()).toEqual(changes.filter((e) => (e.after as { status?: string } | null)?.status === 'in_review').map((e) => e.id).sort());
    expect(read.length).toBeLessThan(changes.length);
    expect(read.find((e) => e.id === first.id)?.undoneBy).toBeTruthy();
  });
});

describe('the chat badge and the bell (performance audit DB-6, DB-M1, DB-M2)', () => {
  type ChatRow = { id: string; unread: number };
  type View = { notification: Notification; gone: boolean };
  const keysOf = (rows: Record<string, unknown>) => Object.values(rows).map((row) => Object.keys(row as object));
  let state: State;
  let actors: string[];
  beforeAll(() => {
    state = badgeTraps(trapOffice(seed));
    actors = [...humans(), ...Object.values(state.users).filter((u) => u.kind === 'agent').map((u) => u.id)];
  });

  it('holds each case: a tie with the own last comment, a helper, an agent that made the task, a hidden notice, a gone task, a report', async () => {
    const leader = state.projects.prj_001.leaderId!;
    const tie = Object.values(state.comments).filter((c) => c.body === `Same stamp by ${leader}`);
    const member = Object.values(state.comments).find((c) => c.body.startsWith('Same stamp by') && c.authorId !== leader)!.authorId;
    const licence = Object.values(state.tasks).find((t) => t.projectId === null && t.ownerId === 'usr_005')!;
    const hall = Object.values(state.tasks).find((t) => t.title === AGENT_MADE_TASK)!;
    expect(hall.createdBy).toBe(OFFICE_AGENT);
    const rows = async (actor: string) => (await same(state, 'chats.list', {}, actor)).outcome.output as ChatRow[];
    expect((await rows(member)).find((row) => row.id === tie[0].targetId)?.unread).toBe(1);
    expect((await rows('usr_006')).find((row) => row.id === licence.id)?.unread).toBe(1);
    expect((await rows('usr_005')).find((row) => row.id === hall.id)?.unread).toBe(1);
    expect((await rows('usr_006')).find((row) => row.id === hall.id)).toBeUndefined();
    // A chat and a thread that the leader read and marked unread (fbk_028): one each. The leader wrote the last comment of the thread.
    const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    expect((await rows(leader)).find((row) => row.id === room.id)?.unread).toBe(1);
    expect((await rows(leader)).find((row) => row.id === tie[0].targetId)?.unread).toBe(1);
    const views = async (actor: string) => (await same(state, 'notifications.list', {}, actor)).outcome.output as View[];
    expect((await views('usr_006')).find((v) => v.notification.targetId === hall.id)).toMatchObject({ gone: true });
    expect((await views(member)).some((v) => v.notification.targetType === 'task' && v.gone && !state.tasks[v.notification.targetId])).toBe(true);
    expect((await views(ADMIN)).find((v) => v.notification.targetType === 'feedback' && v.notification.trigger === 'feedback_sent')).toMatchObject({ gone: false });
  });

  it('the badge gives every person and agent the number of the whole office, with no message and only the picked fields', async () => {
    for (const actor of actors) {
      await same(state, 'chats.unreadCount', {}, actor);
      const { loaded } = await runBoth(state, 'chats.unreadCount', {}, actor, { now: NOW, correlationId: 'cor_test' });
      expect(Object.keys(loaded.messages), actor).toEqual([]);
      for (const keys of keysOf(loaded.tasks)) expect(keys.every((key) => (THREAD_TASK_FIELDS as readonly string[]).includes(key)), `${actor} ${keys}`).toBe(true);
      for (const keys of keysOf(loaded.comments)) expect(keys.every((key) => (THREAD_COMMENT_FIELDS as readonly string[]).includes(key)), `${actor} ${keys}`).toBe(true);
    }
    // The list keeps the newest message of each chat and the whole rows, for its previews.
    const { loaded } = await runBoth(state, 'chats.list', {}, ADMIN, { now: NOW, correlationId: 'cor_test' });
    expect(Object.keys(loaded.messages).length).toBeGreaterThan(0);
    expect(Object.values(loaded.comments).every((c) => typeof c.body === 'string')).toBe(true);
  });

  it('the bell gives every person and agent the numbers of the whole office, from the picked fields of its targets', async () => {
    for (const actor of actors) {
      await same(state, 'notifications.count', {}, actor);
      const { loaded } = await runBoth(state, 'notifications.count', {}, actor, { now: NOW, correlationId: 'cor_test' });
      for (const keys of keysOf(loaded.tasks)) expect(keys.every((key) => (INBOX_TASK_FIELDS as readonly string[]).includes(key)), `${actor} ${keys}`).toBe(true);
      for (const keys of [...keysOf(loaded.updates), ...keysOf(loaded.feedback ?? {})]) expect(keys, actor).toEqual(['id']);
    }
    // The writes of the bell keep whole rows.
    const notice = Object.values(state.notifications).find((n) => n.targetType === 'task' && state.tasks[n.targetId])!;
    for (const name of ['notifications.markRead', 'notifications.markUnread'] as const) {
      const { loaded } = await runBoth(state, name, { ids: [notice.id] }, notice.userId, { now: NOW, correlationId: 'cor_test' });
      expect(loaded.tasks[notice.targetId]).toEqual(state.tasks[notice.targetId]);
    }
  });

  it('the badge and the bell keep their numbers for a chat with no read mark and a thread read up to a tie', async () => {
    const marked = structuredClone(state);
    for (const key of Object.keys(marked.chatReads)) if (marked.chatReads[key].userId === 'usr_005') delete marked.chatReads[key];
    const leader = marked.projects.prj_001.leaderId!;
    const tie = Object.values(marked.comments).find((c) => c.body === `Same stamp by ${leader}`)!;
    marked.chatReads[chatReadKey(tie.targetId, leader)] = { conversationId: tie.targetId, userId: leader, lastReadAt: tie.createdAt };
    for (const actor of ['usr_005', leader]) {
      const count = await same(marked, 'chats.unreadCount', {}, actor);
      expect((count.outcome.output as { unread: number }).unread, actor).toBeGreaterThan(0);
      await same(marked, 'notifications.count', {}, actor);
    }
  });
});

describe('the notices of requests and bugs (review 2026-10-07)', () => {
  type View = { notification: Notification; gone: boolean; target: string };
  const reportViews = (run: Run) => (run.outcome.output as View[]).filter((view) => view.notification.targetType === 'feedback');

  it('the Inbox reads the report of a notice: live while it stands, gone after the Undo of its send, as on the whole office', async () => {
    const state = office((s) => {
      s.users.usr_002.systemRole = 'admin';
    });
    const before = (await same(state, 'notifications.count', {}, 'usr_002')).outcome.output as { unread: number; badge: number };
    // Reem sends a report, so Hala and Faisal hold its notice, and the report stands.
    const live = apply(state, 'feedback.send', { kind: 'bug', message: 'The board does not scroll.' }, 'usr_003', { story: 'cor_fb_live', prepared: { shots: [] } }) as { id: string };
    // Hala sends a report and takes it back while Faisal is not an Admin. His hidden notice stays, and then he is an Admin again.
    const gone = apply(state, 'feedback.send', { kind: 'feature', message: 'Taken back' }, ADMIN, { story: 'cor_fb_gone', prepared: { shots: [] } }) as { id: string };
    state.users.usr_002.systemRole = 'member';
    apply(state, 'events.undoStory', { correlationId: 'cor_fb_gone' }, ADMIN);
    state.users.usr_002.systemRole = 'admin';
    expect(state.feedback?.[gone.id]).toBeUndefined();
    const views = reportViews(await same(state, 'notifications.list', {}, 'usr_002'));
    expect(views).toHaveLength(2);
    expect(views.find((view) => view.notification.targetId === live.id)).toMatchObject({ gone: false, target: 'The board does not scroll.' });
    expect(views.find((view) => view.notification.targetId !== live.id)).toMatchObject({ gone: true, target: '' });
    // Only the live report counts on the bell.
    const count = await same(state, 'notifications.count', {}, 'usr_002');
    expect(count.outcome.output).toEqual({ unread: before.unread + 2, badge: before.badge + 1 });
    expect(reportViews(await same(state, 'notifications.list', {}, ADMIN)).map((view) => view.gone)).toEqual([false]);
  });

  it('the Undo of the last done of done, open, done takes back only its own done notice on both loads', async () => {
    const state = office();
    const report = apply(state, 'feedback.send', { kind: 'bug', message: 'Broken' }, 'usr_003', { story: 'cor_fb_send', prepared: { shots: [] } }) as { id: string };
    for (const status of ['done', 'new', 'done']) apply(state, 'feedback.setStatus', { id: report.id, status }, ADMIN, { story: 'cor_fb_s' });
    const done = Object.values(state.notifications).filter((n) => n.trigger === 'feedback_done').map((n) => n.id);
    expect(done).toHaveLength(2);
    const last = Object.values(state.events).filter((e) => e.correlationId === 'cor_fb_s').sort((a, b) => b.seq - a.seq)[0];
    const run = await same(state, 'events.undo', { eventId: last.id }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
    expect(deleted(run, 'notifications')).toEqual([done[1]]);
  });
});

describe('the sub-company filter of projects.list (fbk_007)', () => {
  it('gives the same projects on the server path as on the whole office, with and without the filter', async () => {
    const state = office((s) => {
      const sub = (name: string) => ({ name, nameAr: `${name} ar`, logo: null, createdBy: ADMIN, createdAt: '2026-10-18T09:00:00.000+03:00' });
      s.subCompanies = { sub_001: { id: 'sub_001', ...sub('Vado') }, sub_002: { id: 'sub_002', ...sub('Bunah') } };
      s.projects.prj_001.subCompanyId = 'sub_001';
      s.projects.prj_002.subCompanyId = 'sub_002';
    });
    const run = await same(state, 'projects.list', { status: 'all', subCompanyId: 'sub_001' }, ADMIN);
    expect(run.outcome.error).toBeUndefined();
    expect((run.outcome.output as { project: { id: string } }[]).map((row) => row.project.id)).toEqual(['prj_001']);
    const all = await same(state, 'projects.list', { status: 'all' }, ADMIN);
    expect((all.outcome.output as unknown[]).length).toBe(Object.keys(state.projects).length);
  });
});

describe('the office report (owner, 2026-10-18, fbk_016)', () => {
  it('gives the same answer on the scoped load as on the whole office, for the Admin, a week and a year', async () => {
    const week = await same(office(), 'reports.office', { period: 'week', start: '2026-09-28' }, ADMIN);
    expect(week.outcome.error).toBeUndefined();
    expect((week.outcome.output as { period: unknown }).period).toEqual({ kind: 'week', from: '2026-09-27', to: '2026-10-03' });
    const year = await same(office(), 'reports.office', { period: 'year', start: '2026-01-01' }, ADMIN);
    expect(year.outcome.error).toBeUndefined();
  });

  it('gives the same refusal on both loads for a Member, and loads no payment for a person without the payment right', async () => {
    const member = await same(office(), 'reports.office', { period: 'month' }, 'usr_003');
    expect(member.outcome.error?.code).toBe('forbidden');
    const state = office((s) => {
      s.users.usr_004.systemRole = 'management';
      s.settings.roles = { rights: { management: ['report.office'] } };
    });
    const { whole, scoped, loaded } = await runBoth(state, 'reports.office', { period: 'week', start: '2026-09-28' }, 'usr_004', { now: NOW, correlationId: 'cor_test' });
    expect(scoped).toEqual(whole);
    expect((whole.outcome.output as { money: unknown; gaps: unknown }).money).toBeNull();
    expect((whole.outcome.output as { gaps: unknown }).gaps).toBeNull();
    expect(Object.keys(loaded.payments ?? {})).toEqual([]);
  });

  it('counts the review of a project task and no review of an office task, on the scoped load as on the whole office', async () => {
    const reviewsDone = (run: Run) => (run.outcome.output as { people: { user: { id: string }; reviewsDone: number }[] })
      .people.find((row) => row.user.id === 'usr_002')?.reviewsDone;
    const week = { period: 'week', start: '2026-10-04' };
    const base = reviewsDone(await same(office(), 'reports.office', week, ADMIN));
    const review = (n: number, projectId: string | null): Event => ({
      id: `evt_${n}`, seq: n, projectId, actorId: 'usr_002', actorKind: 'human', actingForId: 'usr_002', correlationId: `cor_review_${n}`,
      verb: 'task.approved', targetType: 'task', targetId: `tsk_${n}`, before: null, after: null, createdAt: '2026-10-04T10:00:00.000+03:00',
      undoneBy: null, ...(projectId === null ? { officeTaskId: `tsk_${n}` } : {}),
    });
    const state = office((s) => {
      // An office task, approved by usr_002: the report never counts it (owner, 2026-10-06).
      s.events.evt_901 = review(901, null);
      // A project task, approved by usr_002: the report counts it.
      s.events.evt_902 = review(902, 'prj_001');
    });
    const run = await same(state, 'reports.office', week, ADMIN);
    expect(reviewsDone(run)).toBe((base ?? 0) + 1);
  });
});

describe('the money of the Dashboard follows the office rights of a custom role (fbk_014)', () => {
  it('loads no payment for a role with the people right, and the payments not yet received for a role with the payment right', async () => {
    const state = office((s) => {
      s.settings.roles = {
        custom: [
          { id: 'rol_001', name: 'Planner', nameAr: 'مخطط', rights: ['people.manage'] },
          { id: 'rol_002', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] },
        ],
      };
      s.users.usr_003.roleId = 'rol_001';
      s.users.usr_004.roleId = 'rol_002';
    });
    const open = Object.values(state.payments ?? {}).filter((payment) => payment.receivedOn === null).map((payment) => payment.id).sort();
    expect(open.length).toBeGreaterThan(0);
    const planner = await runBoth(state, 'dashboard.get', {}, 'usr_003', { now: NOW, correlationId: 'cor_test' });
    expect(planner.scoped).toEqual(planner.whole);
    expect(Object.keys(planner.loaded.payments ?? {})).toEqual([]);
    const cashier = await runBoth(state, 'dashboard.get', {}, 'usr_004', { now: NOW, correlationId: 'cor_test' });
    expect(cashier.scoped).toEqual(cashier.whole);
    expect(Object.keys(cashier.loaded.payments ?? {}).sort()).toEqual(open);
  });
});

describe('the money of the loaders follows the office rights of Management (fbk_014, security review 2026-10-18)', () => {
  const MANAGEMENT = 'usr_010';
  const paymentsOf = (loaded: State) => Object.keys(loaded.payments ?? {});

  it('loads the payments for Management while the office gives it the payment right, and none once the office takes it away', async () => {
    const given = await runBoth(office(), 'dashboard.get', {}, MANAGEMENT, { now: NOW, correlationId: 'cor_test' });
    expect(paymentsOf(given.loaded).length).toBeGreaterThan(0);
    const state = office((s) => {
      s.settings.roles = { rights: { management: ['people.manage', 'report.office'] } };
    });
    for (const [name, input] of [['dashboard.get', {}], ['reports.office', { period: 'year', start: '2026-01-01' }]] as const) {
      const taken = await runBoth(state, name, input, MANAGEMENT, { now: NOW, correlationId: 'cor_test' });
      expect(taken.scoped, name).toEqual(taken.whole);
      expect(taken.whole.outcome.error, name).toBeUndefined();
      expect(paymentsOf(taken.loaded), name).toEqual([]);
    }
    const report = await runBoth(state, 'reports.office', { period: 'year', start: '2026-01-01' }, MANAGEMENT, { now: NOW, correlationId: 'cor_test' });
    expect((report.whole.outcome.output as { money: unknown }).money).toBeNull();
  });

  it('hides the payment events from Management without the payment right, with the same list on both loads', async () => {
    // The control: the Accounting person makes a payment, and Management reads its event while it holds the payment right.
    const base = office((s) => {
      apply(s, 'payments.create', { projectId: 'prj_001', name: 'Zebra milestone', amount: 5000, dueDate: '2026-10-20' }, 'usr_011');
    });
    const control = await runBoth(base, 'events.list', { limit: 500, targetType: 'payment' }, MANAGEMENT, { now: NOW, correlationId: 'cor_test' });
    expect((control.whole.outcome.output as unknown[]).length).toBeGreaterThan(0);
    const state = structuredClone(base);
    state.settings.roles = { rights: { management: ['people.manage', 'report.office'] } };
    const { whole, scoped } = await runBoth(state, 'events.list', { limit: 500 }, MANAGEMENT, { now: NOW, correlationId: 'cor_test' });
    expect(scoped).toEqual(whole);
    const rows = whole.outcome.output as { event: { targetType: string } }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.event.targetType === 'payment')).toBe(false);
  });
});

describe('the Dashboard, Search and money switches on the loaders (role rights version 2)', () => {
  const MEMBER = 'usr_003';
  const withMemberOff = (off: string[]) => office((s) => {
    s.settings.roles = { off: { member: off as never } };
  });

  it('refuses dashboard.get on both loads and loads no task for a Member without dashboard.view', async () => {
    const { scoped, whole, loaded } = await runBoth(withMemberOff(['dashboard.view', 'workload.view']), 'dashboard.get', {}, MEMBER, { now: NOW, correlationId: 'cor_test' });
    expect(scoped).toEqual(whole);
    expect(whole.outcome.error).toMatchObject({ code: 'forbidden' });
    expect(Object.keys(loaded.tasks ?? {})).toEqual([]);
  });

  it('gives the same empty workload on both loads when only workload.view is off, and still loads the tasks of the numbers', async () => {
    const { scoped, whole, loaded } = await runBoth(withMemberOff(['workload.view']), 'dashboard.get', {}, MEMBER, { now: NOW, correlationId: 'cor_test' });
    expect(scoped).toEqual(whole);
    const workload = (whole.outcome.output as { workload: { rows: unknown[]; unassigned: unknown; weeks: unknown[] } }).workload;
    expect([workload.rows, workload.unassigned, workload.weeks.length]).toEqual([[], null, 4]);
    expect(Object.keys(loaded.tasks ?? {}).length).toBeGreaterThan(0);
  });

  it('refuses search.query on both loads and loads no task or file for a Member without search.use', async () => {
    const { scoped, whole, loaded } = await runBoth(withMemberOff(['search.use']), 'search.query', { text: 'riser' }, MEMBER, { now: NOW, correlationId: 'cor_test' });
    expect(scoped).toEqual(whole);
    expect(whole.outcome.error).toMatchObject({ code: 'forbidden' });
    expect([Object.keys(loaded.tasks ?? {}), Object.keys(loaded.files ?? {})]).toEqual([[], []]);
  });

  it('loads the open payments for a Member who holds payment.view, and shows the payment events to that Member', async () => {
    const state = office((s) => {
      s.settings.roles = { rights: { member: ['payment.view'] } };
    });
    const run = await runBoth(state, 'dashboard.get', {}, MEMBER, { now: NOW, correlationId: 'cor_test' });
    expect(run.scoped).toEqual(run.whole);
    expect((run.whole.outcome.output as { money: unknown }).money).not.toBeNull();
    expect(Object.keys(run.loaded.payments ?? {}).length).toBeGreaterThan(0);
  });
});
