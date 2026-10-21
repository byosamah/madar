/**
 * Puts an emoji into the text of a box (chat presence design D2, track emoji E2). `start` and `end` are the selection of the box in UTF-16
 * units, as a textarea gives them: the emoji replaces the selection, or goes in at the caret when the two are equal. A value outside the
 * text is moved to its edge. `caret` is the place after the emoji.
 */
export function insertAt(value: string, start: number, end: number, text: string): { next: string; caret: number } {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.min(value.length, Math.max(start, end, from));
  return { next: value.slice(0, from) + text + value.slice(to), caret: from + text.length };
}
