/**
 * The short Google Maps link of the pin picker (audit 2026-10-19, PRJ-03). A person shares a place from Google Maps as a short
 * link (maps.app.goo.gl). It holds no coordinates, and a browser cannot read where it leads. The Pages Function under /maplink
 * follows the redirects and gives back the long address, which the screens read with parseMapLink.
 *
 * It costs nothing and needs no key. It opens only the short link, and follows a redirect only to a host of the Google list.
 * It never opens the last address, so no page of Google and no person data comes back. The answer is one address.
 *
 * Only a person signed in to the copy of the host gets an answer (review 2026-11-10, finding 4): a client that sends no
 * sec-fetch-site header (a script, or an old Safari) passed the site check alone. The token check is the one of the satellite tiles
 * (isPerson, pagesSatellite.ts), so both key kinds work. Only the page hosts of the two copies answer; any other host gets 404.
 */

import { copyOfPageHost } from '../core/serverHost';
import type { PagesEnv } from './pagesForward';
import { ownKeySetFor } from './pagesOwnKeys';
import { isPerson, keySetOf, type SatelliteDeps } from './pagesSatellite';

/** fetch opens the short link and its redirects; the two key sets check the token, as for the satellite tiles. */
export type MapLinkDeps = SatelliteDeps;

/** The hosts of a short link. The path of goo.gl must start with /maps. */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
/** The hosts that a redirect may name. */
const HOP_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com', 'maps.google.com', 'consent.google.com']);
/** The most redirects that the function follows. */
export const MAX_HOPS = 4;
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const answer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** True for https://maps.app.goo.gl/... and https://goo.gl/maps/... */
function isShortLink(url: URL): boolean {
  if (url.protocol !== 'https:' || !SHORT_HOSTS.has(url.hostname)) return false;
  return url.hostname === 'maps.app.goo.gl' || url.pathname.startsWith('/maps');
}

/** True for a Google Maps address: the end of the chain. The consent page counts, because its continue= holds the address. */
function isGoogleMaps(url: URL): boolean {
  const google = url.hostname === 'www.google.com' || url.hostname === 'google.com' || url.hostname === 'maps.google.com';
  return google && (url.hostname === 'maps.google.com' || url.pathname.startsWith('/maps'));
}

/**
 * The long address of a short link, or null. Each hop is read with redirect "manual", so no redirect leaves the host list. The
 * chain stops at the first address that is a Google Maps address: that address is not opened.
 */
export async function followShortLink(link: string, run: typeof fetch): Promise<string | null> {
  let current = link;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await run(current, { redirect: 'manual', method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Madar/1.0)' } });
    } catch {
      return null;
    }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status > 399 || !location) return null;
    const next = parse(new URL(location, current).href);
    if (!next || next.protocol !== 'https:' || !HOP_HOSTS.has(next.hostname)) return null;
    if (next.hostname === 'consent.google.com') {
      const inside = parse(next.searchParams.get('continue') ?? '');
      return inside && inside.protocol === 'https:' && isGoogleMaps(inside) ? inside.href : null;
    }
    if (isGoogleMaps(next)) return next.href;
    current = next.href;
  }
  return null;
}

/**
 * POST /maplink with {"url": "<short link>"} and the sign-in token of the person. The answer is {"url": "<long address>"}. No good
 * token: 401, and the route opens no outside address. A key set that does not load: 503, never a refusal.
 */
export async function resolveMapLink(request: Request, env: PagesEnv = {}, deps: MapLinkDeps = { fetch, keySet: keySetOf, ownKeySet: ownKeySetFor }): Promise<Response> {
  const copy = copyOfPageHost(new URL(request.url).hostname);
  if (!copy) return answer({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return answer({ error: 'method_not_allowed' }, 405);
  // A browser names the site of a request. Only the page of Madar itself may ask. A client with no header still needs the token below.
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return answer({ error: 'forbidden' }, 403);
  let person: boolean;
  try {
    person = await isPerson(request.headers.get('authorization'), copy, { supabase: () => deps.keySet(copy), own: () => deps.ownKeySet?.(copy, env) });
  } catch {
    return answer({ error: 'sign_in_check_failed' }, 503);
  }
  if (!person) return answer({ error: 'unauthenticated' }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return answer({ error: 'bad_link' }, 400);
  }
  const value = typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : undefined;
  const url = typeof value === 'string' && value.length <= 300 ? parse(value) : null;
  if (!url || !isShortLink(url)) return answer({ error: 'bad_link' }, 400);
  const long = await followShortLink(url.href, deps.fetch);
  return long ? answer({ url: long }, 200) : answer({ error: 'unreachable' }, 502);
}
