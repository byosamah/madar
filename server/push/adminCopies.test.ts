import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { Notification } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { NEW_NOTICES_SQL, NOTICE_EFFECT, noticeRows } from '../mail/notices';
import { PUSH_EFFECT, PUSH_NEW_NOTICES_SQL, pushRows } from './notify';
import { planPushes } from './chatRule';

/**
 * A copy for an Admin who picked "Everything" sends no push and no mail (owner, 2026-10-23). A copy is a notice with "forUserIds". The
 * Postgres texts are checked as text (the database tests need Docker); the SQLite path runs on node:sqlite.
 */

const TODAY = '2026-10-23';
const T = '2026-10-23T09:00:00.000+03:00';
const ADMIN = 'usr_001';
const SARA = 'usr_003';

const notice = (id: string, userId: string, extra: Partial<Notification> = {}): Notification => ({
  id, userId, trigger: 'task_assigned', actorId: 'usr_002', targetType: 'task', targetId: 'tsk_001', read: false, createdAt: T, dedupeKey: null, ...extra,
});

/** An office where Sara got the original and the Admin got the copy (or, for the control, a plain notice). Both have a push device. */
async function office(copy: boolean) {
  const lite = await freshLite();
  const seed: State = await buildSeed(TODAY, async () => undefined);
  seed.pushDevices = {
    pdv_901: { id: 'pdv_901', userId: ADMIN, endpoint: 'https://fcm.googleapis.com/fcm/send/admin', label: 'Mac', createdAt: T, lastPushAt: null },
    pdv_902: { id: 'pdv_902', userId: SARA, endpoint: 'https://fcm.googleapis.com/fcm/send/sara', label: 'Phone', createdAt: T, lastPushAt: null },
  };
  seed.notifications = {
    ntf_901: notice('ntf_901', SARA),
    ntf_902: notice('ntf_902', ADMIN, copy ? { forUserIds: [SARA] } : {}),
  };
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  return lite;
}

const saved = { kinds: new Set(['notifications'] as const), people: new Set([ADMIN, SARA]), noticeIds: ['ntf_901', 'ntf_902'] };

describe('the push producer on SQLite', () => {
  it('gives a push to the person of the original and none to the Admin who got a copy', async () => {
    const lite = await office(true);
    const rows = await lite.db.tx('write', (q) => pushRows(q, saved as never));
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: SARA } }]);
  });

  it('control: the same notice without the copy mark gives a push to the Admin too', async () => {
    const lite = await office(false);
    const rows = await lite.db.tx('write', (q) => pushRows(q, saved as never));
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: ADMIN } }, { kind: PUSH_EFFECT, payload: { userId: SARA } }]);
  });
});

describe('the mail producer on SQLite', () => {
  it('writes one mail row for the original and none for the copy', async () => {
    const lite = await office(true);
    const rows = await lite.db.tx('write', (q) => noticeRows(q, saved as never));
    expect(rows).toEqual([{ kind: NOTICE_EFFECT, payload: { notificationId: 'ntf_901' } }]);
  });

  it('control: without the copy mark the Admin gets a mail row too (task_assigned has the email switch on by default)', async () => {
    const lite = await office(false);
    const rows = await lite.db.tx('write', (q) => noticeRows(q, saved as never));
    expect(rows.map((row) => row.payload)).toEqual([{ notificationId: 'ntf_901' }, { notificationId: 'ntf_902' }]);
  });
});

describe('the Postgres texts skip a copy', () => {
  it('leaves out a notice with forUserIds in the push producer and in the mail producer', () => {
    expect(PUSH_NEW_NOTICES_SQL).toContain("n.doc->'forUserIds' is null");
    expect(NEW_NOTICES_SQL).toContain("n.doc->'forUserIds' is null");
  });
});

describe('the push of a chat message does not follow the Admin choice', () => {
  it('pushes an Admin outside the project only when the message names the Admin, whatever the Admin picked', () => {
    // The facts hold no Admin choice: planPushes reads the stored "Notify me" level of the chat and its default for a project chat.
    const people = [
      { id: ADMIN, kind: 'human' as const, active: true, admin: true, ownerId: null, device: true },
      { id: 'usr_002', kind: 'human' as const, active: true, admin: false, ownerId: null, device: true },
      { id: SARA, kind: 'human' as const, active: true, admin: false, ownerId: null, device: true },
    ];
    const message = (mentions: string[]) => ({
      kind: 'message' as const, id: 'msg_9', chatId: 'cnv_1', chatKind: 'project' as const, memberIds: [], teamIds: ['usr_002', SARA], authorId: 'usr_002', actingForId: 'usr_002', mentions, isNew: true,
    });
    const plain = planPushes({ people, items: [message([])], levels: {}, notices: [], undo: false });
    expect(plain.waited.map((w) => w.userId)).toEqual([]);
    const named = planPushes({ people, items: [message([ADMIN])], levels: {}, notices: [], undo: false });
    expect(named.waited.map((w) => w.userId)).toEqual([ADMIN]);
  });
});
