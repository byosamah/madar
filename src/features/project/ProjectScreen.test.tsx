import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';

describe('the Project screen header', () => {
  it('shows the cover, code, name, client, health, stage rail and the main action', async () => {
    await renderApp(PROJECT);
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
    expect(screen.getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Late/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Stage 4 of 7: Construction Documents' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Post update' })).toBeInTheDocument();
  });

  it('shows a project as view only to a person outside it', async () => {
    await renderApp(PROJECT, as('usr_003'));
    await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' });
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post update' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Late/ })).toBeNull();
  });

  it('sets the health by hand with a reason', async () => {
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Late/ }));
    const popover = screen.getByRole('dialog', { name: 'Set health' });
    await userEvent.click(within(popover).getByRole('radio', { name: 'At risk' }));
    await userEvent.type(within(popover).getByLabelText('Reason'), 'Client delay');
    await userEvent.click(within(popover).getByRole('button', { name: 'Set health' }));
    expect(await screen.findByText('Set by Faisal Al-Harbi')).toBeInTheDocument();
  });

  it('makes another stage current from the rail', async () => {
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Permits' }));
    const popover = screen.getByRole('dialog', { name: 'Permits' });
    expect(await within(popover).findByText('Tasks done: 0 of 2')).toBeInTheDocument();
    await userEvent.click(within(popover).getByRole('button', { name: 'Make current stage' }));
    expect(await screen.findByRole('list', { name: 'Stage 5 of 7: Permits' })).toBeInTheDocument();
  });

  it('changes the leader', async () => {
    const { store } = await renderApp(PROJECT);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change leader' }));
    const sheet = await screen.findByRole('dialog', { name: 'Change leader' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Leader'), 'Sara Al-Qahtani');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.projects.prj_001.leaderId).toBe('usr_005'));
    expect(await screen.findByText('Leader changed.')).toBeInTheDocument();
  });

  it('edits the project name', async () => {
    await renderApp(PROJECT);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    const name = within(sheet).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Corniche Tower');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Tower' })).toBeInTheDocument();
  });

  it('lets the Admin delete the project after one confirmation', async () => {
    const { store } = await renderApp(PROJECT);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete Corniche Office Tower?' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(store.state.projects.prj_001).toBeUndefined());
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });

  it('opens the tab from the link and says when a project does not exist', async () => {
    const first = await renderApp('/projects/prj_001?tab=team');
    expect(await screen.findByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true');
    first.unmount();
    await renderApp('/projects/prj_999');
    expect(await screen.findByText('This project does not exist anymore.')).toBeInTheDocument();
  });

  it('draws the cover at once while the project loads, so the card can grow into it', async () => {
    await renderApp('/', undefined, { latencyMs: 60 });
    const card = (await screen.findAllByRole('article'))[0];
    const id = card.querySelector('[data-layout-id]')?.getAttribute('data-layout-id');
    await userEvent.click(within(card).getAllByRole('link')[0]);
    expect(document.querySelector(`main [data-layout-id="${id}"]`)).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
