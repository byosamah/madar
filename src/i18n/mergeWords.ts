/**
 * The merge of the word files: the base file plus one file for each track of the real build (src/i18n/real/<track>.<lang>.json).
 * A track only adds keys. A key that the base or another track file already has fails at load, so two tracks never fight over one text.
 */
type Tree = { [key: string]: string | Tree };

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addInto(target: Tree, words: Tree, file: string, path: string[]): void {
  for (const [key, value] of Object.entries(words)) {
    const at = [...path, key];
    const existing = target[key];
    if (existing === undefined) {
      target[key] = isTree(value) ? structuredClone(value) : value;
    } else if (isTree(existing) && isTree(value)) {
      addInto(existing, value, file, at);
    } else {
      throw new Error(`The text key ${at.join('.')} in ${file} is already in the word files.`);
    }
  }
}

export function mergeWords<T extends object>(base: T, parts: { file: string; words: object }[]): T {
  const merged = structuredClone(base) as unknown as Tree;
  for (const part of parts) addInto(merged, part.words as Tree, part.file, []);
  return merged as unknown as T;
}

/** The track files of one import.meta.glob, in name order. */
export function partsOf(files: Record<string, unknown>): { file: string; words: object }[] {
  return Object.keys(files)
    .sort()
    .map((file) => ({ file: file.replace(/^\.\//, ''), words: files[file] as object }));
}
