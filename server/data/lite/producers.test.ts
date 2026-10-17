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
async function office() {
  const lite = await freshLite();
  const seed = await buildSeed(TODAY, async () => undefined);
  const prefs = seed.users.usr_002.preferences;
  seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
  seed.pushDevices = {
    pdv_901: { id: 'pdv_901', userId: 'usr_002', endpoint: PUSH('aa'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
    pdv_902: { id: 'pdv_902', userId: 'usr_003', endpoint: PUSH('bb'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
  };
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
function withDirectMessage(seed: State, message: { authorId: string; actingForId: string | null }): State {
  const after = structuredClone(seed);
  after.conversations.cnv_901 = { id: 'cnv_901', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_003'], createdAt: STAMP };
  const base = Object.values(seed.messages)[0];
  after.messages.msg_901 = { ...base, id: 'msg_901', conversationId: 'cnv_901', authorId: message.authorId, actingForId: message.actingForId } as State['messages'][string];
  return after;
}

describe('the mail and push producers on SQLite (server/mail/notices.ts, server/push/notify.ts)', () => {
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

  it('writes a push row for the other reader of a new chat message, never for its author', async () => {
    const { db, seed } = await office();
    const after = withDirectMessage(seed, { authorId: 'usr_002', actingForId: null });
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.notify', payload: { userId: 'usr_003' } }]);
  });

  it('never pushes a message to the person an agent wrote it for', async () => {
    const { db, seed } = await office();
    const after = withDirectMessage(seed, { authorId: 'usr_009', actingForId: 'usr_002' });
    const rows = await db.tx('write', async (q) => pushRows(q, await liteSave(q, seed, after)));
    expect(rows).toEqual([{ kind: 'push.notify', payload: { userId: 'usr_003' } }]);
  });
});
