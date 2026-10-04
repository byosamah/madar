import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The texts of the screens for the specs (task X2), so one step runs in English and in Arabic: the base word files plus the files
 * of the real build (src/i18n/real/<track>.<lang>.json), merged as src/i18n/trees.ts merges them for the screens.
 */
type Tree = { [key: string]: string | Tree };
const I18N = join(import.meta.dirname, '..', '..', 'src', 'i18n');

function merge(into: Tree, from: Tree): Tree {
  for (const [key, value] of Object.entries(from)) {
    const here = into[key];
    if (typeof value === 'object' && typeof here === 'object') merge(here, value);
    else into[key] = value;
  }
  return into;
}

const trees: Partial<Record<'en' | 'ar', Tree>> = {};

function treeOf(lang: 'en' | 'ar'): Tree {
  if (!trees[lang]) {
    const tree = JSON.parse(readFileSync(join(I18N, `${lang}.json`), 'utf8')) as Tree;
    for (const file of readdirSync(join(I18N, 'real')).filter((name) => name.endsWith(`.${lang}.json`)).sort()) {
      merge(tree, JSON.parse(readFileSync(join(I18N, 'real', file), 'utf8')) as Tree);
    }
    trees[lang] = tree;
  }
  return trees[lang]!;
}

/** The text of a key, with its {{placeholders}} filled. */
export function word(lang: 'en' | 'ar', key: string, values: Record<string, string> = {}): string {
  let at: string | Tree | undefined = treeOf(lang);
  for (const part of key.split('.')) at = typeof at === 'object' ? at[part] : undefined;
  if (typeof at !== 'string') throw new Error(`No ${lang} text has the key ${key}.`);
  return at.replace(/\{\{(\w+)\}\}/g, (all, name: string) => values[name] ?? all);
}
