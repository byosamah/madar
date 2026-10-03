import { notBuiltAsync } from '../core/notBuilt';
import type { Deps } from '../core/ports';

/**
 * POST /api/auth/forgot { email }: the same answer for every address, rate limits, and a reset mail in the person's language (plan 5.1).
 * Track P replaces this stub.
 */
export function forgotRoute(_request: Request, _deps: Deps): Promise<Response> {
  return notBuiltAsync('The forgot password route');
}
