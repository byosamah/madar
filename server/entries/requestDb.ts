import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db, Query } from '../core/ports';
import type { After } from './start';

/**
 * The database of one request, for the Workers entry (proof.md, E4). The Workers runtime ties a socket to the request that
 * opened it, so pools kept for the isolate answer the first request and hang every later one. The Workers entry opens a Db for
 * each request, runs the request inside its scope, and closes the Db when the answer has ended. The Deps keep one Db that
 * forwards to the Db of the current request, so the apps are still built once for each isolate.
 */

/** close() ends the connections of the Db. The Db port gains it as an optional member (merge lead patch of E). */
export type RequestDb = Db & { close?: () => Promise<void> };

export function requestScopedDb(): { db: Db; run<T>(db: RequestDb, work: () => T): T } {
  const scope = new AsyncLocalStorage<RequestDb>();
  const current = (): RequestDb => {
    const db = scope.getStore();
    if (!db) throw new Error('The database was used outside a request.');
    return db;
  };
  const db: Db = {
    async tx<T>(mode: 'read' | 'write', work: (q: Query) => Promise<T>): Promise<T> {
      return current().tx(mode, work);
    },
    async savepoint<T>(q: Query, work: (q: Query) => Promise<T>): Promise<T> {
      return current().savepoint(q, work);
    },
    async statement<R = Record<string, unknown>>(mode: 'read' | 'write', text: string, values?: unknown[]): Promise<R[]> {
      return current().statement<R>(mode, text, values);
    },
    async warm(mode: 'read' | 'write'): Promise<void> {
      await current().warm?.(mode);
    },
  };
  return { db, run: (requestDb, work) => scope.run(requestDb, work) };
}

/**
 * The answer, with close() run when its body has ended: right away when there is no body, else when the last byte of a
 * streamed body has gone (or the caller left). A body that streams after the handler returns keeps its database until then.
 */
export function closeAfter(response: Response, close: () => Promise<void>, after?: After): Response {
  if (!response.body) {
    after?.(close());
    return response;
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const done = response.body
    .pipeTo(writable)
    .catch(() => undefined)
    .then(close);
  after?.(done);
  return new Response(readable, { status: response.status, statusText: response.statusText, headers: response.headers });
}
