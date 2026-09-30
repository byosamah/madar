import type { TFunction } from 'i18next';

/**
 * The i18next context for a sentence that starts with a person's name. Arabic verbs agree with the person
 * ("أنشأت" for a woman, "أنشأ" for a man); a key with the "_female" ending holds the feminine form.
 * English has no such keys, so it always falls back to the one form.
 */
export function actorContext(person?: { gender?: 'female' | 'male' } | null): 'female' | undefined {
  return person?.gender === 'female' ? 'female' : undefined;
}

/**
 * A text with a number that Arabic inflects: 1 يوم, 2 يومان, 3 to 10 أيام, 11 and up يومًا.
 * The Arabic file holds the plural forms (_one, _two, _few, _many, _other); English keeps its one short form.
 */
export function counted(t: TFunction, key: string, n: number): string {
  return t(key, { n, count: n });
}
