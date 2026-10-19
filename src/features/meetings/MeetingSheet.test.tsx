import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Meeting } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { formatDay } from '../../lib/dates';
import { renderApp } from '../../test/render';
import { as, withMeeting } from './testMeetings';

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
