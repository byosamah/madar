import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const months = (root: HTMLElement) => within(root).queryAllByText(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/).map((node) => node.textContent);
const days = (root: HTMLElement) => within(root).queryAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}$/).map((node) => node.textContent);
const sundays = (root: HTMLElement) => within(root).queryAllByText(/^\d{1,2} [A-Z][a-z]{2,3}$/).map((node) => node.textContent);

describe('the Meeting view button', () => {
  it('shows on the Dashboard and opens the meeting view with the filters in the link', async () => {
    await renderApp('/dashboard?status=all&view=people');
    await userEvent.click(await screen.findByRole('button', { name: 'Meeting view' }));
    expect(await screen.findByRole('list', { name: 'Project timeline' })).toBeInTheDocument();
    expect(window.location.hash).toContain('/dashboard/meeting');
    expect(window.location.hash).toContain('status=all');
    expect(window.location.hash).not.toContain('view=');
  });
});

describe('the meeting view', () => {
  it('lists the projects with their state words, and the date and filters in the title row', async () => {
    await renderApp('/dashboard/meeting');
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
    const states = within(list).queryAllByText(/^(Late|At risk)$/);
    expect(states).toHaveLength(5);
    expect(within(list).queryAllByText('On track')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Madar' })).toBeInTheDocument();
    expect(screen.getByText(/No filters/)).toBeInTheDocument();
  });

  it('names its deadlines and stages for screen readers', async () => {
    await renderApp('/dashboard/meeting');
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    expect(within(list).getAllByRole('button', { name: /^Deadline: /i }).length).toBeGreaterThan(0);
    expect(within(list).getAllByRole('img', { name: /, current$/ }).length).toBeGreaterThan(0);
  });

  it('shows the filters in force', async () => {
    await renderApp('/dashboard/meeting?status=on_hold');
    expect(await screen.findByText(/Filters: Status: Paused/)).toBeInTheDocument();
  });

  it('returns to the Dashboard with the filters kept when Escape is pressed', async () => {
    await renderApp('/dashboard/meeting?status=all&leader=usr_002');
    await screen.findByRole('list', { name: 'Project timeline' });
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(window.location.hash).toContain('/dashboard');
    expect(window.location.hash).not.toContain('meeting');
    expect(window.location.hash).toContain('status=all');
    expect(window.location.hash).toContain('leader=usr_002');
  });

  it('exits with the Exit button', async () => {
    await renderApp('/dashboard/meeting?status=all');
    await userEvent.click(await screen.findByRole('button', { name: 'Exit' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(window.location.hash).toContain('status=all');
  });

  it('changes the visible months with the zoom and the month arrows', async () => {
    await renderApp('/dashboard/meeting');
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    const main = list.closest('main') as HTMLElement;
    expect(screen.getByRole('radio', { name: 'Quarter' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(months(main)).toHaveLength(3));
    const first = months(main)[0];
    await userEvent.click(screen.getByRole('radio', { name: 'Year' }));
    expect(months(main)).toHaveLength(12);
    await userEvent.click(screen.getByRole('radio', { name: 'Quarter' }));
    await userEvent.click(screen.getByRole('button', { name: 'One month later' }));
    expect(months(main)[0]).not.toBe(first);
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(months(main)[0]).toBe(first);
    await userEvent.keyboard('{ArrowLeft}');
    expect(months(main)[0]).not.toBe(first);
    await userEvent.keyboard('{ArrowRight}');
    expect(months(main)[0]).toBe(first);
  });

  // Today in the tests is Wed 30 Sep 2026, so the week runs from Sun 27 Sep to Sat 3 Oct.
  it('shows one week with a label for each day, and moves one week at a time (owner, 2026-10-02)', async () => {
    await renderApp('/dashboard/meeting');
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    const main = list.closest('main') as HTMLElement;
    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    // Short day labels never run into each other. The week itself shows once, in words, above the project names.
    expect(days(main)).toEqual(['Sun 27', 'Mon 28', 'Tue 29', 'Wed 30', 'Thu 1', 'Fri 2', 'Sat 3']);
    expect(within(main).getByText('27 Sept to 3 Oct 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'One month later' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'One week later' }));
    expect(within(main).getByText('4 Oct to 10 Oct 2026')).toBeInTheDocument();
    expect(days(main)[0]).toBe('Sun 4');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(days(main)[0]).toBe('Sun 27');
    await userEvent.click(screen.getByRole('button', { name: 'One week earlier' }));
    expect(days(main)[0]).toBe('Sun 20');
    await userEvent.keyboard('{ArrowRight}');
    expect(days(main)[0]).toBe('Sun 27');
  });

  it('shows one month with a label for each Sunday, and moves one month at a time', async () => {
    await renderApp('/dashboard/meeting');
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    const main = list.closest('main') as HTMLElement;
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(sundays(main)).toEqual(['6 Sept', '13 Sept', '20 Sept', '27 Sept']);
    expect(within(main).getByText('September 2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'One month later' }));
    expect(sundays(main)).toEqual(['4 Oct', '11 Oct', '18 Oct', '25 Oct']);
    expect(within(main).getByText('October 2026')).toBeInTheDocument();
  });
});

describe('the meeting view project screens', () => {
  it('shows each project with its work in progress, then moves with the arrow keys', async () => {
    await renderApp('/dashboard/meeting?mode=projects');
    const first = await screen.findByRole('article');
    expect(screen.getByRole('button', { name: /^Agenda 1 of 9/ })).toBeInTheDocument();
    expect(within(first).getByRole('region', { name: 'In progress now' })).toBeInTheDocument();
    expect(within(first).getByRole('region', { name: 'Needs attention' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.getByRole('button', { name: /^Agenda 2 of 9/ })).toBeInTheDocument();
  });

  it('lists the work counts on the timeline and opens a project screen with "Open project"', async () => {
    await renderApp('/dashboard/meeting');
    const timeline = await screen.findByRole('list', { name: /timeline/i });
    await waitFor(() => expect(within(timeline).getAllByText(/in progress/).length).toBeGreaterThan(0));
    await userEvent.click(within(timeline).getAllByRole('button', { name: /Corniche Office Tower/ })[0]);
    await userEvent.click(await within(timeline).findByRole('button', { name: 'Open Corniche Office Tower' }));
    expect(await screen.findByRole('article', { name: 'Corniche Office Tower' })).toBeInTheDocument();
    expect(window.location.hash).toContain('mode=projects');
  });
});

describe('the meeting view timeline, stage by stage (owner, 2026-10-02)', () => {
  it('shows a project on one line, opens it to one line for each stage with a press, and folds it with the next', async () => {
    await renderApp('/dashboard/meeting');
    const timeline = await screen.findByRole('list', { name: 'Project timeline' });
    const toggle = within(timeline).getByRole('button', { name: /Corniche Office Tower/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(timeline).queryByRole('group', { name: 'Stages of Corniche Office Tower' })).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const lines = within(timeline).getByRole('group', { name: 'Stages of Corniche Office Tower' });
    expect(toggle).toHaveAttribute('aria-controls', lines.id);
    for (const stage of ['Concept', 'Construction Documents', 'Supervision']) expect(within(lines).getByText(stage)).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(timeline).queryByRole('group', { name: 'Stages of Corniche Office Tower' })).toBeNull();
  });

  it('opens with the keyboard', async () => {
    await renderApp('/dashboard/meeting');
    const timeline = await screen.findByRole('list', { name: 'Project timeline' });
    const toggle = within(timeline).getByRole('button', { name: /Corniche Office Tower/ });
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows two stages that run at the same time, on the one line and on their own lines', async () => {
    await renderApp('/dashboard/meeting?status=all');
    const timeline = await screen.findByRole('list', { name: 'Project timeline' });
    const school = (await within(timeline).findAllByRole('button', { name: /Eastern Shore Primary School/ }))[0];
    const row = school.closest('li') as HTMLElement;
    expect(within(row).getAllByRole('img', { name: 'Schematic Design and Design Development run at the same time' }).length).toBeGreaterThan(0);
    // The one line draws no stripes, because stripes there covered a stage name. The opened lines draw them on both stages.
    expect(row.querySelectorAll('.overlap-hatch')).toHaveLength(0);
    await userEvent.click(school);
    const lines = within(row).getByRole('group', { name: 'Stages of Eastern Shore Primary School' });
    expect(row.querySelectorAll('.overlap-hatch')).toHaveLength(2);
    expect(within(lines).getByText('Design Development')).toBeInTheDocument();
  });
});
