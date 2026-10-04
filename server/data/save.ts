import type { State } from '../../src/api/store';
import type { Query } from '../core/ports';
import type { ChangeSignal, Kind } from '../core/types';
import {
  COUNTERS_UPSERT_SQL, OFFICE_DELETES_SQL, deleteSql, rowOf, rowsParam, upsertSql, type Row,
} from './rows';
import { TABLES, type TableSpec } from './tables';

/**
 * The diff writer (plan 4.8; task C1). runCall keeps a copy of the State before the handler runs, and this writes back only
 * what the handler changed, inside the call's transaction, under the office lock.
 *
 * - Each collection is compared by key with the JSON of the record. New key: insert. Changed: update "doc". Missing after the
 *   call: delete. One statement for each table and each kind of change, in the key order of the State after the call.
 * - Events are inserted only. An old event that changes or goes fails the save, except undoneBy when the same save inserts the
 *   undo event that names it; undoneBy is never written (plan 4.3).
 * - Counters: the changed prefixes. session, version, seededOn and counts are never written.
 * - Office tables: the save raises office_meta.version once, sets "chg" of each written row to it, and records each deleted row
 *   in office_deletes (plan 4.7).
 * - Signals (plan, change 13): a change whose only kinds are chatReads, notifications or preferences is personal and goes only on
 *   the person channels. Any other change gets one office signal with the next office_meta.office_seq. Each person in "people"
 *   gets one signal on person:<userId> with the next person_seq. All signals of one save share one id and the same kinds,
 *   projects and office flag. The office signal names nobody (people is empty), so the office channel never tells who reads or
 *   chats with whom; a person signal names only its person.
 */

type Rec = Record<string, unknown>;

export type TableChange = { spec: TableSpec; upserts: Row[]; inserted: string[]; updated: string[]; deleted: string[] };

/** The story and the actor that the signals name. runCall passes them; without them the first new event gives them. */
export type SignalMeta = { storyId: string; actorId: string };

export type Diff = {
  /** Only the tables with a change, in the order of TABLES. */
  tables: TableChange[];
  /** The changed counters: prefix and its new number. */
  counters: Record<string, number>;
  kinds: Set<Kind>;
  /** The projects that the change touched. */
  projects: Set<string>;
  /** True when the change touched a record that belongs to no project (people, clients, teams, settings, a direct chat). */
  office: boolean;
  /** The people whose own lists changed: the owners of changed notices and read marks, and own preferences. */
  people: Set<string>;
  /** True when a row of an office table changed: the office cache must load again (plan 4.7). */
  officeRows: boolean;
  /** True when every kind is personal (chatReads, notifications, preferences): no office signal. */
  personal: boolean;
  /** Comments whose target neither State holds. writeDiff looks up their project with one query. */
  unresolvedComments: { id: string; targetType: string; targetId: string }[];
  meta: SignalMeta;
};

export type SaveResult = {
  changed: boolean;
  kinds: Set<Kind>;
  projects: Set<string>;
  office: boolean;
  people: Set<string>;
  bytesWritten: number;
  signals: ChangeSignal[];
  /** The new office_meta.version when the save raised it. runCall then drops BatchScope.office (plan 4.7). */
  officeVersion?: number;
};

export type SaveOptions = { story?: SignalMeta; signals?: boolean };

const PERSONAL_KINDS = new Set<Kind>(['chatReads', 'notifications', 'preferences']);
/** The collections whose records belong to no project. A change of one of them is an office change. */
const OFFICE_SCOPE = new Set<string>(['clients', 'teams', 'settings', 'stageTemplates', 'taskTemplates', 'feedback']);

/** JSON with sorted keys, so two records with the same fields in another order compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const rec = value as Rec;
    const keys = Object.keys(rec).filter((key) => rec[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(rec[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b) || canonical(a) === canonical(b);
}

/** The same record without one field. */
function without(rec: Rec, field: string): Rec {
  const { [field]: _gone, ...rest } = rec;
  return rest;
}

/** The records of one collection by row key, in the order of the State map. */
function recordsOf(state: State, spec: TableSpec): Map<string, Rec> {
  if (spec.collection === 'settings') return new Map(state.settings ? [['office', state.settings as Rec]] : []);
  const map = (state[spec.collection] ?? {}) as Record<string, Rec>;
  return new Map(Object.values(map).map((rec) => [spec.key(rec), rec]));
}

function historyError(text: string): Error {
  return new Error(`The History only grows: ${text}`);
}

export function diffState(before: State, after: State): Diff {
  const tables: TableChange[] = [];
  const kinds = new Set<Kind>();
  const projects = new Set<string>();
  const people = new Set<string>();
  const unresolvedComments: Diff['unresolvedComments'] = [];
  const preferencesOnly = new Set<string>();
  let office = false;
  let officeRows = false;
  let meta: SignalMeta | undefined;

  const addProject = (projectId: unknown) => {
    if (typeof projectId === 'string' && projectId !== '') projects.add(projectId);
    else office = true;
  };

  /** Kinds, projects, people and the office flag of one changed record (old: before the call; rec: after it). */
  function touched(spec: TableSpec, old: Rec | undefined, rec: Rec | undefined, row: Row | undefined): void {
    const sides = [old, rec].filter((side): side is Rec => side !== undefined);
    switch (spec.collection) {
      case 'projects':
        kinds.add(old && rec && same(without(old, 'updatedAt'), without(rec, 'updatedAt')) ? 'projectTouched' : 'projects');
        addProject((rec ?? old)!.id);
        return;
      case 'users': {
        const id = (rec ?? old)!.id as string;
        const preferencesChanged = !old || !rec || !same(old.preferences, rec.preferences);
        if (old && rec && same(without(old, 'preferences'), without(rec, 'preferences'))) {
          preferencesOnly.add(id);
        } else {
          kinds.add('users');
          office = true;
        }
        if (old && rec && preferencesChanged) {
          kinds.add('preferences');
          people.add(id);
        }
        return;
      }
      case 'notifications':
      case 'chatReads':
        kinds.add(spec.collection);
        for (const side of sides) people.add(side.userId as string);
        return;
      case 'comments': {
        kinds.add('comments');
        const fromState = (side: Rec) => spec.serverColumns!.project_id(side, after) ?? spec.serverColumns!.project_id(side, before);
        if (row && row.columns.project_id === null) {
          const found = fromState(row.doc);
          if (typeof found === 'string') row.columns.project_id = found;
          else unresolvedComments.push({ id: row.id, targetType: rec!.targetType as string, targetId: rec!.targetId as string });
        }
        // A comment keeps its target, so one side is enough. An unknown target: writeDiff looks up a written comment; a deleted
        // one names the office, so every list reloads, to be safe.
        const found = fromState((rec ?? old)!);
        if (typeof found === 'string') projects.add(found);
        else if (!rec) office = true;
        return;
      }
      case 'messages':
        kinds.add('messages');
        for (const side of sides) {
          const conversationId = side.conversationId as string;
          addProject((after.conversations[conversationId] ?? before.conversations[conversationId])?.projectId);
        }
        return;
      case 'events':
        // An event of a person's own preferences belongs to that personal change.
        if (rec && rec.targetType === 'user' && preferencesOnly.has(rec.targetId as string)) {
          kinds.add('preferences');
          return;
        }
        kinds.add('events');
        addProject(rec!.projectId);
        return;
      default:
        kinds.add(spec.collection);
        if (OFFICE_SCOPE.has(spec.collection)) office = true;
        else for (const side of sides) addProject(side.projectId);
    }
  }

  for (const spec of TABLES) {
    const was = recordsOf(before, spec);
    const now = recordsOf(after, spec);
    const change: TableChange = { spec, upserts: [], inserted: [], updated: [], deleted: [] };
    const isEvents = spec.collection === 'events';

    for (const [id, rec] of now) {
      const old = was.get(id);
      if (old && same(old, rec)) continue;
      if (isEvents && old) {
        checkUndoneBy(id, old, rec, was, now);
        continue;
      }
      if (isEvents && rec.undoneBy != null && now.get(rec.undoneBy as string)?.undoes !== id) {
        throw historyError(`the new event ${id} has undoneBy ${String(rec.undoneBy)}, and no undo event in the State names it.`);
      }
      const row = rowOf(spec, rec, after);
      (old ? change.updated : change.inserted).push(id);
      change.upserts.push(row);
      touched(spec, old, rec, row);
      if (isEvents && !meta) meta = { storyId: rec.correlationId as string, actorId: rec.actorId as string };
    }
    for (const [id, old] of was) {
      if (now.has(id)) continue;
      if (isEvents) throw historyError(`the event ${id} is gone.`);
      change.deleted.push(id);
      touched(spec, old, undefined, undefined);
    }
    if (change.upserts.length > 0 || change.deleted.length > 0) {
      tables.push(change);
      if (spec.office) officeRows = true;
    }
  }

  const counters: Record<string, number> = {};
  for (const [prefix, n] of Object.entries(after.counters ?? {})) {
    if (before.counters?.[prefix] !== n) counters[prefix] = n;
  }

  const personal = kinds.size > 0 && [...kinds].every((kind) => PERSONAL_KINDS.has(kind));
  return {
    tables, counters, kinds, projects, office: personal ? false : office, people, officeRows, personal, unresolvedComments,
    meta: meta ?? { storyId: '', actorId: '' },
  };
}

/** An old event may change only in undoneBy, and only to the undo event that the same save inserts and that names it. */
function checkUndoneBy(id: string, old: Rec, rec: Rec, was: Map<string, Rec>, now: Map<string, Rec>): void {
  if (!same(without(old, 'undoneBy'), without(rec, 'undoneBy'))) throw historyError(`the event ${id} changed.`);
  const undo = rec.undoneBy == null ? undefined : now.get(rec.undoneBy as string);
  if (!undo || undo.undoes !== id || old.undoneBy != null || was.has(rec.undoneBy as string)) {
    throw historyError(`the undoneBy of event ${id} changed, and no new undo event in this save names it.`);
  }
}

const COMMENT_TARGETS_SQL =
  "select 'task' as type, id, project_id from tasks where id = any($1::text[]) union all select 'update' as type, id, project_id from updates where id = any($2::text[])";
const OFFICE_META_SQL = 'update office_meta set version = version + $1, office_seq = office_seq + $2 returning version, office_seq';
const PERSON_SEQ_SQL =
  'insert into person_seq (user_id, seq) select unnest($1::text[]), 1 on conflict (user_id) do update set seq = person_seq.seq + 1 returning user_id, seq';

const bytes = (text: string) => new TextEncoder().encode(text).length;

export async function writeDiff(q: Query, diff: Diff, o: SaveOptions = {}): Promise<SaveResult> {
  const signalsOn = o.signals ?? true;
  const story = o.story ?? diff.meta;
  const projects = new Set(diff.projects);
  let office = diff.office;
  const changed = diff.tables.length > 0 || Object.keys(diff.counters).length > 0;
  const result = (fields: Partial<SaveResult> = {}): SaveResult => ({
    changed, kinds: new Set(diff.kinds), projects, office, people: new Set(diff.people), bytesWritten: 0, signals: [], ...fields,
  });
  if (!changed) return result();

  // The project of each written comment whose target the call did not load.
  if (diff.unresolvedComments.length > 0) {
    const ofType = (type: string) => diff.unresolvedComments.filter((c) => c.targetType === type).map((c) => c.targetId);
    const found = await q<{ type: string; id: string; project_id: string | null }>(COMMENT_TARGETS_SQL, [ofType('task'), ofType('update')]);
    const projectOf = new Map(found.map((row) => [`${row.type}:${row.id}`, row.project_id]));
    const rows = new Map(diff.tables.find((t) => t.spec.collection === 'comments')?.upserts.map((row) => [row.id, row]));
    for (const comment of diff.unresolvedComments) {
      const projectId = projectOf.get(`${comment.targetType}:${comment.targetId}`) ?? null;
      const row = rows.get(comment.id);
      if (row) row.columns = { ...row.columns, project_id: projectId };
      if (projectId) projects.add(projectId);
      else if (!diff.personal) office = true;
    }
  }

  const officeSignal = signalsOn && diff.kinds.size > 0 && !diff.personal;
  let version: number | undefined;
  let officeSeq = 0;
  if (diff.officeRows || officeSignal) {
    const [meta] = await q<{ version: string | number; office_seq: string | number }>(OFFICE_META_SQL, [diff.officeRows ? 1 : 0, officeSignal ? 1 : 0]);
    if (diff.officeRows) version = Number(meta.version);
    officeSeq = Number(meta.office_seq);
  }

  let bytesWritten = 0;
  for (const change of diff.tables) {
    const { spec } = change;
    if (change.deleted.length > 0) {
      await q(deleteSql(spec), [change.deleted]);
      if (spec.office) await q(OFFICE_DELETES_SQL, [spec.table, change.deleted, version]);
    }
    if (change.upserts.length > 0) {
      const param = rowsParam(change.upserts);
      bytesWritten += bytes(param);
      await q(upsertSql(spec), spec.office ? [param, version] : [param]);
    }
  }
  if (Object.keys(diff.counters).length > 0) {
    const param = JSON.stringify(diff.counters);
    bytesWritten += bytes(param);
    await q(COUNTERS_UPSERT_SQL, [param]);
  }

  const people = [...diff.people].sort();
  let personSeq = new Map<string, number>();
  if (signalsOn && diff.kinds.size > 0 && people.length > 0) {
    const rows = await q<{ user_id: string; seq: string | number }>(PERSON_SEQ_SQL, [people]);
    personSeq = new Map(rows.map((row) => [row.user_id, Number(row.seq)]));
  }

  // The deferred foreign keys are checked here, inside the call, so a bad save fails the call and not only a later commit (TM R11).
  await q('set constraints all immediate');

  const signals: ChangeSignal[] = [];
  if (signalsOn && diff.kinds.size > 0) {
    const base = {
      v: 1 as const, id: crypto.randomUUID(), projects: [...projects].sort(), office, kinds: [...diff.kinds].sort(), storyId: story.storyId, actorId: story.actorId,
    };
    if (officeSignal) signals.push({ ...base, channel: 'office', seq: officeSeq, people: [] });
    for (const userId of people) signals.push({ ...base, channel: `person:${userId}`, seq: personSeq.get(userId) ?? 0, people: [userId] });
  }
  return result({ office, bytesWritten, signals, ...(version === undefined ? {} : { officeVersion: version }) });
}

export async function save(q: Query, before: State, after: State, o: SaveOptions = {}): Promise<SaveResult> {
  return writeDiff(q, diffState(before, after), o);
}
