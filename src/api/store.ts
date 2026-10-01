import type {
  ChatRead, Client, Comment, Conversation, Deadline, Event, FileRec, Message, Notification, Project, ProjectMember, Settings, Stage, StageTemplate, Task,
  Update, User,
} from './contract/entities';
import type { Persister } from './persist';

/**
 * Version 2 added the grammatical gender of people. Version 3 removed the hours system (owner, 2026-10-01).
 * Version 4 added the chat: conversations, messages and read marks.
 * src/data/migrate.ts brings older offices up to date.
 */
export const STATE_VERSION = 4;

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
  settings: Settings;
  counters: Record<string, number>;
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
    settings: { defaultStages: [...DEFAULT_STAGES], codePrefix: 'KH', workloadLimit: 10 },
    counters: {},
  };
}

/** The saved stage templates. An old office has none, so this makes the collection when it is missing. */
export function stageTemplatesOf(state: State): Record<string, StageTemplate> {
  state.stageTemplates ??= {};
  return state.stageTemplates;
}

export function memberKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

export function chatReadKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`;
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
