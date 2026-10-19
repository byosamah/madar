import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// The links of a project sit in the Files & Links tab, above the files, and one Add button offers a file or a link
// (owner, 2026-10-19: "remove links from About, add it to the Files section and call it Files & Links").

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const FILES = '/projects/prj_001?tab=files';

async function choose(item: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the tab and the About panel', () => {
  it('names the tab Files & Links and keeps the old address ?tab=files', async () => {
    await renderApp(FILES);
    const tab = await screen.findByRole('tab', { name: 'Files & Links' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Files' })).toBeNull();
  });

  it('shows no links and no Add link button in the About panel', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    const about = await screen.findByRole('region', { name: 'About' });
    expect(within(about).queryByRole('heading', { name: 'Links' })).toBeNull();
    expect(within(about).queryByRole('link', { name: /Pinterest: facades/ })).toBeNull();
    expect(within(about).queryByRole('button', { name: /link/i })).toBeNull();
  });
});

describe('the links list in the Files & Links tab', () => {
  it('puts the links above the files', async () => {
    await renderApp(FILES);
    const links = await screen.findByRole('region', { name: 'Links' });
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(links.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists the links: a web link opens in a new tab, the office folder gets a Copy button', async () => {
    await renderApp(FILES);
    const links = await screen.findByRole('region', { name: 'Links' });
    const pinterest = await within(links).findByRole('link', { name: /Pinterest: facades/ });
    expect(pinterest).toHaveAttribute('href', 'https://www.pinterest.com/madar-studio/corniche-facades/');
    expect(pinterest).toHaveAttribute('target', '_blank');
    expect(pinterest).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(links).getByRole('button', { name: /^Copy / })).toBeInTheDocument();
  });

  it('shows the links to someone outside the project, with no Add button and no way to change a link', async () => {
    await renderApp(FILES, as('usr_003'));
    const links = await screen.findByRole('region', { name: 'Links' });
    expect(await within(links).findByRole('link', { name: /Pinterest: facades/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(within(links).queryByRole('button', { name: /^Edit / })).toBeNull();
  });

  it('says Edit for the edit of a link, as every other edit does (audit 2026-10-03, V-23)', async () => {
    await renderApp(FILES, as('usr_002'));
    const links = await screen.findByRole('region', { name: 'Links' });
    await userEvent.click(await within(links).findByRole('button', { name: /^Edit Pinterest: facades/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit link' })).toBeInTheDocument();
  });

  it('never makes a stored link that is not a web link pressable', async () => {
    await renderApp(FILES, (state) => {
      state.projects.prj_001.links = [{ id: 'lnk_bad', kind: 'other', label: 'Bad link', url: 'javascript:alert(1)' }];
    });
    const links = await screen.findByRole('region', { name: 'Links' });
    expect(await within(links).findByText('Bad link')).toBeInTheDocument();
    expect(within(links).queryByRole('link', { name: /Bad link/ })).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('the one Add button', () => {
  it('offers Upload a file and Add a link, and nothing else', async () => {
    await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const menu = await screen.findByRole('menu', { name: 'Add' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Upload a file', 'Add a link']);
    // The old buttons are gone: one control, not three.
    expect(screen.queryByRole('button', { name: 'Add link' })).toBeNull();
  });

  it('opens the file chooser from Upload a file, and the upload still works', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    const { store } = await renderApp(FILES, as('usr_005'));
    await choose('Upload a file');
    expect(click).toHaveBeenCalled();
    expect((click.mock.contexts[0] as HTMLInputElement).type).toBe('file');
    await userEvent.upload(await screen.findByLabelText('Upload files'), new File(['notes'], 'Site notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Files uploaded: 1.')).toBeInTheDocument();
    expect(Object.values(store.state.files).some((f) => f.name === 'Site notes.txt')).toBe(true);
  });

  it('opens the link sheet from Add a link, refuses a link that is not a web link, then adds a good one', async () => {
    await renderApp(FILES, as('usr_002'));
    await choose('Add a link');
    const sheet = await screen.findByRole('dialog', { name: 'Add a link' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Kind'), 'other');
    await userEvent.type(within(sheet).getByLabelText('Link'), 'javascript:alert(1)');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add link' }));
    expect(await within(sheet).findByText('Use a web link that starts with https://.')).toBeInTheDocument();
    await userEvent.clear(within(sheet).getByLabelText('Link'));
    await userEvent.type(within(sheet).getByLabelText('Link'), 'https://example.com/brief');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add link' }));
    const links = await screen.findByRole('region', { name: 'Links' });
    expect(await within(links).findByRole('link', { name: /example\.com/ })).toHaveAttribute('href', 'https://example.com/brief');
  });

  it('takes a new link back with Undo', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await choose('Add a link');
    const sheet = await screen.findByRole('dialog', { name: 'Add a link' });
    await userEvent.type(within(sheet).getByLabelText('Link'), 'https://example.com/brief');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add link' }));
    await waitFor(() => expect(store.state.projects.prj_001.links?.some((link) => link.url === 'https://example.com/brief')).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.links?.some((link) => link.url === 'https://example.com/brief') ?? false).toBe(false));
  });

  it('shows no Add button to a person who may not post', async () => {
    await renderApp(FILES, as('usr_003'));
    await screen.findByRole('region', { name: 'Links' });
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByLabelText('Upload files')).toBeNull();
  });
});

describe('an empty tab', () => {
  const empty = (state: State) => {
    as('usr_002')(state);
    for (const [id, file] of Object.entries(state.files)) if (file.projectId === 'prj_001') delete state.files[id];
    state.projects.prj_001.links = [];
    state.projects.prj_001.modelFolderPath = '';
  };

  it('shows one empty state that holds the one Add button', async () => {
    await renderApp(FILES, empty);
    const title = await screen.findByRole('heading', { name: 'No files or links yet' });
    const card = title.closest('section') as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Add' })).toBeInTheDocument();
    // The button shows once, never in the toolbar as well.
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Links' })).toBeNull();
  });

  it('shows the empty state with no button to a person who may not post', async () => {
    await renderApp(FILES, (state) => {
      empty(state);
      as('usr_003')(state);
    });
    expect(await screen.findByRole('heading', { name: 'No files or links yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('is not empty when the project has only a link', async () => {
    await renderApp(FILES, (state) => {
      empty(state);
      state.projects.prj_001.links = [{ id: 'lnk_one', kind: 'moodboard', label: 'Pinterest: facades', url: 'https://www.pinterest.com/madar/' }];
    });
    expect(await screen.findByRole('region', { name: 'Links' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No files or links yet' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1);
  });
});
