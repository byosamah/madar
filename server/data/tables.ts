import type { ZodObject } from 'zod';
import {
  ChatRead, Client, Comment, Conversation, Deadline, Event, Feedback, FileRec, Meeting, Message, Notification, Payment, Project, ProjectMember,
  ProjectTemplate, PushDevice, Settings, Stage, StageTemplate, SubCompany, Task, TaskTemplate, Team, TrackerEntry, Update, User,
} from '../../src/api/contract/entities';
import { chatReadKey, memberKey, type State } from '../../src/api/store';
import { bodySearchText } from '../../src/lib/searchMatch';
import { normalizeForSearch } from '../../src/lib/text';
import { OFFICE_COLLECTIONS } from '../core/types';

/**
 * The tables of the State collections (plan 4.1, 4.2). Each table keeps the whole zod record in "doc"; its key columns are
 * generated from "doc" in the migrations (supabase/migrations/20261004000100_core.sql). server/data/schema.test.ts checks
 * that this list, the migrations and the zod schemas agree.
 */
export type TableCollection = Exclude<keyof State, 'version' | 'seededOn' | 'session' | 'counters' | 'counts'>;

/** A record as the save step sees it: a zod record of one collection (settings is one record with the fixed key "office"). */
type Rec = Record<string, unknown>;

export type TableSpec = {
  collection: TableCollection;
  table: string;
  /** The key of the record in its State map, and the id column of its row. */
  key: (rec: Rec) => string;
  /** The zod schema of one record. Every generated column reads a field of it, and every loaded doc parses with it. */
  schema: ZodObject;
  /** The columns that the save step writes beside "doc", from the record and the State after the call (plan 4.8). */
  serverColumns?: Record<string, (rec: Rec, state: State) => unknown>;
  /** One of the office lists that the office cache keeps (plan 4.7). Office tables have a "chg" column. */
  office: boolean;
};

const byId = (rec: Rec): string => rec.id as string;

/** The text that search.query matches, in its normal form, so the loader can find candidate rows with SQL (plan 4.8). */
function searchText(...parts: unknown[]): string {
  return normalizeForSearch(parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' '));
}

/** A mapped type, so a new State collection without a table fails the type check. */
const TABLE_OF: { [C in TableCollection]: Omit<TableSpec, 'collection' | 'office'> } = {
  users: { table: 'users', key: byId, schema: User },
  clients: { table: 'clients', key: byId, schema: Client },
  teams: { table: 'teams', key: byId, schema: Team },
  subCompanies: { table: 'sub_companies', key: byId, schema: SubCompany },
  stageTemplates: { table: 'stage_templates', key: byId, schema: StageTemplate },
  taskTemplates: { table: 'task_templates', key: byId, schema: TaskTemplate },
  projectTemplates: { table: 'project_templates', key: byId, schema: ProjectTemplate },
  feedback: { table: 'feedback', key: byId, schema: Feedback },
  // Private to each person, and never an office list: the loaders read the rows of the person of the call only (push.mine).
  pushDevices: { table: 'push_devices', key: byId, schema: PushDevice },
  // The meetings (fbk_022). Not an office list: the loaders read the window of one call, and a meeting with no project reaches only its people.
  meetings: { table: 'meetings', key: byId, schema: Meeting },
  settings: { table: 'settings', key: () => 'office', schema: Settings },
  projects: {
    table: 'projects', key: byId, schema: Project,
    serverColumns: {
      search_text: (rec, state) => {
        const client = typeof rec.clientId === 'string' ? state.clients[rec.clientId] : undefined;
        return searchText(rec.code, rec.name, rec.nameAr, client?.name, client?.nameAr);
      },
    },
  },
  members: { table: 'members', key: (rec) => memberKey(rec.projectId as string, rec.userId as string), schema: ProjectMember },
  stages: { table: 'stages', key: byId, schema: Stage },
  deadlines: { table: 'deadlines', key: byId, schema: Deadline },
  conversations: { table: 'conversations', key: byId, schema: Conversation },
  tasks: { table: 'tasks', key: byId, schema: Task, serverColumns: { search_text: (rec) => searchText(rec.title) } },
  updates: { table: 'updates', key: byId, schema: Update },
  comments: {
    table: 'comments', key: byId, schema: Comment,
    serverColumns: {
      // A comment has no project of its own: its target (a task or a post) has it (access map, section 5).
      project_id: (rec, state) => {
        const target = rec.targetType === 'task' ? state.tasks[rec.targetId as string] : state.updates[rec.targetId as string];
        return target?.projectId ?? null;
      },
      // The folded body, for the message search (chat design 2026-10-19, item 16). The loader picks the comments of tasks.
      search_text: (rec) => bodySearchText(rec.body as string),
    },
  },
  files: { table: 'files', key: byId, schema: FileRec, serverColumns: { search_text: (rec) => searchText(rec.name) } },
  tracker: { table: 'tracker', key: byId, schema: TrackerEntry },
  payments: { table: 'payments', key: byId, schema: Payment },
  notifications: { table: 'notifications', key: byId, schema: Notification },
  messages: {
    table: 'messages', key: byId, schema: Message,
    // The folded body, for the message search (chat design 2026-10-19, item 16). A deleted message keeps none, so no SQL read finds it;
    // the Undo writes the column again with the record.
    serverColumns: { search_text: (rec) => (typeof rec.deletedAt === 'string' ? null : bodySearchText(rec.body as string)) },
  },
  chatReads: { table: 'chat_reads', key: (rec) => chatReadKey(rec.conversationId as string, rec.userId as string), schema: ChatRead },
  events: { table: 'events', key: byId, schema: Event },
};

const OFFICE = new Set<string>(OFFICE_COLLECTIONS);

export const TABLES: readonly TableSpec[] = (Object.keys(TABLE_OF) as TableCollection[]).map((collection) => ({
  collection,
  ...TABLE_OF[collection],
  office: OFFICE.has(collection),
}));

export function tableOf(collection: TableCollection): TableSpec {
  return TABLES.find((spec) => spec.collection === collection)!;
}

/** The gap-free numbers of nextId and the event seq: columns prefix and n (plan, change 4). */
export const COUNTERS_TABLE = 'counters';

/** The tables that hold no State collection (plan 4.2, "Server-only tables"). */
export const SERVER_TABLES = [
  'office_meta', 'office_deletes', 'person_seq', 'platform_config', 'stories', 'idempotency', 'outbox', 'upload_intents',
  'agent_links', 'mail_log', 'mail_outbox', 'usage_month', 'usage_warnings', 'rate_limits', 'job_runs',
  // Google Calendar (fbk_022): the connection of a person, the Google event of a meeting and the calendar of a person. No State collection reads them.
  'google_connections', 'google_events', 'google_calendars',
  // The Daftra link (owner, 2026-10-26): the match of a Madar client to a Daftra client, and the cache of recent Daftra invoices. No State collection reads them.
  'daftra_clients', 'daftra_invoices',
] as const;

/** The rows of one collection, in the order of its State map. Settings is one row with the key "office". */
export function rowsOf(state: State, spec: TableSpec): { id: string; doc: Rec }[] {
  if (spec.collection === 'settings') return [{ id: 'office', doc: state.settings as Rec }];
  const map = (state[spec.collection] ?? {}) as Record<string, Rec>;
  return Object.values(map).map((doc) => ({ id: spec.key(doc), doc }));
}

/** The State value of one collection from its docs, in the given order (the loader reads them by "ord"). */
export function collectionOf(spec: TableSpec, docs: Rec[]): unknown {
  if (spec.collection === 'settings') return docs[0];
  return Object.fromEntries(docs.map((doc) => [spec.key(doc), doc]));
}
