import { describe, expect, it } from 'vitest';
import { byPersonName, localName, matchesPerson, personName } from './personName';

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
