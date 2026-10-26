import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noticeSentence, type NoticeView, type Words } from './noticeSentence';
import { setNow } from './dates';
import { ar, en } from '../i18n/trees';
import { NOW } from '../test/factories';

/**
 * The sentence of the due notice of a payment (the Daftra link, owner 2026-10-26): "is due today" on its day, "was due <day>" after
 * it, and one line that names nothing for a viewer who may not see payments. NOW is 2026-09-30.
 */
const lookup = (tree: unknown, key: string): string => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree) as string;
const wordsOf = (tree: unknown): Words => (key, params) => lookup(tree, key).replace(/{{(\w+)}}/g, (_all, name: string) => String(params[name] ?? ''));

const view = (extra: Partial<NoticeView> = {}, notification: Partial<NoticeView['notification']> = {}): NoticeView => ({
  notification: {
    id: 'ntf_001', userId: 'usr_006', trigger: 'payment_due', actorId: null, targetType: 'project', targetId: 'prj_001', read: false,
    createdAt: '2026-09-30T09:00:00.000+03:00', dedupeKey: 'payment_due:pay_001:2026-09-30:usr_006', dueDate: '2026-09-30',
    payment: { id: 'pay_001', name: 'Payment 2' }, ...notification,
  },
  actor: null, target: 'Al Noor Villa', projectCode: 'KH-26-014', project: { id: 'prj_001', name: 'Al Noor Villa', mark: 1 }, link: '/projects/prj_001?payment=pay_001',
  needsAction: true, canApprove: false, gone: false, dueDate: '2026-09-30', chatKind: null, startsAt: null, forPeople: [], ...extra,
});
const plain = (text: string) => text.replace(/[⁨⁩]/g, '');

beforeEach(() => setNow(NOW));
afterEach(() => setNow(null));

describe('the sentence of a payment due notice', () => {
  it('says that the payment is due today, in English and in Arabic', () => {
    expect(plain(noticeSentence(view(), wordsOf(en), 'en'))).toBe('Al Noor Villa: Payment 2 is due today.');
    expect(plain(noticeSentence(view(), wordsOf(ar), 'ar'))).toBe('Al Noor Villa: حان موعد Payment 2 اليوم.');
  });

  it('keeps the project name and the payment name between isolate marks, so a name in another direction keeps its own end', () => {
    expect(noticeSentence(view(), wordsOf(en), 'en')).toBe('⁨Al Noor Villa⁩: ⁨Payment 2⁩ is due today.');
  });

  it('says "was due <day>" when a person reads it after the day', () => {
    const late = view({ dueDate: '2026-09-28' }, { dueDate: '2026-09-28' });
    expect(plain(noticeSentence(late, wordsOf(en), 'en'))).toBe('Al Noor Villa: Payment 2 was due Monday 28 September.');
    expect(plain(noticeSentence(late, wordsOf(ar), 'ar'))).toMatch(/^Al Noor Villa: كان موعد Payment 2 .+\.$/);
  });

  it('names nothing when the server took the payment out (the viewer may not see payments)', () => {
    const hidden = view({ gone: true, target: '', project: null, projectCode: null, dueDate: null, link: '/notifications' }, { payment: undefined, targetId: 'hidden', dueDate: undefined });
    expect(noticeSentence(hidden, wordsOf(en), 'en')).toBe('A payment that you can no longer see');
    expect(noticeSentence(hidden, wordsOf(ar), 'ar')).toBe('دفعة لم تعد تراها');
  });
});
