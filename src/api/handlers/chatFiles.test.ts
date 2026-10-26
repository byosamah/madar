import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addProjectConversation } from '../chatState';
import { setNow } from '../../lib/dates';
import { NOW, STAMP, makeTask, makeUser, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/**
 * The files of a direct chat and of a group chat (owner, 2026-10-19). A chat file belongs to its chat: exactly the people who read the
 * messages of that chat open it. Sara (usr_003) makes the group with Faisal (usr_002) and Nour (usr_006), and a direct chat with
 * Faisal. Omar (usr_004) is in neither chat. Hala (usr_001) is the Admin and is in neither chat. usr_005 is the agent of Sara and
 * usr_008 is the agent of Omar. Every read path must answer as for a file that does not exist, with no file name in any text.
 */
const GROUP_FILE = 'Hidden-site-photo-4417.jpg';
const DIRECT_FILE = 'Hidden-contract-9921.pdf';
const SARA = 'usr_003';
const FAISAL = 'usr_002';
const NOUR = 'usr_006';
const OMAR = 'usr_004';
const ADMIN = 'usr_001';
const SARA_AGENT = 'usr_005';
const OMAR_AGENT = 'usr_008';

const photo = () => new Blob(['photo'], { type: 'image/jpeg' });
const pdf = () => new Blob(['contract'], { type: 'application/pdf' });

async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Omar Agent', kind: 'agent', discipline: 'Agent', ownerId: OMAR });
  state.tasks.tsk_001 = makeTask({ ownerId: SARA, createdBy: SARA });
  state.counters.usr = 8;
  state.counters.tsk = 1;
  const projectChat = addProjectConversation(state, 'prj_001', STAMP).id;
  t.as(SARA);
  const { id: group } = await t.api.call('chats.createGroup', { name: 'Quiet tower team', memberIds: [FAISAL, NOUR] });
  const { id: direct } = await t.api.call('chats.openDirect', { userId: FAISAL });
  const groupUpload = await t.api.call('files.upload', { name: GROUP_FILE, conversationId: group, blob: photo() });
  const directUpload = await t.api.call('files.upload', { name: DIRECT_FILE, conversationId: direct, blob: pdf() });
  await t.api.call('chats.send', { conversationId: group, body: 'The site photo.', fileIds: [groupUpload.file.id] });
  await t.api.call('chats.send', { conversationId: direct, body: 'The contract.', fileIds: [directUpload.file.id] });
  return { t, group, direct, projectChat, groupFile: groupUpload.file.id, directFile: directUpload.file.id };
}

type World = Awaited<ReturnType<typeof world>>;

const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};

/** The error of a call that fails, or null when it answers. */
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: Record<string, unknown> }) => error);

describe('a member uploads a file in a direct chat and in a group', () => {
  it('saves the file with its chat, on no project, no stage and no task, and writes no History event', async () => {
    const w = await world();
    const state = w.t.store.state;
    expect(state.files[w.groupFile]).toMatchObject({ projectId: null, stageId: null, taskId: null, conversationId: w.group, name: GROUP_FILE });
    expect(state.files[w.directFile]).toMatchObject({ projectId: null, stageId: null, taskId: null, conversationId: w.direct, name: DIRECT_FILE });
    expect(Object.values(state.events).filter((event) => event.targetType === 'file')).toEqual([]);
  });

  it('shows the file as a row of the message to every member, and each member opens it', async () => {
    const w = await world();
    for (const reader of [SARA, FAISAL, NOUR]) {
      const thread = await as(w, reader, () => w.t.api.call('chats.messages', { conversationId: w.group }));
      const message = thread.messages.find((m) => m.message.body === 'The site photo.');
      expect(message?.files, reader).toEqual([{ id: w.groupFile, name: GROUP_FILE, mimeType: 'image/jpeg' }]);
      const opened = await as(w, reader, () => w.t.api.call('files.get', { id: w.groupFile }));
      expect(opened.file.file.name).toBe(GROUP_FILE);
    }
    const direct = await as(w, FAISAL, () => w.t.api.call('chats.messages', { conversationId: w.direct }));
    expect(direct.messages.find((m) => m.message.body === 'The contract.')?.files).toEqual([{ id: w.directFile, name: DIRECT_FILE, mimeType: 'application/pdf' }]);
  });

  it('gives the uploader no delete control, and a second file with the same name is a new file, not a new version', async () => {
    const w = await world();
    w.t.as(SARA);
    const again = await w.t.api.call('files.upload', { name: GROUP_FILE, conversationId: w.group, blob: photo() });
    expect(again.file.id).not.toBe(w.groupFile);
    expect(again.file.versions.map((v) => v.letter)).toEqual(['A']);
    expect(again.canDelete).toBe(false);
  });

  it('takes a message of only a file, with the file name as the words', async () => {
    const w = await world();
    w.t.as(FAISAL);
    const up = await w.t.api.call('files.upload', { name: 'Level 2.pdf', conversationId: w.group, blob: pdf() });
    const sent = await w.t.api.call('chats.send', { conversationId: w.group, body: 'Level 2.pdf', fileIds: [up.file.id] });
    expect(sent.files).toEqual([{ id: up.file.id, name: 'Level 2.pdf', mimeType: 'application/pdf' }]);
  });
});

describe('who may upload into a chat', () => {
  it('refuses a person outside the chat, and the Admin who is not a member, as for a chat that does not exist', async () => {
    const w = await world();
    for (const [reader, chat] of [[OMAR, w.group], [OMAR, w.direct], [ADMIN, w.group], [ADMIN, w.direct], [OMAR_AGENT, w.group]] as const) {
      const refused = await as(w, reader, () => failureOf(w.t.api.call('files.upload', { name: 'Leak.pdf', conversationId: chat, blob: pdf() })));
      expect(refused, `${reader} ${chat}`).toMatchObject({ code: 'not_found', message: `Conversation ${chat} does not exist.` });
    }
    const missing = await as(w, SARA, () => failureOf(w.t.api.call('files.upload', { name: 'Leak.pdf', conversationId: 'cnv_404', blob: pdf() })));
    expect(missing).toMatchObject({ code: 'not_found', message: 'Conversation cnv_404 does not exist.' });
    expect(Object.values(w.t.store.state.files).filter((f) => f.name === 'Leak.pdf')).toEqual([]);
  });

  it('refuses the start of an upload for the same people, before it signs anything', async () => {
    const w = await world();
    for (const [reader, chat] of [[OMAR, w.group], [ADMIN, w.direct], [OMAR_AGENT, w.direct]] as const) {
      const refused = await as(w, reader, () => failureOf(w.t.api.call('files.uploadStart', { name: 'x.pdf', conversationId: chat, size: 1, mimeType: 'application/pdf' })));
      expect(refused, `${reader} ${chat}`).toMatchObject({ code: 'not_found', message: `Conversation ${chat} does not exist.` });
    }
    await expect(as(w, SARA, () => w.t.api.call('files.uploadStart', { name: 'x.pdf', conversationId: w.group, size: 1, mimeType: 'application/pdf' }))).resolves.toHaveProperty('uploadId');
  });

  it('refuses a project chat (a project chat uses the files of its project) and the mix of a project and a chat', async () => {
    const w = await world();
    w.t.as(SARA);
    await expect(w.t.api.call('files.upload', { name: 'x.pdf', conversationId: w.projectChat, blob: pdf() })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(w.t.api.call('files.upload', { name: 'x.pdf', projectId: 'prj_001', conversationId: w.group, blob: pdf() })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a stage, a task, a cover and a client mark on a chat file', async () => {
    const w = await world();
    w.t.as(SARA);
    const base = { name: 'x.png', conversationId: w.group, blob: new Blob(['x'], { type: 'image/png' }) };
    for (const more of [{ stageId: 'stg_001' }, { taskId: 'tsk_001' }, { asCover: true }, { receivedFromClient: true }]) {
      await expect(w.t.api.call('files.upload', { ...base, ...more }), JSON.stringify(more)).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'file_chat' } });
    }
  });

  it('refuses a group where everyone else left, and a direct chat with a person who is off', async () => {
    const w = await world();
    for (const leaver of [FAISAL, NOUR]) await as(w, leaver, () => w.t.api.call('chats.leaveGroup', { conversationId: w.group }));
    const closed = await as(w, SARA, () => failureOf(w.t.api.call('files.upload', { name: 'x.pdf', conversationId: w.group, blob: pdf() })));
    expect(closed).toMatchObject({ code: 'forbidden', details: { reason: 'person_left' } });
    w.t.store.state.users[FAISAL].active = false;
    const off = await as(w, SARA, () => failureOf(w.t.api.call('files.upload', { name: 'x.pdf', conversationId: w.direct, blob: pdf() })));
    expect(off).toMatchObject({ code: 'forbidden', details: { reason: 'person_left' } });
  });

  it('refuses a member who was removed, and a member who left, as for a chat that does not exist', async () => {
    const w = await world();
    await as(w, SARA, () => w.t.api.call('chats.updateGroup', { conversationId: w.group, remove: [NOUR] }));
    await as(w, FAISAL, () => w.t.api.call('chats.leaveGroup', { conversationId: w.group }));
    for (const reader of [NOUR, FAISAL]) {
      const refused = await as(w, reader, () => failureOf(w.t.api.call('files.upload', { name: 'x.pdf', conversationId: w.group, blob: pdf() })));
      expect(refused, reader).toMatchObject({ code: 'not_found', message: `Conversation ${w.group} does not exist.` });
    }
  });
});

describe('an outsider opens nothing of a chat file', () => {
  const readers = [OMAR, OMAR_AGENT] as const;

  it('gets not_found, with no file name, from files.get and files.link', async () => {
    const w = await world();
    for (const reader of [...readers, ADMIN]) {
      for (const id of [w.groupFile, w.directFile]) {
        const get = await as(w, reader, () => failureOf(w.t.api.call('files.get', { id })));
        const link = await as(w, reader, () => failureOf(w.t.api.call('files.link', { id, variant: 'full', disposition: 'inline' })));
        const thumb = await as(w, reader, () => failureOf(w.t.api.call('files.link', { id, variant: 'thumb', disposition: 'attachment' })));
        for (const refused of [get, link, thumb]) {
          expect(refused, `${reader} ${id}`).toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
          expect(JSON.stringify(refused)).not.toMatch(/Hidden-/);
        }
      }
    }
  });

  it('finds the file in no files.list, no search and no project page, and in no History line', async () => {
    const w = await world();
    for (const reader of [OMAR, OMAR_AGENT, ADMIN, SARA, SARA_AGENT, FAISAL]) {
      const text = await as(w, reader, async () => JSON.stringify([
        await w.t.api.call('files.list', { projectId: 'prj_001' }),
        await w.t.api.call('search.query', { text: 'Hidden' }),
        await w.t.api.call('search.query', { text: 'site photo' }),
        await w.t.api.call('projects.get', { id: 'prj_001' }),
        await w.t.api.call('events.list', { limit: 500 }),
        await w.t.api.call('dashboard.get', {}),
      ]));
      expect(text, reader).not.toMatch(/Hidden-/);
      expect(text, reader).not.toContain(w.groupFile);
      expect(text, reader).not.toContain(w.directFile);
    }
  });

  it('reads no message of the chat, so it sees no file row', async () => {
    const w = await world();
    for (const reader of [OMAR, OMAR_AGENT, ADMIN]) {
      const refused = await as(w, reader, () => failureOf(w.t.api.call('chats.messages', { conversationId: w.group })));
      expect(refused, reader).toMatchObject({ code: 'not_found', message: `Conversation ${w.group} does not exist.` });
      expect(JSON.stringify(refused)).not.toContain(GROUP_FILE);
    }
    const direct = await as(w, OMAR, () => failureOf(w.t.api.call('chats.messages', { conversationId: w.direct })));
    expect(JSON.stringify(direct)).not.toContain(DIRECT_FILE);
  });

  it('cannot send the id of a chat file into a chat of its own: the file reads as missing', async () => {
    const w = await world();
    w.t.as(OMAR);
    const { id: own } = await w.t.api.call('chats.openDirect', { userId: NOUR });
    for (const fileId of [w.groupFile, w.directFile, 'fil_404']) {
      const refused = await failureOf(w.t.api.call('chats.send', { conversationId: own, body: 'Look', fileIds: [fileId] }));
      expect(refused, fileId).toMatchObject({ code: 'invalid_input', details: { reason: 'file_missing' } });
      expect(JSON.stringify(refused)).not.toContain('Hidden-');
    }
  });

  it('cannot share, delete or mark the file as delivered: the file reads as missing', async () => {
    const w = await world();
    w.t.as(OMAR);
    const calls = [
      () => w.t.api.call('files.share', { fileId: w.groupFile, target: { kind: 'person', userId: NOUR } }),
      () => w.t.api.call('files.delete', { id: w.groupFile }),
      () => w.t.api.call('files.markDelivered', { id: w.groupFile }),
    ];
    for (const run of calls) await expect(run()).rejects.toMatchObject({ code: 'not_found', message: `File ${w.groupFile} does not exist.` });
  });
});

describe('the agent of a member (owner, 2026-10-26: an agent follows exactly the rights of its person)', () => {
  it('reads the file name in a message, and opens the file of a chat of its person', async () => {
    const w = await world();
    const thread = await as(w, SARA_AGENT, () => w.t.api.call('chats.messages', { conversationId: w.group }));
    expect(thread.messages.find((m) => m.message.body === 'The site photo.')?.files).toEqual([{ id: w.groupFile, name: GROUP_FILE, mimeType: 'image/jpeg' }]);
    const opened = await as(w, SARA_AGENT, () => w.t.api.call('files.get', { id: w.groupFile }));
    expect(opened.file.file.name).toBe(GROUP_FILE);
    const link = await as(w, SARA_AGENT, () => w.t.api.call('files.link', { id: w.groupFile, variant: 'full', disposition: 'inline' }));
    expect(link).toHaveProperty('url');
  });

  it('sends a file into a group and a direct chat of its person, and the people of the chat read it', async () => {
    const w = await world();
    for (const chat of [w.group, w.direct]) {
      const up = await as(w, SARA_AGENT, () => w.t.api.call('files.upload', { name: 'Agent-plan.pdf', conversationId: chat, blob: pdf() }));
      expect(up.file).toMatchObject({ conversationId: chat, projectId: null, name: 'Agent-plan.pdf' });
      expect(up.latest.uploadedBy).toBe(SARA_AGENT);
      const sent = await as(w, SARA_AGENT, () => w.t.api.call('chats.send', { conversationId: chat, body: 'The plan.', fileIds: [up.file.id] }));
      expect(sent.files).toEqual([{ id: up.file.id, name: 'Agent-plan.pdf', mimeType: 'application/pdf' }]);
      const opened = await as(w, FAISAL, () => w.t.api.call('files.get', { id: up.file.id }));
      expect(opened.file.file.name).toBe('Agent-plan.pdf');
    }
  });

  it('keeps every person rule: a closed group and a project chat refuse the agent as they refuse its person', async () => {
    const w = await world();
    const projectRefused = await as(w, SARA_AGENT, () => failureOf(w.t.api.call('files.upload', { name: 'x.pdf', conversationId: w.projectChat, blob: pdf() })));
    expect(projectRefused).toMatchObject({ code: 'invalid_input' });
    for (const leaver of [FAISAL, NOUR]) await as(w, leaver, () => w.t.api.call('chats.leaveGroup', { conversationId: w.group }));
    const closed = await as(w, SARA_AGENT, () => failureOf(w.t.api.call('files.upload', { name: 'x.pdf', conversationId: w.group, blob: pdf() })));
    expect(closed).toMatchObject({ code: 'forbidden', details: { reason: 'person_left' } });
  });
});

describe('the agent of a person who is no member of the chat (the leak tests of 2026-10-26)', () => {
  it('gets not_found from the upload, the start of an upload, the open and the link, and no file name in any text', async () => {
    const w = await world();
    for (const reader of [OMAR_AGENT]) {
      for (const chat of [w.group, w.direct]) {
        const upload = await as(w, reader, () => failureOf(w.t.api.call('files.upload', { name: 'Leak.pdf', conversationId: chat, blob: pdf() })));
        const start = await as(w, reader, () => failureOf(w.t.api.call('files.uploadStart', { name: 'x.pdf', conversationId: chat, size: 1, mimeType: 'application/pdf' })));
        const messages = await as(w, reader, () => failureOf(w.t.api.call('chats.messages', { conversationId: chat })));
        for (const refused of [upload, start, messages]) {
          expect(refused, `${reader} ${chat}`).toMatchObject({ code: 'not_found', message: `Conversation ${chat} does not exist.` });
          expect(JSON.stringify(refused)).not.toMatch(/Hidden-|Leak/);
        }
      }
      for (const id of [w.groupFile, w.directFile]) {
        for (const refused of [
          await as(w, reader, () => failureOf(w.t.api.call('files.get', { id }))),
          await as(w, reader, () => failureOf(w.t.api.call('files.link', { id, variant: 'full', disposition: 'inline' }))),
          await as(w, reader, () => failureOf(w.t.api.call('files.link', { id, variant: 'thumb', disposition: 'attachment' }))),
        ]) {
          expect(refused, `${reader} ${id}`).toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
          expect(JSON.stringify(refused)).not.toMatch(/Hidden-/);
        }
      }
    }
    expect(Object.values(w.t.store.state.files).filter((f) => f.name === 'Leak.pdf')).toEqual([]);
  });

  it('gets not_found for the direct chat of two other people, also when the agent belongs to a member of a group', async () => {
    const w = await world();
    // Sara is in both chats. The agent of Nour (a member of the group only) opens the group file and not the direct file.
    w.t.store.state.users.usr_009 = makeUser('usr_009', { name: 'Nour Agent', kind: 'agent', discipline: 'Agent', ownerId: NOUR });
    const groupOpen = await as(w, 'usr_009', () => w.t.api.call('files.get', { id: w.groupFile }));
    expect(groupOpen.file.file.name).toBe(GROUP_FILE);
    const directOpen = await as(w, 'usr_009', () => failureOf(w.t.api.call('files.get', { id: w.directFile })));
    expect(directOpen).toMatchObject({ code: 'not_found', message: `File ${w.directFile} does not exist.` });
    const directUpload = await as(w, 'usr_009', () => failureOf(w.t.api.call('files.upload', { name: 'Leak.pdf', conversationId: w.direct, blob: pdf() })));
    expect(directUpload).toMatchObject({ code: 'not_found' });
  });
});

describe('a file stays in its chat', () => {
  it('can be sent again in its own chat', async () => {
    const w = await world();
    w.t.as(FAISAL);
    const sent = await w.t.api.call('chats.send', { conversationId: w.group, body: 'Again', fileIds: [w.groupFile] });
    expect(sent.files).toEqual([{ id: w.groupFile, name: GROUP_FILE, mimeType: 'image/jpeg' }]);
  });

  it('cannot go into another chat, a project chat, a task, a post or the Tracker', async () => {
    const w = await world();
    w.t.as(SARA);
    const reason = { code: 'invalid_input', details: { reason: 'file_chat' } };
    await expect(w.t.api.call('chats.send', { conversationId: w.direct, body: 'Other', fileIds: [w.groupFile] })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('chats.send', { conversationId: w.group, body: 'Other', fileIds: [w.directFile] })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('chats.send', { conversationId: w.projectChat, body: 'Other', fileIds: [w.groupFile] })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Other', fileIds: [w.groupFile] })).rejects.toMatchObject(reason);
    // A post takes only files of its own project, whatever the other file is, so it gives the same plain refusal as for a missing file.
    await expect(w.t.api.call('updates.create', { projectId: 'prj_001', body: 'Other', fileIds: [w.groupFile] })).rejects.toMatchObject({ code: 'invalid_input', message: 'A file is not in this project.' });
    await expect(w.t.api.call('tracker.log', { projectId: 'prj_001', type: 'file', direction: 'in', title: 'Other', fileIds: [w.groupFile] })).rejects.toMatchObject(reason);
  });

  it('cannot be shared, deleted or marked as delivered', async () => {
    const w = await world();
    w.t.as(SARA);
    const reason = { code: 'invalid_input', details: { reason: 'file_chat' } };
    for (const target of [{ kind: 'project_chat' }, { kind: 'person', userId: NOUR }, { kind: 'task', taskId: 'tsk_001' }] as const) {
      await expect(w.t.api.call('files.share', { fileId: w.groupFile, target }), target.kind).rejects.toMatchObject(reason);
    }
    await expect(w.t.api.call('files.delete', { id: w.groupFile })).rejects.toMatchObject(reason);
    await expect(w.t.api.call('files.markDelivered', { id: w.groupFile })).rejects.toMatchObject(reason);
    expect(w.t.store.state.files[w.groupFile]).toBeDefined();
  });

  it('does not count in the files of a project or in the file count of a task', async () => {
    const w = await world();
    w.t.as(SARA);
    expect(await w.t.api.call('files.list', { projectId: 'prj_001' })).toEqual([]);
    expect((await w.t.api.call('tasks.get', { id: 'tsk_001' })).fileCount ?? 0).toBe(0);
  });
});

describe('the members of a chat change', () => {
  it('lets a person who joins the group later open the old file, and shuts it again after the removal', async () => {
    const w = await world();
    await as(w, SARA, () => w.t.api.call('chats.updateGroup', { conversationId: w.group, add: [OMAR] }));
    const thread = await as(w, OMAR, () => w.t.api.call('chats.messages', { conversationId: w.group }));
    expect(thread.messages.find((m) => m.message.body === 'The site photo.')?.files).toEqual([{ id: w.groupFile, name: GROUP_FILE, mimeType: 'image/jpeg' }]);
    await expect(as(w, OMAR, () => w.t.api.call('files.get', { id: w.groupFile }))).resolves.toBeDefined();
    await as(w, SARA, () => w.t.api.call('chats.updateGroup', { conversationId: w.group, remove: [OMAR] }));
    const closed = await as(w, OMAR, () => failureOf(w.t.api.call('files.get', { id: w.groupFile })));
    expect(closed).toMatchObject({ code: 'not_found', message: `File ${w.groupFile} does not exist.` });
  });

  it('shuts the file to a person who turns off, and to a person who leaves the group', async () => {
    const w = await world();
    await as(w, NOUR, () => w.t.api.call('chats.leaveGroup', { conversationId: w.group }));
    await expect(as(w, NOUR, () => w.t.api.call('files.get', { id: w.groupFile }))).rejects.toMatchObject({ code: 'not_found' });
    w.t.store.state.users[FAISAL].active = false;
    await expect(as(w, FAISAL, () => w.t.api.call('files.get', { id: w.directFile }))).rejects.toMatchObject({ code: 'not_found' });
  });
});
