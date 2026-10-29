import type { State } from '../../src/api/store';
import type { Query } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { diffState } from '../data/save';

/**
 * The free checks that the db-mode harness runs after each call (TM 3.5, checks 2 to 5; task D1). Check 1, the shadow run, is in
 * shadow.ts. Each check gives a sentence that names the call, so a failed test says what broke.
 *
 *   2. A failed call writes nothing: the checksum of every table in the schema, server tables included, stays the same.
 *   3. A read call writes nothing and sends no change signal.
 *   4. The events only grow: no event changes or goes away. The one change allowed is undoneBy of an event that a new undo event
 *      of the same call names (plan 4.3).
 *   5. A saved change sends signals, all with one id, at most one on each channel, for the projects that the change touched in
 *      the whole office. A write that saved no change sends none.
 */

/** What the harness knows about one call. before and after: the whole office read back from the database. */
export type CallCheck = {
  name: string;
  readOnly: boolean;
  ok: boolean;
  beforeSum: string;
  afterSum: string;
  before: State;
  after: State;
  /** The signals the call sent through deps.signal. */
  signals: ChangeSignal[];
};

const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * One statement that gives one checksum over the rows of every table named. Each table goes with its schema, so the checksum is
 * the same whatever the search_path of the connection is.
 */
export function checksumSql(schema: string, tables: readonly string[]): string {
  if (!SAFE_NAME.test(schema)) throw new Error(`Not a schema name: ${schema}`);
  const parts = tables.map((table) => {
    if (!SAFE_NAME.test(table)) throw new Error(`Not a table name: ${table}`);
    return `select '${table}' as n, md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from ${schema}.${table} t`;
  });
  return `select md5(string_agg(n || ':' || h, '|' order by n)) as sum from (${parts.join(' union all ')}) x`;
}

/** The tables of one schema, by name. */
export const SCHEMA_TABLES_SQL = "select tablename from pg_tables where schemaname = $1 order by tablename";

/** The checksum of every table of a schema. */
export async function checksumOf(q: Query, schema: string): Promise<string> {
  const tables = (await q<{ tablename: string }>(SCHEMA_TABLES_SQL, [schema])).map((row) => row.tablename);
  const [row] = await q<{ sum: string }>(checksumSql(schema, tables));
  return row.sum;
}

function sameEvent(a: unknown, b: unknown): boolean {
  const strip = (event: unknown) => JSON.stringify({ ...(event as Record<string, unknown>), undoneBy: null });
  return strip(a) === strip(b);
}

export function callProblems(c: CallCheck): string[] {
  const problems: string[] = [];
  const wrote = c.afterSum !== c.beforeSum;
  if (!c.ok) {
    if (wrote) problems.push(`${c.name} failed, and it still changed the database.`);
    if (c.signals.length > 0) problems.push(`${c.name} failed, and it still sent ${c.signals.length} change signal(s).`);
    return problems;
  }
  if (c.readOnly) {
    if (wrote) problems.push(`${c.name} is a read, and it changed the database.`);
    if (c.signals.length > 0) problems.push(`${c.name} is a read, and it sent ${c.signals.length} change signal(s).`);
    return problems;
  }

  for (const [id, old] of Object.entries(c.before.events)) {
    const now = c.after.events[id];
    if (!now) {
      problems.push(`${c.name} removed the event ${id}. The History only grows.`);
      continue;
    }
    if (!sameEvent(old, now)) {
      problems.push(`${c.name} changed the event ${id}. The History only grows.`);
      continue;
    }
    if (old.undoneBy !== now.undoneBy) {
      const undo = now.undoneBy ? c.after.events[now.undoneBy] : undefined;
      if (old.undoneBy !== null || !undo || undo.undoes !== id || c.before.events[undo.id]) {
        problems.push(`${c.name} changed undoneBy of the event ${id}, and no new undo event of this call names it.`);
      }
    }
  }
  if (problems.length > 0) return problems;

  const diff = diffState(c.before, c.after);
  if (diff.kinds.size === 0) {
    if (c.signals.length > 0) problems.push(`${c.name} saved no change and still sent ${c.signals.length} change signal(s).`);
    return problems;
  }
  if (c.signals.length === 0) return [`${c.name} saved a change and sent no change signal.`];
  // A save that changes a project that not every active person may view (hidden projects, owner 2026-10-22) sends that part only as
  // person signals, to the people who view the project, with one id of its own. Such a signal names the hidden project ids of its
  // person. No other signal names a hidden project.
  const hiddenIds = new Set(diff.hidden.keys());
  const ofHidden = c.signals.filter((s) => s.projects.some((id) => hiddenIds.has(id)));
  const rest = c.signals.filter((s) => !ofHidden.includes(s));
  for (const s of ofHidden) {
    if (s.channel === 'office') {
      problems.push(`${c.name} named a hidden project on the office channel.`);
      continue;
    }
    const person = s.channel.slice('person:'.length);
    for (const id of s.projects.filter((one) => hiddenIds.has(one))) {
      if (!diff.hidden.get(id)!.people.has(person)) problems.push(`${c.name} told ${person} about the hidden project ${id}, and ${person} does not view it.`);
    }
  }
  if (new Set(ofHidden.map((s) => s.id)).size > 1) problems.push(`${c.name} sent the hidden project part with more than one id.`);
  for (const [id, part] of diff.hidden) {
    for (const person of part.people) {
      if (!c.signals.some((s) => s.channel === `person:${person}` && s.projects.includes(id))) problems.push(`${c.name} did not tell ${person} about the hidden project ${id}.`);
    }
  }
  // A save that changes an office task sends that part with its own id and no names, so the id of a named signal never ties the
  // actor or the story to it. Each part keeps one id (review 2026-10-06).
  // A change that touches a locked folder (fbk_074) goes as person signals to the holders of the switch who view the project, with one id of its own
  // when the save has a public part too. Such a signal may name a project only for a holder of that project.
  const lockedPeople = new Set([...diff.locked.values()].flatMap((part) => [...part.people]));
  const ofLocked = rest.filter((s) => s.channel !== 'office' && lockedPeople.has(s.channel.slice('person:'.length)) && s.projects.some((id) => diff.locked.has(id)));
  for (const s of ofLocked) {
    for (const id of s.projects.filter((one) => diff.locked.has(one) && !diff.projects.has(one))) {
      if (!diff.locked.get(id)!.people.has(s.channel.slice('person:'.length))) problems.push(`${c.name} told ${s.channel} about the locked folders of ${id}, and the person does not hold the switch.`);
    }
  }
  if (new Set(ofLocked.map((s) => s.id)).size > 1) problems.push(`${c.name} sent the locked folder part with more than one id.`);
  const lockedOnly = [...diff.locked.keys()].filter((id) => !diff.projects.has(id) && !diff.hidden.has(id));
  for (const id of lockedOnly) {
    for (const person of diff.locked.get(id)!.people) {
      if (!c.signals.some((s) => s.channel === `person:${person}` && s.projects.includes(id))) problems.push(`${c.name} did not tell ${person} about the locked folders of ${id}.`);
    }
  }
  const others = rest.filter((s) => !ofLocked.includes(s));
  const named = others.filter((s) => s.actorId !== undefined || s.storyId !== undefined);
  const nameless = others.filter((s) => s.actorId === undefined && s.storyId === undefined);
  const parts = diff.privateChange ? [named, nameless] : [others];
  if (parts.some((part) => new Set(part.map((s) => s.id)).size > 1)) problems.push(`${c.name} sent signals with more than one id.`);
  if (diff.privateChange) {
    if (nameless.some((s) => named.some((one) => one.id === s.id))) {
      problems.push(`${c.name} sent the office task part with the id of a signal that names the actor and the story.`);
    }
    if (nameless.some((s) => s.channel === 'office')) problems.push(`${c.name} sent a signal with no names on the office channel.`);
  }
  const channels = c.signals.map((s) => s.channel);
  for (const channel of new Set(channels)) {
    if (channels.filter((one) => one === channel).length > 1) problems.push(`${c.name} sent more than one signal on the channel ${channel}.`);
  }
  const expected = [...diff.projects].sort().join(', ');
  for (const s of others) {
    const sent = [...s.projects].sort().join(', ');
    if (sent !== expected) {
      problems.push(`${c.name} sent a signal for the projects ${sent || '(none)'}, but the change touched ${expected || '(none)'}.`);
      break;
    }
  }
  return problems;
}
