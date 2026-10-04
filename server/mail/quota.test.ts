import { describe, expect, it } from 'vitest';
import type { Db, Mail, Query } from '../core/ports';
import { fixedClock } from '../test/fakes/clock';
import { fakeMail } from '../test/fakes/mail';
import {
  MAIL_LOCK_KEY,
  MAIL_LOCK_SQL,
  QUOTA_LIMITS,
  RECORD_SENT_SQL,
  REFUSAL_MARK_SQL,
  RESERVE_SQL,
  SENT_TODAY_SQL,
  markFirstRefusal,
  reserve,
  sendCounted,
  sentToday,
  utcDay,
} from './quota';

/**
 * The email quota (plan 2 change 9, 5.4; task N2.1). A small mail_log in memory answers the exported statements, so these tests
 * check the rules; server/it/mailQuota.it.test.ts runs the same statements on the local database, with parallel reserve() calls.
 */

type LogRow = { utc_day: string; kind: string; user_id: string | null; ref: string; resend_id: string | null };
const SENDING = ['notice', 'summary', 'signin', 'warning'];

function memoryMailLog() {
  const rows: LogRow[] = [];
  const statements: string[] = [];
  const dayOf = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('The unit tests always pass the UTC day.');
    return value;
  };
  const q = (async (text: string, values: unknown[] = []) => {
    statements.push(text);
    if (text === MAIL_LOCK_SQL) return [{}];
    if (text === RESERVE_SQL) {
      const [day, kind, userId, ref, limit] = values as [string, string, string | null, string, number];
      const today = rows.filter((r) => r.utc_day === dayOf(day));
      const mine = today.some((r) => r.ref === ref);
      const n = today.filter((r) => SENDING.includes(r.kind)).length;
      if (!mine && n < limit) rows.push({ utc_day: day, kind, user_id: userId, ref, resend_id: null });
      return [{ ok: mine || n < limit }];
    }
    if (text === REFUSAL_MARK_SQL) {
      const day = dayOf(values[0]);
      if (rows.some((r) => r.utc_day === day && r.ref === 'quota-refused')) return [];
      rows.push({ utc_day: day, kind: 'refused', user_id: null, ref: 'quota-refused', resend_id: null });
      return [{ id: rows.length }];
    }
    if (text === SENT_TODAY_SQL) return [{ n: rows.filter((r) => r.utc_day === dayOf(values[0]) && SENDING.includes(r.kind)).length }];
    if (text === RECORD_SENT_SQL) {
      const [day, ref, id] = values as [string, string, string];
      for (const row of rows) if (row.utc_day === day && row.ref === ref) row.resend_id = id;
      return [];
    }
    throw new Error(`Not a quota statement: ${text}`);
  }) as Query;
  const db: Db = {
    tx: (_mode, work) => work(q),
    savepoint: (_q, work) => work(q),
    statement: (_mode, text, values) => q(text, values),
  };
  return { rows, statements, q, db };
}

const BEFORE_3_RIYADH = '2026-10-04T23:59:59Z';
const AT_3_RIYADH = '2026-10-05T00:00:00Z';

function setup(at = '2026-10-04T06:00:00Z') {
  const log = memoryMailLog();
  const mail = fakeMail();
  const clock = fixedClock(at);
  return { log, mail, clock, deps: { db: log.db, mail, clock } };
}

const mailFor = (key: string): Mail => ({ to: 'sara@madar.test', subject: 's', html: '<p>s</p>', text: 's', tag: 'notice', idempotencyKey: key });

describe('the UTC day, as Resend counts it', () => {
  it('starts at 00:00 UTC, which is 03:00 Riyadh', () => {
    expect(utcDay(new Date(BEFORE_3_RIYADH))).toBe('2026-10-04');
    expect(utcDay(new Date(AT_3_RIYADH))).toBe('2026-10-05');
    expect(utcDay(new Date('2026-10-05T02:30:00+03:00'))).toBe('2026-10-04');
  });

  it('stops notices and summaries at 90, sign-in mail and warnings at a hard stop of 98', () => {
    expect(QUOTA_LIMITS).toEqual({ notice: 90, summary: 90, signin: 98, warning: 98 });
  });
});

describe('reserve()', () => {
  it('takes the mail lock first, then counts and adds the row in one statement', async () => {
    const { log } = setup();
    await expect(reserve(log.q, 'notice', 'notice-ntf_001', { now: new Date('2026-10-04T06:00:00Z'), userId: 'usr_002' })).resolves.toBe('ok');
    expect(log.statements).toEqual([MAIL_LOCK_SQL, RESERVE_SQL]);
    expect(MAIL_LOCK_KEY).toHaveLength(2);
    expect(log.rows).toEqual([{ utc_day: '2026-10-04', kind: 'notice', user_id: 'usr_002', ref: 'notice-ntf_001', resend_id: null }]);
  });

  it('answers ok again for a ref it already holds today, without a second count (a retry after a failed send)', async () => {
    const { log } = setup();
    const now = new Date('2026-10-04T06:00:00Z');
    await reserve(log.q, 'notice', 'notice-ntf_001', { now });
    await expect(reserve(log.q, 'notice', 'notice-ntf_001', { now })).resolves.toBe('ok');
    expect(log.rows).toHaveLength(1);
  });
});

describe('sendCounted()', () => {
  it('sends 90 notices; notice 91 stays in the app and is the first refusal of the day, so it makes one Admin warning', async () => {
    const { deps, mail } = setup();
    for (let i = 1; i <= 90; i += 1) await expect(sendCounted(deps, 'notice', mailFor(`notice-${i}`))).resolves.toMatchObject({ status: 'sent' });
    await expect(sendCounted(deps, 'notice', mailFor('notice-91'))).resolves.toEqual({ status: 'over', firstRefusal: true });
    await expect(sendCounted(deps, 'notice', mailFor('notice-92'))).resolves.toEqual({ status: 'over', firstRefusal: false });
    await expect(sendCounted(deps, 'summary', mailFor('summary-usr_002'))).resolves.toEqual({ status: 'over', firstRefusal: false });
    expect(mail.sent).toHaveLength(90);
  });

  it('still sends an invitation and the Admin warning after 90 notices, up to the hard stop of 98', async () => {
    const { deps, mail } = setup();
    for (let i = 1; i <= 90; i += 1) await sendCounted(deps, 'notice', mailFor(`notice-${i}`));
    await expect(sendCounted(deps, 'signin', mailFor('invite-usr_010'))).resolves.toMatchObject({ status: 'sent' });
    await expect(sendCounted(deps, 'warning', mailFor('quota-warning-usr_001'))).resolves.toMatchObject({ status: 'sent' });
    for (let i = 3; i <= 8; i += 1) await expect(sendCounted(deps, 'signin', mailFor(`reset-${i}`))).resolves.toMatchObject({ status: 'sent' });
    // 98 emails today: the 99th does not go, and a refused sign-in mail never makes a quota warning.
    await expect(sendCounted(deps, 'signin', mailFor('reset-99'))).resolves.toEqual({ status: 'over', firstRefusal: false });
    expect(mail.sent).toHaveLength(98);
  });

  it('counts notices and summaries together toward 90', async () => {
    const { deps } = setup();
    for (let i = 1; i <= 89; i += 1) await sendCounted(deps, 'notice', mailFor(`notice-${i}`));
    await expect(sendCounted(deps, 'summary', mailFor('summary-usr_002'))).resolves.toMatchObject({ status: 'sent' });
    await expect(sendCounted(deps, 'summary', mailFor('summary-usr_003'))).resolves.toEqual({ status: 'over', firstRefusal: true });
  });

  it('starts a new count at 03:00 Riyadh', async () => {
    const { deps, clock } = setup(BEFORE_3_RIYADH);
    for (let i = 1; i <= 90; i += 1) await sendCounted(deps, 'notice', mailFor(`notice-${i}`));
    await expect(sendCounted(deps, 'notice', mailFor('notice-late'))).resolves.toEqual({ status: 'over', firstRefusal: true });
    clock.set(AT_3_RIYADH);
    await expect(sendCounted(deps, 'notice', mailFor('notice-early'))).resolves.toMatchObject({ status: 'sent' });
    await expect(sendCounted(deps, 'notice', mailFor('notice-late'))).resolves.toMatchObject({ status: 'sent' });
  });

  it('keeps the place of a failed send, so the retry with the same key sends without a second count', async () => {
    const { deps, mail, log } = setup();
    mail.failNext(new Error('Resend could not be reached.'));
    await expect(sendCounted(deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_002' })).rejects.toThrow(/reached/);
    await expect(sendCounted(deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_002' })).resolves.toEqual({ status: 'sent', id: 'mail_1' });
    expect(log.rows).toEqual([{ utc_day: '2026-10-04', kind: 'notice', user_id: 'usr_002', ref: 'notice-ntf_001', resend_id: 'mail_1' }]);
  });

  it('records the Resend id of each mail it sent', async () => {
    const { deps, log } = setup();
    await sendCounted(deps, 'signin', mailFor('invite-usr_010'));
    expect(log.rows.map((r) => r.resend_id)).toEqual(['mail_1']);
  });
});

describe('the counts of a day', () => {
  it('count the four kinds that send, never the refusal mark', async () => {
    const { deps, log } = setup();
    const now = new Date('2026-10-04T06:00:00Z');
    for (let i = 1; i <= 91; i += 1) await sendCounted(deps, 'notice', mailFor(`notice-${i}`));
    await expect(sentToday(log.q, { now })).resolves.toBe(90);
    await expect(markFirstRefusal(log.q, { now })).resolves.toBe(false);
  });
});
