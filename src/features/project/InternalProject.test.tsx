import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { addSampleInternalProject } from '../../data/sampleInternalProject';
import { TODAY } from '../../test/factories';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The screens of an internal project (fbk_044, owner 2026-10-22): the word Internal where a code shows, a lock mark on a hidden
 * project, and no Tracker tab and no payments part. The sample "Portfolio 2026" is hidden and internal. prj_001 is a client project.
 */
const withInternal = (state: State) => {
  addSampleInternalProject(state, TODAY);
};
const internalId = (state: State) => Object.values(state.projects).find((project) => project.kind === 'internal')!.id;
const LOCK = 'Only the team and chosen people';

describe('the page of an internal project', () => {
  it('shows the word Internal in place of the code, a lock mark with its words, and no INT code', async () => {
    let id = '';
    const { container } = await renderApp('/projects/prj_013', (state) => {
      withInternal(state);
      id = internalId(state);
    });
    expect(id).toBe('prj_013');
    const title = await screen.findByRole('heading', { level: 1, name: /Portfolio 2026/ });
    const header = title.closest('header') as HTMLElement;
    expect(within(header).getByText('Internal')).toBeInTheDocument();
    expect(within(title).getByRole('img', { name: LOCK })).toHaveAttribute('title', LOCK);
    expect(container.textContent).not.toContain('INT-26-001');
  });

  it('has no Tracker tab and no payments part, also for the Admin', async () => {
    await renderApp('/projects/prj_013', withInternal);
    await screen.findByRole('heading', { level: 1, name: /Portfolio 2026/ });
    const tabs = within(screen.getByRole('tablist', { name: 'Project sections' })).getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Overview', 'To-dos', 'Activity', 'Schedule', 'Files & Links', 'Team']);
    expect(screen.queryByRole('heading', { name: 'Payments' })).toBeNull();
  });

  it('opens the Tracker address as the Overview, because the tab does not exist', async () => {
    await renderApp('/projects/prj_013?tab=tracker', withInternal);
    await screen.findByRole('heading', { level: 1, name: /Portfolio 2026/ });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the Tracker tab, the payments part and the code of a client project, and shows no lock', async () => {
    await renderApp('/projects/prj_001', withInternal);
    const title = await screen.findByRole('heading', { level: 1, name: /Corniche Office Tower/ });
    const header = title.closest('header') as HTMLElement;
    expect(within(header).getByText('KH-26-001')).toBeInTheDocument();
    expect(within(header).queryByRole('img', { name: LOCK })).toBeNull();
    expect(within(screen.getByRole('tablist', { name: 'Project sections' })).getByRole('tab', { name: 'Tracker' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Payments' })).toBeInTheDocument();
  });

  it('shows a lock on an open client project that the leader hides, and not the word Internal', async () => {
    await renderApp('/projects/prj_001', (state) => {
      state.projects.prj_001.access = { hidden: true, viewerIds: [] };
    });
    const title = await screen.findByRole('heading', { level: 1, name: /Corniche Office Tower/ });
    expect(within(title).getByRole('img', { name: LOCK })).toBeInTheDocument();
    expect(within(title.closest('header') as HTMLElement).queryByText('Internal')).toBeNull();
  });
});

describe('the About panel of an internal project', () => {
  it('leaves out the code, client, place, area, sub-company and contract date', async () => {
    await renderApp('/projects/prj_013', withInternal);
    await screen.findByRole('heading', { level: 1, name: /Portfolio 2026/ });
    const about = (await screen.findByRole('heading', { name: 'About' })).closest('section') as HTMLElement;
    for (const label of ['Project code', 'Location', 'Area (m²)', 'Contract start date']) {
      expect(within(about).queryByText(label), label).toBeNull();
    }
    expect(within(about).getByText('Start date')).toBeInTheDocument();
  });
});
