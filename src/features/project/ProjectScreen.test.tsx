import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';

describe('the Project screen header', () => {
  it('shows a calm header: tile, name, client, one stage line and one main button', async () => {
    await renderApp(PROJECT);
    const heading = await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' });
    const header = heading.closest('header') as HTMLElement;
    expect(header.querySelector('[data-project-mark]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(header).getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /Late/ })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /Construction Documents/ })).toBeInTheDocument();
    expect(within(header).getByRole('progressbar', { name: 'Stage 4 of 7' })).toBeInTheDocument();
    expect(within(header).queryByRole('img', { name: /Cover image/ })).toBeNull();
    expect(within(header).getByRole('button', { name: 'Post update' })).toHaveClass('signature');
    expect(document.querySelectorAll('main .signature')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves the cover into the About panel of the Overview', async () => {
    await renderApp(PROJECT);
    const about = await screen.findByRole('region', { name: 'About' });
    expect(within(about).getByRole('img', { name: 'Cover image of Corniche Office Tower' })).toBeInTheDocument();
    expect(within(about).getByText('Al Khobar, Corniche')).toBeInTheDocument();
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

  it('makes another stage current from the stage list', async () => {
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
    const popover = screen.getByRole('dialog', { name: 'Stages' });
    await userEvent.click(within(popover).getByRole('button', { name: /Permits/ }));
    expect(await within(popover).findByText('Tasks done: 0 of 2')).toBeInTheDocument();
    await userEvent.click(within(popover).getByRole('button', { name: 'Make current stage' }));
    const header = (await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).closest('header') as HTMLElement;
    expect(await within(header).findByRole('progressbar', { name: 'Stage 5 of 7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Permits/ })).toBeInTheDocument();
  });

  it('moves back to an earlier stage only with a reason, and the Overview says why (colleague comment 12)', async () => {
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
    const popover = screen.getByRole('dialog', { name: 'Stages' });
    await userEvent.click(within(popover).getByRole('button', { name: /Design Development/ }));
    const move = await within(popover).findByRole('button', { name: 'Move back to Design Development' });
    expect(move).toBeDisabled();
    await userEvent.type(within(popover).getByLabelText('Why does the project move back?'), 'Balady asked for changes to the drawings');
    await userEvent.click(within(popover).getByRole('checkbox', { name: 'Log it in the Tracker as a Balady update' }));
    await userEvent.click(move);
    const standing = await screen.findByRole('region', { name: 'Where the project stands' });
    expect(await within(standing).findByText(/Moved back from Construction Documents/)).toHaveTextContent('Balady asked for changes to the drawings');
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

  it('starts the stages of an existing project from a template, and shows why a stage with tasks cannot go', async () => {
    const { store } = await renderApp(PROJECT);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    const start = within(sheet).getByLabelText('Start from');
    expect(within(start).getByRole('option', { name: 'Current stages' })).toBeInTheDocument();
    await userEvent.selectOptions(start, 'Competition entry');
    expect(within(sheet).getAllByLabelText(/^Stage \d+$/).map((input) => (input as HTMLInputElement).value)).toEqual(['Brief', 'Concept', 'Presentation']);
    const before = Object.values(store.state.stages).filter((s) => s.projectId === 'prj_001').length;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('A stage with tasks cannot be removed. Move its tasks first.')).toBeInTheDocument();
    expect(Object.values(store.state.stages).filter((s) => s.projectId === 'prj_001')).toHaveLength(before);
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

  it('goes Back to the same filtered list the project was opened from', async () => {
    await renderApp('/projects?filter=at_risk');
    const card = within(await screen.findByRole('list', { name: 'Projects' })).getAllByRole('listitem')[0];
    await userEvent.click(within(card).getAllByRole('link')[0]);
    await screen.findByRole('heading', { level: 1 });
    const header = document.querySelector('main header') as HTMLElement;
    await userEvent.click(within(header).getByRole('link', { name: 'Projects' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects?filter=at_risk'));
  });

  it('opens a project at the top of the page', async () => {
    const scroll = vi.spyOn(window, 'scrollTo');
    await renderApp('/projects');
    const card = within(await screen.findByRole('list', { name: 'Projects' })).getAllByRole('listitem')[0];
    await userEvent.click(within(card).getAllByRole('link')[0]);
    await screen.findByRole('heading', { level: 1 });
    expect(scroll).toHaveBeenCalledWith(0, 0);
    scroll.mockRestore();
  });
});

describe('pausing a project', () => {
  it('lets the leader pause with a reason, shows the banner, then resumes', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pause project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pause this project?' });
    const pause = within(sheet).getByRole('button', { name: 'Pause project' });
    expect(pause).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'The client reviews the budget.');
    await userEvent.click(pause);
    const banner = await screen.findByRole('region', { name: 'Paused' });
    expect(within(banner).getByText('The client reviews the budget.')).toBeInTheDocument();
    expect(within(banner).getByText(/Faisal Al-Harbi paused this project on/)).toBeInTheDocument();
    expect(store.state.projects.prj_001.status).toBe('on_hold');
    await userEvent.click(within(banner).getByRole('button', { name: 'Resume project' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Paused' })).toBeNull());
    expect(store.state.projects.prj_001.status).toBe('active');
  });

  it('does not offer Pause to a team member', async () => {
    await renderApp('/projects/prj_001', as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }).catch(() => document.body));
    expect(screen.queryByRole('menuitem', { name: 'Pause project' })).toBeNull();
  });
});
