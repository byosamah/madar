import type { Feedback, FileRec, User } from '../../src/api/contract/entities';
import type { Db } from '../core/ports';

/**
 * The single read statements of the file calls and hooks (task F2). A server call and a hook before the lock read with one
 * statement each on the read pool, never inside a call's transaction (plan 4.5, step 5.1).
 */

export const USERS_SQL = 'select doc from users where id = any($1::text[])';
export const FILE_DOC_SQL = 'select doc from files where id = $1';
export const TASK_PROJECT_SQL = 'select project_id from tasks where id = $1';
export const FEEDBACK_DOC_SQL = 'select doc from feedback where id = $1';

export async function readUsers(db: Db, ids: string[]): Promise<Map<string, User>> {
  const rows = await db.statement<{ doc: User }>('read', USERS_SQL, [ids]);
  return new Map(rows.map((row) => [row.doc.id, row.doc]));
}

export async function readFile(db: Db, id: string): Promise<FileRec | undefined> {
  const [row] = await db.statement<{ doc: FileRec }>('read', FILE_DOC_SQL, [id]);
  return row?.doc;
}

/** The project of a task, or undefined when the task does not exist. */
export async function projectOfTask(db: Db, id: string): Promise<string | undefined> {
  const [row] = await db.statement<{ project_id: string | null }>('read', TASK_PROJECT_SQL, [id]);
  return row?.project_id ?? undefined;
}

export async function readFeedback(db: Db, id: string): Promise<Feedback | undefined> {
  const [row] = await db.statement<{ doc: Feedback }>('read', FEEDBACK_DOC_SQL, [id]);
  return row?.doc;
}
