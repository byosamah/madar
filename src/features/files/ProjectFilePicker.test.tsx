import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { stubPhone } from '../inbox/phoneHarness';

/**
 * Insert a project file into a chat (fbk_070, tsk_482, owner 2026-10-27). The clip of a chat opens a short menu: "Upload a file" and
 * "Insert from a project". The picker lists the projects, then the stages ("No stage" too), then the folders and the files outside a
 * folder. The person ticks files or folders and sends them with one button. A chat takes 10 files in a message, so more than 10 go in
 * messages of 10, in order. An inserted file is the project file itself: no new upload and no new storage.
 *
 * The sample office keeps every project file in the last stage with no folder. A test adds what it needs: a folder "Drawings" in stage
 * stg_004 of prj_001 with two files, a folder "Big" with 12 files, and one file with no stage.
 */
const STAMP = '2026-09-30T09:00:00.000+03:00';
const version = { letter: 'A', blobKey: 'blob_x', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP };

function plant(state: State) {
  const project = state.projects.prj_001;
  project.folders = [
    { id: 'fld_001', stageId: 'stg_004', name: 'Drawings', createdBy: 'usr_002', createdAt: STAMP },
    { id: 'fld_002', stageId: 'stg_004', name: 'Big', createdBy: 'usr_002', createdAt: STAMP },
    { id: 'fld_003', stageId: 'stg_004', name: 'Empty folder', createdBy: 'usr_002', createdAt: STAMP },
  ];
  const mine = Object.values(state.files).filter((file) => file.projectId === 'prj_001');
  for (const file of mine) {
    if (file.name === 'Site plan.pdf' || file.name === 'Ground floor plan.pdf') file.folderId = 'fld_001';
    if (file.name === 'Facade study.svg') file.stageId = null;
  }
  for (let n = 1; n <= 12; n += 1) {
    const id = `fil_9${String(n).padStart(2, '0')}`;
    state.files[id] = { id, projectId: 'prj_001', stageId: 'stg_004', taskId: null, folderId: 'fld_002', name: `Sheet ${String(n).padStart(2, '0')}.pdf`, versions: [version] };
  }
}

const rowLink = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name });
/** The direct chat of Hala (the Admin, who is signed in) and Faisal. It holds three old messages of the sample office. */
const DIRECT = '/inbox/cnv_013';
const OLD = 3;
const field = () => screen.findByRole('textbox', { name: 'Message' });
const messagesOf = (state: State, conversationId: string) => Object.values(state.messages).filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
/** The messages that a test added to the direct chat: the old ones of the sample office are left out. */
const newOf = (state: State) => messagesOf(state, 'cnv_013').slice(OLD);
const sheet = () => screen.findByRole('dialog');

async function openInsert() {
  await userEvent.click(await screen.findByRole('button', { name: 'Attach' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Insert from a project' }));
}
async function openProject(name: RegExp) {
  await userEvent.click(await within(await sheet()).findByRole('button', { name }));
}
async function openStage(name: RegExp) {
  await userEvent.click(await within(await sheet()).findByRole('button', { name }));
}

/** Omar is signed in, in a direct chat with Reem. He neither leads nor works on prj_009, which Faisal leads. */
function omar(state: State) {
  plant(state);
  state.session.currentUserId = 'usr_004';
  state.conversations.cnv_900 = { id: 'cnv_900', kind: 'direct', projectId: null, memberIds: ['usr_004', 'usr_003'], createdAt: STAMP };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the clip of a chat (fbk_070)', () => {
  it('opens a short menu with two choices in a direct chat and in a project chat', async () => {
    await renderApp('/inbox');
    for (const chat of [/Faisal Al-Harbi/, /Corniche Office Tower/]) {
      await userEvent.click(await rowLink(chat));
      await userEvent.click(await screen.findByRole('button', { name: 'Attach' }));
      const menu = await screen.findByRole('menu', { name: 'Attach' });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Upload a file', 'Insert from a project']);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
  });

  it('opens the same menu in a group', async () => {
    await renderApp('/inbox/cnv_015');
    await userEvent.click(await screen.findByRole('button', { name: 'Attach' }));
    expect(within(await screen.findByRole('menu', { name: 'Attach' })).getAllByRole('menuitem')).toHaveLength(2);
  });

  it('keeps Upload a file as it was: the file goes to the chips and nothing sends', async () => {
    const { store } = await renderApp(DIRECT);
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Level 2.pdf', { type: 'application/pdf' }));
    expect(within(await screen.findByRole('list', { name: 'Files to send' })).getByText('Level 2.pdf')).toBeInTheDocument();
    expect(newOf(store.state)).toHaveLength(0);
  });
});

describe('the picker: projects, stages, folders and files', () => {
  it('walks projects, then stages, then files, with a Back step at each level, and keeps the ticks when the person steps back', async () => {
    await renderApp(DIRECT, plant);
    await openInsert();
    const box = within(await sheet());
    expect(await box.findByRole('heading', { name: 'Insert from a project' })).toBeInTheDocument();
    expect(box.queryByRole('button', { name: 'Back' })).toBeNull();
    await openProject(/Corniche Office Tower/);
    // Stages that hold something, and "No stage" with its one file. A stage with nothing is left out.
    expect(await box.findByRole('heading', { name: 'Corniche Office Tower' })).toBeInTheDocument();
    expect(box.getByRole('button', { name: /Construction Documents/ })).toBeInTheDocument();
    expect(box.getByRole('button', { name: /No stage/ })).toBeInTheDocument();
    expect(box.queryByRole('button', { name: /Concept/ })).toBeNull();
    await openStage(/No stage/);
    await userEvent.click(await box.findByRole('checkbox', { name: 'Facade study.svg' }));
    expect(box.getByRole('button', { name: 'Send 1 file' })).toBeEnabled();
    await userEvent.click(box.getByRole('button', { name: 'Back' }));
    expect(await box.findByRole('button', { name: /Construction Documents/ })).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Send 1 file' })).toBeEnabled();
    await userEvent.click(box.getByRole('button', { name: 'Back' }));
    expect(await box.findByRole('heading', { name: 'Insert from a project' })).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Send 1 file' })).toBeEnabled();
  });

  it('shows the folders and the files outside a folder of a stage, and no empty folder', async () => {
    await renderApp(DIRECT, plant);
    await openInsert();
    await openProject(/Corniche Office Tower/);
    await openStage(/Construction Documents/);
    const box = within(await sheet());
    expect(await box.findByRole('checkbox', { name: /Drawings/ })).toBeInTheDocument();
    expect(box.getByRole('checkbox', { name: /Big/ })).toBeInTheDocument();
    expect(box.queryByRole('checkbox', { name: /Empty folder/ })).toBeNull();
    // The files outside a folder, and none of the files inside a folder.
    expect(box.getByRole('checkbox', { name: 'Cover render.svg' })).toBeInTheDocument();
    expect(box.queryByRole('checkbox', { name: 'Site plan.pdf' })).toBeNull();
    expect(box.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('inserts one file as the project file itself: one message, no new file, no new upload', async () => {
    const { store, api } = await renderApp(DIRECT, plant);
    const filesBefore = Object.keys(store.state.files).length;
    const calls: string[] = [];
    const original = api.call.bind(api);
    api.call = ((name: string, input: unknown, meta?: unknown) => {
      calls.push(name);
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await openInsert();
    await openProject(/Corniche Office Tower/);
    await openStage(/Construction Documents/);
    const box = within(await sheet());
    await userEvent.click(await box.findByRole('checkbox', { name: 'Cover render.svg' }));
    await userEvent.click(box.getByRole('button', { name: 'Send 1 file' }));
    await waitFor(() => expect(newOf(store.state)).toHaveLength(1));
    const [message] = newOf(store.state);
    const file = Object.values(store.state.files).find((f) => f.name === 'Cover render.svg' && f.projectId === 'prj_001')!;
    expect(message).toMatchObject({ body: 'Cover render.svg', fileIds: [file.id] });
    expect(Object.keys(store.state.files)).toHaveLength(filesBefore);
    expect(calls).not.toContain('files.upload');
    expect(calls).not.toContain('files.uploadStart');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: /Cover render\.svg/ })).toBeInTheDocument();
  });

  it('sends all the files of a folder when the folder is ticked, and shows its count', async () => {
    const { store } = await renderApp(DIRECT, plant);
    await openInsert();
    await openProject(/Corniche Office Tower/);
    await openStage(/Construction Documents/);
    const box = within(await sheet());
    expect(await box.findByText('2 files')).toBeInTheDocument();
    await userEvent.click(box.getByRole('checkbox', { name: /Drawings/ }));
    await userEvent.click(box.getByRole('checkbox', { name: 'Cover render.svg' }));
    await userEvent.click(box.getByRole('button', { name: 'Send 3 files' }));
    await waitFor(() => expect(newOf(store.state)).toHaveLength(1));
    const names = newOf(store.state)[0].fileIds!.map((id) => store.state.files[id].name).sort();
    expect(names).toEqual(['Cover render.svg', 'Ground floor plan.pdf', 'Site plan.pdf']);
  });

  it('sends 12 files as two messages, 10 in the first and 2 in the second, in order', async () => {
    const { store } = await renderApp(DIRECT, plant);
    await openInsert();
    await openProject(/Corniche Office Tower/);
    await openStage(/Construction Documents/);
    const box = within(await sheet());
    await userEvent.click(await box.findByRole('checkbox', { name: /Big/ }));
    await userEvent.click(box.getByRole('button', { name: 'Send 12 files' }));
    await waitFor(() => expect(newOf(store.state)).toHaveLength(2));
    const [first, second] = newOf(store.state);
    expect(first.fileIds).toHaveLength(10);
    expect(second.fileIds).toHaveLength(2);
    const names = (message: typeof first) => message.fileIds!.map((id) => store.state.files[id].name);
    expect([...names(first), ...names(second)]).toEqual(Array.from({ length: 12 }, (_, i) => `Sheet ${String(i + 1).padStart(2, '0')}.pdf`));
    expect(first.createdAt.localeCompare(second.createdAt)).toBeLessThanOrEqual(0);
  });

  it('finds a project by a part of its name', async () => {
    await renderApp(DIRECT, plant);
    await openInsert();
    const box = within(await sheet());
    await userEvent.type(await box.findByRole('searchbox', { name: 'Search projects' }), 'mosque');
    expect(await box.findByRole('button', { name: /Rakah Neighbourhood Mosque/ })).toBeInTheDocument();
    expect(box.queryByRole('button', { name: /Corniche Office Tower/ })).toBeNull();
  });

  it('keeps the words that the person typed in the box when the picker closes', async () => {
    await renderApp(DIRECT, plant);
    await userEvent.type(await field(), 'A draft.');
    await openInsert();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await field()).toHaveValue('A draft.');
  });
});

describe('the rules of who may open the file (the same as Share)', () => {
  it('shows the refusal of the server when the other person of the chat is not on the project, and sends nothing', async () => {
    // Faisal is on no part of prj_006 (Hala leads it).
    const { store } = await renderApp(DIRECT, plant);
    await openInsert();
    await openProject(/Al Waha Clinic Fit-out/);
    const box = within(await sheet());
    await userEvent.click((await box.findAllByRole('button', { name: /\d+ files?$/ }))[0]);
    await userEvent.click(await box.findByRole('checkbox', { name: 'Cover render.svg' }));
    await userEvent.click(box.getByRole('button', { name: 'Send 1 file' }));
    expect(await screen.findByText('This person is not on the project of this file. They cannot open it.')).toBeInTheDocument();
    expect(newOf(store.state)).toHaveLength(0);
  });

  it('lists no hidden project to a person who does not see it, and lists it to a person who does', async () => {
    await renderApp('/inbox/cnv_900', (state) => {
      omar(state);
      state.projects.prj_009.access = { hidden: true, viewerIds: [] };
    });
    await openInsert();
    const box = within(await sheet());
    expect(await box.findByRole('button', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(box.queryByRole('button', { name: /Gulf Crest HQ Interiors/ })).toBeNull();
    cleanup();
    // Faisal leads prj_009, so the same list shows it to him.
    await renderApp('/inbox/cnv_900', (state) => {
      omar(state);
      state.projects.prj_009.access = { hidden: true, viewerIds: [] };
      state.session.currentUserId = 'usr_002';
      state.conversations.cnv_900.memberIds = ['usr_002', 'usr_003'];
    });
    await openInsert();
    expect(await within(await sheet()).findByRole('button', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
  });

  it('shows no Insert choice for a person without the switch "Share files": the clip works as before', async () => {
    await renderApp('/inbox/cnv_900', (state) => {
      omar(state);
      state.settings.roles = { custom: [{ id: 'rol_001', name: 'Desk', nameAr: 'مكتب', rights: [], off: ['file.share'] }] };
      state.users.usr_004.roleId = 'rol_001';
    });
    await field();
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
    expect(screen.getByLabelText('Attach files')).toBeInTheDocument();
  });
});

describe('a project chat keeps to its own project', () => {
  it('starts at the stages of the project of a project chat, with no list of projects', async () => {
    const { store } = await renderApp('/inbox', plant);
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await openInsert();
    const box = within(await sheet());
    expect(await box.findByRole('heading', { name: 'Corniche Office Tower' })).toBeInTheDocument();
    expect(box.queryByRole('searchbox')).toBeNull();
    expect(box.queryByRole('button', { name: 'Back' })).toBeNull();
    await openStage(/Construction Documents/);
    await userEvent.click(await box.findByRole('checkbox', { name: 'Cover render.svg' }));
    await userEvent.click(box.getByRole('button', { name: 'Send 1 file' }));
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
    await waitFor(() => expect(messagesOf(store.state, room.id).some((m) => m.fileIds?.length === 1)).toBe(true));
  });
});

describe('on a phone', () => {
  it('opens the menu and the picker as bottom sheets, with one Send button and a Back step', async () => {
    stubPhone();
    const { store } = await renderApp(DIRECT, plant);
    await userEvent.click(await screen.findByRole('button', { name: 'Attach' }));
    await userEvent.click(await within(await sheet()).findByRole('menuitem', { name: 'Insert from a project' }));
    const box = within(await screen.findByRole('dialog', { name: 'Insert from a project' }, { timeout: 3000 }));
    await userEvent.click(await box.findByRole('button', { name: /Corniche Office Tower/ }));
    await userEvent.click(await box.findByRole('button', { name: /No stage/ }));
    await userEvent.click(await box.findByRole('checkbox', { name: 'Facade study.svg' }));
    await userEvent.click(box.getByRole('button', { name: 'Send 1 file' }));
    await waitFor(() => expect(newOf(store.state)).toHaveLength(1));
  });
});

describe('in Arabic', () => {
  it('names the menu, the picker and the Send button in Arabic', async () => {
    await renderApp(DIRECT, (state) => {
      plant(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await screen.findByRole('button', { name: 'أرفق' }));
    const menu = await screen.findByRole('menu', { name: 'أرفق' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['ارفع ملفًا', 'أدرج من مشروع']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'أدرج من مشروع' }));
    const box = within(await screen.findByRole('dialog', { name: 'أدرج من مشروع' }));
    expect(await box.findByRole('button', { name: 'أرسل' })).toBeDisabled();
  });
});
