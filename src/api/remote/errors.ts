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

/**
 * The error of a whole request that the server refused with an HTTP status. 401 comes here only after one token refresh and
 * one resend. The body may carry { error: { details: { reason } } }; the status decides the code.
 */
export function fromStatus(status: number, body: unknown, retryAfter: string | null, now = Date.now()): ApiError {
  const reason = reasonOf(body);
  if (status === 401) return new ApiError('unauthenticated', 'Sign in to continue.', reason ? { reason } : {});
  if (status === 403) return new ApiError('unauthenticated', 'Your account is turned off.', { reason: 'account_off' });
  if (status === 409) return new ApiError('failed', 'Madar has a new version. Reload the page.', { reason: 'client_outdated' });
  if (status === 429) {
    const wait = retryAfterMs(retryAfter, now);
    return new ApiError('failed', 'Too many requests. Try again.', wait === undefined ? {} : { retryAfterMs: wait });
  }
  return new ApiError('failed', 'The call failed. Try again.', reason ? { reason, status } : { status });
}

/** No answer came back: the network failed, or the time limit ended. */
export function noAnswer(cause: 'timeout' | 'network'): ApiError {
  return new ApiError('failed', 'The call failed. Try again.', { cause });
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
