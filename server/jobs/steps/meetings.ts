import type { Meeting } from '../../../src/api/contract/entities';
import { officeStamp, SETTLE_BACK_DAYS } from '../../../src/lib/meetings';
import { runCall } from '../../core/runCall';
import type { Deps } from '../../core/ports';
import type { OfficeSnapshot } from '../../core/types';
import { isLite, sqlFor } from '../../data/dialect';
import { liteDbOf } from '../../data/lite/db';
import { readLiteOffice } from '../../data/lite/office';
import { readOffice } from '../../data/officeCache';

/**
 * The meetings step of the 15-minute job (fbk_022, wave 2, owner 2026-10-19): settle the meetings that ended. One statement reads the due
 * meetings. Each one runs the normal call meetings.settle, as the organizer, in its own transaction under the office lock. So the
 * job writes nothing by its own SQL: the mark and the Tracker line of a project meeting come from the one settle rule of
 * src/api/handlers/meetings.ts, with the events of a normal call. The step is safe to run twice: a settled meeting leaves the read.
 *
 * Due: scheduled, with no settled_at, ended (ends_at at or before this run), and not older than SETTLE_BACK_DAYS days. Every stored
 * stamp is in office time (+03:00), so the text order of ends_at is the time order and a text compare is right. At most 20 meetings in
 * one run, the oldest end first; the rest wait for the next run (15 minutes).
 */

/** $1 the stamp of this run, $2 the stamp 14 days before it. The partial index meetings_to_settle serves this read. */
export const SETTLE_SQL =
  "select id, doc from meetings where status = 'scheduled' and settled_at is null and ends_at collate \"C\" <= $1::text and ends_at collate \"C\" >= $2::text "
  + 'order by ends_at collate "C", id limit 20';
/** SQLite (the office object): the same read; the stamps are text already, and the partial index meetings_to_settle serves it. */
export const SETTLE_LITE =
  "select id, doc from meetings where status = 'scheduled' and settled_at is null and ends_at <= ?1 and ends_at >= ?2 order by ends_at, id limit 20";

type Due = Pick<Meeting, 'organizerId' | 'projectId' | 'attendeeIds'>;

/**
 * The person who runs meetings.settle for a meeting: the organizer while an active person. Else, for a project meeting, the first
 * active Admin by id (everyone sees a project meeting); for a meeting with no project, the first active attendee by id (only its people
 * see it, the Admin too only when invited). Null when nobody can act: the meeting counts as skipped.
 */
export function settleActorOf(office: OfficeSnapshot, row: Due): string | null {
  const users = office.lists.users;
  const person = (id: string) => users[id]?.kind === 'human' && users[id].active;
  if (person(row.organizerId)) return row.organizerId;
  if (row.projectId !== null) {
    return Object.values(users).filter((user) => user.kind === 'human' && user.active && user.systemRole === 'admin').map((user) => user.id).sort()[0] ?? null;
  }
  return [...row.attendeeIds].sort().find(person) ?? null;
}

export type MeetingsReport = { settled: number; skipped: number; failed: number; extended: number };

export async function meetings(deps: Deps, at: Date): Promise<MeetingsReport> {
  const report: MeetingsReport = { settled: 0, skipped: 0, failed: 0, extended: 0 };
  const oldest = new Date(at.getTime() - SETTLE_BACK_DAYS * 24 * 60 * 60_000);
  const rows = await deps.db.statement<{ id: string; doc: Meeting }>('read', sqlFor(deps.db, SETTLE_SQL, SETTLE_LITE), [officeStamp(at.toISOString()), officeStamp(oldest.toISOString())]);
  if (rows.length === 0) return report;
  const office = isLite(deps.db) ? await deps.db.tx('read', (q) => readLiteOffice(liteDbOf(q), q)) : await readOffice(deps);
  // The office object puts its own run on its deps (the SQLite data). Every other host runs the Postgres path.
  const run = deps.runCall ?? runCall;
  for (const row of rows) {
    const userId = settleActorOf(office, row.doc);
    if (userId === null) {
      report.skipped += 1;
      continue;
    }
    const result = await run(deps, { principal: { userId }, name: 'meetings.settle', input: { id: row.id }, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    if (!result.ok) {
      // The code and the id only: a title, a place or a note is data of the office and stays out of the log.
      deps.log.error('A meeting could not be settled. The next run tries it again.', { step: 'meetings', id: row.id, error: result.error.code });
      report.failed += 1;
    } else if ((result.output as { settledAt: string | null }).settledAt !== null) report.settled += 1;
  }
  return report;
}
