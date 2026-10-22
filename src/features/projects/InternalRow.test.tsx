import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { addSampleInternalProject } from '../../data/sampleInternalProject';
import { TODAY } from '../../test/factories';
import { renderApp } from '../../test/render';

const LOCK = 'Only the team and chosen people';

describe('a row of the Projects list (fbk_044)', () => {
  it('shows the word Internal and a lock for an internal project, and no INT code', async () => {
    const { container } = await renderApp('/projects?status=all', (state) => addSampleInternalProject(state, TODAY));
    const row = (await screen.findByRole('link', { name: /Portfolio 2026/ })) as HTMLElement;
    expect(within(row).getByText('Internal')).toBeInTheDocument();
    expect(within(row).getByRole('img', { name: LOCK })).toHaveAttribute('title', LOCK);
    expect(container.textContent).not.toContain('INT-26');
  });

  it('shows a lock and no Internal word for a hidden client project, and neither for an open one', async () => {
    await renderApp('/projects?status=all', (state) => {
      state.projects.prj_001.access = { hidden: true, viewerIds: [] };
    });
    const hidden = (await screen.findByRole('link', { name: /Corniche Office Tower/ })) as HTMLElement;
    expect(within(hidden).getByRole('img', { name: LOCK })).toBeInTheDocument();
    expect(within(hidden).queryByText('Internal')).toBeNull();
    const open = screen.getByRole('link', { name: /Dune Line Townhouses/ });
    expect(within(open).queryByRole('img', { name: LOCK })).toBeNull();
  });
});
