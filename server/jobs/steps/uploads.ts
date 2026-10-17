import type { Deps } from '../../core/ports';
import { sqlFor } from '../../data/dialect';
import { blobKeysInUse } from '../../files/effects';
import { intentOf } from '../../files/intents';
import { isObjectKey, isStagingKey } from '../../files/keys';

/**
 * Step 5 of the 15-minute job (plan 5.5; proof.md, Z0a item 6): the leftovers of uploads, through the FilesPort of the active
 * store, so it works the same on Supabase Storage and on R2.
 *
 * - Every up/ object older than 2 hours 10 minutes goes, for used and unused intents alike. A Storage upload link lives 2 hours
 *   and an R2 link must start within 10 minutes, so after 2 hours 10 minutes no new PUT can start. A late PUT and a second PUT
 *   after files.upload both leave an up/<intent> object, so the step never trusts used_at. Only staging keys sit under up/, and
 *   each one comes from an intent (server/files/keys.ts), so the intent rows name every up/ object: up/<intent>/file and
 *   up/<intent>/thumb. A key with no object costs nothing to remove.
 * - The copied object of an unused intent past its end goes too: the preflight copied it, then the call failed under the lock,
 *   and no call can use the intent any more. A key that a file version or a report still uses stays (blobKeysInUse).
 * - An intent row stays for 24 hours after its use (used_at), or after its start (created_at) when no call used it. The stored
 *   answer of the call that used it stays 24 hours after that call, and used_at takes the same time, so the two end together: a
 *   retry with a stored answer passes the preflight (server/files/intents.ts) only while its intent is there. Until then each run
 *   removes their up/ keys again, so an object that a slow PUT finished after an earlier run goes too. The rows go only after the
 *   store removed their objects; a store that fails keeps them for the next run.
 * - Each run reads every intent past the staging cutoff, page by page (UPLOADS_BATCH rows, in id order), so a bulk upload of many
 *   files leaves no up/ object for longer than 2 hours 10 minutes and one run never repeats the same page.
 *
 * This replaces the plan line "upload intents older than 1 hour (and their R2 objects)": an intent on Storage lives 2 hours.
 */

export const STAGING_KEEP_MS = (2 * 60 + 10) * 60 * 1000;
export const INTENT_KEEP_MS = 24 * 60 * 60 * 1000;
/** The intents of one page. A run reads page after page until a page is shorter. */
export const UPLOADS_BATCH = 500;

/**
 * $1 the staging cutoff, $2 the last id of the page before ('' for the first page), $3 the page size. The pages go by id, not by
 * created_at: postgres keeps microseconds and a JavaScript Date only milliseconds, so a created_at key could read a page twice.
 */
export const OLD_INTENTS_SQL =
  'select id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at, created_at from upload_intents '
  + 'where created_at <= $1 and id > $2 order by id limit $3';
/** $1 the intents, $2 the keep cutoff. '<', as the cleanup of the idempotency keys. */
export const INTENTS_DELETE_SQL =
  'delete from upload_intents where id = any($1::text[]) and coalesce(used_at, created_at) < $2 returning id';

// SQLite forms (exit wave 3). "order by id limit" pages on the key index of the text primary key: a cut order, no sort step.
export const OLD_INTENTS_LITE =
  'select id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at, created_at from upload_intents '
  + 'where created_at <= ?1 and id > ?2 order by id limit ?3';
export const INTENTS_DELETE_LITE =
  'delete from upload_intents where id in (select value from json_each(?1)) and coalesce(used_at, created_at) < ?2 returning id';

const dateOf = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

type Counts = { intents: number; removed: number; deleted: number };

export async function uploads(deps: Pick<Deps, 'db' | 'files'>, at: Date): Promise<Counts> {
  const stagingCutoff = new Date(at.getTime() - STAGING_KEEP_MS);
  const total: Counts = { intents: 0, removed: 0, deleted: 0 };
  let after = '';
  for (;;) {
    const rows = await deps.db.statement('write', sqlFor(deps.db, OLD_INTENTS_SQL, OLD_INTENTS_LITE), [stagingCutoff, after, UPLOADS_BATCH]);
    if (rows.length === 0) break;
    const page = await uploadsPage(deps, at, rows);
    total.intents += page.intents;
    total.removed += page.removed;
    total.deleted += page.deleted;
    if (rows.length < UPLOADS_BATCH) break;
    after = String(rows[rows.length - 1].id);
  }
  return total;
}

async function uploadsPage(deps: Pick<Deps, 'db' | 'files'>, at: Date, rows: Record<string, unknown>[]): Promise<Counts> {
  const keepCutoff = new Date(at.getTime() - INTENT_KEEP_MS);
  const intents = rows.map((row) => ({ ...intentOf(row), createdAt: dateOf(row.created_at) }));

  const staging = intents.flatMap((i) => [i.stagingKey, i.stagingKey.replace(/\/file$/, '/thumb')]).filter(isStagingKey);
  const copied = intents
    .filter((i) => i.usedAt === null && i.expiresAt.getTime() <= at.getTime())
    .flatMap((i) => [i.key, i.thumbKey])
    .filter((key): key is string => key !== null && isObjectKey(key) && !isStagingKey(key));
  const used = await blobKeysInUse(deps.db, copied);
  const keys = [...new Set([...staging, ...copied.filter((key) => !used.has(key))])];
  if (keys.length > 0) await deps.files.remove(keys);

  const old = intents.filter((i) => (i.usedAt ?? i.createdAt).getTime() < keepCutoff.getTime()).map((i) => i.id);
  const deleted = old.length > 0 ? (await deps.db.statement('write', sqlFor(deps.db, INTENTS_DELETE_SQL, INTENTS_DELETE_LITE), [old, keepCutoff])).length : 0;
  return { intents: intents.length, removed: keys.length, deleted };
}
