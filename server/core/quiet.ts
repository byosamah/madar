import { isQuiet } from '../../src/lib/quietHours';
import { isLite } from '../data/dialect';
import type { Db } from './ports';

/**
 * Quiet hours on the server (owner, 2026-10-22, fbk_048). One read of the work hours of a person and of the office, then the pure rule
 * isQuiet (src/lib/quietHours.ts). The push effects and the notice mail effects ask it at send time, after any wait.
 *
 * $1 the person. The work hours the person chose (null when none), and the office work hours (null when none). The primary is read,
 * because the effect runs right after the commit of the call that wrote them.
 */
export const QUIET_SQL = `select u.doc->'preferences'->'workHours' as person,
  (select s.doc->'workHours' from settings s where s.id = 'office') as office
from users u where u.id = $1`;
export const QUIET_LITE = `select json_extract(u.doc, '$.preferences.workHours') as person,
  (select json_extract(s.doc, '$.workHours') from settings s where s.id = 'office') as office
from users u where u.id = ?1`;

/** A json column as the database gives it: an object (jsonb), JSON text (SQLite), or null. */
export function jsonOf<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

type Row = { person: unknown; office: unknown };

/**
 * The same rule from the columns that another statement already read: the work hours of the person (null when none) and the office
 * work hours. A statement that reads the person for another reason (the devices, the notice mail) adds the office column to its
 * own text and asks this, so quiet hours cost no round trip of their own (round trips test, SRV-1).
 */
export function quietFromColumns(workHours: unknown, office: unknown, at: Date): boolean {
  const mine = jsonOf<NonNullable<NonNullable<Parameters<typeof isQuiet>[0]>['workHours']>>(workHours);
  const hours = jsonOf<NonNullable<NonNullable<Parameters<typeof isQuiet>[1]>['workHours']>>(office);
  return isQuiet(mine ? { workHours: mine } : undefined, hours ? { workHours: hours } : undefined, at);
}

/** The column of the office work hours that a statement adds to its own text. */
export const OFFICE_HOURS_SQL = "(select s.doc->'workHours' from settings s where s.id = 'office') as office";
export const OFFICE_HOURS_LITE = "(select json_extract(s.doc, '$.workHours') from settings s where s.id = 'office') as office";

/** True when the person is in quiet hours at this moment. A person who is not in the database is not quiet. */
export async function isQuietNow(db: Db, userId: string, at: Date): Promise<boolean> {
  const [row] = await db.statement<Row>('write', isLite(db) ? QUIET_LITE : QUIET_SQL, [userId]);
  if (!row) return false;
  const person = jsonOf<NonNullable<Parameters<typeof isQuiet>[0]>['workHours']>(row.person);
  const office = jsonOf<NonNullable<NonNullable<Parameters<typeof isQuiet>[1]>['workHours']>>(row.office);
  return isQuiet(person ? { workHours: person } : undefined, office ? { workHours: office } : undefined, at);
}
