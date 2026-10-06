import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const tile = (name: RegExp) => screen.findByRole('link', { name });
const projectRows = () => within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem');
const listRows = () => within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem');

/**
 * With the Leader or Client filter on, the Dashboard counts only those projects. Each link carries both filters, as it carries the
 * team, and each list reads them, so the list holds what the number counts (owner, 2026-10-06, item 3).
 */
describe('the Leader and Client filters reach the lists (owner, 2026-10-06)', () => {
  it('puts the leader, the client and the team in every link to a list', async () => {
    await renderApp('/dashboard?leader=usr_002&client=cli_001&team=tm_003');
    await tile(/Active projects/);
    const links = within(screen.getByRole('main')).getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('#/projects?') || href.startsWith('#/tasks?'));
    expect(links.length).toBeGreaterThan(3);
    for (const href of links) {
      expect(href).toContain('leader=usr_002');
      expect(href).toContain('client=cli_001');
      expect(href).toContain('team=tm_003');
    }
  });

  it('opens the Projects list with the leader of the Dashboard, so it holds the counted projects', async () => {
    await renderApp('/dashboard?leader=usr_002');
    const n = Number((await tile(/Active projects/)).textContent?.match(/\d+/)?.[0]);
    expect(n).toBeGreaterThan(0);
    await userEvent.click(await tile(/Active projects/));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    await waitFor(() => expect(projectRows()).toHaveLength(n));
    expect(window.location.hash).toContain('leader=usr_002');
    await userEvent.click(screen.getByRole('button', { name: 'Filter, 1 active' }));
    expect(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Leader' })).toHaveValue('usr_002');
  });

  it('opens the Projects list with the client of the Dashboard, and counts the client in the Filter button', async () => {
    const { api } = await renderApp('/projects?client=cli_002&status=all');
    const expected = (await api.call('projects.list', { clientId: 'cli_002', status: 'all' })).map((s) => s.project.name);
    expect(expected.length).toBeGreaterThan(0);
    await waitFor(() => expect(projectRows()).toHaveLength(expected.length));
    await userEvent.click(screen.getByRole('button', { name: 'Filter, 2 active' }));
    const client = within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Client' });
    expect(client).toHaveValue('cli_002');
    await userEvent.selectOptions(client, '');
    await waitFor(() => expect(window.location.hash).not.toContain('client='));
  });

  it('opens the past-due tasks of the leader and names the leader and the client', async () => {
    const { api } = await renderApp('/dashboard?leader=usr_002&client=cli_001');
    const { tiles } = await api.call('dashboard.get', { leaderId: 'usr_002', clientId: 'cli_001' });
    expect(tiles.overdueTasks).toBeGreaterThan(0);
    await userEvent.click(await tile(/Past-due tasks/));
    expect(await screen.findByRole('heading', { level: 1, name: 'Past-due tasks' })).toBeInTheDocument();
    expect(await screen.findByText(/Leader: Faisal Al-Harbi/)).toBeInTheDocument();
    expect(await screen.findByText(/Client: /)).toBeInTheDocument();
    await waitFor(() => expect(listRows()).toHaveLength(tiles.overdueTasks));
  });

  it('opens the deadlines of the leader and names the leader', async () => {
    const { api } = await renderApp('/dashboard?leader=usr_002');
    const { tiles } = await api.call('dashboard.get', { leaderId: 'usr_002' });
    expect(tiles.deadlinesNext14).toBeGreaterThan(0);
    await userEvent.click(await tile(/Deadlines, next 14 days/));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deadlines' })).toBeInTheDocument();
    expect(await screen.findByText(/Leader: Faisal Al-Harbi/)).toBeInTheDocument();
    await waitFor(() => expect(listRows()).toHaveLength(tiles.deadlinesNext14));
  });
});

/** The area in design reads low when a project has no area, so the row says how many (owner, 2026-10-06, item 4). */
describe('the Area in design row', () => {
  const noArea = (state: Parameters<NonNullable<Parameters<typeof renderApp>[1]>>[0]) => {
    state.projects.prj_001.areaM2 = null;
    state.projects.prj_002.areaM2 = null;
  };

  it('says how many projects in design have no area', async () => {
    await renderApp('/dashboard', noArea);
    expect(await tile(/Area in design/)).toHaveTextContent(/m² · 2 projects have no area/);
  });

  // The label keeps one line on a phone; the number and the note wrap under each other at the end instead (2026-10-06).
  it('keeps the label on one line and lets the number and the note wrap', async () => {
    await renderApp('/dashboard', noArea);
    const row = await tile(/Area in design/);
    expect(row.firstElementChild).toHaveClass('shrink-0');
    expect(row.children[1]).toHaveClass('flex-wrap', 'min-w-0', 'flex-1');
  });

  it('stays as before with no gap', async () => {
    await renderApp('/dashboard');
    expect(await tile(/Area in design/)).not.toHaveTextContent(/no area/);
  });

  it('uses the Arabic noun forms', async () => {
    await renderApp('/dashboard', (state) => {
      noArea(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    expect(await tile(/المساحة قيد التصميم/)).toHaveTextContent('مشروعان بلا مساحة');
  });
});

