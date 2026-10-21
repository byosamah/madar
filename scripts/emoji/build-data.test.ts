import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isReactionEmoji } from '../../src/api/contract/emoji';
import { REACTIONS } from '../../src/api/contract/limits';
import { arabicOf, canonical, versionAllowed } from './build-data';

/** The committed emoji data (chat presence design D, track emoji E1). */
const FILE = new URL('../../src/features/emoji/data.generated.json', import.meta.url);
type Item = { e: string; en: string; ar: string; k: string[]; ka: string[]; s?: string[] };
const data = JSON.parse(readFileSync(FILE, 'utf8')) as { v: number; max: string; groups: { key: string; items: Item[] }[] };
const items = data.groups.flatMap((group) => group.items);
const find = (emoji: string) => items.find((item) => item.e === emoji);

describe('the emoji data file', () => {
  it('has the 8 groups', () => {
    expect(data.v).toBe(1);
    expect(data.max).toBe('15.0');
    expect(data.groups.map((group) => group.key)).toEqual(['people', 'nature', 'food', 'activities', 'travel', 'objects', 'symbols', 'flags']);
    for (const group of data.groups) expect(group.items.length).toBeGreaterThan(40);
  });

  it('has 🫨 (15.0) and not 🙂‍↔️ (15.1)', () => {
    expect(find('🫨')).toBeDefined();
    expect(find('🙂‍↔️')).toBeUndefined();
    expect(find('🫩')).toBeUndefined();
  });

  it('has no skin tone item as its own entry, and no component', () => {
    expect(items.filter((item) => /[\u{1F3FB}-\u{1F3FF}]/u.test(item.e))).toEqual([]);
    expect(find('🏻')).toBeUndefined();
    expect(find('🦰')).toBeUndefined();
  });

  it('gives 👋 its five tones, in the order of the tone buttons', () => {
    expect(find('👋')?.s).toEqual(['👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿']);
    expect(find('😀')?.s).toBeUndefined();
  });

  it('gives each item a name in both languages, and the keywords as lists', () => {
    for (const item of items) {
      expect(item.en, item.e).not.toBe('');
      expect(item.ar, item.e).not.toBe('');
      expect(Array.isArray(item.k)).toBe(true);
      expect(Array.isArray(item.ka)).toBe(true);
    }
    expect(find('❤️')?.ar).toBe('قلب أحمر');
    expect(find('😀')?.en).toBe('grinning face');
  });

  it('holds only emoji that a reaction takes, tones included', () => {
    const refused = items.flatMap((item) => [item.e, ...(item.s ?? [])]).filter((emoji) => !isReactionEmoji(emoji));
    expect(refused).toEqual([]);
  });

  it('writes each emoji as a phone does, so the three quick reactions are in the list as they are', () => {
    for (const emoji of REACTIONS) expect(find(emoji), emoji).toBeDefined();
    expect(find('❤️')).toBeDefined();
    expect(items.filter((item) => canonical(item.e) !== item.e)).toEqual([]);
  });

  it('has no emoji twice', () => {
    const all = items.map((item) => item.e);
    expect(new Set(all).size).toBe(all.length);
  });

  it('is at most 450 KB', () => {
    expect(statSync(FILE).size).toBeLessThanOrEqual(450 * 1024);
  });
});

describe('the build rules', () => {
  it('keeps an emoji of version 15.0 and drops 15.1', () => {
    expect(versionAllowed(15)).toBe(true);
    expect(versionAllowed(0.6)).toBe(true);
    expect(versionAllowed(15.1)).toBe(false);
    expect(versionAllowed(16)).toBe(false);
  });

  it('drops U+FE0F after an emoji that needs none, and keeps it after a text symbol', () => {
    const vs = String.fromCharCode(0xfe0f);
    expect(canonical('\u{1F44D}' + vs)).toBe('\u{1F44D}');
    expect(canonical('\u2764' + vs)).toBe('\u2764' + vs);
    expect(canonical('\u{1F3F3}' + vs + '\u200D\u{1F308}')).toBe('\u{1F3F3}' + vs + '\u200D\u{1F308}');
    expect(canonical('#' + vs + '\u20E3')).toBe('#' + vs + '\u20E3');
  });

  it('finds an Arabic annotation with or without the variation selector', () => {
    const table = { '❤': { default: ['قلب'], tts: ['قلب أحمر'] } };
    expect(arabicOf(table, '❤️')?.tts[0]).toBe('قلب أحمر');
    expect(arabicOf(table, '❤')?.tts[0]).toBe('قلب أحمر');
    expect(arabicOf(table, '🤷')).toBeUndefined();
  });
});
