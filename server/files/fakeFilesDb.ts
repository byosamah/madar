import type { User } from '../../src/api/contract/entities';
import { OUTBOX_INSERT_SQL, type OutboxRow } from '../core/effects';
import type { Db, Query } from '../core/ports';
import { KEYS_IN_USE_SQL, PROJECT_KEYS_SQL } from './effects';
import { INTENT_INSERT_SQL, INTENTS_SELECT_SQL, INTENTS_USE_SQL, type Intent } from './intents';
import { FEEDBACK_DOC_SQL, FILE_DOC_SQL, FILES_DOCS_SQL, MEETING_DOC_SQL, SETTINGS_SQL, TASK_DOC_SQL, TASK_PROJECT_SQL, USERS_SQL } from './records';

/**
 * A database in memory for the unit tests of track F (task F2). It answers only the statements of server/files and server/calls
 * for files and feedback, by their exact text, and refuses every other one, as server/test/fakes/db-none.ts does. The same
 * statements run on the local stack in server/it/files.it.test.ts.
 */

type Rec = Record<string, unknown>;
type FileDoc = { id: string; projectId: string | null; versions: Rec[] } & Rec;
type EventDoc = { projectId: string; targetType: string; before: unknown; after: unknown };

export type FakeFilesDb = Db & {
  /** The query of one transaction, for the prepare hooks. */
  q: Query;
  intents: Map<string, Intent>;
  files: Record<string, FileDoc>;
  feedback: Record<string, Rec>;
  outbox: OutboxRow[];
  /** The text of every statement and query, in order. */
  statements: string[];
};

const versionsHold = (versions: unknown, field: string, key: string) =>
  Array.isArray(versions) && versions.some((v) => (v as Rec | null)?.[field] === key);

export function fakeFilesDb(o: {
  users?: Record<string, User>;
  files?: Record<string, FileDoc>;
  feedback?: Record<string, Rec>;
  tasks?: Record<string, { projectId: string | null } & Rec>;
  meetings?: Record<string, Rec>;
  events?: EventDoc[];
  /** The office settings row. Without it the office has no roles. */
  settings?: Rec;
} = {}): FakeFilesDb {
  const intents = new Map<string, Intent>();
  const files = o.files ?? {};
  const feedback = o.feedback ?? {};
  const outbox: OutboxRow[] = [];
  const statements: string[] = [];

  async function answer(text: string, values: unknown[] = []): Promise<Rec[]> {
    statements.push(text);
    switch (text) {
      case INTENT_INSERT_SQL: {
        for (const row of JSON.parse(String(values[0])) as Rec[]) {
          if (intents.has(String(row.id))) throw new Error(`duplicate key value: upload_intents ${String(row.id)}`);
          intents.set(String(row.id), {
            id: String(row.id), actorId: String(row.actor_id), projectId: (row.project_id as string | null) ?? null, stagingKey: String(row.staging_key),
            key: String(row.key), thumbKey: (row.thumb_key as string | null) ?? null, size: Number(row.size), mimeType: String(row.mime_type),
            expiresAt: new Date(String(row.expires_at)), usedAt: null,
          });
        }
        return [];
      }
      case INTENTS_SELECT_SQL:
        return (values[0] as string[]).flatMap((id) => {
          const i = intents.get(id);
          return i ? [{
            id: i.id, actor_id: i.actorId, project_id: i.projectId, staging_key: i.stagingKey, key: i.key, thumb_key: i.thumbKey,
            size: String(i.size), mime_type: i.mimeType, expires_at: i.expiresAt, used_at: i.usedAt,
          }] : [];
        });
      case INTENTS_USE_SQL: {
        const [ids, actorId, at] = values as [string[], string, string];
        const now = new Date(at);
        return ids.flatMap((id) => {
          const i = intents.get(id);
          if (!i || i.actorId !== actorId || i.usedAt !== null || i.expiresAt.getTime() <= now.getTime()) return [];
          i.usedAt = now;
          return [{ id }];
        });
      }
      case USERS_SQL:
        return (values[0] as string[]).flatMap((id) => (o.users?.[id] ? [{ doc: o.users[id] }] : []));
      case FILE_DOC_SQL:
        return files[String(values[0])] ? [{ doc: files[String(values[0])] }] : [];
      case FILES_DOCS_SQL:
        return (values[0] as string[]).flatMap((id) => (files[id] ? [{ doc: files[id] }] : []));
      case SETTINGS_SQL:
        return o.settings ? [{ doc: o.settings }] : [];
      case FEEDBACK_DOC_SQL:
        return feedback[String(values[0])] ? [{ doc: feedback[String(values[0])] }] : [];
      case MEETING_DOC_SQL:
        return o.meetings?.[String(values[0])] ? [{ doc: o.meetings[String(values[0])] }] : [];
      case TASK_PROJECT_SQL: {
        const task = o.tasks?.[String(values[0])];
        return task ? [{ project_id: task.projectId }] : [];
      }
      case TASK_DOC_SQL: {
        const task = o.tasks?.[String(values[0])];
        return task ? [{ doc: { id: String(values[0]), ...task } }] : [];
      }
      case KEYS_IN_USE_SQL:
        return (values[0] as string[]).filter((key) =>
          Object.values(files).some((f) => versionsHold(f.versions, 'blobKey', key) || versionsHold(f.versions, 'thumbKey', key))
          || Object.values(feedback).some((b) => versionsHold(b.screenshots, 'blobKey', key)),
        ).map((key) => ({ key }));
      case PROJECT_KEYS_SQL: {
        const projectId = String(values[0]);
        const events = (o.events ?? []).filter((e) => e.projectId === projectId && e.targetType === 'file');
        return [
          ...Object.values(files).filter((f) => f.projectId === projectId).map((f) => ({ versions: f.versions })),
          ...events.map((e) => ({ versions: (e.before as Rec | null)?.versions ?? null })),
          ...events.map((e) => ({ versions: (e.after as Rec | null)?.versions ?? null })),
        ];
      }
      case OUTBOX_INSERT_SQL: {
        const rows = JSON.parse(String(values[0])) as OutboxRow[];
        outbox.push(...rows);
        return rows.map((_, n) => ({ id: String(outbox.length - rows.length + n + 1) }));
      }
      default:
        throw new Error(`The fake files database has no answer for: ${text.slice(0, 60)}`);
    }
  }

  const q = (async (text: string, values?: unknown[]) => answer(text, values)) as Query;
  return {
    q,
    intents,
    files,
    feedback,
    outbox,
    statements,
    tx: async (_mode, work) => work(q),
    savepoint: async (query, work) => work(query),
    statement: (async (_mode: 'read' | 'write', text: string, values?: unknown[]) => answer(text, values)) as Db['statement'],
  };
}
