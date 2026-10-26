import { DaftraError } from './client';

/**
 * The read-only lock of the Daftra link (owner, 2026-10-26: "do the limit from our side in Madar").
 *
 * Madar only reads Daftra. A Daftra key role ("Only Allow") picks the record types that a key reaches, but Daftra has no read-only key: a
 * key that reaches invoices may also change them. So Madar holds the limit itself, here, at the one door where a request leaves for Daftra
 * (`client.ts` wraps its fetch with this guard). A request that is not a GET, or that carries a body, is refused before it leaves, whatever
 * the code above asks.
 *
 * To let Madar write to Daftra one day, the owner decides it first. Then this file and its test change, in one reviewed commit.
 */
export const DAFTRA_READ_ONLY = true;

/** The fetch that reaches Daftra: GET with no body, or a refusal with the code `read_only` (not retryable). */
export function readOnlyFetch(run: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const fromRequest = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
    const method = (init?.method ?? fromRequest?.method ?? 'GET').toUpperCase();
    const hasBody = (init?.body !== undefined && init.body !== null) || (fromRequest?.body !== undefined && fromRequest.body !== null);
    if (DAFTRA_READ_ONLY && (method !== 'GET' || hasBody)) throw new DaftraError('read_only');
    return run(input, init);
  };
}
