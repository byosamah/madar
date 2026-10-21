import { describe, expect, it } from 'vitest';
import { ar, en } from '../../src/i18n/trees';
import { PUSH_WORDS, pushWords } from './words';

/** The words of the push line (owner, 2026-10-21) are the words of the bell, in both languages. */
describe('the push words', () => {
  it('hold every inbox word of the screens, so each bell sentence has its text on the server', () => {
    expect(PUSH_WORDS.en.inbox).toEqual((en as unknown as { inbox: object }).inbox);
    expect(PUSH_WORDS.ar.inbox).toEqual((ar as unknown as { inbox: object }).inbox);
  });

  it('hold the reply sentences and the push words', () => {
    for (const [tree, words] of [[en, PUSH_WORDS.en], [ar, PUSH_WORDS.ar]] as const) {
      const screen = tree as unknown as { notices: Record<string, string>; push: Record<string, string> };
      for (const key of ['repliedToYou', 'repliedDirect', 'repliedGroupGone']) expect((words.notices as Record<string, string>)[key]).toBe(screen.notices[key]);
      expect(words.push).toEqual(screen.push);
    }
  });

  it('write a sentence with the Arabic female form and Western digits', () => {
    expect(pushWords('en')('push.notificationTitle')).toBe('Madar');
    expect(pushWords('ar')('push.notificationTitle')).toBe('مدار');
    expect(pushWords('ar')('inbox.someone')).toBe((ar as unknown as { inbox: { someone: string } }).inbox.someone);
  });
});
