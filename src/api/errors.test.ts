import { describe, expect, it } from 'vitest';
import { ApiError, forbidden, invalid, notFound } from './errors';

describe('ApiError', () => {
  it('carries a code, a message and details', () => {
    const error = invalid('email', 'This email is already in use.');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('invalid_input');
    expect(error.details).toEqual({ fields: ['email'] });
    expect(error.message).toBe('This email is already in use.');
  });

  it('has helpers for missing items and refusals', () => {
    expect(notFound('Task', 'tsk_009')).toMatchObject({ code: 'not_found', details: { id: 'tsk_009' } });
    expect(forbidden('This week is locked.', { reason: 'week_locked' })).toMatchObject({ code: 'forbidden', details: { reason: 'week_locked' } });
  });
});
