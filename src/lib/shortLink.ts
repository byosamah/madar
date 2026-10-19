import { SHORT_LINK } from './geo';

/** The short Google Maps link inside a text, as an https address: a WhatsApp share holds the place name and the link. Null: none. */
export function shortLinkIn(text: string): string | null {
  const match = /(?:https?:\/\/)?(?:maps\.app\.goo\.gl\/|goo\.gl\/maps)[^\s]*/i.exec(text);
  if (!match || !SHORT_LINK.test(match[0])) return null;
  return `https://${match[0].replace(/^https?:\/\//i, '')}`;
}

/**
 * The long Google Maps address of a short link, or null when the server cannot follow it (audit 2026-10-19, PRJ-03). The Pages
 * Function /maplink follows the redirect: a browser cannot, because Google sends no CORS header. Null leads to the old message.
 */
export async function resolveShortLink(link: string): Promise<string | null> {
  try {
    const response = await fetch('/maplink', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: link }) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const url = typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : undefined;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}
