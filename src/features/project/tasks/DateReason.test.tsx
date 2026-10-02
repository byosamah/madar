import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyReactions } from '../../../api/contract/entities';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const TASK = '/projects/prj_001?tab=tasks&task=tsk_007';

// Today in the tests is Wed 30 Sep 2026. Stair details starts on Sun 4 Oct and is due on Tue 20 Oct.
const staticTask = (state: State) => {
  Object.assign(state.tasks.tsk_007, { startDate: '2026-10-04', schedule: 'static', durationDays: null, dueDate: '2026-10-20' });
};
const messagesOf = (state: State) => Object.values(state.comments).filter((comment) => comment.targetId === 'tsk_007');

describe('a reason for a date change (owner, 2026-10-02)', () => {
  it('asks why the due date moves, shows the move, and posts the reason in the Conversation', async () => {
    const { store } = await renderApp(TASK, staticTask);
    const before = messagesOf(store.state).length;
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const due = within(sheet).getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2026-10-26' } });
    fireEvent.blur(due);

    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    expect(within(ask).getByText('Due date: from Tue 20 Oct to Mon 26 Oct')).toBeInTheDocument();
    expect(within(ask).getByText("Madar posts your reason in the task's Conversation.")).toBeInTheDocument();
    const save = within(ask).getByRole('button', { name: 'Save dates' });
    expect(save).toBeDisabled();
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-20');
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The client sent the survey late');
    await userEvent.click(save);
    await waitFor(() => expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-26'));
    expect(messagesOf(store.state)).toHaveLength(before + 1);

    await userEvent.click(within(sheet).getByRole('tab', { name: /^Conversation/ }));
    const message = (await within(sheet).findByText('The client sent the survey late')).closest('li') as HTMLElement;
    expect(within(message).getByText('Due date: from Tue 20 Oct to Mon 26 Oct')).toBeInTheDocument();
    await userEvent.click(within(message).getByRole('button', { name: 'Actions for this comment' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('does not offer the meeting reason outside a meeting', async () => {
    await renderApp(TASK, staticTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    fireEvent.change(within(sheet).getByLabelText('Due date'), { target: { value: '2026-10-26' } });
    fireEvent.blur(within(sheet).getByLabelText('Due date'));
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    expect(within(ask).queryByRole('button', { name: /Decided in the meeting/ })).toBeNull();
  });

  it('keeps the old date when the person cancels', async () => {
    const { store } = await renderApp(TASK, staticTask);
    const before = messagesOf(store.state).length;
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    fireEvent.change(within(sheet).getByLabelText('Due date'), { target: { value: '2026-10-26' } });
    fireEvent.blur(within(sheet).getByLabelText('Due date'));
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Why do the dates change?' })).toBeNull());
    expect(within(sheet).getByLabelText('Due date')).toHaveValue('2026-10-20');
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-20');
    expect(messagesOf(store.state)).toHaveLength(before);
  });

  it('shows the message Madar posts when a task it waited for finished late, with no menu', async () => {
    await renderApp(`${TASK}&thread=1`, (state) => {
      staticTask(state);
      state.comments.cmt_900 = {
        id: 'cmt_900', targetType: 'task', targetId: 'tsk_007', authorId: state.tasks.tsk_007.ownerId, body: 'Survey finished 4 working days late',
        reactions: emptyReactions(), fileIds: [], createdAt: '2026-09-30T08:00:00.000Z', editedAt: null,
        dates: { from: { startDate: '2026-10-01', dueDate: '2026-10-07' }, to: { startDate: '2026-10-07', dueDate: '2026-10-13' }, byTaskId: 'tsk_001', byTaskTitle: 'Survey', lateDays: 4 },
      };
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const message = (await within(sheet).findByText('Survey finished 4 working days late.')).closest('li') as HTMLElement;
    expect(within(message).getByText('Madar')).toBeInTheDocument();
    expect(within(message).getByText('Start date: from Thu 1 Oct to Wed 7 Oct')).toBeInTheDocument();
    expect(within(message).getByText('Due date: from Wed 7 Oct to Tue 13 Oct')).toBeInTheDocument();
    expect(within(message).queryByRole('button', { name: 'Actions for this comment' })).toBeNull();
  });
});
