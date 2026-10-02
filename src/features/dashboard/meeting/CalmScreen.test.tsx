import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

// The ADHD pass over the whole meeting (owner, 2026-10-02): one place for each thing, the urgent things first,
// one meaning for each color, and fewer choices on the screen.

const PROJECTS = '/dashboard/meeting?mode=projects';
const TIMELINE = '/dashboard/meeting';
const ZOOM = 'madar.meeting.zoom';

const follows = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

afterEach(() => window.localStorage.removeItem(ZOOM));

describe('the project screen of the meeting', () => {
  it('shows a task in one place only: a late task in progress shows under Needs attention, not twice', async () => {
    await renderApp(PROJECTS);
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).getAllByRole('button', { name: /^Permit tracker update/ })).toHaveLength(1);
    const attention = within(article).getByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByRole('button', { name: /^Permit tracker update/ })).toBeInTheDocument();
    const doing = within(article).getByRole('region', { name: 'In progress now' });
    expect(within(doing).getAllByRole('button')).toHaveLength(1);
    expect(within(doing).getByRole('button', { name: /^Balady submission set/ })).toBeInTheDocument();
  });

  it('puts what needs the team first, then the work, then the decisions and the facts', async () => {
    await renderApp(PROJECTS);
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    const region = (name: string) => within(article).getByRole('region', { name });
    follows(region('Needs attention'), region('Client items'));
    follows(region('Client items'), region('In progress now'));
    follows(region('In progress now'), region('Decisions'));
    follows(region('Decisions'), region('Coming up'));
  });

  it('shows the people of the project in the project header, so the header holds who, where and how', async () => {
    await renderApp(PROJECTS);
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    expect(within(article).getByRole('region', { name: 'People' }).closest('header')).not.toBeNull();
  });

  it('offers Decision and Action as one choice, not as two filled buttons', async () => {
    await renderApp(PROJECTS);
    const article = await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    const kind = within(within(article).getByRole('region', { name: 'Decisions' })).getByRole('radiogroup', { name: 'What to add' });
    expect(within(kind).getByRole('radio', { name: 'Decision' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(kind).getByRole('radio', { name: 'Action' }));
    expect(within(kind).getByRole('radio', { name: 'Action' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('the timeline of the meeting', () => {
  it('offers four zooms, opens on Quarter, and keeps the last choice on this computer', async () => {
    const { unmount } = await renderApp(TIMELINE);
    await screen.findByRole('list', { name: 'Project timeline' });
    const zoom = screen.getByRole('radiogroup', { name: 'Zoom' });
    expect(within(zoom).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Week', 'Month', 'Quarter', 'Year']);
    expect(within(zoom).getByRole('radio', { name: 'Quarter' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(zoom).getByRole('radio', { name: 'Week' }));
    expect(window.localStorage.getItem(ZOOM)).toBe('week');
    unmount();
    await renderApp(TIMELINE);
    await screen.findByRole('list', { name: 'Project timeline' });
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
  });

  it('colors the current stage by the state of the project: calm ink on track, red when late', async () => {
    await renderApp(TIMELINE);
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    const rowOf = (name: string) => within(list).getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;
    const current = (name: string) => within(rowOf(name)).getAllByRole('img', { name: /, current$/ })[0];
    // On track is a quiet grey, so the red and the orange of the late and the at-risk projects are the loudest marks.
    expect(current('Shore Walk Retail Kiosks')).toHaveClass('bg-ink-2');
    expect(current('Al Waha Clinic Fit-out')).toHaveClass('bg-red-text');
    expect(current('Al Waha Clinic Fit-out').getAttribute('style') ?? '').not.toMatch(/--p-/);
  });

  it('says only the counts that are not zero under a project name, flagged work too', async () => {
    await renderApp(TIMELINE);
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    expect(within(list).queryByText(/^0 in progress/)).toBeNull();
    expect(within(list).queryByText(/(^| )0 /)).toBeNull();
  });

  it('draws the current stage over a next stage that starts inside it, and puts the name of the next stage at its end', async () => {
    await renderApp('/dashboard/meeting?status=all');
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    const row = within(list).getAllByRole('button', { name: /Eastern Shore Primary School/ })[0].closest('li') as HTMLElement;
    const bars = within(row).getAllByRole('img', { name: /^(Schematic Design|Design Development), / });
    const current = bars.find((bar) => /current$/.test(bar.getAttribute('aria-label') ?? '')) as HTMLElement;
    const next = bars.find((bar) => (bar.getAttribute('aria-label') ?? '').startsWith('Design Development')) as HTMLElement;
    expect(next.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next).toHaveClass('justify-end');
  });

  it('draws the deadline diamonds without the warning color', async () => {
    await renderApp(TIMELINE);
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    const diamonds = within(list).getAllByRole('button', { name: /^Deadline: /i });
    expect(diamonds.length).toBeGreaterThan(0);
    for (const diamond of diamonds) expect(diamond.querySelector('.bg-attn')).toBeNull();
  });
});

describe('the meeting top bar', () => {
  it('moves forward in one way only: Done or Skip, with no arrow buttons on the project screens', async () => {
    await renderApp(PROJECTS);
    await screen.findByRole('article', { name: 'Al Waha Clinic Fit-out' });
    const bar = within(screen.getByRole('group', { name: 'Meeting view controls' }));
    expect(bar.queryByRole('button', { name: 'Next project' })).toBeNull();
    expect(bar.queryByRole('button', { name: 'Previous project' })).toBeNull();
    // The keys still move along the agenda.
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByRole('article', { name: 'Corniche Office Tower' })).toBeInTheDocument();
  });
});
