import { ApiError } from '../../src/api/errors';

/**
 * The body of a T0 stub (plan 6.1, rule 5): the signature is final, the work is not built yet. The owner track replaces the body.
 * The error is ApiError('failed'), so a caller treats it like any failed call.
 */
export function notBuilt(what: string): never {
  throw new ApiError('failed', `${what} is not built yet.`, { reason: 'not_built' });
}

export async function notBuiltAsync(what: string): Promise<never> {
  return notBuilt(what);
}

/** The answer of a stub HTTP app that is mounted before its track builds it. */
export function notBuiltResponse(what: string): Response {
  return Response.json({ error: { code: 'failed', message: `${what} is not built yet.`, details: { reason: 'not_built' } } }, { status: 501 });
}
