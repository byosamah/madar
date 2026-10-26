import { describe, expect, it } from 'vitest';
import { byShownName, shownName } from './projectLabel';

describe('the name of a project in the screen language (owner, 2026-10-26, fbk_062)', () => {
  const project = { name: 'Corniche Office Tower', nameAr: 'برج الكورنيش للمكاتب' };

  it('shows the Arabic name in Arabic and the English name in English', () => {
    expect(shownName(project, 'ar')).toBe('برج الكورنيش للمكاتب');
    expect(shownName(project, 'en')).toBe('Corniche Office Tower');
  });

  it('falls back to the English name when the Arabic name is missing, empty or blank', () => {
    expect(shownName({ name: 'Harbor Villa' }, 'ar')).toBe('Harbor Villa');
    expect(shownName({ name: 'Harbor Villa', nameAr: '' }, 'ar')).toBe('Harbor Villa');
    expect(shownName({ name: 'Harbor Villa', nameAr: '  ' }, 'ar')).toBe('Harbor Villa');
    expect(shownName({ name: 'Harbor Villa', nameAr: null }, 'ar')).toBe('Harbor Villa');
  });

  it('sorts by the name that the screen shows', () => {
    const rows = [{ name: 'A tower', nameAr: 'ب' }, { name: 'B tower', nameAr: 'أ' }];
    expect([...rows].sort(byShownName('ar')).map((row) => row.name)).toEqual(['B tower', 'A tower']);
    expect([...rows].sort(byShownName('en')).map((row) => row.name)).toEqual(['A tower', 'B tower']);
  });
});
