import { describe, expect, it } from 'vitest';
import { byPersonName, localName, matchesPerson, matchRank, personName, rankedMatches } from './personName';

describe('personName (owner item 12, 2026-10-05)', () => {
  const both = { name: 'Faisal Al-Otaibi', nameAr: 'فيصل العتيبي' };

  it('shows the name in the screen language', () => {
    expect(personName(both, 'en')).toBe('Faisal Al-Otaibi');
    expect(personName(both, 'ar')).toBe('فيصل العتيبي');
  });

  it('falls back to the other name when one is missing or empty', () => {
    expect(personName({ name: 'Omar Hassan' }, 'ar')).toBe('Omar Hassan');
    expect(personName({ name: 'Omar Hassan', nameAr: '' }, 'ar')).toBe('Omar Hassan');
    expect(personName({ name: 'Omar Hassan', nameAr: '   ' }, 'ar')).toBe('Omar Hassan');
    expect(personName({ name: '', nameAr: 'عمر حسن' }, 'en')).toBe('عمر حسن');
    expect(personName({ name: 'Omar', nameAr: null }, 'ar')).toBe('Omar');
  });

  it('sorts by the shown name', () => {
    const people = [
      { name: 'Ziad', nameAr: 'أحمد' },
      { name: 'Adel', nameAr: 'يوسف' },
    ];
    expect([...people].sort(byPersonName('en')).map((p) => p.name)).toEqual(['Adel', 'Ziad']);
    expect([...people].sort(byPersonName('ar')).map((p) => p.name)).toEqual(['Ziad', 'Adel']);
  });

  it('matches a search text against both names', () => {
    expect(matchesPerson(both, 'fai')).toBe(true);
    expect(matchesPerson(both, 'فيصل')).toBe(true);
    // The search folds alef forms, so a typed plain alef finds a hamza alef.
    expect(matchesPerson({ name: 'Ahmed', nameAr: 'أحمد' }, 'احمد')).toBe(true);
    expect(matchesPerson(both, 'sara')).toBe(false);
    expect(matchesPerson(both, '')).toBe(true);
  });

  it('picks the Arabic form of a server detail when the screen is Arabic', () => {
    const detail = { lead: 'Faisal', leadAr: 'فيصل', status: 'done' };
    expect(localName(detail, 'lead', 'ar')).toBe('فيصل');
    expect(localName(detail, 'lead', 'en')).toBe('Faisal');
    expect(localName({ lead: 'Faisal' }, 'lead', 'ar')).toBe('Faisal');
    expect(localName({ lead: '', leadAr: 'فيصل' }, 'lead', 'en')).toBe('فيصل');
    expect(localName({}, 'lead', 'en')).toBe('');
  });
});

describe('matchRank and rankedMatches (chats-01)', () => {
  it('ranks a name that starts with the letters, then a later word that starts with them, then the letters inside a word', () => {
    expect(matchRank({ name: 'Sara Al-Qahtani' }, 'sa')).toBe(0);
    expect(matchRank({ name: 'Faisal Al-Harbi' }, 'al')).toBe(1);
    expect(matchRank({ name: 'Faisal Al-Harbi' }, 'sa')).toBe(2);
    expect(matchRank({ name: 'Faisal Al-Harbi' }, 'zz')).toBe(-1);
    expect(matchRank({ name: 'Faisal', nameAr: 'فيصل' }, 'في')).toBe(0);
  });

  it('puts the best match first and keeps the order of equal ranks', () => {
    const people = [{ name: 'Faisal Al-Harbi' }, { name: 'Omar Sabbagh' }, { name: 'Sara Al-Qahtani' }, { name: 'Sami Noor' }];
    expect(rankedMatches(people, 'sa').map((p) => p.name)).toEqual(['Sara Al-Qahtani', 'Sami Noor', 'Omar Sabbagh', 'Faisal Al-Harbi']);
  });
});

