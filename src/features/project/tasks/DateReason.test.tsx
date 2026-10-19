import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    expect(within(ask).getByText("Madar shows your reason in the task's Conversation as a quiet line.")).toBeInTheDocument();
    const save = within(ask).getByRole('button', { name: 'Save dates' });
    expect(save).toBeDisabled();
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-20');
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The client sent the survey late');
    await userEvent.click(save);
    await waitFor(() => expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-26'));
    expect(messagesOf(store.state)).toHaveLength(before + 1);

    await userEvent.click(within(sheet).getByRole('tab', { name: /^Conversation/ }));
    // fbk_027: the reason is a quiet line of the thread, not a message of a person: no avatar, no reactions, the person in the words.
    const message = (await within(sheet).findByText(/ changed the due date: .*The client sent the survey late/)).closest('li') as HTMLElement;
    expect(within(message).getByText('Due date: from Tue 20 Oct to Mon 26 Oct')).toBeInTheDocument();
    expect(message.querySelector('bdi.font-semibold')).toBeNull();
    expect(within(message).queryByRole('button', { name: /^React with/ })).toBeNull();
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
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep the old date' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Why do the dates change?' })).toBeNull());
    expect(within(sheet).getByLabelText('Due date')).toHaveValue('2026-10-20');
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-20');
    expect(messagesOf(store.state)).toHaveLength(before);
  });

  it('shows the message Madar posts when a task it waited for finished late, with no menu', async () => {
    await renderApp(`${TASK}&thread=1`, (state) => {
      staticTask(state);
      state.comments.cmt_900 = {
        id: 'cmt_900', targetType: 'task', targetId: 'tsk_007', authorId: state.tasks.tsk_007.ownerId!, body: 'Survey finished 4 working days late',
        reactions: emptyReactions(), fileIds: [], createdAt: '2026-09-30T08:00:00.000Z', editedAt: null,
        dates: { from: { startDate: '2026-10-01', dueDate: '2026-10-07' }, to: { startDate: '2026-10-07', dueDate: '2026-10-13' }, byTaskId: 'tsk_001', byTaskTitle: 'Survey', lateDays: 4 },
      };
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const message = (await within(sheet).findByText(/^Madar moved the dates: .*Survey.* finished 4 working days late\.$/)).closest('li') as HTMLElement;
    expect(within(message).getByText('Start date: from Thu 1 Oct to Wed 7 Oct')).toBeInTheDocument();
    expect(within(message).getByText('Due date: from Wed 7 Oct to Tue 13 Oct')).toBeInTheDocument();
    expect(within(message).queryByRole('button', { name: 'Actions for this comment' })).toBeNull();
  });

  // fbk_027: the reason of a task that opens again is a quiet line too, and nobody edits it from the thread.
  it('shows the reason of a reopening as a quiet line, with no menu', async () => {
    await renderApp(`${TASK}&thread=1`, (state) => {
      staticTask(state);
      state.comments.cmt_901 = {
        id: 'cmt_901', targetType: 'task', targetId: 'tsk_007', authorId: state.tasks.tsk_007.ownerId!, body: 'Client comments, 12 Oct',
        reactions: emptyReactions(), fileIds: [], createdAt: '2026-09-30T08:00:00.000Z', editedAt: null, kind: 'reopened',
      };
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const message = (await within(sheet).findByText(/ reopened the task: .*Client comments, 12 Oct/)).closest('li') as HTMLElement;
    expect(within(message).queryByRole('button', { name: 'Actions for this comment' })).toBeNull();
    expect(within(message).queryByRole('button', { name: /^React with/ })).toBeNull();
  });
});

/** Moves the due date of Stair details to 26 Oct and returns the reason sheet. */
async function moveDue(sheet: HTMLElement, day = '2026-10-26') {
  const due = within(sheet).getByLabelText('Due date');
  fireEvent.change(due, { target: { value: day } });
  fireEvent.blur(due);
  return screen.findByRole('dialog', { name: 'Why do the dates change?' });
}
const reasonGone = () => waitFor(() => expect(screen.queryByRole('dialog', { name: 'Why do the dates change?' })).toBeNull());

// The reason is a required step: a press outside does not close it. Escape and Cancel put the date back, and the typed reason
// stays for that task, so the next move opens with it (audit 2026-10-03, F-16).
describe('the reason sheet keeps the typed reason (audit 2026-10-03, F-16)', () => {
  it('stays open on a press outside', async () => {
    await renderApp(TASK, staticTask);
    const ask = await moveDue(await screen.findByRole('dialog', { name: 'Stair details' }));
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'Client asked to add the north plot');
    // Radix waits 0 ms before it listens for presses.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(screen.getByRole('dialog', { name: 'Why do the dates change?' })).toBeInTheDocument();
    expect(within(ask).getByRole('textbox', { name: 'Reason' })).toHaveValue('Client asked to add the north plot');
  });

  it('keeps the old date on Escape, and fills the next move with the typed reason', async () => {
    const { store } = await renderApp(TASK, staticTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const ask = await moveDue(sheet);
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'Client asked to add the north plot');
    await userEvent.keyboard('{Escape}');
    await reasonGone();
    expect(within(sheet).getByLabelText('Due date')).toHaveValue('2026-10-20');
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-20');
    const again = await moveDue(sheet);
    expect(within(again).getByRole('textbox', { name: 'Reason' })).toHaveValue('Client asked to add the north plot');
  });

  it('keeps the typed reason after Keep the old date, and after the task panel closes', async () => {
    const { router } = await renderApp(TASK, staticTask);
    const ask = await moveDue(await screen.findByRole('dialog', { name: 'Stair details' }));
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'Client asked to add the north plot');
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep the old date' }));
    await reasonGone();
    await act(() => router.navigate('/projects/prj_001?tab=tasks'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
    await act(() => router.navigate(TASK));
    const again = await moveDue(await screen.findByRole('dialog', { name: 'Stair details' }));
    expect(within(again).getByRole('textbox', { name: 'Reason' })).toHaveValue('Client asked to add the north plot');
  });

  it('says "Keep the old dates" when both dates move', async () => {
    // A dynamic task takes its due date from the start, so a new start moves both dates.
    await renderApp(TASK, (state) => {
      Object.assign(state.tasks.tsk_007, { startDate: '2026-10-04', schedule: 'dynamic', durationDays: 5, dueDate: '2026-10-08' });
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const start = within(sheet).getByLabelText('Start date');
    fireEvent.change(start, { target: { value: '2026-10-11' } });
    fireEvent.blur(start);
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    expect(within(ask).getByText(/^Start date: from/)).toBeInTheDocument();
    expect(within(ask).getByText(/^Due date: from/)).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Keep the old dates' })).toBeInTheDocument();
  });

  it('starts the next move empty after Save dates', async () => {
    const { store } = await renderApp(TASK, staticTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const ask = await moveDue(sheet);
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The client sent the survey late');
    await userEvent.click(within(ask).getByRole('button', { name: 'Save dates' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-26'));
    await reasonGone();
    const again = await moveDue(sheet, '2026-10-28');
    expect(within(again).getByRole('textbox', { name: 'Reason' })).toHaveValue('');
  });
});
