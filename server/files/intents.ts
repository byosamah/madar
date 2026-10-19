import { ApiError, invalid, notFound } from '../../src/api/errors';
import type { Db, FileStoreKind, Query } from '../core/ports';
import { sqlFor } from '../data/dialect';
import { chatUploadPrefix, meetingUploadPrefix, officeUploadPrefix } from './keys';
import { intentLifeSeconds } from './links';

/**
 * The upload intents (plan 5.2; proof.md, Z0a item 6; task F2). files.uploadStart and feedback.uploadStart write one row for each
 * signed upload; the preflight of files.upload and feedback.send reads it, and their prepare marks it used inside the lock.
 * A used intent passes their preflight with no store call, so a retry with the same idempotency key gets the stored answer.
 *
 * expires_at is the link life plus the transfer time of the store: 2 hours after the start on Storage, the 10-minute link plus
 * 60 minutes on R2. A call refuses an intent past expires_at. A file intent has a project; a screenshot intent has none.
 */

export type Intent = {
  id: string;
  actorId: string;
  projectId: string | null;
  stagingKey: string;
  key: string;
  thumbKey: string | null;
  size: number;
  /** The declared type, in lower case. The store keeps storedMimeType of it. */
  mimeType: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export const INTENT_INSERT_SQL =
  'insert into upload_intents (id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at) '
  + 'select id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at from jsonb_to_recordset($1::jsonb) '
  + 'as t(id text, actor_id text, project_id text, staging_key text, key text, thumb_key text, size bigint, mime_type text, expires_at timestamptz)';
export const INTENTS_SELECT_SQL =
  'select id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at from upload_intents where id = any($1::text[])';
export const INTENTS_USE_SQL =
  'update upload_intents set used_at = $3 where id = any($1::text[]) and actor_id = $2 and used_at is null and expires_at > $3 returning id';

/**
 * The SQLite forms (Supabase exit, wave 1). The values stay the same: the SQLite Db binds the id list as JSON text. expires_at >
 * ?3 compares ISO text in UTC, which is time order, because both sides come from toISOString.
 */
export const INTENT_INSERT_LITE =
  'insert into upload_intents (id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at) '
  + "select json_extract(value, '$.id'), json_extract(value, '$.actor_id'), json_extract(value, '$.project_id'), json_extract(value, '$.staging_key'), "
  + "json_extract(value, '$.key'), json_extract(value, '$.thumb_key'), json_extract(value, '$.size'), json_extract(value, '$.mime_type'), "
  + "json_extract(value, '$.expires_at') from json_each(?1)";
export const INTENTS_SELECT_LITE =
  'select id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at from upload_intents where id in (select value from json_each(?1))';
export const INTENTS_USE_LITE =
  'update upload_intents set used_at = ?3 where id in (select value from json_each(?1)) and actor_id = ?2 and used_at is null and expires_at > ?3 returning id';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** "upl_" and 22 random base32 characters (110 bits): an intent id that nobody can guess, and a valid key part. */
export function newUploadId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  let id = 'upl_';
  for (const byte of bytes) id += BASE32[byte & 31];
  return id;
}

export function intentExpiry(now: Date, kind: FileStoreKind): Date {
  return new Date(now.getTime() + intentLifeSeconds(kind) * 1000);
}

/** The declared type as the record keeps it: trimmed, in lower case, as a browser Blob gives it in the prototype. */
export function declaredType(type: string): string {
  return type.trim().toLowerCase();
}

type IntentRow = Record<string, unknown>;
const dateOf = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

export function intentOf(row: IntentRow): Intent {
  return {
    id: String(row.id),
    actorId: String(row.actor_id),
    projectId: row.project_id === null || row.project_id === undefined ? null : String(row.project_id),
    stagingKey: String(row.staging_key),
    key: String(row.key),
    thumbKey: row.thumb_key === null || row.thumb_key === undefined ? null : String(row.thumb_key),
    size: Number(row.size),
    mimeType: String(row.mime_type),
    expiresAt: dateOf(row.expires_at),
    usedAt: row.used_at === null || row.used_at === undefined ? null : dateOf(row.used_at),
  };
}

export async function insertIntents(db: Db, intents: Intent[]): Promise<void> {
  if (intents.length === 0) return;
  const rows = intents.map((i) => ({
    id: i.id, actor_id: i.actorId, project_id: i.projectId, staging_key: i.stagingKey, key: i.key, thumb_key: i.thumbKey,
    size: i.size, mime_type: i.mimeType, expires_at: i.expiresAt.toISOString(),
  }));
  await db.statement('write', sqlFor(db, INTENT_INSERT_SQL, INTENT_INSERT_LITE), [JSON.stringify(rows)]);
}

export async function readIntents(db: Db, ids: string[]): Promise<Map<string, Intent>> {
  const rows = await db.statement<IntentRow>('read', sqlFor(db, INTENTS_SELECT_SQL, INTENTS_SELECT_LITE), [ids]);
  return new Map(rows.map((row) => [String(row.id), intentOf(row)]));
}

/**
 * The checks of an intent before any store call. projectId is the project of the upload, or null for a screenshot.
 * Another actor's intent reads as missing, so an id never tells whether it exists.
 *
 * allowUsed lets a used intent pass every other check. The preflight runs before runCall looks up the idempotency key, so a
 * retry with the key of a call that committed must reach that step and get the stored answer (plan section 2, change 17).
 * Without a stored answer, useIntents in prepare refuses the used intent, so it never makes a second version.
 */
export function checkIntent(
  intent: Intent | undefined,
  o: { id: string; actorId: string; now: Date; field: string; projectId: string | null; officeTaskId?: string; conversationId?: string; meetingId?: string; allowUsed?: boolean },
): Intent {
  if (!intent || intent.actorId !== o.actorId) throw notFound('Upload', o.id);
  const screenshot = intent.projectId === null && intent.key.startsWith('feedback/');
  // An upload of an office task has no project, and its key sits in the folder of that task (owner, 2026-10-06).
  const officeFile = intent.projectId === null && o.officeTaskId !== undefined && intent.key.startsWith(officeUploadPrefix(o.officeTaskId));
  // An upload of a direct chat or a group has no project, and its key sits in the folder of that chat (owner, 2026-10-19).
  const chatFile = intent.projectId === null && o.conversationId !== undefined && intent.key.startsWith(chatUploadPrefix(o.conversationId));
  // An upload of a meeting with no project has no project, and its key sits in the folder of that meeting (wave 2).
  const meetingFile = intent.projectId === null && o.meetingId !== undefined && intent.key.startsWith(meetingUploadPrefix(o.meetingId));
  if (o.meetingId !== undefined) {
    if (o.projectId !== null || o.officeTaskId !== undefined || o.conversationId !== undefined || !meetingFile) throw invalid(o.field, 'This upload belongs to another meeting.');
  } else if (o.conversationId !== undefined) {
    if (o.projectId !== null || o.officeTaskId !== undefined || !chatFile) throw invalid(o.field, 'This upload belongs to another chat.');
  } else if (o.officeTaskId !== undefined) {
    if (o.projectId !== null || !officeFile) throw invalid(o.field, 'This upload belongs to another task.');
  } else if (o.projectId === null && !screenshot) throw invalid(o.field, 'This upload is not a screenshot.');
  if (o.projectId !== null && intent.projectId !== o.projectId) throw invalid(o.field, 'This upload belongs to another project.');
  if (intent.usedAt !== null && !o.allowUsed) throw new ApiError('conflict', 'This upload is already used.');
  if (intent.expiresAt.getTime() <= o.now.getTime()) throw invalid(o.field, 'This upload has ended. Upload the file again.');
  return intent;
}

/** Inside the lock: marks the intents used, once. A used, expired or foreign intent gives conflict, and the call rolls back. */
export async function useIntents(q: Query, ids: string[], actorId: string, now: Date): Promise<void> {
  if (ids.length === 0) return;
  const rows = await q<{ id: string }>(sqlFor(q, INTENTS_USE_SQL, INTENTS_USE_LITE), [ids, actorId, now.toISOString()]);
  if (rows.length !== new Set(ids).size) throw new ApiError('conflict', 'This upload is already used, or it has ended. Upload the file again.');
}
