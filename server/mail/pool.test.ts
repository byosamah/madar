import { describe, expect, it } from 'vitest';
import type { Mail, MailPoolPort } from '../core/ports';
import { statementQuery } from '../data/dialect';
import { freshLite } from '../data/lite/testDb';
import { fixedClock } from '../test/fakes/clock';
import { fakeDeps } from '../test/fakes/deps';
import { fakeMail } from '../test/fakes/mail';
import { quotaLimitsOf } from './limits';
import { poolPlace, QUOTA_LIMITS, reservePlace, sendCounted, sentToday, type QuotaKind } from './quota';

/**
 * Madar enterprises, plan D task 2: the mail pool of the account. The pool answers before the local quota, outside a transaction.
 * A full pool sends nothing and writes no local row. A pool that does not answer stops the mail, and the outbox row waits.
 */

const AT = '2026-11-08T06:00:00Z';
const mailFor = (key: string, tag = 'notice'): Mail => ({ to: 'sara@madar.test', subject: 's', html: '<p>s</p>', text: 's', tag, idempotencyKey: key });

function fakePool(answer: 'ok' | 'full' | Error = 'ok') {
  const calls: { kind: string; day: string; ref: string }[] = [];
  const port: MailPoolPort = {
    async reserve(kind, day, ref) {
      calls.push({ kind, day, ref });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { port, calls };
}

async function office(o: { pool?: MailPoolPort; ent?: string; mailDayLimit?: number } = {}) {
  const lite = await freshLite();
  const deps = fakeDeps({ db: lite.db, config: { ...(o.ent ? { ent: o.ent } : {}), ...(o.mailDayLimit ? { mailDayLimit: o.mailDayLimit } : {}) } });
  deps.clock = fixedClock(AT);
  const mail = fakeMail();
  deps.mail = mail;
  return { lite, deps: { ...deps, mailPool: o.pool }, mail };
}

const rowsOf = (lite: Awaited<ReturnType<typeof freshLite>>) => lite.raw.prepare('select kind, ref from mail_log order by id').all() as { kind: string; ref: string }[];

describe('quotaLimitsOf', () => {
  it('gives 90 and 98 for 100 and keeps QUOTA_LIMITS the same', () => {
    expect(quotaLimitsOf(100)).toEqual({ notice: 90, summary: 90, signin: 98, warning: 98 });
    expect(QUOTA_LIMITS).toEqual(quotaLimitsOf(100));
    expect(quotaLimitsOf(3000)).toEqual({ notice: 2700, summary: 2700, signin: 2998, warning: 2998 });
  });
});

describe('the mail pool in sendCounted', () => {
  it('a full pool sends nothing, writes no local row and marks the first refusal', async () => {
    const pool = fakePool('full');
    const { lite, deps, mail } = await office({ pool: pool.port });
    const first = await sendCounted(deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' });
    expect(first).toEqual({ status: 'over', firstRefusal: true });
    expect(mail.sent).toEqual([]);
    // Only the refusal mark is in the log: no place for the mail.
    expect(rowsOf(lite)).toEqual([{ kind: 'refused', ref: 'quota-refused' }]);
    const second = await sendCounted(deps, 'notice', mailFor('notice-ntf_002'), { userId: 'usr_001' });
    expect(second).toEqual({ status: 'over', firstRefusal: false });
  });

  it('a full pool stops a sign-in mail without a refusal mark', async () => {
    const { lite, deps, mail } = await office({ pool: fakePool('full').port });
    expect(await sendCounted(deps, 'signin', mailFor('invite:inv_1', 'invite'), { userId: 'usr_001' })).toEqual({ status: 'over', firstRefusal: false });
    expect(mail.sent).toEqual([]);
    expect(rowsOf(lite)).toEqual([]);
  });

  it('a pool that throws makes sendCounted throw and sends nothing', async () => {
    const { lite, deps, mail } = await office({ pool: fakePool(new Error('The pool did not answer.')).port });
    await expect(sendCounted(deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' })).rejects.toThrow('The pool did not answer.');
    expect(mail.sent).toEqual([]);
    expect(rowsOf(lite)).toEqual([]);
  });

  it('a retry of the same key asks the pool with the same scoped ref', async () => {
    const pool = fakePool('ok');
    const { deps, mail } = await office({ pool: pool.port, ent: 'ent_002' });
    await sendCounted(deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' });
    await sendCounted(deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' });
    expect(pool.calls.map((c) => c.ref)).toEqual(['ent_002:notice-ntf_001', 'ent_002:notice-ntf_001']);
    expect(pool.calls.map((c) => c.day)).toEqual(['2026-11-08', '2026-11-08']);
    expect(mail.sent.map((m) => m.idempotencyKey)).toEqual(['ent_002:notice-ntf_001', 'ent_002:notice-ntf_001']);
  });

  it('maps notice and summary to notice, sign-in and warning to signin', async () => {
    const pool = fakePool('ok');
    const { deps } = await office({ pool: pool.port });
    const kinds: QuotaKind[] = ['notice', 'summary', 'signin', 'warning'];
    for (const kind of kinds) await sendCounted(deps, kind, mailFor(`k-${kind}`), { userId: 'usr_001' });
    expect(pool.calls.map((c) => c.kind)).toEqual(['notice', 'notice', 'signin', 'signin']);
  });

  it('no mailPool means no pool call and the old behavior (the Postgres path)', async () => {
    const { lite, deps, mail } = await office();
    expect(await sendCounted(deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' })).toMatchObject({ status: 'sent' });
    expect(mail.sent).toHaveLength(1);
    expect(rowsOf(lite)).toEqual([{ kind: 'notice', ref: 'ent_001:notice-ntf_001' }]);
  });

  it('takes the local limits from mailDayLimit', async () => {
    const { lite, deps } = await office({ mailDayLimit: 10 });
    // 10 mails a day: notice mail stops at 9.
    for (let i = 1; i <= 9; i += 1) expect(await sendCounted(deps, 'notice', mailFor(`n${i}`), {})).toMatchObject({ status: 'sent' });
    expect(await sendCounted(deps, 'notice', mailFor('n10'), {})).toMatchObject({ status: 'over' });
    expect(await sentToday(statementQuery(deps.db, 'read'), { now: new Date(AT) })).toBe(9);
    expect(rowsOf(lite)).toHaveLength(10);
  });
});

describe('poolPlace and reservePlace', () => {
  it('poolPlace answers ok with no pool, and over for a full pool', async () => {
    const { deps } = await office();
    expect(await poolPlace(deps, 'signin', 'reset-1')).toBe('ok');
    const full = await office({ pool: fakePool('full').port });
    expect(await poolPlace(full.deps, 'signin', 'reset-1')).toBe('over');
  });

  it('reservePlace takes the pool before the local row', async () => {
    const pool = fakePool('ok');
    const { lite, deps } = await office({ pool: pool.port, ent: 'ent_002' });
    expect(await reservePlace(deps, 'signin', 'invite:inv_1', { userId: 'usr_001' })).toBe('ok');
    expect(pool.calls).toEqual([{ kind: 'signin', day: '2026-11-08', ref: 'ent_002:invite:inv_1' }]);
    expect(rowsOf(lite)).toEqual([{ kind: 'signin', ref: 'ent_002:invite:inv_1' }]);
  });

  it('reservePlace writes no local row when the pool is full', async () => {
    const { lite, deps } = await office({ pool: fakePool('full').port });
    expect(await reservePlace(deps, 'signin', 'invite:inv_1', { userId: 'usr_001' })).toBe('over');
    expect(rowsOf(lite)).toEqual([]);
  });
});
