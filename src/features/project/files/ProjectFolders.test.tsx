import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { State } from '../../../api/store';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';

/**
 * Folders for the whole project, the two standard folders and locked folders in the Files & Links tab (fbk_074, owner 2026-10-29). The sample
 * office: Faisal (usr_002) leads prj_001 and uploads; the Admin (usr_001) holds the switch "Locked folders". Client documents (fld_011) holds
 * Massing view.svg, Contract (fld_012, locked) holds Facade study.svg, Site photos (fld_013) is empty. The other three files sit in the stage
 * "Construction Documents" (stg_004).
 */
const FILES = '/projects/prj_001?tab=files';
const AT = '2026-09-29T10:00:00.000+03:00';

const folder = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, stageId: null, name, createdBy: 'usr_002', createdAt: AT, ...extra });
const world = (userId = 'usr_002', language: 'en' | 'ar' = 'en') => (state: State) => {
  state.session.currentUserId = userId;
  state.users[userId].preferences.language = language;
  state.projects.prj_001.folders = [
    folder('fld_011', 'Client documents', { preset: 'client_documents' }),
    folder('fld_012', 'Contract', { preset: 'contract', locked: true }),
    folder('fld_013', 'Site photos'),
  ];
  state.counters.fld = 13;
  state.files.fil_002.stageId = null;
  state.files.fil_002.folderId = 'fld_011';
  state.files.fil_005.stageId = null;
  state.files.fil_005.folderId = 'fld_012';
};

afterEach(() => vi.restoreAllMocks());

describe('the folders of the whole project', () => {
  it('show first, above the stage groups, with the count of files, and a person without the switch finds no locked folder', async () => {
    await renderApp(FILES, world());
    const section = await screen.findByRole('region', { name: 'Project folders' });
    const stage = screen.getByRole('region', { name: 'Construction Documents' });
    expect(section.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const documents = within(section).getByRole('group', { name: 'Client documents' });
    expect(within(documents).getByText('1 file')).toBeInTheDocument();
    expect(within(section).getByRole('group', { name: 'Site photos' })).toBeInTheDocument();
    // Faisal does not hold the switch: the locked folder and its file are not in the answer.
    expect(within(section).queryByText('Contract')).toBeNull();
    expect(screen.queryByText('Facade study.svg')).toBeNull();
    // A file in a folder of the project is no file of "No stage".
    expect(screen.queryByRole('region', { name: 'No stage' })).toBeNull();
    expect(within(section).getByRole('button', { name: 'Add a folder to the whole project' })).toHaveTextContent('+ Folder');
  });

  it('show the locked folder with its lock mark to a holder, and the lock control in the menu', async () => {
    await renderApp(FILES, world('usr_001'));
    const section = await screen.findByRole('region', { name: 'Project folders' });
    const contract = within(section).getByRole('group', { name: 'Contract' });
    expect(within(contract).getByRole('img', { name: 'Locked folder' })).toBeInTheDocument();
    expect(within(section).getByRole('group', { name: 'Client documents' }).querySelector('[role="img"]')).toBeNull();
    await userEvent.click(within(contract).getByRole('button', { name: 'Actions for the folder Contract' }));
    expect(screen.getByRole('menuitem', { name: 'Unlock' })).toBeInTheDocument();
  });

  it('show no lock control to a person without the switch', async () => {
    await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Client documents' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Lock' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Unlock' })).toBeNull();
  });

  it('are made with "+ Folder", with no stage', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Add a folder to the whole project' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Reports{Enter}');
    await waitFor(() => expect(store.state.projects.prj_001.folders?.at(-1)).toMatchObject({ stageId: null, name: 'Reports' }));
    expect(await screen.findByRole('group', { name: 'Reports' })).toBeInTheDocument();
  });

  it('lock and unlock from the menu of a holder, with a toast and an Undo', async () => {
    const { store } = await renderApp(FILES, world('usr_001'));
    const section = await screen.findByRole('region', { name: 'Project folders' });
    await userEvent.click(within(section).getByRole('button', { name: 'Actions for the folder Client documents' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Lock' }));
    expect(await screen.findByText('Folder locked.')).toBeInTheDocument();
    await waitFor(() => expect(store.state.projects.prj_001.folders?.find((item) => item.id === 'fld_011')?.locked).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.folders?.find((item) => item.id === 'fld_011')?.locked).toBeUndefined());
    await userEvent.click(within(await screen.findByRole('group', { name: 'Contract' })).getByRole('button', { name: 'Actions for the folder Contract' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unlock' }));
    expect(await screen.findByText('Folder unlocked.')).toBeInTheDocument();
  });

  it('keep a rename out of the standard name: the folder keeps the new name', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Client documents' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Folder name' });
    expect(field).toHaveValue('Client documents');
    await userEvent.clear(field);
    await userEvent.type(field, 'From the client{Enter}');
    await waitFor(() => expect(store.state.projects.prj_001.folders?.find((item) => item.id === 'fld_011')).toMatchObject({ name: 'From the client' }));
    expect(store.state.projects.prj_001.folders?.find((item) => item.id === 'fld_011')?.preset).toBeUndefined();
  });
});

describe('a folder of the project that is open in place', () => {
  it('shows only its files and one step back, and the full list returns', async () => {
    await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Open the folder Client documents' }));
    const open = await screen.findByRole('region', { name: 'Client documents' });
    expect(within(open).getByText('Massing view.svg')).toBeInTheDocument();
    // Nothing else of the tab shows: no stage group, no other folder, no stage select.
    expect(screen.queryByRole('region', { name: 'Construction Documents' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Project folders' })).toBeNull();
    expect(screen.queryByLabelText('Upload to stage')).toBeNull();
    expect(window.location.hash).toContain('folder=fld_011');
    await userEvent.click(within(open).getByRole('button', { name: 'Back to all files' }));
    expect(await screen.findByRole('region', { name: 'Project folders' })).toBeInTheDocument();
    expect(window.location.hash).not.toContain('folder=');
  });

  it('takes a file that is added with Add', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Open the folder Site photos' }));
    const open = await screen.findByRole('region', { name: 'Site photos' });
    expect(within(open).getByText('No files yet. Drag files here.')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Upload files'), new File(['x'], 'View north.png', { type: 'image/png' }));
    await waitFor(() => expect(Object.values(store.state.files).find((file) => file.name === 'View north.png')).toMatchObject({ stageId: null, folderId: 'fld_013' }));
    expect(await screen.findByText('View north.png')).toBeInTheDocument();
  });

  it('goes back by itself when the folder is deleted, and works on a phone', async () => {
    phoneMedia(true);
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Open the folder Site photos' }));
    const open = await screen.findByRole('region', { name: 'Site photos' });
    await userEvent.click(within(open).getByRole('button', { name: 'Actions for the folder Site photos' }));
    await userEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(store.state.projects.prj_001.folders?.map((item) => item.id)).toEqual(['fld_011', 'fld_012']));
    expect(await screen.findByRole('region', { name: 'Project folders' })).toBeInTheDocument();
  });

  it('shows a locked folder to a holder, and lets the holder open it', async () => {
    await renderApp(FILES, world('usr_001'));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the folder Contract' }));
    const open = await screen.findByRole('region', { name: 'Contract' });
    expect(within(open).getByText('Facade study.svg')).toBeInTheDocument();
    expect(within(open).getByRole('img', { name: 'Locked folder' })).toBeInTheDocument();
  });

  it('hides the share, delivery and cover items of a file in a locked folder', async () => {
    await renderApp(`${FILES}&folder=fld_012`, world('usr_001'));
    await screen.findByRole('region', { name: 'Contract' });
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Facade study.svg' }));
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Share/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delivered/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /cover/i })).toBeNull();
  });

  it('reads a folder id that is not a folder of the project as the full list', async () => {
    await renderApp(`${FILES}&folder=fld_999`, world());
    expect(await screen.findByRole('region', { name: 'Project folders' })).toBeInTheDocument();
  });
});

describe('"Move to" with the folders of the whole project', () => {
  it('lists them first, with the standard names, and moves a file in with no stage', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(await screen.findByText('Move to'));
    const panel = await screen.findByRole('dialog', { name: 'Move Site plan.pdf' }).catch(() => screen.findByText('Move Site plan.pdf'));
    void panel;
    expect(screen.getByText('Project folders', { selector: 'li' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Client documents' }));
    await waitFor(() => expect(store.state.files.fil_004).toMatchObject({ stageId: null, folderId: 'fld_011' }));
    expect(await screen.findByText('Moved to Client documents.')).toBeInTheDocument();
  });
});

describe('the Arabic screen', () => {
  it('shows the standard folders in Arabic while they keep the preset', async () => {
    await renderApp(FILES, world('usr_001', 'ar'));
    const section = await screen.findByRole('region', { name: 'مجلدات المشروع' });
    expect(within(section).getByRole('group', { name: 'مستندات العميل' })).toBeInTheDocument();
    expect(within(section).getByRole('group', { name: 'العقد' })).toBeInTheDocument();
    expect(within(section).getByRole('group', { name: 'Site photos' })).toBeInTheDocument();
    expect(within(section).queryByText('Client documents')).toBeNull();
  });
});
