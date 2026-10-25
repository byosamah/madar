/**
 * Cuts an address down to what is safe to send to PostHog (insight design, section 5, rule 5). It keeps the origin and the path.
 * It keeps one query value: the `tab` of a project page. It drops the rest of the query and the whole fragment, so no search text,
 * no task id, no file signature and no Google code leaves the browser. A text that is no address comes back as it is.
 * Pure and safe for the screens and for the server.
 */
export function scrubUrl(url: string): string {
  if (!url) return url;
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    // A path with no host gets a fake base only to read it. The base never shows in the answer.
    if (!absolute && !url.startsWith('/')) return url;
    const parsed = new URL(url, 'https://base.invalid');
    const tab = parsed.searchParams.get('tab');
    const query = tab ? `?tab=${encodeURIComponent(tab)}` : '';
    return `${absolute ? parsed.origin : ''}${parsed.pathname}${query}`;
  } catch {
    return url;
  }
}

/** Scrubs each address inside a text, for example an error message. A mark right after an address stays. */
export function scrubText(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (match) => {
    const mark = /[.,;:!?)\]}'"]+$/.exec(match)?.[0] ?? '';
    return scrubUrl(mark ? match.slice(0, -mark.length) : match) + mark;
  });
}
