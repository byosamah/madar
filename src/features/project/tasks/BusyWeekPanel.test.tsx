import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { addTodo, clearLead } from '../../../test/busyTasks';
import { renderApp } from '../../../test/render';
import { renderPanel, setupTask } from '../../../test/renderPanel';
import { renderRemoteApp } from '../../../test/renderRemote';

// Busy-week note in the task panel (tsk_499, owner 2026-11-01). "Stair details" (tsk_007) in Corniche Office Tower (prj_001) is led by
// Yousef Saleh (usr_006). Sara Al-Qahtani (usr_005) has the three to-dos of the mockup in the week of Wed 10 Mar 2027 (Sun 7 to Sat 13).
const TASK = '/projects/prj_001?tab=tasks&task=tsk_007';
const NOTE = /to-dos? (due in the same week|past due)/;

/** Sara has three to-dos in the week. Stair details has the given lead and due date, and no start date, so a new date asks no reason. */
const world = (o: { userId?: string; ownerId?: string; dueDate?: string | null; extra?: (state: State) => void } = {}) => (state: State) => {
  setupTask('tsk_007', o.userId ?? 'usr_001', { ownerId: o.ownerId ?? 'usr_006', startDate: null, schedule: 'static', durationDays: null, dueDate: o.dueDate ?? null })(state);
  clearLead(state, 'usr_005');
  addTodo(state, 'tsk_901', { title: 'Roof plan', dueDate: '2027-03-09' });
  addTodo(state, 'tsk_902', { title: '3D views', dueDate: '2027-03-10' });
  addTodo(state, 'tsk_903', { title: 'Site visit notes', dueDate: '2027-03-11' });
  o.extra?.(state);
};
const dialog = () => screen.findByRole('dialog', { name: 'Stair details' });
const setDue = (sheet: HTMLElement, day: string) => {
  const due = within(sheet).getByLabelText('Due date');
  fireEvent.change(due, { target: { value: day } });
  fireEvent.blur(due);
};

describe('the busy-week note in the task panel on a desk', () => {
  it('shows after a new lead is saved: the count of the other to-dos of the new lead, and never the open to-do itself', async () => {
    const { store } = await renderApp(TASK, world({ dueDate: '2027-03-10' }));
    const sheet = await dialog();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_005');
    const note = await within(sheet).findByRole('status');
    // Stair details is now Sara's, open, and due in that week. It would make 4 if it counted itself.
    expect(store.state.tasks.tsk_007.ownerId).toBe('usr_005');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 3 to-dos due in the same week.');
    expect(within(note).queryByText('Stair details')).toBeNull();
    // The change is saved already, so the hint has no "add it anyway".
    expect(note).toHaveTextContent('Pick another date if that week is too full.');
    expect(note).not.toHaveTextContent('anyway');
  });

  it('shows after a new due date is saved, for the lead of the to-do, without the to-do itself', async () => {
    const { store } = await renderApp(TASK, world({ ownerId: 'usr_005' }));
    const sheet = await dialog();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    setDue(sheet, '2027-03-10');
    await waitFor(() => expect(store.state.tasks.tsk_007.dueDate).toBe('2027-03-10'));
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 3 to-dos due in the same week.');
    expect(within(note).queryByText('Stair details')).toBeNull();
  });

  it('follows the saved date: a second date in another week shows the count of that week', async () => {
    const { store } = await renderApp(TASK, world({ ownerId: 'usr_005', extra: (state) => addTodo(state, 'tsk_904', { title: 'Next week plan', dueDate: '2027-03-17' }) }));
    const sheet = await dialog();
    setDue(sheet, '2027-03-10');
    await within(sheet).findByText('Sara Al-Qahtani has 3 to-dos due in the same week.');
    // The date was set already, so the move asks why.
    setDue(sheet, '2027-03-16');
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The brief changed');
    await userEvent.click(within(ask).getByRole('button', { name: 'Save dates' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.dueDate).toBe('2027-03-16'));
    expect(await within(sheet).findByText('Sara Al-Qahtani has 1 to-do due in the same week.')).toBeInTheDocument();
  });

  it('shows nothing when the panel opens, and nothing after a change that moves neither the lead nor the date', async () => {
    const { store } = await renderApp(TASK, world({ ownerId: 'usr_005', dueDate: '2027-03-10' }));
    const sheet = await dialog();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    await userEvent.click(within(sheet).getByRole('switch', { name: /Flag/ }));
    await waitFor(() => expect(store.state.tasks.tsk_007.flagged).toBe(true));
    expect(within(sheet).queryByText(NOTE)).toBeNull();
  });

  it('shows nothing when the new lead has nothing in that week, or when the lead is taken off', async () => {
    await renderApp(TASK, world({ dueDate: '2027-03-10' }));
    const sheet = await dialog();
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_008');
    expect(await screen.findByText('Khalid Al-Mutairi now leads this to-do.')).toBeInTheDocument();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), '');
    await screen.findByText('This to-do has no lead now.');
    expect(within(sheet).queryByText(NOTE)).toBeNull();
  });

  it('goes away when the person undoes the new lead', async () => {
    const { store } = await renderApp(TASK, world({ dueDate: '2027-03-10' }));
    const sheet = await dialog();
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_005');
    await within(sheet).findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.ownerId).toBe('usr_006'));
    await waitFor(() => expect(within(sheet).queryByText(NOTE)).toBeNull());
  });

  it('goes away when the panel closes', async () => {
    const { router } = await renderApp(TASK, world({ dueDate: '2027-03-10' }));
    let sheet = await dialog();
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_005');
    await within(sheet).findByRole('status');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
    await router.navigate(TASK);
    sheet = await dialog();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
  });

  it('does not show a hidden project or a private to-do of the new lead to a person who may not see them', async () => {
    // Faisal (usr_002) leads prj_001. Dune Line Townhouses (prj_002) is hidden, and he is not on it. Sara has a to-do there and a private office to-do.
    await renderApp(TASK, world({
      userId: 'usr_002',
      dueDate: '2027-03-10',
      extra: (state) => {
        state.projects.prj_002.access = { hidden: true, viewerIds: [] };
        addTodo(state, 'tsk_911', { title: 'Hidden project plan', projectId: 'prj_002', dueDate: '2027-03-09' });
        addTodo(state, 'tsk_912', { title: 'Private office plan', projectId: null, createdBy: 'usr_004', dueDate: '2027-03-12' });
        addTodo(state, 'tsk_913', { title: 'Hidden project late', projectId: 'prj_002', dueDate: '2026-09-01' });
      },
    }));
    const sheet = await dialog();
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_005');
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 3 to-dos due in the same week.');
    expect(within(note).queryByText(/past due/)).toBeNull();
    for (const marker of ['Hidden project', 'Private office', 'Dune Line']) expect(note.textContent ?? '').not.toContain(marker);
  });
});

describe('the calls of the busy-week note in the task panel', () => {
  it('reads nothing when the panel opens, and reads once after a new lead is saved', async () => {
    const { sent } = await renderRemoteApp(TASK, world({ dueDate: '2027-03-10' }));
    const sheet = await dialog();
    const reads = () => sent.filter((call) => call.name === 'tasks.list' && (call.input as { ownerId?: string }).ownerId !== undefined).map((call) => call.input);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reads()).toEqual([]);
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_005');
    await within(sheet).findByRole('status');
    expect(reads()).toEqual([{ ownerId: 'usr_005', status: ['todo', 'in_progress'], includeDone: false, dueTo: '2027-03-13' }]);
  });
});

describe('the busy-week note in the task panel on a phone', () => {
  it('shows under the When group after a new lead is saved, and not when the panel opens', async () => {
    await renderPanel('tsk_007', { phone: true, prepare: world({ dueDate: '2027-03-10' }) });
    const sheet = await dialog();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    // The people load after the panel.
    await within(within(sheet).getByLabelText('Lead')).findByRole('option', { name: /Sara Al-Qahtani/ });
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_005');
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 3 to-dos due in the same week.');
    expect(note).toHaveTextContent('Pick another date if that week is too full.');
    // The note sits after the When group, not inside its box of rows.
    const when = within(sheet).getByRole('region', { name: 'When' });
    expect(when.contains(note)).toBe(false);
    expect(when.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows after a new due date is saved', async () => {
    await renderPanel('tsk_007', { phone: true, prepare: world({ ownerId: 'usr_005' }) });
    const sheet = await dialog();
    setDue(sheet, '2027-03-10');
    expect(await within(sheet).findByText('Sara Al-Qahtani has 3 to-dos due in the same week.')).toBeInTheDocument();
  });
});
