import { afterEach, describe, expect, it } from 'vitest';
import { ar, en } from './trees';
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

  it('has the same keys in English and Arabic, plus Arabic feminine forms', () => {
    // Arabic verbs agree with a woman's name; English has one form. So "_female" keys exist in Arabic only.
    // Arabic also inflects counts (_one, _two, _few, _many, _other), picked by i18next from "count".
    const plural = /_(zero|one|two|few|many|other)$/;
    const arabicBase = Object.keys(arabic).filter((key) => !key.endsWith('_female') && !plural.test(key));
    // English inflects a few counts too ("1 day past due", "3 days past due"), with _one and _other.
    const englishBase = Object.keys(english).filter((key) => !plural.test(key));
    expect(arabicBase.sort()).toEqual(englishBase.sort());
    for (const key of Object.keys(english).filter((k) => plural.test(k))) {
      expect({ key, base: key.replace(plural, '') in english }).toEqual({ key, base: true });
    }
    for (const key of Object.keys(arabic).filter((k) => plural.test(k))) {
      expect({ key, base: key.replace(plural, '') in english }).toEqual({ key, base: true });
      expect({ key, vars: placeholders(arabic[key]).filter((v) => v !== 'count') }).toEqual({ key, vars: [] });
    }
    for (const key of Object.keys(arabic).filter((k) => k.endsWith('_female'))) {
      const base = key.slice(0, -'_female'.length);
      expect({ key, base: base in english }).toEqual({ key, base: true });
      expect({ key, vars: placeholders(arabic[key]) }).toEqual({ key, vars: placeholders(english[base]) });
    }
  });

  it('gives the feed, the task history and the Inbox a feminine Arabic form', () => {
    for (const key of ['feed.project.created', 'feed.task.done', 'taskHistory.created', 'inbox.trigger.task_assigned']) expect(`${key}_female` in arabic).toBe(true);
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
    expect(i18n.t('health.setBy', { name: 'هلا' })).toBe('بتحديد هلا');
    applyLanguage(document.documentElement, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });
});
