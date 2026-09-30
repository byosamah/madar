import { describe, expect, it } from 'vitest';
import { activeMention, linkedProjectCodes, mentionMarkup, mentionedUserIds, normalizeForSearch, plainText, segmentsOf, withMentionMarkup } from './text';

describe('text helpers', () => {
  it('reads mentions once each', () => {
    const body = 'Hi @[Sara Al-Qahtani](usr_005) and @[Omar](usr_004), and again @[Sara Al-Qahtani](usr_005).';
    expect(mentionedUserIds(body)).toEqual(['usr_005', 'usr_004']);
  });

  it('writes mention markup', () => {
    expect(mentionMarkup('Sara', 'usr_005')).toBe('@[Sara](usr_005)');
  });

  it('reads project links', () => {
    expect(linkedProjectCodes('See #KH-26-014 and #KH-26-015.')).toEqual(['KH-26-014', 'KH-26-015']);
  });

  it('ignores case, spaces, diacritics and letter forms in search', () => {
    expect(normalizeForSearch('  CORNICHE   Tower ')).toBe('corniche tower');
    expect(normalizeForSearch('أَحْمَد')).toBe(normalizeForSearch('احمد'));
    expect(normalizeForSearch('إبراهيم')).toBe(normalizeForSearch('ابراهيم'));
    expect(normalizeForSearch('مدرسة')).toBe(normalizeForSearch('مدرسه'));
    expect(normalizeForSearch('مستشفى')).toBe(normalizeForSearch('مستشفي'));
  });
});

describe('mentions in posts', () => {
  const body = 'Hi @[Sara Al-Qahtani](usr_005), see the plan.';

  it('splits a post into text and mentions', () => {
    expect(segmentsOf(body)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', name: 'Sara Al-Qahtani', userId: 'usr_005' },
      { kind: 'text', text: ', see the plan.' },
    ]);
    expect(plainText(body)).toBe('Hi @Sara Al-Qahtani, see the plan.');
  });

  it('turns picked names into markup, longest name first', () => {
    const people = [{ id: 'usr_010', name: 'Sara' }, { id: 'usr_005', name: 'Sara Al-Qahtani' }];
    expect(withMentionMarkup('@Sara Al-Qahtani and @Sara', people)).toBe('@[Sara Al-Qahtani](usr_005) and @[Sara](usr_010)');
    expect(withMentionMarkup('email@Sara', [])).toBe('email@Sara');
  });

  it('finds the mention at the caret', () => {
    expect(activeMention('Hi @Sa', 6)).toEqual({ start: 3, query: 'Sa' });
    expect(activeMention('Hi @', 4)).toEqual({ start: 3, query: '' });
    expect(activeMention('@Sara Al', 8)).toEqual({ start: 0, query: 'Sara Al' });
    expect(activeMention('mail@x', 6)).toBeNull();
    expect(activeMention('Hi @Sa\nnext', 11)).toBeNull();
    expect(activeMention('Hi there', 8)).toBeNull();
  });
});
