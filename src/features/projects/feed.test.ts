import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { initI18n } from '../../i18n';
import { STAMP } from '../../test/factories';
import { feedText } from './feed';

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
    expect(feedText(item(author), ar)).toBe('أنشأ المشروع');
    initI18n('en');
    expect(feedText(item(sara), t)).toBe('created the project');
  });
});
