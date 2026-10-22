import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { initI18n } from '../../i18n';
import { setNow } from '../../lib/dates';
import { phoneMedia } from '../../test/phoneMedia';
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
    expect(rows.map((row) => row.textContent)).toEqual(['11:00 AMWeekly team meeting', '2:00 PMReview the facade']);
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

// Direction D: on a phone each row adds the kind and the project, a chevron, and a Join button near the start. "Now" is 09:00 Riyadh.
describe('the Meetings card on a phone', () => {
  const LINK = 'https://meet.example.com/abc';
  const rowOf = (title: string) => screen.getByText(title).closest('a')!;
  /** One meeting of Faisal today with a place, seen on a phone. */
  async function phoneWith(from: string, to: string, where: string, over: Record<string, unknown> = {}) {
    phoneMedia(true);
    await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', from, to, { title: 'Review the facade', where, ...over });
    });
    await screen.findByRole('region', { name: 'Meetings today' });
  }

  it('adds the kind and the project name under the title, and a chevron at the end', async () => {
    phoneMedia(true);
    await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', '14:00', '15:00', { title: 'Review the facade' });
      today(state, 'mtg_002', '11:00', '11:30', { title: 'Weekly team meeting', kind: 'team', projectId: null });
    });
    await screen.findByRole('region', { name: 'Meetings today' });
    expect(rowOf('Review the facade')).toHaveTextContent('Client meeting · Corniche Office Tower');
    expect(rowOf('Weekly team meeting')).toHaveTextContent(/Team meeting$/);
    expect(rowOf('Weekly team meeting')).not.toHaveTextContent('Office');
    expect(rowOf('Review the facade').closest('li')!.querySelector('[data-animated-icon]')).not.toBeNull();
  });

  it('shows Join from 30 minutes before the start, for an https link only', async () => {
    await phoneWith('09:30', '10:00', LINK);
    const join = screen.getByRole('link', { name: 'Join Review the facade' });
    expect(join).toHaveTextContent('Join');
    expect(join).toHaveAttribute('href', LINK);
    expect(join).toHaveAttribute('target', '_blank');
    expect(join).toHaveAttribute('rel', 'noopener noreferrer');
    expect(join.closest('a[href*="meeting="]')).toBeNull();
    expect(join.className).not.toContain('signature');
    expect(join.className).not.toContain('bg-signature');
  });

  it('shows no Join 31 minutes before the start', async () => {
    await phoneWith('09:31', '10:00', LINK);
    expect(screen.queryByRole('link', { name: /^Join/ })).toBeNull();
  });

  it('shows Join on a meeting that is on now', async () => {
    await phoneWith('08:30', '09:30', LINK);
    expect(screen.getByRole('link', { name: 'Join Review the facade' })).toBeInTheDocument();
  });

  it.each([
    ['an http link', 'http://meet.example.com/a'],
    ['a javascript link', 'javascript:alert(1)'],
    ['a room name', 'Meeting room 2'],
  ])('shows no Join for %s', async (_name, where) => {
    await phoneWith('09:10', '09:40', where);
    expect(screen.queryByRole('link', { name: /^Join/ })).toBeNull();
  });

  it('shows Join when a phone left open passes the 30-minute point', async () => {
    const ticks: Array<() => void> = [];
    const real = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 60_000) ticks.push(fn);
      return real(fn, ms);
    }) as typeof window.setInterval);
    await phoneWith('09:45', '10:15', LINK);
    expect(screen.queryByRole('link', { name: /^Join/ })).toBeNull();
    setNow(new Date('2026-09-30T09:20:00.000+03:00'));
    act(() => { ticks.forEach((tick) => tick()); });
    expect(await screen.findByRole('link', { name: 'Join Review the facade' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('still opens the sheet on Work, Meetings from the row', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', '14:00', '15:00', { title: 'Review the facade' });
    });
    await userEvent.click(await screen.findByRole('link', { name: /Review the facade/ }));
    expect(router.state.location.pathname).toBe('/meetings');
    expect(router.state.location.search).toBe('?meeting=mtg_001');
    expect(await screen.findByRole('dialog', { name: 'Review the facade' })).toBeInTheDocument();
  });

  it('keeps long names on one line, and the Join button at its size', async () => {
    await phoneWith('09:10', '09:40', LINK, { title: 'A very long title of a meeting that goes on and on and on' });
    const row = rowOf('A very long title of a meeting that goes on and on and on');
    const title = within(row).getByText('A very long title of a meeting that goes on and on and on');
    expect(title.className).toContain('truncate');
    expect(title.className).toContain('min-w-0');
    const subline = within(row).getByText(/Client meeting/);
    expect(subline.className).toContain('truncate');
    expect(subline.className).toContain('min-w-0');
    const join = screen.getByRole('link', { name: /^Join/ });
    expect(join.className).toContain('shrink-0');
    expect(join.className).toContain('min-h-11');
  });

  it('keeps the desk row as it is: no subline, no chevron, no Join', async () => {
    phoneMedia(false);
    await renderApp('/', (state) => {
      as('usr_002')(state);
      today(state, 'mtg_001', '09:10', '09:40', { title: 'Review the facade', where: LINK });
    });
    await screen.findByRole('region', { name: 'Meetings today' });
    const row = rowOf('Review the facade');
    expect(row).toHaveTextContent(/^9:10 AMReview the facade$/);
    expect(row.closest('li')!.querySelector('[data-animated-icon]')).toBeNull();
    expect(screen.queryByRole('link', { name: /^Join/ })).toBeNull();
  });

  it('has the Join label in Arabic', () => {
    expect(initI18n('en').getFixedT('ar')('phoneToday.joinLabel', { title: 'X' })).toBe('انضم إلى X');
    expect(initI18n('en').getFixedT('en')('phoneToday.joinLabel', { title: 'X' })).toBe('Join X');
  });
});
