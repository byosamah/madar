import type { OfficeTarget } from './targets';

/**
 * The checks of the deploy suite on the office path (exit wave 4). The office object holds the data, so a spec reads it through
 * the peek route of the copy: one select, at most 200 rows, with the ops secret in a header (never in a log line). OFFICE_SQL
 * holds the SQLite form of each Postgres text of walk.spec.ts; the helper test fails when the walk gets a text with no form here,
 * and prepares each form on the SQLite schema of the object.
 *
 * SQLite has no list value and no array: a list goes as JSON text and the form reads it with json_each, and a list that a form
 * gives back (json_group_array) comes as JSON text that officePeek reads back (JSON_COLUMNS). A count goes as text, as the
 * Postgres forms give it (count(*)::text), so a spec compares the same type on both paths.
 */

/** The columns that a form gives as JSON text: officePeek turns them into the value that pg gives. */
const JSON_COLUMNS: ReadonlySet<string> = new Set(['ids', 'users', 'mail']);

function valueOf(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

function rowOf(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) out[name] = JSON_COLUMNS.has(name) && typeof value === 'string' ? JSON.parse(value) : value;
  return out;
}

export async function officePeek<T = Record<string, unknown>>(target: OfficeTarget, text: string, values: readonly unknown[], send: typeof fetch = fetch): Promise<T[]> {
  const response = await send(`${target.apiUrl}/office/peek`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-madar-ops-secret': target.opsSecret },
    body: JSON.stringify({ text, values: values.map(valueOf) }),
  });
  if (!response.ok) throw new Error(`The peek route answered ${response.status}.`);
  return ((await response.json()) as Record<string, unknown>[]).map(rowOf) as T[];
}

/** The mail texts of mail.ts on the office path. */
export const OFFICE_MAIL_SQL = {
  last: 'select cast(max(id) as text) as id from mail_outbox',
  next: 'select id, to_email, tag, mail, created_at from mail_outbox where id > ?1 and lower(to_email) = lower(?2) and tag = ?3 order by id limit 1',
} as const;

/** The Postgres texts of the walk that have no office form: Supabase Storage only (the office copies keep their files on R2). */
export const OFFICE_SQL_NOT_NEEDED: readonly string[] = [
  "select count(*)::text as n from storage.objects where bucket_id = 'madar-files' and created_at > now() - interval '3 minutes'",
];

export const OFFICE_SQL: Readonly<Record<string, string>> = {
  "select id, project_id from tasks where doc->>'title' = $1":
    "select id, project_id from tasks where json_extract(doc, '$.title') = ?1",
  // The own sign-in keeps no last sign-in time: each sign-in makes one session row (server/auth/own/ops.ts).
  'select last_sign_in_at as at from auth.users where lower(email) = lower($1) and last_sign_in_at >= $2':
    'select max(s.created_at) as at from auth_sessions s join auth_users a on a.id = s.auth_id where a.email = lower(?1) and s.created_at >= ?2 having max(s.created_at) is not null',
  "select doc->'preferences'->>'language' as lang from users where id = $1":
    "select json_extract(doc, '$.preferences.language') as lang from users where id = ?1",
  "select id, leader_id, doc->>'code' as code from projects where doc->>'name' = $1":
    "select id, json_extract(doc, '$.leaderId') as leader_id, json_extract(doc, '$.code') as code from projects where json_extract(doc, '$.name') = ?1",
  "select 1 from tasks where id = $1 and owner_id = $2 and (doc->>'needsReview')::boolean":
    "select 1 as n from tasks where id = ?1 and owner_id = ?2 and json_extract(doc, '$.needsReview') = 1",
  "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'task_assigned'":
    "select id from notifications where user_id = ?1 and target_id = ?2 and json_extract(doc, '$.trigger') = 'task_assigned'",
  "select 1 from tasks where id = $1 and status = 'in_review'":
    "select 1 as n from tasks where id = ?1 and status = 'in_review'",
  "select 1 from tasks where id = $1 and status = 'done'":
    "select 1 as n from tasks where id = ?1 and status = 'done'",
  "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'task_approved'":
    "select id from notifications where user_id = ?1 and target_id = ?2 and json_extract(doc, '$.trigger') = 'task_approved'",
  "select status from tasks where id = $1 and status <> 'in_review'":
    "select status from tasks where id = ?1 and status <> 'in_review'",
  'select id from comments where target_id = $1 and doc::text like $2':
    'select id from comments where target_id = ?1 and doc like ?2',
  // The rowid of SQLite follows the order of the inserts, as ord of Postgres does.
  "select doc->>'trigger' as trig from notifications where user_id = $1 and target_id = $2 order by ord desc limit 1":
    "select json_extract(doc, '$.trigger') as trig from notifications where user_id = ?1 and target_id = ?2 order by rowid desc limit 1",
  "select count(*)::text as n from notifications where user_id = $1 and doc->>'trigger' = 'mention'":
    "select cast(count(*) as text) as n from notifications where user_id = ?1 and json_extract(doc, '$.trigger') = 'mention'",
  "select id, doc->>'body' as body from updates where project_id = $1 and doc::text like $2":
    "select id, json_extract(doc, '$.body') as body from updates where project_id = ?1 and doc like ?2",
  "select count(*)::text as n from notifications where user_id = $1 and doc->>'trigger' = 'mention' having count(*) > $2":
    "select cast(count(*) as text) as n from notifications where user_id = ?1 and json_extract(doc, '$.trigger') = 'mention' having count(*) > ?2",
  'select id, conversation_id from messages where doc::text like $1':
    'select id, conversation_id from messages where doc like ?1',
  "select id, doc->'versions'->0->>'blobKey' as key from files where project_id = $1 and doc::text like $2":
    "select id, json_extract(doc, '$.versions[0].blobKey') as key from files where project_id = ?1 and doc like ?2",
  "select id, doc->>'kind' as kind, jsonb_array_length(doc->'screenshots') as shots, doc->>'createdBy' as by, doc->>'status' as status from feedback where doc->>'message' = $1":
    "select id, json_extract(doc, '$.kind') as kind, json_array_length(doc, '$.screenshots') as shots, json_extract(doc, '$.createdBy') as by, json_extract(doc, '$.status') as status from feedback where json_extract(doc, '$.message') = ?1",
  // The users table of the object has no kind, active or email column: they live in the doc.
  "select id from users where kind = 'human' and active and doc->>'systemRole' = 'admin' and id <> $1 order by id":
    "select id from users where json_extract(doc, '$.kind') = 'human' and json_extract(doc, '$.active') = 1 and json_extract(doc, '$.systemRole') = 'admin' and id <> ?1 order by id",
  "select array_agg(id order by user_id) as ids, array_agg(user_id order by user_id) as users from notifications where target_id = $1 and doc->>'trigger' = 'feedback_sent' having count(*) >= $2":
    "select json_group_array(id) as ids, json_group_array(user_id) as users from (select id, user_id from notifications where target_id = ?1 and json_extract(doc, '$.trigger') = 'feedback_sent' order by user_id) having count(*) >= ?2",
  "select 1 from feedback where id = $1 and doc->>'status' = 'done' and doc->>'doneBy' = $2":
    "select 1 as n from feedback where id = ?1 and json_extract(doc, '$.status') = 'done' and json_extract(doc, '$.doneBy') = ?2",
  "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'feedback_done'":
    "select id from notifications where user_id = ?1 and target_id = ?2 and json_extract(doc, '$.trigger') = 'feedback_done'",
  "select count(*)::text as n from outbox where payload->>'notificationId' = any($1)":
    "select cast(count(*) as text) as n from outbox where json_extract(payload, '$.notificationId') in (select value from json_each(?1))",
  "select 1 from users where id = $1 and (doc->'preferences'->'notifications')::text like '%false%'":
    "select 1 as n from users where id = ?1 and json_extract(doc, '$.preferences.notifications') like '%false%'",
  'select 1 from notifications where id = any($1) and user_id = $2 and read':
    'select 1 as n from notifications where id in (select value from json_each(?1)) and user_id = ?2 and read = 1',
  'select 1 from notifications where id = $1 and read':
    'select 1 as n from notifications where id = ?1 and read = 1',
  'select count(*)::text as n from mail_outbox where idempotency_key = any($1)':
    'select cast(count(*) as text) as n from mail_outbox where idempotency_key in (select value from json_each(?1))',
  'select id from notifications where user_id = $1 and target_id = $2':
    'select id from notifications where user_id = ?1 and target_id = ?2',
  'select max(id)::text as max from mail_outbox':
    'select cast(max(id) as text) as max from mail_outbox',
  // The sign-in link of a person lives in auth_users.user_id on the office path (exit wave 2), not in users.auth_user_id.
  'select id, auth_user_id from users where lower(email) = lower($1)':
    "select u.id, (select a.id from auth_users a where a.user_id = u.id) as auth_user_id from users u where lower(json_extract(u.doc, '$.email')) = lower(?1)",
  'select id::text, tag from mail_outbox where id > $1 and lower(to_email) = lower($2)':
    'select cast(id as text) as id, tag from mail_outbox where id > ?1 and lower(to_email) = lower(?2)',
  'select 1 from users where id = $1 and lower(email) = lower($2)':
    "select 1 as n from users where id = ?1 and lower(json_extract(doc, '$.email')) = lower(?2)",
  'select a.email from auth.users a join users u on u.auth_user_id = a.id where u.id = $1':
    'select a.email from auth_users a where a.user_id = ?1',
  'select email from users where id = $1':
    "select json_extract(doc, '$.email') as email from users where id = ?1",
  'select count(*)::text as n from agent_links where owner_user_id = $1 and revoked_at is null':
    'select cast(count(*) as text) as n from agent_links where owner_user_id = ?1 and revoked_at is null',
};
