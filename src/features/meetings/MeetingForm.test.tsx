import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Meeting } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { as, withMeeting } from './testMeetings';

/**
 * The sheet that plans and edits a meeting (fbk_022). "Now" is Wednesday 2026-09-30 09:00 in Riyadh, so a new meeting starts at 10:00.
 * usr_002 (Faisal) leads prj_001, "Corniche Office Tower", whose location is "Al Khobar, Corniche".
 */
async function openForm(prepare: (state: State) => void = as('usr_002')) {
  const app = await renderApp('/meetings', prepare);
  await userEvent.click(await screen.findByRole('button', { name: 'New meeting' }));
  const form = await screen.findByRole('dialog', { name: 'Plan a meeting' });
  await within(form).findByRole('option', { name: 'Corniche Office Tower' });
  return { ...app, form };
}

const field = (form: HTMLElement, name: string) => within(form).getByRole('combobox', { name });

describe('the New meeting sheet', () => {
  it('shows the eight controls and folds the rest under More', async () => {
    const { form } = await openForm();
    for (const name of ['Kind', 'Project', 'Time', 'Length']) expect(field(form, name)).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: /Title/ })).toBeInTheDocument();
    expect(within(form).getByLabelText(/Day/)).toBeInTheDocument();
    expect(within(form).getByRole('group', { name: 'People' })).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Where' })).toBeInTheDocument();
    expect(within(form).queryByRole('combobox', { name: 'Minutes by' })).toBeNull();
    expect(within(form).queryByRole('textbox', { name: 'Guests' })).toBeNull();
    const more = within(form).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(field(form, 'Minutes by')).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Guests' })).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
    // One button: the main one. The close button of the sheet is not a second action.
    expect(within(form).getAllByRole('button', { name: 'Plan meeting' })).toHaveLength(1);
  });

  it('starts at the next full hour of today, with every text field set to autoComplete off', async () => {
    const { form } = await openForm();
    expect(field(form, 'Time')).toHaveValue('10:00');
    expect(within(form).getByLabelText(/Day/)).toHaveValue('2026-09-30');
    for (const box of within(form).getAllByRole('textbox')) expect(box, box.id).toHaveAttribute('autocomplete', 'off');
  });

  it('sets the length and the person for the minutes by the kind, until the person chooses', async () => {
    const { form } = await openForm();
    await userEvent.click(within(form).getByRole('button', { name: 'More' }));
    expect(field(form, 'Length')).toHaveDisplayValue('1 h');
    expect(field(form, 'Minutes by')).toHaveDisplayValue('Faisal Al-Harbi');
    await userEvent.selectOptions(field(form, 'Kind'), 'team');
    expect(field(form, 'Length')).toHaveDisplayValue('30 min');
    expect(field(form, 'Minutes by')).toHaveDisplayValue('Nobody');
    await userEvent.selectOptions(field(form, 'Kind'), 'site_visit');
    expect(field(form, 'Length')).toHaveDisplayValue('2 h');
    expect(field(form, 'Minutes by')).toHaveDisplayValue('Faisal Al-Harbi');
    // A length that the person chose stays when the kind changes.
    await userEvent.selectOptions(field(form, 'Length'), '45');
    await userEvent.selectOptions(field(form, 'Kind'), 'client');
    expect(field(form, 'Length')).toHaveDisplayValue('45 min');
  });

  it('starts the place of a site visit with the address of the project pin, and keeps a place that the person typed', async () => {
    const { form } = await openForm();
    await userEvent.selectOptions(field(form, 'Project'), 'prj_001');
    await userEvent.selectOptions(field(form, 'Kind'), 'site_visit');
    const where = within(form).getByRole('textbox', { name: 'Where' });
    expect(where).toHaveValue('Al Khobar, Corniche');
    await userEvent.clear(where);
    await userEvent.type(where, 'The north gate');
    await userEvent.selectOptions(field(form, 'Kind'), 'client');
    expect(where).toHaveValue('The north gate');
  });

  it('says who sees a meeting with no project', async () => {
    const { form } = await openForm();
    expect(field(form, 'Project')).toHaveDisplayValue('No project (office meeting)');
    expect(within(form).getByText('Only you and the people you choose see a meeting with no project.')).toBeInTheDocument();
    await userEvent.selectOptions(field(form, 'Project'), 'prj_001');
    expect(within(form).queryByText('Only you and the people you choose see a meeting with no project.')).toBeNull();
  });

  it('plans the meeting with the chosen project and people, and offers Undo', async () => {
    const { form, store } = await openForm();
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Review the facade');
    await userEvent.selectOptions(field(form, 'Project'), 'prj_001');
    await userEvent.click(within(within(form).getByRole('group', { name: 'People' })).getByRole('checkbox', { name: /Sara Al-Qahtani/ }));
    expect(within(form).getByText(/1 person chosen/)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Plan meeting' }));
    await waitFor(() => expect(Object.keys(store.state.meetings ?? {})).toHaveLength(1));
    const made = Object.values(store.state.meetings!)[0];
    expect(made).toMatchObject({
      kind: 'meeting', title: 'Review the facade', projectId: 'prj_001', organizerId: 'usr_002', attendeeIds: ['usr_005'], minutesById: 'usr_002',
      startsAt: '2026-09-30T10:00:00.000+03:00', endsAt: '2026-09-30T11:00:00.000+03:00', status: 'scheduled',
    });
    expect(await screen.findByText('Meeting planned.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Plan a meeting' })).toBeNull());
    expect(await screen.findByText('Review the facade')).toBeInTheDocument();
  });

  it('waits for a title before the main button works', async () => {
    const { form } = await openForm();
    expect(within(form).getByRole('button', { name: 'Plan meeting' })).toBeDisabled();
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'x');
    expect(within(form).getByRole('button', { name: 'Plan meeting' })).toBeEnabled();
  });

  it('shows a refusal of the server in the form, in its own words', async () => {
    const { form, store } = await openForm();
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Too old');
    fireEvent.change(within(form).getByLabelText(/Day/), { target: { value: '2026-09-01' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Plan meeting' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('A meeting cannot start more than 14 days ago.');
    expect(store.state.meetings ?? {}).toEqual({});
    // The sheet stays open, so the person corrects the day.
    expect(screen.getByRole('dialog', { name: 'Plan a meeting' })).toBeInTheDocument();
  });
});

describe('the Edit meeting sheet', () => {
  const edit = (state: State, over: Partial<Meeting> = {}) => {
    as('usr_002')(state);
    withMeeting(state, { id: 'mtg_001', title: 'Review the facade', where: 'Client office', attendeeIds: ['usr_005'], notes: 'Old note', ...over });
  };

  async function openEdit(over: Partial<Meeting> = {}) {
    const app = await renderApp('/meetings?meeting=mtg_001', (state) => edit(state, over));
    const sheet = await screen.findByRole('dialog', { name: 'Review the facade' });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Meeting actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('dialog', { name: 'Edit meeting' });
    return { ...app, form };
  }

  it('shows the meeting in the fields, and offers no Project', async () => {
    const { form } = await openEdit();
    expect(within(form).getByRole('textbox', { name: /Title/ })).toHaveValue('Review the facade');
    expect(field(form, 'Time')).toHaveValue('14:00');
    expect(field(form, 'Length')).toHaveDisplayValue('1 h');
    expect(within(form).queryByRole('combobox', { name: 'Project' })).toBeNull();
    expect(within(form).getByRole('checkbox', { name: /Sara Al-Qahtani/ })).toBeChecked();
    expect(within(form).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('says that the attendees get a notice when the time moves, and sends only what changed', async () => {
    const { form, store } = await openEdit();
    expect(within(form).queryByText('The attendees get a notice.')).toBeNull();
    await userEvent.selectOptions(field(form, 'Time'), '15:00');
    expect(within(form).getByText('The attendees get a notice.')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.startsAt).toBe('2026-09-30T15:00:00.000+03:00'));
    expect(store.state.meetings!.mtg_001).toMatchObject({ endsAt: '2026-09-30T16:00:00.000+03:00', where: 'Client office', notes: 'Old note', rev: 2 });
    expect(await screen.findByText('Meeting saved.')).toBeInTheDocument();
  });

  it('writes nothing when nothing changed', async () => {
    const { form, store } = await openEdit();
    const before = Object.keys(store.state.events).length;
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit meeting' })).toBeNull());
    expect(Object.keys(store.state.events)).toHaveLength(before);
    expect(store.state.meetings!.mtg_001.rev).toBe(1);
  });

  it('changes the notes of a meeting that is over, and nothing else', async () => {
    const { form, store } = await openEdit({ startsAt: '2026-09-29T10:00:00.000+03:00', endsAt: '2026-09-29T11:00:00.000+03:00' });
    expect(within(form).getByText('This meeting is over. Only its notes change.')).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: /Title/ })).toBeDisabled();
    expect(field(form, 'Time')).toBeDisabled();
    const notes = within(form).getByRole('textbox', { name: 'Notes' });
    expect(notes).toBeEnabled();
    await userEvent.clear(notes);
    await userEvent.type(notes, 'We agreed on option B.');
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.notes).toBe('We agreed on option B.'));
    expect(store.state.meetings!.mtg_001.startsAt).toBe('2026-09-29T10:00:00.000+03:00');
  });
});
