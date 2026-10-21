/**
 * The calls that only read. RemoteApi gives every other call an idempotency key and never sends it again by itself (plan 4.10).
 * The browser keeps this list by name, because the remote bundle carries no handler code; keys.test.ts fails when it drifts
 * from the readOnly flags of the call map. A name that is not here counts as a write.
 */
export const READ_CALLS: ReadonlySet<string> = new Set([
  'agents.list', 'chats.list', 'chats.messages', 'chats.typing', 'chats.unreadCount', 'chats.waiting', 'clients.list', 'comments.list', 'dashboard.get',
  'deadlines.list', 'events.list', 'feedback.list', 'feedback.screenshot', 'files.get', 'files.link', 'files.list', 'google.connectStart', 'google.status', 'live.ticket', 'meetings.get', 'meetings.list',
  'notifications.count', 'notifications.list', 'payments.list', 'projectTemplates.list', 'projectTemplates.matchPlan', 'projectTemplates.syncPlan', 'projectTemplates.usage', 'projects.get', 'projects.list', 'push.mine', 'reports.office', 'search.query', 'session.get',
  'settings.get', 'stageTemplates.list', 'subCompanies.list', 'taskTemplates.list', 'tasks.get', 'tasks.list', 'teams.list', 'tracker.export',
  'tracker.list', 'updates.list', 'users.get', 'users.invites', 'users.list',
]);

export function isRead(name: string): boolean {
  return READ_CALLS.has(name);
}

/** A new idempotency key: a random UUID. */
export function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The idempotency keys of one action hook (useAction, useUndoable). Each new attempt from the screen gets a new key. A Retry
 * gets the key of the attempt that failed, so when that write did happen and only its answer was lost, the server returns the
 * first answer and writes nothing twice (client map 2.6). Keys wait in a queue for each input object, because the mutation
 * function starts a few microtasks after mutate().
 */
export class AttemptKeys {
  #waiting = new WeakMap<object, string[]>();
  #failed = new WeakMap<object, string>();

  /** A new attempt from the screen. */
  fresh(input: unknown): void {
    this.#push(input, newKey());
  }

  /** A Retry of a failed attempt. */
  again(input: unknown): void {
    this.#push(input, (isObject(input) && this.#failed.get(input)) || newKey());
  }

  /** Runs one attempt with its key, and keeps the key when the attempt fails. */
  async run<T>(input: unknown, work: (key: string) => Promise<T>): Promise<T> {
    const key = (isObject(input) && this.#waiting.get(input)?.shift()) || newKey();
    try {
      const result = await work(key);
      if (isObject(input) && this.#failed.get(input) === key) this.#failed.delete(input);
      return result;
    } catch (error) {
      if (isObject(input)) this.#failed.set(input, key);
      throw error;
    }
  }

  #push(input: unknown, key: string): void {
    if (!isObject(input)) return;
    const queue = this.#waiting.get(input) ?? [];
    queue.push(key);
    this.#waiting.set(input, queue);
  }
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
