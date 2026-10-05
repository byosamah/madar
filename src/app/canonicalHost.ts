/**
 * The real screens have one address (owner, 2026-10-05): www.madar.vado.sa sends the person to madar.vado.sa with the same
 * path, query and hash, so a sign-in, a saved session and the email links all live on one origin. Cloudflare Pages cannot
 * redirect by host name, so main.tsx does it before the start. Null for every address that needs no move.
 */
export function canonicalUrl(href: string): string | null {
  const url = new URL(href);
  if (!url.hostname.startsWith('www.')) return null;
  url.hostname = url.hostname.slice('www.'.length);
  return url.toString();
}
