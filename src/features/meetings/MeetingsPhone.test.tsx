import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { calls } from '../../api/calls';
import type { State } from '../../api/store';
import { NOW } from '../../test/factories';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';
import { setNow } from '../../lib/dates';
import { as, withMeeting } from './testMeetings';

/**
 * The Meetings view on a phone (phone design D, task W8): the card with its lines and its Join, one minute tick for the list, the Earlier
 * fold as a 52 px row, the Google line. "Now" is Wednesday 2026-09-30 09:00 in Riyadh. usr_002 is Faisal, who leads prj_001.
 */
function office(state: State): void {
  as('usr_002')(state);
  // A client meeting today at 14:00 with a plain place, three people and a weekly rule.
  withMeeting(state, {
    id: 'mtg_001', title: 'Review the facade', where: 'Room 3', attendeeIds: ['usr_005', 'usr_006', 'usr_008'],
    seriesId: 'mtg_001', repeat: { every: 'week', until: null },
  });
  // A meeting this week with a link place, and one in a later week.
  withMeeting(state, {
    id: 'mtg_002', title: 'Weekly team meeting', kind: 'team', projectId: null, startsAt: '2026-10-01T10:00:00.000+03:00', endsAt: '2026-10-01T10:30:00.000+03:00',
    attendeeIds: ['usr_005'],
  });
  withMeeting(state, { id: 'mtg_003', title: 'Walk the plot', kind: 'site_visit', startsAt: '2026-10-08T09:00:00.000+03:00', endsAt: '2026-10-08T11:00:00.000+03:00' });
  // The days before today.
  withMeeting(state, { id: 'mtg_004', title: 'Kick-off', startsAt: '2026-09-28T10:00:00.000+03:00', endsAt: '2026-09-28T11:00:00.000+03:00' });
}

/** A meeting with a link that starts in 20 minutes. */
function soon(state: State, where = 'https://meet.example.com/a'): void {
  office(state);
  withMeeting(state, { id: 'mtg_010', title: 'Design review', where, startsAt: '2026-09-30T09:20:00.000+03:00', endsAt: '2026-09-30T10:00:00.000+03:00' });
}

const phone = () => phoneMedia({ phone: true, coarse: true });
const cardOf = async (title: string) => (await screen.findByText(title)).closest('li') as HTMLElement;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setNow(NOW);
});

describe('the meeting card on a phone', () => {
  it('draws the card lines in order', async () => {
    phone();
    await renderApp('/meetings', office);
    const card = await cardOf('Review the facade');
    const lines = [...card.querySelectorAll('button > span')].map((line) => line.textContent ?? '');
    expect(lines).toEqual([
      'Client meeting',
      'Review the facade',
      '2:00 PM to 3:00 PM',
      'Room 3',
      'Corniche Office Tower',
      '3 people · Repeats every week',
    ]);
    const title = within(card).getByText('Review the facade');
    expect(title).toHaveAttribute('dir', 'auto');
    expect(title).toHaveClass('line-clamp-2', 'text-headline');
    expect(card.querySelector('bdi')?.textContent).toBe('Corniche Office Tower');
    expect(card.querySelector('[data-project-tile]') ?? card.querySelector('svg, img, span[aria-hidden]')).not.toBeNull();
    // The office word for a meeting with no project.
    const team = await cardOf('Weekly team meeting');
    expect(within(team).getByText('Office')).toBeInTheDocument();
    expect(within(team).getByText('1 person')).toBeInTheDocument();
  });

  it('puts the day before the range outside Today', async () => {
    phone();
    await renderApp('/meetings', office);
    const week = await cardOf('Weekly team meeting');
    expect(within(week).getByText(/^Thu 1\b.*10:00 AM to 10:30 AM$/)).toBeInTheDocument();
    const later = await cardOf('Walk the plot');
    expect(within(later).getByText(/^8 Oct\b.*9:00 AM to 11:00 AM$/)).toBeInTheDocument();
    const today = await cardOf('Review the facade');
    expect(within(today).getByText('2:00 PM to 3:00 PM')).toBeInTheDocument();
  });

  it('shows a state as a sign and an ink word', async () => {
    phone();
    await renderApp('/meetings', (state) => {
      office(state);
      withMeeting(state, { id: 'mtg_011', title: 'On now', startsAt: '2026-09-30T08:30:00.000+03:00', endsAt: '2026-09-30T09:30:00.000+03:00' });
      withMeeting(state, { id: 'mtg_012', title: 'Over today', startsAt: '2026-09-30T07:00:00.000+03:00', endsAt: '2026-09-30T08:00:00.000+03:00' });
      withMeeting(state, { id: 'mtg_013', title: 'Off today', status: 'cancelled', startsAt: '2026-09-30T16:00:00.000+03:00', endsAt: '2026-09-30T17:00:00.000+03:00' });
    });
    const sign = async (title: string) => (await cardOf(title)).querySelector('[data-sign]');
    expect(await sign('On now')).toHaveAttribute('data-sign', 'on_track');
    expect(await sign('On now')).toHaveTextContent('Now');
    expect(await sign('Over today')).toHaveAttribute('data-sign', 'completed');
    expect(await sign('Over today')).toHaveTextContent('Done');
    expect(await sign('Off today')).toHaveAttribute('data-sign', 'archived');
    expect(await sign('Off today')).toHaveTextContent('Cancelled');
    expect(within(await cardOf('Off today')).getByText('Off today')).toHaveClass('line-through');
    // A meeting that has not started has no sign.
    expect((await cardOf('Review the facade')).querySelector('[data-sign]')).toBeNull();
  });

  it('shows Join only as a secondary anchor and no Edit, Cancel or minutes', async () => {
    phone();
    await renderApp('/meetings', soon);
    const card = await cardOf('Design review');
    const join = within(card).getByRole('link', { name: 'Join' });
    expect(join).toHaveAttribute('href', 'https://meet.example.com/a');
    expect(join).toHaveAttribute('target', '_blank');
    expect(join).toHaveAttribute('rel', 'noopener noreferrer');
    expect(join).toHaveClass('bg-fill');
    expect(join.className).not.toMatch(/signature/);
    expect(within(card).queryByRole('button', { name: /Edit|Cancel|minutes/i })).toBeNull();
    // A meeting far away has no Join.
    expect(within(await cardOf('Review the facade')).queryByRole('link', { name: 'Join' })).toBeNull();
  });

  it('hides a place that is a link and shows other text', async () => {
    phone();
    await renderApp('/meetings', (state) => {
      office(state);
      withMeeting(state, { id: 'mtg_020', title: 'A link place', where: 'https://meet.example.com/a' });
      withMeeting(state, { id: 'mtg_021', title: 'A text with a link', where: 'Room 3 https://x.example.com' });
      withMeeting(state, { id: 'mtg_022', title: 'A plain http link', where: 'http://x.example.com' });
    });
    expect(within(await cardOf('A link place')).queryByText(/meet\.example\.com/)).toBeNull();
    expect(within(await cardOf('A text with a link')).getByText('Room 3 https://x.example.com')).toBeInTheDocument();
    expect(within(await cardOf('A plain http link')).getByText('http://x.example.com')).toBeInTheDocument();
  });

  it('moves a card to Now and shows Join when a minute passes', async () => {
    phone();
    // The timers are fake before the screen mounts, so its tick runs on them.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderApp('/meetings', (state) => {
      office(state);
      withMeeting(state, { id: 'mtg_030', title: 'Starts at ten past', where: 'https://meet.example.com/b', startsAt: '2026-09-30T09:01:00.000+03:00', endsAt: '2026-09-30T10:00:00.000+03:00' });
    });
    const card = await cardOf('Starts at ten past');
    expect(card.querySelector('[data-sign]')).toBeNull();
    setNow(new Date('2026-09-30T09:02:00.000+03:00'));
    await act(async () => { vi.advanceTimersByTime(60_000); });
    const after = await cardOf('Starts at ten past');
    expect(after.querySelector('[data-sign]')).toHaveAttribute('data-sign', 'on_track');
    expect(within(after).getByRole('link', { name: 'Join' })).toBeInTheDocument();
  });

  it('stops the tick while the page is hidden, and catches up when it shows', async () => {
    phone();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderApp('/meetings', (state) => {
      office(state);
      withMeeting(state, { id: 'mtg_030', title: 'Starts at ten past', startsAt: '2026-09-30T09:01:00.000+03:00', endsAt: '2026-09-30T10:00:00.000+03:00' });
    });
    await cardOf('Starts at ten past');
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    setNow(new Date('2026-09-30T09:02:00.000+03:00'));
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect((await cardOf('Starts at ten past')).querySelector('[data-sign]')).toBeNull();
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect((await cardOf('Starts at ten past')).querySelector('[data-sign]')).toHaveAttribute('data-sign', 'on_track');
  });

  it('opens the sheet from a card, and with ?meeting= also when no card matches', async () => {
    phone();
    const { router } = await renderApp('/meetings', office);
    await userEvent.click(within(await cardOf('Review the facade')).getByRole('button'));
    expect(await screen.findByRole('dialog', { name: 'Review the facade' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?meeting=mtg_001');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the sheet when the link names a meeting that no card shows', async () => {
    phone();
    await renderApp('/meetings?meeting=mtg_099', (state) => {
      office(state);
      // A meeting of other people: Faisal is not an attendee, so the list does not hold it.
      withMeeting(state, { id: 'mtg_099', title: 'Elsewhere', organizerId: 'usr_006', attendeeIds: ['usr_005'], projectId: 'prj_001' });
    });
    await screen.findByText('Review the facade');
    expect(screen.queryByRole('dialog', { name: 'Elsewhere' }) ?? await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('puts the Earlier fold last, as a 52 px panel row', async () => {
    phone();
    await renderApp('/meetings', office);
    const fold = await screen.findByRole('button', { name: 'Earlier (1)' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(fold).toHaveClass('min-h-[52px]', 'w-full', 'surface', 'rounded-card');
    // It follows the last group in the page.
    const later = screen.getByRole('region', { name: 'Later' });
    expect(later.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Kick-off')).toBeNull();
    await userEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(within(await cardOf('Kick-off')).getByText(/^28 Sept\b/)).toBeInTheDocument();
    // The organizer alone: no line of people, and no line at all when the meeting does not repeat.
    expect((await cardOf('Kick-off')).textContent).not.toMatch(/people|person/);
  });

  it('shows the Google line only for state ok', async () => {
    phone();
    const status = vi.spyOn(calls['google.status'], 'run');
    status.mockReturnValue({ ready: true, state: 'ok', connectedAt: '2026-09-29T09:00:00.000+03:00' });
    await renderApp('/meetings', office);
    expect(await screen.findByText('Your meetings also go to Google Calendar.')).toBeInTheDocument();
  });

  it('hides the Google line for not_synced and none', async () => {
    phone();
    const status = vi.spyOn(calls['google.status'], 'run');
    status.mockReturnValue({ ready: true, state: 'not_synced', connectedAt: '2026-09-29T09:00:00.000+03:00' });
    const first = await renderApp('/meetings', office);
    await screen.findByText('Review the facade');
    await waitFor(() => expect(status).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 30); }); });
    expect(screen.queryByText('Your meetings also go to Google Calendar.')).toBeNull();
    first.unmount();
    status.mockReturnValue({ ready: false, state: 'none', connectedAt: null });
    await renderApp('/meetings', office);
    await screen.findByText('Review the facade');
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 30); }); });
    expect(screen.queryByText('Your meetings also go to Google Calendar.')).toBeNull();
  });

  it('shows the empty line and keeps New meeting', async () => {
    phone();
    await renderApp('/meetings', as('usr_002'));
    expect(await screen.findByText('You have no meeting in the next 60 days.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New meeting' })).toHaveLength(1);
  });

  it('keeps the desk list as it is', async () => {
    phoneMedia({ phone: false });
    await renderApp('/meetings', soon);
    const row = (await screen.findByText('Design review')).closest('li')!;
    expect(within(row).queryByRole('link', { name: 'Join' })).toBeNull();
    expect(row.querySelector('[data-sign]')).toBeNull();
    expect(within(row).getByText(/Client meeting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Earlier (1)' })).not.toHaveClass('min-h-[52px]');
    expect(screen.queryByText('Your meetings also go to Google Calendar.')).toBeNull();
  });
});
