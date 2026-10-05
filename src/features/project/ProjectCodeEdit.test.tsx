import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const LOAD = { timeout: 10_000 };
const PROJECT = '/projects/prj_001';

async function openEdit() {
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  return screen.findByRole('dialog', { name: 'Edit project' });
}

describe('the project code on the project page (item 6b)', () => {
  it('shows the full code in the header and in About, with the class in words', async () => {
    await renderApp(PROJECT, (state: State) => {
      state.projects.prj_001.code = '260902GCH-COM-Office Tower';
    });
    const heading = await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' }, LOAD);
    expect(within(heading.closest('header') as HTMLElement).getByText('260902GCH-COM-Office Tower')).toBeInTheDocument();
    const about = await screen.findByRole('region', { name: 'About' }, LOAD);
    const code = within(about).getByText('Project code').nextElementSibling as HTMLElement;
    expect(code).toHaveTextContent('260902GCH-COM-Office Tower');
    expect(code).toHaveTextContent('Commercial');
  });

  it('lets the Admin correct the code, and the feed records it', async () => {
    const { store } = await renderApp(PROJECT);
    const sheet = await openEdit();
    const field = within(sheet).getByLabelText('Project code');
    expect(field).toHaveValue('KH-26-001');
    expect(within(sheet).getByText('Only the Admin corrects the code. The History keeps the old code.')).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, '260902gch-com-Office Tower');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.code).toBe('260902GCH-COM-Office Tower'));
    expect(Object.values(store.state.events).some((e) => e.verb === 'project.code_changed' && e.targetId === 'prj_001')).toBe(true);
  });

  it('refuses a wrong code under the field, and saves nothing', async () => {
    const { store } = await renderApp(PROJECT);
    const sheet = await openEdit();
    const field = within(sheet).getByLabelText('Project code');
    await userEvent.clear(field);
    await userEvent.type(field, '260902GCH');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    expect(within(sheet).getByText('Use a code like 260902AZT-RES-Villa.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.code).toBe('KH-26-001');
  });

  it('does not offer the code to the project leader', async () => {
    const { store } = await renderApp(PROJECT, (state: State) => {
      state.session.currentUserId = state.projects.prj_001.leaderId!;
    });
    const sheet = await openEdit();
    expect(within(sheet).queryByLabelText('Project code')).toBeNull();
    const name = within(sheet).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Corniche Tower');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.name).toBe('Corniche Tower'));
    expect(store.state.projects.prj_001.code).toBe('KH-26-001');
  });
});
