import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const asSara = (state: State) => {
  state.session.currentUserId = 'usr_005';
};
const box = () => screen.findByRole('combobox');

describe('search', () => {
  it('finds a project in capital letters and opens it with Enter', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'CORNICHE');
    expect(await screen.findByRole('option', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('shows tasks and files in their own groups', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'ground floor');
    const tasks = await screen.findByRole('group', { name: 'Tasks' });
    expect(within(tasks).getAllByRole('option', { name: /Ground floor plan/ }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('group', { name: 'Files' })).getAllByRole('option', { name: /Ground floor plan\.pdf/ }).length).toBeGreaterThan(0);
  });

  it('runs a command', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'dash');
    await userEvent.click(await screen.findByRole('option', { name: 'Go to Dashboard' }));
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'));
  });

  it('creates a task from the New task command', async () => {
    const { store } = await renderApp('/search', asSara);
    await userEvent.click(await screen.findByRole('option', { name: 'New task' }));
    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Project'), 'KH-26-001 · Corniche Office Tower');
    await userEvent.type(within(sheet).getByLabelText('Title'), 'Fire exit check');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Task created.')).toBeInTheDocument();
    expect(Object.values(store.state.tasks).some((task) => task.title === 'Fire exit check' && task.ownerId === 'usr_005' && task.stageId === 'stg_004')).toBe(true);
  });

  it('opens a person with their active projects', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'sara');
    const list = await screen.findByRole('group', { name: 'People' });
    await userEvent.click(await within(list).findByRole('option', { name: /Sara Al-Qahtani/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sara Al-Qahtani' });
    expect(within(sheet).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'zzzz');
    expect(await screen.findByText('No results for “zzzz”.')).toBeInTheDocument();
  });
});
