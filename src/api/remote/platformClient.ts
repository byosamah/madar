import { PLATFORM_CALL_NAMES, type PlatformApi } from '../contract/platform';
import { ApiError } from '../errors';
import type * as Errors from './errors';
import { regionUrl } from './region';
import type { RunError } from './wire';

/**
 * The client of the platform calls (Madar enterprises, plan C, Task 19): one call for each request to POST <api>/platform, in the wire form of
 * one entry of the batch. The platform page is the only caller. An answer that is not a wire entry (a refusal of the route, such as
 * not_found for a person who is no platform owner) becomes an ApiError too, so errorMessage and fieldError work as for every other call.
 */

/**
 * The error makers of the remote API (src/api/remote/errors.ts). The runtime gives them in, because the batch client of the first load uses the same code:
 * an import here would split that code into a chunk that the first load must start, and the first load has no room for one more file.
 */
export type PlatformErrors = Pick<typeof Errors, 'fromEntry' | 'fromStatus' | 'noAnswer'>;

const TIMEOUT_MS = 20_000;
type Answer = { v?: unknown; error?: unknown; results?: { ok?: boolean; output?: unknown; error?: RunError }[] };

export function createPlatformClient(o: { url: string; build: string; token: () => Promise<string | null>; errors: PlatformErrors; fetch?: typeof fetch }): PlatformApi {
  const { fromEntry, fromStatus, noAnswer } = o.errors;
  const url = regionUrl(`${o.url.replace(/\/+$/, '')}/platform`);
  const doFetch = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  async function send(name: string, input: unknown): Promise<unknown> {
    const token = await o.token().catch(() => null);
    if (!token) throw new ApiError('unauthenticated', 'Sign in to continue.');
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Madar-Build': o.build, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ v: 1, calls: [{ i: 0, name, input }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw noAnswer((error as { name?: string } | null)?.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    let body: Answer = {};
    try {
      body = (await response.json()) as Answer;
    } catch {
      body = {};
    }
    const refusal = body.error as RunError | undefined;
    if (!response.ok) throw refusal && typeof refusal === 'object' && typeof refusal.code === 'string' ? fromEntry(refusal) : fromStatus(response.status, body, response.headers.get('Retry-After'));
    const entry = body.results?.[0];
    if (!entry) throw new ApiError('failed', 'The call failed. Try again.');
    if (entry.ok !== true) throw fromEntry(entry.error ?? { code: 'failed', message: 'The call failed. Try again.' });
    return entry.output;
  }

  return Object.fromEntries(PLATFORM_CALL_NAMES.map((name) => [name, (input: unknown) => send(name, input)])) as unknown as PlatformApi;
}
