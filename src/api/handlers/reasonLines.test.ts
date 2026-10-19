import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { emptyReactions } from '../contract/entities';
import type { State } from '../store';
import { lineKindOf } from '../../lib/commentLine';
import { setNow } from '../../lib/dates';
import { makeTask, makeWorld, NOW, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/**
 * fbk_027 (owner, 2026-10-19): the reason of a date change and of a reopening is a quiet line of the task thread, never a message
 * of a person. The line never counts as an unread message and never waits for a reply.
 * The world: prj_001 is led by usr_002 (Faisal). usr_003 (Sara) leads the task tsk_001 and is on the team.
 */
function world(overrides: Parameters<typeof makeTask>[0] = {}): State {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', startDate: '2026-10-01', dueDate: '2026-10-10', ...overrides });
  state.counters.tsk = 1;
  return state;
}

const textsOf = async (api: ReturnType<typeof testApi<typeof calls>>['api'], taskId = 'tsk_001') =>
  (await api.call('comments.list', { targetType: 'task', targetId: taskId })).map((view) => [view.kind, view.comment.body]);

describe('lineKindOf', () => {
  const move = { from: { startDate: '2026-10-01', dueDate: '2026-10-10' }, to: { startDate: '2026-10-01', dueDate: '2026-10-12' } };
  it('reads a message, a due date reason, a start date reason, a Madar shift and a reopening', () => {
    expect(lineKindOf({})).toBe('message');
    expect(lineKindOf({ dates: move })).toBe('due_date');
    expect(lineKindOf({ dates: { from: move.from, to: { startDate: '2026-10-03', dueDate: '2026-10-10' } } })).toBe('start_date');
    expect(lineKindOf({ dates: { from: move.from, to: { startDate: '2026-10-03', dueDate: '2026-10-12' } } })).toBe('due_date');
    expect(lineKindOf({ dates: { ...move, byTaskId: 'tsk_002', lateDays: 2 } })).toBe('shifted');
    expect(lineKindOf({ kind: 'reopened' })).toBe('reopened');
  });
});

describe('the kind of a comment in comments.list (fbk_027)', () => {
  it('tells a message from the lines of a date move, a Madar shift and a reopening', async () => {
    const state = world();
    const t = testApi(calls, state);
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'I start tomorrow.' });
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-14' }, dateReason: 'The client sent the survey late' });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-04' }, dateReason: 'The site opens later' });
    const rows = await textsOf(t.api);
    expect(rows).toEqual([['message', 'I start tomorrow.'], ['due_date', 'The client sent the survey late'], ['start_date', 'The site opens later']]);
  });

  it('reads a comment of Madar (a shift after a late prerequisite) as shifted', async () => {
    const state = world();
    state.comments.cmt_900 = {
      id: 'cmt_900', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_003', body: 'Survey finished 2 working days late', reactions: emptyReactions(),
      fileIds: [], createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
      dates: { from: { startDate: '2026-10-01', dueDate: '2026-10-10' }, to: { startDate: '2026-10-05', dueDate: '2026-10-14' }, byTaskId: 'tsk_002', byTaskTitle: 'Survey', lateDays: 2 },
    };
    const t = testApi(calls, state);
    t.as('usr_002');
    expect((await textsOf(t.api))[0][0]).toBe('shifted');
  });
});

describe('the reopening reason is a line of the thread (fbk_027)', () => {
  it('adds one reopened line with the reason, and one Undo takes it back with the reopening', async () => {
    const state = world({ status: 'done', completedAt: '2026-10-08T10:00:00.000+03:00' });
    const t = testApi(calls, state);
    t.as('usr_002');
    const opened = await t.api.run('tasks.newVersion', { id: 'tsk_001', reason: 'Client comments, 12 Oct', startDate: '2026-10-11', schedule: 'static', dueDate: '2026-10-20' });
    expect(await textsOf(t.api)).toEqual([['reopened', 'Client comments, 12 Oct']]);
    expect(Object.values(t.store.state.comments)[0].kind).toBe('reopened');
    await t.api.call('events.undoStory', { correlationId: opened.storyId });
    expect(await textsOf(t.api)).toEqual([]);
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
  });
});

describe('a reason line never counts as unread or as waiting for a reply (fbk_027)', () => {
  const unread = async (t: ReturnType<typeof testApi<typeof calls>>, person: string) => {
    t.as(person);
    const rows = await t.api.call('chats.list', {});
    return { row: rows.find((chat) => chat.id === 'tsk_001'), badge: (await t.api.call('chats.unreadCount', {})).unread };
  };

  it('keeps a line out of the unread count, and shows it as the preview with its kind', async () => {
    const t = testApi(calls, world());
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-14' }, dateReason: 'The client sent the survey late' });
    const { row, badge } = await unread(t, 'usr_003');
    expect(row).toMatchObject({ unread: 0, preview: 'The client sent the survey late', previewKind: 'due_date' });
    expect(badge).toBe(0);
    // A message after the line counts, and the preview is the message again.
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please call me.' });
    const after = await unread(t, 'usr_003');
    expect(after.row).toMatchObject({ unread: 1, preview: 'Please call me.', previewKind: null });
    expect(after.badge).toBe(1);
  });

  it('keeps a line out of the list of threads that wait for a reply', async () => {
    const t = testApi(calls, world());
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-14' }, dateReason: 'The client sent the survey late' });
    t.as('usr_003');
    expect(await t.api.call('chats.waiting', {})).toEqual([]);
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please call me.' });
    t.as('usr_003');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).toEqual(['tsk_001']);
    // A line that follows the message does not hide it: the thread still waits for the reply of the lead.
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-16' }, dateReason: 'The client moved the meeting' });
    t.as('usr_003');
    const waiting = await t.api.call('chats.waiting', {});
    expect(waiting.map((row) => [row.id, row.body])).toEqual([['tsk_001', 'Please call me.']]);
  });

  it('does not let a line that I wrote hide the messages that wait for me', async () => {
    const t = testApi(calls, world());
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please call me.' });
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-14' }, dateReason: 'I need two more days' });
    const { row } = await unread(t, 'usr_003');
    expect(row?.unread).toBe(1);
    expect((await t.api.call('chats.waiting', {})).map((item) => item.id)).toEqual(['tsk_001']);
  });
});
