import { describe, expect, it } from 'vitest';
import type { Notification } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { NEW_NOTICES_SQL, noticeRows } from './notices';

/**
 * An @everyone notice sends a bell notice and a push, never an email (owner, 2026-10-22, fbk_041): the Resend free plan sends 100 mails a
 * day. A mention by name still sends its mail.
 */
const STAMP = '2026-10-04T09:00:00.000+03:00';
const notice = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, userId: 'usr_002', trigger: 'mention', actorId: 'usr_003', targetType: 'chat', targetId: 'cnv_001', read: false, createdAt: STAMP, dedupeKey: null, messageId: 'msg_001', ...over,
});

describe('the mail rows of an @everyone notice', () => {
  it('reads no everyone notice in the Postgres statement', () => {
    expect(NEW_NOTICES_SQL).toContain("n.doc->'everyone' is null");
  });

  it('writes a mail row for a mention by name and none for an @everyone notice (SQLite)', async () => {
    const lite = await freshLite();
    const seed = await buildSeed('2026-10-04', async () => undefined);
    const edit = (state: State) => {
      state.notifications.ntf_901 = notice('ntf_901');
      state.notifications.ntf_902 = notice('ntf_902', { userId: 'usr_004', everyone: true });
      state.notifications.ntf_903 = notice('ntf_903', { userId: 'usr_005', messageId: 'msg_002' });
    };
    edit(seed);
    await lite.db.tx('write', (q) => liteWriteState(q, seed));
    const rows = await lite.db.tx('write', (q) => noticeRows(q, { kinds: new Set(['notifications']), people: new Set(['usr_002', 'usr_004', 'usr_005']), noticeIds: ['ntf_901', 'ntf_902', 'ntf_903'] }));
    expect(rows.map((row) => row.payload)).toEqual([{ notificationId: 'ntf_901' }, { notificationId: 'ntf_903' }]);
  });
});
