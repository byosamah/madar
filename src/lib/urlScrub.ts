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
  return text
    .slice(0, MAX_SCAN)
    .replace(/https?:\/\/\S+/gi, withMark)
    .replace(/(^|[\s("'])(\/\S*[?#]\S*)/g, (_all, before: string, token: string) => before + withMark(token));
}

/**
 * Hides every span that opens with a quote or with `=(`, in one pass from left to right (insight design, sixth security fix). It has four
 * states. Plain: each character is copied; a `"` writes `"..."` and opens a double span; a `'` with no letter or digit just before it
 * writes `"..."` and opens a single span (an apostrophe inside a word, as in don't, stays plain); `=(` writes `=(...)` and opens a paren
 * span. Double: every character is skipped (also `'` and `(`) up to the next `"`. Single: every character is skipped (also `"`) up to the
 * next `'`. Paren: every character is skipped up to the next `)`. A span that is still open at the end of the text stays hidden, because
 * its marker is written and nothing after it was copied, so it fails closed by construction. One pass, linear.
 */
export function hideSpans(text: string): string {
  const out: string[] = [];
  let state: 'plain' | 'double' | 'single' | 'paren' = 'plain';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (state === 'double') {
      if (char === '"') state = 'plain';
    } else if (state === 'single') {
      if (char === "'") state = 'plain';
    } else if (state === 'paren') {
      if (char === ')') state = 'plain';
    } else if (char === '"') {
      out.push('"..."');
      state = 'double';
    } else if (char === "'" && (i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]!))) {
      out.push('"..."');
      state = 'single';
    } else if (char === '=' && text[i + 1] === '(') {
      out.push('=(...)');
      state = 'paren';
      i += 1;
    } else {
      out.push(char);
    }
  }
  return out.join('');
}

/**
 * The strict cleaning of a server error text (insight design, third security fix). A database error repeats the values of a row,
 * a user lookup repeats an email, and a bad token shows in its message. The text is cut to `MAX_SCAN`, then:
 *  1. `hideSpans` hides every quoted part and every `=(...)` value (an open one included),
 *  2. every email-like word becomes <email>,
 *  3. every run of 20 or more letters, digits, underscores or dashes becomes <token>.
 * The words around stay, so the message is still useful. The screens do not use this: a browser message such as
 * "Cannot read properties of undefined (reading 'name')" needs its quoted word.
 */
export function redactText(text: string): string {
  return hideSpans(text.slice(0, MAX_SCAN))
    .replace(/\S+/g, (word) => (hasInnerAt(word) ? '<email>' : word))
    .replace(/[A-Za-z0-9_-]{20,}/g, '<token>');
}

/**
 * True for a word with an @ that has a character before it and a character after it, like \S+@\S+. The pattern /[^\s@]+@[^\s@]+/ tries every
 * start in a long run with no @ and scans to its end each time, which is quadratic; this reads each word once.
 */
function hasInnerAt(word: string): boolean {
  const at = word.indexOf('@', 1);
  return at !== -1 && at < word.length - 1;
}
