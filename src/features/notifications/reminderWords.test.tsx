import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { initI18n } from '../../i18n';
import { renderApp } from '../../test/render';

describe('The due reminder names the day (audit 2026-10-03, API-11)', () => {
  it('says the weekday and the date, not "tomorrow", in the Inbox', async () => {
    await renderApp('/notifications', (state) => {
      state.session.currentUserId = 'usr_005';
      state.tasks.tsk_010.dueDate = '2026-10-04';
      state.notifications.ntf_901 = {
        id: 'ntf_901', userId: 'usr_005', trigger: 'due_tomorrow', actorId: null, targetType: 'task', targetId: 'tsk_010', read: false,
        createdAt: '2026-09-30T08:00:00.000+03:00', dedupeKey: null, dueDate: '2026-10-04',
      };
    });
    expect(await screen.findByText('“Toilet details” is due on Sunday 4 October')).toBeInTheDocument();
    expect(screen.queryByText(/tomorrow/)).toBeNull();
  });

  it('has the same sentence in Arabic, with the weekday', () => {
    // The test starts i18n itself, so it passes alone or in any order (audit 2026-10-03, V-29).
    const i18n = initI18n('en');
    expect(i18n.t('inbox.trigger.due_tomorrow', { lng: 'ar', target: 'تفاصيل الحمامات', day: 'الأحد، 4 أكتوبر' })).toBe('«تفاصيل الحمامات» مستحقة يوم الأحد، 4 أكتوبر');
    expect(i18n.t('settings.triggers.due_tomorrow', { lng: 'en' })).not.toMatch(/tomorrow/);
    expect(i18n.t('settings.triggers.due_tomorrow', { lng: 'ar' })).not.toMatch(/غد/);
  });
});
