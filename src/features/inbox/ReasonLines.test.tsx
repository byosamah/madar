import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { emptyReactions } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// fbk_027 (owner, 2026-10-19): the reason of a date change or of a reopening is a quiet line of the task thread, never the message
// of a person. Hala (usr_001) leads the clinic project; usr_006 writes in the thread.
const MOVE = { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-14' } };

function withThread(extra: (state: State, taskId: string) => void = () => undefined) {
  return (state: State) => {
    state.session.currentUserId = 'usr_001';
    const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!;
    task.title = 'Room finish schedule';
    for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
    state.comments.cmt_901 = {
      id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.', reactions: emptyReactions(), fileIds: [],
      createdAt: '2026-09-29T07:00:00.000+03:00', editedAt: null,
    };
    state.chatReads[`${task.id}:usr_001`] = { conversationId: task.id, userId: 'usr_001', lastReadAt: '2026-09-29T08:00:00.000+03:00' };
    extra(state, task.id);
  };
}
const line = (taskId: string, id: string, body: string, at: string, extra: object = {}) => (state: State) => {
  state.comments[id] = {
    id, targetType: 'task', targetId: taskId, authorId: 'usr_006', body, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null, ...extra,
  };
};

describe('a reason in the task thread of the Inbox (fbk_027)', () => {
  it('shows a due date reason as one quiet line, with no bubble and no name above it', async () => {
    const setup = withThread((state, taskId) => line(taskId, 'cmt_902', 'The client sent the survey late', '2026-09-30T08:00:00.000+03:00', { dates: MOVE })(state));
    const { store } = await renderApp('/inbox/' + (await taskIdOf(setup)), setup);
    expect(store.state.comments.cmt_902).toBeDefined();
    const sentence = await screen.findByText(/ changed the due date: .*The client sent the survey late/);
    const row = sentence.closest('li') as HTMLElement;
    // A line has the grey centered look of a group line: no bubble, no clock, no sender name.
    expect(row).toHaveClass('self-center');
    expect(row.querySelector('time')).toBeNull();
    expect(row.querySelector('bdi.font-semibold')).toBeNull();
    // The message before it stays a bubble of its person.
    const message = (await screen.findByText('The finish codes are ready.')).closest('li') as HTMLElement;
    expect(message.querySelector('time')).not.toBeNull();
    expect(within(row).getByText('Due date: from Sat 10 Oct to Wed 14 Oct')).toBeInTheDocument();
  });

  it('shows a reopening and a Madar shift as quiet lines too', async () => {
    const setup = withThread((state, taskId) => {
      line(taskId, 'cmt_902', 'Client comments, 12 Oct', '2026-09-30T08:00:00.000+03:00', { kind: 'reopened' })(state);
      line(taskId, 'cmt_903', 'Survey finished 2 working days late', '2026-09-30T09:00:00.000+03:00', { dates: { ...MOVE, byTaskId: 'tsk_001', byTaskTitle: 'Survey', lateDays: 2 } })(state);
    });
    await renderApp('/inbox/' + (await taskIdOf(setup)), setup);
    expect((await screen.findByText(/ reopened the to-do: .*Client comments, 12 Oct/)).closest('li')).toHaveClass('self-center');
    expect((await screen.findByText(/^Madar moved the dates: .*Survey.* finished 2 working days late\.$/)).closest('li')).toHaveClass('self-center');
  });

  it('shows the same short line as the preview of the thread, and counts no unread for it', async () => {
    const setup = withThread((state, taskId) => line(taskId, 'cmt_902', 'The client sent the survey late', '2026-09-30T08:00:00.000+03:00', { dates: MOVE })(state));
    await renderApp('/inbox', setup);
    const row = await screen.findByRole('link', { name: /Room finish schedule/ });
    // usr_006 wrote the message at 07:00 on 29 Sept and Hala read it at 08:00; the line came after and is no unread message.
    expect(within(row).getByText(/ changed the due date: .*The client sent the survey late/)).toBeInTheDocument();
    expect(within(row).queryByText(/^Unread/)).toBeNull();
    expect(row.textContent).not.toMatch(/\d+ unread/);
  });
});

/** The id of the task that the setup gives its thread to. */
async function taskIdOf(setup: (state: State) => void): Promise<string> {
  const { buildSeed } = await import('../../data/seed');
  const state = await buildSeed('2026-09-30', async () => undefined);
  setup(state);
  return Object.values(state.tasks).find((t) => t.title === 'Room finish schedule')!.id;
}
