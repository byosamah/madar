import i18n from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../i18n';
import { fileSizeText } from './fileSize';

describe('fileSizeText', () => {
  beforeEach(() => {
    initI18n('en');
  });

  it('gives KB under 1 MB with a minimum of 1', () => {
    expect(fileSizeText(100, i18n.t, 'en')).toBe('1 KB');
    expect(fileSizeText(2048, i18n.t, 'en')).toBe('2 KB');
    expect(fileSizeText(0, i18n.t, 'en')).toBe('1 KB');
    expect(fileSizeText(1024 * 1024 - 1, i18n.t, 'en')).toBe('1,024 KB');
  });

  it('gives MB with one decimal from 1 MB', () => {
    expect(fileSizeText(1572864, i18n.t, 'en')).toBe('1.5 MB');
    expect(fileSizeText(1024 * 1024, i18n.t, 'en')).toBe('1 MB');
  });

  it('uses Western digits in Arabic', () => {
    initI18n('ar');
    const text = fileSizeText(1572864, i18n.t, 'ar');
    expect(text).toMatch(/1\.5/);
    expect(text).not.toMatch(/[٠-٩]/);
  });
});
