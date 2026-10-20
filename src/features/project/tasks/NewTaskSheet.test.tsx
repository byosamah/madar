import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// Feedback fbk_005 (2026-10-11): the "+" before "Add a task" did nothing. The team pressed it and nothing opened; they did not know
// that they had to press the words to type a title. Now the "+" opens a small panel for a new task in that stage, and the words stay
// the quick add (a title and Enter). In Corniche Office Tower (prj_001), Faisal Al-Harbi (usr_002) leads the project, and its
// current stage is Construction Documents (stg_004).
const TAB = '/projects/prj_001?tab=tasks';
const asLeader = (state: State) => {
  state.session.currentUserId = 'usr_002';
};
const titled = (state: State, title: string) => Object.values(state.tasks).find((task) => task.title === title);

describe('the "+" of a stage in the Tasks tab', () => {
  it('opens a panel for a new task in that stage, and the panel makes the task with its lead and due date', async () => {
    const { store } = await renderApp(TAB, asLeader);
    await userEvent.click(await screen.findByRole('button', { name: 'New to-do in Construction Documents' }));
    const sheet = await screen.findByRole('dialog', { name: 'New to-do in Construction Documents' });
    // One main button, and it waits for a title. A new task starts with no lead, as the quick add makes it.
    const create = within(sheet).getByRole('button', { name: 'Create to-do' });
    expect(create).toBeDisabled();
    expect(within(sheet).getByRole('combobox', { name: 'Lead' })).toHaveValue('');
    await userEvent.type(within(sheet).getByRole('textbox', { name: /Title/ }), 'Fire exit plan');
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), 'usr_005');
    fireEvent.change(within(sheet).getByLabelText(/Due date/), { target: { value: '2026-10-20' } });
    await userEvent.click(create);
    await waitFor(() => expect(titled(store.state, 'Fire exit plan')).toBeDefined());
    expect(titled(store.state, 'Fire exit plan')).toMatchObject({ projectId: 'prj_001', stageId: 'stg_004', ownerId: 'usr_005', dueDate: '2026-10-20', createdBy: 'usr_002' });
    expect(await screen.findByText('To-do created.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New to-do in Construction Documents' })).toBeNull());
  });

  it('offers the people of the team as lead, and no one else', async () => {
    await renderApp(TAB, asLeader);
    await userEvent.click(await screen.findByRole('button', { name: 'New to-do in Construction Documents' }));
    const lead = within(await screen.findByRole('dialog', { name: 'New to-do in Construction Documents' })).getByRole('combobox', { name: 'Lead' });
    expect(within(lead).getByRole('option', { name: 'Sara Al-Qahtani' })).toBeInTheDocument();
    expect(within(lead).getByRole('option', { name: 'Faisal Al-Harbi' })).toBeInTheDocument();
    expect(within(lead).queryByRole('option', { name: /Reem Al-Ghamdi/ })).toBeNull();
  });

  it('keeps the words as the quick add: a title and Enter make a task with no lead, and no panel opens', async () => {
    const { store } = await renderApp(TAB, asLeader);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a to-do in Construction Documents' }), 'Quick one{Enter}');
    await waitFor(() => expect(titled(store.state, 'Quick one')).toBeDefined());
    expect(titled(store.state, 'Quick one')).toMatchObject({ stageId: 'stg_004', ownerId: null });
    expect(screen.queryByRole('dialog', { name: /New to-do in/ })).toBeNull();
  });

  it('asks why when the new task goes into an earlier stage, as the quick add does', async () => {
    const { store } = await renderApp(TAB, asLeader);
    await userEvent.click(await screen.findByRole('button', { name: 'New to-do in Concept' }));
    const sheet = await screen.findByRole('dialog', { name: 'New to-do in Concept' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: /Title/ }), 'Site photos');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create to-do' }));
    const ask = await screen.findByRole('dialog', { name: 'This moves the project back to Concept. Why?' });
    expect(titled(store.state, 'Site photos')).toBeUndefined();
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The client asked for photos');
    await userEvent.click(within(ask).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(titled(store.state, 'Site photos')).toMatchObject({ stageId: 'stg_001' }));
  });
});
