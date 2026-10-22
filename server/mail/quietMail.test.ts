import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';
import { memoryMailDb } from './memoryMailDb';
import { ADMINS_SQL, NOTICE_MAIL_LITE, NOTICE_MAIL_SQL, NOTICE_UNREAD_SQL, sendChatNoticeMail, sendNoticeMail } from './notices';
import { sentToday } from './quota';
import { defaultPreferences } from '../../src/api/contract/entities';

/**
 * Quiet hours in the notice mail (owner, 2026-10-22, fbk_048). A person in quiet hours gets no mail at send time: the row ends as done, the
 * mail never goes later, and no place of the day quota is taken. The test uses a real SQLite office and the memory database of the mail tests.
 */

/** Sunday 2026-10-04: 06:00Z is 09:00 in Riyadh (work), 16:00Z is 19:00 (quiet). */
const MORNING = new Date('2026-10-04T06:00:00Z');
const EVENING = new Date('2026-10-04T16:00:00Z');
const STAMP = '2026-10-04T09:00:00.000+03:00';

async function office(at: Date, edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  seed.notifications.ntf_901 = { id: 'ntf_901', userId: 'usr_002', trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_001', read: false, createdAt: STAMP, dedupeKey: null };
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(at);
  return { ...lite, seed, deps };
}

describe('the notice mail in quiet hours (SQLite)', () => {
  it('sends the mail in work hours', async () => {
    const { deps } = await office(MORNING);
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['notice-ntf_901']);
  });

  it('sends no mail in quiet hours, takes no place of the quota, and sends none later either', async () => {
    const { deps, db } = await office(EVENING);
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent).toEqual([]);
    expect(await db.tx('read', (q) => sentToday(q, { now: EVENING }))).toBe(0);
    expect(await db.statement('read', 'select count(*) as n from mail_log')).toEqual([{ n: 0 }]);
  });

  it('sends no mail on Friday, in the office default hours', async () => {
    const { deps } = await office(new Date('2026-10-09T06:00:00Z'));
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent).toEqual([]);
  });

  it('sends the mail in the evening to a person who turned quiet hours off', async () => {
    const { deps } = await office(EVENING, (seed) => {
      seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...seed.users.usr_002.preferences, workHours: { quiet: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } } };
    });
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent).toHaveLength(1);
  });

  it('sends the mail in the evening when the lock holds the evening', async () => {
    const { deps } = await office(EVENING, (seed) => {
      seed.settings = { ...seed.settings, workHours: { days: [0, 1, 2, 3, 4], from: '09:00', to: '21:00', lock: { on: true, days: [0, 1, 2, 3, 4], from: '09:00', to: '21:00' } } };
    });
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent).toHaveLength(1);
  });

  it('holds the mention mail of a chat after its wait too (mail.chatNotice)', async () => {
    const { deps } = await office(EVENING);
    await sendChatNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent).toEqual([]);
  });
});

describe('the notice mail in quiet hours (the Postgres statements)', () => {
  const person = { trigger: 'task_assigned', user_id: 'usr_002', kind: 'human', active: true, email: 'a@madar.test', gender: null };

  function setup(workHours: object | undefined) {
    const mem = memoryMailDb((text) => {
      if (text === NOTICE_UNREAD_SQL) return [{ id: 'ntf_1' }];
      if (text === NOTICE_MAIL_SQL) return [{ ...person, id: 'ntf_1', preferences: { ...defaultPreferences(), ...(workHours ? { workHours } : {}) }, office: null }];
      if (text === ADMINS_SQL) return [];
      return undefined;
    });
    const deps = fakeDeps({ db: mem.db, config: { appUrl: 'https://madar.test' } });
    deps.clock.set(EVENING);
    return { mem, deps };
  }

  it('reads the work hours with the statement of the notice (no statement of their own), and reserves no place when the person is quiet', async () => {
    const { mem, deps } = setup(undefined);
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(deps.mail.sent).toEqual([]);
    expect(mem.log).toEqual([]);
    expect(mem.statements).toEqual([NOTICE_MAIL_SQL]);
  });

  it('sends the mail to a person who turned quiet hours off', async () => {
    const { mem, deps } = setup({ quiet: false, days: [0], from: '09:00', to: '10:00' });
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(deps.mail.sent).toHaveLength(1);
    expect(mem.log).toHaveLength(1);
  });

  it('follows the office work hours of the same statement', async () => {
    const { mem, deps } = setup(undefined);
    const original = mem.db.statement;
    mem.db.statement = (async (mode: 'read' | 'write', text: string, values?: unknown[]) => {
      const rows = (await original(mode, text, values)) as { office?: unknown }[];
      return text === NOTICE_MAIL_SQL ? rows.map((row) => ({ ...row, office: { days: [0], from: '09:00', to: '21:00', lock: { on: true, days: [0], from: '09:00', to: '21:00' } } })) : rows;
    }) as never;
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    // 19:00 on a Sunday is inside the lock of this office.
    expect(deps.mail.sent).toHaveLength(1);
  });

  it('keeps the office hours column in both texts of the statement', () => {
    expect(NOTICE_MAIL_SQL).toContain("s.id = 'office'");
    expect(NOTICE_MAIL_LITE).toContain("s.id = 'office'");
  });
});
