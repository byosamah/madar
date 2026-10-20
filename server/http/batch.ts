import { ApiError } from '../../src/api/errors';
import type { WireEntry, WireResponse } from '../../src/api/remote/wire';
import { nowStamp } from '../../src/lib/dates';
import { requestHost } from '../core/after';
import type { Deps } from '../core/ports';
import type { BatchScope, OfficeSnapshot, Principal, RunRequest, RunResult } from '../core/types';
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
 * - SRV-4: on a host with after (core/after.ts), the meter statement runs after the answer. With no after, it runs before it.
 */

export type BatchOptions = {
  runCall: (deps: Deps, req: RunRequest) => Promise<RunResult>;
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  principalOf: (authUserId: string, office: OfficeSnapshot) => Principal;
  readOffice: (deps: Deps) => Promise<OfficeSnapshot>;
  /** True for a call that writes. Without it, the batch opens no connection early. */
  hasWrite?: (name: string) => boolean;
};

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
  let principal: Principal;
  let batch: BatchScope;
  let calls;
  try {
    checkBuild(request.headers.get('X-Madar-Build') ?? undefined, deps.config.minClientBuild);
    const parsed = parseBatch(await readBody(request));
    calls = parsed.request.calls;
    const { authUserId } = await o.verifyToken(request.headers.get('Authorization'));
    // Only after a good token: a connect reads nothing, and the write transaction then finds the connection open.
    if (o.hasWrite && calls.some((call) => o.hasWrite!(call.name))) void deps.db.warm?.('write').catch(() => undefined);
    const office = await o.readOffice(deps);
    principal = o.principalOf(authUserId, office);
    batch = { storyRefs: new Map(), office, overviewCalls: parsed.overviewCalls };
  } catch (error) {
    logUnexpected(deps, 'The batch failed before its calls.', error);
    return errorResponse(runErrorOf(error));
  }

  const entry = async (call: (typeof calls)[number]): Promise<WireEntry> => {
    let result: RunResult;
    try {
      result = await o.runCall(deps, { principal, name: call.name, input: call.input, story: call.story, key: call.key, batch });
    } catch (error) {
      logUnexpected(deps, 'A call threw outside runCall.', error, { name: call.name });
      result = { ok: false, error: runErrorOf(error) };
    }
    return entryOf(call.i, result);
  };

  const results: WireEntry[] = [];
  for (let at = 0; at < calls.length; ) {
    let end = at + 1;
    if (calls[at].name === LINK_CALL) while (end < calls.length && calls[end].name === LINK_CALL) end += 1;
    results.push(...(end - at === 1 ? [await entry(calls[at])] : await Promise.all(calls.slice(at, end).map(entry))));
    at = end;
  }

  const body: WireResponse = { v: 1, serverTime: nowStamp(deps.clock.now()), results };
  return Response.json(body);
}
