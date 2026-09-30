import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';
import { ApiError, forbidden } from '../api/errors';
import { initI18n } from '../i18n';

describe('errorMessage', () => {
  it('turns API errors into plain text', () => {
    const i18n = initI18n('en');
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('forbidden', 'x'), t)).toBe('You cannot do this on this project.');
    expect(errorMessage(forbidden('x', { reason: 'week_locked' }), t)).toBe('This week is locked.');
    expect(errorMessage(new ApiError('conflict', 'x'), t)).toBe('This item changed after that edit. Undo is not available.');
    expect(errorMessage(new Error('boom'), t)).toBe('Something went wrong. Try again.');
  });
});
