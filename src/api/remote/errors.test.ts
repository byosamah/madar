import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { fromEntry, fromStatus, noAnswer, retryAfterMs } from './errors';

describe('errors from the server (client map 2.3)', () => {
  it('rebuilds an entry error with the same code, message and details', () => {
    const error = fromEntry({ code: 'invalid_input', message: 'Some fields are not valid.', details: { fields: ['name'], issues: [], reason: 'x', names: 'A', id: 'tsk_1' } });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_input', message: 'Some fields are not valid.', details: { fields: ['name'], issues: [], reason: 'x', names: 'A', id: 'tsk_1' } });
  });

  it('turns an entry error with a code it does not know into failed', () => {
    expect(fromEntry({ code: 'teapot' as never, message: 'x' })).toMatchObject({ code: 'failed' });
    expect(fromEntry({ code: 'forbidden', message: 'No.' }).details).toEqual({});
  });

  it('maps 401 to unauthenticated, with no retry', () => {
    expect(fromStatus(401, null, null)).toMatchObject({ code: 'unauthenticated' });
  });

  it('maps 403 to unauthenticated with the reason account_off', () => {
    expect(fromStatus(403, null, null)).toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
    expect(fromStatus(403, { v: 1, error: { code: 'unauthenticated', message: 'Off.', details: { reason: 'account_off' } } }, null))
      .toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
  });

  it('maps 409 to failed with the reason client_outdated', () => {
    expect(fromStatus(409, null, null)).toMatchObject({ code: 'failed', details: { reason: 'client_outdated' } });
  });

  it('maps 413 to failed and keeps the reason the server gives', () => {
    expect(fromStatus(413, { error: { code: 'failed', message: 'Too many.', details: { reason: 'too_many_overviews' } } }, null))
      .toMatchObject({ code: 'failed', details: { reason: 'too_many_overviews' } });
    expect(fromStatus(413, 'not json', null)).toMatchObject({ code: 'failed' });
  });

  it('maps 429 to failed with the wait in milliseconds', () => {
    expect(fromStatus(429, null, '3')).toMatchObject({ code: 'failed', details: { retryAfterMs: 3000 } });
    expect(fromStatus(429, null, null).details.retryAfterMs).toBeUndefined();
  });

  it('maps 5xx and any other status to failed', () => {
    expect(fromStatus(500, null, null)).toMatchObject({ code: 'failed' });
    expect(fromStatus(502, null, null)).toMatchObject({ code: 'failed' });
    expect(fromStatus(418, null, null)).toMatchObject({ code: 'failed' });
  });

  it('turns no answer into failed with the cause', () => {
    expect(noAnswer('timeout')).toMatchObject({ code: 'failed', details: { cause: 'timeout' } });
    expect(noAnswer('network')).toMatchObject({ code: 'failed', details: { cause: 'network' } });
  });

  it('reads Retry-After as seconds or as a date', () => {
    const now = Date.parse('2026-10-03T09:00:00Z');
    expect(retryAfterMs('2', now)).toBe(2000);
    expect(retryAfterMs('Sat, 03 Oct 2026 09:00:05 GMT', now)).toBe(5000);
    expect(retryAfterMs('Sat, 03 Oct 2026 08:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('soon', now)).toBeUndefined();
    expect(retryAfterMs(null, now)).toBeUndefined();
  });
});
