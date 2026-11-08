import { API_ERROR_CODES, ApiError, type ApiErrorCode } from '../errors';
import type { RunError } from './wire';

/**
 * The errors of the remote API (client map 2.3). Every error becomes an ApiError, so errorMessage, canRetry, fieldError and the
 * instanceof checks of the screens work as with the fake API. The details keys (fields, issues, reason, names, id) pass through.
 */

/** The error of one entry: the same code, message and details. A code the client does not know becomes failed. */
export function fromEntry(error: RunError): ApiError {
  const code: ApiErrorCode = (API_ERROR_CODES as readonly string[]).includes(error.code) ? error.code : 'failed';
  return new ApiError(code, error.message || 'The call failed. Try again.', isRecord(error.details) ? error.details : {});
}

/** The path of a request: the own /api of the page (a WebKit browser) or the address of the function. The diagnostic event reads it (chat, 2026-11-08). */
export type Via = 'page' | 'direct';

/**
 * The error of a whole request that the server refused with an HTTP status. 401 comes here only after one token refresh and
 * one resend. The body may carry { error: { details: { reason } } }; the status decides the code.
 * A failed call carries the status and the path in its details (chat, 2026-11-08), so the usage record can tell a 502 of the page
 * forwarder from a limit. No text of a message goes there.
 */
export function fromStatus(status: number, body: unknown, retryAfter: string | null, now = Date.now(), via?: Via): ApiError {
  const reason = reasonOf(body);
  const where = via ? { status, via } : { status };
  if (status === 401) return new ApiError('unauthenticated', 'Sign in to continue.', reason ? { reason } : {});
  if (status === 403) return new ApiError('unauthenticated', 'Your account is turned off.', { reason: 'account_off' });
  if (status === 409) return new ApiError('failed', 'Madar has a new version. Reload the page.', { reason: 'client_outdated', ...where });
  if (status === 429) {
    const wait = retryAfterMs(retryAfter, now);
    return new ApiError('failed', 'Too many requests. Try again.', wait === undefined ? where : { retryAfterMs: wait, ...where });
  }
  return new ApiError('failed', 'The call failed. Try again.', reason ? { reason, ...where } : where);
}

/** No answer came back: the network failed, or the time limit ended. */
export function noAnswer(cause: 'timeout' | 'network', via?: Via): ApiError {
  return new ApiError('failed', 'The call failed. Try again.', via ? { cause, via } : { cause });
}

/** Retry-After in milliseconds: a number of seconds, or an HTTP date. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const text = header.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function reasonOf(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error) || !isRecord(body.error.details)) return undefined;
  const reason = body.error.details.reason;
  return typeof reason === 'string' ? reason : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
