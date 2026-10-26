import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * "Only my work" on the Projects screen (owner, 2026-10-26, fbk_065): a bare link opens an Admin with this choice on "My projects".
 * A link with a filter key keeps "All". "All" stays one press away in the Filter and writes filter=all into the link.
 */
const rows = () => {
  const list = screen.queryByRole('list', { name: 'Projects' });
  return list ? within(list).queryAllByRole('listitem') : [];
};
const openFilter = async () => {
  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  return screen.getByRole('dialog', { name: 'Filter' });
};
const reach = (choice: 'mine' | 'mixed' | 'all') => (state: State) => {
  state.users.usr_001.preferences.adminReach = choice;
};
/** Hala (usr_001) is the Admin. She leads or works on only some of the active projects. */
async function mineCount() {
  const app = await renderApp('/projects?filter=mine', reach('mixed'));
  await screen.findByRole('list', { name: 'Projects' });
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  const count = rows().length;
  app.unmount();
  return count;
}

describe('the Projects screen for an Admin with "Only my work"', () => {
  it('opens a bare link on My projects, without a filter count', async () => {
    const mine = await mineCount();
    expect(mine).toBeLessThan(9);
    await renderApp('/projects', reach('mine'));
    await waitFor(() => expect(rows()).toHaveLength(mine));
    const dialog = await openFilter();
    expect(within(dialog).getByRole('radio', { name: 'My projects' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('keeps every project for "My work, and the rest in the list" and for "Everything"', async () => {
    const first = await renderApp('/projects', reach('mixed'));
    await waitFor(() => expect(rows()).toHaveLength(9));
    first.unmount();
    await renderApp('/projects', reach('all'));
    await waitFor(() => expect(rows()).toHaveLength(9));
  });

  it('shows All one press away, writes filter=all into the link, and counts it as no filter', async () => {
    await renderApp('/projects', reach('mine'));
    await waitFor(() => expect(rows().length).toBeLessThan(9));
    await userEvent.click(within(await openFilter()).getByRole('radio', { name: 'All' }));
    await waitFor(() => expect(rows()).toHaveLength(9));
    expect(window.location.hash).toContain('filter=all');
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('keeps All as the default of a link with any filter key', async () => {
    await renderApp('/projects?stage=Permits', reach('mine'));
    expect(await screen.findByRole('link', { name: /Al Waha Clinic Fit-out/ })).toBeInTheDocument();
    expect(within(await openFilter()).getByRole('radio', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
  });

  it('keeps My projects when a stage is picked from a bare link', async () => {
    const mine = await mineCount();
    await renderApp('/projects', reach('mine'));
    await waitFor(() => expect(rows()).toHaveLength(mine));
    const dialog = await openFilter();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Stage' }), 'Permits');
    await waitFor(() => expect(window.location.hash).toContain('stage=Permits'));
    expect(window.location.hash).toContain('filter=mine');
    expect(within(dialog).getByRole('radio', { name: 'My projects' })).toBeChecked();
    expect(rows().length).toBeLessThanOrEqual(mine);
  });

  it('leaves a Member as before: a bare link shows every project', async () => {
    await renderApp('/projects', (state) => {
      state.session.currentUserId = 'usr_005';
      state.users.usr_005.preferences.adminReach = 'mine';
    });
    await waitFor(() => expect(rows().length).toBeGreaterThan(4));
  });
});
