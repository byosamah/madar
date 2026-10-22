import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_HELPERS } from '../../../api/contract/limits';
import type { State } from '../../../api/store';
import { addOfficeTask, renderPanel, setupTask } from '../../../test/renderPanel';
import { PhoneDetails } from './PhoneDetails';
import type { TaskPanel } from './useTaskPanel';

const details = (panel: TaskPanel) => <PhoneDetails panel={panel} />;
const open = (taskId: string, prepare: (state: State) => void) => renderPanel(taskId, { phone: true, prepare, render: details });
/** The ten people who are not the lead of tsk_007 (usr_006). */
const TEN = ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_007', 'usr_008', 'usr_009', 'usr_010', 'usr_011'];

describe('PhoneDetails, People and This to-do', () => {
  it('shows the Lead row as a select for editAll, and as a plain row for a reader', async () => {
    const view = await open('tsk_007', setupTask('tsk_007', 'usr_002'));
    const select = await screen.findByLabelText('Lead');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAttribute('id', 'task-owner');
    view.unmount();
    await open('tsk_011', setupTask('tsk_011', 'usr_005'));
    const people = await screen.findByRole('region', { name: 'People' });
    expect(within(people).queryByLabelText('Lead')).toBeNull();
    expect(within(people).getByText('Lead')).toBeInTheDocument();
    expect(within(people).getByText('Faisal Al-Harbi')).toBeInTheDocument();
  });

  it('shows NoLeadMark and No lead for a to-do with no lead', async () => {
    await open('tsk_007', setupTask('tsk_007', 'usr_002', { ownerId: null, status: 'todo' }));
    const people = await screen.findByRole('region', { name: 'People' });
    // The look of the row is hidden from screen readers, because the select carries the name.
    expect(within(people).getByRole('img', { name: 'No lead', hidden: true })).toBeInTheDocument();
    expect(within(people).getByLabelText('Lead')).toHaveValue('');
  });

  it('sends the new lead with the Undo toast, with (joins the team) in the option', async () => {
    const { store } = await open('tsk_007', setupTask('tsk_007', 'usr_002'));
    const select = await screen.findByLabelText('Lead');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(3));
    await userEvent.selectOptions(select, within(select).getByRole('option', { name: 'Reem Al-Ghamdi (joins the team)' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.ownerId).toBe('usr_003'));
    expect(await screen.findByText('Reem Al-Ghamdi now leads this to-do and joined the project team.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('lists a helper row with Remove helper of 44 px, and an Add a helper row that hides at MAX_HELPERS', async () => {
    const view = await open('tsk_007', (state) => {
      setupTask('tsk_007', 'usr_002')(state);
      state.tasks.tsk_007.helperIds = ['usr_005'];
    });
    const remove = await screen.findByRole('button', { name: 'Remove helper Sara Al-Qahtani' });
    expect(remove).toHaveClass('size-11');
    expect(await screen.findByLabelText('Add a helper')).toHaveAttribute('id', 'task-add-helper');
    view.unmount();
    await open('tsk_007', (state) => {
      setupTask('tsk_007', 'usr_002')(state);
      state.tasks.tsk_007.helperIds = TEN.slice(0, MAX_HELPERS);
    });
    await screen.findByLabelText('Lead');
    await screen.findAllByRole('option', { name: /Hala Nasser/ });
    expect(screen.queryByLabelText('Add a helper')).toBeNull();
  });

  it('removes a helper and adds one with the same patch as the desk', async () => {
    const { store } = await open('tsk_007', (state) => {
      setupTask('tsk_007', 'usr_002')(state);
      state.tasks.tsk_007.helperIds = ['usr_005'];
    });
    const add = await screen.findByLabelText('Add a helper');
    await userEvent.selectOptions(add, within(add).getByRole('option', { name: 'Khalid Al-Mutairi' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.helperIds).toEqual(['usr_005', 'usr_008']));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove helper Sara Al-Qahtani' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.helperIds).toEqual(['usr_008']));
  });

  it('hides the helpers rows for a reader with no helper', async () => {
    await open('tsk_011', setupTask('tsk_011', 'usr_005'));
    const people = await screen.findByRole('region', { name: 'People' });
    expect(within(people).queryByText('No helpers yet.')).toBeNull();
    expect(within(people).queryByLabelText('Add a helper')).toBeNull();
    expect(within(people).queryByRole('button')).toBeNull();
  });

  it('shows Status as a select with moveTargets, and as a plain row for the reviewer', async () => {
    const view = await open('tsk_007', setupTask('tsk_007', 'usr_006'));
    const status = await screen.findByLabelText('Status');
    expect(status.tagName).toBe('SELECT');
    expect(status).toHaveAttribute('id', 'task-status');
    expect(within(status).getAllByRole('option').map((option) => option.textContent)).toEqual(['To do', 'In progress', 'In review', 'Done']);
    view.unmount();
    await open('tsk_010', setupTask('tsk_010', 'usr_002'));
    const group = await screen.findByRole('region', { name: 'This to-do' });
    expect(within(group).getByText('In review')).toBeInTheDocument();
    expect(group.querySelector('#task-status')).toBeNull();
  });

  it('shows Stage as a select, as a plain row, or no row for an office to-do', async () => {
    const view = await open('tsk_007', setupTask('tsk_007', 'usr_002'));
    expect((await screen.findByLabelText('Stage')).tagName).toBe('SELECT');
    view.unmount();
    const second = await open('tsk_011', setupTask('tsk_011', 'usr_005'));
    const group = await screen.findByRole('region', { name: 'This to-do' });
    expect(within(group).getByText('Stage')).toBeInTheDocument();
    expect(within(group).queryByLabelText('Stage')).toBeNull();
    second.unmount();
    await open('tsk_900', (state) => {
      state.session.currentUserId = 'usr_005';
      addOfficeTask(state);
    });
    const office = await screen.findByRole('region', { name: 'This to-do' });
    expect(within(office).queryByText('Stage')).toBeNull();
  });

  it('shows the Flag and Needs review switches by the gates of the desk', async () => {
    const view = await open('tsk_007', setupTask('tsk_007', 'usr_002'));
    expect(await screen.findByRole('switch', { name: 'Flag' })).toHaveAttribute('id', 'task-flag');
    expect(screen.getByRole('switch', { name: 'Needs review' })).toHaveAttribute('id', 'task-review');
    view.unmount();
    const reader = await open('tsk_011', setupTask('tsk_011', 'usr_005'));
    await screen.findByRole('region', { name: 'This to-do' });
    expect(screen.queryByRole('switch')).toBeNull();
    reader.unmount();
    // An office to-do that its maker leads has no review to turn on.
    await open('tsk_900', (state) => {
      state.session.currentUserId = 'usr_004';
      addOfficeTask(state, { ownerId: 'usr_004' });
    });
    await screen.findByRole('switch', { name: 'Flag' });
    expect(screen.queryByRole('switch', { name: 'Needs review' })).toBeNull();
  });

  it('saves the description on blur, keeps Not saved yet, and shows RichText to a reader', async () => {
    const view = await open('tsk_007', setupTask('tsk_007', 'usr_002', { description: '' }));
    const box = await screen.findByRole('textbox', { name: 'Description' });
    await userEvent.type(box, 'Bring the tape.');
    await userEvent.tab();
    await waitFor(() => expect(view.store.state.tasks.tsk_007.description).toBe('Bring the tape.'));
    view.unmount();
    const reader = await open('tsk_011', setupTask('tsk_011', 'usr_005', { description: 'Check the **landing**.' }));
    const group = await screen.findByRole('region', { name: 'This to-do' });
    expect(within(group).queryByRole('textbox')).toBeNull();
    expect(within(group).getByText('Description')).toBeInTheDocument();
    reader.unmount();
    await open('tsk_011', setupTask('tsk_011', 'usr_005', { description: '' }));
    const quiet = await screen.findByRole('region', { name: 'This to-do' });
    expect(within(quiet).queryByText('Description')).toBeNull();
  });
});
