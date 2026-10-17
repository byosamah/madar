import { emptyState, type State } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { pairEventFields } from '../rows';
import { diffState, type SaveResult } from '../save';
import { TABLES, collectionOf } from '../tables';
import { liteWriteDiff } from './save';

/**
 * The whole office in and out of a SQLite office (Supabase exit, wave 1): the test:lite harness, the year office of
 * test:office, and later the import and the restore check. A call never uses these: runCall loads only what its loader names.
 */

/** A State with no record at all, not even the settings, so every record of the State to write is new. */
function blank(): State {
  return { ...emptyState(''), settings: undefined as unknown as State['settings'] };
}

/** Writes every record of a State, as new rows in insertion order. The settings row of the schema is updated. No signal. */
export async function liteWriteState(q: Query, state: State): Promise<SaveResult> {
  const empty = blank();
  return liteWriteDiff(q, diffState(empty, state), empty, state, { signals: false });
}

/** Reads every table into one State, in insertion order, with undoneBy filled from the undo events. */
export async function liteLoadWhole(q: Query, o: { withEvents?: boolean; today?: string } = {}): Promise<State> {
  const withEvents = o.withEvents ?? true;
  const state = { ...emptyState(o.today ?? ''), feedback: {} } as State;
  const lists = state as unknown as Record<string, unknown>;
  for (const spec of TABLES) {
    if (spec.collection === 'events' && !withEvents) continue;
    const rows = await q<{ ord: number; doc: Record<string, unknown> }>(`select rowid as ord, doc from ${spec.table}`);
    rows.sort((a, b) => a.ord - b.ord);
    lists[spec.collection] = collectionOf(spec, rows.map((row) => row.doc));
  }
  for (const event of Object.values(state.events)) {
    pairEventFields(event as unknown as Record<string, unknown>);
    if (event.undoes && state.events[event.undoes]) state.events[event.undoes].undoneBy = event.id;
  }
  const counters = await q<{ prefix: string; n: number }>('select prefix, n from counters');
  state.counters = Object.fromEntries(counters.map((row) => [row.prefix, Number(row.n)]));
  return state;
}
