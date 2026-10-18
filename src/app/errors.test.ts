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

  it('has a text in both languages for every refusal of office tasks (owner, 2026-10-06)', () => {
    const reasons = ['not_a_person', 'office_no_stage', 'office_no_prerequisites', 'review_by_maker', 'file_office_task', 'office_needs_task'];
    for (const language of ['en', 'ar'] as const) {
      const i18n = initI18n(language);
      const t = i18n.t.bind(i18n);
      for (const reason of reasons) {
        expect({ language, reason, exists: i18n.exists(`errors.reasons.${reason}`) }).toEqual({ language, reason, exists: true });
        expect(errorMessage(invalid('x', 'x', reason), t)).toBe(t(`errors.reasons.${reason}`));
      }
    }
  });
});


describe('errorMessage for group chats (fbk_011)', () => {
  it('has a text in both languages for every refusal of a group chat', () => {
    const refusals = [
      invalid('remove', 'x', 'group_too_small'),
      invalid('add', 'x', 'group_full'),
      forbidden('x', { reason: 'not_maker' }),
    ];
    for (const language of ['en', 'ar'] as const) {
      const i18n = initI18n(language);
      const t = i18n.t.bind(i18n);
      for (const refusal of refusals) {
        const reason = String(refusal.details.reason);
        expect({ language, reason, exists: i18n.exists(`errors.reasons.${reason}`) }).toEqual({ language, reason, exists: true });
        expect(errorMessage(refusal, t)).toBe(t(`errors.reasons.${reason}`));
      }
    }
    const en = initI18n('en');
    expect(errorMessage(invalid('remove', 'x', 'group_too_small'), en.t.bind(en))).toBe('A group keeps at least two people. Archive the chat instead.');
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
