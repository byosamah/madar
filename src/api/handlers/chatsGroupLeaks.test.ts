import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';
import { NOW, testApi } from '../../test/factories';

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
