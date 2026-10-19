import type { Deps } from '../core/ports';
import type { RouteDef } from '../http/routes';
import { googleKeysOf } from './keys';
import { readState } from './state';

/**
 * GET /api/google/callback (fbk_022, owner 2026-10-19): the address that Google sends the person back to, with ?code=&state=.
 *
 * The route has no sign-in, so it cannot tell which browser finished the Google screen. A planted or stolen link could then join the
 * wrong Google account to the wrong person. So the route does not swap the code. It reads nothing from the database and writes
 * nothing. It checks the signed state, and answers 302 to the Settings screen with one word in the address fragment (the part after #,
 * which a browser never sends to a server and keeps out of Referer). The signed-in screen then calls google.connect, and the server
 * swaps the code inside runCall, bound to that session.
 *
 * The words: denied (Google sent an error), not_ready (this copy has no Google values), failed (no code, no state, or a state that is
 * not true), old (a true state past 10 minutes), finish (the code and the state follow in the fragment).
 * The log gets the word only, never the query.
 */

export const GOOGLE_CALLBACK_PATH = '/google/callback';

/** The longest code and state that google.connect takes (src/api/contract/server.ts). A longer value is not from Google. */
const MAX_CODE = 512;
const MAX_STATE = 1024;

async function wordOf(url: URL, deps: Deps): Promise<{ word: 'denied' | 'not_ready' | 'failed' | 'old' } | { word: 'finish'; code: string; state: string }> {
  if (url.searchParams.has('error')) return { word: 'denied' };
  if (!deps.config.google) return { word: 'not_ready' };
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || code.length > MAX_CODE || state.length > MAX_STATE) return { word: 'failed' };
  const read = await readState(await googleKeysOf(deps.config.google.key), state, deps.clock.now());
  if (!read.ok) return { word: read.why === 'old' ? 'old' : 'failed' };
  return { word: 'finish', code, state };
}

/** The 302 to the Settings screen with the given fragment. Never cached, and the next page gets no Referer. */
export function callbackRedirect(appUrl: string, fragment: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${appUrl.replace(/\/+$/, '')}/settings#${fragment}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

export async function googleCallback(request: Request, deps: Deps): Promise<Response> {
  let found: Awaited<ReturnType<typeof wordOf>>;
  try {
    found = await wordOf(new URL(request.url), deps);
  } catch {
    found = { word: 'failed' };
  }
  deps.log.info('The Google callback ended.', { word: found.word });
  const fragment = found.word === 'finish' ? `google=finish&code=${encodeURIComponent(found.code)}&state=${encodeURIComponent(found.state)}` : `google=${found.word}`;
  return callbackRedirect(deps.config.appUrl, fragment);
}

export const GOOGLE_CALLBACK_ROUTE: RouteDef = { method: 'GET', path: GOOGLE_CALLBACK_PATH, handler: googleCallback };
