/** The part of a value before the first `?` or `#`. */
const beforeQuery = (value: string): string => value.split(/[?#]/, 1)[0] ?? '';

/**
 * Cuts an address down to what is safe to send to PostHog (insight design, section 5, rule 5). It keeps the origin and the path.
 * It keeps one query value: the `tab` of a project page. It drops the rest of the query and the whole fragment, so no search text,
 * no task id, no file signature and no Google code leaves the browser. It fails closed: a value with a `?` or a `#` never comes back
 * as it is, also when it is no full address or when it cannot be read. A text with neither mark comes back as it is.
 * Pure and safe for the screens and for the server.
 */
export function scrubUrl(url: string): string {
  if (!url) return url;
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    if (!absolute && !url.startsWith('/')) return scrubLoose(url);
    // A path with no host gets a fake base only to read it. The base never shows in the answer.
    const parsed = new URL(url, 'https://base.invalid');
    const tab = parsed.searchParams.get('tab');
    const query = tab ? `?tab=${encodeURIComponent(tab)}` : '';
    return `${absolute ? parsed.origin : ''}${parsed.pathname}${query}`;
  } catch {
    return beforeQuery(url);
  }
}

/** A value that is no address and no path, for example `search?q=x` or `#code=1`: the part before the mark, plus the `tab`. */
function scrubLoose(value: string): string {
  const cut = value.search(/[?#]/);
  if (cut < 0) return value;
  const base = value.slice(0, cut);
  if (value[cut] === '#') return base;
  const tab = new URLSearchParams(value.slice(cut + 1).split('#', 1)[0]).get('tab');
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

/** The most characters that `scrubText` and `redactText` read. A longer text is cut first, so no caller can hand them a huge text. */
export const MAX_SCAN = 4000;

/**
 * Cuts a text to `max` characters. A text that is not longer comes back as it is. When the cut falls inside a span that is still open,
 * it hides everything from the open mark (fail closed), so no half of a quoted value stays: an open `=(` becomes `=(...)`, an open
 * `"` becomes `"..."`, and an open `'` that starts a quote (not an apostrophe inside a word) becomes `"..."`. With more than one
 * open span, the earliest one wins. One pass over the text, so the work stays linear.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const open = openSpan(cut);
  return open ? cut.slice(0, open.at) + open.mark : cut;
}

/** The earliest span that the end of the text leaves open, or null. */
function openSpan(text: string): { at: number; mark: string } | null {
  let best: { at: number; mark: string } | null = null;
  const take = (at: number, mark: string) => {
    if (best === null || at < best.at) best = { at, mark };
  };
  // =( with no ) after it: the first one at or after the last ")" minus one.
  const lastParen = text.lastIndexOf(')');
  const paren = text.indexOf('=(', Math.max(0, lastParen - 1));
  if (paren !== -1) take(paren, '=(...)');
  // Quotes pair from the left, so with an odd count the last " is the open one.
  let doubles = 0;
  let singleOpen = -1;
  let lastDouble = -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"') {
      doubles += 1;
      lastDouble = i;
    } else if (char === "'") {
      if (singleOpen !== -1) singleOpen = -1;
      else if (i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]!)) singleOpen = i;
    }
  }
  if (doubles % 2 === 1) take(lastDouble, '"..."');
  if (singleOpen !== -1) take(singleOpen, '"..."');
  return best;
}

const END_MARKS = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', "'", '"']);

/** The marks that end a sentence or close a bracket. They stay after a scrubbed address. A plain loop keeps the work linear. */
function withMark(token: string): string {
  let end = token.length;
  while (end > 0 && END_MARKS.has(token[end - 1]!)) end -= 1;
  return scrubUrl(token.slice(0, end)) + token.slice(end);
}

/**
 * Scrubs each address inside a text, for example an error message: a full address (any letter case) and a path that holds a `?` or
 * a `#`. A mark right after an address stays.
 */
export function scrubText(text: string): string {
  return cutText(text, MAX_SCAN)
    .replace(/https?:\/\/\S+/gi, withMark)
    .replace(/(^|[\s("'])(\/\S*[?#]\S*)/g, (_all, before: string, token: string) => before + withMark(token));
}

/**
 * The strict cleaning of a server error text (insight design, third security fix). A database error repeats the values of a row,
 * a user lookup repeats an email, and a bad token shows in its message. In this order it replaces:
 *  1. every quoted part ("..." and '...') with "...",
 *  2. every email-like word with <email>,
 *  3. every run of 20 or more letters, digits, underscores or dashes with <token>.
 * An apostrophe inside a word (it's) is no quote. The words around stay, so the message is still useful. The screens do not use this:
 * a browser message such as "Cannot read properties of undefined (reading 'name')" needs its quoted word.
 */
export function redactText(text: string): string {
  return cutText(text, MAX_SCAN)
    .replace(/"[^"]*"/g, '"..."')
    .replace(/(^|[^A-Za-z0-9])'[^']*'/g, (_all, before: string) => `${before}"..."`)
    .replace(/\S+/g, (word) => (hasInnerAt(word) ? '<email>' : word))
    .replace(/[A-Za-z0-9_-]{20,}/g, '<token>');
}

/** True for a word with an @ that has a letter before it and a letter after it, like \S+@\S+. One pass, so the work stays linear. */
function hasInnerAt(word: string): boolean {
  const at = word.indexOf('@', 1);
  return at !== -1 && at < word.length - 1;
}
