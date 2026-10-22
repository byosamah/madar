import type { Conversation, Meeting, Task } from '../../src/api/contract/entities';
import { rightsOf } from '../../src/api/rights';
import type { State } from '../../src/api/store';
import type { Query } from '../core/ports';
import type { ChangeSignal, Kind } from '../core/types';
import {
  COUNTERS_UPSERT_SQL, OFFICE_DELETES_SQL, deleteSql, rowOf, rowsParam, upsertSql, type Row,
} from './rows';
import { audienceFinder } from './projectAudience';
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
 *   chats with whom; a person signal names only its person. A save that changes an office task sends that part to the people
 *   of the task and the Admins with a second id, every kind and no actor or story (see writeDiff, review 2026-10-06).
 * - A direct chat or a group (owner, 2026-10-21, perf2 SV-7 and DF-2, it replaces the anonymous office signal of INT-16): the office
 *   signal never tells that part. Each member of each chat that the save touched, before and after it (a person taken out or added
 *   hears it too), gets a person signal with the kinds of that part, with a second id. The other open tabs reload nothing for it.
 *   All these signals go in the one person_seq statement and the one send of the save.
 * - A hidden project (owner, 2026-10-22, wave D3): a project that at least one active person may not view (hidden, or open for a role
 *   without "See every project"; projectAudience.ts) sends every change that names it (the project, its members, stages, deadlines,
 *   tasks, files, posts, comments, messages, chat, events and meetings) only as person signals. They go to the people who view the
 *   project before the change and after it, so a person who loses the view and a person who gains it both hear the change. The office
 *   signal never names such a project. A person of that part gets one signal with its own id, the kinds of the projects that the
 *   person views, and those project ids. With the default settings no project is restricted, and every signal is as before.
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
  /** The messages that this change inserted, in the order of the State (the push producer reads them, server/push/notify.ts). */
  messageIds: string[];
  /** The comments that this change inserted, in State order: the push producer reads them (a comment of a task pushes the lead). */
  commentIds: string[];
  /** The notices that the save inserted, in State order: the mail and push producers on SQLite (exit wave 3) read them. */
  noticeIds: string[];
  /** The meetings that the save inserted, changed or deleted: the Google Calendar sync reads them (server/google/rows.ts, fbk_022). */
  meetingIds: string[];
  /** True when a row of an office table changed: the office cache must load again (plan 4.7). */
  officeRows: boolean;
  /** True when every kind is personal (chatReads, notifications, preferences): no office signal. */
  personal: boolean;
  /** Comments whose target neither State holds. writeDiff looks up their project with one query. */
  unresolvedComments: { id: string; targetType: string; targetId: string }[];
  meta: SignalMeta;
  /**
   * True when the change touched an office task, its comments or its files (owner, 2026-10-06), or a meeting with no project, its
   * notices or its events (fbk_022, owner 2026-10-19): its signals name no actor and no story (review 2026-10-06).
   */
  privateChange: boolean;
  /**
   * The people of the office tasks that the change touched, and every active Admin; and the organizer and the attendees, before and
   * after the change, of the private meetings that it touched. The Admin hears a meeting only as one of its people.
   */
  privatePeople: Set<string>;
  /** The kinds of the project part of the change (all kinds when it touched no office task): the office signal tells only these. */
  publicKinds: Set<Kind>;
  /**
   * True when the change touched office tasks or private meetings and nothing of a project or of the office: it sends no office
   * signal, only a person signal to each of privatePeople (review 2026-10-06).
   */
  privateOnly: boolean;
  /**
   * The old rule of INT-16 (UX audit 2026-10-19), now only the safe fallback: true when the change touched chats with no project that
   * the save could not find (a message whose chat neither State holds) and nothing else. Its office signal names no actor and no
   * story. A found direct chat or group never comes here: it has chatKinds and chatPeople, and sends no office signal.
   */
  anonymous: boolean;
  /**
   * The kinds of the direct chats and groups that the change touched (owner, 2026-10-21): their messages, the chats themselves, their
   * files, and the read marks and notices of their people. They are in `kinds`, and never in `publicKinds`, so no office signal tells them.
   */
  chatKinds: Set<Kind>;
  /** The people who hear that part: the members of each touched chat before and after the change, and the owner of each mark and notice. */
  chatPeople: Set<string>;
  /** The kinds of every record that is no part of a direct chat or a group. */
  restKinds: Set<Kind>;
  /** The office flag of the records that are no part of a direct chat or a group: the office signal tells only this one. */
  publicOffice: boolean;
  /**
   * The changes of the projects that not every active person may view (hidden projects, owner 2026-10-22): for each project, the kinds that
   * changed and the people who hear them. The kinds are in `kinds`, and never in `publicKinds` or `restKinds`.
   */
  hidden: Map<string, { kinds: Set<Kind>; people: ReadonlySet<string> }>;
  /** The people who view a project before the change or after it, or null when the project is open to all (writeDiff asks it for a comment it looks up). */
  audienceOf: (projectId: string) => ReadonlySet<string> | null;
  /** True when every record that gave the kind "comments" to the public part is a comment whose project writeDiff looks up. */
  lateComments: boolean;
};

export type SaveResult = {
  changed: boolean;
  kinds: Set<Kind>;
  projects: Set<string>;
  office: boolean;
  people: Set<string>;
  /** The messages that the save inserted. The push producer reads them. Left out when there are none. */
  messageIds?: string[];
  /** The comments that the save inserted. The push producer reads them. Left out when there are none. */
  commentIds?: string[];
  /** The notices that the save inserted. Left out when there are none. */
  noticeIds?: string[];
  /** The meetings that the save inserted, changed or deleted (fbk_022). Left out when there are none. */
  meetingIds?: string[];
  bytesWritten: number;
  signals: ChangeSignal[];
  /** The new office_meta.version when the save raised it. runCall then drops BatchScope.office (plan 4.7). */
  officeVersion?: number;
  /**
   * The projects that not every active person views and that the save touched (hidden projects, owner 2026-10-22). They are no part of
   * `projects`, which names the public ones. The Google Calendar sync reads them. Left out when there are none.
   */
  hiddenProjects?: string[];
};

export type SaveOptions = { story?: SignalMeta; signals?: boolean };

const PERSONAL_KINDS = new Set<Kind>(['chatReads', 'notifications', 'preferences']);
/**
 * The kinds that a direct chat or a group writes (UX audit 2026-10-19, INT-16): the fallback rule names no actor in the office signal
 * of a save of these kinds alone. A file of such a chat is one of them (owner, 2026-10-19); a file of a project has a project, so it
 * never counts here.
 */
const PRIVATE_CHAT_KINDS = new Set<Kind>(['messages', 'conversations', 'chatReads', 'notifications', 'files']);
/** The collections whose records belong to no project. A change of one of them is an office change. */
const OFFICE_SCOPE = new Set<string>(['clients', 'teams', 'settings', 'stageTemplates', 'taskTemplates', 'projectTemplates', 'feedback']);

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

/**
 * The JSON of each deep-frozen record, made once (performance audit DB-7). The "before" of a write holds the office lists of the
 * snapshot (officeCache.ts, deep-frozen), and a deep-frozen record never changes, so its JSON stays true while it lives. A record
 * that is not frozen at every level gets its JSON of now each time.
 */
const frozenJson = new WeakMap<object, string>();

function deepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

function jsonOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || !Object.isFrozen(value)) return JSON.stringify(value);
  const known = frozenJson.get(value);
  if (known !== undefined) return known;
  const json = JSON.stringify(value);
  if (deepFrozen(value)) frozenJson.set(value, json);
  return json;
}

function same(a: unknown, b: unknown): boolean {
  return jsonOf(a) === jsonOf(b) || canonical(a) === canonical(b);
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

/**
 * The last copy of a deleted task, from its newest delete event in the State (the rule of lastTaskCopy in src/api/events.ts). It
 * lives here because the db test setup loads this file and must load no API module that a test may mock.
 */
function deletedTaskCopy(state: State, taskId: string): Task | undefined {
  let found: State['events'][string] | undefined;
  for (const event of Object.values(state.events)) {
    if (event.verb === 'task.deleted' && event.targetId === taskId && !event.undoneBy && (!found || event.seq > found.seq)) found = event;
  }
  return found && found.before !== null && typeof found.before === 'object' ? (found.before as Task) : undefined;
}

function historyError(text: string): Error {
  return new Error(`The History only grows: ${text}`);
}

export function diffState(before: State, after: State): Diff {
  const tables: TableChange[] = [];
  const kinds = new Set<Kind>();
  /** The kinds of the project part (and the office) alone: the kinds that the office signal may tell (review 2026-10-06). */
  const publicKinds = new Set<Kind>();
  const projects = new Set<string>();
  const people = new Set<string>();
  const unresolvedComments: Diff['unresolvedComments'] = [];
  const preferencesOnly = new Set<string>();
  /** The direct chats and groups part (owner, 2026-10-21): its kinds, and the people who hear it. No office signal tells it. */
  const chatKinds = new Set<Kind>();
  const chatPeople = new Set<string>();
  /** The kinds of every record that is no part of a direct chat or a group. */
  const restKinds = new Set<Kind>();
  let office = false;
  /** The office flag of the records that are no part of a direct chat or a group. */
  let publicOffice = false;
  const audienceOf = audienceFinder(before, after);
  /** The projects that not every active person views (hidden projects): their kinds and their people. */
  const hidden: Diff['hidden'] = new Map();
  /** How many records gave each kind to the public part: a comment that writeDiff looks up may take its kind back. */
  const publicCount = new Map<Kind, number>();
  let officeRows = false;
  let meta: SignalMeta | undefined;
  /** The office tasks that the change touched: the task, its comments, its files and their events (owner, 2026-10-06). */
  const officeTasks = new Set<string>();
  /** The meetings with no project that the change touched: the meeting, its notices and its events (fbk_022). */
  const officeMeetings = new Set<string>();
  /** Comments whose target neither State holds: their event tells whether they belong to an office task. */
  const pendingComments: { id: string; row: Row | undefined; deleted: boolean; targetType: string; targetId: string }[] = [];

  /** The person that a signal or a notice goes to: the person behind an agent, else the user. */
  const principal = (id: string): string => {
    const user = after.users[id] ?? before.users[id];
    return user?.kind === 'agent' && user.ownerId ? user.ownerId : id;
  };
  const markOffice = () => {
    office = true;
    publicOffice = true;
  };
  const addProject = (projectId: unknown) => {
    if (typeof projectId === 'string' && projectId !== '') projects.add(projectId);
    else markOffice();
  };
  /** The direct chat or group with this id in either State; a project chat and an unknown id give undefined. */
  const privateChat = (id: unknown): Conversation | undefined => {
    if (typeof id !== 'string') return undefined;
    const found = after.conversations[id] ?? before.conversations[id];
    return found && found.kind !== 'project' ? found : undefined;
  };
  /** A kind of a direct chat or a group part: it goes to the people of that part only (owner, 2026-10-21). */
  const chatPart = (kind: Kind) => {
    kinds.add(kind);
    chatKinds.add(kind);
  };
  /** Every member of the chat before and after the change: a person taken out or added hears it too. */
  const chatMembers = (chat: Conversation) => {
    office = true;
    for (const conversation of [before.conversations[chat.id], after.conversations[chat.id]]) {
      for (const id of conversation?.memberIds ?? []) chatPeople.add(principal(id));
    }
  };
  const taskOf = (id: unknown): Rec | undefined => (typeof id === 'string' ? (after.tasks[id] ?? before.tasks[id]) as Rec | undefined : undefined);
  const isOfficeTask = (id: unknown): boolean => taskOf(id)?.projectId === null;
  const meetingOf = (id: unknown): Rec | undefined => (typeof id === 'string' ? (after.meetings?.[id] ?? before.meetings?.[id]) as Rec | undefined : undefined);
  const isPrivateMeeting = (id: unknown): boolean => meetingOf(id)?.projectId === null;
  /** A kind of the project part (or the office) of the change, which the office signal may tell. */
  const pub = (kind: Kind) => {
    kinds.add(kind);
    restKinds.add(kind);
    publicKinds.add(kind);
    publicCount.set(kind, (publicCount.get(kind) ?? 0) + 1);
  };
  /**
   * A kind of a record that names a project. A project that not every active person views (hidden projects, owner 2026-10-22) keeps the
   * kind for its people: no office signal, no office flag and no project id on the office channel. Any other project is a public part.
   */
  const projectPart = (kind: Kind, projectId: unknown) => {
    const audience = typeof projectId === 'string' && projectId !== '' ? audienceOf(projectId) : null;
    if (audience === null) {
      pub(kind);
      addProject(projectId);
      return;
    }
    kinds.add(kind);
    const part = hidden.get(projectId as string) ?? { kinds: new Set<Kind>(), people: audience };
    part.kinds.add(kind);
    hidden.set(projectId as string, part);
  };
  /** A kind of the office task part, which only the people of the task hear (review 2026-10-06). */
  const priv = (kind: Kind) => {
    kinds.add(kind);
    restKinds.add(kind);
  };

  /**
   * A look that moves the seen time (chat presence design C4, base B3) also signals the authors whose message it made seen: the person
   * behind the author of each live message of the chat that is newer than the old seen time and not newer than the new one. The kind
   * stays chatReads (personal), so the office hears nothing. A message of an agent signals the person the agent acts for.
   */
  function seenSignal(old: Rec | undefined, rec: Rec, chat: boolean): void {
    const now = typeof rec.seenAt === 'string' ? rec.seenAt : '';
    const was = old && typeof old.seenAt === 'string' ? old.seenAt : '';
    if (now === '' || now <= was) return;
    for (const message of Object.values(after.messages)) {
      if (message.conversationId !== rec.conversationId || message.deletedAt || message.createdAt <= was || message.createdAt > now) continue;
      const person = principal(message.authorId);
      if (person === rec.userId) continue;
      people.add(person);
      // The author of a message in a direct chat or a group hears it as a member of that part (owner, 2026-10-21).
      if (chat) chatPeople.add(person);
    }
  }

  /** Kinds, projects, people and the office flag of one changed record (old: before the call; rec: after it). */
  function touched(spec: TableSpec, old: Rec | undefined, rec: Rec | undefined, row: Row | undefined): void {
    const sides = [old, rec].filter((side): side is Rec => side !== undefined);
    switch (spec.collection) {
      case 'projects':
        projectPart(old && rec && same(without(old, 'updatedAt'), without(rec, 'updatedAt')) ? 'projectTouched' : 'projects', (rec ?? old)!.id);
        return;
      case 'users': {
        const id = (rec ?? old)!.id as string;
        const preferencesChanged = !old || !rec || !same(old.preferences, rec.preferences);
        if (old && rec && same(without(old, 'preferences'), without(rec, 'preferences'))) {
          preferencesOnly.add(id);
        } else {
          pub('users');
          markOffice();
        }
        if (old && rec && preferencesChanged) {
          pub('preferences');
          people.add(id);
        }
        return;
      }
      case 'notifications':
      case 'chatReads': {
        let inChat = false;
        for (const side of sides) {
          // A notice of an office task, or a read mark of its thread, is of the office task part.
          const officeSide = spec.collection === 'notifications' ? side.targetType === 'task' && isOfficeTask(side.targetId) : isOfficeTask(side.conversationId);
          // A notice of a meeting with no project is of the private meeting part (fbk_022).
          const privateMeeting = spec.collection === 'notifications' && side.targetType === 'meeting' && isPrivateMeeting(side.targetId);
          if (privateMeeting) officeMeetings.add(side.targetId as string);
          // A mark or a notice of a direct chat or a group is of the chat part: only its owner hears it, with the kinds of that part.
          const chat = !officeSide && !privateMeeting
            && privateChat(spec.collection === 'notifications' ? (side.targetType === 'chat' ? side.targetId : undefined) : side.conversationId);
          if (chat) {
            chatPart(spec.collection);
            chatPeople.add(principal(side.userId as string));
            inChat = true;
          } else {
            (officeSide || privateMeeting ? priv : pub)(spec.collection);
          }
          people.add(side.userId as string);
        }
        if (spec.collection === 'chatReads' && rec) seenSignal(old, rec, inChat);
        return;
      }
      case 'meetings':
        for (const side of sides) {
          // A meeting with no project belongs to its people: no project and no office signal. A project meeting belongs to its project.
          if (side.projectId === null || side.projectId === undefined) {
            priv('meetings');
            officeMeetings.add(side.id as string);
          } else {
            projectPart('meetings', side.projectId);
          }
        }
        return;
      case 'comments': {
        const side = (rec ?? old)!;
        // A comment of an office task belongs to that task: no project, and no office signal.
        const target = side.targetType === 'task' ? taskOf(side.targetId) : undefined;
        if (target && target.projectId === null) {
          priv('comments');
          officeTasks.add(side.targetId as string);
          return;
        }
        const fromState = (one: Rec) => spec.serverColumns!.project_id(one, after) ?? spec.serverColumns!.project_id(one, before);
        const found = fromState(side);
        if (typeof found === 'string') {
          projectPart('comments', found);
          if (row && row.columns.project_id === null) row.columns.project_id = found;
          return;
        }
        // An unknown target: the event of the change tells an office task (below); else writeDiff looks up a written comment,
        // and a deleted one names the office, so every list reloads, to be safe.
        pendingComments.push({ id: side.id as string, row, deleted: !rec, targetType: side.targetType as string, targetId: side.targetId as string });
        return;
      }
      case 'pushDevices':
        // A push device is private (owner, 2026-10-08): it adds no kind, so the save sends no signal that names it, and no
        // office signal. The row is still written.
        return;
      case 'messages':
        for (const side of sides) {
          const conversationId = side.conversationId as string;
          const chat = privateChat(conversationId);
          if (chat) {
            // A message of a direct chat or a group goes to the members of that chat and to nobody else (owner, 2026-10-21).
            chatPart('messages');
            chatMembers(chat);
          } else {
            projectPart('messages', (after.conversations[conversationId] ?? before.conversations[conversationId])?.projectId);
          }
        }
        return;
      case 'conversations':
        for (const side of sides as unknown as Conversation[]) {
          if (side.kind !== 'project') {
            chatPart('conversations');
            chatMembers(side);
          } else {
            projectPart('conversations', side.projectId);
          }
        }
        return;
      case 'events':
        // An event of a person's own preferences belongs to that personal change.
        if (rec && rec.targetType === 'user' && preferencesOnly.has(rec.targetId as string)) {
          pub('preferences');
          return;
        }
        // A change of an office task, its comments or its files names the task: it touches no project and not the office.
        if (typeof rec!.officeTaskId === 'string') {
          priv('events');
          officeTasks.add(rec!.officeTaskId);
        } else if (typeof rec!.officeMeetingId === 'string') {
          // The same for a change of a meeting with no project (fbk_022).
          priv('events');
          officeMeetings.add(rec!.officeMeetingId);
        } else {
          projectPart('events', rec!.projectId);
        }
        return;
      default:
        if (OFFICE_SCOPE.has(spec.collection)) {
          pub(spec.collection);
          markOffice();
        } else {
          for (const side of sides) {
            // An office task, and a file of one, belong to the task (owner, 2026-10-06).
            if (spec.collection === 'tasks' && side.projectId === null) {
              priv(spec.collection);
              officeTasks.add(side.id as string);
            } else if (spec.collection === 'files' && side.projectId === null && typeof side.taskId === 'string') {
              priv(spec.collection);
              officeTasks.add(side.taskId);
            } else if (spec.collection === 'files' && side.projectId === null && typeof side.meetingId === 'string') {
              // A file of a meeting with no project (wave 2) belongs to that private meeting: only its people hear the change, as for the
              // meeting itself, the Admin too only when invited. No project and no office signal.
              priv(spec.collection);
              officeMeetings.add(side.meetingId);
            } else if (spec.collection === 'files' && side.projectId === null && typeof side.conversationId === 'string') {
              // A file of a direct chat or a group (owner, 2026-10-19) is private like a message: it belongs to no project and no task. It
              // goes to the members of the chat only (owner, 2026-10-21). The signal holds the kind "files" and nothing else: no file id,
              // no file name and no chat. A chat that neither State holds keeps the old anonymous office signal.
              const chat = privateChat(side.conversationId);
              if (chat) {
                chatPart(spec.collection);
                chatMembers(chat);
              } else {
                pub(spec.collection);
                markOffice();
              }
            } else {
              projectPart(spec.collection, side.projectId);
            }
          }
        }
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

  // A comment with an unknown target: an event of this save that names an office task for it settles it.
  const officeOfComment = new Map<string, string>();
  for (const event of Object.values(after.events)) {
    if (event.targetType === 'comment' && event.officeTaskId && !before.events[event.id]) officeOfComment.set(event.targetId, event.officeTaskId);
  }
  for (const comment of pendingComments) {
    const officeTask = officeOfComment.get(comment.id);
    if (officeTask) {
      priv('comments');
      officeTasks.add(officeTask);
    } else {
      pub('comments');
      if (comment.row) unresolvedComments.push({ id: comment.id, targetType: comment.targetType, targetId: comment.targetId });
      else if (comment.deleted) markOffice();
    }
  }

  // The people of each office task the change touched, before and after it (a person taken off still gets the signal that
  // drops the task from their lists), and every active holder of task.officeAll (the Admin holds it). A deleted task tells its people through its last copy.
  const privatePeople = new Set<string>();
  for (const id of officeTasks) {
    const copies = [before.tasks[id], after.tasks[id]].filter((task): task is Task => task !== undefined);
    for (const task of copies.length > 0 ? copies : [deletedTaskCopy(after, id)].filter((task): task is Task => task !== undefined)) {
      privatePeople.add(principal(task.createdBy));
      if (task.ownerId) privatePeople.add(task.ownerId);
      for (const helper of task.helperIds ?? []) privatePeople.add(helper);
    }
  }
  if (officeTasks.size > 0) {
    // Every active person who holds task.officeAll hears it (role rights version 2). The Admin holds it, so each Admin hears it as before.
    for (const user of Object.values(after.users)) {
      if (user.kind === 'human' && user.active && rightsOf(user, after.settings?.roles).includes('task.officeAll')) privatePeople.add(user.id);
    }
  }
  // The people of each private meeting that the change touched, before and after it: a person taken off still hears the change that
  // drops the meeting from their lists. The Admin is not added: the Admin hears a meeting only as one of its people (owner, 2026-10-19).
  for (const id of officeMeetings) {
    for (const meeting of [before.meetings?.[id], after.meetings?.[id]].filter((one): one is Meeting => one !== undefined)) {
      privatePeople.add(principal(meeting.organizerId));
      for (const attendee of meeting.attendeeIds) privatePeople.add(attendee);
    }
  }

  const personal = kinds.size > 0 && [...kinds].every((kind) => PERSONAL_KINDS.has(kind));
  const anonymous = publicKinds.size > 0 && projects.size === 0 && officeTasks.size === 0 && officeMeetings.size === 0 && [...publicKinds].every((kind) => PRIVATE_CHAT_KINDS.has(kind));
  // Every record that gave "comments" to the public part is a comment that writeDiff looks up (the lookup may find a hidden project).
  const lateComments = unresolvedComments.length > 0 && publicCount.get('comments') === unresolvedComments.length;
  const messageIds = tables.find((change) => change.spec.collection === 'messages')?.inserted ?? [];
  const commentIds = tables.find((change) => change.spec.collection === 'comments')?.inserted ?? [];
  const noticeIds = tables.find((change) => change.spec.collection === 'notifications')?.inserted ?? [];
  const meetingChange = tables.find((change) => change.spec.collection === 'meetings');
  const meetingIds = meetingChange ? [...meetingChange.inserted, ...meetingChange.updated, ...meetingChange.deleted] : [];
  return {
    tables, counters, kinds, projects, office: personal ? false : office, people, messageIds, commentIds, noticeIds, meetingIds, officeRows, personal, unresolvedComments,
    meta: meta ?? { storyId: '', actorId: '' },
    privateChange: officeTasks.size > 0 || officeMeetings.size > 0,
    privatePeople,
    publicKinds,
    anonymous,
    chatKinds,
    chatPeople,
    restKinds,
    publicOffice: personal ? false : publicOffice,
    hidden,
    audienceOf,
    lateComments,
    // A comment whose project writeDiff still looks up may belong to a project, so it keeps the office signal. A chat part has its own
    // signal and does not count here. A hidden project has its own people, so it is no part of the private-only rule.
    privateOnly: (officeTasks.size > 0 || officeMeetings.size > 0) && !publicOffice && projects.size === 0 && unresolvedComments.length === 0 && hidden.size === 0,
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
  // The kinds of the public part: a comment that this function looks up may leave it for a hidden project.
  const publicKinds = new Set(diff.publicKinds);
  const restKinds = new Set(diff.restKinds);
  const hidden = new Map([...diff.hidden].map(([id, part]) => [id, { kinds: new Set(part.kinds), people: part.people }]));
  let office = diff.office;
  let publicOffice = diff.publicOffice;
  const changed = diff.tables.length > 0 || Object.keys(diff.counters).length > 0;
  const result = (fields: Partial<SaveResult> = {}): SaveResult => ({
    changed, kinds: new Set(diff.kinds), projects, office, people: new Set(diff.people), bytesWritten: 0, signals: [],
    ...(diff.messageIds.length > 0 ? { messageIds: diff.messageIds } : {}),
    ...(diff.commentIds.length > 0 ? { commentIds: diff.commentIds } : {}),
    ...(diff.noticeIds.length > 0 ? { noticeIds: diff.noticeIds } : {}),
    ...(diff.meetingIds.length > 0 ? { meetingIds: diff.meetingIds } : {}),
    ...(diff.hidden.size > 0 ? { hiddenProjects: [...diff.hidden.keys()].sort() } : {}),
    ...fields,
  });
  if (!changed) return result();

  // The project of each written comment whose target the call did not load.
  let leftPublic = 0;
  if (diff.unresolvedComments.length > 0) {
    const ofType = (type: string) => diff.unresolvedComments.filter((c) => c.targetType === type).map((c) => c.targetId);
    const found = await q<{ type: string; id: string; project_id: string | null }>(COMMENT_TARGETS_SQL, [ofType('task'), ofType('update')]);
    const projectOf = new Map(found.map((row) => [`${row.type}:${row.id}`, row.project_id]));
    const rows = new Map(diff.tables.find((t) => t.spec.collection === 'comments')?.upserts.map((row) => [row.id, row]));
    for (const comment of diff.unresolvedComments) {
      const projectId = projectOf.get(`${comment.targetType}:${comment.targetId}`) ?? null;
      const row = rows.get(comment.id);
      if (row) row.columns = { ...row.columns, project_id: projectId };
      const audience = projectId ? diff.audienceOf(projectId) : null;
      if (projectId && audience !== null) {
        // A project that not every active person views (hidden projects): its people hear the comment, and the office does not.
        const part = hidden.get(projectId) ?? { kinds: new Set<Kind>(), people: audience };
        part.kinds.add('comments');
        hidden.set(projectId, part);
        leftPublic += 1;
      } else if (projectId) projects.add(projectId);
      else if (!diff.personal) {
        office = true;
        publicOffice = true;
      }
    }
    // The comments that left the public part take their kind with them, when no other record gave the kind to it.
    if (leftPublic > 0 && leftPublic === diff.unresolvedComments.length && diff.lateComments) {
      publicKinds.delete('comments');
      restKinds.delete('comments');
    }
  }

  // The office signal tells only the project part of a change: a change of office tasks alone sends none, and their people and
  // the Admins hear it on their person channels (review 2026-10-06). With no office task, publicKinds holds every kind.
  const officeSignal = signalsOn && [...publicKinds].some((kind) => !PERSONAL_KINDS.has(kind));
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

  // The people of a direct chat or a group join the list (owner, 2026-10-21): they get the signal in place of an office signal. One statement
  // counts all their topics, whatever the number of people.
  const hiddenPeople = [...hidden.values()].flatMap((part) => [...part.people]);
  const people = [...new Set([...diff.people, ...(diff.privateChange ? diff.privatePeople : []), ...diff.chatPeople, ...hiddenPeople])].sort();
  let personSeq = new Map<string, number>();
  if (signalsOn && diff.kinds.size > 0 && people.length > 0) {
    const rows = await q<{ user_id: string; seq: string | number }>(PERSON_SEQ_SQL, [people]);
    personSeq = new Map(rows.map((row) => [row.user_id, Number(row.seq)]));
  }

  // The deferred foreign keys are checked here, inside the call, so a bad save fails the call and not only a later commit (TM R11).
  await q('set constraints all immediate');

  const signals: ChangeSignal[] = [];
  if (signalsOn && diff.kinds.size > 0) {
    // The project part: the office signal and the person signals of other people, with the actor and the story, and only the
    // kinds of that part. The office task part: one signal with its own id for each person of the task and each Admin, with every
    // kind and no names (review 2026-10-06). The screens match their own changes by the signal id.
    const shared = { v: 1 as const, projects: [...projects].sort(), office: publicOffice };
    const publicBase = {
      ...shared, id: crypto.randomUUID(), kinds: [...publicKinds].sort(), storyId: story.storyId, actorId: story.actorId,
    };
    // A chat that the save could not find keeps the old rule of INT-16: the office signal has no actor and no story. A found direct chat
    // or group sends no office signal at all (owner, 2026-10-21).
    const { storyId: _story, actorId: _actor, ...nameless } = publicBase;
    const officeBase = diff.anonymous ? nameless : publicBase;
    // The office task part: every kind of the records that are no chat part. A member of a chat touched by the save also hears the chat
    // kinds, in one signal with its own id (the screens drop a later signal with a known id, so it never shares the id of the office signal).
    const privateBase = diff.privateChange ? { ...shared, id: crypto.randomUUID(), kinds: [...restKinds].sort() } : null;
    const memberOf = { ...shared, office, id: crypto.randomUUID(), storyId: story.storyId, actorId: story.actorId };
    const chatBase = diff.chatPeople.size > 0 ? { ...memberOf, kinds: [...new Set([...publicKinds, ...diff.chatKinds])].sort() } : null;
    // A person of both parts hears all kinds in the signal of the office task part, which names no actor and no story.
    const chatPrivateBase = diff.chatPeople.size > 0 && privateBase
      ? { ...shared, office, id: privateBase.id, kinds: [...new Set([...restKinds, ...diff.chatKinds])].sort() }
      : null;
    const plainOf = (userId: string) => {
      const inPrivate = privateBase !== null && (diff.privateOnly || diff.privatePeople.has(userId));
      if (diff.chatPeople.has(userId)) return inPrivate && chatPrivateBase ? chatPrivateBase : chatBase!;
      return inPrivate ? privateBase! : publicBase;
    };
    // The hidden project part (owner, 2026-10-22): one signal with its own id for each person who views a project that the save touched. It
    // holds the kinds and the ids of those projects only, so a person never hears a project of which the person is no viewer. A person who
    // also hears another part keeps its kinds and ids too, under the id of this part (the screens drop a later signal with a known id).
    const hiddenId = hidden.size > 0 ? crypto.randomUUID() : '';
    const inOtherPart = (userId: string) => diff.people.has(userId) || (diff.privateChange && diff.privatePeople.has(userId)) || diff.chatPeople.has(userId);
    const baseOf = (userId: string) => {
      const own = [...hidden].filter(([, part]) => part.people.has(userId));
      if (own.length === 0) return plainOf(userId);
      const plain = inOtherPart(userId) ? plainOf(userId) : { v: 1 as const, office: false, projects: [] as string[], kinds: [] as Kind[], storyId: story.storyId, actorId: story.actorId };
      return {
        ...plain, id: hiddenId,
        projects: [...new Set([...plain.projects, ...own.map(([projectId]) => projectId)])].sort(),
        kinds: [...new Set([...plain.kinds, ...own.flatMap(([, part]) => [...part.kinds])])].sort(),
      };
    };
    if (officeSignal) signals.push({ ...officeBase, channel: 'office', seq: officeSeq, people: [] });
    for (const userId of people) signals.push({ ...baseOf(userId), channel: `person:${userId}`, seq: personSeq.get(userId) ?? 0, people: [userId] });
  }
  return result({ office, bytesWritten, signals, ...(version === undefined ? {} : { officeVersion: version }) });
}

export async function save(q: Query, before: State, after: State, o: SaveOptions = {}): Promise<SaveResult> {
  return writeDiff(q, diffState(before, after), o);
}
