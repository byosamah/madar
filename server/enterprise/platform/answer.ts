import type { RunError } from '../../core/types';
import { errorResponse } from '../../http/errors';

/** The headers of every answer of the platform sign-in routes: a token answer is never kept. */
export const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The answer of a refusal on the platform routes (plan F). The page reads one rule: a 401 sends the person to the sign-in screen. So an
 * account that is turned off also gets 401 (the company routes give 403 for it). A limit keeps its 429 with Retry-After.
 */
export function platformErrorResponse(error: RunError): Response {
  const response = errorResponse(error, NO_STORE);
  if (response.status === 403 && error.code === 'unauthenticated') {
    return Response.json({ v: 1, error }, { status: 401, headers: { ...NO_STORE, 'WWW-Authenticate': 'Bearer' } });
  }
  return response;
}
