/** The input types that a browser fills from its own memory. A date field takes none, so it is not in this list. */
const MEMORY_TYPES = ['text', 'number', 'tel', 'email', 'url'];

/** The text fields under a root: every textarea, and every input of a text type (an input with no type counts as text). */
export function textFieldsOf(root: HTMLElement): (HTMLInputElement | HTMLTextAreaElement)[] {
  return [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].filter((field) => {
    if (field.tagName === 'TEXTAREA') return true;
    const type = field.getAttribute('type');
    return type === null || MEMORY_TYPES.includes(type);
  });
}
