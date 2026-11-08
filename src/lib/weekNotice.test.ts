import { describe, expect, it } from 'vitest';
import { noticeSentence, type NoticeView, type Words } from './noticeSentence';
import { ar, en } from '../i18n/trees';

/** The sentence of the reminder of the weekly question (fbk_088): the plan on Sunday, the answer on Thursday. It names no project and no person. */
const lookup = (tree: unknown, key: string): string => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree) as string;
const wordsOf = (tree: unknown): Words => (key, params) => lookup(tree, key).replace(/{{(\w+)}}/g, (_all, name: string) => String(params[name] ?? ''));

const view = (targetId: string): NoticeView => ({
  notification: {
    id: 'ntf_001', userId: 'usr_003', trigger: 'week_question', actorId: null, targetType: 'week', targetId, read: false,
    createdAt: '2026-11-08T08:00:00.000+03:00', dedupeKey: `week_question:${targetId}:usr_003`,
  },
  actor: null, target: '', projectCode: null, project: null, link: '/', needsAction: false, canApprove: false, gone: false, dueDate: null, chatKind: null,
  startsAt: null, forPeople: [],
});

describe('the sentence of the weekly question notice', () => {
  it('asks for the plan on Sunday, in English and in Arabic', () => {
    expect(noticeSentence(view('plan:2026-11-08'), wordsOf(en), 'en')).toBe('What do you plan this week? Say it on Home.');
    expect(noticeSentence(view('plan:2026-11-08'), wordsOf(ar), 'ar')).toBe('ماذا تخطط هذا الأسبوع؟ أجب من الرئيسية.');
  });

  it('asks what the person did on Thursday, in English and in Arabic', () => {
    expect(noticeSentence(view('review:2026-11-08'), wordsOf(en), 'en')).toBe('What did you do this week? Say it on Home.');
    expect(noticeSentence(view('review:2026-11-08'), wordsOf(ar), 'ar')).toBe('ماذا أنجزت هذا الأسبوع؟ أجب من الرئيسية.');
  });
});
