import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

const PROJECTS = '/dashboard/meeting?mode=projects';
const TIMELINE = '/dashboard/meeting';
const BIG = 'madar.meeting.bigScreen';

const header = () => screen.getByRole('group', { name: 'Meeting view controls' });
const barButtons = () => within(header()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');

afterEach(() => {
  window.localStorage.removeItem(BIG);
  document.documentElement.style.zoom = '';
});

describe('the calm meeting top bar (owner, 2026-10-02)', () => {
  it('holds the eight controls (mode switch plus seven buttons) on the project screens and no Big screen or Summary button', async () => {
    await renderApp(PROJECTS);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    const bar = within(header());
    expect(bar.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(bar.getByRole('button', { name: /^Agenda 1 of 9/ })).toBeInTheDocument();
    expect(bar.getByRole('button', { name: 'Pause timer' })).toBeInTheDocument();
    for (const name of ['Done', 'Skip', 'Previous project', 'Next project', 'Exit']) expect(bar.getByRole('button', { name })).toBeInTheDocument();
    expect(bar.queryByRole('button', { name: 'Big screen' })).toBeNull();
    expect(bar.queryByRole('button', { name: 'Summary' })).toBeNull();
    expect(barButtons()).toHaveLength(7);
  });

  it('makes Done the one filled button and keeps Skip quiet', async () => {
    await renderApp(PROJECTS);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveClass('signature');
    expect(screen.getByRole('button', { name: 'Skip' })).not.toHaveClass('signature');
  });

  it('shows the position only in the Agenda button, not in the project header', async () => {
    await renderApp(PROJECTS);
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).queryByText(/Project 1 of 9/)).toBeNull();
    expect(screen.queryByText(/Project 1 of 9/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Agenda/ })).toHaveTextContent('1 of 9');
  });

  it('makes the timer the pause control, with a word for the paused state', async () => {
    await renderApp(PROJECTS);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    const pause = screen.getByRole('button', { name: 'Pause timer' });
    expect(within(pause).getByRole('timer')).toHaveTextContent(/left$/);
    expect(screen.queryByText('Pause timer', { selector: 'button:not([aria-label])' })).toBeNull();
    await userEvent.click(pause);
    const resume = screen.getByRole('button', { name: 'Resume timer' });
    expect(resume).toHaveTextContent(/^Paused · \d+:\d\d left$/);
    await userEvent.click(resume);
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeInTheDocument();
  });

  it('opens the Agenda sheet in the timeline mode and goes to a project in the project mode', async () => {
    await renderApp(TIMELINE);
    await screen.findByRole('list', { name: 'Project timeline' });
    const bar = within(header());
    expect(bar.getByRole('button', { name: /^Agenda/ })).toBeInTheDocument();
    for (const name of ['One month earlier', 'Today', 'One month later', 'Exit']) expect(bar.getByRole('button', { name })).toBeInTheDocument();
    expect(bar.queryByRole('button', { name: 'Big screen' })).toBeNull();
    expect(bar.queryByRole('button', { name: 'Summary' })).toBeNull();
    await userEvent.click(bar.getByRole('button', { name: /^Agenda/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Agenda' });
    await userEvent.click(within(within(sheet).getByRole('list', { name: 'Agenda order' })).getAllByRole('button')[1]);
    await screen.findByRole('article', { name: 'Corniche Office Tower' });
    expect(screen.getByRole('radio', { name: 'Projects' })).toHaveAttribute('aria-checked', 'true');
  });

  it('opens the Agenda sheet with the A key in the timeline mode', async () => {
    await renderApp(TIMELINE);
    await screen.findByRole('list', { name: 'Project timeline' });
    await userEvent.keyboard('a');
    expect(await screen.findByRole('dialog', { name: 'Agenda' })).toBeInTheDocument();
  });

  it('holds the Summary button and the Big screen switch in the Agenda sheet, in the order of the brief', async () => {
    await renderApp(PROJECTS);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: /^Agenda/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Agenda' });
    const list = within(sheet).getByRole('list', { name: 'Agenda order' });
    const summary = within(sheet).getByRole('button', { name: 'See the meeting summary' });
    const time = within(sheet).getByRole('radiogroup', { name: 'Time for each project' });
    const big = within(sheet).getByRole('switch', { name: 'Big screen' });
    const before = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    before(list, summary);
    before(summary, time);
    before(time, big);
    before(big, within(sheet).getByText('Keys:'));
    before(within(sheet).getByText('Keys:'), within(sheet).getByRole('button', { name: 'Start a new meeting' }));
    expect(within(sheet).getByText('Larger text for the meeting-room screen')).toBeInTheDocument();
  });

  it('turns Big screen on and off from the switch, and keeps the choice', async () => {
    await renderApp(PROJECTS);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: /^Agenda/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Agenda' });
    const big = within(sheet).getByRole('switch', { name: 'Big screen' });
    expect(big).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(big);
    expect(big).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem(BIG)).toBe('1');
    expect(document.documentElement.style.zoom).toBe('1.25');
    await userEvent.click(big);
    expect(window.localStorage.getItem(BIG)).toBe('0');
    expect(document.documentElement.style.zoom).toBe('');
  });

  it('closes the sheet and opens the summary from the Summary button, then the bar shows three controls', async () => {
    await renderApp(PROJECTS);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    await userEvent.click(screen.getByRole('button', { name: /^Agenda/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Agenda' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'See the meeting summary' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agenda' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
    const bar = within(header());
    expect(bar.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(bar.getByRole('button', { name: /^Agenda/ })).toBeInTheDocument();
    expect(bar.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
    expect(barButtons()).toHaveLength(2);
  });
});
