import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { taskCalls } from './tasks';
import { chatReadKey } from '../store';
import type { Comment } from '../contract/entities';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Date lines in the Inbox (owner, 2026-11-08: "only real messages lift it"). A quiet line of a to-do thread (a due date move, a start
 * date move, a shift of Madar, a reopening) no longer sets the time or the preview of the thread row. Only a message does, the same as the
 * quiet log lines of a group. A thread with only quiet lines keeps its newest line as its time, so it still sorts. Sara (usr_003) leads
 * tsk_001, Faisal (usr_002) leads the project.
 */
const calls = { ...chatCalls, ...contentCalls, ...projectCalls, ...taskCalls };
type World = ReturnType<typeof world>;

function world() {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003' });
  t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', title: 'Second job' });
  return t;
}

/** The time n minutes after NOW, as the stamp of a comment. */
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
let serial = 0;
/** A comment written straight into the state, so each test sets its own times. */
function put(t: World, taskId: string, authorId: string, body: string, minutes: number, extra: Partial<Comment> = {}) {
  serial += 1;
  const id = `cmt_8${String(serial).padStart(2, '0')}`;
  t.store.state.comments[id] = {
    id, targetType: 'task', targetId: taskId, authorId, body, reactions: { '👍': [], '✅': [], '👀': [] }, fileIds: [], createdAt: at(minutes), editedAt: null, ...extra,
  } as Comment;
  return id;
}
const MOVE = { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-12' } };
const START_MOVE = { from: { startDate: '2026-10-01', dueDate: '2026-10-10' }, to: { startDate: '2026-10-03', dueDate: '2026-10-10' } };
const rowOf = async (t: World, userId: string, id: string) => {
  t.as(userId);
  return (await t.api.call('chats.list', {})).find((row) => row.id === id);
};

describe('a quiet line never sets the time or the preview of a to-do thread (owner, 2026-11-08)', () => {
  it('keeps the time and the words of the last real message when a date line comes after it', async () => {
    const t = world();
    put(t, 'tsk_001', 'usr_002', 'Please fix the door schedule.', 10);
    put(t, 'tsk_001', 'usr_002', 'The reason of a date move.', 30, { dates: MOVE });
    const row = await rowOf(t, 'usr_003', 'tsk_001');
    expect(row).toMatchObject({ lastAt: at(10), preview: 'Please fix the door schedule.', previewKind: null });
  });

  it('does the same for a start date line, a shift of Madar and a reopening', async () => {
    const t = world();
    put(t, 'tsk_001', 'usr_002', 'A real message.', 10);
    put(t, 'tsk_001', 'usr_002', 'Start moved.', 20, { dates: START_MOVE });
    put(t, 'tsk_001', 'usr_002', 'Shifted by Madar.', 30, { dates: { ...MOVE, byTaskId: 'tsk_002', lateDays: 2 } });
    put(t, 'tsk_001', 'usr_002', 'It opens again.', 40, { kind: 'reopened' });
    expect(await rowOf(t, 'usr_003', 'tsk_001')).toMatchObject({ lastAt: at(10), preview: 'A real message.', previewKind: null });
  });

  it('sorts a thread by its newest message: a later date line does not lift it above a thread with a newer message', async () => {
    const t = world();
    put(t, 'tsk_001', 'usr_002', 'The older message.', 10);
    put(t, 'tsk_002', 'usr_002', 'The newer message.', 20);
    put(t, 'tsk_001', 'usr_002', 'A date move reason.', 40, { dates: MOVE });
    t.as('usr_003');
    const order = (await t.api.call('chats.list', {})).filter((row) => row.kind === 'task').map((row) => row.id);
    expect(order).toEqual(['tsk_002', 'tsk_001']);
  });

  it('lifts a thread when a real message comes after the line', async () => {
    const t = world();
    put(t, 'tsk_001', 'usr_002', 'The older message.', 10);
    put(t, 'tsk_002', 'usr_002', 'The newer message.', 20);
    put(t, 'tsk_001', 'usr_002', 'A date move reason.', 40, { dates: MOVE });
    put(t, 'tsk_001', 'usr_002', 'A real message at last.', 50);
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).filter((row) => row.kind === 'task').map((row) => row.id)).toEqual(['tsk_001', 'tsk_002']);
  });

  it('keeps the newest line as the time and the preview of a thread that holds only quiet lines, so it still sorts', async () => {
    const t = world();
    put(t, 'tsk_001', 'usr_002', 'Moved because of the survey.', 10, { dates: MOVE });
    put(t, 'tsk_001', 'usr_002', 'Moved again.', 30, { dates: MOVE });
    put(t, 'tsk_002', 'usr_002', 'A message.', 20);
    const row = await rowOf(t, 'usr_003', 'tsk_001');
    expect(row).toMatchObject({ lastAt: at(30), preview: 'Moved again.', previewKind: 'due_date' });
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).filter((r) => r.kind === 'task').map((r) => r.id)).toEqual(['tsk_001', 'tsk_002']);
  });

  it('does not bring an archived thread back for a line, and brings it back for a message (the archive follows the same time)', async () => {
    const t = world();
    put(t, 'tsk_001', 'usr_002', 'A real message.', 10);
    t.as('usr_003');
    t.store.state.chatReads[chatReadKey('tsk_001', 'usr_003')] = { conversationId: 'tsk_001', userId: 'usr_003', lastReadAt: at(11), archivedAt: at(15) };
    put(t, 'tsk_001', 'usr_002', 'A date line after the archive.', 30, { dates: MOVE });
    expect(await rowOf(t, 'usr_003', 'tsk_001')).toMatchObject({ archived: true, lastAt: at(10) });
    put(t, 'tsk_001', 'usr_002', 'A message after the archive.', 40);
    expect(await rowOf(t, 'usr_003', 'tsk_001')).toMatchObject({ archived: false, lastAt: at(40) });
  });

  it('leaves the unread number, the badge and the waiting list as they were: a line is never unread', async () => {
    const t = world();
    put(t, 'tsk_001', 'usr_002', 'A real message.', 10);
    put(t, 'tsk_001', 'usr_002', 'A date line.', 30, { dates: MOVE });
    expect(await rowOf(t, 'usr_003', 'tsk_001')).toMatchObject({ unread: 1 });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });
});
