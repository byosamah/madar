import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ar, en } from './trees';

/** Every text of a word tree by its key. */
function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((out, [key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') out[path] = item;
    else Object.assign(out, flatten(item as Record<string, unknown>, path));
    return out;
  }, {});
}

/** A fresh word module, with no language loaded. The test setup gives both languages to the module of the other tests. */
async function freshWords() {
  vi.resetModules();
  const words = await import('./index');
  return words;
}

afterEach(() => {
  vi.doUnmock('./words.ar');
});

describe('the words of one language at a time (performance audit BND-7)', () => {
  it('make the same tree for each language as trees.ts, which the server and the tests keep', async () => {
    expect((await import('./words.en')).en).toEqual(en);
    expect((await import('./words.ar')).ar).toEqual(ar);
  });

  it('give the same text for every key after loadWords and initI18n as the trees of both languages gave', async () => {
    // Today's setting: both trees in one i18next, with English as the fallback.
    const today = i18next.createInstance();
    await today.init({ lng: 'ar', fallbackLng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false }, initAsync: false });
    const words = await freshWords();
    expect(words.wordsReady('ar')).toBe(false);
    await words.loadWords('ar');
    expect(words.wordsReady('ar')).toBe(true);
    expect(words.wordsReady('en')).toBe(false);
    // Only the Arabic words are there: no key falls back to English, because each English key has an Arabic twin.
    let i18n = words.initI18n('ar');
    const female = { context: 'female', count: 3, name: 'X' };
    for (const key of Object.keys(flatten(ar))) {
      expect(i18n.t(key), key).toBe(today.t(key));
      expect(i18n.t(key.replace(/_(female|zero|one|two|few|many|other)$/, ''), female), key).toBe(today.t(key.replace(/_(female|zero|one|two|few|many|other)$/, ''), female));
    }
    await words.loadWords('en');
    i18n = words.initI18n('en');
    await today.changeLanguage('en');
    for (const key of Object.keys(flatten(en))) expect(i18n.t(key, { count: 1, name: 'X' }), key).toBe(today.t(key, { count: 1, name: 'X' }));
  });

  it('apply a language at once when its words are there, and only after they load when they are not', async () => {
    let open = () => undefined as void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    vi.doMock('./words.ar', async () => {
      await gate;
      return { ar: { app: { name: 'مدار' } } };
    });
    const words = await freshWords();
    await words.loadWords('en');
    const applied: string[] = [];
    words.withWords('en', () => applied.push('en'));
    expect(applied).toEqual(['en']);
    words.withWords('ar', () => applied.push('ar'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(applied).toEqual(['en']);
    open();
    await vi.waitFor(() => expect(applied).toEqual(['en', 'ar']));
  });

  it('apply nothing when the load fails or the caller cancels, so no screen shows one language in the direction of the other', async () => {
    vi.doMock('./words.ar', async () => { throw new Error('Failed to fetch dynamically imported module'); });
    const failing = await freshWords();
    const applied: string[] = [];
    failing.withWords('ar', () => applied.push('ar'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(applied).toEqual([]);
    expect(failing.wordsReady('ar')).toBe(false);

    vi.doUnmock('./words.ar');
    const words = await freshWords();
    const cancel = words.withWords('ar', () => applied.push('late'));
    cancel();
    await words.loadWords('ar');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(applied).toEqual([]);
  });
});
