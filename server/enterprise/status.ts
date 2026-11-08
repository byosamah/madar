import type { OfficeSnapshot } from '../core/types';
import type { LiteDb } from '../data/lite/db';
import { utcDay } from '../mail/quota';
import type { DayRow } from '../office/parts';
import type { EnterpriseId } from './ids';
import type { DayCounts, EnterpriseStatus } from './types';

/**
 * The status row of one enterprise (Madar enterprises, design 5.6): the people, the stored bytes, the last write and today's counts.
 * The Cron of each object sends it to the platform object. It reads a few rows: the office lists come from memory, the last write is
 * one row through the index events_created_at, and the mails of the day are one count on the mail_log index.
 */

/** The active people of the office: humans only (an agent is no person of the enterprise). */
function peopleOf(office: OfficeSnapshot): number {
  return Object.values(office.lists.users).filter((user) => user.active && user.kind === 'human').length;
}

const INVITED_SQL = 'select count(*) as n from auth_users where password_set = 0 and banned = 0 and user_id is not null';
const LAST_WRITE_SQL = 'select created_at from events order by created_at desc limit 1';
const MAILS_SQL = 'select count(*) as n from mail_log where utc_day = ?1';

function textOf(settings: unknown, key: string): string {
  const value = (settings as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : '';
}

/** day: the day row with the counts that the meter holds in memory (OfficeParts.dayCounts). storageBytes is 0 until plan C adds the stored total. */
export async function enterpriseStatusOf(db: LiteDb, ent: EnterpriseId, office: OfficeSnapshot, day: DayRow, now: Date): Promise<EnterpriseStatus> {
  const [invited] = await db.statement<{ n: number }>('read', INVITED_SQL);
  const [last] = await db.statement<{ created_at: string }>('read', LAST_WRITE_SQL);
  const [mails] = await db.statement<{ n: number }>('read', MAILS_SQL, [utcDay(now)]);
  const counts: DayCounts = { requests: day.requests, rowsRead: day.rows_read, rowsWritten: day.rows_written, mails: Number(mails?.n ?? 0) };
  return {
    ent,
    people: peopleOf(office),
    invited: Number(invited?.n ?? 0),
    storageBytes: 0,
    lastWriteAt: last?.created_at ?? null,
    day: counts,
    name: textOf(office.lists.settings, 'enterpriseName'),
    nameAr: textOf(office.lists.settings, 'enterpriseNameAr'),
  };
}
