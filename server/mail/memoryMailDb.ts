import type { Db, Query } from '../core/ports';
import { CLAIM_SQL, DONE_SQL, FAIL_SQL, OUTBOX_INSERT_SQL, WAIT_SQL } from '../core/effects';
import { MAIL_LOCK_SQL, RECORD_SENT_SQL, REFUSAL_MARK_SQL, RELEASE_SQL, RESERVE_SQL } from './quota';

/**
 * A small database in memory for the mail unit tests (task N2.2): the quota statements of quota.ts, the outbox statements of
 * server/core/effects.ts, and any other statement that a test answers with "answer". A transaction that throws rolls the
 * mail_log and outbox rows back, as Postgres does. server/it/email.it.test.ts runs the same flow on the local database.
 */

export type LogRow = { utc_day: string; kind: string; user_id: string | null; ref: string; resend_id: string | null };
export type OutboxRecord = { id: number; kind: string; payload: Record<string, unknown>; done: boolean; claimed: boolean; attempts: number; error: string | null; until?: string };
export type Answer = (text: string, values: unknown[]) => unknown[] | undefined;

const SENDING = ['notice', 'summary', 'signin', 'warning'];

export function memoryMailDb(answer: Answer = () => undefined) {
  let log: LogRow[] = [];
  let outbox: OutboxRecord[] = [];
  const statements: string[] = [];

  const q = (async (text: string, values: unknown[] = []) => {
    statements.push(text);
    if (text === MAIL_LOCK_SQL) return [{}];
    if (text === RESERVE_SQL) {
      const [day, kind, userId, ref, limit] = values as [string, string, string | null, string, number];
      const today = log.filter((r) => r.utc_day === day);
      const mine = today.some((r) => r.ref === ref);
      const n = today.filter((r) => SENDING.includes(r.kind)).length;
      if (!mine && n < limit) log.push({ utc_day: day, kind, user_id: userId, ref, resend_id: null });
      return [{ ok: mine || n < limit }];
    }
    if (text === REFUSAL_MARK_SQL) {
      const day = values[0] as string;
      if (log.some((r) => r.utc_day === day && r.ref === 'quota-refused')) return [];
      log.push({ utc_day: day, kind: 'refused', user_id: null, ref: 'quota-refused', resend_id: null });
      return [{ id: log.length }];
    }
    if (text === RELEASE_SQL) {
      const ref = values[0] as string;
      log = log.filter((r) => !(r.ref === ref && r.resend_id === null && SENDING.includes(r.kind)));
      return [];
    }
    if (text === RECORD_SENT_SQL) {
      const [day, ref, id] = values as [string, string, string];
      for (const row of log) if (row.utc_day === day && row.ref === ref) row.resend_id = id;
      return [];
    }
    if (text === OUTBOX_INSERT_SQL) {
      const rows = JSON.parse(values[0] as string) as { kind: string; payload: Record<string, unknown> }[];
      return rows.map((row) => {
        const record = { id: outbox.length + 1, kind: row.kind, payload: row.payload, done: false, claimed: false, attempts: 0, error: null };
        outbox.push(record);
        return { id: record.id };
      });
    }
    if (text === CLAIM_SQL) {
      const record = outbox.find((r) => String(r.id) === String(values[0]) && !r.done && !r.claimed);
      if (!record) return [];
      record.claimed = true;
      record.attempts += 1;
      return [{ id: record.id, kind: record.kind, payload: record.payload }];
    }
    if (text === WAIT_SQL) {
      // Held until $3: the row stays claimed (a test frees it when that time comes), and the attempt goes back.
      const record = outbox.find((r) => String(r.id) === String(values[0]))!;
      record.error = values[1] as string;
      record.until = values[2] as string;
      record.attempts = Math.max(record.attempts - 1, 0);
      return [];
    }
    if (text === DONE_SQL || text === FAIL_SQL) {
      const record = outbox.find((r) => String(r.id) === String(values[0]))!;
      if (text === DONE_SQL) record.done = true;
      else record.error = values[1] as string;
      return [];
    }
    const found = answer(text, values);
    if (found === undefined) throw new Error(`No answer for: ${text}`);
    return found;
  }) as Query;

  const db: Db = {
    async tx(_mode, work) {
      const keep = { log: structuredClone(log), outbox: structuredClone(outbox) };
      try {
        return await work(q);
      } catch (error) {
        log = keep.log;
        outbox = keep.outbox;
        throw error;
      }
    },
    savepoint: (_q, work) => work(q),
    statement: (_mode, text, values) => q(text, values) as never,
  };

  return {
    db,
    q,
    statements,
    get log() {
      return log;
    },
    get outbox() {
      return outbox;
    },
    fill(kind: string, n: number, day: string) {
      for (let i = 0; i < n; i += 1) log.push({ utc_day: day, kind, user_id: null, ref: `${kind}-fill-${i}`, resend_id: null });
    },
  };
}
