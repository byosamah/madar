import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { fileCalls } from './files';
import { shareCalls } from './sharing';
import { projectCalls } from './projects';
import { addGroupConversation, addProjectConversation } from '../chatState';
import type { RoleSettings } from '../contract/entities';
import { makeProject, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { memberKey } from '../rowKeys';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The project files that a chat takes (fbk_070, tsk_482). The screen sends them with chats.send and fileIds, so the rules are the ones
 * of files.share: the sender and every other person of the chat must be on the project of the file, and the sender needs the switch
 * "Share files". A hidden project reads as a missing file. Faisal usr_002 leads prj_001, Sara usr_003 is on its team, Omar usr_004
 * is outside. Lina usr_006 holds a role without the switch "Share files". prj_002 is hidden: only Hala (Admin) and Faisal see it.
 */
const calls = { ...chatCalls, ...fileCalls, ...shareCalls, ...projectCalls };
const NO_SHARE: RoleSettings = { custom: [{ id: 'rol_001', name: 'Desk', nameAr: 'مكتب', rights: [], off: ['file.share'] }] };

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = NO_SHARE;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Desk', roleId: 'rol_001' });
  const room = addProjectConversation(state, 'prj_001', STAMP);
  const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
  for (let n = 1; n <= 12; n += 1) {
    const id = `fil_${String(n).padStart(3, '0')}`;
    state.files[id] = { id, projectId: 'prj_001', stageId: null, taskId: null, name: `Sheet ${n}.pdf`, versions: [version] };
  }
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'P-002', name: 'Secret tower', leaderId: 'usr_002' });
  state.files.fil_900 = { id: 'fil_900', projectId: 'prj_002', stageId: null, taskId: null, name: 'Secret.pdf', versions: [version] };
  // Sara and Faisal are on prj_001. A group of the two, and a group with Omar, who is outside.
  const team = addGroupConversation(state, 'Team', 'usr_003', ['usr_003', 'usr_002', 'usr_001'], STAMP);
  const mixed = addGroupConversation(state, 'Mixed', 'usr_003', ['usr_003', 'usr_002', 'usr_004'], STAMP);
  return { ...t, room: room.id, team: team.id, mixed: mixed.id };
}

const ids = (count: number) => Array.from({ length: count }, (_, i) => `fil_${String(i + 1).padStart(3, '0')}`);

describe('project files in a group, a direct chat and a project chat', () => {
  it('takes up to 10 project files in one message of a group whose people are all on the project', async () => {
    const t = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: t.team, body: 'Ten sheets.', fileIds: ids(10) });
    expect(sent.message.fileIds).toEqual(ids(10));
    expect(sent.files.map((file) => file.name)).toEqual(ids(10).map((_, i) => `Sheet ${i + 1}.pdf`));
  });

  it('refuses an 11th file in one message, so the screen sends 10 in each message', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.send', { conversationId: t.team, body: 'Eleven.', fileIds: ids(11) })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
  });

  it('keeps the order of two messages that follow each other: 10 files, then 2', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: t.team, body: 'First ten.', fileIds: ids(10) });
    await t.api.call('chats.send', { conversationId: t.team, body: 'Last two.', fileIds: ids(12).slice(10) });
    const thread = await t.api.call('chats.messages', { conversationId: t.team });
    expect(thread.messages.map((view) => view.message.fileIds?.length)).toEqual([10, 2]);
  });

  it('refuses a group with a person who is not on the project, and posts nothing', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.send', { conversationId: t.mixed, body: 'Look', fileIds: ['fil_001'] })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'recipient_not_on_project' },
    });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
  });

  it('needs the switch "Share files" for a project file in a direct chat or a group, as files.share does', async () => {
    const t = world();
    t.as('usr_006');
    const group = addGroupConversation(t.store.state, 'Desk group', 'usr_006', ['usr_006', 'usr_003', 'usr_002'], STAMP);
    await expect(t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'person', userId: 'usr_003' } })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'file.share' } });
    await expect(t.api.call('chats.send', { conversationId: group.id, body: 'Look', fileIds: ['fil_001'] })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'file.share' } });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
    // The person still sends a plain message in the same group.
    await expect(t.api.call('chats.send', { conversationId: group.id, body: 'Hello' })).resolves.toBeDefined();
  });

  it('takes the files of its own project in a project chat and refuses the files of another project', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Own', fileIds: ids(10) })).resolves.toBeDefined();
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Other', fileIds: ['fil_900'] })).rejects.toMatchObject({ details: { reason: 'file_other_project' } });
  });
});

describe('a hidden project in the insert path', () => {
  async function hidden() {
    const w = world();
    w.as('usr_002');
    await w.api.call('projects.setAccess', { id: 'prj_002', hidden: true, viewerIds: [] });
    return w;
  }

  it('lists no hidden project and no file of it to a person who does not see it', async () => {
    const w = await hidden();
    for (const person of ['usr_003', 'usr_004']) {
      w.as(person);
      const names = (await w.api.call('projects.list', {})).map((row) => row.project.id);
      expect(names, person).not.toContain('prj_002');
      await expect(w.api.call('files.list', { projectId: 'prj_002' }), person).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('answers chats.send with a hidden file exactly as for a missing file, in a group, a direct chat and a project chat, and posts nothing', async () => {
    const w = await hidden();
    w.as('usr_003');
    const direct = await w.api.call('chats.openDirect', { userId: 'usr_002' });
    for (const conversationId of [w.team, direct.id, w.room]) {
      const hiddenFile = await w.api.call('chats.send', { conversationId, body: 'Look', fileIds: ['fil_900'] }).catch((error: unknown) => error as { code: string; message: string; details: unknown });
      const missing = await w.api.call('chats.send', { conversationId, body: 'Look', fileIds: ['fil_999'] }).catch((error: unknown) => error as { code: string; message: string; details: unknown });
      const shape = (error: unknown, id: string) => JSON.parse(JSON.stringify(error, ['code', 'message', 'details', 'reason', 'fields']).split(id).join('@')) as unknown;
      expect(shape(hiddenFile, 'fil_900'), conversationId).toEqual(shape(missing, 'fil_999'));
      expect(hiddenFile, conversationId).toMatchObject({ code: 'invalid_input', details: { reason: 'file_missing' } });
    }
    expect(Object.values(w.store.state.messages)).toHaveLength(0);
  });
});

/**
 * The projects that the picker of a direct chat and a group lists (owner, 2026-10-28): only the projects that hold the sender and every
 * other person of the chat, by the very rule that chats.send checks. So Send never fails because a person is not on the project.
 * prj_001: Faisal leads it, Sara is on the team. prj_003: Faisal leads it, Sara and Omar are on the team. prj_004: Omar leads it, nobody
 * else is on it. prj_002 is hidden (see world). The group "team" is Sara, Faisal and Hala. The group "mixed" is Sara, Faisal and Omar.
 */
describe('chats.insertProjects: the projects that a chat may take', () => {
  function plan() {
    const t = world();
    const state = t.store.state;
    state.projects.prj_003 = makeProject({ id: 'prj_003', code: 'P-003', name: 'Third', leaderId: 'usr_002' });
    state.projects.prj_004 = makeProject({ id: 'prj_004', code: 'P-004', name: 'Fourth', leaderId: 'usr_004' });
    state.members[memberKey('prj_003', 'usr_003')] = { projectId: 'prj_003', userId: 'usr_003', discipline: 'Architect' };
    state.members[memberKey('prj_003', 'usr_004')] = { projectId: 'prj_003', userId: 'usr_004', discipline: 'Architect' };
    const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
    for (const [id, projectId] of [['fil_301', 'prj_003'], ['fil_401', 'prj_004']] as const) {
      state.files[id] = { id, projectId, stageId: null, taskId: null, name: `${id}.pdf`, versions: [version] };
    }
    return t;
  }
  const FILE_OF: Record<string, string> = { prj_001: 'fil_001', prj_003: 'fil_301', prj_004: 'fil_401' };

  it('lists only the projects that hold every person of a group', async () => {
    const t = plan();
    t.as('usr_003');
    expect(await t.api.call('chats.insertProjects', { conversationId: t.team })).toEqual(['prj_001', 'prj_003']);
    expect(await t.api.call('chats.insertProjects', { conversationId: t.mixed })).toEqual(['prj_003']);
  });

  it('lists the projects of a direct chat with a person who is on only some of them', async () => {
    const t = plan();
    t.as('usr_003');
    const withOmar = await t.api.call('chats.openDirect', { userId: 'usr_004' });
    expect(await t.api.call('chats.insertProjects', { conversationId: withOmar.id })).toEqual(['prj_003']);
    const withFaisal = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    expect(await t.api.call('chats.insertProjects', { conversationId: withFaisal.id })).toEqual(['prj_001', 'prj_003']);
  });

  it('gives the answer of chats.send: a project is in the list exactly when a file of it goes into the chat', async () => {
    const t = plan();
    for (const person of ['usr_003', 'usr_002']) {
      t.as(person);
      const direct = await t.api.call('chats.openDirect', { userId: person === 'usr_003' ? 'usr_004' : 'usr_001' });
      for (const conversationId of [t.team, t.mixed, direct.id]) {
        const allowed = new Set(await t.api.call('chats.insertProjects', { conversationId }).catch(() => []));
        for (const [projectId, fileId] of Object.entries(FILE_OF)) {
          const sent = await t.api.call('chats.send', { conversationId, body: 'x', fileIds: [fileId] }).then(() => true, () => false);
          expect(allowed.has(projectId), `${person} ${conversationId} ${projectId}`).toBe(sent);
        }
      }
    }
  });

  it('lists nothing for a person without the switch "Share files"', async () => {
    const t = plan();
    t.as('usr_006');
    const group = addGroupConversation(t.store.state, 'Desk group', 'usr_006', ['usr_006', 'usr_003', 'usr_002'], STAMP);
    expect(await t.api.call('chats.insertProjects', { conversationId: group.id })).toEqual([]);
  });

  it('answers a project chat with its own project', async () => {
    const t = plan();
    t.as('usr_002');
    expect(await t.api.call('chats.insertProjects', { conversationId: t.room })).toEqual(['prj_001']);
  });

  it('answers an outsider of the chat exactly as for a chat that was never made, and lists no project', async () => {
    const t = plan();
    t.as('usr_004');
    const shape = (error: unknown) => JSON.stringify(error, ['code', 'message', 'details']).split(t.team).join('@').split('cnv_999').join('@');
    const real = await t.api.call('chats.insertProjects', { conversationId: t.team }).catch((error: unknown) => error);
    const none = await t.api.call('chats.insertProjects', { conversationId: 'cnv_999' }).catch((error: unknown) => error);
    expect(real).toMatchObject({ code: 'not_found' });
    expect(shape(real)).toEqual(shape(none));
  });

  it('never lists a project that the person may not see, and shows a hidden project only to the people who see it', async () => {
    const t = plan();
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_002', hidden: true, viewerIds: [] });
    const seen = async (person: string, conversationId: string) => {
      t.as(person);
      const visible = new Set((await t.api.call('projects.list', { status: 'all' })).map((row) => row.project.id));
      const listed = await t.api.call('chats.insertProjects', { conversationId });
      for (const id of listed) expect(visible.has(id), `${person} ${id}`).toBe(true);
      return listed;
    };
    expect(await seen('usr_003', t.team)).not.toContain('prj_002');
    // Faisal leads prj_002 and Hala is the Admin, so a group of the two may take its file.
    const pair = addGroupConversation(t.store.state, 'Pair', 'usr_002', ['usr_002', 'usr_001'], STAMP);
    expect(await seen('usr_002', pair.id)).toContain('prj_002');
  });
});
