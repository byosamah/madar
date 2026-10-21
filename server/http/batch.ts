import { ApiError } from '../../src/api/errors';
import type { WireCall, WireEntry, WireResponse } from '../../src/api/remote/wire';
import { nowStamp } from '../../src/lib/dates';
import { requestHost } from '../core/after';
import type { Deps, Query } from '../core/ports';
import type { BatchScope, OfficeSnapshot, OpenRead, Principal, RunRequest, RunResult } from '../core/types';
import { errorResponse, runErrorOf } from './errors';
import { checkBuild, parseBatch, readBody } from './limits';

/**
 * POST /api/batch (plan 4.10): the checks that cost nothing first (build, size, shape, limits), then one sign-in check for
 * the whole batch, then one runCall for each entry in the order sent. Each write is its own transaction inside runCall, so a
 * read after a write in the same batch sees the write. One refused entry never refuses the others. After the last entry,
 * one meter statement of its own, outside every call.
 *
 * Speed (performance audit 2026-10-07):
 * - SRV-M2: a batch with a write opens the write connection after the token check, beside the sign-in read. A refused token
 *   opens nothing.
 * - SRV-6: a run of adjacent files.link entries (the covers of a screen) runs side by side. Each is a read with no lock, and each
 *   keeps its own error. Every other entry runs alone, in the order sent.
 * - SV-11: before such a run, one statement reads the files of the whole run (prefetchRun). Each link then finds its record in the
 *   batch and sends no read of its own. The records are dropped after the run.
 * - SRV-4: on a host with after (core/after.ts), the meter statement runs after the answer. With no after, it runs before it.
 * - SV-5: when the first call is a plain read (joinFirst), it runs in the transaction of the sign-in read: one begin, one
 *   office_meta read and one commit less. Only the first call joins, so a read after a write still opens its own transaction
 *   and sees the write (FET-3). A failed first call rolls the transaction back, so no later entry can meet an aborted one.
 */

export type BatchOptions = {
  runCall: (deps: Deps, req: RunRequest) => Promise<RunResult>;
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  principalOf: (authUserId: string, office: OfficeSnapshot) => Principal;
  /** q: the open transaction of the sign-in read, when the first call joins it. Without q, a read of its own. */
  readOffice: (deps: Deps, q?: Query) => Promise<OfficeSnapshot>;
  /** True for a call that writes. Without it, the batch opens no connection early. */
  hasWrite?: (name: string) => boolean;
  /** True for a first call that may run in the sign-in transaction (joinsFirstRead). Without it, no call joins. */
  joinFirst?: (name: string) => boolean;
  /** Reads what a run of adjacent files.link entries needs with one statement, before the run (SV-11). Without it, each link reads its own file. */
  prefetchRun?: (deps: Deps, batch: BatchScope, principal: Principal, run: WireCall[]) => Promise<void>;
};

/** Thrown inside the sign-in transaction after a first call that failed, to roll it back. handleBatch catches it. */
class JoinedFailure extends Error {}

/** The server call that signs a download link. Its entries of one run go side by side. */
const LINK_CALL = 'files.link';

export function entryOf(i: number, result: RunResult): WireEntry {
  if (!result.ok) return { i, ok: false, error: result.error };
  const entry: WireEntry = { i, ok: true, output: result.output };
  if (result.storyId !== undefined) entry.storyId = result.storyId;
  if (result.changed !== undefined) entry.changed = result.changed;
  if (result.signals !== undefined && result.signals.length > 0) entry.signals = result.signals;
  return entry;
}

function logUnexpected(deps: Deps, message: string, error: unknown, fields: Record<string, unknown> = {}): void {
  if (error instanceof ApiError) return;
  deps.log.error(message, { ...fields, error: error instanceof Error ? error.message : String(error) });
}

export async function handleBatch(request: Request, deps: Deps, o: BatchOptions): Promise<Response> {
  // Set in the try below, which returns an error answer when it does not finish.
  let principal!: Principal;
  let batch!: BatchScope;
  let calls!: WireCall[];
  let firstEntry = undefined as WireEntry | undefined;

  const entry = async (call: WireCall, open?: OpenRead): Promise<WireEntry> => {
    let result: RunResult;
    try {
      result = await o.runCall(deps, { principal, name: call.name, input: call.input, story: call.story, key: call.key, batch, ...(open ? { open } : {}) });
    } catch (error) {
      logUnexpected(deps, 'A call threw outside runCall.', error, { name: call.name });
      result = { ok: false, error: runErrorOf(error) };
    }
    return entryOf(call.i, result);
  };

  try {
    checkBuild(request.headers.get('X-Madar-Build') ?? undefined, deps.config.minClientBuild);
    const parsed = parseBatch(await readBody(request));
    calls = parsed.request.calls;
    const { authUserId } = await o.verifyToken(request.headers.get('Authorization'));
    // Only after a good token: a connect reads nothing, and the write transaction then finds the connection open.
    if (o.hasWrite && calls.some((call) => o.hasWrite!(call.name))) void deps.db.warm?.('write').catch(() => undefined);
    if (calls.length > 0 && o.joinFirst?.(calls[0].name) === true) {
      // SV-5: the sign-in read and the first call share one read transaction. A failed first call rolls it back.
      const joined = calls[0];
      await deps.db
        .tx('read', async (q) => {
          const office = await o.readOffice(deps, q);
          principal = o.principalOf(authUserId, office);
          batch = { storyRefs: new Map(), office, overviewCalls: parsed.overviewCalls };
          firstEntry = await entry(joined, { q });
          if (!firstEntry.ok) throw new JoinedFailure();
        })
        .catch((error: unknown) => {
          if (!(error instanceof JoinedFailure)) throw error;
        });
    } else {
      const office = await o.readOffice(deps);
      principal = o.principalOf(authUserId, office);
      batch = { storyRefs: new Map(), office, overviewCalls: parsed.overviewCalls };
    }
  } catch (error) {
    logUnexpected(deps, 'The batch failed before its calls.', error);
    return errorResponse(runErrorOf(error));
  }

  const results: WireEntry[] = [];
  let start = 0;
  if (firstEntry) {
    results.push(firstEntry);
    start = 1;
  }
  for (let at = start; at < calls.length; ) {
    let end = at + 1;
    if (calls[at].name === LINK_CALL) while (end < calls.length && calls[end].name === LINK_CALL) end += 1;
    if (end - at === 1) {
      results.push(await entry(calls[at]));
    } else {
      const run = calls.slice(at, end);
      await o.prefetchRun?.(deps, batch, principal, run);
      try {
        results.push(...(await Promise.all(run.map((call) => entry(call)))));
      } finally {
        batch.files = undefined;
      }
    }
    at = end;
  }

  const body: WireResponse = { v: 1, serverTime: nowStamp(deps.clock.now()), results };
  return Response.json(body);
}
