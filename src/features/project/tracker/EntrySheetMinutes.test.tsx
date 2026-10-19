import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Meeting } from '../../../api/contract/entities';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { as, ENDED, SOME_MINUTES, withLine, withMeeting } from '../../meetings/testMeetings';

/**
 * The Minutes part of the Tracker entry sheet (wave 2, owner 2026-10-19). Madar made the line "Review the facade" when the meeting ended; any
 * attendee writes the minutes and they stand on that line. "Now" is Wednesday 2026-09-30 09:00 in Riyadh. Faisal (usr_002) leads prj_001 and
 * organizes the meeting, Sara (usr_005) attends, Yousef (usr_006) is on the team and did not attend.
 */
const TRACKER = '/projects/prj_001?tab=tracker';

function state(person: string, minutes: typeof SOME_MINUTES | null = null, over: Partial<Meeting> = {}) {
  return (s: State) => {
    as(person)(s);
    withMeeting(s, { id: 'mtg_001', title: 'Review the facade', attendeeIds: ['usr_005'], ...ENDED, ...over });
    withLine(s, { minutes });
  };
}

const open = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Review the facade/ }));
  return screen.findByRole('dialog', { name: 'Review the facade' });
};

describe('the Tracker entry sheet of a meeting line', () => {
  it('shows the auto word, the quiet button Add the minutes by canEditMinutes, and the quiet link Open the meeting', async () => {
    await renderApp(TRACKER, state('usr_005'));
    const box = await open();
    expect(within(box).getByText('Added automatically when the meeting ended.')).toBeInTheDocument();
    const add = within(box).getByRole('button', { name: 'Add the minutes' });
    expect(add.className).not.toContain('signature');
    const link = within(box).getByRole('link', { name: 'Open the meeting' });
    expect(link).toHaveAttribute('href', '#/meetings?meeting=mtg_001');
    expect(link.className).not.toContain('signature');
  });

  it('shows the minutes with the writer and the day, and a quiet Edit the minutes', async () => {
    await renderApp(TRACKER, state('usr_005', SOME_MINUTES));
    const box = await open();
    const text = within(box).getByText(/We agreed on the facade/);
    expect(text).toHaveAttribute('dir', 'auto');
    expect(text.className).toContain('whitespace-pre-wrap');
    expect(within(box).getByText(/By Faisal Al-Harbi, /)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Edit the minutes' })).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: 'Add the minutes' })).toBeNull();
  });

  it('gives a team member who did not attend the minutes to read and no button to write them', async () => {
    await renderApp(TRACKER, state('usr_006', SOME_MINUTES));
    const box = await open();
    expect(within(box).getByText(/We agreed on the facade/)).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: 'Edit the minutes' })).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Add the minutes' })).toBeNull();
    // Without minutes the part is empty for this person.
  });

  it('opens the Minutes sheet from the line, and the save puts the minutes on the line', async () => {
    const { store } = await renderApp(TRACKER, state('usr_005'));
    const box = await open();
    await userEvent.click(within(box).getByRole('button', { name: 'Add the minutes' }));
    const sheet = await screen.findByRole('dialog', { name: 'Minutes of “Review the facade”' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'What did you agree, and who does what?' }), 'Written on the line');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(store.state.tracker!.trk_900.minutes?.text).toBe('Written on the line'));
    expect(await screen.findByText('Minutes saved.')).toBeInTheDocument();
  });

  it('shows no minutes part on a line that Madar did not make for a meeting', async () => {
    await renderApp(TRACKER, as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: /Open The client asked to move the lobby entrance/ }));
    const box = await screen.findByRole('dialog', { name: 'The client asked to move the lobby entrance' });
    expect(within(box).queryByText('Minutes')).toBeNull();
    expect(within(box).queryByRole('button', { name: /the minutes/ })).toBeNull();
    expect(within(box).queryByRole('link', { name: 'Open the meeting' })).toBeNull();
  });

  it('shows the small word Minutes on the row of a line that holds minutes, and not on a line without', async () => {
    await renderApp(TRACKER, state('usr_005', SOME_MINUTES));
    const row = (await screen.findByRole('button', { name: /Review the facade/ })).closest('li')!;
    expect(within(row).getByText('Minutes')).toBeInTheDocument();
  });

  it('shows no small word on the row of a line with no minutes yet', async () => {
    await renderApp(TRACKER, state('usr_005'));
    const row = (await screen.findByRole('button', { name: /Review the facade/ })).closest('li')!;
    expect(within(row).queryByText('Minutes')).toBeNull();
  });
});
