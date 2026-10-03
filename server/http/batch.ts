import { ApiError } from '../../src/api/errors';
import type { WireEntry, WireResponse } from '../../src/api/remote/wire';
import { nowStamp } from '../../src/lib/dates';
import type { Deps } from '../core/ports';
import type { BatchScope, OfficeSnapshot, Principal, RunRequest, RunResult } from '../core/types';
import { errorResponse, runErrorOf } from './errors';
import { checkBuild, parseBatch, readBody } from './limits';

/**
 * POST /api/batch (plan 4.10): the checks that cost nothing first (build, size, shape, limits), then one sign-in check for
 * the whole batch, then one runCall for each entry in the order sent. Each write is its own transaction inside runCall, so a
 * read after a write in the same batch sees the write. One refused entry never refuses the others. After the last entry,
 * one meter statement of its own, outside every call.
 */

export type BatchOptions = {
  runCall: (deps: Deps, req: RunRequest) => Promise<RunResult>;
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  principalOf: (authUserId: string, office: OfficeSnapshot) => Principal;
  readOffice: (deps: Deps) => Promise<OfficeSnapshot>;
};

function entryOf(i: number, result: RunResult): WireEntry {
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
    const office = await o.readOffice(deps);
    principal = o.principalOf(authUserId, office);
    batch = { storyRefs: new Map(), office, overviewCalls: parsed.overviewCalls };
  } catch (error) {
    logUnexpected(deps, 'The batch failed before its calls.', error);
    return errorResponse(runErrorOf(error));
  }

  const results: WireEntry[] = [];
  for (const call of calls) {
    let result: RunResult;
    try {
      result = await o.runCall(deps, { principal, name: call.name, input: call.input, story: call.story, key: call.key, batch });
    } catch (error) {
      logUnexpected(deps, 'A call threw outside runCall.', error, { name: call.name });
      result = { ok: false, error: runErrorOf(error) };
    }
    results.push(entryOf(call.i, result));
  }

  try {
    await deps.meter.countRequest(deps.db);
  } catch (error) {
    deps.log.warn('The usage meter did not count the request.', { error: error instanceof Error ? error.message : String(error) });
  }

  const body: WireResponse = { v: 1, serverTime: nowStamp(deps.clock.now()), results };
  return Response.json(body);
}
