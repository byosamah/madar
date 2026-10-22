import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { calls } from '../../api/calls';
import { FEED_VERBS } from '../../api/views';
import { initI18n } from '../../i18n';
import { NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { FEED_EVENT_VERBS, feedText } from './feed';

const author = { id: 'usr_001', name: 'Hala Nasser', avatarUrl: null, kind: 'human' as const, discipline: 'Architect', gender: 'female' as const };
const changed: FeedItem = {
  kind: 'event', id: 'evt_001', at: STAMP, author, verb: 'project.access_changed', targetType: 'project', targetId: 'prj_001', label: 'Tower',
  detail: {}, canUndo: false,
};

describe('the feed line of a change of who sees a project (fbk_044)', () => {
  it('is a verb of the project feed and has a sentence in English and Arabic, with the feminine verb after a woman', () => {
    expect(FEED_VERBS.has('project.access_changed')).toBe(true);
    expect(FEED_EVENT_VERBS.has('project.access_changed')).toBe(true);
    initI18n('en');
    expect(feedText(changed, i18n.t.bind(i18n))).toBe('changed who sees this project');
    initI18n('ar');
    expect(feedText(changed, i18n.t.bind(i18n))).toBe('غيّرت من يرى هذا المشروع');
    expect(feedText({ ...changed, author: { ...author, gender: 'male' } }, i18n.t.bind(i18n))).toBe('غيّر من يرى هذا المشروع');
    initI18n('en');
  });

  it('shows in the activity of the project after projects.setAccess', async () => {
    setNow(NOW);
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] });
    const feed = await t.api.call('updates.list', { projectId: 'prj_001', filter: 'all' });
    expect(feed.some((item) => item.kind === 'event' && item.verb === 'project.access_changed')).toBe(true);
  });
});
