import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { Event } from '../../../api/contract/entities';
import { initI18n } from '../../../i18n';
import { STAMP } from '../../../test/factories';
import { historyText } from './history';

const created = {
  id: 'evt_001', seq: 1, projectId: 'prj_001', actorId: 'usr_005', actorKind: 'human', actingForId: 'usr_005', verb: 'task.created',
  targetType: 'task', targetId: 'tsk_001', before: null, after: null, correlationId: 'cor_ui_x', createdAt: STAMP, undoneBy: null,
} as unknown as Event;

describe('Arabic task history', () => {
  it('uses the feminine verb after a woman\'s name', () => {
    initI18n('ar');
    expect(historyText(created, i18n.t.bind(i18n), 'ar', 'female')).toBe('أنشأت المهمة');
    expect(historyText(created, i18n.t.bind(i18n), 'ar')).toBe('أنشأ المهمة');
    initI18n('en');
  });

  it('names a new place in the shared order (owner, 2026-10-07)', () => {
    const arranged = { ...created, verb: 'task.arranged', before: { rank: null }, after: { rank: 1000 } } as Event;
    expect(historyText(arranged, i18n.t.bind(i18n), 'en')).toBe('moved it in the order');
    initI18n('ar');
    expect(historyText(arranged, i18n.t.bind(i18n), 'ar', 'female')).toBe('غيّرت ترتيبها');
    expect(historyText(arranged, i18n.t.bind(i18n), 'ar')).toBe('غيّر ترتيبها');
    initI18n('en');
  });
});
