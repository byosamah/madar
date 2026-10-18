import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';
import { NOW, STAMP, makeTask, testApi } from '../../test/factories';
import { nextId } from '../store';

beforeEach(() => setNow(NOW));

/**
 * The leak probes of a group chat (Review Focus 1, owner rule of 2026-10-18). Sara (usr_003) makes a group with Faisal (usr_002) and
 * Hala (usr_001), and writes a secret text in it. Omar (usr_004) is outside. Every read path must answer as for a chat that does not
 * exist: the same code and the same text, with no count, no row, no notice and no push. An agent of Omar gets the same answers.
 */
const SECRET = 'SECRET-GROUP-TEXT-7731';
const GROUP_NAME = 'Quiet tower team';

async function world() {
  const t = testApi(calls);
  t.as('usr_003');
  const { id } = await t.api.call('chats.createGroup', { name: GROUP_NAME, memberIds: ['usr_002', 'usr_001'] });
  await t.api.call('chats.send', { conversationId: id, body: SECRET });
  return { t, group: id };
}

/** The error of a call that fails, or null when it answers. */
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details: unknown }) => error);

/** The answer of a call for a chat that does not exist: the code, the text and the details of an id that is not in the office. */
async function missingAnswer(t: Awaited<ReturnType<typeof world>>['t'], call: 'chats.messages' | 'chats.send' | 'chats.markRead' | 'chats.archive') {
  const input = call === 'chats.send' ? { body: 'Hello' } : call === 'chats.archive' ? { archived: true } : {};
  return failureOf(t.api.call(call, { conversationId: 'cnv_999', ...input }));
}

describe('an outsider reads nothing of a group', () => {
  it('finds no row in chats.list and no count in chats.unreadCount', async () => {
    const { t, group } = await world();
    t.as('usr_004');
    expect((await t.api.call('chats.list', {})).map((row) => row.id)).not.toContain(group);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
  });

  it('finds no row and no text of the group in chats.waiting (fbk_011)', async () => {
    const { t, group } = await world();
    t.as('usr_004');
    const rows = await t.api.call('chats.waiting', {});
    expect(rows.map((row) => row.id)).not.toContain(group);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it.each(['chats.messages', 'chats.send', 'chats.markRead', 'chats.archive'] as const)('%s answers as for a chat that does not exist', async (call) => {
    const { t, group } = await world();
    t.as('usr_004');
    const input = call === 'chats.send' ? { body: 'Hello' } : call === 'chats.archive' ? { archived: true } : {};
    const hidden = await failureOf(t.api.call(call, { conversationId: group, ...input }));
    const missing = await missingAnswer(t, call);
    expect(hidden).toMatchObject({ code: 'not_found', message: `Conversation ${group} does not exist.` });
    expect(missing).toMatchObject({ code: 'not_found', message: 'Conversation cnv_999 does not exist.' });
    expect(hidden?.details).toEqual({ id: group });
  });

  it('gets no message of the group in a search', async () => {
    const { t } = await world();
    t.as('usr_004');
    const found = await t.api.call('search.query', { text: SECRET });
    expect(JSON.stringify(found)).not.toContain(SECRET);
    expect(JSON.stringify(await t.api.call('search.query', { text: GROUP_NAME }))).not.toContain(GROUP_NAME);
  });

  it('gets no notice of a message that names him while he is outside', async () => {
    const { t, group } = await world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: group, body: `Please read ${mentionMarkup('Omar Other', 'usr_004')}` });
    t.as('usr_004');
    expect((await t.api.call('notifications.list', {})).filter((n) => n.notification.targetId === group)).toEqual([]);
  });

  it('gets the same answers through the agent of Omar', async () => {
    const { t, group } = await world();
    t.store.state.users.usr_006 = { ...t.store.state.users.usr_005, id: 'usr_006', name: 'Omar Agent', ownerId: 'usr_004' };
    t.as('usr_006');
    expect((await t.api.call('chats.list', {})).map((row) => row.id)).not.toContain(group);
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain(group);
    expect(await failureOf(t.api.call('chats.messages', { conversationId: group }))).toMatchObject({
      code: 'not_found', message: `Conversation ${group} does not exist.`,
    });
    expect(await failureOf(t.api.call('chats.send', { conversationId: group, body: 'Hello' }))).toMatchObject({ code: 'not_found' });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
  });
});

describe('a removed member reads nothing of a group after the removal', () => {
  it('gets the same answers, and his old notice holds no link to the group', async () => {
    const { t, group } = await world();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: group, add: ['usr_004'] });
    await t.api.call('chats.send', { conversationId: group, body: `Please read ${mentionMarkup('Omar Other', 'usr_004')}` });
    t.as('usr_004');
    expect((await t.api.call('notifications.list', {})).filter((n) => n.notification.targetId === group)).toHaveLength(1);
    // A new member reads the history too: the secret text of before he joined counts as unread as well.
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(2);
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: group, remove: ['usr_004'] });
    t.as('usr_004');
    expect((await t.api.call('chats.list', {})).map((row) => row.id)).not.toContain(group);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
    // The removed member gets no row and no text of the group in chats.waiting (fbk_011).
    const waiting = await t.api.call('chats.waiting', {});
    expect(waiting.map((row) => row.id)).not.toContain(group);
    expect(JSON.stringify(waiting)).not.toContain(SECRET);
    expect(await failureOf(t.api.call('chats.messages', { conversationId: group }))).toMatchObject({ code: 'not_found', message: `Conversation ${group} does not exist.` });
    expect(await failureOf(t.api.call('chats.send', { conversationId: group, body: 'Hello' }))).toMatchObject({ code: 'not_found' });
    expect(await failureOf(t.api.call('chats.markRead', { conversationId: group }))).toMatchObject({ code: 'not_found' });
    expect(await failureOf(t.api.call('chats.archive', { conversationId: group, archived: true }))).toMatchObject({ code: 'not_found' });
    const notice = (await t.api.call('notifications.list', {})).find((n) => n.notification.targetId === group);
    expect(notice?.gone).toBe(true);
    expect(notice?.link).not.toContain(group);
    expect(JSON.stringify(await t.api.call('notifications.list', {}))).not.toContain(GROUP_NAME);
  });

  it('gets the same answers after leaving the group himself', async () => {
    const { t, group } = await world();
    t.as('usr_002');
    await t.api.call('chats.leaveGroup', { conversationId: group });
    expect(await failureOf(t.api.call('chats.messages', { conversationId: group }))).toMatchObject({ code: 'not_found', message: `Conversation ${group} does not exist.` });
  });
});

describe('the members of a group still read it', () => {
  it('keeps the group in the list of a member, with the name', async () => {
    const { t, group } = await world();
    t.as('usr_001');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === group)).toMatchObject({ kind: 'group', title: GROUP_NAME });
  });
});

/**
 * The file rows of an old message (fbk_011, security review 2026-10-18). A person who joins a group later reads the old messages, and a
 * member reads the messages of other members. A message view shows a file row (name, id) only when the reader may view that file
 * (mayViewFile). Every project file is open to every person (spec 2.3), so its row stays. A file of an office task shows only to the
 * people of that task. The chat rules keep an office file out of a message, so the test plants one in the state.
 */
const OFFICE_FILE = 'Private-licence-scan.pdf';
const PROJECT_FILE = 'Tower-plan.pdf';
const LICENCE_BODY = 'The licence scan is in this message.';

async function fileWorld() {
  const w = await world();
  const state = w.t.store.state;
  const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
  // An office task of Sara (usr_003): she makes it and leads it. Only the Admin, Sara and the helpers see it and its file.
  state.tasks.tsk_900 = makeTask({ id: 'tsk_900', projectId: null, stageId: null, title: 'Private licence', ownerId: 'usr_003', createdBy: 'usr_003', needsReview: false });
  state.files.fil_900 = { id: 'fil_900', projectId: null, stageId: null, taskId: 'tsk_900', name: OFFICE_FILE, versions: [version] };
  state.files.fil_901 = { id: 'fil_901', projectId: 'prj_001', stageId: null, taskId: null, name: PROJECT_FILE, versions: [version] };
  // The project file goes through the real call: Sara, Faisal and Hala may all share a file of prj_001.
  await w.t.api.call('chats.send', { conversationId: w.group, body: 'The plan is here.', fileIds: ['fil_901'] });
  const id = nextId(state, 'msg');
  state.messages[id] = { id, conversationId: w.group, authorId: 'usr_003', actingForId: 'usr_003', body: LICENCE_BODY, mentions: [], fileIds: ['fil_900'], createdAt: STAMP, editedAt: null };
  return { ...w, officeMessage: id };
}

/** The thread of a group as one reader reads it, with the message of the licence scan and the message of the plan picked out. */
async function readThread(t: Awaited<ReturnType<typeof world>>['t'], reader: string, group: string) {
  t.as(reader);
  const thread = await t.api.call('chats.messages', { conversationId: group });
  const view = (body: string) => thread.messages.find((m) => m.message.body === body);
  return { thread, text: JSON.stringify(thread), licence: view(LICENCE_BODY), plan: view('The plan is here.') };
}

describe('a group shows the file rows of a file only to a reader who may view that file', () => {
  it('shows an office file row to Sara (its maker) and to Hala (the Admin), and keeps the message for every member', async () => {
    const { t, group } = await fileWorld();
    for (const reader of ['usr_003', 'usr_001']) {
      const { licence } = await readThread(t, reader, group);
      expect(licence?.files, reader).toEqual([{ id: 'fil_900', name: OFFICE_FILE }]);
      expect(licence?.message.fileIds, reader).toEqual(['fil_900']);
    }
  });

  it('drops the office file row from the view of a member who may not view it (Faisal), and keeps the text of the message', async () => {
    const { t, group } = await fileWorld();
    const { licence, text } = await readThread(t, 'usr_002', group);
    expect(licence).toMatchObject({ message: { body: LICENCE_BODY, fileIds: [] }, files: [] });
    expect(text).not.toContain('fil_900');
    expect(text).not.toContain(OFFICE_FILE);
  });

  it('drops the office file row from the view of a person who joins later (Omar), and keeps the project file row', async () => {
    const { t, group } = await fileWorld();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: group, add: ['usr_004'] });
    const { licence, plan, text } = await readThread(t, 'usr_004', group);
    expect(licence).toMatchObject({ message: { body: LICENCE_BODY, fileIds: [] }, files: [] });
    expect(text).not.toContain('fil_900');
    expect(text).not.toContain(OFFICE_FILE);
    // Every project file is open to every person, so the row of the plan stays for a late member.
    expect(plan?.files).toEqual([{ id: 'fil_901', name: PROJECT_FILE }]);
    expect(plan?.message.fileIds).toEqual(['fil_901']);
  });

  it('gives the agent of a late member the same view as the person (the MCP reads run this call)', async () => {
    const { t, group } = await fileWorld();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: group, add: ['usr_004'] });
    t.store.state.users.usr_006 = { ...t.store.state.users.usr_005, id: 'usr_006', name: 'Omar Agent', ownerId: 'usr_004' };
    const { thread: person } = await readThread(t, 'usr_004', group);
    const { thread: agent, text } = await readThread(t, 'usr_006', group);
    expect(agent.messages.map((m) => [m.message.body, m.files, m.message.fileIds])).toEqual(person.messages.map((m) => [m.message.body, m.files, m.message.fileIds]));
    expect(text).not.toContain('fil_900');
    expect(text).not.toContain(OFFICE_FILE);
  });

  it('finds the office file in a search for the people of its task and for no other member of the group', async () => {
    const { t, group } = await fileWorld();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: group, add: ['usr_004'] });
    expect((await t.api.call('search.query', { text: 'licence-scan' })).files.map((f) => f.name)).toEqual([OFFICE_FILE]);
    for (const reader of ['usr_002', 'usr_004']) {
      t.as(reader);
      const found = await t.api.call('search.query', { text: 'licence-scan' });
      expect(JSON.stringify(found), reader).not.toContain(OFFICE_FILE);
      expect(JSON.stringify(found), reader).not.toContain('fil_900');
    }
  });

  it('keeps a deleted file as a row with no name, as before', async () => {
    const { t, group } = await fileWorld();
    delete t.store.state.files.fil_901;
    const { plan } = await readThread(t, 'usr_002', group);
    expect(plan?.files).toEqual([{ id: 'fil_901', name: null }]);
  });
});

describe('a removed member cannot send or read, with or without a file', () => {
  it('answers not_found to chats.send with a file id before any check of the file, and stores no message', async () => {
    const { t, group } = await fileWorld();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: group, remove: ['usr_002'] });
    const before = Object.keys(t.store.state.messages).length;
    t.as('usr_002');
    for (const fileIds of [[], ['fil_901'], ['fil_900'], ['fil_999']]) {
      const refused = await failureOf(t.api.call('chats.send', { conversationId: group, body: 'Hello', fileIds }));
      expect(refused, JSON.stringify(fileIds)).toMatchObject({ code: 'not_found', message: `Conversation ${group} does not exist.` });
      expect(refused?.details).toEqual({ id: group });
    }
    expect(Object.keys(t.store.state.messages)).toHaveLength(before);
    const thread = await failureOf(t.api.call('chats.messages', { conversationId: group }));
    expect(thread).toMatchObject({ code: 'not_found', message: `Conversation ${group} does not exist.` });
    expect(JSON.stringify(thread)).not.toContain('fil_900');
  });

  it('gives the agent of a removed member the same answers', async () => {
    const { t, group } = await fileWorld();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: group, remove: ['usr_002'] });
    t.store.state.users.usr_006 = { ...t.store.state.users.usr_005, id: 'usr_006', name: 'Faisal Agent', ownerId: 'usr_002' };
    t.as('usr_006');
    expect(await failureOf(t.api.call('chats.send', { conversationId: group, body: 'Hello', fileIds: ['fil_901'] }))).toMatchObject({ code: 'not_found' });
    expect(await failureOf(t.api.call('chats.messages', { conversationId: group }))).toMatchObject({ code: 'not_found' });
    expect((await t.api.call('chats.list', {})).map((row) => row.id)).not.toContain(group);
    expect(JSON.stringify(await t.api.call('chats.waiting', {}))).not.toContain(LICENCE_BODY);
  });
});
