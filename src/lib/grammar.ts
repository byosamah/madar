/**
 * The i18next context for a sentence that starts with a person's name. Arabic verbs agree with the person
 * ("أنشأت" for a woman, "أنشأ" for a man); a key with the "_female" ending holds the feminine form.
 * English has no such keys, so it always falls back to the one form.
 */
export function actorContext(person?: { gender?: 'female' | 'male' } | null): 'female' | undefined {
  return person?.gender === 'female' ? 'female' : undefined;
}
