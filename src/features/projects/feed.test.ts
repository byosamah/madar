import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { initI18n } from '../../i18n';
import { STAMP } from '../../test/factories';
import { FEED_EVENT_VERBS, feedText } from './feed';

initI18n('en');
const t = i18n.t.bind(i18n);
const author = { id: 'usr_002', name: 'Faisal Al-Harbi', avatarUrl: null, kind: 'human' as const, discipline: 'Architect' };
const event = (verb: string, label: string, detail: Record<string, string> = {}): FeedItem => ({
  kind: 'event', id: 'evt_001', at: STAMP, author, verb, targetType: 'task', targetId: 'tsk_001', label, detail, canUndo: false,
});

describe('feed sentences', () => {
  it('writes one sentence per event', () => {
    expect(feedText(event('task.status_changed', 'Stair details', { status: 'in_review' }), t)).toBe('sent “Stair details” to review');
    expect(feedText(event('task.created', 'Stair details'), t)).toBe('added the task “Stair details”');
    expect(feedText(event('file.version_added', 'Plan.pdf', { version: 'B' }), t)).toBe('added version B of “Plan.pdf”');
    expect(feedText(event('project.leader_changed', 'Tower', { leader: '' }), t)).toBe('removed the leader');
    expect(feedText(event('task.deleted', 'Stair details'), t)).toBe('made a change');
  });

  it('writes one sentence for a meeting, and one for a site visit (fbk_022)', () => {
    const meeting = (verb: string, kind: string): FeedItem => ({
      kind: 'event', id: 'evt_002', at: STAMP, author, verb, targetType: 'meeting', targetId: 'mtg_001', label: 'Review the facade', detail: { kind }, canUndo: false,
    });
    expect(feedText(meeting('meeting.created', 'client'), t)).toBe('planned the meeting “Review the facade”');
    expect(feedText(meeting('meeting.updated', 'team'), t)).toBe('changed the meeting “Review the facade”');
    expect(feedText(meeting('meeting.cancelled', 'meeting'), t)).toBe('cancelled the meeting “Review the facade”');
    expect(feedText(meeting('meeting.created', 'site_visit'), t)).toBe('planned the site visit “Review the facade”');
    expect(feedText(meeting('meeting.cancelled', 'site_visit'), t)).toBe('cancelled the site visit “Review the facade”');
    for (const verb of ['meeting.created', 'meeting.updated', 'meeting.cancelled']) expect(FEED_EVENT_VERBS.has(verb), verb).toBe(true);
  });

  it('gives the text of a post with mentions as names', () => {
    const post: FeedItem = {
      kind: 'update', id: 'upd_001', at: STAMP, author, body: 'Hi @[Sara Al-Qahtani](usr_005)', fileIds: [], attachments: [], editedAt: null, commentCount: 0, canEdit: false,
    };
    expect(feedText(post, t)).toBe('Hi @Sara Al-Qahtani');
  });
});

describe('Arabic feed sentences', () => {
  it('uses the feminine verb after a woman\'s name, and the masculine one otherwise', () => {
    initI18n('ar');
    const ar = i18n.t.bind(i18n);
    const sara = { ...author, id: 'usr_005', name: 'Sara Al-Qahtani', gender: 'female' as const };
    const item = (who: typeof author) => ({ ...event('project.created', 'Tower'), author: who });
    expect(feedText(item(sara), ar)).toBe('أنشأت المشروع');
    const meeting = (who: typeof author): FeedItem => ({
      kind: 'event', id: 'evt_002', at: STAMP, author: who, verb: 'meeting.created', targetType: 'meeting', targetId: 'mtg_001', label: 'اجتماع الواجهة', detail: { kind: 'site_visit' }, canUndo: false,
    });
    expect(feedText(meeting(sara), ar)).toBe('خطّطت لزيارة الموقع «اجتماع الواجهة»');
    expect(feedText(meeting(author), ar)).toBe('خطّط لزيارة الموقع «اجتماع الواجهة»');
    expect(feedText(item(author), ar)).toBe('أنشأ المشروع');
    initI18n('en');
    expect(feedText(item(sara), t)).toBe('created the project');
  });
});
