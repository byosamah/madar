import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { noticeRows } from '../../mail/notices';
import { pushRows } from '../../push/notify';
import { liteSave } from './save';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const TODAY = '2026-10-04';
const STAMP = '2026-10-04T09:00:00.000+03:00';
/** A push address of a real push service, so isPushEndpoint takes it (src/api/contract/push.ts). */
const PUSH = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

/** The sample office on node:sqlite: usr_002 takes the mail of task_assigned, usr_002 and usr_003 have a push device. */
async function office(edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed(TODAY, async () => undefined);
  const prefs = seed.users.usr_002.preferences;
  seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
  seed.pushDevices = {
    pdv_901: { id: 'pdv_901', userId: 'usr_002', endpoint: PUSH('aa'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
    pdv_902: { id: 'pdv_902', userId: 'usr_003', endpoint: PUSH('bb'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
  };
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  lite.log.length = 0;
  return { ...lite, seed };
}

function withNotices(seed: State, notices: { id: string; userId: string; read?: boolean }[]): State {
  const after = structuredClone(seed);
  for (const n of notices) {
    after.notifications[n.id] = {
      id: n.id, userId: n.userId, trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_001',
      read: n.read ?? false, createdAt: STAMP, dedupeKey: null,
    };
  }
  return after;
}

/** A direct chat of usr_002 and usr_003 with one new message. */
function withDirectMessage(seed: State, message: { authorId: string; actingForId: string | null; mentions?: string[] }): State {
  const after = structuredClone(seed);
  after.conversations.cnv_901 = { id: 'cnv_901', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_003'], createdAt: STAMP };
  const base = Object.values(seed.messages)[0];
  after.messages.msg_901 = { ...base, id: 'msg_901', conversationId: 'cnv_901', authorId: message.authorId, actingForId: message.actingForId, mentions: message.mentions ?? [] } as State['messages'][string];
  return after;
}

/** A group with the given people and one new message of usr_002. The group has no project, as a direct chat has none. */
function withGroupMessage(seed: State, memberIds: string[], mentions: string[] = []): State {
  const after = structuredClone(seed);
  after.conversations.cnv_902 = { id: 'cnv_902', kind: 'group', projectId: null, memberIds, name: 'Tower team', makerId: 'usr_002', createdAt: STAMP };
  const base = Object.values(seed.messages)[0];
  after.messages.msg_902 = { ...base, id: 'msg_902', conversationId: 'cnv_902', authorId: 'usr_002', actingForId: 'usr_002', mentions } as State['messages'][string];
  return after;
}

/** A new message of usr_002 in the project chat cnv_001 (prj_001: the leader usr_002 and the team usr_005, usr_006 and usr_008). */
function withProjectMessage(seed: State, mentions: string[]): State {
  const after = structuredClone(seed);
  const base = Object.values(seed.messages)[0];
  after.messages.msg_903 = { ...base, id: 'msg_903', conversationId: 'cnv_001', authorId: 'usr_002', actingForId: 'usr_002', mentions } as State['messages'][string];
  return after;
}

/** A new comment of usr_002 on tsk_001 (its lead is usr_002 in the sample office, and usr_003 after the seed edit of leadByUsr003). */
function withComment(seed: State, extra: Partial<State['comments'][string]> = {}): State {
  const after = structuredClone(seed);
  after.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'Done.', reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: STAMP, editedAt: null, ...extra,
  } as State['comments'][string];
  return after;
}
const leadByUsr003 = (seed: State) => {
  seed.tasks.tsk_001 = { ...seed.tasks.tsk_001, ownerId: 'usr_003' };
};
const deviceFor = (seed: State, userId: string) => {
  (seed.pushDevices ??= {})[`pdv_${userId}`] = { id: `pdv_${userId}`, userId, endpoint: PUSH(userId), label: 'Phone', createdAt: STAMP, lastPushAt: null };
};
const chatNotice = (after: State, userId: string, targetType: 'chat' | 'task', targetId: string, messageId: string) => {
  after.notifications[`ntf_${messageId}`] = {
    id: `ntf_${messageId}`, userId, trigger: 'mention', actorId: 'usr_002', targetType, targetId, messageId, read: false, createdAt: STAMP, dedupeKey: null,
  } as State['notifications'][string];
};

describe('the mail and push producers on SQLite (server/mail/notices.ts, server/push/notify.ts)', () => {
  it('writes a push row for each other member of a group message, and never for its author', async () => {
    const { db, seed } = await office();
    const after = withGroupMessage(seed, ['usr_002', 'usr_003', 'usr_004']);
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'cnv_902', itemId: 'msg_902' }] } }]);
  });

  it('writes no push row for a person with a device who is not in the group', async () => {
    const { db, seed } = await office();
    const after = withGroupMessage(seed, ['usr_002', 'usr_004']);
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([]);
  });

  it('writes one mail row for each new unread notice whose person takes its mail, in the order of the save', async () => {
    const { db, seed, log } = await office();
    const after = withNotices(seed, [{ id: 'ntf_901', userId: 'usr_002' }, { id: 'ntf_902', userId: 'usr_009' }, { id: 'ntf_903', userId: 'usr_002', read: true }]);
    const rows = await db.tx('write', async (q) => noticeRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'mail.notice', payload: { notificationId: 'ntf_901' } }]);
    // No Postgres text ran: the host refuses one, so a pass also proves it.
    expect(log.filter((text) => /\$\d|::[a-z]/i.test(text))).toEqual([]);
  });

  it('writes no mail row and reads no notice for a save with no new notice', async () => {
    const { db, seed, log } = await office();
    const after = structuredClone(seed);
    after.users.usr_003 = { ...after.users.usr_003, discipline: 'Design' };
    expect(await db.tx('write', async (q) => noticeRows(q, await liteSave(q, seed, after)))).toEqual([]);
    expect(log.filter((text) => text.includes('from notifications'))).toEqual([]);
  });

  it('writes one push row for each active human with a device and a new notice', async () => {
    const { db, seed } = await office();
    const after = withNotices(seed, [{ id: 'ntf_901', userId: 'usr_002' }, { id: 'ntf_902', userId: 'usr_004' }]);
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.notify', payload: { userId: 'usr_002' } }]);
  });

  it('writes one push.chat row for the other member of a direct message, with the message as its item', async () => {
    const { db, seed } = await office();
    const after = withDirectMessage(seed, { authorId: 'usr_002', actingForId: null });
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'cnv_901', itemId: 'msg_901' }] } }]);
  });

  it('never pushes a message to the person an agent wrote it for', async () => {
    const { db, seed } = await office();
    const after = withDirectMessage(seed, { authorId: 'usr_009', actingForId: 'usr_002' });
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'cnv_901', itemId: 'msg_901' }] } }]);
  });

  it('writes no row for a group member who picked Only when I am named, and one row when the message names them', async () => {
    const { db, seed } = await office((s) => {
      s.chatReads['cnv_902:usr_003'] = { conversationId: 'cnv_902', userId: 'usr_003', lastReadAt: STAMP, notify: 'named' };
    });
    const plain = withGroupMessage(seed, ['usr_002', 'usr_003']);
    expect(await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, plain)))).toEqual([]);
    const named = withGroupMessage(seed, ['usr_002', 'usr_003'], ['usr_003']);
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, named)));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'cnv_902', itemId: 'msg_902' }] } }]);
  });

  it('pushes a project chat message only to the people it names', async () => {
    // The leader usr_002 wrote it. The Admin usr_001 and the team member usr_005 have a device; usr_006 has none. Only usr_005 is named.
    const { db, seed } = await office((s) => {
      deviceFor(s, 'usr_001');
      deviceFor(s, 'usr_005');
    });
    const after = withProjectMessage(seed, ['usr_005', 'usr_006']);
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_005', items: [{ chatId: 'cnv_001', itemId: 'msg_903' }] } }]);
    expect(await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, withProjectMessage(seed, []))))).toEqual([]);
  });

  it('joins the mention notice of a new message to its push: one push.chat row and no push.notify row', async () => {
    const { db, seed } = await office();
    const after = withDirectMessage(seed, { authorId: 'usr_002', actingForId: null, mentions: ['usr_003'] });
    chatNotice(after, 'usr_003', 'chat', 'cnv_901', 'msg_901');
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'cnv_901', itemId: 'msg_901' }] } }]);
  });

  it('writes a push.chat row for the lead of a task when another person comments, and none for a quiet line', async () => {
    const { db, seed } = await office(leadByUsr003);
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, withComment(seed))));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'tsk_001', itemId: 'cmt_901' }] } }]);
    const line = withComment(seed, { dates: { from: { startDate: null, dueDate: '2026-10-05' }, to: { startDate: null, dueDate: '2026-10-09' } } });
    expect(await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, line)))).toEqual([]);
  });

  it('pushes the author of the comment that a new comment replies to, though the lead wrote the new comment', async () => {
    // The lead of tsk_001 is usr_002, who wrote the new comment, so only the reply link names usr_003.
    const { db, seed } = await office((s) => {
      s.comments.cmt_900 = { ...Object.values(s.comments)[0], id: 'cmt_900', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_003' } as State['comments'][string];
    });
    const after = withComment(seed, { replyToId: 'cmt_900', body: 'Fixed it.' });
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'tsk_001', itemId: 'cmt_901' }] } }]);
  });

  it('gives the comments that a save inserted in commentIds', async () => {
    const { db, seed } = await office(leadByUsr003);
    const saved = await db.tx('write', async (q) => liteSave(q, seed, withComment(seed)));
    expect(saved.commentIds).toEqual(['cmt_901']);
    expect(await db.tx('write', async (q) => (await liteSave(q, seed, structuredClone(seed))).commentIds)).toBeUndefined();
  });
});
