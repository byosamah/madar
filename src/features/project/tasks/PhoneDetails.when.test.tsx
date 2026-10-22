import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../../api/contract/entities';
import type { State } from '../../../api/store';
import { renderPanel, setupTask } from '../../../test/renderPanel';
import { PhoneDetails } from './PhoneDetails';
import type { TaskPanel } from './useTaskPanel';

// Today in the tests is Wed 30 Sep 2026. Stair details starts on Sun 4 Oct and is due on Tue 20 Oct.
const STATIC: Partial<Task> = { startDate: '2026-10-04', schedule: 'static', durationDays: null, dueDate: '2026-10-20' };
// The sheets of the panel (the reason of a date move) belong to the body that holds the groups, so the test draws them too.
const details = (panel: TaskPanel) => <><PhoneDetails panel={panel} />{panel.dates.sheet}</>;
const open = (taskId: string, userId: string, patch: Partial<Task> = STATIC, extra?: (state: State) => void) =>
  renderPanel(taskId, {
    phone: true,
    prepare: (state) => {
      setupTask(taskId, userId, patch)(state);
      extra?.(state);
    },
    render: details,
  });
const when = () => screen.findByRole('region', { name: 'When' });

describe('PhoneDetails, the When group', () => {
  it('shows Start, Timing and Due rows for a Static to-do', async () => {
    await open('tsk_007', 'usr_002');
    const group = await when();
    expect(within(group).getByLabelText('Start date')).toHaveAttribute('id', 'task-start');
    expect(within(group).getByLabelText('Due date')).toHaveAttribute('id', 'task-due');
    const timing = within(group).getByRole('button', { name: /Timing/ });
    expect(timing).toHaveTextContent('Static: due date');
    expect(timing).toHaveAttribute('aria-expanded', 'false');
    expect(within(group).queryByLabelText('Duration in working days')).toBeNull();
  });

  it('opens the two timing choices in place and shows the hint', async () => {
    // The to-do has a start and no due date, so the change to Dynamic moves no date and asks for no reason.
    const { store } = await open('tsk_007', 'usr_002', { startDate: '2026-10-04', schedule: 'static', durationDays: null, dueDate: null });
    const group = await when();
    await userEvent.click(within(group).getByRole('button', { name: /Timing/ }));
    const choices = await within(group).findByRole('radiogroup', { name: 'How the to-do is timed' });
    expect(within(group).getByText(/^Static: you set the start and the due date/)).toBeInTheDocument();
    await userEvent.click(within(choices).getByRole('radio', { name: 'Dynamic: duration' }));
    await waitFor(() => expect(store.state.tasks.tsk_007).toMatchObject({ schedule: 'dynamic', durationDays: 5 }));
  });

  it('shows Duration and the computed due line for Dynamic, and Pick a start date first with no start', async () => {
    const view = await open('tsk_007', 'usr_002', { startDate: '2026-10-04', schedule: 'dynamic', durationDays: 5, dueDate: '2026-10-08' });
    const group = await when();
    expect(within(group).getByLabelText('Duration in working days')).toHaveValue(5);
    expect(within(group).queryByLabelText('Due date')).toBeNull();
    expect(within(group).getByText(/^Due .*, 5 working days$/)).toBeInTheDocument();
    view.unmount();
    await open('tsk_007', 'usr_002', { startDate: null, schedule: 'dynamic', durationDays: null, dueDate: null });
    expect(await within(await when()).findByText('Pick a start date first.')).toBeInTheDocument();
  });

  it('asks for a reason when a date moves, and Cancel puts the old date back', async () => {
    const { store } = await open('tsk_007', 'usr_002');
    const group = await when();
    const due = within(group).getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2026-10-26' } });
    fireEvent.blur(due);
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep the old date' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Why do the dates change?' })).toBeNull());
    expect(within(await when()).getByLabelText('Due date')).toHaveValue('2026-10-20');
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-20');
  });

  it('shows plain rows to a person who cannot change the dates', async () => {
    await open('tsk_011', 'usr_005', { startDate: '2026-10-04', dueDate: '2026-10-20', schedule: 'static' });
    const group = await when();
    expect(within(group).queryByLabelText('Start date')).toBeNull();
    expect(within(group).queryByRole('button')).toBeNull();
    expect(within(group).getByText('Start date')).toBeInTheDocument();
    expect(within(group).getByText('Due date')).toBeInTheDocument();
    expect(within(group).getByText(/20 October 2026/)).toBeInTheDocument();
  });

  it('lists the automatic date changes under the group', async () => {
    await open('tsk_007', 'usr_002', {
      ...STATIC,
      dateNotes: [{ from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-20' }, reason: 'Moved because the survey came late.', at: '2026-09-29T09:00:00.000+03:00' }],
    });
    const notes = await screen.findByRole('region', { name: 'Date changes' });
    expect(notes).toHaveTextContent('Moved because the survey came late.');
    const group = await when();
    expect(group.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
