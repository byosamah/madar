import { TABLES, type TableSpec } from '../tables';
import { keyColumnsOf, sqlTypeOf } from './columns';
import type { SqlHost } from './host';

/**
 * The one SQLite schema of the office object (Supabase exit, wave 1), in place of the 18 Postgres migrations. The entity tables
 * come from tables.ts and the loader columns of query.ts. The office object applies it at start, after it reads schema_version:
 * a schema statement writes rows, so the start of a current office runs none. A new office gets the whole schema at once. An
 * older office runs the steps of LITE_STEPS above its version, in one transaction (exit wave 3): each new version needs a step.
 *
 * Rules (wave 0): plain key columns that the save writes; no foreign key; no ANALYZE; ascending indexes, so a backward scan gives
 * created_at desc, id desc and rowid desc with no sort step. Every time column holds ISO text in UTC (Date.toISOString).
 */
export const LITE_SCHEMA_VERSION = 3;

export type LiteIndex = { table: string; name: string; columns: string; unique?: true; where?: string };

/** The read indexes of the loaders. Task 18 of the exit plan cuts the event indexes to the ones that a read needs. */
export const LITE_INDEXES: readonly LiteIndex[] = [
  { table: 'push_devices', name: 'push_devices_endpoint', columns: 'endpoint', unique: true },
  { table: 'push_devices', name: 'push_devices_user', columns: 'user_id' },
  { table: 'tasks', name: 'tasks_project', columns: 'project_id' },
  { table: 'tasks', name: 'tasks_owner', columns: 'owner_id' },
  { table: 'updates', name: 'updates_project_created', columns: 'project_id, created_at' },
  { table: 'comments', name: 'comments_target', columns: 'target_type, target_id, created_at, id' },
  { table: 'comments', name: 'comments_project', columns: 'project_id' },
  { table: 'comments', name: 'comments_target_id', columns: 'target_id' },
  { table: 'files', name: 'files_project', columns: 'project_id' },
  { table: 'files', name: 'files_task', columns: 'task_id' },
  { table: 'tracker', name: 'tracker_project', columns: 'project_id' },
  { table: 'tracker', name: 'tracker_open', columns: 'project_id', where: 'open = 1' },
  { table: 'payments', name: 'payments_project', columns: 'project_id' },
  { table: 'notifications', name: 'notifications_inbox', columns: 'user_id, read, created_at, id' },
  { table: 'notifications', name: 'notifications_story', columns: 'correlation_id' },
  { table: 'notifications', name: 'notifications_target', columns: 'target_type, target_id' },
  { table: 'notifications', name: 'notifications_dedupe', columns: 'dedupe_key', unique: true, where: 'dedupe_key is not null' },
  { table: 'messages', name: 'messages_conversation', columns: 'conversation_id, created_at, id' },
  { table: 'chat_reads', name: 'chat_reads_user', columns: 'user_id' },
  { table: 'events', name: 'events_seq', columns: 'seq', unique: true },
  { table: 'events', name: 'events_target', columns: 'target_type, target_id, seq' },
  { table: 'events', name: 'events_story', columns: 'correlation_id' },
  { table: 'events', name: 'events_project', columns: 'project_id, seq' },
  { table: 'events', name: 'events_undoes', columns: 'undoes' },
  { table: 'events', name: 'events_created_at', columns: 'created_at' },
  { table: 'events', name: 'events_project_created', columns: 'project_id, created_at' },
  { table: 'events', name: 'events_target_id', columns: 'target_id' },
];

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * The day meters of the Free day limits (exit wave 3, server/office/meter.ts): one row for each UTC day, because each Free limit of
 * Durable Objects ends at 00:00 UTC (03:00 Riyadh). requests: office object requests; worker_requests: Worker requests.
 */
const USAGE_DAY_SQL =
  'create table usage_day (day text primary key, rows_read integer not null default 0, rows_written integer not null default 0, '
  + 'requests integer not null default 0, calls integer not null default 0, worker_requests integer not null default 0)';

/** The server tables of 20261004000101_server_tables.sql, 20261004000600_usage_signals.sql and the agent approvals. */
const SERVER_SQL: readonly string[] = [
  'create table counters (prefix text primary key, n integer not null check (n >= 0))',
  'create table office_meta (id integer primary key check (id = 1), version integer not null default 0, office_seq integer not null default 0)',
  'create table office_snapshot (part integer primary key, version integer not null, body text not null)',
  'create table person_seq (user_id text primary key, seq integer not null default 0)',
  `create table stories (id text primary key, actor_id text not null, created_at text not null default (${NOW}))`,
  `create table idempotency (actor_id text not null, key text not null, name text not null, digest text not null, result text not null, created_at text not null default (${NOW}), primary key (actor_id, key))`,
  `create table outbox (id integer primary key, kind text not null, payload text not null, attempts integer not null default 0, claimed_until text, done_at text, error text, created_at text not null default (${NOW}))`,
  `create table upload_intents (id text primary key, actor_id text not null, project_id text, staging_key text not null, key text not null, thumb_key text, size integer not null check (size >= 0), mime_type text not null, expires_at text not null, used_at text, created_at text not null default (${NOW}))`,
  `create table agent_links (client_id text primary key, owner_user_id text not null, agent_user_id text not null, client_name text not null, redirect_host text not null, approved_at text not null default (${NOW}), last_used_at text, revoked_at text)`,
  `create table agent_approvals (client_id text not null, owner_user_id text not null, approved_at text not null default (${NOW}), primary key (client_id, owner_user_id))`,
  `create table mail_log (id integer primary key, utc_day text not null, kind text not null, user_id text, ref text not null, resend_id text, created_at text not null default (${NOW}), unique (utc_day, ref))`,
  `create table mail_outbox (id integer primary key, to_email text not null, tag text not null, idempotency_key text not null unique, mail text not null, created_at text not null default (${NOW}))`,
  'create table usage_month (month text primary key, calls integer not null default 0, bytes_read integer not null default 0, backup_bytes integer, signals_failed integer not null default 0, signals_failed_at text)',
  `create table usage_warnings (month text not null, metric text not null, sent_at text not null default (${NOW}), primary key (month, metric))`,
  'create table rate_limits (key text not null, window_start text not null, count integer not null default 0, primary key (key, window_start))',
  `create table job_runs (key text primary key, done_at text not null default (${NOW}))`,
  USAGE_DAY_SQL,
  'create table schema_version (id integer primary key check (id = 1), version integer not null)',
];

export const SERVER_INDEXES: readonly LiteIndex[] = [
  { table: 'stories', name: 'stories_created', columns: 'created_at' },
  { table: 'idempotency', name: 'idempotency_created', columns: 'created_at' },
  { table: 'outbox', name: 'outbox_open', columns: 'created_at', where: 'done_at is null' },
  { table: 'upload_intents', name: 'upload_intents_open', columns: 'expires_at', where: 'used_at is null' },
  { table: 'agent_links', name: 'agent_links_owner', columns: 'owner_user_id' },
  { table: 'agent_links', name: 'agent_links_agent', columns: 'agent_user_id' },
];

/**
 * The steps of an office with an older schema. The key is the version that the step makes, from the version before it. The texts
 * of a step must leave the same schema as liteSchemaSql of that version, so a stepped office and a new office are equal.
 * Version 2 is the step of wave 2 (the sign-in rows). Version 3 adds the day meters.
 */
export const LITE_STEPS: Readonly<Record<number, readonly string[]>> = {
  3: [USAGE_DAY_SQL],
};

/** The index that a read with atOrAfter names (indexed by), so no other index decides its plan (wave 0: 124,339 rows). */
export const TIME_INDEX: Readonly<Record<string, string>> = { events: 'events_created_at' };

/** The triggers that keep the History append-only. The harness drops them for the test's own edits, then makes them again. */
export const EVENT_GUARDS = ['events_no_update', 'events_no_delete'] as const;

export function eventGuardsSql(): string[] {
  return [
    "create trigger events_no_update before update on events begin select raise(abort, 'events only grow'); end",
    "create trigger events_no_delete before delete on events begin select raise(abort, 'events only grow'); end",
  ];
}

/** The settings of a new office, as the first Postgres migration seeds them (20261004000100_core.sql, line 290). */
export const DEFAULT_SETTINGS = {
  defaultStages: ['Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits', 'Tender', 'Supervision'],
  codePrefix: 'KH',
  workloadLimit: 10,
  staleAfterDays: 30,
} as const;

function entitySql(spec: TableSpec): string {
  const columns = ['id text primary key', 'doc text not null', ...keyColumnsOf(spec).map((name) => `${name} ${sqlTypeOf(spec, name)}`)];
  return `create table ${spec.table} (${columns.join(', ')})`;
}

function indexSql(index: LiteIndex): string {
  return `create ${index.unique ? 'unique ' : ''}index ${index.name} on ${index.table} (${index.columns})${index.where ? ` where ${index.where}` : ''}`;
}

/** The columns of a table that one of its read indexes holds: a long in-list on one of them reads key by key (Task 10). */
export function indexedColumnsOf(table: string): ReadonlySet<string> {
  return new Set(LITE_INDEXES.filter((index) => index.table === table).flatMap((index) => index.columns.split(',').map((name) => name.trim())));
}

export function liteSchemaSql(): string[] {
  return [
    ...TABLES.map(entitySql),
    ...SERVER_SQL,
    ...LITE_INDEXES.map(indexSql),
    ...SERVER_INDEXES.map(indexSql),
    ...eventGuardsSql(),
    'insert into office_meta (id, version, office_seq) values (1, 0, 0)',
    `insert into settings (id, doc) values ('office', '${JSON.stringify(DEFAULT_SETTINGS)}')`,
    `insert into schema_version (id, version) values (1, ${LITE_SCHEMA_VERSION})`,
  ];
}

/** The version row of an office, or undefined for a new office with no tables. One row read: sqlite_master has no index. */
function versionOf(host: SqlHost): number | undefined {
  try {
    const [row] = host.exec('select version from schema_version where id = 1', []).rows;
    return row === undefined ? undefined : Number(row.version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table')) return undefined;
    throw error;
  }
}

/** Makes the schema of a new office, steps an older one up, or checks the version of a current one (each wake of the office object). */
export async function applyLiteSchema(host: SqlHost): Promise<{ applied: boolean; steps?: number[] }> {
  const version = versionOf(host);
  if (version === LITE_SCHEMA_VERSION) return { applied: false };
  if (version !== undefined && version > LITE_SCHEMA_VERSION) {
    throw new Error(`The SQLite schema of this office is version ${version}, and this build knows version ${LITE_SCHEMA_VERSION}. Deploy the newer build.`);
  }
  if (version !== undefined) {
    const steps: number[] = [];
    for (let next = version + 1; next <= LITE_SCHEMA_VERSION; next += 1) {
      if (!LITE_STEPS[next]) throw new Error(`This build has no schema step to version ${next} (server/data/lite/schema.ts, LITE_STEPS).`);
      steps.push(next);
    }
    await host.transaction(async () => {
      for (const next of steps) for (const text of LITE_STEPS[next]) host.exec(text, []);
      host.exec('update schema_version set version = ? where id = 1', [LITE_SCHEMA_VERSION]);
    });
    return { applied: true, steps };
  }
  await host.transaction(async () => {
    for (const text of liteSchemaSql()) host.exec(text, []);
  });
  return { applied: true };
}
