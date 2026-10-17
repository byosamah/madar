import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { sendNoticeMail, sendQuotaWarning } from '../../mail/notices';
import { outboxMailPort } from '../../mail/outboxDriver';
import { QUOTA_LIMITS, markFirstRefusal, release, reserve, sendCounted, sentToday } from '../../mail/quota';
import { MailSendError } from '../../mail/resend';
import { sendPushNotify } from '../../push/notify';
import { makeVapidKeys } from '../../push/vapid';
import type { Config } from '../../core/ports';
import { fakeDeps } from '../../test/fakes/deps';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const NOW = new Date('2026-10-04T06:00:00Z');
const STAMP = '2026-10-04T09:00:00.000+03:00';
const MAIL = (key: string, text = 'H') => ({ to: 'a@madar.test', subject: 'S', html: `<p>${text}</p>`, text, tag: 'notice', idempotencyKey: key });
const PUSH = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

async function office(edit: (seed: State) => void = () => undefined, config: Partial<Config> = {}) {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db, config });
  deps.clock.set(NOW);
  return { ...lite, seed, deps };
}

describe('the mail quota on SQLite (server/mail/quota.ts)', () => {
  it('reserves the places of the day with no lock, keeps the place of a key, and refuses a notice after the limit', async () => {
    const { db } = await freshLite();
    for (let i = 0; i < QUOTA_LIMITS.notice; i += 1) expect(await db.tx('write', (q) => reserve(q, 'notice', `notice-${i}`, { now: NOW }))).toBe('ok');
    expect(await db.tx('write', (q) => reserve(q, 'notice', 'notice-0', { now: NOW }))).toBe('ok');
    expect(await db.tx('write', (q) => reserve(q, 'notice', 'notice-x', { now: NOW }))).toBe('over');
    expect(await db.tx('write', (q) => reserve(q, 'signin', 'invite-1', { now: NOW }))).toBe('ok');
    expect(await db.tx('read', (q) => sentToday(q, { now: NOW }))).toBe(QUOTA_LIMITS.notice + 1);
  });

  it('marks the first refusal of a day once', async () => {
    const { db } = await freshLite();
    expect(await db.tx('write', (q) => markFirstRefusal(q, { now: NOW }))).toBe(true);
    expect(await db.tx('write', (q) => markFirstRefusal(q, { now: NOW }))).toBe(false);
  });

  it('gives back the place of a mail that never went out', async () => {
    const { db } = await freshLite();
    await db.tx('write', (q) => reserve(q, 'notice', 'notice-1', { now: NOW }));
    await db.tx('write', (q) => release(q, 'notice-1'));
    expect(await db.tx('read', (q) => sentToday(q, { now: NOW }))).toBe(0);
  });

  it('records the Resend id of a sent mail, and keeps the place of a mail that failed', async () => {
    const { db, deps } = await office();
    expect(await sendCounted(deps, 'notice', MAIL('notice-1'))).toEqual({ status: 'sent', id: 'mail_1' });
    expect(await db.statement('read', 'select ref, resend_id from mail_log')).toEqual([{ ref: 'notice-1', resend_id: 'mail_1' }]);
    deps.mail.failNext(new Error('Resend is down.'));
    await expect(sendCounted(deps, 'notice', MAIL('notice-2'))).rejects.toThrow('Resend is down.');
    expect(await db.statement('read', "select ref, resend_id from mail_log where ref = 'notice-2'")).toEqual([{ ref: 'notice-2', resend_id: null }]);
  });
});

describe('the mail effects on SQLite (server/mail/notices.ts)', () => {
  const withNotice = (seed: State) => {
    seed.notifications.ntf_901 = { id: 'ntf_901', userId: 'usr_002', trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_001', read: false, createdAt: STAMP, dedupeKey: null };
  };

  it('sends a notice mail to the person of the notice, read from the users doc, and keeps one place for a second run', async () => {
    const { db, seed, deps } = await office(withNotice);
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent.map((m) => [m.to, m.tag, m.idempotencyKey])).toEqual([
      [seed.users.usr_002.email, 'notice', 'notice-ntf_901'], [seed.users.usr_002.email, 'notice', 'notice-ntf_901'],
    ]);
    expect(await db.tx('read', (q) => sentToday(q, { now: NOW }))).toBe(1);
  });

  it('sends no notice mail to a person who is off by now', async () => {
    const { deps } = await office((seed) => {
      withNotice(seed);
      seed.users.usr_002 = { ...seed.users.usr_002, active: false };
    });
    await sendNoticeMail({ notificationId: 'ntf_901' }, deps);
    expect(deps.mail.sent).toEqual([]);
  });

  it('sends the quota warning only to a person who is still an Admin', async () => {
    const { deps } = await office();
    await sendQuotaWarning({ userId: 'usr_002', day: '2026-10-04' }, deps);
    expect(deps.mail.sent).toEqual([]);
    await sendQuotaWarning({ userId: 'usr_001', day: '2026-10-04' }, deps);
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['quota-warning-2026-10-04-usr_001']);
  });

  it('writes an outbox mail once for a key, and refuses the same key with another mail', async () => {
    const { db } = await freshLite();
    const port = outboxMailPort(db);
    const first = await port.send(MAIL('k1'));
    expect(await port.send(MAIL('k1'))).toEqual(first);
    await expect(port.send(MAIL('k1', 'Other'))).rejects.toBeInstanceOf(MailSendError);
    expect(await db.statement('read', 'select count(*) as n from mail_outbox')).toEqual([{ n: 1 }]);
  });
});

describe('the push effect on SQLite (server/push/notify.ts)', () => {
  it('pushes to each device of an active person with the fetch of deps, marks the sent one and removes the gone one', async () => {
    const keys = await makeVapidKeys();
    const { db, deps } = await office((seed) => {
      seed.pushDevices = {
        pdv_901: { id: 'pdv_901', userId: 'usr_002', endpoint: PUSH('aa'), label: 'Phone', createdAt: STAMP, lastPushAt: null },
        pdv_902: { id: 'pdv_902', userId: 'usr_002', endpoint: PUSH('bb'), label: 'Laptop', createdAt: STAMP, lastPushAt: null },
      };
    }, { push: { ...keys, subject: 'mailto:madar@vado.sa' } });
    const posted: string[] = [];
    deps.pushFetch = (async (input: RequestInfo | URL) => {
      posted.push(String(input));
      return new Response(null, { status: String(input).endsWith('aa') ? 201 : 410 });
    }) as typeof fetch;
    await sendPushNotify({ userId: 'usr_002' }, deps);
    expect(posted.sort()).toEqual([PUSH('aa'), PUSH('bb')]);
    const rows = await db.statement<{ endpoint: string; doc: { lastPushAt: string | null } }>('read', 'select endpoint, doc from push_devices');
    expect(rows.map((row) => [row.endpoint, typeof row.doc.lastPushAt])).toEqual([[PUSH('aa'), 'string']]);
  });
});
