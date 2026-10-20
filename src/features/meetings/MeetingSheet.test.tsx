import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Meeting } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { formatDay } from '../../lib/dates';
import { renderApp } from '../../test/render';
import { as, ENDED, SOME_MINUTES, withLine, withMeeting, withSeries } from './testMeetings';

/**
 * The sheet of one meeting (fbk_022). "Now" is Wednesday 2026-09-30 09:00 in Riyadh. usr_002 (Faisal) leads prj_001, usr_005 (Sara)
 * and usr_006 (Yousef) are on its team, usr_004 (Omar) is on no team, and usr_001 (Hala) is the Admin.
 */
const LINK = 'https://meet.example.com/abc';

function client(state: State, over: Partial<Meeting> = {}): void {
  as('usr_002')(state);
  withMeeting(state, { id: 'mtg_001', title: 'Review the facade', attendeeIds: ['usr_005', 'usr_006'], where: 'Client office, Al Khobar', guests: 'The owner', notes: 'Bring the studies.', ...over });
}

const sheet = () => screen.findByRole('dialog', { name: 'Review the facade' });

describe('the meeting sheet', () => {
  it('shows the kind, the day and time, the place, the project, the people and the notes, and no person for the minutes', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state));
    const box = await sheet();
    expect(within(box).getByText('Client meeting')).toBeInTheDocument();
    expect(within(box).getByText(formatDay('2026-09-30', 'en', 'withWeekday'))).toBeInTheDocument();
    expect(within(box).getByText('14:00 to 15:00')).toBeInTheDocument();
    expect(within(box).getByText('Client office, Al Khobar')).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: /Corniche Office Tower/ })).toHaveAttribute('href', '#/projects/prj_001');
    // Faisal is the organizer: his name shows once. Any attendee writes the minutes (owner, 2026-10-19).
    expect(within(box).getAllByText('Faisal Al-Harbi')).toHaveLength(1);
    expect(within(box).getByText('Sara Al-Qahtani')).toBeInTheDocument();
    expect(within(box).getByText('Yousef Saleh')).toBeInTheDocument();
    expect(within(box).queryByText('Minutes by')).toBeNull();
    expect(within(box).getByText('The owner')).toBeInTheDocument();
    expect(within(box).getByText('Bring the studies.')).toBeInTheDocument();
  });

  it('shows Join when the place is a link and the meeting starts in 30 minutes or less', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state, { where: LINK, startsAt: '2026-09-30T09:20:00.000+03:00', endsAt: '2026-09-30T10:00:00.000+03:00' }));
    const join = await within(await sheet()).findByRole('link', { name: 'Join' });
    expect(join).toHaveAttribute('href', LINK);
    expect(join).toHaveAttribute('target', '_blank');
    expect(join.getAttribute('rel')).toContain('noopener');
  });

  it('shows Join while the meeting is in progress, and no button for a link that starts later', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state, { where: LINK, startsAt: '2026-09-30T08:30:00.000+03:00', endsAt: '2026-09-30T09:30:00.000+03:00' }));
    expect(await within(await sheet()).findByRole('link', { name: 'Join' })).toBeInTheDocument();
  });

  it('shows no main button for a link that is more than 30 minutes away', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state, { where: LINK }));
    const box = await sheet();
    expect(within(box).queryByRole('link', { name: 'Join' })).toBeNull();
    expect(box.querySelectorAll('.signature')).toHaveLength(0);
  });

  it('shows Open in Google Maps for a site visit of a project with a pin', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      client(state, { kind: 'site_visit' });
      state.projects.prj_001.geo = { lat: 26.3, lng: 50.2 };
    });
    const maps = await within(await sheet()).findByRole('link', { name: 'Open in Google Maps' });
    expect(maps).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=26.3,50.2');
    expect(maps.className).toContain('signature');
  });

  it('shows the quiet team meeting link for a team meeting', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state, { kind: 'team' }));
    const link = await within(await sheet()).findByRole('link', { name: 'Open the team meeting view' });
    expect(link).toHaveAttribute('href', '#/dashboard/meeting');
  });

  it('says that a meeting with no project is private to its people', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state, { projectId: null }));
    const box = await sheet();
    expect(within(box).getByText('Office meeting. Only its people see it.')).toBeInTheDocument();
    expect(within(box).queryByRole('link', { name: /Corniche/ })).toBeNull();
  });

  it('gives the menu with Edit and Cancel to the organizer', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state));
    await userEvent.click(await within(await sheet()).findByRole('button', { name: 'Meeting actions' }));
    const menu = await screen.findByRole('menu', { name: 'Meeting actions' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Cancel meeting']);
  });

  it('gives an attendee no menu', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      client(state);
      as('usr_005')(state);
    });
    const box = await sheet();
    await within(box).findByText('Bring the studies.');
    expect(within(box).queryByRole('button', { name: 'Meeting actions' })).toBeNull();
  });

  it('asks before it cancels, keeps the focus on Keep meeting, and offers Undo', async () => {
    const { store } = await renderApp('/meetings?meeting=mtg_001', (state) => client(state));
    await userEvent.click(await within(await sheet()).findByRole('button', { name: 'Meeting actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel meeting' }));
    const confirm = await screen.findByRole('dialog', { name: 'Cancel this meeting?' });
    expect(within(confirm).getByText('The people of the meeting get a notice.')).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Keep meeting' })).toHaveFocus();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel meeting' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.status).toBe('cancelled'));
    expect(await screen.findByText('Meeting cancelled.')).toBeInTheDocument();
    // The sheet is still open, and a modal sheet blocks the pointer in the page. The toast works in a browser (isToastPress).
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.status).toBe('scheduled'));
  });

  it('keeps the meeting when the person presses Keep meeting', async () => {
    const { store } = await renderApp('/meetings?meeting=mtg_001', (state) => client(state));
    await userEvent.click(await within(await sheet()).findByRole('button', { name: 'Meeting actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel meeting' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep meeting' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cancel this meeting?' })).toBeNull());
    expect(store.state.meetings!.mtg_001.status).toBe('scheduled');
  });

  it('shows a cancelled meeting as Cancelled, with no menu and no main button', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state, { status: 'cancelled', where: LINK }));
    const box = await sheet();
    expect(await within(box).findByText(/Cancelled/)).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: 'Meeting actions' })).toBeNull();
    expect(within(box).queryByRole('link', { name: 'Join' })).toBeNull();
  });

  it('reads a private meeting of other people as gone', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      client(state, { projectId: null });
      as('usr_004')(state);
    });
    expect(await screen.findByText('This meeting is not available.')).toBeInTheDocument();
    expect(screen.queryByText('Review the facade')).toBeNull();
  });
});

/**
 * The minutes on the meeting sheet (wave 2, owner 2026-10-19). After the end, one quiet "Add the minutes" button on the meeting until
 * someone writes them: no task, no notice, no main button. Sara (usr_005) attends; Yousef (usr_006) is on the team and did not attend.
 */
describe('the minutes on the meeting sheet', () => {
  const ended = (state: State, over: Partial<Meeting> = {}) => client(state, { ...ENDED, attendeeIds: ['usr_005'], ...over });
  const add = (box: HTMLElement) => within(box).queryByRole('button', { name: 'Add the minutes' });

  it('shows one quiet Add the minutes button to an attendee after the end, and it is no main button', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state);
      as('usr_005')(state);
    });
    const box = await sheet();
    const button = await within(box).findByRole('button', { name: 'Add the minutes' });
    expect(button.className).not.toContain('signature');
    expect(box.querySelectorAll('.signature')).toHaveLength(0);
  });

  it('shows it to the organizer and to the leader of a project meeting who did not attend, and to the Admin', async () => {
    for (const person of ['usr_002', 'usr_001']) {
      const { unmount } = await renderApp('/meetings?meeting=mtg_001', (state) => {
        ended(state, { organizerId: 'usr_005', attendeeIds: [] });
        as(person)(state);
      });
      expect(await within(await sheet()).findByRole('button', { name: 'Add the minutes' }), person).toBeInTheDocument();
      unmount();
    }
  });

  it('shows it not before the end, not for a cancelled meeting, and not to a team member who did not attend', async () => {
    const before = await renderApp('/meetings?meeting=mtg_001', (state) => {
      client(state, { attendeeIds: ['usr_005'] });
      as('usr_005')(state);
    });
    const early = await sheet();
    await within(early).findByText('Bring the studies.');
    expect(add(early)).toBeNull();
    before.unmount();
    const cancelled = await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state, { status: 'cancelled' });
      as('usr_005')(state);
    });
    const box = await sheet();
    await within(box).findByText(/Cancelled/);
    expect(add(box)).toBeNull();
    cancelled.unmount();
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state);
      as('usr_006')(state);
    });
    const other = await sheet();
    await within(other).findByText('Bring the studies.');
    expect(add(other)).toBeNull();
    expect(within(other).queryByRole('button', { name: 'Edit the minutes' })).toBeNull();
  });

  it('shows the minutes with the writer and the day, a quiet Edit for the people who may, and no Add button', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state, { kind: 'team', minutes: SOME_MINUTES });
      as('usr_005')(state);
    });
    const box = await sheet();
    const text = await within(box).findByText(/We agreed on the facade/);
    expect(text).toHaveAttribute('dir', 'auto');
    expect(text.className).toContain('whitespace-pre-wrap');
    expect(within(box).getByText('Minutes')).toBeInTheDocument();
    expect(within(box).getByText(/By Faisal Al-Harbi, /)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Edit the minutes' })).toBeInTheDocument();
    expect(add(box)).toBeNull();
    expect(box.querySelectorAll('.signature')).toHaveLength(0);
  });

  it('shows the minutes to a team member who did not attend, without a button', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state, { kind: 'team', minutes: SOME_MINUTES });
      as('usr_006')(state);
    });
    const box = await sheet();
    await within(box).findByText(/We agreed on the facade/);
    expect(within(box).queryByRole('button', { name: 'Edit the minutes' })).toBeNull();
    expect(add(box)).toBeNull();
  });

  it('shows the Open in the Tracker link for a project meeting whose minutes stand on its line', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state);
      withLine(state, { minutes: SOME_MINUTES });
      as('usr_005')(state);
    });
    const box = await sheet();
    const link = await within(box).findByRole('link', { name: 'Open in the Tracker' });
    expect(link).toHaveAttribute('href', '#/projects/prj_001?tab=tracker&entry=trk_900');
    expect(link.className).not.toContain('signature');
    expect(box.querySelectorAll('.signature')).toHaveLength(0);
  });

  it('shows no Tracker link for a team meeting or a meeting with no project, whose minutes stand on the meeting', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state, { projectId: null, minutes: SOME_MINUTES });
      as('usr_005')(state);
    });
    const box = await sheet();
    await within(box).findByText(/We agreed on the facade/);
    expect(within(box).queryByRole('link', { name: 'Open in the Tracker' })).toBeNull();
  });

  it('opens the Minutes sheet from the button, and a person who cannot see a private meeting reads it as gone', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => {
      ended(state);
      as('usr_005')(state);
    });
    await userEvent.click(await within(await sheet()).findByRole('button', { name: 'Add the minutes' }));
    expect(await screen.findByRole('dialog', { name: 'Minutes of “Review the facade”' })).toBeInTheDocument();
  });
});


describe('the sheet of a meeting that repeats (wave 3)', () => {
  const series = (state: State, every: 'day' | 'week' | 'two_weeks' = 'week', over: Partial<Meeting> = {}) => {
    as('usr_002')(state);
    withSeries(state, 4, { title: 'Review the facade', attendeeIds: ['usr_005'], ...over }, every);
  };

  it('says how the meeting repeats, in one quiet line under the time', async () => {
    await renderApp('/meetings?meeting=mtg_002', (state) => series(state));
    const box = await sheet();
    expect(within(box).getByText('Repeats every week')).toBeInTheDocument();
  });

  it('says every day as Sunday to Thursday, and every 2 weeks', async () => {
    const day = await renderApp('/meetings?meeting=mtg_002', (state) => series(state, 'day'));
    expect(within(await sheet()).getByText('Repeats every day, Sunday to Thursday')).toBeInTheDocument();
    day.unmount();
    await renderApp('/meetings?meeting=mtg_002', (state) => series(state, 'two_weeks'));
    expect(within(await sheet()).getByText('Repeats every 2 weeks')).toBeInTheDocument();
  });

  it('names the last day when the rule has one', async () => {
    await renderApp('/meetings?meeting=mtg_002', (state) => series(state, 'week', { repeat: { every: 'week', until: '2026-10-28' } }));
    expect(within(await sheet()).getByText(`Repeats every week, until ${formatDay('2026-10-28', 'en', 'short')}`)).toBeInTheDocument();
  });

  it('shows no repeat line for a meeting in no series', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state));
    const box = await sheet();
    expect(within(box).queryByText(/Repeats/)).toBeNull();
  });

  async function openCancel(id = 'mtg_002') {
    const app = await renderApp(`/meetings?meeting=${id}`, (state) => series(state));
    const box = await sheet();
    await userEvent.click(await within(box).findByRole('button', { name: 'Meeting actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel meeting' }));
    const ask = await screen.findByRole('dialog', { name: 'Cancel which meetings?' });
    return { ...app, ask };
  }

  it('asks which meetings to cancel, in place of the plain question, and cancels this meeting alone', async () => {
    const { ask, store } = await openCancel();
    expect(screen.queryByRole('dialog', { name: 'Cancel this meeting?' })).toBeNull();
    await userEvent.click(within(ask).getByRole('button', { name: 'This meeting' }));
    await waitFor(() => expect(store.state.meetings!.mtg_002.status).toBe('cancelled'));
    expect(['mtg_001', 'mtg_003', 'mtg_004'].map((id) => store.state.meetings![id].status)).toEqual(['scheduled', 'scheduled', 'scheduled']);
    expect(await screen.findByText('Meeting cancelled.')).toBeInTheDocument();
  });

  it('cancels this and the later meetings, tells so, and takes it all back with Undo', async () => {
    const { ask, store } = await openCancel();
    await userEvent.click(within(ask).getByRole('button', { name: 'This and later meetings' }));
    await waitFor(() => expect(store.state.meetings!.mtg_004.status).toBe('cancelled'));
    expect(['mtg_001', 'mtg_002', 'mtg_003', 'mtg_004'].map((id) => store.state.meetings![id].status)).toEqual(['scheduled', 'cancelled', 'cancelled', 'cancelled']);
    expect(await screen.findByText('Meetings cancelled.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.meetings!.mtg_004.status).toBe('scheduled'));
    expect(['mtg_002', 'mtg_003'].map((id) => store.state.meetings![id].status)).toEqual(['scheduled', 'scheduled']);
  });

  it('keeps the meeting when the question is closed', async () => {
    const { store } = await openCancel();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cancel which meetings?' })).toBeNull());
    expect(store.state.meetings!.mtg_002.status).toBe('scheduled');
  });

  it('writes the repeat line, the question and the buttons in Arabic, with Western digits', async () => {
    await renderApp('/meetings?meeting=mtg_002', (state) => {
      series(state, 'week', { repeat: { every: 'week', until: '2026-10-28' } });
      state.users.usr_002.preferences.language = 'ar';
    });
    const box = await screen.findByRole('dialog', { name: 'Review the facade' });
    const line = await within(box).findByText(/^يتكرر كل أسبوع، حتى/);
    expect(line.textContent).not.toMatch(/[٠-٩]/);
    await userEvent.click(within(box).getByRole('button', { name: 'خيارات الاجتماع' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'إلغاء الاجتماع' }));
    const ask = await screen.findByRole('dialog', { name: 'أي اجتماعات تريد إلغاءها؟' });
    expect(within(ask).getByRole('button', { name: 'هذا الاجتماع' })).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'هذا الاجتماع والاجتماعات اللاحقة' })).toBeInTheDocument();
  });

  it('keeps the plain question for a meeting in no series', async () => {
    await renderApp('/meetings?meeting=mtg_001', (state) => client(state));
    const box = await sheet();
    await userEvent.click(await within(box).findByRole('button', { name: 'Meeting actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel meeting' }));
    expect(await screen.findByRole('dialog', { name: 'Cancel this meeting?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Cancel which meetings?' })).toBeNull();
  });
});
