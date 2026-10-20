import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setNow } from '../../../lib/dates';
import { renderApp } from '../../../test/render';
import { openSummary } from './steps';

const MEETING = '/dashboard/meeting?mode=projects';
const KEY = 'madar.meeting.2026-09-30';
// 08:00 office time on the next day.
const NEXT_MORNING = new Date('2026-10-01T05:00:00Z');
const saved = (key: string) => JSON.parse(window.sessionStorage.getItem(key) ?? 'null') as { startedAt: string; discussed: string[] } | null;

// The agenda of the sample office: the two late projects, the three at risk, then the rest in the timeline order.
// Only the clock and the one-second tick are fake, so the time of a test moves only when the test moves it.
const fakeClock = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
const pass = (seconds: number) => act(() => { vi.advanceTimersByTime(seconds * 1000); });
const timer = () => screen.getByRole('timer');

/** Lets the work that React put off run: the clock starts after the screen draws, outside the test's own steps. */
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

/** Waits until the clock of the project on the screen runs, then for its one-second tick. */
async function ticking(key = KEY) {
  const runs = () => JSON.parse(window.sessionStorage.getItem(key) ?? '{}').runningSince != null;
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

/** The page goes to another tab and back, as the browser says it with visibilitychange. */
const pageHidden = (hidden: boolean) => act(() => {
  Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

afterEach(() => {
  vi.useRealTimers();
  // The own property hid the real one of the document. Without it the real one shows again.
  delete (document as { visibilityState?: unknown }).visibilityState;
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
    await userEvent.keyboard('{ArrowRight}');
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    expect(timer()).toHaveTextContent('10:00 left');
    pass(665);
    expect(timer()).toHaveTextContent('1:05 over');
    expect(timer()).toHaveClass('text-attn');
    await userEvent.keyboard('{ArrowLeft}');
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

  it('stops the clock and hides the agenda controls while the summary shows', async () => {
    fakeClock();
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await ticking();
    pass(20);
    await openSummary();
    await screen.findByRole('region', { name: 'Meeting summary' });
    await flush();
    expect(screen.queryByRole('timer')).toBeNull();
    for (const name of ['Done', 'Skip', 'Pause timer', 'Previous project', 'Next project']) expect(screen.queryByRole('button', { name })).toBeNull();
    // The summary keeps the Agenda button (without the position) and Exit.
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument();
    pass(60);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await flush();
    expect(timer()).toHaveTextContent('4:40 left');
  });

  it('hides the timeline controls while the summary shows', async () => {
    await renderApp('/dashboard/meeting');
    await screen.findByRole('list', { name: 'Project timeline' });
    await openSummary();
    await screen.findByRole('region', { name: 'Meeting summary' });
    for (const name of ['One month earlier', 'One month later', 'Today']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Zoom' })).toBeNull();
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

  it('offers Undo after Done: it takes the mark back and shows the project again (audit 2026-10-03, DSH-10)', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    const toast = (await screen.findByText('Al Waha Clinic Fit-out marked as discussed.')).closest('[role="status"]') as HTMLElement;
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    const back = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(back).queryByText('Discussed')).toBeNull();
    const sheet = await openAgenda();
    expect(agendaItems(sheet)[0]).not.toHaveTextContent('Discussed');
    await closeAgenda(sheet);
    // Done on a project that was already discussed: Undo goes back to it and keeps the mark it had before.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    await userEvent.keyboard('b');
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    const again = (await screen.findAllByText('Al Waha Clinic Fit-out marked as discussed.')).at(-1)!.closest('[role="status"]') as HTMLElement;
    await userEvent.click(within(again).getByRole('button', { name: 'Undo' }));
    const kept = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(kept).getByText('Discussed')).toBeInTheDocument();
  });

  it('Ctrl+Z after Done takes back Done and keeps the decision typed before it (audit 2026-10-03, V-1)', async () => {
    const { store } = await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    const decisions = within(await screen.findByRole('region', { name: 'Decisions' }));
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'Keep the lobby double height.{Enter}');
    await screen.findByText('Decision added.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    const toast = (await screen.findByText('Al Waha Clinic Fit-out marked as discussed.')).closest('[role="status"]') as HTMLElement;
    expect(within(toast).getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
    await userEvent.keyboard('{Control>}z{/Control}');
    const back = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(back).queryByText('Discussed')).toBeNull();
    await flush();
    expect(Object.values(store.state.updates).some((update) => update.body === 'Keep the lobby double height.')).toBe(true);
  });

  it('says Skipped next to a skipped project until it is discussed (browser audit 2026-10-03, BRW-19)', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    let sheet = await openAgenda();
    expect(agendaItems(sheet)[8]).toHaveTextContent(/Al Waha Clinic Fit-out.*Skipped/);
    expect(agendaItems(sheet).filter((item) => /Skipped/.test(item.textContent ?? ''))).toHaveLength(1);
    await userEvent.click(agendaItems(sheet)[8]);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Al Waha Clinic Fit-out' })).toBeNull());
    sheet = await openAgenda();
    expect(agendaItems(sheet)[8]).toHaveTextContent(/Al Waha Clinic Fit-out.*Discussed/);
    expect(agendaItems(sheet)[8]).not.toHaveTextContent('Skipped');
  });

  it('says where Skip put the project, and Undo puts it back in its place (audit 2026-10-03, F-21)', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('article', { name: 'Nakhla Mall Extension' });
    const toast = (await screen.findByText('Corniche Office Tower moved to the end of the agenda.')).closest('[role="status"]') as HTMLElement;
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    expect(screen.getByRole('button', { name: /^Agenda/ })).toHaveTextContent('2 of 9');
    const sheet = await openAgenda();
    const items = agendaItems(sheet);
    expect(items[1]).toHaveTextContent(/Corniche Office Tower.*Now/);
    expect(items[2]).toHaveTextContent('Nakhla Mall Extension');
    expect(items.filter((item) => /Skipped/.test(item.textContent ?? ''))).toHaveLength(0);
  });

  it('says where Skip put the project in Arabic (audit 2026-10-03, F-21)', async () => {
    await renderApp(MEETING, (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'أجّل' }));
    expect(await screen.findByText('نُقل Al Waha Clinic Fit-out إلى آخر جدول الأعمال.')).toBeInTheDocument();
  });

  it('goes round to the first open project when Skip is pressed on the last project', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    const sheet = await openAgenda();
    await userEvent.click(agendaItems(sheet)[8]);
    await screen.findByRole('article', { name: 'Tamr Boutique Hotel' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' })).toBeInTheDocument();
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
    // One press only asks. The meeting is the same until the person confirms.
    expect(within(sheet).getByText('Start a new meeting? This clears the discussed marks and the timers.')).toBeInTheDocument();
    expect(within(sheet).getByText('All projects discussed')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Clear and start again' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agenda' })).toBeNull());
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).queryByText('Discussed')).toBeNull();
    expect(timer()).toHaveTextContent('5:00 left');
  });

  it('keeps the meeting for a double press: the second press lands on Cancel, and the confirm sits on the start side', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    const sheet = await openAgenda();
    // The footer is the end of the sheet, so its last button sits where "Start a new meeting" was.
    const inPlace = () => within(sheet).getAllByRole('button').at(-1)!;
    expect(inPlace()).toHaveAccessibleName('Start a new meeting');
    await userEvent.click(inPlace());
    expect(inPlace()).toHaveAccessibleName('Cancel');
    await userEvent.click(inPlace());
    expect(agendaItems(sheet)[0]).toHaveTextContent(/Al Waha Clinic Fit-out.*Discussed/);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Start a new meeting' }));
    // The confirm has its own name and goes to the start side, away from the place of the first press.
    expect(within(sheet).queryAllByRole('button', { name: 'Start a new meeting' })).toHaveLength(0);
    expect(within(sheet).getByRole('button', { name: 'Clear and start again' })).toHaveClass('me-auto');
  });

  it('keeps the meeting when the person cancels a new meeting', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    const sheet = await openAgenda();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Start a new meeting' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(within(sheet).queryByText('Start a new meeting? This clears the discussed marks and the timers.')).toBeNull();
    expect(agendaItems(sheet)[0]).toHaveTextContent(/Al Waha Clinic Fit-out.*Discussed/);
    expect(within(sheet).getByRole('button', { name: 'Start a new meeting' })).toBeInTheDocument();
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

  it('starts a new meeting when the page shows again on a new day', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    // The room screen stayed awake all night. In the morning the page shows again.
    setNow(NEXT_MORNING);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).queryByText('Discussed')).toBeNull();
    expect(saved('madar.meeting.2026-10-01')?.startedAt).toBe('2026-10-01T08:00:00.000+03:00');
    expect(saved('madar.meeting.2026-10-01')?.discussed).toEqual([]);
  });

  it('runs the clock of the new meeting when a press starts the new day', async () => {
    fakeClock();
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await ticking();
    // The room screen stayed awake all night, so the first press of the morning starts the new meeting.
    setNow(NEXT_MORNING);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    await ticking('madar.meeting.2026-10-01');
    pass(30);
    expect(timer()).toHaveTextContent('4:30 left');
  });

  it('starts a new meeting before it saves a change on a new day', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    setNow(NEXT_MORNING);
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(saved('madar.meeting.2026-10-01')).not.toBeNull());
    expect(saved('madar.meeting.2026-10-01')?.discussed).toEqual([]);
    const sheet = await openAgenda();
    expect(agendaItems(sheet)[0]).not.toHaveTextContent('Discussed');
  });

  it('stops the clock while the page is hidden, and runs it again when the page shows (audit 2026-10-03, DSH-11)', async () => {
    fakeClock();
    await renderApp(MEETING);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await ticking();
    pass(20);
    // The person shows an email in another tab, or closes the laptop for lunch.
    pageHidden(true);
    await flush();
    pass(600);
    pageHidden(false);
    await ticking();
    expect(timer()).toHaveTextContent('4:40 left');
    pass(10);
    expect(timer()).toHaveTextContent('4:30 left');
  });

  it('starts the meeting of the new day by itself on a screen that stays visible all night (audit 2026-10-03, DSH-2)', async () => {
    fakeClock();
    await renderApp(MEETING);
    const decisions = () => within(screen.getByRole('region', { name: 'Decisions' }));
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    // The panel waits for projects.get, so it can come after the card (a flake under load, wave 6 merge).
    await screen.findByRole('region', { name: 'Decisions' });
    await userEvent.type(decisions().getByRole('textbox', { name: 'Write a decision' }), 'Yesterday decision{Enter}');
    await decisions().findByText('Yesterday decision');
    // No page event comes in the morning. The check of each minute finds the new day.
    setNow(NEXT_MORNING);
    pass(60);
    await waitFor(() => expect(saved('madar.meeting.2026-10-01')).not.toBeNull());
    await waitFor(() => expect(decisions().queryByText('Yesterday decision')).toBeNull());
    await userEvent.type(decisions().getByRole('textbox', { name: 'Write a decision' }), 'Morning decision{Enter}');
    await decisions().findByText('Morning decision');
    // The first press of the morning keeps the meeting that already started, so the morning decision stays in it.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    await userEvent.keyboard('b');
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await screen.findByRole('region', { name: 'Decisions' });
    expect(await decisions().findByText('Morning decision')).toBeInTheDocument();
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
