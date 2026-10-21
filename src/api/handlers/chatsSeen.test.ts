import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import type { Message } from '../contract/entities';
import { memberKey } from '../rowKeys';
import { chatReadKey } from '../store';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...projectCalls };

/**
 * The seen time of a member and the seen information of a chat (chat presence design C4, base B2). Hala (usr_001) is the Admin, Faisal
 * (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is outside, usr_006 is an agent of Faisal.
 */
const T1 = '2026-09-30T08:10:00.000+03:00';
const EARLY = '2026-09-30T07:00:00.000+03:00';
const LATER = '2026-09-30T08:50:00.000+03:00';
const AHEAD = '2026-09-30T10:30:00.000+03:00';

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.tasks.tsk_001 = makeTask();
  state.counters.tsk = 1;
  state.users.usr_006 = makeUser('usr_006', { name: 'Madar Second', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' });
  const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP).id;
  const room = addProjectConversation(state, 'prj_001', STAMP).id;
  const group = addGroupConversation(state, 'Site group', 'usr_002', ['usr_002', 'usr_003', 'usr_001'], STAMP).id;
  for (const [id, conversationId] of [['msg_001', direct], ['msg_002', room], ['msg_003', group]]) {
    const message: Message = { id, conversationId, authorId: 'usr_002', actingForId: 'usr_002', body: 'Hello', mentions: [], createdAt: T1, editedAt: null };
    state.messages[id] = message;
  }
  state.counters.msg = 3;
  return { t, direct, room, group };
}

const seenAtOf = (t: ReturnType<typeof world>['t'], conversationId: string, userId: string) =>
  t.store.state.chatReads[chatReadKey(conversationId, userId)]?.seenAt;
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string }) => error);

describe('chats.markRead with seen: true', () => {
  it('moves the seen time with seen: true, only forward', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: direct, seen: true });
    expect(seenAtOf(t, direct, 'usr_003')).toBe(STAMP);
    // An older seen time never replaces a newer one.
    t.store.state.chatReads[chatReadKey(direct, 'usr_003')]!.seenAt = AHEAD;
    await t.api.call('chats.markRead', { conversationId: direct, seen: true });
    expect(seenAtOf(t, direct, 'usr_003')).toBe(AHEAD);
    expect(t.store.state.chatReads[chatReadKey(direct, 'usr_003')]?.lastReadAt).toBeDefined();
  });

  it('keeps the seen time without the flag, and on an archive', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: direct });
    expect(seenAtOf(t, direct, 'usr_003')).toBeUndefined();
    t.store.state.chatReads[chatReadKey(direct, 'usr_003')]!.seenAt = EARLY;
    await t.api.call('chats.markRead', { conversationId: direct });
    await t.api.call('chats.archive', { conversationId: direct, archived: true });
    await t.api.call('chats.archive', { conversationId: direct, archived: false });
    await t.api.call('chats.markUnread', { conversationId: direct });
    expect(seenAtOf(t, direct, 'usr_003')).toBe(EARLY);
  });

  it('gives the seen times of the other members only, with the count of the others', async () => {
    const { t, direct, room } = world();
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: direct, seen: true });
    await t.api.call('chats.markRead', { conversationId: room, seen: true });
    t.as('usr_002');
    const onDirect = await t.api.call('chats.messages', { conversationId: direct });
    expect(onDirect.others).toBe(1);
    expect(onDirect.seen).toEqual([{ userId: 'usr_003', at: STAMP }]);
    expect(onDirect.seenUpTo).toBeNull();
    const onRoom = await t.api.call('chats.messages', { conversationId: room });
    expect(onRoom.others).toBe(1);
    expect(onRoom.seen.map((entry) => entry.userId)).toEqual(['usr_003']);
    // The reader's own seen time is seenUpTo, never an entry of "seen".
    await t.api.call('chats.markRead', { conversationId: room, seen: true });
    const again = await t.api.call('chats.messages', { conversationId: room });
    expect(again.seenUpTo).toBe(STAMP);
    expect(again.seen.map((entry) => entry.userId)).toEqual(['usr_003']);
  });

  it('puts the newest look first', async () => {
    const { t, group } = world();
    t.store.state.chatReads[chatReadKey(group, 'usr_003')] = { conversationId: group, userId: 'usr_003', lastReadAt: T1, seenAt: EARLY };
    t.store.state.chatReads[chatReadKey(group, 'usr_001')] = { conversationId: group, userId: 'usr_001', lastReadAt: T1, seenAt: LATER };
    t.as('usr_002');
    const page = await t.api.call('chats.messages', { conversationId: group });
    expect(page.seen).toEqual([{ userId: 'usr_001', at: LATER }, { userId: 'usr_003', at: EARLY }]);
    expect(page.others).toBe(2);
  });

  it('counts only the members of today', async () => {
    const { t, room } = world();
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: room, seen: true });
    t.as('usr_002');
    expect((await t.api.call('chats.messages', { conversationId: room })).others).toBe(1);
    // Sara leaves the team: her old seen time does not count and the count of the others falls.
    delete t.store.state.members[memberKey('prj_001', 'usr_003')];
    const page = await t.api.call('chats.messages', { conversationId: room });
    expect(page.seen.find((entry) => entry.userId === 'usr_003')).toBeUndefined();
    expect(page.others).toBe(0);
  });

  it('gives no seen entry for an Admin outside the team, and the Admin\'s look moves no seen time', async () => {
    const { t, room } = world();
    t.as('usr_001');
    await t.api.call('chats.markRead', { conversationId: room, seen: true });
    expect(seenAtOf(t, room, 'usr_001')).toBeUndefined();
    // Even a stored time of an Admin who is not a member never shows.
    t.store.state.chatReads[chatReadKey(room, 'usr_001')] = { conversationId: room, userId: 'usr_001', lastReadAt: T1, seenAt: LATER };
    t.as('usr_002');
    const page = await t.api.call('chats.messages', { conversationId: room });
    expect(page.seen).toEqual([]);
    expect(page.others).toBe(1);
  });

  it('does not let an agent move the seen time', async () => {
    const { t, direct } = world();
    t.as('usr_006');
    t.store.state.users.usr_006.ownerId = 'usr_003';
    await t.api.call('chats.markRead', { conversationId: direct, seen: true });
    expect(seenAtOf(t, direct, 'usr_003')).toBeUndefined();
  });

  it('answers not_found to an outsider, with no seen data', async () => {
    const { t, direct, group } = world();
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: group, seen: true });
    t.as('usr_004');
    const missing = await failureOf(t.api.call('chats.messages', { conversationId: 'cnv_999' }));
    for (const id of [direct, group]) {
      const error = await failureOf(t.api.call('chats.messages', { conversationId: id }));
      expect(error).toMatchObject({ code: 'not_found' });
      expect(error?.message.replace(id, 'X')).toBe(missing?.message.replace('cnv_999', 'X'));
      expect(JSON.stringify(error)).not.toContain('seen');
      const marked = await failureOf(t.api.call('chats.markRead', { conversationId: id, seen: true }));
      expect(marked).toMatchObject({ code: 'not_found' });
    }
    expect(seenAtOf(t, direct, 'usr_004')).toBeUndefined();
    expect(seenAtOf(t, group, 'usr_004')).toBeUndefined();
  });

  it('changes only the read mark of a task thread with seen: true', async () => {
    const { t } = world();
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: 'tsk_001', seen: true });
    const read = t.store.state.chatReads[chatReadKey('tsk_001', 'usr_003')];
    expect(read).toBeDefined();
    expect(read?.seenAt).toBeUndefined();
  });
});
