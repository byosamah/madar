import type { State } from '../../src/api/store';
import { USER_EMAIL_CHANGED_SQL } from '../auth/effects';
import { snapshotOf } from '../data/officeCache';
import { memorySource } from '../data/loaders/index';
import { diffState, writeDiff } from '../data/save';
import { tableOf } from '../data/tables';
import { PROJECT_KEYS_SQL } from '../files/effects';
import { memoryConfirms, type MemoryConfirm } from '../mcp/confirms';
import { INTENTS_SELECT_SQL } from '../files/intents';
import { FEEDBACK_DOC_SQL, FILE_DOC_SQL, FILES_DOCS_SQL, SETTINGS_SQL, USERS_SQL } from '../files/records';
import type { OutboxRow } from './effects';
import type { KeyRow } from './idempotency';
import type { Db, Query } from './ports';
import type { CallData, CallTx } from './runCall';
import { STORY_INSERT_SQL, STORY_SELECT_SQL, type StoryRow } from './story';
import { OFFICE_COLLECTIONS, type OfficeSnapshot } from './types';

/**
 * The data of runCall in memory, for the unit tests of suite 2 (TM 7: Node, no database; task C3). It keeps one whole office and
 * the server tables that runCall uses, and it follows the database rules that runCall relies on:
 *
 * - A transaction works on a copy and commits it only when the work returns; a throw leaves nothing behind.
 * - Writes run one at a time (the office lock).
 * - The office snapshot holds only committed data: the same frozen object while the version stays, a new one after a commit that
 *   changed an office table.
 * - The save step is diffState of the real diff writer, applied to the copy; the signals come from writeDiff itself, over a query
 *   that answers its office_meta, person_seq and comment target statements from memory.
 *
 * The file hooks of track F read their records with single statements and the project delete lists its stored keys with one
 * query; the memory data answers those from the office too, and holds no upload intents. It also answers the question of the
 * users.update producer (USER_EMAIL_CHANGED_SQL), so a name change writes no auth.email row here either.
 *
 * The database form of the same steps is tested on the local stack (server/it/runCall.it.test.ts, server/it/lock.it.test.ts).
 */

type Rec = Record<string, unknown>;

export type MemoryTables = {
  state: State;
  version: number;
  officeSeq: number;
  personSeq: Map<string, number>;
  stories: Map<string, StoryRow>;
  keys: Map<string, KeyRow & { at: Date }>;
  outbox: (OutboxRow & { id: string })[];
  /** The codes of the email code guard (server/mcp/guard.ts). */
  confirms: Map<string, MemoryConfirm>;
};

export type MemoryData = {
  data: () => CallData;
  /** A Db for deps.db: it answers the story statements of story.start and the read statements of the file hooks, and refuses every other statement. */
  db: Db;
  /** The committed tables. Tests read them, and may change them between calls. */
  readonly tables: MemoryTables;
  /** How many transactions ran, by mode. */
  readonly txCount: { read: number; write: number };
};

const refuse = (text: string) => Promise.reject(new Error(`The memory data has no SQL for: ${text.slice(0, 60)}`));

/** Applies the change of one save to a whole office: upserts keep the place of a known key, new keys go last, deletes go. */
function apply(state: State, diff: ReturnType<typeof diffState>): void {
  const lists = state as unknown as Record<string, Record<string, Rec>>;
  for (const change of diff.tables) {
    const { collection } = change.spec;
    if (collection === 'settings') {
      const row = change.upserts[0];
      if (row) state.settings = row.doc as unknown as State['settings'];
      continue;
    }
    const map = (lists[collection] ??= {});
    // The row key of a table is the key of the State map (server/data/tables.ts).
    for (const id of change.deleted) delete map[id];
    for (const row of change.upserts) map[tableOf(collection).key(row.doc)] = structuredClone(row.doc);
  }
  for (const [prefix, n] of Object.entries(diff.counters)) state.counters[prefix] = n;
}

export function memoryData(office: State): MemoryData {
  let tables: MemoryTables = {
    state: structuredClone(office), version: 1, officeSeq: 0, personSeq: new Map(), stories: new Map(), keys: new Map(), outbox: [], confirms: new Map(),
  };
  let snapshot: OfficeSnapshot | undefined;
  let writes: Promise<unknown> = Promise.resolve();
  let nextOutbox = 1;
  const txCount = { read: 0, write: 0 };

  function officeOf(): OfficeSnapshot {
    if (!snapshot || snapshot.version !== tables.version) {
      const lists = Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, tables.state[c]])) as never;
      snapshot = snapshotOf(lists, tables.version);
    }
    return snapshot;
  }

  /** The statements of writeDiff that give numbers back. Every table write comes from the diff itself (apply). */
  function saveQuery(draft: MemoryTables): Query {
    return (async (text: string, values: unknown[] = []) => {
      if (text.startsWith('update office_meta')) {
        draft.version += Number(values[0]);
        draft.officeSeq += Number(values[1]);
        return [{ version: draft.version, office_seq: draft.officeSeq }];
      }
      if (text.startsWith('insert into person_seq')) {
        return (values[0] as string[]).map((userId) => {
          const seq = (draft.personSeq.get(userId) ?? 0) + 1;
          draft.personSeq.set(userId, seq);
          return { user_id: userId, seq };
        });
      }
      if (text.startsWith("select 'task' as type")) {
        const [taskIds, updateIds] = values as [string[], string[]];
        return [
          ...taskIds.flatMap((id) => (draft.state.tasks[id] ? [{ type: 'task', id, project_id: draft.state.tasks[id].projectId }] : [])),
          ...updateIds.flatMap((id) => (draft.state.updates[id] ? [{ type: 'update', id, project_id: draft.state.updates[id].projectId }] : [])),
        ];
      }
      return [];
    }) as Query;
  }

  function txOf(draft: MemoryTables): CallTx {
    return {
      q: (async (text: string, values: unknown[] = []) => {
        if (text === USER_EMAIL_CHANGED_SQL) {
          // The last user.updated event of the person, as the producer of users.update reads it after the save (P2).
          const [last] = Object.values(draft.state.events)
            .filter((e) => e.targetType === 'user' && e.targetId === values[0] && e.verb === 'user.updated')
            .slice(-1);
          return last ? [{ changed: last.after !== null && typeof last.after === 'object' && 'email' in last.after }] : [];
        }
        if (text !== PROJECT_KEYS_SQL) return refuse(text);
        const projectId = String(values[0]);
        const events = Object.values(draft.state.events).filter((e) => e.projectId === projectId && e.targetType === 'file');
        const versions = (value: unknown) => ({ versions: (value as { versions?: unknown } | null)?.versions ?? null });
        return [
          ...Object.values(draft.state.files).filter((f) => f.projectId === projectId).map((f) => ({ versions: f.versions })),
          ...events.map((e) => versions(e.before)),
          ...events.map((e) => versions(e.after)),
        ];
      }) as Query,
      lock: async () => undefined,
      office: async () => officeOf(),
      source: () => memorySource(draft.state),
      async save(before, after, o) {
        const diff = diffState(before, after);
        const result = await writeDiff(saveQuery(draft), diff, o);
        apply(draft.state, diff);
        return result;
      },
      stories: {
        async insert(id, actorId, at) {
          if (draft.stories.has(id)) throw new Error(`duplicate key value: story ${id}`);
          draft.stories.set(id, { actorId, createdAt: at });
        },
        get: async (id) => draft.stories.get(id),
      },
      keys: {
        get: async (actorId, key) => draft.keys.get(`${actorId}|${key}`),
        async put(row) {
          const id = `${row.actorId}|${row.key}`;
          if (draft.keys.has(id)) throw new Error(`duplicate key value: idempotency ${id}`);
          draft.keys.set(id, { name: row.name, digest: row.digest, result: structuredClone(row.result), at: row.at });
        },
      },
      confirms: memoryConfirms(draft.confirms),
      async outbox(rows) {
        return rows.map((row) => {
          const id = String(nextOutbox++);
          draft.outbox.push({ ...structuredClone(row), id });
          return id;
        });
      },
    };
  }

  async function tx<T>(mode: 'read' | 'write', work: (t: CallTx) => Promise<T>): Promise<T> {
    txCount[mode] += 1;
    const draft = structuredClone(tables);
    if (mode === 'read') return work(txOf(draft));
    const turn = writes.then(async () => {
      const out = await work(txOf(draft));
      tables = draft;
      return out;
    });
    writes = turn.catch(() => undefined);
    return turn;
  }

  const db: Db = {
    tx: () => refuse('tx'),
    savepoint: () => refuse('savepoint'),
    async statement<R>(_mode: 'read' | 'write', text: string, values: unknown[] = []): Promise<R[]> {
      if (text === STORY_INSERT_SQL) {
        tables.stories.set(String(values[0]), { actorId: String(values[1]), createdAt: new Date(String(values[2])) });
        return [];
      }
      if (text === STORY_SELECT_SQL) {
        const row = tables.stories.get(String(values[0]));
        return (row ? [{ actor_id: row.actorId, created_at: row.createdAt }] : []) as R[];
      }
      if (text === USERS_SQL) return (values[0] as string[]).flatMap((id) => (tables.state.users[id] ? [{ doc: tables.state.users[id] }] : [])) as R[];
      if (text === FEEDBACK_DOC_SQL) {
        const doc = (tables.state.feedback ?? {})[String(values[0])];
        return (doc ? [{ doc }] : []) as R[];
      }
      // One file record, which files.link reads before it signs (the cover of pictures.get, owner 2026-10-21).
      if (text === FILE_DOC_SQL) {
        const doc = tables.state.files[String(values[0])];
        return (doc ? [{ doc }] : []) as R[];
      }
      // The files of a run of adjacent files.link entries (SV-11).
      if (text === FILES_DOCS_SQL) return (values[0] as string[]).flatMap((id) => (tables.state.files[id] ? [{ doc: tables.state.files[id] }] : [])) as R[];
      // The office settings row, which the hook of feedback.screenshot reads for the roles (role-rights).
      if (text === SETTINGS_SQL) return (tables.state.settings ? [{ doc: tables.state.settings }] : []) as R[];
      if (text === INTENTS_SELECT_SQL) return [];
      return refuse(text);
    },
  };

  return {
    // on: the steps of a read transaction that the caller opened (the sign-in read of a batch, SV-5): a copy of the tables, as tx makes.
    data: () => ({ tx, on: () => txOf(structuredClone(tables)), office: async () => officeOf() }),
    db,
    get tables() {
      return tables;
    },
    txCount,
  };
}
