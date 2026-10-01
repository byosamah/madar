import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const rows = () => {
  const list = screen.queryByRole('list', { name: 'Projects' });
  return list ? within(list).queryAllByRole('listitem') : [];
};
const openFilter = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
  return screen.getByRole('dialog', { name: 'Filter' });
};

describe('the Team filter on the Projects list', () => {
  it('shows only the projects that a person of the team leads or is on, and keeps the team in the link', async () => {
    const { api } = await renderApp('/projects');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    const all = rows().length;
    const expected = (await api.call('projects.list', { teamId: 'tm_003' })).map((s) => s.project.name);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(all);
    const dialog = await openFilter();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Team' }), 'Interiors');
    await waitFor(() => expect(rows()).toHaveLength(expected.length));
    expect(window.location.hash).toContain('team=tm_003');
    for (const name of expected) expect(screen.getByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Team' }), 'Any team');
    await waitFor(() => expect(rows()).toHaveLength(all));
    expect(window.location.hash).not.toContain('team=');
  });

  it('opens from a link with the team already chosen', async () => {
    await renderApp('/projects?team=tm_002');
    // Technical: Omar, Yousef and Khalid. The Corniche tower has Yousef and Khalid on its team.
    expect(await screen.findByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tamr Boutique Hotel/ })).toBeNull();
    expect(within(await openFilter()).getByRole('combobox', { name: 'Team' })).toHaveValue('tm_002');
  });

  it('shows no projects for a team that was deleted, and lets the person clear the choice', async () => {
    await renderApp('/projects?team=tm_099');
    expect(await screen.findByText('No projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
  });
});

describe('the Team filter on the Dashboard', () => {
  it('narrows the numbers, keeps the team in the link and hands it to the meeting view', async () => {
    const { api } = await renderApp('/dashboard');
    const link = await screen.findByRole('link', { name: /Active projects/ });
    const before = Number(link.textContent?.match(/\d+/)?.[0]);
    const expected = (await api.call('dashboard.get', { teamId: 'tm_003' })).tiles.activeProjects;
    expect(expected).toBeLessThan(before);
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    const dialog = screen.getByRole('dialog', { name: 'Filter' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Team' }), 'Interiors');
    await waitFor(() => expect(window.location.hash).toContain('team=tm_003'));
    await waitFor(async () => expect(await screen.findByRole('link', { name: /Active projects/ })).toHaveTextContent(String(expected)));
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Meeting view' }));
    await waitFor(() => expect(window.location.hash).toContain('/dashboard/meeting'));
    expect(window.location.hash).toContain('team=tm_003');
  });
});

describe('the Team filter in the meeting view', () => {
  it('lists only the projects of the team, and names the team among the filters', async () => {
    const { api } = await renderApp('/dashboard/meeting?team=tm_003');
    const expected = (await api.call('dashboard.get', { teamId: 'tm_003' })).schedule.length;
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(expected));
    expect(expected).toBeLessThan(9);
    expect(screen.getByText(/Filters: Team: Interiors/)).toBeInTheDocument();
  });
});
