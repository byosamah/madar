import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { addTodo, clearLead } from '../../test/busyTasks';
import { renderApp } from '../../test/render';

// Busy-week note in the New office to-do sheet (tsk_499, owner 2026-11-01). Sara Al-Qahtani (usr_005) leads the to-dos of these tests.
// Today is Wed 30 Sep 2026. The week of Wed 10 Mar 2027 runs from Sun 7 Mar to Sat 13 Mar. Omar Haddad (usr_004) is a Member.
const DUE = '2027-03-10';
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
  clearLead(state, 'usr_005');
};
const three = (state: State) => {
  addTodo(state, 'tsk_901', { title: 'Roof plan', dueDate: '2027-03-09' });
  addTodo(state, 'tsk_902', { title: '3D views', dueDate: '2027-03-10' });
  addTodo(state, 'tsk_903', { title: 'Site visit notes', dueDate: '2027-03-11' });
};
const NOTE = /to-dos? (due in the same week|past due)/;

async function openSheet(name = 'New office to-do', button = name) {
  await userEvent.click(await screen.findByRole('button', { name: button }));
  return screen.findByRole('dialog', { name });
}
const setDue = (sheet: HTMLElement, day: string, label = 'Due date') => fireEvent.change(within(sheet).getByLabelText(label), { target: { value: day } });

describe('the busy-week note in the New office to-do sheet', () => {
  it('names the person with "You have" when the lead is the person (the lead starts as the person)', async () => {
    await renderApp('/work', (state) => { as('usr_005')(state); three(state); });
    const sheet = await openSheet();
    expect(within(sheet).getByRole('combobox', { name: 'Lead' })).toHaveValue('usr_005');
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    setDue(sheet, DUE);
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('You have 3 to-dos due in the same week.');
    expect(within(note).getAllByRole('listitem')[0]).toHaveTextContent('Roof planCorniche Office TowerTue');
    expect(note).toHaveTextContent('Pick another date, or add it anyway.');
  });

  it('names another lead, and changes with the lead', async () => {
    await renderApp('/work', (state) => {
      as('usr_005')(state);
      three(state);
      addTodo(state, 'tsk_904', { title: 'Yousef plan', ownerId: 'usr_006', dueDate: '2027-03-12' });
    });
    const sheet = await openSheet();
    setDue(sheet, DUE);
    await within(sheet).findByText('You have 3 to-dos due in the same week.');
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), 'usr_006');
    expect(await within(sheet).findByText('Yousef Saleh has 1 to-do due in the same week.')).toBeInTheDocument();
  });

  it('shows an office to-do of the lead with the word Office, and still adds the to-do', async () => {
    const { store } = await renderApp('/work', (state) => {
      as('usr_005')(state);
      addTodo(state, 'tsk_905', { title: 'Renew the licence', projectId: null, createdBy: 'usr_005' });
    });
    const sheet = await openSheet();
    await userEvent.type(within(sheet).getByRole('textbox', { name: /Title/ }), 'Book the room');
    setDue(sheet, DUE);
    const note = await within(sheet).findByRole('status');
    expect(within(note).getByRole('listitem')).toHaveTextContent('Renew the licenceOfficeWed');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add to-do' }));
    await waitFor(() => expect(Object.values(store.state.tasks).find((task) => task.title === 'Book the room')).toMatchObject({ ownerId: 'usr_005', dueDate: DUE }));
  });

  it('leaves out the to-dos of a project that is on hold', async () => {
    await renderApp('/work', (state) => {
      as('usr_005')(state);
      three(state);
      // Tamr Staff Housing (prj_012) is on hold.
      addTodo(state, 'tsk_906', { title: 'Paused plan', projectId: 'prj_012' });
    });
    const sheet = await openSheet();
    setDue(sheet, DUE);
    expect(await within(sheet).findByText('You have 3 to-dos due in the same week.')).toBeInTheDocument();
    expect(within(sheet).queryByText('Paused plan')).toBeNull();
  });

  it('writes the note in Arabic with the plural form and the Arabic hint', async () => {
    await renderApp('/work', (state) => {
      as('usr_005')(state);
      state.users.usr_005.preferences.language = 'ar';
      three(state);
    });
    const sheet = await openSheet('مهمة مكتب جديدة');
    setDue(sheet, DUE, 'تاريخ الاستحقاق');
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('عندك 3 مهام موعدها في الأسبوع نفسه.');
    expect(note).toHaveTextContent('اختر تاريخًا آخر، أو أضفها كما هي.');
    expect(within(note).getAllByRole('listitem')[0]).toHaveTextContent('Roof plan');
  });
});

// Leak tests. The note shows only what `tasks.list` gives the person. The probes: a hidden project of the lead, an office to-do of the lead
// that the person may not see, and a past due to-do in both. Nakhla Mall Extension (prj_004) is hidden here and Omar is not on it.
describe('the busy-week note and what the person may not see', () => {
  const hide = (state: State) => {
    state.projects.prj_004.access = { hidden: true, viewerIds: [] };
  };
  const secret = (state: State) => {
    hide(state);
    addTodo(state, 'tsk_911', { title: 'Hidden project plan', projectId: 'prj_004', dueDate: '2027-03-09' });
    addTodo(state, 'tsk_912', { title: 'Hidden project late', projectId: 'prj_004', dueDate: '2026-09-01' });
    addTodo(state, 'tsk_913', { title: 'Private office plan', projectId: null, createdBy: 'usr_002', dueDate: '2027-03-11' });
    addTodo(state, 'tsk_914', { title: 'Private office late', projectId: null, createdBy: 'usr_002', dueDate: '2026-09-02' });
  };

  it('gives the Admin all of it (the control of the test)', async () => {
    await renderApp('/work', (state) => {
      as('usr_001')(state);
      secret(state);
      addTodo(state, 'tsk_915', { title: 'Open plan', dueDate: '2027-03-12' });
    });
    const sheet = await openSheet();
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), 'usr_005');
    setDue(sheet, DUE);
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 3 to-dos due in the same week.');
    expect(note).toHaveTextContent('2 other to-dos are past due.');
    expect(note).toHaveTextContent('Hidden project plan');
  });

  it('shows a person outside the hidden project and the private to-do only the open to-do, with no count of the others', async () => {
    await renderApp('/work', (state) => {
      as('usr_004')(state);
      secret(state);
      addTodo(state, 'tsk_915', { title: 'Open plan', dueDate: '2027-03-12' });
    });
    const sheet = await openSheet();
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), 'usr_005');
    setDue(sheet, DUE);
    const note = await within(sheet).findByRole('status');
    expect(note).toHaveTextContent('Sara Al-Qahtani has 1 to-do due in the same week.');
    expect(within(note).queryByText(/past due/)).toBeNull();
    for (const marker of ['Hidden project', 'Private office', 'Nakhla', 'prj_004']) expect(sheet.textContent ?? '').not.toContain(marker);
  });

  it('shows no note at all when everything the lead has in that week is out of sight', async () => {
    const { api } = await renderApp('/work', (state) => {
      as('usr_004')(state);
      secret(state);
    });
    const sheet = await openSheet();
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), 'usr_005');
    setDue(sheet, DUE);
    // The read answers with no row: wait for it, then check that no word of the note shows.
    await waitFor(async () => expect(await api.call('tasks.list', { ownerId: 'usr_005', status: ['todo', 'in_progress'], includeDone: false, dueTo: '2027-03-13' })).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(within(sheet).queryByRole('status')).toBeNull();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    expect(within(sheet).queryByText(/past due/)).toBeNull();
  });
});
