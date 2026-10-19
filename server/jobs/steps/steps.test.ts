import { afterEach, describe, expect, it } from 'vitest';
import { defaultPreferences } from '../../../src/api/contract/entities';
import { runScheduledTriggers } from '../../../src/api/notify';
import { makeTask, makeWorld, NOW as WORLD_NOW } from '../../../src/test/factories';
import { registerEffect } from '../../core/effects';
import type { Db } from '../../core/ports';
import { OFFICE_DELETES_KEEP_DAYS } from '../../data/officeCache';
import { KEYS_IN_USE_SQL } from '../../files/effects';
import { memoryMailDb } from '../../mail/memoryMailDb';
import { USER_MAIL_SQL } from '../../mail/notices';
import { MailSendError } from '../../mail/resend';
import { SUMMARY_COUNTS_SQL, SUMMARY_PEOPLE_SQL, SUMMARY_TASKS_SQL } from '../../mail/summary';
import { fakeDeps } from '../../test/fakes/deps';
import { IDEMPOTENCY_CLEANUP_SQL, OFFICE_DELETES_CLEANUP_SQL, RATE_LIMITS_CLEANUP_SQL, STORIES_CLEANUP_SQL, cleanup } from './cleanup';
import { HEARTBEAT_SQL, heartbeat } from './heartbeat';
import { OUTBOX_BATCH, OUTBOX_DUE_SQL, OUTBOX_MAX_ATTEMPTS, outboxRetry } from './outbox';
import { SUMMARY_DONE_SQL, SUMMARY_MARK_SQL, SUMMARY_SENT_SQL, summary, summaryDay } from './summary';
import { meetings, SETTLE_SQL } from './meetings';
import { USED_DEDUPE_SQL, usedDedupeKeys } from './triggers';
import { INTENTS_DELETE_SQL, INTENT_KEEP_MS, OLD_INTENTS_SQL, STAGING_KEEP_MS, UPLOADS_BATCH, uploads } from './uploads';

/**
 * The steps of the 15-minute job (plan 5.5; task N3.1) on a small database in memory that answers their SQL.
 * server/it/jobs.it.test.ts runs the same steps on the local database and the local Storage.
 */

const AT = new Date('2026-10-04T06:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(AT.getTime() - ms);

type Call = { text: string; values: unknown[] };

/** The memory database, every statement it answers with its values, and the modes of its transactions. */
function recorder(answer: (text: string, values: unknown[]) => unknown[] | undefined = () => undefined) {
  const calls: Call[] = [];
  const mem = memoryMailDb((text, values) => {
    calls.push({ text, values });
    return answer(text, values);
  });
  const txs: string[] = [];
  const db: Db = { ...mem.db, tx: (mode, work) => (txs.push(mode), mem.db.tx(mode, work)) };
  return { mem, db, calls, txs, valuesOf: (text: string) => calls.filter((c) => c.text === text).map((c) => c.values) };
}

let undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo) u();
  undo = [];
});

describe('step 0, the heartbeat', () => {
  it('writes the job_runs row "heartbeat" with the time of the run, in one statement', async () => {
    const r = recorder(() => []);
    await heartbeat(fakeDeps({ db: r.db }), AT);
    expect(r.calls).toEqual([{ text: HEARTBEAT_SQL, values: [AT] }]);
    expect(HEARTBEAT_SQL).toContain("'heartbeat'");
    // Two runs that overlap never move the heartbeat back.
    expect(HEARTBEAT_SQL).toContain('greatest');
  });
});

describe('step 1, the dedupe lookup of the scheduled triggers', () => {
  it('asks the database only for the keys this run would use, and gives back the ones a notice already holds', async () => {
    const state = makeWorld();
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', dueDate: '2026-10-01' });
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', dueDate: '2026-09-28', status: 'in_progress' });
    const asked: string[] = [];
    runScheduledTriggers(structuredClone(state), WORLD_NOW, { dedupeUsed: (key) => (asked.push(key), false) });
    expect(asked.length).toBeGreaterThan(1);
    const before = structuredClone(state);
    const r = recorder((text, values) => (text === USED_DEDUPE_SQL ? [{ dedupe_key: (values[0] as string[])[0] }] : undefined));
    const used = await usedDedupeKeys(r.mem.q, state, WORLD_NOW);
    expect(r.valuesOf(USED_DEDUPE_SQL)).toEqual([[[...asked].sort()]]);
    expect([...used]).toEqual([[...asked].sort()[0]]);
    // The probe runs on a copy: the State of the run is untouched.
    expect(state).toEqual(before);
  });

  it('asks nothing when no trigger is due', async () => {
    const state = makeWorld();
    state.tasks = {};
    const r = recorder();
    expect([...(await usedDedupeKeys(r.mem.q, state, WORLD_NOW))]).toEqual([]);
    expect(r.calls).toEqual([]);
  });
});

describe('step 1b, the meetings that ended (fbk_022, wave 2)', () => {
  it('asks for the meetings of the last 14 days that ended, with the stamp of the run and the stamp 14 days before it, in office time', async () => {
    const r = recorder((text) => (text === SETTLE_SQL ? [] : undefined));
    const report = await meetings(fakeDeps({ db: r.db }), AT);
    expect(report).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 0 });
    // 06:00 UTC is 09:00 in Riyadh.
    expect(r.valuesOf(SETTLE_SQL)).toEqual([['2026-10-04T09:00:00.000+03:00', '2026-09-20T09:00:00.000+03:00']]);
    // One statement, and no office read, no transaction and no call when nothing is due.
    expect(r.calls).toHaveLength(1);
    expect(r.txs).toEqual([]);
  });
});

describe('step 2, the morning summary', () => {
  const person = (id: string, more: Record<string, unknown> = {}) => ({ user_id: id, kind: 'human', active: true, email: `${id}@madar.test`, preferences: defaultPreferences(), gender: null, ...more });

  function setup() {
    const marks = new Set<string>();
    const people = new Map([['usr_a', person('usr_a')], ['usr_b', person('usr_b')], ['usr_c', person('usr_c')]]);
    const counts: Record<string, { due_today: number; reviews_waiting: number }> = {
      usr_a: { due_today: 2, reviews_waiting: 1 }, usr_b: { due_today: 0, reviews_waiting: 0 }, usr_c: { due_today: 1, reviews_waiting: 0 },
    };
    const r = recorder((text, values) => {
      if (text === SUMMARY_DONE_SQL) return marks.has(values[0] as string) ? [{ done_at: AT }] : [];
      if (text === SUMMARY_MARK_SQL) return (marks.add(values[0] as string), []);
      if (text === SUMMARY_PEOPLE_SQL) return [...people.keys()].map((id) => ({ id }));
      if (text === SUMMARY_SENT_SQL) {
        const refs = values[0] as string[];
        return r.mem.log.filter((row) => refs.includes(row.ref) && row.resend_id !== null).map((row) => ({ ref: row.ref }));
      }
      if (text === USER_MAIL_SQL) return [people.get(values[0] as string)].filter(Boolean);
      if (text === SUMMARY_COUNTS_SQL) return [counts[values[0] as string]];
      // The open tasks (fbk_021): usr_a and usr_c have one task due today, usr_b has none.
      if (text === SUMMARY_TASKS_SQL) {
        return values[0] === 'usr_b' ? [] : [{ id: `tsk_${values[0]}`, title: 'Check the setback', due_date: '2026-10-04', rank: null, project_code: '260902AZT-RES-Villa' }];
      }
      return undefined;
    });
    const deps = fakeDeps({ db: r.db, config: { appUrl: 'https://madar.test' } });
    return { r, deps, marks };
  }

  it('is due from 07:30 Riyadh on a working day (Sunday to Thursday), and never on Friday or Saturday', () => {
    expect(summaryDay(new Date('2026-10-04T04:29:00Z'))).toBeNull(); // Sunday 07:29
    expect(summaryDay(new Date('2026-10-04T04:30:00Z'))).toBe('2026-10-04'); // Sunday 07:30
    expect(summaryDay(new Date('2026-10-01T20:59:00Z'))).toBe('2026-10-01'); // Thursday 23:59
    expect(summaryDay(new Date('2026-10-02T06:00:00Z'))).toBeNull(); // Friday
    expect(summaryDay(new Date('2026-10-03T06:00:00Z'))).toBeNull(); // Saturday
  });

  it('sends nothing and reads nothing before 07:30 or on a day off', async () => {
    for (const at of [new Date('2026-10-04T04:29:00Z'), new Date('2026-10-02T06:00:00Z')]) {
      const { r, deps } = setup();
      expect(await summary(deps, at)).toEqual({ due: false });
      expect(r.calls).toEqual([]);
      expect(deps.mail.sent).toEqual([]);
    }
  });

  it('mails each person with something to say once at 07:30, writes summary:<day>, and a second run sends nothing new', async () => {
    const { r, deps, marks } = setup();
    const at = new Date('2026-10-04T04:30:00Z');
    deps.clock.set(at);
    expect(await summary(deps, at)).toEqual({ due: true, day: '2026-10-04', sent: 2, empty: 1, over: 0, skipped: 0, refused: 0, already: 0 });
    expect(deps.mail.sent.map((m) => [m.to, m.idempotencyKey])).toEqual([
      ['usr_a@madar.test', 'summary-2026-10-04-usr_a'],
      ['usr_c@madar.test', 'summary-2026-10-04-usr_c'],
    ]);
    expect([...marks]).toEqual(['summary:2026-10-04']);
    expect(r.valuesOf(SUMMARY_MARK_SQL)).toEqual([['summary:2026-10-04', at]]);
    expect(await summary(deps, new Date('2026-10-04T04:45:00Z'))).toEqual({ due: true, day: '2026-10-04', done: true });
    expect(deps.mail.sent).toHaveLength(2);
  });

  it('keeps the day open when a send fails, and the next run sends only to the people who did not get it', async () => {
    const { deps, marks } = setup();
    const at = new Date('2026-10-04T04:30:00Z');
    deps.clock.set(at);
    deps.mail.failNext(new Error('Resend is down.'));
    await expect(summary(deps, at)).rejects.toThrow('The morning summary did not reach 1 person. The next run tries again.');
    expect(marks.size).toBe(0);
    expect(deps.mail.sent.map((m) => m.to)).toEqual(['usr_c@madar.test']);
    expect(await summary(deps, new Date('2026-10-04T04:45:00Z'))).toEqual({ due: true, day: '2026-10-04', sent: 1, empty: 1, over: 0, skipped: 0, refused: 0, already: 1 });
    expect(deps.mail.sent.map((m) => m.to)).toEqual(['usr_c@madar.test', 'usr_a@madar.test']);
    expect([...marks]).toEqual(['summary:2026-10-04']);
  });

  it('closes the day when Resend refuses a send for good (not retryable), warns, and the next run sends nothing to that person', async () => {
    const { deps, marks } = setup();
    const at = new Date('2026-10-04T04:30:00Z');
    deps.clock.set(at);
    deps.mail.failNext(new MailSendError('You can only send testing emails to your own email address.', { status: 403, code: 'validation_error', retryable: false }));
    expect(await summary(deps, at)).toEqual({ due: true, day: '2026-10-04', sent: 1, empty: 1, over: 0, skipped: 0, refused: 1, already: 0 });
    expect([...marks]).toEqual(['summary:2026-10-04']);
    expect(deps.logs.filter((l) => l.level === 'warn')).toEqual([{ level: 'warn', message: expect.any(String), fields: { userId: 'usr_a', code: 'validation_error', status: 403 } }]);
    expect(await summary(deps, new Date('2026-10-04T04:45:00Z'))).toEqual({ due: true, day: '2026-10-04', done: true });
    expect(deps.mail.sent.map((m) => m.to)).toEqual(['usr_c@madar.test']);
  });

  it('keeps the day open when Resend fails with a retryable error (a 429 or a 5xx)', async () => {
    const { deps, marks } = setup();
    const at = new Date('2026-10-04T04:30:00Z');
    deps.clock.set(at);
    deps.mail.failNext(new MailSendError('Too many requests.', { status: 429, code: 'rate_limit_exceeded', retryable: true }));
    await expect(summary(deps, at)).rejects.toThrow('The morning summary did not reach 1 person. The next run tries again.');
    expect(marks.size).toBe(0);
  });
});

describe('step 3, the outbox retry', () => {
  it('runs the open rows that are older than 2 minutes with fewer than 5 attempts, through the claim of plan 4.12', async () => {
    const ran: unknown[] = [];
    undo.push(registerEffect('test.jobs', async (payload) => {
      if (payload.fail) throw new Error('Still down.');
      ran.push(payload.n);
    }));
    const r = recorder((text) => (text === OUTBOX_DUE_SQL ? r.mem.outbox.filter((row) => !row.done).map((row) => ({ id: row.id })) : undefined));
    for (const payload of [{ n: 1 }, { n: 2, fail: true }, { n: 3 }]) r.mem.outbox.push({ id: r.mem.outbox.length + 1, kind: 'test.jobs', payload, done: false, claimed: false, attempts: 1, error: 'x' });
    const deps = fakeDeps({ db: r.db });
    expect(await outboxRetry(deps)).toEqual({ due: 3, done: 2, failed: 1 });
    expect(ran).toEqual([1, 3]);
    expect(r.valuesOf(OUTBOX_DUE_SQL)).toEqual([[OUTBOX_MAX_ATTEMPTS, OUTBOX_BATCH]]);
    expect(OUTBOX_MAX_ATTEMPTS).toBe(5);
    expect(OUTBOX_DUE_SQL).toContain("interval '2 minutes'");
  });

  it('claims nothing when no row is due', async () => {
    const r = recorder((text) => (text === OUTBOX_DUE_SQL ? [] : undefined));
    expect(await outboxRetry(fakeDeps({ db: r.db }))).toEqual({ due: 0, done: 0, failed: 0 });
  });
});

describe('step 4, the cleanup', () => {
  it('deletes stories after 7 days, idempotency keys after 24 hours, office_deletes after OFFICE_DELETES_KEEP_DAYS, rate limits after 1 day', async () => {
    const answers = new Map<string, number>([[STORIES_CLEANUP_SQL, 1], [IDEMPOTENCY_CLEANUP_SQL, 2], [OFFICE_DELETES_CLEANUP_SQL, 3], [RATE_LIMITS_CLEANUP_SQL, 4]]);
    const r = recorder((text) => (answers.has(text) ? [{ n: answers.get(text) }] : undefined));
    expect(await cleanup(fakeDeps({ db: r.db }), AT)).toEqual({ stories: 1, idempotency: 2, officeDeletes: 3, rateLimits: 4 });
    expect(r.calls).toEqual([
      { text: STORIES_CLEANUP_SQL, values: [ago(7 * DAY)] },
      { text: IDEMPOTENCY_CLEANUP_SQL, values: [ago(DAY)] },
      { text: OFFICE_DELETES_CLEANUP_SQL, values: [ago(OFFICE_DELETES_KEEP_DAYS * DAY)] },
      { text: RATE_LIMITS_CLEANUP_SQL, values: [ago(DAY)] },
    ]);
    expect(OFFICE_DELETES_KEEP_DAYS).toBe(7);
    expect(r.txs).toEqual(['write']);
  });
});

describe('step 5, the upload leftovers (proof.md, Z0a item 6)', () => {
  type IntentRow = { id: string; project_id: string | null; staging_key: string; key: string; thumb_key: string | null; expires_at: Date; used_at: Date | null; created_at: Date };
  const intent = (n: string, o: { used: boolean; age: number; usedAge?: number; thumb?: boolean; feedback?: boolean }): IntentRow => {
    const created = ago(o.age);
    return {
      id: `upl_${n}`, project_id: o.feedback ? null : 'prj_001', staging_key: `up/upl-${n}/file`,
      key: o.feedback ? `feedback/upl-${n}/file` : `prj-001/upl-${n}/file`, thumb_key: o.thumb ? `prj-001/upl-${n}/thumb` : null,
      expires_at: new Date(created.getTime() + 2 * HOUR), used_at: o.used ? (o.usedAge === undefined ? new Date(created.getTime() + 60_000) : ago(o.usedAge)) : null, created_at: created,
    };
  };

  function setup(rows: IntentRow[], inUse: string[] = []) {
    const deleted: string[] = [];
    const r = recorder((text, values) => {
      if (text === OLD_INTENTS_SQL) {
        const [cutoff, after, limit] = values as [Date, string, number];
        return rows
          .filter((row) => row.created_at.getTime() <= cutoff.getTime() && row.id > after)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .slice(0, limit);
      }
      if (text === KEYS_IN_USE_SQL) return (values[0] as string[]).filter((key) => inUse.includes(key)).map((key) => ({ key }));
      if (text === INTENTS_DELETE_SQL) {
        const gone = rows.filter((row) => (values[0] as string[]).includes(row.id) && (row.used_at ?? row.created_at).getTime() < (values[1] as Date).getTime());
        deleted.push(...gone.map((row) => row.id));
        return gone.map((row) => ({ id: row.id }));
      }
      return undefined;
    });
    const deps = fakeDeps({ db: r.db });
    const put = (key: string) => deps.files.objects.set(key, { size: 10, mimeType: 'application/pdf' });
    for (const row of rows) {
      put(row.staging_key);
      put(row.staging_key.replace(/\/file$/, '/thumb'));
      put(row.key);
      if (row.thumb_key) put(row.thumb_key);
    }
    return { r, deps, deleted, has: (key: string) => deps.files.objects.has(key) };
  }

  it('deletes every up/ object older than 2 hours 10 minutes through the FilesPort, for used and unused intents alike', async () => {
    const used = intent('used', { used: true, age: 3 * HOUR, thumb: true });
    const unused = intent('unused', { used: false, age: 3 * HOUR });
    const young = intent('young', { used: false, age: 2 * HOUR + 9 * 60_000 });
    const { r, deps, has } = setup([used, unused, young]);
    await uploads(deps, AT);
    expect(r.valuesOf(OLD_INTENTS_SQL)).toEqual([[ago(STAGING_KEEP_MS), '', UPLOADS_BATCH]]);
    expect(STAGING_KEEP_MS).toBe((2 * 60 + 10) * 60 * 1000);
    for (const n of ['used', 'unused']) {
      expect(has(`up/upl-${n}/file`), n).toBe(false);
      expect(has(`up/upl-${n}/thumb`), n).toBe(false);
    }
    // A late PUT of a young intent may still be on its way: its objects stay.
    expect(has('up/upl-young/file')).toBe(true);
    // A used intent's confirmed upload is a file version: never removed.
    expect(has('prj-001/upl-used/file')).toBe(true);
    expect(has('prj-001/upl-used/thumb')).toBe(true);
  });

  it('removes the copied object of an unused intent past its end, unless a file or a report uses it', async () => {
    const orphan = intent('orphan', { used: false, age: 3 * HOUR, thumb: true });
    const shot = intent('shot', { used: false, age: 3 * HOUR, feedback: true });
    const kept = intent('kept', { used: false, age: 3 * HOUR });
    const { deps, has } = setup([orphan, shot, kept], ['prj-001/upl-kept/file']);
    expect(await uploads(deps, AT)).toEqual({ intents: 3, removed: 9, deleted: 0 });
    expect(has('prj-001/upl-orphan/file')).toBe(false);
    expect(has('prj-001/upl-orphan/thumb')).toBe(false);
    expect(has('feedback/upl-shot/file')).toBe(false);
    expect(has('prj-001/upl-kept/file')).toBe(true);
  });

  it('keeps the intent rows for 24 hours, so a retry with a stored answer still finds its intent, then deletes them after the removal', async () => {
    const day = intent('day', { used: true, age: INTENT_KEEP_MS + 2 * 60_000 });
    const hours = intent('hours', { used: true, age: 3 * HOUR });
    const { r, deps, deleted, has } = setup([day, hours]);
    expect(await uploads(deps, AT)).toEqual({ intents: 2, removed: 4, deleted: 1 });
    expect(INTENT_KEEP_MS).toBe(DAY);
    expect(deleted).toEqual(['upl_day']);
    expect(r.valuesOf(INTENTS_DELETE_SQL)).toEqual([[['upl_day'], ago(INTENT_KEEP_MS)]]);
    expect(has('up/upl-day/file')).toBe(false);
    const order = r.calls.map((c) => c.text);
    expect(order.indexOf(INTENTS_DELETE_SQL)).toBeGreaterThan(-1);
    expect(deps.files.calls.filter((c) => c.op === 'remove')).toHaveLength(1);
  });

  it('reads every old intent in one run, page by page, so a bulk upload of more than one page leaves no up/ object behind', async () => {
    const rows = Array.from({ length: UPLOADS_BATCH + 1 }, (_, i) => intent(String(i).padStart(4, '0'), { used: true, age: 3 * HOUR }));
    const { r, deps, has } = setup(rows);
    expect(await uploads(deps, AT)).toEqual({ intents: UPLOADS_BATCH + 1, removed: 2 * (UPLOADS_BATCH + 1), deleted: 0 });
    for (const row of rows) expect(has(row.staging_key), row.id).toBe(false);
    expect(r.valuesOf(OLD_INTENTS_SQL)).toEqual([
      [ago(STAGING_KEEP_MS), '', UPLOADS_BATCH],
      [ago(STAGING_KEEP_MS), rows[UPLOADS_BATCH - 1].id, UPLOADS_BATCH],
    ]);
  });

  it('keeps a used intent for 24 hours after its use, as long as the stored answer of its call, so a late retry still finds it', async () => {
    const late = intent('late', { used: true, age: 25 * HOUR, usedAge: 23 * HOUR });
    const done = intent('done', { used: true, age: 26 * HOUR, usedAge: 25 * HOUR });
    const lost = intent('lost', { used: false, age: 25 * HOUR });
    const { deps, deleted } = setup([late, done, lost]);
    expect(await uploads(deps, AT)).toEqual({ intents: 3, removed: 7, deleted: 2 });
    expect(deleted.sort()).toEqual(['upl_done', 'upl_lost']);
  });

  it('deletes no intent row when the store fails, so the next run tries the same objects again', async () => {
    const day = intent('day', { used: true, age: INTENT_KEEP_MS + 60_000 });
    const { r, deps } = setup([day]);
    deps.files.remove = async () => {
      throw new Error('Storage is down.');
    };
    await expect(uploads(deps, AT)).rejects.toThrow('Storage is down.');
    expect(r.valuesOf(INTENTS_DELETE_SQL)).toEqual([]);
  });

  it('calls no store and deletes nothing when no intent is old enough', async () => {
    const { r, deps } = setup([intent('young', { used: false, age: HOUR })]);
    expect(await uploads(deps, AT)).toEqual({ intents: 0, removed: 0, deleted: 0 });
    expect(deps.files.calls).toEqual([]);
    expect(r.valuesOf(INTENTS_DELETE_SQL)).toEqual([]);
  });
});
