import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const TASK = '/projects/prj_001?tab=tasks&task=tsk_007';

// Today in the tests is Wed 30 Sep 2026. Stair details starts on Sun 4 Oct and is due on Tue 20 Oct.
const staticTask = (state: State) => {
  Object.assign(state.tasks.tsk_007, { startDate: '2026-10-04', schedule: 'static', durationDays: null, dueDate: '2026-10-20' });
};
const dynamicTask = (state: State) => {
  Object.assign(state.tasks.tsk_007, { startDate: '2026-10-04', schedule: 'dynamic', durationDays: 5, dueDate: '2026-10-08' });
};

describe('the start date and the two ways to time a task', () => {
  it('shows a start date, the switch and the due date for a static task', async () => {
    await renderApp(TASK, staticTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).getByLabelText('Start date')).toHaveValue('2026-10-04');
    expect(within(sheet).getByRole('radio', { name: 'Static: due date' })).toBeChecked();
    expect(within(sheet).getByRole('radio', { name: 'Dynamic: duration' })).not.toBeChecked();
    expect(within(sheet).getByText(/^Static: you set the start and the due date\./)).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Due date')).toHaveValue('2026-10-20');
    expect(within(sheet).queryByLabelText('Duration in working days')).toBeNull();
  });

  it('shows the duration and the due date in words for a dynamic task', async () => {
    await renderApp(TASK, dynamicTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).getByRole('radio', { name: 'Dynamic: duration' })).toBeChecked();
    expect(within(sheet).getByLabelText('Duration in working days')).toHaveValue(5);
    expect(within(sheet).getByText('Due Thu 8 Oct, 5 working days')).toBeInTheDocument();
    expect(within(sheet).queryByLabelText('Due date')).toBeNull();
  });

  it('turns a static task dynamic with a first duration of 5 days, then changes the duration', async () => {
    const { store } = await renderApp(TASK, staticTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Dynamic: duration' }));
    expect(await within(sheet).findByText('Due Thu 8 Oct, 5 working days')).toBeInTheDocument();
    expect(store.state.tasks.tsk_007).toMatchObject({ schedule: 'dynamic', durationDays: 5, dueDate: '2026-10-08' });

    const days = within(sheet).getByLabelText('Duration in working days');
    await userEvent.clear(days);
    await userEvent.type(days, '1');
    await userEvent.tab();
    expect(await within(sheet).findByText('Due Sun 4 Oct, 1 working day')).toBeInTheDocument();
  });

  it('moves the due date with the start for a dynamic task', async () => {
    const { store } = await renderApp(TASK, dynamicTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const start = within(sheet).getByLabelText('Start date');
    fireEvent.change(start, { target: { value: '2026-10-07' } });
    fireEvent.blur(start);
    expect(await within(sheet).findByText('Due Tue 13 Oct, 5 working days')).toBeInTheDocument();
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-13');
  });

  it('turns a dynamic task static and keeps its due date', async () => {
    const { store } = await renderApp(TASK, dynamicTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Static: due date' }));
    await waitFor(() => expect(within(sheet).getByLabelText('Due date')).toHaveValue('2026-10-08'));
    expect(store.state.tasks.tsk_007).toMatchObject({ schedule: 'static', durationDays: null, dueDate: '2026-10-08' });
  });

  it('tells the person why a due date before the start is refused', async () => {
    const { store } = await renderApp(TASK, staticTask);
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const due = within(sheet).getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2026-10-01' } });
    fireEvent.blur(due);
    expect(await screen.findByText('The due date cannot be before the start date.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-20');
  });

  it('shows the start date and the duration as plain text to a person who cannot edit', async () => {
    await renderApp(TASK, (state) => {
      dynamicTask(state);
      state.session.currentUserId = 'usr_005';
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).queryAllByRole('radio')).toHaveLength(0);
    expect(within(sheet).getByText('Start date').parentElement).toHaveTextContent('4 October 2026');
    expect(within(sheet).getByText('Duration in working days').parentElement).toHaveTextContent('5 working days');
  });
});

describe('a task that has not started yet', () => {
  it('says when it starts in its row, in place of the due word', async () => {
    await renderApp('/projects/prj_001?tab=tasks', staticTask);
    const row = (await screen.findByRole('button', { name: /^Stair details/ })).closest('li') as HTMLElement;
    expect(within(row).getByText('Starts Sun 4 Oct')).toBeInTheDocument();
    expect(within(row).queryByText(/past due/)).toBeNull();
  });

  it('keeps the due word once the start day has come', async () => {
    await renderApp('/projects/prj_001?tab=tasks', (state) => {
      Object.assign(state.tasks.tsk_007, { startDate: '2026-09-20', schedule: 'static', durationDays: null, dueDate: '2026-09-25' });
    });
    const row = (await screen.findByRole('button', { name: /^Stair details/ })).closest('li') as HTMLElement;
    expect(within(row).getByText('5 days past due')).toBeInTheDocument();
    expect(within(row).queryByText(/Starts/)).toBeNull();
  });
});
