import { describe, expect, it } from 'vitest';
import { canRetry, errorMessage } from './errors';
import { API_ERROR_CODES, ApiError, forbidden, invalid } from '../api/errors';
import { SERVER_REASONS } from '../api/contract/server';
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

  it('names the lead, not the owner, when a reviewer moves a task in review (audit 2026-10-03, V-5)', () => {
    const en = initI18n('en');
    const refusal = invalid('status', 'x', 'review_send_back');
    expect(errorMessage(refusal, en.t.bind(en))).toBe('This task is in review. Use Send back and write a note for the lead.');
    const ar = initI18n('ar');
    expect(errorMessage(refusal, ar.t.bind(ar))).toBe('هذه المهمة قيد المراجعة. استخدم «إعادة للتعديل» واكتب ملاحظة للمسؤول الرئيسي عنها.');
  });

  it('has a text in both languages for every error code and every server reason (plan, T0.3)', () => {
    for (const language of ['en', 'ar'] as const) {
      const i18n = initI18n(language);
      const t = i18n.t.bind(i18n);
      for (const code of API_ERROR_CODES) {
        expect({ language, code, exists: i18n.exists(`errors.${code}`) }).toEqual({ language, code, exists: true });
      }
      for (const reason of SERVER_REASONS) {
        expect({ language, reason, exists: i18n.exists(`errors.reasons.${reason}`) }).toEqual({ language, reason, exists: true });
        expect(errorMessage(new ApiError('failed', 'x', { reason }), t)).toBe(t(`errors.reasons.${reason}`));
      }
    }
    expect(API_ERROR_CODES).toContain('unauthenticated');
  });
});


describe('canRetry', () => {
  it('offers a Retry after a failed call and after an ended session, never after a refusal or a turned-off account', () => {
    expect(canRetry(new ApiError('failed', 'Could not save.'))).toBe(true);
    // A 401 never ran on the server (client map 7.3), so the same call is safe to send again after the person signs in.
    expect(canRetry(new ApiError('unauthenticated', 'Signed out.'))).toBe(true);
    expect(canRetry(new ApiError('unauthenticated', 'Account off.', { reason: 'account_off' }))).toBe(false);
    expect(canRetry(forbidden())).toBe(false);
  });
});
