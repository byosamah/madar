import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { trackerCalls } from './tracker';
import { historyCalls } from './history';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...taskCalls, ...trackerCalls, ...historyCalls };

// Hala is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Omar (usr_004) is outside.
function world() {
  const t = testApi(calls);
  const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: '2026-09-30T09:00:00.000+03:00' };
  t.store.state.files.fil_001 = { id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Survey.pdf', versions: [version] };
  return t;
}

const QUESTION = { projectId: 'prj_001', type: 'message', direction: 'in', title: 'Can the lobby move?', waiting: 'us' } as const;
const REPLY_BY = { userId: 'usr_003', dueDate: '2026-10-04' };

async function withReply(t: ReturnType<typeof world>, extra = {}) {
  t.as('usr_002');
  const row = await t.api.call('tracker.log', { ...QUESTION, replyBy: REPLY_BY, ...extra });
  const task = t.store.state.tasks[row.entry.replyTaskId!];
  return { entry: row.entry, task };
}

describe('tracker.log with replyBy', () => {
  it('opens the task "Reply: <title>" for that person, in the current stage, due that day, linked both ways', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    expect(task).toMatchObject({
      title: 'Reply: Can the lobby move?', ownerId: 'usr_003', stageId: 'stg_002', dueDate: '2026-10-04', status: 'todo', projectId: 'prj_001',
      trackerEntryId: entry.id, needsReview: false,
    });
    expect(entry.replyTaskId).toBe(task.id);
    const [row] = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(row.replyTask).toMatchObject({ id: task.id, status: 'todo', dueDate: '2026-10-04', owner: { id: 'usr_003' } });
    expect(Object.values(t.store.state.notifications).some((n) => n.userId === 'usr_003' && n.trigger === 'task_assigned')).toBe(true);
  });

  it('lets a team member open the task for a colleague', async () => {
    const t = world();
    t.as('usr_003');
    const row = await t.api.call('tracker.log', { ...QUESTION, replyBy: { userId: 'usr_002', dueDate: '2026-10-05' } });
    expect(t.store.state.tasks[row.entry.replyTaskId!]).toMatchObject({ ownerId: 'usr_002', createdBy: 'usr_003' });
  });

  it('refuses a reply for an entry that does not wait for our reply, and a person outside the team', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('tracker.log', { ...QUESTION, waiting: null, replyBy: REPLY_BY })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'reply_needs_waiting_us' } });
    await expect(t.api.call('tracker.log', { ...QUESTION, direction: 'out', waiting: 'client', replyBy: REPLY_BY })).rejects.toMatchObject({ details: { reason: 'reply_needs_waiting_us' } });
    await expect(t.api.call('tracker.log', { ...QUESTION, replyBy: { ...REPLY_BY, userId: 'usr_004' } })).rejects.toMatchObject({ details: { reason: 'reply_not_on_team' } });
    await expect(t.api.call('tracker.log', { ...QUESTION, replyBy: { ...REPLY_BY, userId: 'usr_099' } })).rejects.toMatchObject({ code: 'not_found' });
    expect(Object.keys(t.store.state.tracker ?? {})).toHaveLength(0);
    expect(Object.keys(t.store.state.tasks)).toHaveLength(0);
  });

  it('refuses an outsider', async () => {
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('tracker.log', { ...QUESTION, replyBy: REPLY_BY })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is undone with the entry in one Undo, even for a team member', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tracker.log', { ...QUESTION, replyBy: { userId: 'usr_002', dueDate: '2026-10-05' } }, { correlationId: 'cor_log' });
    await t.api.call('events.undoStory', { correlationId: 'cor_log' });
    expect(Object.keys(t.store.state.tracker ?? {})).toHaveLength(0);
    expect(Object.keys(t.store.state.tasks)).toHaveLength(0);
  });
});

describe('tracker.assignReply', () => {
  it('opens the task for an open entry that waits for our reply', async () => {
    const t = world();
    t.as('usr_003');
    const { entry } = await t.api.call('tracker.log', QUESTION);
    expect(entry.replyTaskId).toBeUndefined();
    const row = await t.api.call('tracker.assignReply', { id: entry.id, userId: 'usr_002', dueDate: '2026-10-06' });
    expect(row.replyTask).toMatchObject({ status: 'todo', dueDate: '2026-10-06', owner: { id: 'usr_002' } });
    expect(t.store.state.tasks[row.entry.replyTaskId!]).toMatchObject({ title: 'Reply: Can the lobby move?', trackerEntryId: entry.id });
  });

  it('refuses a second task while the first is open, a closed entry, an entry for the client and an outsider', async () => {
    const t = world();
    const { entry } = await withReply(t);
    await expect(t.api.call('tracker.assignReply', { id: entry.id, userId: 'usr_002', dueDate: '2026-10-06' })).rejects.toMatchObject({ details: { reason: 'reply_exists' } });
    const closed = await t.api.call('tracker.log', QUESTION);
    await t.api.call('tracker.close', { id: closed.entry.id });
    await expect(t.api.call('tracker.assignReply', { id: closed.entry.id, userId: 'usr_002', dueDate: '2026-10-06' })).rejects.toMatchObject({ details: { reason: 'reply_not_open' } });
    const toClient = await t.api.call('tracker.log', { ...QUESTION, direction: 'out', waiting: 'client' });
    await expect(t.api.call('tracker.assignReply', { id: toClient.entry.id, userId: 'usr_002', dueDate: '2026-10-06' })).rejects.toMatchObject({ details: { reason: 'reply_not_open' } });
    const open = await t.api.call('tracker.log', QUESTION);
    await expect(t.api.call('tracker.assignReply', { id: open.entry.id, userId: 'usr_004', dueDate: '2026-10-06' })).rejects.toMatchObject({ details: { reason: 'reply_not_on_team' } });
    t.as('usr_004');
    await expect(t.api.call('tracker.assignReply', { id: open.entry.id, userId: 'usr_003', dueDate: '2026-10-06' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('opens a new task when the old reply task is deleted', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    await t.api.call('tasks.delete', { id: task.id });
    const [row] = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(row.entry.waiting).toBe('us');
    expect(row.entry.closedAt).toBeNull();
    expect(row.replyTask).toBeNull();
    const again = await t.api.call('tracker.assignReply', { id: entry.id, userId: 'usr_002', dueDate: '2026-10-06' });
    expect(again.replyTask).toMatchObject({ owner: { id: 'usr_002' } });
  });
});

describe('finishing the reply task', () => {
  it('logs the reply to the client with the same files and closes the loop, as one story', async () => {
    const t = world();
    const { entry, task } = await withReply(t, { fileIds: ['fil_001'] });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: task.id }, { correlationId: 'cor_done' });
    expect(t.store.state.tasks[task.id].status).toBe('done');
    const closed = t.store.state.tracker![entry.id];
    expect(closed).toMatchObject({ closedBy: 'usr_003' });
    expect(closed.closedAt).not.toBeNull();
    const entries = Object.values(t.store.state.tracker!);
    const reply = entries.find((e) => e.auto === 'reply')!;
    expect(reply).toMatchObject({
      type: 'message', direction: 'out', title: 'Reply: Can the lobby move?', fileIds: ['fil_001'], waiting: null, createdBy: 'usr_003', date: '2026-09-30',
    });
    expect(entries).toHaveLength(2);
    const story = Object.values(t.store.state.events).filter((e) => e.correlationId === 'cor_done').map((e) => e.verb).sort();
    expect(story).toEqual(['task.status_changed', 'tracker.closed', 'tracker.logged']);
  });

  it('does the same when the task is moved to Done, and when a leader approves it', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    t.as('usr_003');
    await t.api.call('tasks.move', { id: task.id, status: 'done' });
    expect(t.store.state.tracker![entry.id].closedAt).not.toBeNull();
    expect(Object.values(t.store.state.tracker!).filter((e) => e.auto === 'reply')).toHaveLength(1);

    const second = world();
    const asked = await withReply(second);
    second.store.state.tasks[asked.task.id].needsReview = true;
    second.as('usr_003');
    await second.api.call('tasks.complete', { id: asked.task.id });
    expect(second.store.state.tasks[asked.task.id].status).toBe('in_review');
    expect(second.store.state.tracker![asked.entry.id].closedAt).toBeNull();
    second.as('usr_002');
    await second.api.call('tasks.approve', { id: asked.task.id });
    expect(second.store.state.tracker![asked.entry.id]).toMatchObject({ closedBy: 'usr_002' });
    expect(Object.values(second.store.state.tracker!).filter((e) => e.auto === 'reply')).toHaveLength(1);
  });

  it('one Undo of the finish undoes the task, the close and the reply', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: task.id }, { correlationId: 'cor_done' });
    await t.api.call('events.undoStory', { correlationId: 'cor_done' });
    expect(t.store.state.tasks[task.id]).toMatchObject({ status: 'todo', completedAt: null });
    expect(t.store.state.tracker![entry.id]).toMatchObject({ closedAt: null, closedBy: null });
    expect(Object.values(t.store.state.tracker!).filter((e) => e.auto === 'reply')).toHaveLength(0);
  });

  it('logs nothing when the loop was already closed or ended, and for a task with no entry', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    await t.api.call('tracker.update', { id: entry.id, waiting: null });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: task.id });
    expect(Object.values(t.store.state.tracker!)).toHaveLength(1);
    t.as('usr_002');
    const plain = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Plain task', ownerId: 'usr_003' });
    t.as('usr_003');
    await t.api.call('tasks.move', { id: plain.task.id, status: 'done' });
    expect(Object.values(t.store.state.tracker!)).toHaveLength(1);
  });
});

describe('closing the loop by hand', () => {
  it('finishes the reply task too, and logs no second reply', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    t.as('usr_003');
    await t.api.call('tracker.close', { id: entry.id }, { correlationId: 'cor_close' });
    expect(t.store.state.tasks[task.id]).toMatchObject({ status: 'done' });
    expect(t.store.state.tasks[task.id].completedAt).not.toBeNull();
    expect(Object.values(t.store.state.tracker!)).toHaveLength(1);
    expect(t.store.state.tracker![entry.id].closedBy).toBe('usr_003');
    await t.api.call('events.undoStory', { correlationId: 'cor_close' });
    expect(t.store.state.tasks[task.id]).toMatchObject({ status: 'todo', completedAt: null });
    expect(t.store.state.tracker![entry.id].closedAt).toBeNull();
  });

  it('works when the task already waits for review, and when it is already done', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    t.store.state.tasks[task.id].status = 'in_review';
    await t.api.call('tracker.close', { id: entry.id });
    expect(t.store.state.tasks[task.id].status).toBe('done');

    const second = world();
    const asked = await withReply(second);
    second.store.state.tasks[asked.task.id].status = 'done';
    await second.api.call('tracker.close', { id: asked.entry.id });
    expect(second.store.state.tasks[asked.task.id].status).toBe('done');
  });
});

describe('deleting', () => {
  it('leaves the entry open with no task when the reply task is deleted', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    await t.api.call('tasks.delete', { id: task.id });
    expect(t.store.state.tracker![entry.id]).toMatchObject({ waiting: 'us', closedAt: null });
    // The entry can be closed by hand with nothing to finish.
    await t.api.call('tracker.close', { id: entry.id });
    expect(t.store.state.tracker![entry.id].closedAt).not.toBeNull();
  });

  it('unlinks the task when the entry is deleted, keeps the task, and brings the link back with Undo', async () => {
    const t = world();
    const { entry, task } = await withReply(t);
    await t.api.call('tracker.delete', { id: entry.id }, { correlationId: 'cor_del' });
    expect(t.store.state.tasks[task.id]).toBeDefined();
    expect(t.store.state.tasks[task.id].trackerEntryId).toBeNull();
    // Finishing the task logs no reply, because it answers nothing now.
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: task.id });
    expect(Object.keys(t.store.state.tracker ?? {})).toHaveLength(0);

    const second = world();
    const asked = await withReply(second);
    await second.api.call('tracker.delete', { id: asked.entry.id }, { correlationId: 'cor_del' });
    await second.api.call('events.undoStory', { correlationId: 'cor_del' });
    expect(second.store.state.tracker![asked.entry.id].replyTaskId).toBe(asked.task.id);
    expect(second.store.state.tasks[asked.task.id].trackerEntryId).toBe(asked.entry.id);
  });
});
