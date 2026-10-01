import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { useCall } from '../../app/runtime';
import { renderWithRuntime } from '../../test/render';
import { ProjectCover } from './ProjectCard';
import { ProjectListRow } from './ProjectListRow';

function Card({ id }: { id: string }) {
  const list = useCall('projects.list', { status: 'all' });
  const summary = list.data?.find((s) => s.project.id === id);
  return summary ? <ul><ProjectListRow summary={summary} source="projects" /></ul> : null;
}
function Cover({ id }: { id: string }) {
  const list = useCall('projects.list', { status: 'all' });
  const summary = list.data?.find((s) => s.project.id === id);
  return summary ? <ProjectCover summary={summary} /> : null;
}
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const openMenu = async () => {
  fireEvent.contextMenu(await screen.findByRole('link', { name: /Corniche Office Tower/ }), { clientX: 20, clientY: 20 });
  return within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
};

describe('the project row', () => {
  it('shows the tile, name, stage, client, progress, next deadline and the state word', async () => {
    await renderWithRuntime(<Card id="prj_001" />, undefined, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(row.querySelector('[data-project-mark]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(row).getByText('Late')).toBeInTheDocument();
    expect(within(row).getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(within(row).getByRole('progressbar', { name: 'Stage 4 of 7' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(row).getByText('Coordination workshop').closest('p')).toHaveTextContent('Coordination workshop · In 5 days');
    expect(within(row).queryByRole('list', { name: 'Latest updates' })).toBeNull();
  });

  it('truncates a long name and keeps the row in shape', async () => {
    await renderWithRuntime(<Card id="prj_001" />, (state) => {
      state.projects.prj_001.name = 'Corniche Office Tower and Podium Retail with Underground Parking Levels';
    }, { path: '/' });
    const row = await screen.findByRole('link', { name: /Corniche Office Tower and Podium/ });
    expect(within(row).getByText(/Corniche Office Tower and Podium/)).toHaveClass('truncate');
  });

  it('draws the project picture large when there is no cover', async () => {
    await renderWithRuntime(<Cover id="prj_005" />, undefined, { path: '/' });
    const cover = await screen.findByRole('img', { name: 'Cover image of Tamr Boutique Hotel' });
    expect(cover).toHaveAttribute('data-project-mark');
    expect(cover.querySelector('svg path')).not.toBeNull();
  });

  it('offers a person outside the project only Open and Copy link', async () => {
    await renderWithRuntime(<Card id="prj_001" />, as('usr_004'), { path: '/' });
    expect(await openMenu()).toEqual(['Open', 'Copy link']);
  });

  it('lets a team member post, but not archive', async () => {
    await renderWithRuntime(<Card id="prj_001" />, as('usr_005'), { path: '/' });
    expect(await openMenu()).toEqual(['Open', 'Post update', 'Copy link']);
  });

  it('archives the project from the menu, then undoes it', async () => {
    const { store } = await renderWithRuntime(<Card id="prj_001" />, as('usr_002'), { path: '/' });
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Project archived.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.status).toBe('archived');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.status).toBe('active'));
  });
});
