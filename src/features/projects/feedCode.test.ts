import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { FEED_VERBS } from '../../api/views';
import { initI18n } from '../../i18n';
import { STAMP } from '../../test/factories';
import { FEED_EVENT_VERBS, feedText } from './feed';

const author = { id: 'usr_001', name: 'Hala Nasser', avatarUrl: null, kind: 'human' as const, discipline: 'Architect', gender: 'female' as const };
const changed: FeedItem = {
  kind: 'event', id: 'evt_001', at: STAMP, author, verb: 'project.code_changed', targetType: 'project', targetId: 'prj_001', label: 'Tower',
  detail: { code: '260902AZT-RES-Villa' }, canUndo: false,
};

describe('the feed line of a code correction (item 6b)', () => {
  it('shows in the project feed, with the new code', () => {
    expect(FEED_VERBS.has('project.code_changed')).toBe(true);
    expect(FEED_EVENT_VERBS.has('project.code_changed')).toBe(true);
    initI18n('en');
    expect(feedText(changed, i18n.t.bind(i18n))).toBe('changed the project code to 260902AZT-RES-Villa');
  });

  it('uses the feminine verb in Arabic after a woman\'s name', () => {
    initI18n('ar');
    expect(feedText(changed, i18n.t.bind(i18n))).toBe('غيّرت رمز المشروع إلى 260902AZT-RES-Villa');
    initI18n('en');
  });
});

describe('the feed line of a template update (INT-13)', () => {
  const synced: FeedItem = { ...changed, id: 'evt_002', verb: 'project.template_synced', detail: { template: 'Villa, full design' } };

  it('shows in the project feed, with the name of the template', () => {
    expect(FEED_VERBS.has('project.template_synced')).toBe(true);
    expect(FEED_EVENT_VERBS.has('project.template_synced')).toBe(true);
    initI18n('en');
    expect(feedText(synced, i18n.t.bind(i18n))).toBe('updated this project from the template Villa, full design');
    expect(feedText({ ...synced, detail: {} }, i18n.t.bind(i18n))).toBe('updated this project from its template');
  });

  it('uses the feminine verb in Arabic after a woman\'s name', () => {
    initI18n('ar');
    expect(feedText(synced, i18n.t.bind(i18n))).toBe('حدّثت المشروع من القالب Villa, full design');
    initI18n('en');
  });
});
