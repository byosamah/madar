import type { Feedback, FileRec, Meeting, RoleSettings, Settings, Task, User } from '../../src/api/contract/entities';
import type { Db } from '../core/ports';
import { sqlFor } from '../data/dialect';

/**
 * The single read statements of the file calls and hooks (task F2). A server call and a hook before the lock read with one
 * statement each on the read pool, never inside a call's transaction (plan 4.5, step 5.1).
 */

export const USERS_SQL = 'select doc from users where id = any($1::text[])';
export const FILE_DOC_SQL = 'select doc from files where id = $1';
/** Several files at once: the read of a run of adjacent files.link entries (SV-11). */
export const FILES_DOCS_SQL = 'select doc from files where id = any($1::text[])';
export const TASK_PROJECT_SQL = 'select project_id from tasks where id = $1';
export const TASK_DOC_SQL = 'select doc from tasks where id = $1';
export const FEEDBACK_DOC_SQL = 'select doc from feedback where id = $1';
export const MEETING_DOC_SQL = 'select doc from meetings where id = $1';
/** The office settings: one row, whose roles give the office rights of each person (role-rights, 2026-10-23). */
export const SETTINGS_SQL = "select doc from settings where id = 'office'";

// The SQLite forms (Supabase exit, wave 1). The users table is an office table of fewer than 100 rows: json_each is cheap here,
// and wave 3 reads the users from the office snapshot.
export const USERS_LITE = 'select doc from users where id in (select value from json_each(?1))';
export const FILE_DOC_LITE = 'select doc from files where id = ?1';
export const FILES_DOCS_LITE = 'select doc from files where id in (select value from json_each(?1))';
export const TASK_PROJECT_LITE = 'select project_id from tasks where id = ?1';
export const TASK_DOC_LITE = 'select doc from tasks where id = ?1';
export const FEEDBACK_DOC_LITE = 'select doc from feedback where id = ?1';
export const MEETING_DOC_LITE = 'select doc from meetings where id = ?1';
export const SETTINGS_LITE = "select doc from settings where id = 'office'";

export async function readUsers(db: Db, ids: string[]): Promise<Map<string, User>> {
  const rows = await db.statement<{ doc: User }>('read', sqlFor(db, USERS_SQL, USERS_LITE), [ids]);
  return new Map(rows.map((row) => [row.doc.id, row.doc]));
}

export async function readFile(db: Db, id: string): Promise<FileRec | undefined> {
  const [row] = await db.statement<{ doc: FileRec }>('read', sqlFor(db, FILE_DOC_SQL, FILE_DOC_LITE), [id]);
  return row?.doc;
}

/** The records of several files with one statement. An id with no file is not in the map. */
export async function readFiles(db: Db, ids: string[]): Promise<Map<string, FileRec>> {
  const rows = await db.statement<{ doc: FileRec }>('read', sqlFor(db, FILES_DOCS_SQL, FILES_DOCS_LITE), [ids]);
  return new Map(rows.map((row) => [row.doc.id, row.doc]));
}

/** The project of a task, or undefined when the task does not exist. */
export async function projectOfTask(db: Db, id: string): Promise<string | undefined> {
  const [row] = await db.statement<{ project_id: string | null }>('read', sqlFor(db, TASK_PROJECT_SQL, TASK_PROJECT_LITE), [id]);
  return row?.project_id ?? undefined;
}

/** A task by id, for the rights on the files of an office task (owner, 2026-10-06). */
export async function readTask(db: Db, id: string): Promise<Task | undefined> {
  const [row] = await db.statement<{ doc: Task }>('read', sqlFor(db, TASK_DOC_SQL, TASK_DOC_LITE), [id]);
  return row?.doc;
}

/** A meeting by id, for the rights on the files of a meeting with no project (fbk_022, wave 2). */
export async function readMeeting(db: Db, id: string): Promise<Meeting | undefined> {
  const [row] = await db.statement<{ doc: Meeting }>('read', sqlFor(db, MEETING_DOC_SQL, MEETING_DOC_LITE), [id]);
  return row?.doc;
}

export async function readFeedback(db: Db, id: string): Promise<Feedback | undefined> {
  const [row] = await db.statement<{ doc: Feedback }>('read', sqlFor(db, FEEDBACK_DOC_SQL, FEEDBACK_DOC_LITE), [id]);
  return row?.doc;
}

/** The roles of the office settings, or undefined when the office has none. A hook has no office snapshot, so it reads them with one statement. */
export async function readRoles(db: Db): Promise<RoleSettings | undefined> {
  const [row] = await db.statement<{ doc: Settings }>('read', sqlFor(db, SETTINGS_SQL, SETTINGS_LITE), []);
  return row?.doc.roles;
}
