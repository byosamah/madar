/**
 * The follow step of the real build (performance audit FET-3), in a file of its own: the runtime of both builds imports
 * canFollow, so the prototype bundle never takes RemoteApi with it.
 */

/** The reads that ran right after one own write in its request and answered, with the tag of their follow step. */
export type FreshReads = { tag: object; reads: { name: string; input: unknown }[] };

/**
 * follow() runs write() at once. When write() put exactly one write on the wire at that moment, it then runs reads() at once:
 * each read that reads() sends goes in the request of that write, right after it, when it fits there (batcher.ts). The server
 * runs the calls of a request in order, so those reads see the write. The signals of the answer then name the reads that
 * answered after the write, with the tag (RemoteApi onSignals). An adapted call writes later, so it runs no reads.
 * Returns the promise of write().
 */
export type FollowApi = { follow<T>(write: () => Promise<T>, reads: () => void, tag: object): Promise<T> };

/** True for the api of the real build (RemoteApi), which has the follow step. */
export function canFollow(api: unknown): api is FollowApi {
  return typeof api === 'object' && api !== null && typeof (api as { follow?: unknown }).follow === 'function';
}
