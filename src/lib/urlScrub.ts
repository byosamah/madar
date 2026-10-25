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

/** The marks that end a sentence or close a bracket. They stay after a scrubbed address. */
function withMark(token: string): string {
  const mark = /[.,;:!?)\]}'"]+$/.exec(token)?.[0] ?? '';
  return scrubUrl(mark ? token.slice(0, -mark.length) : token) + mark;
}

/**
 * Scrubs each address inside a text, for example an error message: a full address (any letter case) and a path that holds a `?` or
 * a `#`. A mark right after an address stays.
 */
export function scrubText(text: string): string {
  return text
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
  return text
    .replace(/"[^"]*"/g, '"..."')
    .replace(/(^|[^A-Za-z0-9])'[^']*'/g, (_all, before: string) => `${before}"..."`)
    .replace(/\S+@\S+/g, '<email>')
    .replace(/[A-Za-z0-9_-]{20,}/g, '<token>');
}
