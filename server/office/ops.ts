import { z } from 'zod';
import { ApiError } from '../../src/api/errors';
import type { WireCall } from '../../src/api/remote/wire';
import type { ReadEnv } from '../core/deps';
import { serverCallMap } from '../core/serverCallMap';
import { copyOfPageHost, copyOfSupabaseUrl } from '../core/serverHost';
import type { RunError } from '../core/types';
import type { LiteDb } from '../data/lite/db';
import type { SqlValue } from '../data/lite/host';
import { liteSchemaSql } from '../data/lite/schema';
import { runErrorOf } from '../http/errors';

/**
 * The office ops of the object (Supabase exit, wave 4): the hold of an export or an import, the pages of an export, and the test
 * reads. The Worker checks the secret header and hands each step here (server/entries/officeWorker.ts). The hold lives in memory:
 * an object that restarts loses it, and the next step of that export or import gets hold_ended, so the client starts again.
 */

function tablesOf(): { name: string; alias?: string }[] {
  return liteSchemaSql().flatMap((text) => {
    const match = /^create table (\w+) \((\w+) (integer primary key)?/.exec(text);
    return match ? [{ name: match[1], ...(match[3] ? { alias: match[2] } : {}) }] : [];
  });
}

/** The tables that an export leaves out: the snapshot comes back from the tables, and the schema step makes the version row. */
export const EXPORT_SKIP: readonly string[] = ['office_snapshot', 'schema_version'];

/** Every table of the schema, in schema order, but the ones of EXPORT_SKIP. */
export const EXPORT_TABLES: readonly string[] = tablesOf().map((t) => t.name).filter((name) => !EXPORT_SKIP.includes(name));

/** The tables whose integer primary key is the rowid: a restore writes that column, and no rowid beside it. */
export const ROWID_ALIAS: ReadonlyMap<string, string> = new Map(tablesOf().flatMap((t) => (t.alias ? [[t.name, t.alias] as const] : [])));

/**
 * The tables that may change while an export holds the office: the sign-in rows (a refresh, a consent), the mail and the outbox
 * (the effects of a write that came before the hold), the limits and the meters. Their rows are what the export read; a count
 * that differs from the live office is a note, never a failure (the rule of OUTSIDE_OFFICE_LOCK of the Postgres backup).
 */
export const DRIFT_TABLES: readonly string[] = [
  'auth_users', 'auth_links', 'auth_sessions', 'oauth_clients', 'oauth_requests', 'agent_approvals', 'rate_limits', 'outbox', 'mail_log',
  'mail_outbox', 'usage_day', 'usage_month', 'usage_warnings', 'agent_confirms',
];

/** An export holds the office for at most 5 minutes (spec section 2); an import for at most 30 minutes. */
export const HOLD_MS = { export: 5 * 60_000, import: 30 * 60_000 } as const;
export type HoldKind = keyof typeof HOLD_MS;

export const BACKUP_BUSY = new ApiError('failed', 'Madar saves its nightly backup. Try again in a few minutes.', { reason: 'busy' });
export const IMPORT_BUSY = new ApiError('failed', 'Madar loads the office data. Try again in a few minutes.', { reason: 'busy' });
const HOLD_ENDED = new ApiError('conflict', 'This export or import ended. Start it again.', { reason: 'hold_ended' });
const HELD = new ApiError('conflict', 'An export or an import holds the office already. Try again when it ends.', { reason: 'busy' });

function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type Held = { id: string; kind: HoldKind; until: number };

export class OfficeHold {
  #held: Held | undefined;

  begin(kind: HoldKind, now: Date): string {
    if (this.active(now)) throw HELD;
    const id = newId();
    this.#held = { id, kind, until: now.getTime() + HOLD_MS[kind] };
    return id;
  }

  active(now: Date): Held | undefined {
    const held = this.#held;
    return held && now.getTime() < held.until ? held : undefined;
  }

  /** Throws hold_ended unless this id holds the office now. */
  check(id: string, now: Date): void {
    if (this.active(now)?.id !== id) throw HOLD_ENDED;
  }

  end(id: string): void {
    if (this.#held?.id === id) this.#held = undefined;
  }

  /** The refusal of a batch, a route or a Cron run: an export refuses writes only, an import refuses every call. */
  refusal(o: { now: Date; writes: boolean }): RunError | undefined {
    const held = this.active(o.now);
    if (!held || (held.kind === 'export' && !o.writes)) return undefined;
    return runErrorOf(held.kind === 'export' ? BACKUP_BUSY : IMPORT_BUSY);
  }
}

/** True when a call of the batch writes: a call that the map does not know counts as a write (it fails anyway). */
export function writesIn(calls: readonly Pick<WireCall, 'name'>[]): boolean {
  return calls.some((call) => serverCallMap.get(call.name)?.readOnly !== true);
}

export const EXPORT_PAGE_ROWS = 1_000;
/** About 4 MB of text in one answer: the Worker passes the body on as a stream, so its 128 MB and 10 ms of CPU stay free. */
export const EXPORT_PAGE_CHARS = 4_000_000;

export type ExportStep = { step: 'begin' } | { step: 'page'; id: string; table: string; after: number } | { step: 'end'; id: string };
export type ExportBegin = { id: string; schema: number; version: number; officeSeq: number; tables: string[]; until: string };
export type ExportPage = { rows: Record<string, SqlValue>[]; next: number | null };
export type ExportEnd = { version: number; officeSeq: number };

const HOLD_ID = z.string().regex(/^[0-9a-f]{32}$/);

/** The shape of one export step: a table is checked against EXPORT_TABLES too, so no other text reaches the SQL. */
export const ExportStepShape: z.ZodType<ExportStep> = z.discriminatedUnion('step', [
  z.object({ step: z.literal('begin') }),
  z.object({ step: z.literal('page'), id: HOLD_ID, table: z.string(), after: z.number().int().min(0) }),
  z.object({ step: z.literal('end'), id: HOLD_ID }),
]);

/** The step of a body, or invalid_input. */
export function exportStepOf(body: unknown): ExportStep {
  const parsed = ExportStepShape.safeParse(body);
  if (!parsed.success) throw new ApiError('invalid_input', 'An export step is begin, page (id, table, after) or end (id).');
  return parsed.data;
}

/**
 * One page of a table: the rows after a rowid, in rowid order, with the rowid as _rowid. The rowid order is the order of the table
 * itself (no sort step, the test reads the plan), and the limit cuts it: the one form of order by that the wave 0 rule allows. The
 * host reads the raw values, so a JSON column comes back as its text, byte for byte.
 */
export function exportPage(db: LiteDb, table: string, after: number): ExportPage {
  if (!EXPORT_TABLES.includes(table)) throw new ApiError('invalid_input', `The export has no table ${table}.`);
  const { rows } = db.host.exec(`select rowid as _rowid, * from ${table} where rowid > ?1 order by rowid limit ?2`, [after, EXPORT_PAGE_ROWS]);
  const kept: Record<string, SqlValue>[] = [];
  let chars = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (kept.length > 0 && chars + size > EXPORT_PAGE_CHARS) return { rows: kept, next: Number(kept[kept.length - 1]._rowid) };
    kept.push(row);
    chars += size;
  }
  return { rows: kept, next: rows.length === EXPORT_PAGE_ROWS ? Number(kept[kept.length - 1]._rowid) : null };
}

/** The version and the signal number of the office: the begin and the end of an export compare them. */
export const META_ROW_LITE = 'select version, office_seq from office_meta where id = 1';

export const PEEK_ROWS = 200;

/** One select of a test, at most 200 rows: the deploy suite on the office path reads its checks this way. */
export async function peek(db: LiteDb, text: string, values: readonly unknown[]): Promise<Record<string, unknown>[]> {
  if (!/^\s*select\b/i.test(text) || text.includes(';')) throw new ApiError('invalid_input', 'peek runs one select only.');
  const rows = await db.statement<Record<string, unknown>>('read', text, [...values]);
  return rows.slice(0, PEEK_ROWS);
}

/**
 * The test tools (the replace mode of the import, peek): only with MADAR_TEST_TOOLS = "on", and never on a copy whose Supabase
 * project or app address is production. wrangler.server.toml sets the var for the test Worker only (Task 18 of wave 4 pins it).
 */
export function testToolsOn(read: ReadEnv): boolean {
  if (read('MADAR_TEST_TOOLS') !== 'on') return false;
  let appHost = '';
  try {
    appHost = new URL(read('APP_URL') ?? '').hostname;
  } catch {
    appHost = '';
  }
  return copyOfSupabaseUrl(read('SUPABASE_URL') ?? '') !== 'production' && copyOfPageHost(appHost) !== 'production';
}

/** The header of the Worker that names the object of an op (the drop step checks it). */
export const OFFICE_NAME_HEADER = 'x-madar-office-name';
/** The name of a spare object of the production rehearsal (wave 5): rehearsal-YYYYMMDD. */
export const REHEARSAL_NAME = /^rehearsal-\d{8}$/;
