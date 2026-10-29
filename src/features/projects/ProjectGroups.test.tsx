import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addSampleInternalProject } from '../../data/sampleInternalProject';
import { TODAY } from '../../test/factories';
import { renderApp } from '../../test/render';

const withInternal = (state: Parameters<typeof addSampleInternalProject>[0]) => addSampleInternalProject(state, TODAY);

/** The names of the groups in the order of the page, and the project names in each group. */
function groups(): { title: string; rows: string[] }[] {
  return screen.getAllByRole('list', { name: /^(Projects|Internal)$/ }).map((list) => ({
    title: list.getAttribute('aria-label') ?? '',
    rows: within(list).getAllByRole('link').map((link) => link.textContent ?? ''),
  }));
}

// Faisal asked to keep the internal projects apart from the client projects, and to choose which group is on top (fbk_075, owner 2026-10-29).
describe('the two groups of the Projects list', () => {
  it('shows Projects first and Internal under it, each with a title, when both groups have rows', async () => {
    await renderApp('/projects?status=all', withInternal);
    await screen.findByRole('link', { name: /Portfolio 2026/ });
    const [first, second] = groups();
    expect(first.title).toBe('Projects');
    expect(first.rows.some((row) => row.includes('Corniche Office Tower'))).toBe(true);
    expect(first.rows.some((row) => row.includes('Portfolio 2026'))).toBe(false);
    expect(second.title).toBe('Internal');
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]).toContain('Portfolio 2026');
    expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Internal' })).toBeInTheDocument();
  });

  it('puts Internal on top after the choice "Show first", and keeps the choice for the next visit', async () => {
    const first = await renderApp('/projects?status=all', withInternal);
    await screen.findByRole('link', { name: /Portfolio 2026/ });
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Show first' }), 'internal');
    expect(groups().map((group) => group.title)).toEqual(['Internal', 'Projects']);
    first.unmount();
    await renderApp('/projects?status=all', withInternal);
    await screen.findByRole('link', { name: /Portfolio 2026/ });
    expect(groups().map((group) => group.title)).toEqual(['Internal', 'Projects']);
  });

  it('keeps one list with no group titles and no "Show first" choice when the person sees no internal project', async () => {
    await renderApp('/projects?status=all');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(screen.queryByRole('heading', { level: 2, name: 'Internal' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Internal' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Filter/ }));
    await screen.findByRole('combobox', { name: 'Sort' });
    expect(screen.queryByRole('combobox', { name: 'Show first' })).toBeNull();
  });
});
