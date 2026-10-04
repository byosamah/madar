import { ApiError } from '../../../src/api/errors';
import { executeParsed, resolveAuthority } from '../../../src/api/execute';
import { sharedCalls, type SharedCallName } from '../../../src/api/sharedCalls';
import type { State } from '../../../src/api/store';
import { snapshotOf } from '../officeCache';
import { diffState } from '../save';
import { loadFor } from './index';
import { memorySource } from './memorySource';
import type { Source } from './source';

/**
 * The check of plan 4.6 "Safety net" for one call (task C2): run the handler on the whole office and on the State that its
 * loader reads, and compare the answer and the change that the save step would write. The loader tests use the memory source;
 * server/it/loaders.it.test.ts uses the database. The db-mode shadow run (track D) does the same for every API test.
 */

export type Outcome = { output?: unknown; error?: { code: string; message: string } };
export type Change = { table: string; inserted: string[]; updated: string[]; deleted: string[]; docs: unknown[] };
export type Run = { outcome: Outcome; changes: Change[] | { history: string }; counters?: Record<string, number> };

export type RunOptions = { now: Date; correlationId?: string; prepared?: unknown };

/** Runs one call on a State in place, as the fake API and runCall do (execute.ts). */
export function runOn(state: State, name: SharedCallName, parsed: unknown, actorId: string, o: RunOptions): Outcome {
  const def = sharedCalls[name];
  try {
    const { authority } = resolveAuthority(state, actorId, def);
    const output = executeParsed(def, name, parsed, state, {
      actorId, authorityId: authority.id, correlationId: o.correlationId ?? 'cor_compare', now: o.now, persistent: true,
    }, o.prepared);
    return { output: JSON.parse(JSON.stringify(output)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: { code: error.code, message: error.message } };
    return { error: { code: 'crash', message: error instanceof Error ? error.message : String(error) } };
  }
}

/** The rows that the save step would write for a change, by table. */
export function changesOf(before: State, after: State): Run['changes'] {
  try {
    const diff = diffState(before, after);
    return diff.tables.map((change) => ({
      table: change.spec.table, inserted: change.inserted, updated: change.updated, deleted: change.deleted, docs: change.upserts.map((row) => row.doc),
    }));
  } catch (error) {
    return { history: error instanceof Error ? error.message : String(error) };
  }
}

/** The run on the whole office, and the run on the scoped load. A test expects them to be equal. */
export async function runBoth(
  office: State, name: SharedCallName, input: unknown, actorId: string, o: RunOptions & { source?: Source },
): Promise<{ whole: Run; scoped: Run; loaded: State }> {
  const def = sharedCalls[name];
  const parsed = def.input.parse(input);
  const write = !def.readOnly;

  const whole = structuredClone(office);
  const wholeBefore = structuredClone(whole);
  const wholeOutcome = runOn(whole, name, parsed, actorId, o);

  const loaded = await loadFor(name, parsed, { src: o.source ?? memorySource(office), office: snapshotOf(office, 1), actorId, write });
  const scoped = structuredClone(loaded);
  const scopedOutcome = runOn(scoped, name, parsed, actorId, o);

  const countersOf = (before: State, after: State) =>
    Object.fromEntries(Object.entries(after.counters).filter(([prefix, n]) => before.counters[prefix] !== n));
  return {
    whole: { outcome: wholeOutcome, changes: write ? changesOf(wholeBefore, whole) : [], ...(write ? { counters: countersOf(wholeBefore, whole) } : {}) },
    scoped: { outcome: scopedOutcome, changes: write ? changesOf(loaded, scoped) : [], ...(write ? { counters: countersOf(loaded, scoped) } : {}) },
    loaded,
  };
}
