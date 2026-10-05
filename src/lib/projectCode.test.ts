import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATIONS, buildProjectCode, codeMatches, codeMonth, contractOf, isProjectCode, KEY_PATTERN, nextSeries, normalizeInitials,
  normalizeTypedCode, parseProjectCode, PROJECT_CODE_PATTERN, projectKey,
} from './projectCode';

const OWNER_EXAMPLE = '260902AZT-RES-Multi-unit Dev.';

describe('the project code (owner, 2026-10-05)', () => {
  it('reads the owner example in its parts', () => {
    expect(parseProjectCode(OWNER_EXAMPLE)).toEqual({ yymm: '2609', series: '02', initials: 'AZT', classification: 'RES', type: 'Multi-unit Dev.' });
  });

  it('has the eight classes in a fixed order', () => {
    expect(CLASSIFICATIONS).toEqual(['RES', 'COM', 'IND', 'INS', 'REC', 'AGR', 'UTL', 'MIX']);
  });

  it('accepts 4 initials, every class and a type of 1 to 40 characters', () => {
    for (const cls of CLASSIFICATIONS) expect(isProjectCode(`261100ABCD-${cls}-Villa`)).toBe(true);
    expect(isProjectCode('261100ABC-COM-X')).toBe(true);
    expect(isProjectCode(`261100ABC-COM-${'a'.repeat(40)}`)).toBe(true);
  });

  it('accepts the old form, so old codes never change', () => {
    expect(isProjectCode('KH-26-014')).toBe(true);
    expect(isProjectCode('A-25-0001')).toBe(true);
    expect(parseProjectCode('KH-26-014')).toBeNull();
  });

  it.each([
    ['261300AZT-RES-Villa', 'month 13'],
    ['260000AZT-RES-Villa', 'month 00'],
    ['260902AZ-RES-Villa', 'two initials'],
    ['260902AZTXY-RES-Villa', 'five initials'],
    ['260902azt-RES-Villa', 'small letters in the initials'],
    ['260902AZT-HOM-Villa', 'an unknown class'],
    ['260902AZT-RES-', 'no type'],
    [`260902AZT-RES-${'a'.repeat(41)}`, 'a type of 41 characters'],
    ['260902AZT-RES- Villa', 'a space at the start of the type'],
    ['260902AZT-RES-Villa ', 'a space at the end of the type'],
    ['260902AZT-RES-Two\nlines', 'a new line in the type'],
    ['2609AZT-RES-Villa', 'no series'],
    ['KH-6-014', 'an old code with one year digit'],
  ])('refuses %j (%s)', (code) => {
    expect(isProjectCode(code)).toBe(false);
    expect(PROJECT_CODE_PATTERN.test(code)).toBe(false);
  });

  it('builds a code from its parts, with a two-digit series and a trimmed type', () => {
    expect(buildProjectCode({ yymm: '2609', series: 2, initials: 'AZT', classification: 'RES', type: ' Multi-unit Dev. ' })).toBe(OWNER_EXAMPLE);
    expect(buildProjectCode({ yymm: '2610', series: 0, initials: 'ABCD', classification: 'MIX', type: 'Tower' })).toBe('261000ABCD-MIX-Tower');
  });

  it('gives the key YYMMSSINI for a new code, and the whole code for an old one', () => {
    expect(projectKey(OWNER_EXAMPLE)).toBe('260902AZT');
    expect(projectKey('KH-26-014')).toBe('KH-26-014');
  });

  it('names the contract by YYMMSS, and has no contract for an old code', () => {
    expect(contractOf(OWNER_EXAMPLE)).toBe('260902');
    expect(contractOf('260902BCD-COM-Shop')).toBe('260902');
    expect(contractOf('KH-26-014')).toBeNull();
  });

  it('takes YYMM from the office day', () => {
    expect(codeMonth('2026-09-30')).toBe('2609');
    expect(codeMonth('2027-01-02')).toBe('2701');
  });

  it('counts the series of a month from 00, firm wide', () => {
    expect(nextSeries([], '2610')).toBe(0);
    expect(nextSeries(['KH-26-014', '260902AZT-RES-Villa'], '2610')).toBe(0);
  });

  it('gives the highest series of that month plus 1, and a shared code counts once', () => {
    const codes = ['261000AZT-RES-Villa', '261000AZT-RES-Villa', '261003BCD-COM-Shop', '260907AZT-RES-Villa', 'KH-26-099'];
    expect(nextSeries(codes, '2610')).toBe(4);
    expect(nextSeries(codes, '2609')).toBe(8);
  });

  it('has no next series after 99', () => {
    expect(nextSeries(['261099AZT-RES-Villa'], '2610')).toBeNull();
  });

  it('matches a project by its full code or by its key', () => {
    expect(codeMatches(OWNER_EXAMPLE, OWNER_EXAMPLE)).toBe(true);
    expect(codeMatches(OWNER_EXAMPLE, '260902AZT')).toBe(true);
    expect(codeMatches(OWNER_EXAMPLE, '260902')).toBe(false);
    expect(codeMatches('KH-26-014', 'KH-26-014')).toBe(true);
    expect(codeMatches('KH-26-014', 'KH-26-01')).toBe(false);
  });

  it('makes typed initials capitals', () => {
    expect(normalizeInitials('azt')).toBe('AZT');
    expect(normalizeInitials('aBcD')).toBe('ABCD');
  });

  it('makes the key and the class of a typed code capitals, and keeps the type as typed', () => {
    expect(normalizeTypedCode(' 260902azt-res-Multi-unit Dev. ')).toBe(OWNER_EXAMPLE);
    expect(normalizeTypedCode('kh-26-014')).toBe('KH-26-014');
    expect(normalizeTypedCode('')).toBe('');
  });

  it('has a key pattern for links in posts', () => {
    const key = new RegExp(`^${KEY_PATTERN}$`);
    expect(key.test('260902AZT')).toBe(true);
    expect(key.test('260902ABCD')).toBe(true);
    expect(key.test('261302AZT')).toBe(false);
    expect(key.test('260902AZ')).toBe(false);
  });
});
