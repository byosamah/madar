import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { addTodo, clearLead } from '../../../test/busyTasks';
import { renderApp } from '../../../test/render';
import { renderRemoteApp } from '../../../test/renderRemote';

// Busy-week note (tsk_499, owner 2026-11-01). Faisal Al-Harbi (usr_002) leads Corniche Office Tower (prj_001). Sara Al-Qahtani (usr_005)
// leads the to-dos of these tests. Today is Wed 30 Sep 2026. The week of Wed 10 Mar 2027 runs from Sun 7 Mar to Sat 13 Mar.
const TAB = '/projects/prj_001?tab=tasks';
const SHEET = 'New to-do in Construction Documents';
const DUE = '2027-03-10';

/** Sara has the three to-dos of the owner's mockup in that week. */
const mockup = (state: State) => {
  state.session.currentUserId = 'usr_002';
  clearLead(state, 'usr_005');
  addTodo(state, 'tsk_901', { title: 'Roof plan', dueDate: '2027-03-09' });
  addTodo(state, 'tsk_902', { title: '3D views', dueDate: '2027-03-10', projectId: 'prj_002' });
  addTodo(state, 'tsk_903', { title: 'Site visit notes', dueDate: '2027-03-11', status: 'in_progress', projectId: 'prj_004' });
};

async function openSheet() {
  await userEvent.click(await screen.findByRole('button', { name: SHEET }));
  return screen.findByRole('dialog', { name: SHEET });
}
const pick = async (sheet: HTMLElement, lead: string | null, due: string | null) => {
  if (lead !== null) await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), lead);
  if (due !== null) fireEvent.change(within(sheet).getByLabelText('Due date'), { target: { value: due } });
};
const NOTE = /to-dos? (due in the same week|past due)/;

describe('the busy-week note in the New to-do sheet of a stage', () => {
  it('shows the other to-dos of the lead in that week: the count, the rows, and the hint', async () => {
    await renderApp(TAB, mockup);
    const sheet = await openSheet();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    await pick(sheet, 'usr_005', DUE);
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 3 to-dos due in the same week.');
    const rows = within(note).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Roof planCorniche Office TowerTue');
    expect(rows[1]).toHaveTextContent('3D viewsDune Line TownhousesWed');
    expect(rows[2]).toHaveTextContent('Site visit notesNakhla Mall ExtensionThu');
    expect(note).toHaveTextContent('Pick another date, or add it anyway.');
    // The note is no extra step: it holds no button, and the one main button is the usual one.
    expect(within(note).queryByRole('button')).toBeNull();
  });

  it('shows nothing until both a lead and a due date are set', async () => {
    await renderApp(TAB, mockup);
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', null);
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), '');
    await pick(sheet, null, DUE);
    expect(within(sheet).queryByText(NOTE)).toBeNull();
  });

  it('shows nothing when the lead has nothing in that week or past due', async () => {
    const { sent } = await renderRemoteApp(TAB, mockup);
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', '2027-04-14');
    // The read goes out and answers; the note stays absent.
    await waitFor(() => expect(sent.filter((call) => call.name === 'tasks.list' && (call.input as { ownerId?: string }).ownerId === 'usr_005')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    expect(within(sheet).queryByRole('status')).toBeNull();
  });

  it('follows the date: another week shows another count, and the same lead is named', async () => {
    await renderApp(TAB, (state) => {
      mockup(state);
      addTodo(state, 'tsk_904', { title: 'Section sheet', dueDate: '2027-03-17' });
    });
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', DUE);
    expect(await within(sheet).findByText('Sara Al-Qahtani has 3 to-dos due in the same week.')).toBeInTheDocument();
    await pick(sheet, null, '2027-03-16');
    expect(await within(sheet).findByText('Sara Al-Qahtani has 1 to-do due in the same week.')).toBeInTheDocument();
    expect(within(sheet).getByText('Section sheet')).toBeInTheDocument();
  });

  it('counts the lead only: a to-do where the person only helps does not count', async () => {
    await renderApp(TAB, (state) => {
      mockup(state);
      addTodo(state, 'tsk_905', { title: 'Helped plan', ownerId: 'usr_006', helperIds: ['usr_005'] });
    });
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', DUE);
    expect(await within(sheet).findByText('Sara Al-Qahtani has 3 to-dos due in the same week.')).toBeInTheDocument();
    expect(within(sheet).queryByText('Helped plan')).toBeNull();
  });

  it('counts open to-dos only: in review and done do not count', async () => {
    await renderApp(TAB, (state) => {
      mockup(state);
      addTodo(state, 'tsk_905', { title: 'In review plan', status: 'in_review' });
      addTodo(state, 'tsk_906', { title: 'Done plan', status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' });
    });
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', DUE);
    expect(await within(sheet).findByText('Sara Al-Qahtani has 3 to-dos due in the same week.')).toBeInTheDocument();
    expect(within(sheet).queryByText('In review plan')).toBeNull();
    expect(within(sheet).queryByText('Done plan')).toBeNull();
  });

  it('lists three rows and says "and N more" for the others', async () => {
    await renderApp(TAB, (state) => {
      mockup(state);
      addTodo(state, 'tsk_907', { title: 'Fourth plan', dueDate: '2027-03-12' });
      addTodo(state, 'tsk_908', { title: 'Fifth plan', dueDate: '2027-03-12' });
    });
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', DUE);
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 5 to-dos due in the same week.');
    expect(within(note).getAllByRole('listitem')).toHaveLength(3);
    expect(within(note).getByText('and 2 more')).toBeInTheDocument();
  });

  it('adds one short line for the to-dos past due', async () => {
    await renderApp(TAB, (state) => {
      mockup(state);
      addTodo(state, 'tsk_909', { title: 'Late plan', dueDate: '2026-09-20' });
      addTodo(state, 'tsk_910', { title: 'Later plan', dueDate: '2026-09-25', status: 'in_progress' });
    });
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', DUE);
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 3 to-dos due in the same week.');
    expect(within(note).getByText('2 other to-dos are past due.')).toBeInTheDocument();
    // The past due to-dos are counted in one line and are not listed.
    expect(within(note).getAllByRole('listitem')).toHaveLength(3);
  });

  it('still shows the note, led by the past due line, when the week is free', async () => {
    await renderApp(TAB, (state) => {
      mockup(state);
      addTodo(state, 'tsk_909', { title: 'Late plan', dueDate: '2026-09-20' });
    });
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', '2027-05-05');
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 1 to-do past due.');
    expect(within(note).queryByRole('list')).toBeNull();
    expect(note).toHaveTextContent('Pick another date, or add it anyway.');
  });

  it('says "You have" when the lead is the person', async () => {
    await renderApp(TAB, (state) => {
      mockup(state);
      addTodo(state, 'tsk_911', { title: 'My plan', ownerId: 'usr_002' });
    });
    const sheet = await openSheet();
    await pick(sheet, 'usr_002', DUE);
    expect(await within(sheet).findByText('You have 1 to-do due in the same week.')).toBeInTheDocument();
  });

  it('never blocks: Add makes the to-do as usual while the note shows', async () => {
    const { store } = await renderApp(TAB, mockup);
    const sheet = await openSheet();
    await userEvent.type(within(sheet).getByRole('textbox', { name: /Title/ }), 'Fire exit plan');
    await pick(sheet, 'usr_005', DUE);
    await within(sheet).findByRole('status');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create to-do' }));
    await waitFor(() => expect(Object.values(store.state.tasks).find((task) => task.title === 'Fire exit plan')).toMatchObject({ ownerId: 'usr_005', dueDate: DUE }));
  });

  it('starts empty when the sheet opens again', async () => {
    await renderApp(TAB, mockup);
    let sheet = await openSheet();
    await pick(sheet, 'usr_005', DUE);
    await within(sheet).findByRole('status');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: SHEET })).toBeNull());
    sheet = await openSheet();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
  });
});

describe('the calls of the busy-week note', () => {
  const readsOf = (sent: Array<{ name: string; input: unknown }>) =>
    sent.filter((call) => call.name === 'tasks.list' && (call.input as { ownerId?: string }).ownerId !== undefined).map((call) => call.input);

  it('reads nothing when the sheet opens or a lead alone is set, reads once with the lead and the date, and answers the same week from the cache', async () => {
    const { sent } = await renderRemoteApp(TAB, mockup);
    const sheet = await openSheet();
    await pick(sheet, 'usr_005', null);
    expect(readsOf(sent)).toEqual([]);
    await pick(sheet, null, DUE);
    await within(sheet).findByRole('status');
    // The input names the lead, the open statuses and the Saturday that ends the week. No other read goes out.
    expect(readsOf(sent)).toEqual([{ ownerId: 'usr_005', status: ['todo', 'in_progress'], includeDone: false, dueTo: '2027-03-13' }]);
    // Another day of the same week is the same read.
    await pick(sheet, null, '2027-03-08');
    await waitFor(() => expect(within(sheet).getByLabelText('Due date')).toHaveValue('2027-03-08'));
    await within(sheet).findByRole('status');
    expect(readsOf(sent)).toHaveLength(1);
    // Another week is one more read.
    await pick(sheet, null, '2027-03-16');
    await waitFor(() => expect(readsOf(sent)).toHaveLength(2));
  });
});
