import { sharedCalls, type SharedCallName } from '../../src/api/sharedCalls';
import type { State } from '../../src/api/store';
import type { RunResult } from '../core/types';
import { changesOf, runBoth, type Change, type Run } from '../data/loaders/compare';

/**
 * The shadow run of the db-mode harness (TM 3.5, check 1; task D1). After each call on the database, the same call runs in
 * memory on the whole office as it was before the call, and the answer and the saved change must be the same. A difference shows
 * a loader that left out a record, or a save step that dropped a change (plan 4.6, "Safety net").
 *
 * It reuses runBoth of C2 (server/data/loaders/compare.ts): one run on the whole office, one on the scoped load that the memory
 * source gives. The run on the whole office is the reference. The scoped run only helps the message: when it agrees with the whole
 * office, the SQL side (sqlSource or the save step) differs; when it does not, the loader of the call leaves something out.
 *
 * It ignores only what TM 3.5 allows: the story ID (the whole run takes the story of the database call) and random blob keys.
 * It also takes the one refusal that the server gives on purpose before any rule: account_off for a person who is off.
 * A call whose run reads the prepared value of a server hook (files.upload, feedback.send, feedback.screenshot) is not shadowed:
 * that value comes from storage work that the memory run does not repeat. The harness passes readsPrepared: true for those. A
 * hook that only feeds the step after the commit (projects.delete) changes nothing in the run, so that call is shadowed.
 */

export type ShadowCase = {
  name: string;
  /** The input as the database call got it, story IDs already in their server form. */
  input: unknown;
  actorId: string;
  now: Date;
  /** The whole office before the call, as the database held it. */
  office: State;
  result: RunResult;
  /** The whole office after the call, read back from the database. */
  after: State;
  readsPrepared?: boolean;
};

/** True when the run of a call takes the prepared value of its server hook (its third parameter), which the memory run lacks. */
export function readsPrepared(entry: { hooks?: unknown; def: { run: (...args: never[]) => unknown } }): boolean {
  return entry.hooks !== undefined && entry.def.run.length > 2;
}

/** Output fields that differ on the server on purpose: session.get returns the limits of the active file store. */
const OUTPUT_IGNORES: Partial<Record<string, readonly string[]>> = { 'session.get': ['limits'] };
const BLOB_FIELDS = new Set(['blobKey', 'thumbKey']);

/** JSON with sorted keys, without undefined, with blob keys replaced. */
function normal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normal);
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(rec)
        .filter((key) => rec[key] !== undefined)
        .sort()
        .map((key) => [key, BLOB_FIELDS.has(key) && typeof rec[key] === 'string' ? '<blob>' : normal(rec[key])]),
    );
  }
  return value;
}

function withoutFields(value: unknown, fields: readonly string[] | undefined): unknown {
  if (!fields || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const rec = { ...(value as Record<string, unknown>) };
  for (const field of fields) delete rec[field];
  return rec;
}

/** The first place where two values differ, as "path: a | b", or undefined when they are equal. */
export function firstDifference(a: unknown, b: unknown, path = ''): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  const isObj = (v: unknown) => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(ra), ...Object.keys(rb)])]) {
      const found = firstDifference(ra[key], rb[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  const show = (v: unknown) => (v === undefined ? 'absent' : JSON.stringify(v).slice(0, 160));
  return `${path || '(top)'}: ${show(a)} | ${show(b)}`;
}

/** The changes of a run by table, with the ids and docs in a fixed order, so only content counts. */
function changeMap(changes: Run['changes']): unknown {
  if (!Array.isArray(changes)) return changes;
  return Object.fromEntries(
    [...changes]
      .sort((a, b) => a.table.localeCompare(b.table))
      .map((change: Change) => [
        change.table,
        {
          inserted: [...change.inserted].sort(),
          updated: [...change.updated].sort(),
          deleted: [...change.deleted].sort(),
          docs: normal([...change.docs].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))),
        },
      ]),
  );
}

function changedCounters(before: State, after: State): Record<string, number> {
  return Object.fromEntries(Object.entries(after.counters).filter(([prefix, n]) => before.counters[prefix] !== n));
}

/**
 * True when the server's actor check turns this person away (server/core/actor.ts): a missing or turned-off person, or an agent
 * whose person is off. The server refuses them before any rule with unauthenticated and the reason account_off (plan 4.5, the
 * actor), and the screens show the sign-in message. The rules in memory answer forbidden there, or even answer.
 */
function actorIsOff(office: State, actorId: string): boolean {
  const user = office.users[actorId];
  if (!user || !user.active) return true;
  if (user.kind !== 'agent') return false;
  const owner = user.ownerId ? office.users[user.ownerId] : undefined;
  return !owner || owner.kind !== 'human' || !owner.active;
}

export async function shadowProblems(c: ShadowCase): Promise<string[]> {
  const def = (sharedCalls as Record<string, (typeof sharedCalls)[SharedCallName]>)[c.name];
  if (!def || c.readsPrepared) return [];
  if (!c.result.ok && c.result.error.code === 'unauthenticated' && (c.result.error.details as { reason?: unknown } | undefined)?.reason === 'account_off') {
    return actorIsOff(c.office, c.actorId) ? [] : [`${c.name}: the database refused with unauthenticated (account_off), but ${c.actorId} is on.`];
  }
  if (!def.input.safeParse(c.input).success) {
    if (c.result.ok) return [`${c.name}: the input does not parse, and the database still answered.`];
    return c.result.error.code === 'invalid_input' ? [] : [`${c.name}: the input does not parse, and the database refused with ${c.result.error.code}.`];
  }
  const storyId = c.result.ok ? c.result.storyId : undefined;
  const both = await runBoth(c.office, c.name as SharedCallName, c.input, c.actorId, { now: c.now, ...(storyId ? { correlationId: storyId } : {}) });
  const { whole, scoped } = both;
  const hint = firstDifference(normal(scoped), normal(whole)) === undefined
    ? ' The scoped load in memory gives the same answer as the whole office, so look at the SQL loader or the save step.'
    : ' The scoped load in memory differs from the whole office too, so look at the loader of this call.';

  if (whole.outcome.error?.code === 'crash') return [`${c.name}: the whole office in memory crashed: ${whole.outcome.error.message}`];
  if (!c.result.ok) {
    if (whole.outcome.error?.code === c.result.error.code) return [];
    const memory = whole.outcome.error ? `refused with ${whole.outcome.error.code}` : 'answered';
    return [`${c.name}: the database refused with ${c.result.error.code}, the whole office in memory ${memory}.${hint}`];
  }
  if (whole.outcome.error) {
    return [`${c.name}: the database answered, the whole office in memory refused with ${whole.outcome.error.code} (${whole.outcome.error.message}).${hint}`];
  }

  const problems: string[] = [];
  const ignores = OUTPUT_IGNORES[c.name];
  const output = firstDifference(normal(withoutFields(JSON.parse(JSON.stringify(c.result.output ?? null)), ignores)), normal(withoutFields(whole.outcome.output, ignores)));
  if (output) problems.push(`${c.name}: the database gave another output than the whole office in memory (database | memory): ${output}.${hint}`);
  if (!def.readOnly) {
    const saved = firstDifference(changeMap(changesOf(c.office, c.after)), changeMap(whole.changes));
    if (saved) problems.push(`${c.name}: the database saved another change than the whole office in memory (database | memory): ${saved}.${hint}`);
    const counters = firstDifference(normal(changedCounters(c.office, c.after)), normal(whole.counters ?? {}));
    if (counters) problems.push(`${c.name}: the database counted other numbers than the whole office in memory (database | memory): ${counters}.${hint}`);
  }
  return problems;
}
