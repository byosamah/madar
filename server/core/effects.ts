import { SERVER_CALL_NAMES } from '../../src/api/contract/server';
import type { SharedCallName } from '../../src/api/sharedCalls';
import { isLite } from '../data/dialect';
import type { SaveResult } from '../data/save';
import type { Deps, Query } from './ports';

/**
 * Effects after the commit (plan 4.12; task C3). Handlers stay synchronous and pure, so work outside the database (an invitation,
 * a ban in Auth, an email, removing stored file data) goes through the outbox table.
 *
 * - A track registers an outbox producer for a shared call with registerOutbox(name, producer). runCall asks the producers of
 *   the call for their rows after the save step and writes them in the call's transaction, so a rollback leaves no effect.
 * - A server call (one of the 9, for example users.resendInvite or agents.remove) has no producers: runCall never asks for its
 *   rows, so registerOutbox refuses its name (at compile time and at run time). A server write writes its own rows with
 *   writeOutbox(q, rows) inside its own transaction, and calls processOutbox(deps, ids) after its commit.
 * - A track registers the handler of one effect kind with registerEffect(kind, handler). Kinds and owners: auth.invite, auth.ban,
 *   auth.unban, auth.email (P), auth.emailNotice (S), agents.revokeAll (G), mail.notice (N2), r2.delete (F).
 * - The module that registers must be imported by the entry: the call files through server/calls/index.ts, the effect handlers
 *   through server/core/deps.ts.
 * - Claim before work: processOutbox and the job claim a row with one statement first. No row means another worker has it, or
 *   it is done. A failed row keeps its attempts and its error, and stays claimed for 2 minutes; the 15-minute job (track N3)
 *   retries rows older than 2 minutes, up to 5 attempts. usage.get shows the failed rows to the Admin (track M).
 * - A handler that knows when the work can go through (an error with retryAt, for example QuotaFull of a full mail day in
 *   server/auth/effects.ts) keeps its error, and the row stays claimed until retryAt with the attempt given back: a full day
 *   never uses up the 5 attempts of a row (S1 review).
 */

export type OutboxRow = { kind: string; payload: Record<string, unknown> };

/**
 * The effect kinds that runCall runs after the answer on a host with after (performance audit SRV-1, BGR-2): the mails, the browser pushes and the
 * Google Calendar sync (fbk_022), so a save never waits for Resend, for a push service or for Google. Every other kind (auth.*, agents.revokeAll, r2.delete) runs before the answer. With no after
 * (tests, scripts), every kind runs before the answer. A test keeps these names equal to the kinds of mail/ and usage/.
 */
export const AFTER_ANSWER_KINDS: ReadonlySet<string> = new Set(['mail.notice', 'mail.quotaWarning', 'usage.limitWarning', 'push.notify', 'gcal.sync', 'gcal.revoke']);
/**
 * `at` is the time of the call, taken under the office lock (the stamp that the save wrote), for a producer that writes a time. runCall
 * always gives it. It is optional only so that a test can call a producer that writes no time with three arguments.
 */
export type OutboxProducer = (output: unknown, saved: SaveResult, q: Query, at?: Date) => Promise<OutboxRow[]>;
export type EffectHandler = (payload: Record<string, unknown>, deps: Deps) => Promise<void>;
/** Only shared calls: runCall asks their producers. A server call writes its own rows (see above). */
export type OutboxCallName = SharedCallName;

/** The outbox producers of each call. Tracks add to it only through registerOutbox. */
export const EFFECTS_OF: Partial<Record<OutboxCallName, OutboxProducer[]>> = {};
const HANDLERS = new Map<string, EffectHandler>();

/** Adds a producer for a call. The result removes it again (for tests). */
export function registerOutbox(name: OutboxCallName, producer: OutboxProducer): () => void {
  if ((SERVER_CALL_NAMES as readonly string[]).includes(name)) {
    throw new Error(`${name} is a server call: it writes its own outbox rows with writeOutbox and runs processOutbox after its commit.`);
  }
  const list = (EFFECTS_OF[name] ??= []);
  list.push(producer);
  return () => {
    const at = list.indexOf(producer);
    if (at >= 0) list.splice(at, 1);
  };
}

/** Sets the handler of one effect kind. A second handler for the same kind is a wiring bug. The result removes it (for tests). */
export function registerEffect(kind: string, handler: EffectHandler): () => void {
  if (HANDLERS.has(kind)) throw new Error(`An effect handler for ${kind} is already registered.`);
  HANDLERS.set(kind, handler);
  return () => {
    if (HANDLERS.get(kind) === handler) HANDLERS.delete(kind);
  };
}

/** The outbox rows of one call, from every producer of that call in the order they registered. */
export async function outboxRowsOf(name: string, output: unknown, saved: SaveResult, q: Query, at: Date): Promise<OutboxRow[]> {
  const rows: OutboxRow[] = [];
  for (const producer of EFFECTS_OF[name as OutboxCallName] ?? []) rows.push(...(await producer(output, saved, q, at)));
  return rows;
}

export const OUTBOX_INSERT_SQL =
  "insert into outbox (kind, payload) select e->>'kind', e->'payload' from jsonb_array_elements($1::jsonb) with ordinality as t(e, n) order by n returning id";
export const CLAIM_SQL =
  "update outbox set claimed_until = now() + interval '2 minutes', attempts = attempts + 1 where id = $1 and done_at is null and (claimed_until is null or claimed_until < now()) returning *";
export const DONE_SQL = 'update outbox set done_at = now(), error = null where id = $1';
export const FAIL_SQL = 'update outbox set error = $2 where id = $1';
/** $1 id, $2 error, $3 the time to try again. */
export const WAIT_SQL = 'update outbox set error = $2, claimed_until = $3::timestamptz, attempts = greatest(attempts - 1, 0) where id = $1';

/** The SQLite forms (Supabase exit, wave 1). The time comes from deps.clock, as every SQLite time column holds ISO text in UTC. */
export const OUTBOX_ROW_LITE = 'insert into outbox (kind, payload) values (?1, ?2) returning id';
export const CLAIM_LITE =
  'update outbox set claimed_until = ?2, attempts = attempts + 1 where id = ?1 and done_at is null and (claimed_until is null or claimed_until < ?3) returning *';
export const DONE_LITE = 'update outbox set done_at = ?2, error = null where id = ?1';
export const FAIL_LITE = 'update outbox set error = ?2 where id = ?1';
export const WAIT_LITE = 'update outbox set error = ?2, claimed_until = ?3, attempts = max(attempts - 1, 0) where id = ?1';
/** How long a claim holds a row: the 2 minutes of CLAIM_SQL. */
const CLAIM_MS = 2 * 60_000;

/** Writes the rows inside the call's transaction. The ids come back in the order of the rows. */
export async function writeOutbox(q: Query, rows: OutboxRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  if (isLite(q)) {
    // One statement for each row, so the ids come in the order of the rows: RETURNING gives rows in no fixed order.
    const ids: string[] = [];
    for (const row of rows) {
      const [found] = await q<{ id: number }>(OUTBOX_ROW_LITE, [row.kind, JSON.stringify(row.payload)]);
      ids.push(String(found.id));
    }
    return ids;
  }
  const found = await q<{ id: string | number }>(OUTBOX_INSERT_SQL, [JSON.stringify(rows)]);
  return found.map((row) => String(row.id)).sort((a, b) => Number(a) - Number(b));
}

/** The time to try again that an error names, when it names one. */
function retryAtOf(error: unknown): Date | null {
  const at = (error as { retryAt?: unknown } | null)?.retryAt;
  return at instanceof Date && !Number.isNaN(at.getTime()) ? at : null;
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Claims and runs the given outbox rows once, best effort, after the commit (plan 4.5, step 6). Each statement runs on its own,
 * outside every call transaction. A row that fails stays for the job.
 */
export async function processOutbox(deps: Deps, ids: string[]): Promise<{ done: string[]; failed: string[] }> {
  const done: string[] = [];
  const failed: string[] = [];
  const lite = isLite(deps.db);
  for (const id of ids) {
    const now = deps.clock.now();
    const [row] = await deps.db.statement<{ id: string | number; kind: string; payload: Record<string, unknown> }>(
      'write', lite ? CLAIM_LITE : CLAIM_SQL, lite ? [Number(id), new Date(now.getTime() + CLAIM_MS).toISOString(), now.toISOString()] : [id],
    );
    if (!row) continue;
    const handler = HANDLERS.get(row.kind);
    try {
      if (!handler) throw new Error(`No effect handler is registered for ${row.kind}.`);
      await handler(row.payload ?? {}, deps);
      await deps.db.statement('write', lite ? DONE_LITE : DONE_SQL, lite ? [Number(id), deps.clock.now().toISOString()] : [id]);
      done.push(id);
    } catch (error) {
      const message = messageOf(error);
      const retryAt = retryAtOf(error);
      if (retryAt) {
        await deps.db.statement('write', lite ? WAIT_LITE : WAIT_SQL, [lite ? Number(id) : id, message, retryAt.toISOString()]);
        deps.log.warn('An effect after the commit waits. The job tries it again after the time it named.', { id, kind: row.kind, error: message, retryAt: retryAt.toISOString() });
      } else {
        await deps.db.statement('write', lite ? FAIL_LITE : FAIL_SQL, [lite ? Number(id) : id, message]);
        deps.log.warn('An effect after the commit failed. The job tries it again.', { id, kind: row.kind, error: message });
      }
      failed.push(id);
    }
  }
  return { done, failed };
}
