import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { as, withMeeting } from '../meetings/testMeetings';

/**
 * The Home card "Meetings today" (fbk_022): it shows only when the day has a meeting that is still to come or on, with at most three
 * rows and one quiet link. "Now" is Wednesday 2026-09-30 09:00 in Riyadh. usr_002 (Faisal) leads prj_001.
 */
const today = (state: State, id: string, from: string, to: string, over: Record<string, unknown> = {}) =>
  withMeeting(state, { id, title: `Meeting ${id}`, startsAt: `2026-09-30T${from}:00.000+03:00`, endsAt: `2026-09-30T${to}:00.000+03:00`, ...over });

describe('the Meetings card on Home', () => {
  it('shows the meetings of today with their time, and the link to all meetings', async () => {
    await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', '14:00', '15:00', { title: 'Review the facade' });
      today(state, 'mtg_002', '11:00', '11:30', { title: 'Weekly team meeting', kind: 'team', projectId: null });
    });
    const card = await screen.findByRole('region', { name: 'Meetings today' });
    const rows = within(card).getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('meeting='));
    // The earlier meeting comes first.
    expect(rows.map((row) => row.textContent)).toEqual(['11:00Weekly team meeting', '14:00Review the facade']);
    expect(rows[0]).toHaveAttribute('href', '#/meetings?meeting=mtg_002');
    expect(within(card).getByRole('link', { name: 'All meetings' })).toHaveAttribute('href', '#/meetings');
  });

  it('opens the sheet of a meeting from its row', async () => {
    const { router } = await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', '14:00', '15:00', { title: 'Review the facade' });
    });
    await userEvent.click(await screen.findByRole('link', { name: /Review the facade/ }));
    expect(router.state.location.pathname).toBe('/meetings');
    expect(router.state.location.search).toBe('?meeting=mtg_001');
    expect(await screen.findByRole('dialog', { name: 'Review the facade' })).toBeInTheDocument();
  });

  it('is not on Home when the day has no meeting', async () => {
    await renderApp('/', (state) => {
      as('usr_002')(state);
      withMeeting(state, { id: 'mtg_001', startsAt: '2026-10-01T10:00:00.000+03:00', endsAt: '2026-10-01T11:00:00.000+03:00' });
    });
    await screen.findByRole('link', { name: 'See all my to-dos' });
    expect(screen.queryByRole('region', { name: 'Meetings today' })).toBeNull();
  });

  it('leaves out a cancelled meeting and a meeting that is over', async () => {
    await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', '07:00', '08:00', { title: 'Over already' });
      today(state, 'mtg_002', '14:00', '15:00', { title: 'Cancelled one', status: 'cancelled' });
    });
    await screen.findByRole('link', { name: 'See all my to-dos' });
    expect(screen.queryByRole('region', { name: 'Meetings today' })).toBeNull();
  });

  it('keeps a meeting that is on now', async () => {
    await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', '08:30', '09:30', { title: 'On now' });
    });
    expect(await within(await screen.findByRole('region', { name: 'Meetings today' })).findByText('On now')).toBeInTheDocument();
  });

  it('shows three rows at most', async () => {
    await renderApp('/', (state) => {
      as('usr_002')(state);
      for (const [index, hour] of ['10', '11', '12', '13'].entries()) today(state, `mtg_00${index + 1}`, `${hour}:00`, `${hour}:30`);
    });
    const card = await screen.findByRole('region', { name: 'Meetings today' });
    expect(within(card).getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('meeting='))).toHaveLength(3);
  });

  it('shows only the meetings of the person, never a private meeting of other people', async () => {
    await renderApp('/', (state) => {
      as('usr_006')(state);
      today(state, 'mtg_001', '14:00', '15:00', { title: 'Private talk', projectId: null, organizerId: 'usr_002', attendeeIds: ['usr_005'] });
    });
    await screen.findByRole('link', { name: 'See all my to-dos' });
    expect(screen.queryByRole('region', { name: 'Meetings today' })).toBeNull();
    expect(screen.queryByText('Private talk')).toBeNull();
  });
});
