import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const months = (root: HTMLElement) => within(root).queryAllByText(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/).map((node) => node.textContent);

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
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
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
    expect(screen.getByRole('radio', { name: 'Half year' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(months(main)).toHaveLength(6));
    const first = months(main)[0];
    await userEvent.click(screen.getByRole('radio', { name: 'Quarter' }));
    expect(months(main)).toHaveLength(3);
    await userEvent.click(screen.getByRole('radio', { name: 'Year' }));
    expect(months(main)).toHaveLength(12);
    await userEvent.click(screen.getByRole('radio', { name: 'Half year' }));
    await userEvent.click(screen.getByRole('button', { name: 'One month later' }));
    expect(months(main)[0]).not.toBe(first);
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(months(main)[0]).toBe(first);
    await userEvent.keyboard('{ArrowLeft}');
    expect(months(main)[0]).not.toBe(first);
    await userEvent.keyboard('{ArrowRight}');
    expect(months(main)[0]).toBe(first);
  });
});
