import { runScheduledTriggers } from '../../../src/api/notify';
import type { State } from '../../../src/api/store';
import { processOutbox, writeOutbox } from '../../core/effects';
import { logLockHold, takeOfficeLock } from '../../core/lock';
import type { Deps, Query } from '../../core/ports';
import { loadJobs, sqlSource } from '../../data/loaders/index';
import { readOffice } from '../../data/officeCache';
import { save } from '../../data/save';
import { noticeRows } from '../../mail/notices';

/**
 * Step 1 of the 15-minute job (plan 5.5): the scheduled triggers (due and overdue reminders, the restart day of a paused
 * project) under the office lock, as one write:
 *
 *   the lock, the office, the jobs loader of C2 (loadJobs), runScheduledTriggers with a dedupe lookup backed by the unique index
 *   (plan 4.13, A3), the save, the mail.notice outbox rows of N2 (noticeRows), the change signals, the commit, then the mail.
 *
 * notify asks its dedupe lookup synchronously, so the lookup cannot query the database itself. A first pass on a copy of the
 * State collects the keys this run would use, one query finds which of them a notice already holds, and the real pass runs with
 * that answer. A second run in the same window finds every key used and writes nothing. A run with no new notice writes nothing
 * and sends nothing.
 */

/** $1 the dedupe keys this run would use. The ones a notice already holds (the index notifications_dedupe). */
export const USED_DEDUPE_SQL = 'select dedupe_key from notifications where dedupe_key = any($1::text[])';

/** The dedupe keys of this run that the database already holds. The State stays untouched. */
export async function usedDedupeKeys(q: Query, state: State, at: Date): Promise<Set<string>> {
  const asked = new Set<string>();
  runScheduledTriggers(structuredClone(state), at, { dedupeUsed: (key) => (asked.add(key), false) });
  if (asked.size === 0) return new Set();
  const rows = await q<{ dedupe_key: string }>(USED_DEDUPE_SQL, [[...asked].sort()]);
  return new Set(rows.map((row) => row.dedupe_key));
}

export async function triggers(deps: Deps, at: Date): Promise<{ notices: number; mails: number }> {
  let lockedAt = 0;
  let done: { notices: number; ids: string[] };
  try {
    done = await deps.db.tx('write', async (q) => {
      await takeOfficeLock(q, deps.config.lockKey);
      lockedAt = performance.now();
      const office = await readOffice(deps, q);
      const state = await loadJobs({ src: sqlSource(q, { bytes: (n) => deps.meter.addBytes(n) }), office });
      const used = await usedDedupeKeys(q, state, at);
      const before = structuredClone(state);
      const notices = runScheduledTriggers(state, at, { dedupeUsed: (key) => used.has(key) });
      if (notices === 0) return { notices, ids: [] };
      const saved = await save(q, before, state);
      const ids = await writeOutbox(q, await noticeRows(q, saved));
      if (saved.signals.length > 0) await deps.signal.send(q, saved.signals);
      return { notices, ids };
    });
  } finally {
    if (lockedAt > 0) logLockHold(deps, 'jobs.triggers', Math.round(performance.now() - lockedAt));
  }
  // After the commit, once; a mail that fails stays in the outbox for step 3 of a later run.
  if (done.ids.length > 0) await processOutbox(deps, done.ids);
  return { notices: done.notices, mails: done.ids.length };
}
