import { ApiError, type ApiErrorCode } from '../../src/api/errors';
import type { RunError } from '../core/types';

/**
 * The HTTP form of a refusal (plan 4.10; client map 2.3). A whole-request refusal answers { v: 1, error } with a status;
 * an entry refusal stays inside the 200 answer. A thrown error that is not an ApiError never shows its message.
 */

const STATUS: Record<ApiErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  failed: 500,
};

const HIDDEN: RunError = { code: 'failed', message: 'Something went wrong. Try again.' };

/** The RunError of anything thrown. Only an ApiError keeps its message and details. */
export function runErrorOf(error: unknown): RunError {
  if (!(error instanceof ApiError)) return HIDDEN;
  return Object.keys(error.details).length > 0 ? { code: error.code, message: error.message, details: error.details } : { code: error.code, message: error.message };
}

/** The status of a whole-request refusal: 403 for an account that is off, 429 with a retry time, else the status of the code. */
export function statusOf(error: RunError): number {
  const reason = error.details?.reason;
  if (error.code === 'unauthenticated' && reason === 'account_off') return 403;
  if (typeof error.details?.retryAfterMs === 'number') return 429;
  if (reason === 'client_outdated') return 409;
  if (reason === 'too_many_calls' || reason === 'too_many_overviews' || reason === 'too_large') return 413;
  return STATUS[error.code];
}

export function errorResponse(error: RunError, headers: Record<string, string> = {}): Response {
  const status = statusOf(error);
  const extra: Record<string, string> = { ...headers };
  if (status === 401) extra['WWW-Authenticate'] = 'Bearer';
  if (status === 429) extra['Retry-After'] = String(Math.max(1, Math.ceil(Number(error.details?.retryAfterMs) / 1000)));
  return Response.json({ v: 1, error }, { status, headers: extra });
}

/** A refusal of the request before any call runs. */
export function refuse(code: ApiErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(code, message, details);
}
