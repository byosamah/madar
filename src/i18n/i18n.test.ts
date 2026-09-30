import { afterEach, describe, expect, it } from 'vitest';
import en from './en.json';
import ar from './ar.json';
import { applyLanguage, initI18n } from './index';

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((out, [key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') out[path] = item;
    else Object.assign(out, flatten(item as Record<string, unknown>, path));
    return out;
  }, {});
}

const english = flatten(en);
const arabic = flatten(ar);
const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe('languages', () => {
  afterEach(() => {
    initI18n('en');
    applyLanguage(document.documentElement, 'en');
  });

  it('has the same keys in English and Arabic', () => {
    expect(Object.keys(arabic).sort()).toEqual(Object.keys(english).sort());
  });

  it('has no empty text', () => {
    for (const [key, text] of [...Object.entries(english), ...Object.entries(arabic)]) expect({ key, empty: text.trim() === '' }).toEqual({ key, empty: false });
  });

  it('keeps the same placeholders in both languages', () => {
    for (const key of Object.keys(english)) expect({ key, vars: placeholders(arabic[key] ?? '') }).toEqual({ key, vars: placeholders(english[key]) });
  });

  it('has no em-dash in any text', () => {
    for (const text of [...Object.values(english), ...Object.values(arabic)]) expect(text).not.toContain('\u2014');
  });

  it('switches the language and the direction', () => {
    const i18n = initI18n('ar');
    expect(i18n.t('nav.projects')).toBe('المشاريع');
    expect(i18n.t('placeholder.body', { step: 2 })).toContain('2');
    applyLanguage(document.documentElement, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });
});
