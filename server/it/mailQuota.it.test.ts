import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Mail } from '../core/ports';
import { pgDb, type PgDb } from '../data/sql';
import { outboxMailPort } from '../mail/outboxDriver';
import { markFirstRefusal, reserve, sendCounted, sentToday } from '../mail/quota';
import { fixedClock } from '../test/fakes/clock';
import { fakeMail } from '../test/fakes/mail';
import { applyMigrations, dropSchema, localClient, localDbUrl } from './migrate';

/**
 * Suite 9 of TM 7, the quota and the outbox driver on the local database (plan 5.4; task N2.1), as madar_server with real commits.
 * server/mail/quota.test.ts checks the same rules in memory; this file proves the SQL, above all the parallel reserve() calls.
 * It needs the local stack and the Docker lock.
 */

const SERVER_PASSWORD = 'madar-local-test';
const DAY_START = '2026-10-04T06:00:00Z';
const schema = `madar_n2_mail_${process.pid}`;

let admin: pg.Client;
let serverUrl: string;
const dbs: PgDb[] = [];

/** A pgDb of its own (its own connections), so parallel calls really run in parallel. */
function newDb(): PgDb {
  const db = pgDb({ writeUrl: serverUrl, readUrl: serverUrl });
  dbs.push(db);
  return db;
}

async function fill(kind: string, n: number, day = '2026-10-04') {
  await admin.query(`insert into ${schema}.mail_log (utc_day, kind, ref) select $1::date, $2, $2 || '-fill-' || i from generate_series(1, $3) as i`, [day, kind, n]);
}

const mailFor = (key: string): Mail => ({ to: 'sara@madar.test', subject: 's', html: '<p>s</p>', text: 's', tag: 'notice', idempotencyKey: key });

beforeAll(async () => {
  admin = await localClient();
  await applyMigrations(admin, schema);
  await admin.query(`alter role madar_server login password '${SERVER_PASSWORD}'`);
  const url = new URL(localDbUrl());
  url.username = 'madar_server';
  url.password = SERVER_PASSWORD;
  url.searchParams.set('options', `-c search_path=${schema}`);
  serverUrl = url.toString();
}, 60_000);

beforeEach(async () => {
  await admin.query(`truncate ${schema}.mail_log, ${schema}.mail_outbox`);
});

afterAll(async () => {
  for (const db of dbs) await db.close().catch(() => undefined);
  if (!admin) return;
  await admin.query('alter role madar_server nologin password null');
  await dropSchema(admin, schema);
  await admin.end();
});

describe('suite 9: the email quota on the local database', () => {
  it('gives one ok and one over to two parallel reserve() calls at 89', async () => {
    const now = new Date(DAY_START);
    for (let round = 0; round < 5; round += 1) {
      await admin.query(`truncate ${schema}.mail_log`);
      await fill('notice', 89);
      const [a, b] = [newDb(), newDb()];
      const answers = await Promise.all([
        a.tx('write', (q) => reserve(q, 'notice', `notice-a-${round}`, { now })),
        b.tx('write', (q) => reserve(q, 'notice', `notice-b-${round}`, { now })),
      ]);
      expect(answers.sort()).toEqual(['ok', 'over']);
      const [{ n }] = (await admin.query(`select count(*)::integer as n from ${schema}.mail_log`)).rows;
      expect(n).toBe(90);
    }
  }, 60_000);

  it('lets exactly 5 of 12 parallel notices through at 85', async () => {
    await fill('notice', 85);
    const now = new Date(DAY_START);
    const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => newDb().tx('write', (q) => reserve(q, 'notice', `notice-p-${i}`, { now }))));
    expect(answers.filter((a) => a === 'ok')).toHaveLength(5);
    const db = newDb();
    await expect(db.tx('read', (q) => sentToday(q, { now }))).resolves.toBe(90);
  }, 60_000);

  it('keeps notice 91 in the app with one first refusal, and still sends sign-in mail up to 98', async () => {
    await fill('notice', 90);
    const db = newDb();
    const mail = fakeMail();
    const deps = { db, mail, clock: fixedClock(DAY_START) };
    await expect(sendCounted(deps, 'notice', mailFor('notice-91'))).resolves.toEqual({ status: 'over', firstRefusal: true });
    await expect(sendCounted(deps, 'notice', mailFor('notice-92'))).resolves.toEqual({ status: 'over', firstRefusal: false });
    for (let i = 91; i <= 98; i += 1) await expect(sendCounted(deps, 'signin', mailFor(`invite-${i}`))).resolves.toMatchObject({ status: 'sent' });
    await expect(sendCounted(deps, 'warning', mailFor('quota-warning-usr_001'))).resolves.toEqual({ status: 'over', firstRefusal: false });
    expect(mail.sent).toHaveLength(8);
    const rows = (await admin.query(`select kind, ref, resend_id from ${schema}.mail_log where kind <> 'notice' order by id`)).rows;
    expect(rows[0]).toEqual({ kind: 'refused', ref: 'quota-refused', resend_id: null });
    expect(rows.slice(1).map((r) => r.resend_id)).toEqual(Array.from({ length: 8 }, (_, i) => `mail_${i + 1}`));
    await expect(db.tx('read', (q) => sentToday(q, { now: new Date(DAY_START) }))).resolves.toBe(98);
  }, 60_000);

  it('starts a new count at 03:00 Riyadh (00:00 UTC), and the database day is the UTC day when no time is given', async () => {
    await fill('notice', 90, '2026-10-04');
    const db = newDb();
    await expect(db.tx('write', (q) => reserve(q, 'notice', 'n-late', { now: new Date('2026-10-05T02:59:59+03:00') }))).resolves.toBe('over');
    await expect(db.tx('write', (q) => reserve(q, 'notice', 'n-early', { now: new Date('2026-10-05T03:00:00+03:00') }))).resolves.toBe('ok');
    await expect(db.tx('write', (q) => markFirstRefusal(q, { now: new Date('2026-10-05T03:00:00+03:00') }))).resolves.toBe(true);
    await db.tx('write', (q) => reserve(q, 'signin', 'today-by-db-clock'));
    const [{ same }] = (await admin.query(`select utc_day = (now() at time zone 'utc')::date as same from ${schema}.mail_log where ref = 'today-by-db-clock'`)).rows;
    expect(same).toBe(true);
  }, 60_000);

  it('keeps one place for a ref across retries', async () => {
    const db = newDb();
    const now = new Date(DAY_START);
    await db.tx('write', (q) => reserve(q, 'notice', 'notice-ntf_001', { now, userId: 'usr_002' }));
    await expect(db.tx('write', (q) => reserve(q, 'notice', 'notice-ntf_001', { now, userId: 'usr_002' }))).resolves.toBe('ok');
    expect((await admin.query(`select user_id from ${schema}.mail_log`)).rows).toEqual([{ user_id: 'usr_002' }]);
  });
});

describe('suite 9: the mail outbox driver on the local database', () => {
  it('writes one row for a key, answers a second send with the same row, and refuses the key with another mail', async () => {
    const port = outboxMailPort(newDb());
    const first = await port.send(mailFor('invite-usr_010'));
    await expect(port.send(mailFor('invite-usr_010'))).resolves.toEqual(first);
    await expect(port.send({ ...mailFor('invite-usr_010'), subject: 'other' })).rejects.toMatchObject({ code: 'invalid_idempotent_request' });
    const rows = (await admin.query(`select to_email, tag, idempotency_key, mail from ${schema}.mail_outbox`)).rows;
    expect(rows).toEqual([{ to_email: 'sara@madar.test', tag: 'notice', idempotency_key: 'invite-usr_010', mail: mailFor('invite-usr_010') }]);
  });
});
