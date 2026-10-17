import { ApiError } from '../../src/api/errors';
import type { WireCall, WireEntry, WireResponse } from '../../src/api/remote/wire';
import { nowStamp } from '../../src/lib/dates';
import { AFTER_ANSWER_KINDS, processOutbox } from '../core/effects';
import type { Deps } from '../core/ports';
import type { CallData, CallTx, RunCall } from '../core/runCall';
import type { BatchScope, OfficeSnapshot, Principal, RunError, RunResult } from '../core/types';
import { liteData } from '../data/lite/callData';
import { entryOf } from '../http/batch';
import { runErrorOf } from '../http/errors';
import type { OfficeMeter } from './meter';
import type { OfficeWho } from './who';

/**
 * One batch inside the office object (exit wave 3): the rules of handleBatch (server/http/batch.ts) with runCall on SQLite. The
 * Worker checked the build, the body and the token; the object finds the person, runs the entries one after the other, and gives
 * back the answer as JSON text, so the Worker sends it on with no work (10 ms of CPU on Free). The effects that runCall hands to
 * afterCommit wait in the ledger: the other kinds run before the answer, the mails and pushes after it (AFTER_ANSWER_KINDS), in a
 * second call of the Worker (runEffects).
 */

export type OfficeBatchInput = { who: OfficeWho; calls: WireCall[]; overviewCalls: number; worker: number };
export type OfficeBatchOutput = { ok: true; body: string; later: string[] } | { ok: false; error: RunError };

/** The outbox rows of one batch: the kind of each row that a call wrote, and the rows whose transaction committed. */
export class EffectLedger {
  readonly #kinds = new Map<string, string>();
  readonly #done: string[] = [];

  wrote(ids: readonly string[], kinds: readonly string[]): void {
    ids.forEach((id, i) => this.#kinds.set(id, kinds[i]));
  }

  committed(ids: readonly string[]): void {
    this.#done.push(...ids);
  }

  split(): { now: string[]; later: string[] } {
    const later = this.#done.filter((id) => AFTER_ANSWER_KINDS.has(this.#kinds.get(id) ?? ''));
    return { now: this.#done.filter((id) => !later.includes(id)), later };
  }
}

/** liteData with two additions: the kinds of the outbox rows go into the ledger, and each write adds the pending meter counts. */
export function officeData(o: { meter: OfficeMeter; ledgerOf: (deps: Deps) => EffectLedger | undefined }): (deps: Deps) => CallData {
  return (deps) => {
    const base = liteData(deps);
    return {
      office: base.office,
      tx: (mode, work) =>
        base.tx(mode, async (t) => {
          const wrapped: CallTx = {
            q: t.q,
            lock: t.lock,
            office: t.office,
            source: t.source,
            save: t.save,
            stories: t.stories,
            keys: t.keys,
            outbox: async (rows) => {
              const ids = await t.outbox(rows);
              o.ledgerOf(deps)?.wrote(ids, rows.map((row) => row.kind));
              return ids;
            },
          };
          const out = await work(wrapped);
          if (mode === 'write') await o.meter.flush(t.q, deps.clock.now());
          return out;
        }),
    };
  };
}

function logUnexpected(deps: Deps, message: string, error: unknown, fields: Record<string, unknown> = {}): void {
  if (error instanceof ApiError) return;
  deps.log.error(message, { ...fields, error: error instanceof Error ? error.message : String(error) });
}

export async function runOfficeBatch(
  deps: Deps,
  input: OfficeBatchInput,
  o: { run: RunCall; data: CallData; principal: (who: OfficeWho, office: OfficeSnapshot) => Principal; ledger: EffectLedger },
): Promise<(OfficeBatchOutput & { ok: false }) | { ok: true; body: string; later: string[]; officeChanged: boolean }> {
  let principal: Principal;
  let batch: BatchScope;
  try {
    const office = await o.data.office();
    principal = o.principal(input.who, office);
    batch = { storyRefs: new Map(), office, overviewCalls: input.overviewCalls };
  } catch (error) {
    logUnexpected(deps, 'The batch failed before its calls.', error);
    return { ok: false, error: runErrorOf(error) };
  }
  const results: WireEntry[] = [];
  // A write that changes the office clears batch.office, and a later read of the same batch loads the office again and sets it.
  // So the flag is set after each entry: the end state alone would hide the change, and the sockets of a person whom the batch
  // turned off would stay open (security check of ebd74fe).
  let officeChanged = false;
  for (const call of input.calls) {
    let result: RunResult;
    try {
      result = await o.run(deps, { principal, name: call.name, input: call.input, story: call.story, key: call.key, batch });
    } catch (error) {
      logUnexpected(deps, 'A call threw outside runCall.', error, { name: call.name });
      result = { ok: false, error: runErrorOf(error) };
    }
    if (batch.office === undefined) officeChanged = true;
    results.push(entryOf(call.i, result));
  }
  const { now, later } = o.ledger.split();
  if (now.length > 0) {
    try {
      await processOutbox(deps, now);
    } catch (error) {
      deps.log.warn('The effects after the commit did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const body: WireResponse = { v: 1, serverTime: nowStamp(deps.clock.now()), results };
  return { ok: true, body: JSON.stringify(body), later, officeChanged };
}
