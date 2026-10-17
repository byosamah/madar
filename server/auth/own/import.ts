import type { Query } from '../../core/ports';
import { liteDbOf } from '../../data/lite/db';
import { readLiteOffice, writeOfficeSnapshot } from '../../data/lite/office';

/**
 * The sign-in rows of the switch (owner decision 4; spec section 4, step 4). The export of wave 4 runs SIGNIN_EXPORT_SQL on the
 * Supabase database with the address of the nightly backup (BACKUP_DB_URL); the import of wave 4 calls importSigninRows inside the
 * office object. Each id stays the id of auth.users, so a Supabase token and an own token name the same person. The rows travel
 * only inside the encrypted export file.
 */
export const SIGNIN_EXPORT_SQL = [
  "select a.id::text as id, lower(a.email) as email, nullif(a.encrypted_password, '') as password_hash,",
  ' a.email_confirmed_at is not null as email_confirmed, coalesce(a.banned_until > now(), false) as banned,',
  " coalesce((a.raw_user_meta_data->>'madar_password_set')::boolean, false) as password_set, u.id as user_id",
  ' from auth.users a left join users u on u.auth_user_id = a.id where a.deleted_at is null and a.email is not null',
].join('');

export type SigninExportRow = {
  id: string; email: string; password_hash: string | null; email_confirmed: boolean; banned: boolean; password_set: boolean; user_id: string | null;
};

export const SIGNIN_IMPORT_LITE =
  'insert into auth_users (id, user_id, email, password_hash, password_set, email_confirmed, banned, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)';

/**
 * Writes the rows, in id order, then one office version and one snapshot with the new links (the rule of lite/office.ts). A link to
 * a person who is not in the office stays out: principalOf would refuse it anyway. Run it in one write transaction.
 */
export async function importSigninRows(q: Query, rows: readonly SigninExportRow[], now: Date): Promise<number> {
  const office = await readLiteOffice(liteDbOf(q), q);
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const userId = row.user_id !== null && office.lists.users[row.user_id] ? row.user_id : null;
    await q(SIGNIN_IMPORT_LITE, [row.id, userId, row.email.trim().toLowerCase(), row.password_hash, row.password_set ? 1 : 0, row.email_confirmed ? 1 : 0, row.banned ? 1 : 0, now.toISOString()]);
  }
  const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
  await writeOfficeSnapshot(q, office.lists, Number(meta.version));
  return rows.length;
}
