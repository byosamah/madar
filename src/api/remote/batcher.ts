import { MAX_BATCH } from './wire';

/**
 * Collects the calls of one moment into requests (client map 4.1). The window is setTimeout(0): every call that starts in the
 * same task and its microtasks (one React commit, its effects, a Promise.all) goes together. A request holds at most MAX_BATCH
 * calls and at most one overview call, because the CPU limit of the server covers the whole request (plan 4.10). The calls
 * keep their order: a call joins the last request, or starts a new one.
 *
 * A call with "after" (a read that a screen sends right after its own write, performance audit FET-3) joins the request of that
 * write instead, after it, when it fits there. The server runs the calls of a request in order, so the read sees the write.
 * When it does not fit (a full request, a second overview call, a write that waits or went before), it goes as any other call,
 * and RemoteApi does not count it as a read after the write.
 */
export type BatcherOptions<T> = {
  /** Sends one request. */
  send: (items: T[]) => void;
  /**
   * Called for each call as it joins a request. null: the call goes in this request. A promise: the call must wait (a story
   * placeholder that an earlier request still holds), and the batcher adds it again when the promise ends.
   */
  place?: (item: T, request: object) => Promise<void> | null;
  /** Runs a function after the current task. Tests may pass their own. */
  schedule?: (run: () => void) => void;
};

export class Batcher<T extends { overview: boolean; after?: object }> {
  #queue: T[] = [];
  #timer = false;
  #o: BatcherOptions<T>;

  constructor(o: BatcherOptions<T>) {
    this.#o = o;
  }

  add(item: T): void {
    this.#queue.push(item);
    if (this.#queue.length >= MAX_BATCH) {
      this.flush();
      return;
    }
    if (this.#timer) return;
    this.#timer = true;
    (this.#o.schedule ?? ((run) => { setTimeout(run, 0); }))(() => {
      this.#timer = false;
      this.flush();
    });
  }

  /** Sends every queued call now. */
  flush(): void {
    const items = this.#queue.splice(0);
    if (items.length === 0) return;
    const requests: { token: object; items: T[]; overview: boolean }[] = [];
    type Request = (typeof requests)[number];
    const fits = (request: Request | undefined, item: T): request is Request =>
      request !== undefined && request.items.length < MAX_BATCH && !(item.overview && request.overview);
    for (const item of items) {
      const host = item.after === undefined ? undefined : requests.find((request) => request.items.includes(item.after as T));
      let current = fits(host, item) ? host : requests.at(-1);
      if (!fits(current, item)) {
        current = { token: {}, items: [], overview: false };
        requests.push(current);
      }
      const wait = this.#o.place?.(item, current.token) ?? null;
      if (wait) {
        void wait.then(() => this.add(item));
        continue;
      }
      current.items.push(item);
      current.overview ||= item.overview;
    }
    for (const request of requests) if (request.items.length > 0) this.#o.send(request.items);
  }
}
