import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { Task } from '../contract/entities';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

// The owner's rule (2026-10-02): a person who moves the dates of a task writes why, and the reason goes to the task's Conversation.
function world(overrides: Partial<Task> = {}) {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ startDate: '2026-10-04', dueDate: '2026-10-12', ...overrides });
  t.store.state.counters.tsk = 1;
  return t;
}

const needsReason = { code: 'invalid_input', details: { fields: ['dateReason'], reason: 'date_reason_needed' } };
const thread = async (t: ReturnType<typeof world>) => t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });

describe('a reason for a date change', () => {
  it('refuses to move the due date without a reason, and changes nothing', async () => {
    const t = world();
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-19' } })).rejects.toMatchObject(needsReason);
    expect(t.store.state.tasks.tsk_001.dueDate).toBe('2026-10-12');
    expect(await thread(t)).toHaveLength(0);
  });

  it('asks the leader, the team member who leads the task and the Admin alike', async () => {
    for (const userId of ['usr_001', 'usr_002', 'usr_003']) {
      const t = world();
      t.as(userId);
      await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-19' } })).rejects.toMatchObject(needsReason);
    }
  });

  it('asks for every move: the start date, an earlier date, a cleared date and a new duration', async () => {
    const t = world();
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-05' } })).rejects.toMatchObject(needsReason);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-08' } })).rejects.toMatchObject(needsReason);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: null } })).rejects.toMatchObject(needsReason);
    const dynamic = world({ schedule: 'dynamic', startDate: '2026-10-04', durationDays: 5, dueDate: '2026-10-08' });
    await expect(dynamic.api.call('tasks.update', { id: 'tsk_001', patch: { durationDays: 7 } })).rejects.toMatchObject(needsReason);
  });

  it('needs no reason for the first dates of a task, for the same date, or for a change that leaves the dates alone', async () => {
    const t = world({ startDate: null, dueDate: null });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-04', dueDate: '2026-10-12' } });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-12' } });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'Ground floor plan, rev A' } });
    expect(t.store.state.tasks.tsk_001).toMatchObject({ startDate: '2026-10-04', dueDate: '2026-10-12', title: 'Ground floor plan, rev A' });
    expect(await thread(t)).toHaveLength(0);
  });

  it('saves the date and posts the reason in the Conversation, in the name of the person who moved it', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-19' }, dateReason: '  The client sent the survey late. ' });
    expect(t.store.state.tasks.tsk_001.dueDate).toBe('2026-10-19');
    const [message, ...rest] = await thread(t);
    expect(rest).toHaveLength(0);
    expect(message.author.id).toBe('usr_003');
    expect(message.comment).toMatchObject({
      body: 'The client sent the survey late.',
      dates: { from: { startDate: '2026-10-04', dueDate: '2026-10-12' }, to: { startDate: '2026-10-04', dueDate: '2026-10-19' } },
    });
  });

  it('refuses a reason of spaces only', async () => {
    const t = world();
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-19' }, dateReason: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('takes the date and its message away together with one Undo', async () => {
    const t = world();
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-19' }, dateReason: 'Scope grew' }, { correlationId: 'story_d' });
    await t.api.call('events.undoStory', { correlationId: 'story_d' });
    expect(t.store.state.tasks.tsk_001.dueDate).toBe('2026-10-12');
    expect(await thread(t)).toHaveLength(0);
  });

  it('keeps the message: its author may fix the words, but nobody deletes it', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-19' }, dateReason: 'Scope grew' });
    const [message] = await thread(t);
    await t.api.call('comments.update', { id: message.comment.id, body: 'The scope grew.' });
    expect((await thread(t))[0].comment.body).toBe('The scope grew.');
    for (const userId of ['usr_003', 'usr_002', 'usr_001']) {
      t.as(userId);
      await expect(t.api.call('comments.delete', { id: message.comment.id })).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(await thread(t)).toHaveLength(1);
  });
});

describe('a date that Madar moves', () => {
  it('posts the move in the Conversation of the task that moved, with the task it waited for', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = makeTask({ status: 'in_progress', startDate: '2026-09-16', dueDate: '2026-09-25', title: 'Survey' });
    t.store.state.tasks.tsk_002 = makeTask({
      id: 'tsk_002', title: 'Site plan', schedule: 'dynamic', startDate: '2026-10-01', durationDays: 5, dueDate: '2026-10-07', prerequisiteIds: ['tsk_001'],
    });
    t.store.state.counters.tsk = 2;
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const messages = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_002' });
    expect(messages).toHaveLength(1);
    expect(messages[0].comment.dates).toMatchObject({
      from: { startDate: '2026-10-01', dueDate: '2026-10-07' }, to: { startDate: '2026-10-07', dueDate: '2026-10-13' },
      byTaskId: 'tsk_001', byTaskTitle: 'Survey', lateDays: 4,
    });
  });
});
