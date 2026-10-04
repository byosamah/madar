import { emptyState, type State } from '../../src/api/store';
import type { Query } from '../core/ports';
import { COUNTERS_SELECT_SQL, pairEventFields, selectDocsSql } from './rows';
import { diffState, writeDiff, type SaveResult } from './save';
import { TABLES, collectionOf } from './tables';

/**
 * The whole office in and out of the database (task C1): the schema check against zod (plan 4.4), the db-mode harness, the
 * seed of a test office and the restore check. A call never uses these: runCall loads only what its loader names (plan 4.6).
 */

/** A State with no record at all, not even the settings, so every record of the State to write is new. */
function blank(): State {
  return { ...emptyState(''), settings: undefined as unknown as State['settings'] };
}

/**
 * Writes every record of a State through the save step, as new rows in insertion order. The settings row exists from the first
 * migration, so it is updated. It sends no change signal: nobody watches a seed. The office version rises once, so a warm
 * office cache loads again.
 */
export async function writeState(q: Query, state: State): Promise<SaveResult> {
  return writeDiff(q, diffState(blank(), state), { signals: false });
}

/**
 * Reads every table into one State, in insertion order (TM R8). Events keep undoneBy as null in the database, so it is filled
 * here from the undo events that name them (plan 4.3). session, version and seededOn are not in the database; seededOn is "today".
 */
export async function loadWhole(q: Query, o: { withEvents?: boolean; today?: string } = {}): Promise<State> {
  const withEvents = o.withEvents ?? true;
  const state = { ...emptyState(o.today ?? ''), feedback: {} } as State;
  const lists = state as unknown as Record<string, unknown>;
  for (const spec of TABLES) {
    if (spec.collection === 'events' && !withEvents) continue;
    const rows = await q<{ doc: Record<string, unknown> }>(selectDocsSql(spec));
    lists[spec.collection] = collectionOf(spec, rows.map((row) => row.doc));
  }
  for (const event of Object.values(state.events)) {
    pairEventFields(event as unknown as Record<string, unknown>);
    if (event.undoes && state.events[event.undoes]) state.events[event.undoes].undoneBy = event.id;
  }
  const counters = await q<{ prefix: string; n: number | string }>(COUNTERS_SELECT_SQL);
  state.counters = Object.fromEntries(counters.map((row) => [row.prefix, Number(row.n)]));
  return state;
}
