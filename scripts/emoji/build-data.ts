/**
 * Builds src/features/emoji/data.generated.json for the emoji panel (chat presence design D, track emoji E1).
 * It joins Emojibase (the order, the groups, the versions, the skin tones, the English names and tags) with the Unicode CLDR
 * annotations (the Arabic names and keywords). The panel loads the file on its first open only.
 *
 * Sources (a dev tool of this script only; they are not in package.json and they do not ship):
 *   emojibase-data@17.0.0                 MIT
 *   cldr-annotations-full@48.2.0          Unicode-3.0 (annotations/ar)
 *   cldr-annotations-derived-full@48.2.0  Unicode-3.0 (annotationsDerived/ar)
 * Each version was published more than two weeks before 2026-10-21.
 *
 * To run it again:
 *   npm install --prefix <dir> emojibase-data@17.0.0 cldr-annotations-full@48.2.0 cldr-annotations-derived-full@48.2.0
 *   node --import tsx scripts/emoji/build-data.ts --src <dir>/node_modules
 * The sandbox blocks the network for the install: run the install with the sandbox off. The script has no other option than --out,
 * which names another output file.
 *
 * Rules: the emoji is written as phones write it (no needless U+FE0F). Emoji 15.0 and older (a newer one may show as a box on a phone of 2023). Smileys and People are one group. The Component group
 * (skin tone squares, hair) is left out. A tone form is never its own entry; `s` holds the five one-tone forms of an emoji that has
 * them, light to dark. A name that CLDR lacks in Arabic falls back to the derived table, then to the English name.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The newest Emoji version in the file. */
export const MAX_VERSION = 15.0;

/** The groups of the file, in the order of the panel. */
const GROUP_KEYS = ['people', 'nature', 'food', 'activities', 'travel', 'objects', 'symbols', 'flags'] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

/** The Emojibase group keys and the group of the panel that each one joins. `component` is left out. */
const GROUP_OF: Record<string, GroupKey | undefined> = {
  'smileys-emotion': 'people',
  'people-body': 'people',
  'animals-nature': 'nature',
  'food-drink': 'food',
  activities: 'activities',
  'travel-places': 'travel',
  objects: 'objects',
  symbols: 'symbols',
  flags: 'flags',
};

type Raw = { label: string; emoji: string; tags?: string[]; group?: number; order?: number; version: number; tone?: number | number[]; skins?: Raw[] };
type Annotation = { default?: string[]; tts?: string[] };
type Annotations = Record<string, Annotation>;
type Item = { e: string; en: string; ar: string; k: string[]; ka: string[]; s?: string[] };

export const versionAllowed = (version: number): boolean => version <= MAX_VERSION;

const VS16 = /\uFE0F/g;

/**
 * The form that phones and keyboards write. Emojibase adds U+FE0F to some emoji that need none (it writes the thumbs up with one). U+FE0F
 * belongs only after a character that is drawn as text by default (heart, smiling face, check mark). A reaction is the key of a record, so
 * the thumbs up of the panel must be the same key as the thumbs up of the three quick reactions.
 */
export const canonical = (emoji: string): string => emoji.replace(/(\p{Emoji_Presentation})\uFE0F/gu, '$1');

/** The Arabic annotation of an emoji. CLDR often writes the emoji without U+FE0F, so both forms are tried. */
export function arabicOf(table: Annotations, emoji: string): { tts: string[]; keywords: string[] } | undefined {
  const entry = table[emoji] ?? table[emoji.replace(VS16, '')];
  if (!entry) return undefined;
  return { tts: entry.tts ?? [], keywords: entry.default ?? [] };
}

const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/** The words of a text, for the rule that a keyword adds nothing when the name has all its words. */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The keywords that the name does not already hold, with no repeat. */
function extra(keywords: string[], name: string): string[] {
  const own = new Set(wordsOf(name));
  return [...new Set(keywords)].filter((keyword) => !wordsOf(keyword).every((word) => own.has(word)));
}

export function build(src: string): { v: 1; max: string; groups: { key: GroupKey; items: Item[] }[]; missingArabic: string[] } {
  const raw = read<Raw[]>(join(src, 'emojibase-data/en/data.json'));
  const messages = read<{ groups: { key: string; order: number }[] }>(join(src, 'emojibase-data/en/messages.json'));
  const full = read<{ annotations: { annotations: Annotations } }>(join(src, 'cldr-annotations-full/annotations/ar/annotations.json'));
  const derived = read<{ annotationsDerived: { annotations: Annotations } }>(join(src, 'cldr-annotations-derived-full/annotationsDerived/ar/annotations.json'));
  const keyOfGroup = new Map(messages.groups.map((group) => [group.order, group.key]));
  const buckets = new Map<GroupKey, { order: number; item: Item }[]>(GROUP_KEYS.map((key) => [key, []]));
  const missingArabic: string[] = [];
  for (const entry of raw) {
    if (entry.group === undefined || entry.order === undefined || !versionAllowed(entry.version)) continue;
    const key = GROUP_OF[keyOfGroup.get(entry.group) ?? ''];
    if (!key) continue;
    const annotation = arabicOf(full.annotations.annotations, entry.emoji) ?? arabicOf(derived.annotationsDerived.annotations, entry.emoji);
    const ar = annotation?.tts[0] ?? '';
    if (!ar) missingArabic.push(entry.emoji);
    const en = entry.label;
    const item: Item = { e: canonical(entry.emoji), en, ar: ar || en, k: extra(entry.tags ?? [], en), ka: extra(annotation?.keywords ?? [], ar) };
    const tones = (entry.skins ?? []).filter((skin) => typeof skin.tone === 'number' && versionAllowed(skin.version));
    const byTone = new Map(tones.map((skin) => [skin.tone as number, skin.emoji]));
    if ([1, 2, 3, 4, 5].every((tone) => byTone.has(tone))) item.s = [1, 2, 3, 4, 5].map((tone) => canonical(byTone.get(tone)!));
    buckets.get(key)!.push({ order: entry.order, item });
  }
  // Smileys come before People in Emojibase order already, so one sort by `order` keeps the Unicode order.
  const groups = GROUP_KEYS.map((key) => ({ key, items: buckets.get(key)!.sort((a, b) => a.order - b.order).map((row) => row.item) }));
  return { v: 1, max: MAX_VERSION.toFixed(1), groups, missingArabic };
}

/** One line for each item, so a change of the data shows as a small diff. */
export function toText(data: ReturnType<typeof build>): string {
  const lines = data.groups.map((group) => `{"key":${JSON.stringify(group.key)},"items":[\n${group.items.map((item) => JSON.stringify(item)).join(',\n')}\n]}`);
  return `{"v":${data.v},"max":${JSON.stringify(data.max)},"groups":[\n${lines.join(',\n')}\n]}\n`;
}

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const src = argOf('--src');
  if (!src) throw new Error('Give the folder of node_modules with --src <dir>/node_modules. The header of this file shows the install command.');
  const out = resolve(argOf('--out') ?? join(dirname(fileURLToPath(import.meta.url)), '../../src/features/emoji/data.generated.json'));
  const data = build(resolve(src));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toText(data));
  const count = data.groups.reduce((sum, group) => sum + group.items.length, 0);
  console.log(`Wrote ${out}: ${count} emoji in ${data.groups.length} groups.`);
  console.log(`Arabic name missing for ${data.missingArabic.length}: ${data.missingArabic.join(' ')}`);
}
