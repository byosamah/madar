import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';
const KEY = 'madar.meeting.2026-09-30';

// The agenda of the sample office: the two late projects, the three at risk, then the rest in the timeline order.
// Only the clock and the one-second tick are fake, so the time of a test moves only when the test moves it.
const fakeClock = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
const pass = (seconds: number) => act(() => { vi.advanceTimersByTime(seconds * 1000); });
const timer = () => screen.getByRole('timer');

/** Lets the work that React put off run: the clock starts after the screen draws, outside the test's own steps. */
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

/** Waits until the clock of the project on the screen runs, then for its one-second tick. */
async function ticking() {
  const runs = () => JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}').runningSince != null;
  for (let tries = 0; tries < 100 && !runs(); tries += 1) await flush();
  expect(runs()).toBe(true);
  await flush();
}

async function openAgenda() {
  await userEvent.click(screen.getByRole('button', { name: /^Agenda/ }));
  return screen.findByRole('dialog', { name: 'Agenda' });
}

async function closeAgenda(sheet: HTMLElement) {
  await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agenda' })).toBeNull());
}

const agendaItems = (sheet: HTMLElement) => within(within(sheet).getByRole('list', { name: 'Agenda order' })).getAllByRole('button');

afterEach(() => {
  vi.useRealTimers();
});

describe('the meeting agenda (owner, 2026-10-02)', () => {
  it('shows the projects in agenda order, a late project first, and the timeline keeps its order', async () => {
    await renderApp(MEETING);
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).getAllByText('Late').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Agenda/ })).toHaveTextContent('1 of 9');
    await userEvent.click(screen.getByRole('radio', { name: 'Timeline' }));
    const timeline = await screen.findByRole('list', { name: 'Project timeline' });
    expect(within(timeline).getAllByRole('listitem')[0]).toHaveTextContent('Shore Walk Retail Kiosks');
  });

  it('counts down the time of each project, keeps the time of each project, and shows the time over', async () => {
    fakeClock();
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await ticking();
    expect(timer()).toHaveTextContent('5:00 left');
    pass(61);
    expect(timer()).toHaveTextContent('3:59 left');
    const sheet = await openAgenda();
    const choices = within(sheet).getByRole('radiogroup', { name: 'Time for each project' });
    expect(within(choices).getByRole('radio', { name: '5 minutes' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(choices).getByRole('radio', { name: '10 minutes' }));
    await closeAgenda(sheet);
    expect(timer()).toHaveTextContent('8:59 left');
    await userEvent.click(screen.getByRole('button', { name: 'Next project' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    expect(timer()).toHaveTextContent('10:00 left');
    pass(665);
    expect(timer()).toHaveTextContent('1:05 over');
    expect(timer()).toHaveClass('text-attn');
    await userEvent.click(screen.getByRole('button', { name: 'Previous project' }));
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(timer()).toHaveTextContent('8:59 left');
  });

  it('stops the count with Pause timer and continues it with Resume timer', async () => {
    fakeClock();
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await ticking();
    pass(20);
    await userEvent.click(screen.getByRole('button', { name: 'Pause timer' }));
    pass(30);
    expect(timer()).toHaveTextContent('4:40 left');
    await userEvent.click(screen.getByRole('button', { name: 'Resume timer' }));
    await ticking();
    pass(10);
    expect(timer()).toHaveTextContent('4:30 left');
  });

  it('marks a project discussed with Done and moves on, and Skip puts a project last', async () => {
    await renderApp(MEETING);
    const first = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(first).queryByText('Discussed')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('article', { name: 'Nakhla Mall Extension' });
    const sheet = await openAgenda();
    const items = agendaItems(sheet);
    expect(items).toHaveLength(9);
    expect(items[0]).toHaveTextContent(/Al Waha Clinic Fit-out.*Discussed/);
    expect(items[1]).toHaveTextContent(/Nakhla Mall Extension.*Now/);
    expect(items[2]).toHaveTextContent(/Dune Line Townhouses.*Next/);
    expect(items[8]).toHaveTextContent('Corniche Office Tower');
    await userEvent.click(items[0]);
    const back = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(back).getByText('Discussed')).toBeInTheDocument();
  });

  it('says "All projects discussed" when every project is done, and starts a new meeting', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    for (let n = 0; n < 9; n += 1) await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('All projects discussed')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).toBeNull();
    const sheet = await openAgenda();
    expect(within(sheet).getByText('All projects discussed')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Start a new meeting' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agenda' })).toBeNull());
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).queryByText('Discussed')).toBeNull();
    expect(timer()).toHaveTextContent('5:00 left');
  });

  it('keeps the meeting over a reload on the same day, and starts a new one on a new day', async () => {
    const first = await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    first.unmount();

    const second = await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    const sheet = await openAgenda();
    expect(agendaItems(sheet)[0]).toHaveTextContent(/Al Waha Clinic Fit-out.*Discussed/);
    second.unmount();

    // The same session, kept under the day before, belongs to an old meeting.
    window.sessionStorage.setItem('madar.meeting.2026-09-29', window.sessionStorage.getItem(KEY)!);
    window.sessionStorage.removeItem(KEY);
    await renderApp(MEETING);
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).queryByText('Discussed')).toBeNull();
  });

  it('runs the meeting when the browser blocks the session storage', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('The storage is blocked.', 'SecurityError');
    });
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(timer()).toHaveTextContent('5:00 left');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('article', { name: 'Corniche Office Tower' })).toBeInTheDocument();
  });
});
