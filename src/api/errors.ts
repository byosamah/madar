/** "unauthenticated" is for the real build: no valid sign-in, or a person whose account is off (client map 2.3). */
export const API_ERROR_CODES = ['invalid_input', 'forbidden', 'not_found', 'conflict', 'failed', 'unauthenticated'] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/** A refused field. A reason names a rule a person must understand; the screens have a text for each reason. */
export function invalid(field: string, message: string, reason?: string): ApiError {
  return new ApiError('invalid_input', message, reason ? { fields: [field], reason } : { fields: [field] });
}

export function notFound(what: string, id: string): ApiError {
  return new ApiError('not_found', `${what} ${id} does not exist.`, { id });
}

export function forbidden(message = 'You cannot do this.', details: Record<string, unknown> = {}): ApiError {
  return new ApiError('forbidden', message, details);
}
