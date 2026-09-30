export type ApiErrorCode = 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'failed';

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

export function invalid(field: string, message: string): ApiError {
  return new ApiError('invalid_input', message, { fields: [field] });
}

export function notFound(what: string, id: string): ApiError {
  return new ApiError('not_found', `${what} ${id} does not exist.`, { id });
}

export function forbidden(message = 'You cannot do this.', details: Record<string, unknown> = {}): ApiError {
  return new ApiError('forbidden', message, details);
}
