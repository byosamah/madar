import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { initI18n } from '../../i18n';
import { STAMP } from '../../test/factories';
import { feedText } from './feed';

const author = { id: 'usr_002', name: 'Faisal Al-Harbi', avatarUrl: null, kind: 'human' as const, discipline: 'Architect' };
const event = (verb: string, label: string, detail: Record<string, string> = {}): FeedItem => ({
  kind: 'event', id: 'evt_001', at: STAMP, author, verb, targetType: 'project', targetId: 'prj_001', label, detail, canUndo: false,
});

/** The names that the server writes into a feed event, in the screen language (owner item 12, 2026-10-05). */
describe('feed sentences with two names', () => {
  it('names the new leader in the screen language', () => {
    initI18n('en');
    const leader = event('project.leader_changed', 'Tower', { leader: 'Sara Al-Qahtani', leaderAr: 'سارة القحطاني' });
    expect(feedText(leader, i18n.t.bind(i18n), 'en')).toBe('made Sara Al-Qahtani the leader');
    initI18n('ar');
    expect(feedText(leader, i18n.t.bind(i18n), 'ar')).toContain('سارة القحطاني');
    expect(feedText(leader, i18n.t.bind(i18n))).toContain('سارة القحطاني');
    initI18n('en');
  });

  it('names the new team member in the screen language, and keeps the English name when there is no Arabic one', () => {
    initI18n('ar');
    const ar = i18n.t.bind(i18n);
    expect(feedText(event('member.added', 'Sara Al-Qahtani', { labelAr: 'سارة القحطاني' }), ar, 'ar')).toContain('سارة القحطاني');
    expect(feedText(event('member.added', 'Omar Haddad'), ar, 'ar')).toContain('Omar Haddad');
    initI18n('en');
    expect(feedText(event('member.added', 'Sara Al-Qahtani', { labelAr: 'سارة القحطاني' }), i18n.t.bind(i18n), 'en')).toContain('Sara Al-Qahtani');
  });
});
