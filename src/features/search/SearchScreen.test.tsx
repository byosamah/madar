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

  // The search lives in the link, so Back from a result shows the same search again (audit PER-14).
  it('keeps the search text in the link and brings it back after Back', async () => {
    const { router } = await renderApp('/search');
    await userEvent.type(await box(), 'corniche');
    await waitFor(() => expect(window.location.hash).toContain('q=corniche'));
    await userEvent.click(await screen.findByRole('option', { name: /Corniche Office Tower/ }));
    await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' });
    await router.navigate(-1);
    expect(await box()).toHaveValue('corniche');
    expect(await screen.findByRole('option', { name: /Corniche Office Tower/ })).toBeInTheDocument();
  });

  // A file found by Search opens that file, not only its tab (audit PER-15).
  it('opens the preview of a file it found', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'ground floor plan.pdf');
    const files = await screen.findByRole('group', { name: 'Files' });
    await userEvent.click(within(files).getAllByRole('option', { name: /Ground floor plan\.pdf/ })[0]);
    // The project, its file list and the preview load one after the other, so this step may take longer than one second. It
    // failed three times under the load of the full suite (2026-10-04): the search screen wrote "?q=" over the link of the file
    // (useQueryInLink.test.tsx), so the preview never opened. The longer wait stays for the load.
    expect(await screen.findByRole('dialog', { name: /Ground floor plan\.pdf/ }, { timeout: 10_000 })).toBeInTheDocument();
  }, 15_000);

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

  it('names the suggestion list in the language of the screen (audit 2026-10-03, F-4)', async () => {
    await renderApp('/search', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    expect(await screen.findByRole('listbox', { name: 'الاقتراحات' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Suggestions' })).toBeNull();
  });
});
