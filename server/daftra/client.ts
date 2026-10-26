import type { Deps } from '../core/ports';
import { BadAnswer, clientAnswerOf, clientsAnswerOf, invoiceAnswerOf, invoicesAnswerOf, type DaftraClientRow, type DaftraInvoice } from './parse';

/**
 * The Daftra client (the Daftra link, owner 2026-10-26). Madar only reads Daftra: this file sends GET and nothing else. There is one
 * private function that calls fetch (`get`), it sets the method itself, and `client.test.ts` fails if the file holds any other method or
 * a request body. The four methods below are the whole reach of Madar into Daftra.
 *
 * Address `https://<DAFTRA_<NAME>_SITE>/api2/<entity>.json`, header `apikey`, for one account at a time (one account for each sub-company). Each call has a 10 second limit, the one documented exception to
 * the 3 second rule of `server/CLAUDE.md` (Daftra answers in 1 to 3.4 s; proof.md). A call never runs inside a screen request, except the
 * live search of `daftra.findClients` and the two reads of `payments.linkInvoice` and `daftra.matchClient` (all outside any lock).
 *
 * An error is a DaftraError whose message is its code and nothing more. The text of a network error, an address, the key or the site
 * never reaches an error, a log line or an answer. The caller decides from `code`, `status` and `retryable`.
 */

export const DAFTRA_TIMEOUT_MS = 10_000;

export type DaftraErrorCode = 'bad_key' | 'refused' | 'not_found' | 'rate_limited' | 'server' | 'timeout' | 'unreachable' | 'bad_answer';
const RETRY: ReadonlySet<DaftraErrorCode> = new Set(['rate_limited', 'server', 'timeout', 'unreachable']);

export class DaftraError extends Error {
  readonly code: DaftraErrorCode;
  /** The HTTP status of the Daftra answer. A timeout, a network error or an answer of the wrong shape has none (0). */
  readonly status: number;
  /** True when the same call may work later: 429, 5xx, a timeout, a network error. 401 and 403 are not retryable: they keep their state. */
  readonly retryable: boolean;

  constructor(code: DaftraErrorCode, status = 0) {
    super(code);
    this.name = 'DaftraError';
    this.code = code;
    this.status = status;
    this.retryable = RETRY.has(code);
  }
}

/** The code of an HTTP status that is not a success. 401 is a bad key. 403 is a key role that refuses the entity. */
function codeOf(status: number): DaftraErrorCode {
  if (status === 401) return 'bad_key';
  if (status === 403) return 'refused';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'refused';
}

export type DaftraClient = {
  /** The clients whose name matches the words, at most 10. */
  findClients(keywords: string): Promise<DaftraClientRow[]>;
  /** One client by its Daftra id. A client that is not there gives `not_found`. */
  client(id: string): Promise<DaftraClientRow>;
  /** The invoices of one client made on or after `createdFrom` (`YYYY-MM-DD`), newest dates first as Daftra sorts them, at most 50. */
  invoicesOf(daftraClientId: string, createdFrom: string): Promise<DaftraInvoice[]>;
  /** One invoice with its payment rows. */
  invoice(id: string): Promise<DaftraInvoice>;
};

export type DaftraSettings = { site: string; apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number };

const ID = /^[0-9]{1,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A client over one Daftra account. Only GET: the method is set here, in one place, and no call carries a body. */
export function daftraClientOf(settings: DaftraSettings): DaftraClient {
  const timeoutMs = settings.timeoutMs ?? DAFTRA_TIMEOUT_MS;

  async function get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const run = settings.fetch ?? globalThis.fetch;
    const url = `https://${settings.site}/api2/${path}${Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : ''}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DaftraError('timeout'));
      }, timeoutMs);
    });
    const work = (async (): Promise<unknown> => {
      // A redirect is a refusal: the key never goes to another host.
      const response = await run(url, { method: 'GET', headers: { apikey: settings.apiKey, Accept: 'application/json' }, redirect: 'manual', signal: controller.signal });
      if (response.status < 200 || response.status >= 300) throw new DaftraError(codeOf(response.status), response.status);
      const raw = await response.text();
      let answer: unknown;
      try {
        answer = JSON.parse(raw);
      } catch {
        throw new DaftraError('bad_answer', response.status);
      }
      // Daftra can answer HTTP 200 with a failed result and its own code.
      const inner = typeof answer === 'object' && answer !== null ? (answer as { code?: unknown; result?: unknown }) : {};
      if (typeof inner.code === 'number' && inner.code >= 400 && inner.result !== 'successful') throw new DaftraError(codeOf(inner.code), inner.code);
      return answer;
    })();
    try {
      return await Promise.race([work, limit]);
    } catch (error) {
      if (error instanceof DaftraError) throw error;
      throw new DaftraError('unreachable');
    } finally {
      clearTimeout(timer);
      // The loser of the race must not end as an unhandled rejection.
      work.catch(() => undefined);
    }
  }

  /** The answer parsed by `read`. A shape that does not fit gives `bad_answer`, with no part of the answer in it. */
  async function read<T>(path: string, query: Record<string, string>, parse: (answer: unknown) => T): Promise<T> {
    const answer = await get(path, query);
    try {
      return parse(answer);
    } catch (error) {
      if (error instanceof BadAnswer) throw new DaftraError('bad_answer');
      throw error;
    }
  }

  const idOf = (id: string): string => {
    if (!ID.test(id)) throw new DaftraError('not_found');
    return id;
  };

  return {
    findClients: async (keywords) => read('clients.json', { keywords: keywords.slice(0, 100), limit: '10' }, clientsAnswerOf),
    client: async (id) => read(`clients/${idOf(id)}.json`, {}, clientAnswerOf),
    invoicesOf: async (daftraClientId, createdFrom) => {
      if (!DAY.test(createdFrom)) throw new DaftraError('bad_answer');
      return await read('invoices.json', { client_id: idOf(daftraClientId), created_from: createdFrom, limit: '50' }, invoicesAnswerOf);
    },
    invoice: async (id) => read(`invoices/${idOf(id)}.json`, {}, invoiceAnswerOf),
  };
}

/**
 * The client of one Daftra account (one account for each sub-company), or undefined when the copy has no values for that account.
 * `deps.daftraFetch` is the fetch of a test. A client never reads another account than the one it was made for.
 */
export function daftraOf(deps: Pick<Deps, 'config' | 'daftraFetch'>, account: string): DaftraClient | undefined {
  const daftra = deps.config.daftra?.[account];
  if (!daftra) return undefined;
  return daftraClientOf({ site: daftra.site, apiKey: daftra.key, ...(deps.daftraFetch ? { fetch: deps.daftraFetch } : {}) });
}

/** The account names that the copy holds keys for. The names are not secret. */
export function daftraAccountsOf(deps: Pick<Deps, 'config'>): string[] {
  return Object.keys(deps.config.daftra ?? {}).sort();
}
