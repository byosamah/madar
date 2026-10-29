import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOLDER_NAME_MAX } from '../../../api/contract/entities';
import type { State } from '../../../api/store';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';
import { FOLDER_NAME_LIMIT } from './FolderNameField';
import { forgetFilesDragForTests, loadFilesDrag } from './filesDragLoader';

/**
 * Folders in the Files & Links tab (fbk_066, owner 2026-10-26). The sample office: Faisal (usr_002) leads prj_001 and uploads; Sara (usr_005) is on
 * the team and uploads; usr_003 is outside the team and cannot upload. The five files sit in the stage "Construction Documents" (stg_004). The
 * stages are Concept, Schematic Design, Design Development, Construction Documents, Permits, Tender and Supervision.
 */
const FILES = '/projects/prj_001?tab=files';
const AT = '2026-09-29T10:00:00.000+03:00';

const folder = (id: string, stageId: string, name: string) => ({ id, stageId, name, createdBy: 'usr_002', createdAt: AT });
/** A state with the user, and the folders of the test: Mood boarding (fld_001, Construction Documents) holds two files, First sketching (fld_002) none. */
const world = (userId = 'usr_002', withFolders = true) => (state: State) => {
  state.session.currentUserId = userId;
  if (!withFolders) return;
  state.projects.prj_001.folders = [folder('fld_001', 'stg_004', 'Mood boarding'), folder('fld_002', 'stg_004', 'First sketching'), folder('fld_003', 'stg_002', 'Sketch round one')];
  state.counters.fld = 3;
  state.files.fil_002.folderId = 'fld_001';
  state.files.fil_005.folderId = 'fld_001';
};

afterEach(() => vi.restoreAllMocks());

describe('"+ Folder"', () => {
  it('shows in the heading row of each real stage for a person who may upload, before "Download all", and never in "No stage"', async () => {
    await renderApp(FILES, world('usr_002', false));
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    const add = within(group).getByRole('button', { name: 'Add a folder to Construction Documents' });
    expect(add).toHaveTextContent('+ Folder');
    const download = within(group).getByRole('button', { name: /Download all files of Construction Documents/ });
    expect(add.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.parentElement).toBe(download.parentElement);
    // The stages with no file show too, so a folder can start in any stage. "No stage" has no file here, so it does not show.
    expect(screen.getByRole('region', { name: 'Concept' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'No stage' })).toBeNull();
  });

  it('shows no "+ Folder" and no empty stage to a person who may not upload', async () => {
    await renderApp(FILES, world('usr_003', false));
    await screen.findByRole('region', { name: 'Construction Documents' });
    expect(screen.queryByRole('button', { name: /Add a folder to/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Concept' })).toBeNull();
  });

  it('opens one name field, saves on Enter with a toast, and Undo takes the folder back', async () => {
    const { store } = await renderApp(FILES, world('usr_002', false));
    await userEvent.click(await screen.findByRole('button', { name: 'Add a folder to Construction Documents' }));
    const field = screen.getByRole('textbox', { name: 'Folder name' });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('placeholder', 'Folder name');
    await userEvent.type(field, ' Mood boarding {Enter}');
    await waitFor(() => expect(store.state.projects.prj_001.folders).toMatchObject([{ stageId: 'stg_004', name: 'Mood boarding' }]));
    expect(await screen.findByText('Folder added.')).toBeInTheDocument();
    const block = await screen.findByRole('group', { name: 'Mood boarding' });
    expect(within(block).getByText('No files yet. Drag files here.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Folder name' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.folders ?? []).toEqual([]));
  });

  it('saves on a blur with text, and cancels on Escape or on an empty field', async () => {
    const { store } = await renderApp(FILES, world('usr_002', false));
    const open = async () => userEvent.click(await screen.findByRole('button', { name: 'Add a folder to Construction Documents' }));
    await open();
    await userEvent.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Typed then Escape{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Folder name' })).toBeNull();
    await open();
    await userEvent.click(document.body);
    expect(screen.queryByRole('textbox', { name: 'Folder name' })).toBeNull();
    expect(store.state.projects.prj_001.folders ?? []).toEqual([]);
    await open();
    await userEvent.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Blur saves');
    await userEvent.click(document.body);
    await waitFor(() => expect(store.state.projects.prj_001.folders).toMatchObject([{ name: 'Blur saves' }]));
  });

  it('shows the reason when the stage already has the name', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Add a folder to Construction Documents' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Folder name' }), 'mood BOARDING{Enter}');
    expect(await screen.findByText('A folder here has this name already.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.folders).toHaveLength(3);
  });

  it('keeps the same name limit as the contract', () => {
    expect(FOLDER_NAME_LIMIT).toBe(FOLDER_NAME_MAX);
  });
});

describe('the folder groups', () => {
  it('shows the files with no folder first, then each folder in the order it was made, with the file count', async () => {
    await renderApp(FILES, world());
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    const names = [...group.querySelectorAll('bdi.truncate.text-body, h4')].map((node) => node.textContent);
    const at = (name: string) => names.indexOf(name);
    const before = names.slice(0, at('Mood boarding')).sort();
    expect(before).toEqual(['Cover render.svg', 'Ground floor plan.pdf', 'Site plan.pdf']);
    expect(names.slice(at('Mood boarding') + 1, at('First sketching')).sort()).toEqual(['Facade study.svg', 'Massing view.svg']);
    expect(names.at(-1)).toBe('First sketching');
    const mood = within(group).getByRole('group', { name: 'Mood boarding' });
    expect(within(mood).getByText('2 files')).toBeInTheDocument();
    expect(within(mood).getByText('Massing view.svg')).toBeInTheDocument();
    const sketching = within(group).getByRole('group', { name: 'First sketching' });
    expect(within(sketching).getByText('No files yet. Drag files here.')).toBeInTheDocument();
    // A folder of another stage sits in that stage.
    const schematic = screen.getByRole('region', { name: 'Schematic Design' });
    expect(within(schematic).getByRole('group', { name: 'Sketch round one' })).toBeInTheDocument();
  });

  it('counts the files of a folder in the Download all of its stage, and offers Download all in the menu of a folder of two files', async () => {
    await renderApp(FILES, world());
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByRole('button', { name: 'Download all files of Construction Documents (5)' })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'Actions for the folder Mood boarding' }));
    expect(screen.getByRole('menuitem', { name: 'Download all (2)' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull());
    await userEvent.click(within(group).getByRole('button', { name: 'Actions for the folder First sketching' }));
    expect(screen.queryByRole('menuitem', { name: /Download all/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });

  it('says only "No files yet." in an empty folder on a phone', async () => {
    phoneMedia(true);
    await renderApp(FILES, world());
    const sketching = await screen.findByRole('group', { name: 'First sketching' });
    expect(within(sketching).getByText('No files yet.')).toBeInTheDocument();
  });

  it('shows the folders, with no control, to a person who may not upload', async () => {
    await renderApp(FILES, world('usr_003'));
    const mood = await screen.findByRole('group', { name: 'Mood boarding' });
    expect(within(mood).getByText('2 files')).toBeInTheDocument();
    // The menu of the folder holds Download all alone: no Rename and no Delete.
    expect(screen.queryByRole('button', { name: 'Add a folder to Construction Documents' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for the folder Mood boarding' }));
    expect(screen.getByRole('menuitem', { name: 'Download all (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Massing view.svg' }));
    expect(screen.queryByRole('menuitem', { name: 'Move to' })).toBeNull();
  });

  it('shows a file whose folder is gone at the root of its stage, never hidden', async () => {
    await renderApp(FILES, (state) => {
      world()(state);
      state.files.fil_003.folderId = 'fld_099';
    });
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByText('Ground floor plan.pdf')).toBeInTheDocument();
  });
});

describe('rename and delete', () => {
  it('renames a folder from its menu, with the name in the field', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Mood boarding' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Folder name' });
    expect(field).toHaveValue('Mood boarding');
    await userEvent.clear(field);
    await userEvent.type(field, 'Mood board{Enter}');
    await waitFor(() => expect(store.state.projects.prj_001.folders?.[0].name).toBe('Mood board'));
    expect(await screen.findByText('Folder renamed.')).toBeInTheDocument();
  });

  it('cancels a rename on Escape', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Mood boarding' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Folder name' }), ' extra{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Folder name' })).toBeNull();
    expect(store.state.projects.prj_001.folders?.[0].name).toBe('Mood boarding');
  });

  it('deletes a folder with no question, sends its files to the root, and Undo brings both back', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for the folder Mood boarding' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('Folder deleted.')).toBeInTheDocument();
    await waitFor(() => expect(store.state.projects.prj_001.folders?.map((item) => item.id)).toEqual(['fld_002', 'fld_003']));
    expect(store.state.files.fil_002).toMatchObject({ stageId: 'stg_004', folderId: null });
    // The files are still on the screen, at the root of the stage.
    expect(screen.getByText('Massing view.svg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.folders?.map((item) => item.id)).toEqual(['fld_001', 'fld_002', 'fld_003']));
    expect(store.state.files.fil_002.folderId).toBe('fld_001');
    expect(store.state.files.fil_005.folderId).toBe('fld_001');
  });
});

describe('"Move to"', () => {
  it('lists the stages with their folders, marks the place of the file, and moves the file with one press and an Undo', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    const panel = await screen.findByRole('dialog', { name: 'Move Site plan.pdf' });
    const list = within(panel).getByRole('list');
    const here = within(list).getByRole('button', { name: /Construction Documents/ });
    expect(here).toHaveAttribute('aria-current', 'true');
    expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Concept', 'Schematic Design', 'Sketch round one', 'Design Development', 'Construction Documents', 'Mood boarding', 'First sketching', 'Permits', 'Tender', 'Supervision', 'No stage',
    ]);
    await userEvent.click(within(list).getByRole('button', { name: 'First sketching' }));
    await waitFor(() => expect(store.state.files.fil_004).toMatchObject({ stageId: 'stg_004', folderId: 'fld_002' }));
    expect(await screen.findByText('Moved to Construction Documents: First sketching.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.files.fil_004.folderId).toBeNull());
  });

  it('moves a file to another stage and to No stage', async () => {
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Permits' }));
    await waitFor(() => expect(store.state.files.fil_004).toMatchObject({ stageId: 'stg_005', folderId: null }));
    expect(await screen.findByText('Moved to Permits.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    await userEvent.click(await screen.findByRole('button', { name: 'No stage' }));
    await waitFor(() => expect(store.state.files.fil_004.stageId).toBeNull());
    expect(await screen.findByRole('region', { name: 'No stage' })).toBeInTheDocument();
  });

  it('works on a phone as a sheet, and a press on the current place only closes it', async () => {
    phoneMedia(true);
    const { store } = await renderApp(FILES, world());
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(await screen.findByText('Move to'));
    const sheet = await screen.findByRole('dialog', { name: 'Move Site plan.pdf' });
    await userEvent.click(within(sheet).getByRole('button', { name: /Construction Documents/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move Site plan.pdf' })).toBeNull());
    expect(store.state.files.fil_004.folderId ?? null).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(await screen.findByText('Move to'));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Move Site plan.pdf' })).getByRole('button', { name: 'Mood boarding' }));
    await waitFor(() => expect(store.state.files.fil_004.folderId).toBe('fld_001'));
  });
});

/** jsdom has no layout: each zone gets a box, the folder inside the stage group, and the stage groups under each other. */
function layout(boxes: Record<string, [number, number, number, number]>) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const at = boxes[this.getAttribute('aria-labelledby') ?? ''] ?? boxes[this.id];
    const [left, top, width, height] = at ?? [0, 0, 0, 0];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

const pointer = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 });
/** Lift a row with the pointer, move it to a point, and let it go. */
async function drag(row: HTMLElement, to: [number, number]) {
  fireEvent.pointerDown(row, pointer(10, 10));
  await act(async () => { fireEvent.pointerMove(document, pointer(30, 30)); });
  await act(async () => { fireEvent.pointerMove(document, pointer(...to)); });
  await act(async () => { fireEvent.pointerUp(document, pointer(...to)); });
}

describe('the pointer drag on a desk', () => {
  const BOXES: Record<string, [number, number, number, number]> = {
    'files-stg_004': [0, 0, 600, 900],
    'folder-fld_001': [10, 300, 580, 200],
    'folder-fld_002': [10, 520, 580, 100],
    'files-stg_002': [0, 1000, 600, 300],
    'folder-fld_003': [10, 1100, 580, 100],
    'files-stg_005': [0, 1400, 600, 100],
  };
  const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

  it('moves a file onto a folder, and the folder frames while the file is over it', async () => {
    const { store } = await renderApp(FILES, world());
    await screen.findByRole('region', { name: 'Construction Documents' });
    layout(BOXES);
    const row = rowOf('Site plan.pdf');
    fireEvent.pointerDown(row, pointer(10, 10));
    await act(async () => { fireEvent.pointerMove(document, pointer(30, 30)); });
    await act(async () => { fireEvent.pointerMove(document, pointer(100, 560)); });
    expect(screen.getByRole('group', { name: 'First sketching' })).toHaveClass('outline-dashed');
    // The stage group around it shows no frame: only the zone under the pointer does.
    expect(screen.getByRole('region', { name: 'Construction Documents' })).not.toHaveClass('outline-dashed');
    await act(async () => { fireEvent.pointerUp(document, pointer(100, 560)); });
    await waitFor(() => expect(store.state.files.fil_004).toMatchObject({ stageId: 'stg_004', folderId: 'fld_002' }));
    expect(await screen.findByText('Moved to Construction Documents: First sketching.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.files.fil_004.folderId).toBeNull());
  });

  it('moves a file to a folder of another stage, and to a stage group', async () => {
    const { store } = await renderApp(FILES, world());
    await screen.findByRole('region', { name: 'Construction Documents' });
    layout(BOXES);
    await drag(rowOf('Site plan.pdf'), [100, 1150]);
    await waitFor(() => expect(store.state.files.fil_004).toMatchObject({ stageId: 'stg_002', folderId: 'fld_003' }));
    layout(BOXES);
    await drag(rowOf('Site plan.pdf'), [100, 1450]);
    await waitFor(() => expect(store.state.files.fil_004).toMatchObject({ stageId: 'stg_005', folderId: null }));
  });

  it('takes a file out of a folder with a drop on the stage group, and out of "No stage"', async () => {
    const { store } = await renderApp(FILES, (state) => {
      world()(state);
      state.files.fil_003.stageId = null;
    });
    await screen.findByRole('region', { name: 'No stage' });
    layout({ ...BOXES, 'files-none': [0, 1600, 600, 100] });
    await drag(rowOf('Massing view.svg'), [100, 100]);
    await waitFor(() => expect(store.state.files.fil_002.folderId).toBeNull());
    layout({ ...BOXES, 'files-none': [0, 1600, 600, 100] });
    await drag(rowOf('Ground floor plan.pdf'), [100, 100]);
    await waitFor(() => expect(store.state.files.fil_003).toMatchObject({ stageId: 'stg_004', folderId: null }));
  });

  it('changes nothing for a drop where the file already sits, or off every zone', async () => {
    const { store } = await renderApp(FILES, world());
    await screen.findByRole('region', { name: 'Construction Documents' });
    layout(BOXES);
    const events = Object.keys(store.state.events).length;
    await drag(rowOf('Massing view.svg'), [100, 400]);
    await drag(rowOf('Site plan.pdf'), [100, 100]);
    await drag(rowOf('Site plan.pdf'), [900, 900]);
    expect(Object.keys(store.state.events)).toHaveLength(events);
  });

  it('gives no drag to a person who may not upload', async () => {
    const { store } = await renderApp(FILES, world('usr_003'));
    await screen.findByRole('region', { name: 'Construction Documents' });
    layout(BOXES);
    await drag(rowOf('Site plan.pdf'), [100, 560]);
    expect(store.state.files.fil_004.folderId ?? null).toBeNull();
  });

  it('gives no drag on a phone, where "Move to" is the way', async () => {
    phoneMedia(true);
    const { store } = await renderApp(FILES, world());
    await screen.findByRole('region', { name: 'Construction Documents' });
    layout(BOXES);
    await drag(rowOf('Site plan.pdf'), [100, 560]);
    expect(store.state.files.fil_004.folderId ?? null).toBeNull();
  });

  it('draws the list first with static rows, and the drag works once the layer has loaded', async () => {
    forgetFilesDragForTests();
    const { store } = await renderApp(FILES, world());
    await screen.findByRole('region', { name: 'Construction Documents' });
    await loadFilesDrag();
    await waitFor(() => expect(screen.getByRole('group', { name: 'First sketching' })).toBeInTheDocument());
    layout(BOXES);
    await waitFor(async () => {
      await drag(rowOf('Site plan.pdf'), [100, 560]);
      expect(store.state.files.fil_004.folderId).toBe('fld_002');
    });
  });
});

describe('a file from the computer', () => {
  it('uploads into the folder it is dropped on, and frames the folder while it is over', async () => {
    const { store } = await renderApp(FILES, world());
    const mood = await screen.findByRole('group', { name: 'Mood boarding' });
    const file = new File(['board'], 'Board.png', { type: 'image/png' });
    fireEvent.dragOver(mood, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(mood).toHaveClass('outline-dashed');
    // The stage group and the tab show no frame at the same time.
    expect(screen.getByRole('region', { name: 'Construction Documents' })).not.toHaveClass('outline-dashed');
    fireEvent.drop(mood, { dataTransfer: { types: ['Files'], files: [file] } });
    await waitFor(() => expect(Object.values(store.state.files).find((item) => item.name === 'Board.png')).toMatchObject({ stageId: 'stg_004', folderId: 'fld_001' }));
    expect(mood).not.toHaveClass('outline-dashed');
  });

  it('uploads into the stage of the group it is dropped on, at the root', async () => {
    const { store } = await renderApp(FILES, world());
    const permits = await screen.findByRole('region', { name: 'Permits' });
    fireEvent.drop(permits, { dataTransfer: { types: ['Files'], files: [new File(['p'], 'Permit.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(Object.values(store.state.files).find((item) => item.name === 'Permit.pdf')).toMatchObject({ stageId: 'stg_005' }));
    expect(Object.values(store.state.files).find((item) => item.name === 'Permit.pdf')?.folderId ?? null).toBeNull();
  });

  it('starts the drop zone for a file only: the picture of a row that the browser drags by itself does not', async () => {
    await renderApp(FILES, world());
    const tab = (await screen.findByRole('tabpanel')).firstElementChild as HTMLElement;
    fireEvent.dragOver(tab, { dataTransfer: { types: ['text/uri-list', 'text/html'] } });
    expect(tab).not.toHaveClass('outline-dashed');
    fireEvent.dragOver(tab, { dataTransfer: { types: ['Files'] } });
    expect(tab).toHaveClass('outline-dashed');
    expect(document.querySelector('img[draggable="true"]')).toBeNull();
  });
});
