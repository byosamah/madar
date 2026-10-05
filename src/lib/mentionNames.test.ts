import { describe, expect, it } from 'vitest';
import { editedBody, withMentionMarkup } from './text';

/** Mentions with the English and the Arabic name of a person (owner item 12, 2026-10-05). */
describe('mentions with two names', () => {
  const people = [
    { id: 'usr_005', name: 'Sara Al-Qahtani', nameAr: 'سارة القحطاني' },
    { id: 'usr_004', name: 'Omar Haddad' },
    { id: 'usr_006', name: 'Sara', nameAr: 'سارة' },
  ];

  it('turns "@" and the Arabic name into mention markup, as it does for the English name', () => {
    expect(withMentionMarkup('شكرا @سارة القحطاني', people)).toBe('شكرا @[سارة القحطاني](usr_005)');
    expect(withMentionMarkup('Thanks @Sara Al-Qahtani', people)).toBe('Thanks @[Sara Al-Qahtani](usr_005)');
  });

  it('takes the longer name first in both languages, so "@سارة القحطاني" wins over "@سارة"', () => {
    expect(withMentionMarkup('@سارة القحطاني و @سارة', people)).toBe('@[سارة القحطاني](usr_005) و @[سارة](usr_006)');
  });

  it('keeps the Arabic mention of an edited post', () => {
    const before = 'شكرا @[سارة القحطاني](usr_005)';
    expect(editedBody('شكرا جزيلا @سارة القحطاني', people, before)).toBe('شكرا جزيلا @[سارة القحطاني](usr_005)');
  });
});
