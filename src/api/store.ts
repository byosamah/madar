import type {
  ChatRead, Client, Comment, Conversation, Deadline, Event, Feedback, FileRec, Message, Notification, Payment, Project, ProjectMember, Settings, Stage, StageTemplate, Task, TaskTemplate,
  Team, TrackerEntry, Update, User,
} from './contract/entities';
import { DEFAULT_STALE_DAYS } from './contract/entities';
import type { Persister } from './persist';

/**
 * Version 2 added the grammatical gender of people. Version 3 removed the hours system (owner, 2026-10-01).
 * Version 4 added the chat: conversations, messages and read marks. Version 7 added the restart-day notice.
 * Version 8 gave each date note the due day it was made for.
 * src/data/migrate.ts brings older offices up to date.
 */
export const STATE_VERSION = 8;

export const DEFAULT_STAGES = [
  'Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits', 'Tender', 'Supervision',
] as const;

export type State = {
  version: number;
  seededOn: string;
  session: { currentUserId: string; simulateErrors: boolean };
  users: Record<string, User>;
  clients: Record<string, Client>;
  projects: Record<string, Project>;
  members: Record<string, ProjectMember>;
  stages: Record<string, Stage>;
  deadlines: Record<string, Deadline>;
  tasks: Record<string, Task>;
  updates: Record<string, Update>;
  comments: Record<string, Comment>;
  files: Record<string, FileRec>;
  notifications: Record<string, Notification>;
  events: Record<string, Event>;
  conversations: Record<string, Conversation>;
  messages: Record<string, Message>;
  /** Keyed by chatReadKey: one mark for each person and conversation. */
  chatReads: Record<string, ChatRead>;
  /** Saved stage lists. Offices saved before this feature have none, so reads go through stageTemplatesOf. */
  stageTemplates?: Record<string, StageTemplate>;
  /** Saved tasks, one stage each. Offices saved before this feature have none, so reads go through taskTemplatesOf. */
  taskTemplates?: Record<string, TaskTemplate>;
  /** The client tracker. Offices saved before this feature have none, so reads go through trackerOf. */
  tracker?: Record<string, TrackerEntry>;
  /** The payment milestones. Offices saved before this feature have none, so reads go through paymentsOf. */
  payments?: Record<string, Payment>;
  /** Feature requests and bug reports. Optional, so older offices still load. */
  feedback?: Record<string, Feedback>;
  /** The office teams. Offices saved before this feature have none, so reads go through teamsOf. */
  teams?: Record<string, Team>;
  settings: Settings;
  counters: Record<string, number>;
  /**
   * The real build: counts that a server loader puts in a read, so a list shows the number of comments and files without loading
   * them (plan 4.13, A4), and the unread number of each chat and task thread without its unread rows (A9). Keys come from
   * commentCountKey, fileCountKey and unreadCountKey. The prototype never sets it, and the server never saves it.
   */
  counts?: Record<string, number>;
};

export function emptyState(today: string): State {
  return {
    version: STATE_VERSION,
    seededOn: today,
    session: { currentUserId: '', simulateErrors: false },
    users: {},
    clients: {},
    projects: {},
    members: {},
    stages: {},
    deadlines: {},
    tasks: {},
    updates: {},
    comments: {},
    files: {},
    notifications: {},
    events: {},
    conversations: {},
    messages: {},
    chatReads: {},
    stageTemplates: {},
    taskTemplates: {},
    tracker: {},
    payments: {},
    teams: {},
    settings: { defaultStages: [...DEFAULT_STAGES], codePrefix: 'KH', workloadLimit: 10, staleAfterDays: DEFAULT_STALE_DAYS },
    counters: {},
  };
}

/** The saved stage templates. An old office has none, so this makes the collection when it is missing. */
export function stageTemplatesOf(state: State): Record<string, StageTemplate> {
  state.stageTemplates ??= {};
  return state.stageTemplates;
}

/** The saved task templates. An old office has none, so this makes the collection when it is missing. */
export function taskTemplatesOf(state: State): Record<string, TaskTemplate> {
  state.taskTemplates ??= {};
  return state.taskTemplates;
}

/** The tracker entries. An old office has none, so this makes the collection when it is missing. */
export function trackerOf(state: State): Record<string, TrackerEntry> {
  state.tracker ??= {};
  return state.tracker;
}

/** The payment milestones. An old office has none, so this makes the collection when it is missing. */
export function feedbackOf(state: State): Record<string, Feedback> {
  state.feedback ??= {};
  return state.feedback;
}

export function paymentsOf(state: State): Record<string, Payment> {
  state.payments ??= {};
  return state.payments;
}

/** The office teams. An old office has none, so this makes the collection when it is missing. */
export function teamsOf(state: State): Record<string, Team> {
  state.teams ??= {};
  return state.teams;
}

export function memberKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

export function chatReadKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`;
}

/** The key of the comment count of a task or a post in State.counts. */
export function commentCountKey(targetId: string): string {
  return `comments:${targetId}`;
}

/** The key of the unread number of a chat or a task thread for one person in State.counts (plan 4.13, A9). */
export function unreadCountKey(conversationId: string, userId: string): string {
  return `unread:${conversationId}:${userId}`;
}

/** The key of the file count of a task in State.counts. */
export function fileCountKey(taskId: string): string {
  return `files:${taskId}`;
}

export function nextId(state: State, prefix: string): string {
  const n = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = n;
  return `${prefix}_${String(n).padStart(3, '0')}`;
}

export class Store {
  #state: State;
  #persistent: boolean;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #listeners = new Set<() => void>();
  readonly persister: Persister;

  constructor(state: State, persister: Persister) {
    this.#state = state;
    this.persister = persister;
    this.#persistent = persister.persistent;
  }

  get state(): State {
    return this.#state;
  }

  get persistent(): boolean {
    return this.#persistent;
  }

  /** Runs a change. The function must be synchronous. On an error, the state goes back to its value before the call. */
  run<T>(fn: (state: State) => T): T {
    const snapshot = structuredClone(this.#state);
    try {
      const result = fn(this.#state);
      this.#changed();
      return result;
    } catch (error) {
      this.#state = snapshot;
      throw error;
    }
  }

  /** Runs a read. A read does not save and does not tell the listeners. */
  read<T>(fn: (state: State) => T): T {
    return fn(this.#state);
  }

  replace(next: State): void {
    this.#state = next;
    this.#changed();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async flush(): Promise<void> {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    await this.#save();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#save();
    }, 200);
  }

  async #save(): Promise<void> {
    try {
      await this.persister.save(this.#state);
    } catch {
      this.#persistent = false;
    }
  }
}
