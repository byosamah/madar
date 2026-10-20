import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Meeting } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { as, withMeeting, withSeries } from './testMeetings';

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
    // The minutes need no person: any attendee writes them (owner, 2026-10-19).
    expect(within(form).queryByRole('combobox', { name: 'Minutes by' })).toBeNull();
    expect(within(form).queryByRole('textbox', { name: 'Guests' })).toBeNull();
    const more = within(form).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(form).queryByRole('combobox', { name: 'Minutes by' })).toBeNull();
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

  it('sets the length by the kind, until the person chooses', async () => {
    const { form } = await openForm();
    expect(field(form, 'Length')).toHaveDisplayValue('1 h');
    await userEvent.selectOptions(field(form, 'Kind'), 'team');
    expect(field(form, 'Length')).toHaveDisplayValue('30 min');
    await userEvent.selectOptions(field(form, 'Kind'), 'site_visit');
    expect(field(form, 'Length')).toHaveDisplayValue('2 h');
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
      kind: 'meeting', title: 'Review the facade', projectId: 'prj_001', organizerId: 'usr_002', attendeeIds: ['usr_005'],
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

describe('Repeat and Until in the New meeting sheet (wave 3)', () => {
  const more = async (form: HTMLElement) => userEvent.click(within(form).getByRole('button', { name: 'More' }));

  it('keeps Repeat under More with three choices, and shows Until only when a repeat is chosen', async () => {
    const { form } = await openForm();
    expect(within(form).queryByRole('combobox', { name: 'Repeat' })).toBeNull();
    await more(form);
    const repeat = field(form, 'Repeat');
    expect(repeat).toHaveDisplayValue('Does not repeat');
    expect([...repeat.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Does not repeat', 'Every day (Sunday to Thursday)', 'Every week', 'Every 2 weeks']);
    expect(within(form).queryByLabelText(/Until/)).toBeNull();
    await userEvent.selectOptions(repeat, 'week');
    const until = within(form).getByLabelText(/Until/);
    // The last day is at most 400 days after the day of the first meeting, and not before it.
    expect(until).toHaveAttribute('min', '2026-09-30');
    expect(until).toHaveAttribute('max', '2027-11-04');
    expect(within(form).getByText('The last day. Leave it empty to repeat with no end.')).toBeInTheDocument();
    await userEvent.selectOptions(repeat, '');
    expect(within(form).queryByLabelText(/Until/)).toBeNull();
  });

  it('still shows the eight controls and one button when the fold is closed', async () => {
    const { form } = await openForm();
    expect(within(form).queryByRole('combobox', { name: 'Repeat' })).toBeNull();
    expect(within(form).getAllByRole('button', { name: 'Plan meeting' })).toHaveLength(1);
  });

  it('plans a meeting that repeats every week with no end, and makes the first 8 meetings', async () => {
    const { form, store } = await openForm();
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Weekly review');
    await more(form);
    await userEvent.selectOptions(field(form, 'Repeat'), 'week');
    await userEvent.click(within(form).getByRole('button', { name: 'Plan meeting' }));
    await waitFor(() => expect(Object.keys(store.state.meetings ?? {})).toHaveLength(8));
    const list = Object.values(store.state.meetings!).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(list.map((meeting) => meeting.startsAt.slice(0, 10))).toEqual(['2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18']);
    expect(list.every((meeting) => meeting.seriesId === list[0].id && meeting.repeat?.every === 'week' && meeting.repeat.until === null)).toBe(true);
    expect(await screen.findByText('Meeting planned.')).toBeInTheDocument();
  });

  it('plans a series with a last day', async () => {
    const { form, store } = await openForm();
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Daily stand-up');
    await more(form);
    await userEvent.selectOptions(field(form, 'Repeat'), 'day');
    fireEvent.change(within(form).getByLabelText(/Until/), { target: { value: '2026-10-07' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Plan meeting' }));
    await waitFor(() => expect(Object.keys(store.state.meetings ?? {}).length).toBeGreaterThan(0));
    const list = Object.values(store.state.meetings!).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    // Wednesday 2026-09-30 to Wednesday 2026-10-07, Sunday to Thursday: 30 Sep, 1 Oct, 4, 5, 6 and 7 Oct.
    expect(list.map((meeting) => meeting.startsAt.slice(0, 10))).toEqual(['2026-09-30', '2026-10-01', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    expect(list[0].repeat).toEqual({ every: 'day', until: '2026-10-07' });
  });

  it('plans one meeting, with no series, when Repeat stays at "Does not repeat"', async () => {
    const { form, store } = await openForm();
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Once');
    await more(form);
    await userEvent.click(within(form).getByRole('button', { name: 'Plan meeting' }));
    await waitFor(() => expect(Object.keys(store.state.meetings ?? {})).toHaveLength(1));
    expect(Object.values(store.state.meetings!)[0]).not.toHaveProperty('seriesId');
  });

  it('shows a refusal of the last day in the form, in its own words', async () => {
    const { form, store } = await openForm();
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), 'Weekly');
    await more(form);
    await userEvent.selectOptions(field(form, 'Repeat'), 'week');
    fireEvent.change(within(form).getByLabelText(/Until/), { target: { value: '2026-09-29' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Plan meeting' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('The last day comes before the first meeting. Choose a later day.');
    expect(store.state.meetings ?? {}).toEqual({});
  });
});

describe('the Edit meeting sheet of a meeting that repeats (wave 3)', () => {
  const edit = (state: State) => {
    as('usr_002')(state);
    withSeries(state, 4, { title: 'Review the facade', where: 'Client office', attendeeIds: ['usr_005'], notes: '' });
  };

  async function openEdit(id = 'mtg_002') {
    const app = await renderApp(`/meetings?meeting=${id}`, edit);
    const sheet = await screen.findByRole('dialog', { name: 'Review the facade' });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Meeting actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('dialog', { name: 'Edit meeting' });
    return { ...app, form };
  }

  it('offers no Repeat: the rule of a series is fixed', async () => {
    const { form } = await openEdit();
    await userEvent.click(within(form).getByRole('button', { name: 'More' }));
    expect(within(form).queryByRole('combobox', { name: 'Repeat' })).toBeNull();
    expect(within(form).queryByLabelText(/Until/)).toBeNull();
  });

  it('asks which meetings after Save, and changes this meeting alone with "This meeting"', async () => {
    const { form, store } = await openEdit();
    const where = within(form).getByRole('textbox', { name: 'Where' });
    await userEvent.clear(where);
    await userEvent.type(where, 'Room 9');
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    const ask = await screen.findByRole('dialog', { name: 'Change which meetings?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'This meeting' }));
    await waitFor(() => expect(store.state.meetings!.mtg_002.where).toBe('Room 9'));
    expect(['mtg_001', 'mtg_003', 'mtg_004'].map((id) => store.state.meetings![id].where)).toEqual(['Client office', 'Client office', 'Client office']);
    expect(await screen.findByText('Meeting saved.')).toBeInTheDocument();
  });

  it('changes this and the later meetings with "This and later meetings", and not the earlier one', async () => {
    const { form, store } = await openEdit();
    const where = within(form).getByRole('textbox', { name: 'Where' });
    await userEvent.clear(where);
    await userEvent.type(where, 'Room 9');
    await userEvent.selectOptions(field(form, 'Time'), '16:00');
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    const ask = await screen.findByRole('dialog', { name: 'Change which meetings?' });
    expect(within(ask).getByRole('button', { name: 'This and later meetings' })).toBeEnabled();
    await userEvent.click(within(ask).getByRole('button', { name: 'This and later meetings' }));
    await waitFor(() => expect(store.state.meetings!.mtg_004.where).toBe('Room 9'));
    expect(['mtg_001', 'mtg_002', 'mtg_003', 'mtg_004'].map((id) => store.state.meetings![id].where)).toEqual(['Client office', 'Room 9', 'Room 9', 'Room 9']);
    expect(['mtg_001', 'mtg_002', 'mtg_003', 'mtg_004'].map((id) => store.state.meetings![id].startsAt.slice(11, 16))).toEqual(['14:00', '16:00', '16:00', '16:00']);
    expect(await screen.findByText('Meetings saved.')).toBeInTheDocument();
  });

  it('turns off the later choice when the change moves the meeting to a new day', async () => {
    const { form, store } = await openEdit();
    fireEvent.change(within(form).getByLabelText(/Day/), { target: { value: '2026-10-09' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    const ask = await screen.findByRole('dialog', { name: 'Change which meetings?' });
    expect(within(ask).getByRole('button', { name: 'This and later meetings' })).toBeDisabled();
    expect(within(ask).getByText('A new day changes one meeting at a time.')).toBeInTheDocument();
    await userEvent.click(within(ask).getByRole('button', { name: 'This meeting' }));
    await waitFor(() => expect(store.state.meetings!.mtg_002.startsAt.slice(0, 10)).toBe('2026-10-09'));
    expect(store.state.meetings!.mtg_003.startsAt.slice(0, 10)).toBe('2026-10-14');
  });

  it('closes the question with Escape and changes nothing', async () => {
    const { form, store } = await openEdit();
    const where = within(form).getByRole('textbox', { name: 'Where' });
    await userEvent.clear(where);
    await userEvent.type(where, 'Room 9');
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('dialog', { name: 'Change which meetings?' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change which meetings?' })).toBeNull());
    expect(store.state.meetings!.mtg_002.where).toBe('Client office');
    // The form stays open, so the person can go on.
    expect(screen.getByRole('dialog', { name: 'Edit meeting' })).toBeInTheDocument();
  });

  it('asks nothing when nothing changed', async () => {
    const { form, store } = await openEdit();
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit meeting' })).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Change which meetings?' })).toBeNull();
    expect(store.state.meetings!.mtg_002.rev).toBe(1);
  });

  it('saves a meeting that is in no series at once, with no question', async () => {
    const app = await renderApp('/meetings?meeting=mtg_001', (state) => {
      as('usr_002')(state);
      withMeeting(state, { id: 'mtg_001', title: 'Review the facade', where: 'Client office' });
    });
    const sheet = await screen.findByRole('dialog', { name: 'Review the facade' });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Meeting actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('dialog', { name: 'Edit meeting' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Where' }), ' 2');
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(app.store.state.meetings!.mtg_001.where).toBe('Client office 2'));
    expect(screen.queryByRole('dialog', { name: 'Change which meetings?' })).toBeNull();
  });
});
