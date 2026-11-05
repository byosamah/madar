import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { State } from '../../api/store';
import { isNavActive, phoneTabOf } from '../../app/nav';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

/**
 * The Resources page (fbk_078, owner 2026-11-05). The sample office: the Admin (usr_001) holds the switches "Manage office resources" and "Locked folders";
 * Faisal (usr_002) holds neither. "Office codes" (fld_901) is open and holds Building code.pdf. "Private papers" (fld_902) is locked and holds Salary
 * policy.pdf. Handbook.pdf sits at the root.
 */
const AT = '2026-09-29T10:00:00.000+03:00';
const folder = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, createdBy: 'usr_001', createdAt: AT, ...extra });
const file = (id: string, name: string, folderId?: string) => ({
  id, projectId: null, stageId: null, taskId: null, resource: true as const, ...(folderId ? { folderId } : {}), name,
  versions: [{ letter: 'A', blobKey: `blob_${id}`, mimeType: 'application/pdf', size: 2048, uploadedBy: 'usr_001', uploadedAt: AT }],
});
const world = (userId = 'usr_001', content = true) => (state: State) => {
  state.session.currentUserId = userId;
  if (!content) return;
  state.settings.resourceFolders = [folder('fld_901', 'Office codes'), folder('fld_902', 'Private papers', { locked: true })];
  state.counters.fld = 902;
  state.files.fil_901 = file('fil_901', 'Handbook.pdf');
  state.files.fil_902 = file('fil_902', 'Building code.pdf', 'fld_901');
  state.files.fil_903 = file('fil_903', 'Salary policy.pdf', 'fld_902');
  state.counters.fil = 903;
};

afterEach(() => vi.restoreAllMocks());

describe('the Resources page for a person with the manage switch', () => {
  it('shows one title, one main button (Upload a file), "+ Folder", the folders with the lock mark, and the files', async () => {
    await renderApp('/resources', world());
    expect(await screen.findByRole('heading', { level: 1, name: 'Resources' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Upload a file' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '+ Folder' })).toBeInTheDocument();
    const folders = await screen.findByRole('list', { name: 'Folders' });
    expect(within(folders).getByRole('button', { name: 'Open the folder Office codes' })).toBeInTheDocument();
    const privatePapers = within(folders).getByRole('button', { name: 'Open the folder Private papers' });
    expect(within(privatePapers).getByRole('img', { name: 'Locked folder' })).toBeInTheDocument();
    expect(screen.getByText('Handbook.pdf')).toBeInTheDocument();
    // A file in a folder shows after the press on its folder.
    expect(screen.queryByText('Building code.pdf')).toBeNull();
  });

  it('opens a folder in place, with one step back', async () => {
    await renderApp('/resources', world());
    await userEvent.click(await screen.findByRole('button', { name: 'Open the folder Private papers' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Private papers' })).toBeInTheDocument();
    expect(screen.getByText('Salary policy.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Handbook.pdf')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to all files' }));
    expect(await screen.findByText('Handbook.pdf')).toBeInTheDocument();
  });

  it('uploads a file, shows it, and gives an Undo', async () => {
    const { store } = await renderApp('/resources', world());
    const input = await screen.findByLabelText('Upload files');
    await userEvent.upload(input, new File(['%PDF-1.4'], 'Fire code.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('Fire code.pdf')).toBeInTheDocument();
    const added = Object.values(store.state.files).find((item) => item.name === 'Fire code.pdf')!;
    expect(added).toMatchObject({ resource: true, projectId: null });
  });

  it('makes a folder with "+ Folder"', async () => {
    const { store } = await renderApp('/resources', world());
    await userEvent.click(await screen.findByRole('button', { name: '+ Folder' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Policies{Enter}');
    await waitFor(() => expect(store.state.settings.resourceFolders?.at(-1)).toMatchObject({ name: 'Policies' }));
    expect(await screen.findByRole('button', { name: 'Open the folder Policies' })).toBeInTheDocument();
  });

  it('renames, locks and deletes a folder from its menu, and a locked folder has no Delete', async () => {
    const { store } = await renderApp('/resources', world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Office codes' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Lock' }));
    await waitFor(() => expect(store.state.settings.resourceFolders?.find((item) => item.id === 'fld_901')?.locked).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Office codes' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Unlock' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unlock' }));
    await waitFor(() => expect(store.state.settings.resourceFolders?.find((item) => item.id === 'fld_901')?.locked).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Office codes' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(store.state.settings.resourceFolders?.some((item) => item.id === 'fld_901')).toBe(false));
    // The file of the folder is back at the root: no file is deleted with its folder.
    expect(await screen.findByText('Building code.pdf')).toBeInTheDocument();
  });

  it('renames and moves a file, and deletes it with an Undo', async () => {
    const { store } = await renderApp('/resources', world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Handbook.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = await screen.findByRole('textbox', { name: 'File name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Staff handbook.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(store.state.files.fil_901.name).toBe('Staff handbook.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Staff handbook.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Office codes' }));
    await waitFor(() => expect(store.state.files.fil_901.folderId).toBe('fld_901'));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the folder Office codes' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Staff handbook.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(store.state.files.fil_901).toBeUndefined());
    await screen.findAllByRole('button', { name: 'Undo' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Undo' }).at(-1)!);
    await waitFor(() => expect(store.state.files.fil_901?.name).toBe('Staff handbook.pdf'));
  });
});

describe('the Resources page for a person without the manage switch', () => {
  it('shows the open folders and files, and no control to change them', async () => {
    await renderApp('/resources', world('usr_002'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Resources' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload a file' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Folder' })).toBeNull();
    expect(screen.queryByLabelText('Upload files')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Open the folder Office codes' })).toBeInTheDocument();
    expect(screen.getByText('Handbook.pdf')).toBeInTheDocument();
    // The locked folder and its file are not in the answer.
    expect(screen.queryByText('Private papers')).toBeNull();
    expect(screen.queryByText('Salary policy.pdf')).toBeNull();
    // A folder has no menu, and a file menu holds Download and Preview only.
    expect(screen.queryByRole('button', { name: 'Actions for the folder Office codes' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Handbook.pdf' }));
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
    for (const name of ['Rename', 'Move to', 'Delete']) expect(screen.queryByRole('menuitem', { name })).toBeNull();
  });

  it('says in one line what goes here when nothing is there', async () => {
    await renderApp('/resources', world('usr_002', false));
    expect(await screen.findByText('Building codes and office policies will be here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload a file' })).toBeNull();
  });

  it('finds an open folder that holds a file even when only the locked folder holds the rest', async () => {
    await renderApp('/resources', world('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the folder Office codes' }));
    expect(await screen.findByText('Building code.pdf')).toBeInTheDocument();
  });
});

describe('the empty page for a person with the manage switch', () => {
  it('says what goes here and keeps the upload control', async () => {
    await renderApp('/resources', world('usr_001', false));
    expect(await screen.findByText('Add building codes and office policies here. Everyone in the office can read them.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Upload a file' })).toHaveLength(1);
  });
});

describe('Resources inside Projects', () => {
  it('has a quiet link at the end of the controls of Projects on a desk, and still one main button', async () => {
    await renderApp('/projects', world());
    const link = await screen.findByRole('link', { name: 'Resources' });
    expect(link.getAttribute('href')).toMatch(/\/resources$/);
    expect(screen.getAllByRole('button', { name: 'New Project' })).toHaveLength(1);
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Resources' })).toBeInTheDocument();
  });

  it('marks the Projects tab on the Resources page, and the Work tab on a phone', () => {
    expect(isNavActive('/projects', '/resources')).toBe(true);
    expect(isNavActive('/work', '/resources')).toBe(false);
    expect(isNavActive('/', '/resources')).toBe(false);
    expect(phoneTabOf('/resources')).toBe('work');
  });

  it('gives a phone a fourth part in the Work switch, and the page keeps the Work header', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', world());
    const group = await screen.findByRole('radiogroup', { name: 'Show' });
    expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['To-dos', 'Meetings', 'Projects', 'Resources']);
    await userEvent.click(within(group).getByRole('radio', { name: 'Resources' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Resources' })).toBeChecked();
    expect(await screen.findByText('Handbook.pdf')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Upload a file' })).toHaveLength(1);
  });

  it('has no Resources part in the Work switch on a desk', async () => {
    await renderApp('/work', world());
    expect(await screen.findByRole('radiogroup', { name: 'Show' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Resources' })).toBeNull();
  });
});

describe('the Resources page in Arabic', () => {
  it('draws the title and the controls in Arabic', async () => {
    await renderApp('/resources', (state) => {
      world()(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'ملفات المكتب' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
