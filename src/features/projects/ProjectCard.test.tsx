import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { useCall } from '../../app/runtime';
import { renderWithRuntime } from '../../test/render';
import { ProjectCard } from './ProjectCard';

function Card({ id }: { id: string }) {
  const list = useCall('projects.list', { status: 'all' });
  const summary = list.data?.find((s) => s.project.id === id);
  return summary ? <ProjectCard summary={summary} /> : null;
}
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const openMenu = async () => {
  fireEvent.contextMenu(await screen.findByRole('link', { name: /Corniche Office Tower/ }), { clientX: 20, clientY: 20 });
  return within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
};

describe('the project card', () => {
  it('shows the code, health, client, stage, latest updates, next deadline and people', async () => {
    await renderWithRuntime(<Card id="prj_001" />, undefined, { path: '/' });
    const card = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(card).getAllByText('KH-26-001').length).toBeGreaterThan(0);
    expect(within(card).getByText('Late')).toBeInTheDocument();
    expect(within(card).getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Stage 4 of 7: Construction Documents' })).toBeInTheDocument();
    expect(within(within(card).getByRole('list', { name: 'Latest updates' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(card).getByText('Coordination workshop').closest('p')).toHaveTextContent('Coordination workshop · 5 Oct · 5d');
    expect(within(within(card).getByRole('group', { name: 'Team' })).getAllByRole('img')[0]).toHaveAccessibleName('Faisal Al-Harbi');
  });

  it('shows the code on a tinted panel when there is no cover, and says when there is no leader', async () => {
    await renderWithRuntime(<Card id="prj_005" />, (state) => {
      state.projects.prj_005.leaderId = null;
    }, { path: '/' });
    expect(await screen.findByRole('img', { name: 'Cover image of Tamr Boutique Hotel' })).toHaveTextContent('KH-26-005');
    expect(screen.getByText('No leader')).toBeInTheDocument();
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

  it('shares its cover with the project header, so the card can grow into the screen', async () => {
    await renderWithRuntime(<Card id="prj_005" />, undefined, { path: '/' });
    const cover = await screen.findByRole('img', { name: 'Cover image of Tamr Boutique Hotel' });
    expect(cover.closest('[data-layout-id]')).toHaveAttribute('data-layout-id', 'cover-prj_005');
  });
});
