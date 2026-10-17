import { OUTBOX_INSERT_SQL, OUTBOX_ROW_LITE, registerEffect, registerOutbox, type OutboxProducer } from '../core/effects';
import type { Db, Deps, Query } from '../core/ports';
import { isLite, sqlFor } from '../data/dialect';
import { isObjectKey } from './keys';

/**
 * Removing stored file data (plan 5.2, "Delete"; plan 4.12; task F2). The kind keeps its plan name r2.delete, and the handler
 * works on both stores through FilesPort.
 *
 * - A project delete: its prepare hook (server/calls/files.ts) lists every stored key of the project inside the lock, and the
 *   outbox producer below writes one r2.delete row in the same transaction. After the commit, the handler removes the keys that
 *   no file and no report still uses. A rollback leaves no row, so a failed delete removes nothing.
 * - A refused upload: the preflight removes the object at once, and writes an r2.delete row for the job when the store fails.
 *
 * This module registers both when it loads. server/calls/files.ts imports it, so every entry that runs calls has them.
 */

/** The keys of this list that a file version (its data or its picture) or a report screenshot still uses (access map 7.2). */
export const KEYS_IN_USE_SQL =
  'select k as key from unnest($1::text[]) as k where exists ('
  + "select 1 from files f where f.doc->'versions' @> jsonb_build_array(jsonb_build_object('blobKey', k)) "
  + "or f.doc->'versions' @> jsonb_build_array(jsonb_build_object('thumbKey', k))"
  + ") or exists (select 1 from feedback b where b.doc->'screenshots' @> jsonb_build_array(jsonb_build_object('blobKey', k)))";

/** The versions of a project's files, and the versions that its file events remember (src/api/handlers/projects.ts, blobKeysOf). */
export const PROJECT_KEYS_SQL =
  "select doc->'versions' as versions from files where project_id = $1 "
  + "union all select doc->'before'->'versions' from events where project_id = $1 and target_type = 'file' "
  + "union all select doc->'after'->'versions' from events where project_id = $1 and target_type = 'file'";

// The SQLite forms (Supabase exit, wave 1). A scan of the files and the reports: r2.delete runs only after a project delete or a
// refused upload. Every JSON function reads the doc with a full path (the fullkey of json_each), as pathMatch of compile.ts does.
export const KEYS_IN_USE_LITE =
  'select k.value as key from json_each(?1) k where exists ('
  + "select 1 from files f, json_each(f.doc, '$.versions') v where json_type(f.doc, '$.versions') = 'array' and v.type = 'object' "
  + "and (json_extract(f.doc, v.fullkey || '.blobKey') = k.value or json_extract(f.doc, v.fullkey || '.thumbKey') = k.value)"
  + ") or exists (select 1 from feedback b, json_each(b.doc, '$.screenshots') s where json_type(b.doc, '$.screenshots') = 'array' "
  + "and s.type = 'object' and json_extract(b.doc, s.fullkey || '.blobKey') = k.value)";
/** -> gives JSON text also for a string, so the Db can parse each value (json_extract gives a string as plain text). */
export const PROJECT_KEYS_LITE =
  "select doc -> '$.versions' as versions from files where project_id = ?1 "
  + "union all select doc -> '$.before.versions' from events where project_id = ?1 and target_type = 'file' "
  + "union all select doc -> '$.after.versions' from events where project_id = ?1 and target_type = 'file'";

export async function blobKeysInUse(db: Db, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.statement<{ key: string }>('read', sqlFor(db, KEYS_IN_USE_SQL, KEYS_IN_USE_LITE), [keys]);
  return new Set(rows.map((row) => row.key));
}

/** The handler of r2.delete: removes the keys that nothing uses any more. A value that is not an object key is in no store. */
export async function removeStoredData(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const keys = (Array.isArray(payload.keys) ? payload.keys : []).filter((key): key is string => typeof key === 'string' && isObjectKey(key));
  if (keys.length === 0) return;
  const used = await blobKeysInUse(deps.db, keys);
  const gone = keys.filter((key) => !used.has(key));
  if (gone.length > 0) await deps.files.remove(gone);
}

/** Removes the objects of a refused upload now; when the store fails, an r2.delete row lets the job try again. Never throws. */
export async function removeNowOrLater(deps: Deps, keys: string[]): Promise<void> {
  try {
    await deps.files.remove(keys);
  } catch (error) {
    deps.log.warn('A refused upload was not removed. The job removes it later.', { error: error instanceof Error ? error.message : String(error) });
    try {
      if (isLite(deps.db)) await deps.db.statement('write', OUTBOX_ROW_LITE, ['r2.delete', JSON.stringify({ keys })]);
      else await deps.db.statement('write', OUTBOX_INSERT_SQL, [JSON.stringify([{ kind: 'r2.delete', payload: { keys } }])]);
    } catch (again) {
      deps.log.error('A refused upload has no r2.delete row. The job deletes old staging objects.', { error: again instanceof Error ? again.message : String(again) });
    }
  }
}

type Versions = { versions: unknown };

/** Every data key and picture key of these version lists, once each, in the order found. */
export function keysOfVersions(rows: Versions[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.versions)) continue;
    for (const version of row.versions as { blobKey?: unknown; thumbKey?: unknown }[]) {
      if (typeof version?.blobKey === 'string') keys.add(version.blobKey);
      if (typeof version?.thumbKey === 'string') keys.add(version.thumbKey);
    }
  }
  return [...keys];
}

export async function projectBlobKeys(q: Query, projectId: string): Promise<string[]> {
  return keysOfVersions(await q<Versions>(sqlFor(q, PROJECT_KEYS_SQL, PROJECT_KEYS_LITE), [projectId]));
}

/**
 * The keys that the prepare hook of projects.delete found, by the query of its transaction. runCall passes the same query to the
 * prepare hook and to the outbox producers of one call (server/core/runCall.ts), and a query lives only as long as its transaction.
 */
const projectKeys = new WeakMap<Query, string[]>();

export function stashProjectKeys(q: Query, keys: string[]): void {
  projectKeys.set(q, keys);
}

export const projectDeleteOutbox: OutboxProducer = async (_output, _saved, q) => {
  const keys = projectKeys.get(q);
  projectKeys.delete(q);
  return keys && keys.length > 0 ? [{ kind: 'r2.delete', payload: { keys } }] : [];
};

registerEffect('r2.delete', removeStoredData);
registerOutbox('projects.delete', projectDeleteOutbox);
