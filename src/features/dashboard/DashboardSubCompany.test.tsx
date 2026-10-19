import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const AT = '2026-10-18T09:00:00.000+03:00';
const company = (id: string, name: string, nameAr: string) => ({ id, name, nameAr, logo: null, createdBy: 'usr_001', createdAt: AT });

/** The sample office with two sub-companies: Vado names every other project, Bunah the rest. The last project names none. */
function withCompanies(state: State) {
  state.subCompanies = { sub_001: company('sub_001', 'Vado', 'فادو'), sub_002: company('sub_002', 'Bunah', 'بناة') };
  const ids = Object.keys(state.projects).sort();
  // The one project with no sub-company is an active one, because the data gap counts active projects.
  const unnamed = ids.filter((id) => state.projects[id].status === 'active').pop();
  ids.forEach((id, n) => {
    state.projects[id].subCompanyId = id === unnamed ? null : n % 2 === 0 ? 'sub_001' : 'sub_002';
  });
}

/** The sample office with no sub-company at all. */
function withoutCompanies(state: State) {
  state.subCompanies = {};
  for (const project of Object.values(state.projects)) delete project.subCompanyId;
}

const tile = (name: RegExp) => screen.findByRole('link', { name });
const filterDialog = () => screen.findByRole('dialog', { name: 'Filter' });

describe('the sub-company filter of the Dashboard (INT-09, PRJ-15)', () => {
  it('offers a Sub-company choice in the one Filter, and counts only that sub-company', async () => {
    const { api } = await renderApp('/dashboard', withCompanies);
    const vado = await api.call('dashboard.get', { subCompanyId: 'sub_001' });
    const all = await api.call('dashboard.get', {});
    expect(vado.tiles.activeProjects).toBeLessThan(all.tiles.activeProjects);
    await tile(/^Active projects(?! with)/);
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.selectOptions(within(await filterDialog()).getByRole('combobox', { name: 'Sub-company' }), 'sub_001');
    await waitFor(() => expect(window.location.hash).toContain('subCompany=sub_001'));
    expect((await tile(/^Active projects(?! with)/)).textContent).toContain(String(vado.tiles.activeProjects));
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
  });

  it('puts the sub-company in every link to a list, the meeting link and the Open space link', async () => {
    await renderApp('/dashboard?subCompany=sub_001', withCompanies);
    await tile(/^Active projects(?! with)/);
    const hrefs = within(screen.getByRole('main')).getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('#/projects?') || href.startsWith('#/tasks?'));
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) expect(href).toContain('subCompany=sub_001');
    await userEvent.click(screen.getByRole('button', { name: 'Open space' }));
    await waitFor(() => expect(window.location.hash).toContain('/dashboard/space?subCompany=sub_001'));
  });

  it('opens the past-due tasks of the sub-company, names it, and lists what the number counts', async () => {
    const { api } = await renderApp('/dashboard?subCompany=sub_001', withCompanies);
    const { tiles } = await api.call('dashboard.get', { subCompanyId: 'sub_001' });
    expect(tiles.overdueTasks).toBeGreaterThan(0);
    await userEvent.click(await tile(/Past-due tasks/));
    expect(await screen.findByRole('heading', { level: 1, name: 'Past-due tasks' })).toBeInTheDocument();
    expect(await screen.findByText(/Sub-company: Vado/)).toBeInTheDocument();
    await waitFor(() => expect(within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem')).toHaveLength(tiles.overdueTasks));
  });

  it('shows no Sub-company choice when the office has none', async () => {
    await renderApp('/dashboard', withoutCompanies);
    await tile(/^Active projects(?! with)/);
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(within(await filterDialog()).queryByRole('combobox', { name: 'Sub-company' })).toBeNull();
    expect(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Leader' })).toBeInTheDocument();
  });
});

describe('the projects with no sub-company (INT-10)', () => {
  it('lists them in the data gaps of the Admin, and the row opens the Projects list of those projects', async () => {
    const { api } = await renderApp('/dashboard', withCompanies);
    const gaps = (await api.call('dashboard.get', {})).gaps;
    expect(gaps?.noSubCompany).toBe(1);
    const link = await screen.findByRole('link', { name: /Active projects with no sub-company/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('/projects?filter=no_sub_company'));
  });

  it('shows no such gap when the office has no sub-company', async () => {
    await renderApp('/dashboard', withoutCompanies);
    await tile(/^Active projects(?! with)/);
    expect(screen.queryByRole('link', { name: /with no sub-company/ })).toBeNull();
  });

  it('offers "No sub-company" in the Projects filter, and lists only those projects', async () => {
    await renderApp('/projects?status=all', withCompanies);
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    const select = within(await filterDialog()).getByRole('combobox', { name: 'Sub-company' });
    expect(within(select).getByRole('option', { name: 'No sub-company' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'none');
    await waitFor(() => expect(window.location.hash).toContain('filter=no_sub_company'));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('Projects with no sub-company')).toBeInTheDocument();
  });
});

describe('the logo badge shows wherever a project picture shows (PRJ-15)', () => {
  it('shows it on the Dashboard cards that name a project', async () => {
    await renderApp('/dashboard', withCompanies);
    await tile(/^Active projects(?! with)/);
    const cards = await screen.findAllByRole('region');
    const rows = cards.filter((card) => card.querySelector('[data-project-mark]'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((card) => card.querySelector('[data-sub-company-badge]'))).toBe(true);
  });
});
