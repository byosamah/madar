import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const LOAD = { timeout: 10_000 };

/** Two projects of one contract share one code (owner, 2026-10-05). A third project has a code of its own. */
function shared(state: State) {
  state.projects.prj_003.code = '260902AZT-RES-Multi-unit Dev.';
  state.projects.prj_007.code = '260902AZT-RES-Multi-unit Dev.';
  state.projects.prj_005.code = '260903BCD-COM-Hotel';
}

describe('project links by the new code (item 6b)', () => {
  it('opens a project from its key', async () => {
    await renderApp('/projects/code/260903BCD', shared);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tamr Boutique Hotel' }, LOAD)).toBeInTheDocument();
  });

  it('opens a project from its full code', async () => {
    await renderApp(`/projects/code/${encodeURIComponent('260903BCD-COM-Hotel')}`, shared);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tamr Boutique Hotel' }, LOAD)).toBeInTheDocument();
  });

  it('shows the two projects of one code to choose from', async () => {
    await renderApp('/projects/code/260902AZT', shared);
    const list = await screen.findByRole('list', { name: 'Projects with this code' }, LOAD);
    expect(within(list).getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Eastern Shore Primary School'),
      expect.stringContaining('Seaside Villa Compound'),
    ]);
    await userEvent.click(within(list).getByRole('link', { name: /Seaside Villa Compound/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Seaside Villa Compound' }, LOAD)).toBeInTheDocument();
  });

  it('turns a key in a post into a link', async () => {
    const { api } = await renderApp('/projects/prj_001', (state) => {
      shared(state);
      state.session.currentUserId = 'usr_002';
    });
    await api.call('updates.create', { projectId: 'prj_001', body: 'Same facade as #260903BCD' });
    await userEvent.click(await screen.findByRole('link', { name: '#260903BCD' }, LOAD));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tamr Boutique Hotel' }, LOAD)).toBeInTheDocument();
  });
});
