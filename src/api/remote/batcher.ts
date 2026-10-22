import { BATCH_BUDGET, MAX_BATCH } from './wire';

/**
 * Collects the calls of one moment into requests (client map 4.1). The window is setTimeout(0): every call that starts in the
 * same task and its microtasks (one React commit, its effects, a Promise.all) goes together. A request holds at most MAX_BATCH
 * calls and at most one overview call, because the CPU limit of the server covers the whole request (plan 4.10). The calls
 * keep their order: a call joins the last request, or starts a new one.
 *
 * A call with "after" (a read that a screen sends right after its own write, performance audit FET-3) joins the request of that
 * write instead, after it, when it fits there. The server runs the calls of a request in order, so the read sees the write.
 * A follow read is one extra trip for the save when it stays out, so it has the larger limit: the calls of the request may cost
 * BATCH_BUDGET together (callCost, wire.ts), so the cheap person lists of a screen go with the write (perf2 savetrip, 2026-10-22).
 * The server accepts the same sum. When it does not fit (a full request, a cost over the budget, a write that waits or went
 * before), it goes as any other call, and RemoteApi does not count it as a read after the write.
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

export class Batcher<T extends { cost: number; after?: object }> {
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
    const requests: { token: object; items: T[]; cost: number }[] = [];
    type Request = (typeof requests)[number];
    // A follow read in the request of its write: the cost of the calls stays within the budget. Any other call: one overview call.
    const fitsHost = (request: Request | undefined, item: T): request is Request =>
      request !== undefined && request.items.length < MAX_BATCH && request.cost + item.cost <= BATCH_BUDGET;
    const fits = (request: Request | undefined, item: T): request is Request =>
      request !== undefined && request.items.length < MAX_BATCH && !(item.cost > 0 && request.cost > 0);
    for (const item of items) {
      const host = item.after === undefined ? undefined : requests.find((request) => request.items.includes(item.after as T));
      const last = requests.at(-1);
      let current: Request;
      if (fitsHost(host, item)) current = host;
      else if (fits(last, item)) current = last;
      else {
        current = { token: {}, items: [], cost: 0 };
        requests.push(current);
      }
      const wait = this.#o.place?.(item, current.token) ?? null;
      if (wait) {
        void wait.then(() => this.add(item));
        continue;
      }
      current.items.push(item);
      current.cost += item.cost;
    }
    for (const request of requests) if (request.items.length > 0) this.#o.send(request.items);
  }
}
