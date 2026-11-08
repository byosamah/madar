import type { Deps } from '../core/ports';
import type { EnterpriseId } from '../enterprise/ids';
import type { RouteDef } from '../http/routes';
import { googleKeysOf } from './keys';
import { entOfState, readState } from './state';

/**
 * GET /api/google/callback (fbk_022, owner 2026-10-19): the address that Google sends the person back to, with ?code=&state=.
 *
 * The route has no sign-in, so it cannot tell which browser finished the Google screen. A planted or stolen link could then join the
 * wrong Google account to the wrong person. So the route does not swap the code. It reads nothing from the database and writes
 * nothing. It checks the signed state, and answers 302 to the Settings screen with one word in the address fragment (the part after #,
 * which a browser never sends to a server and keeps out of Referer). The signed-in screen then calls google.connect, and the server
 * swaps the code inside runCall, bound to that session.
 *
 * Madar enterprises (design 5.17): the state names its enterprise (the claim ent). The route reads the claim, accepts it only for an
 * enterprise that the Worker lists (o.listed, when the host has a list), derives the keys of that enterprise and checks the signature with
 * them. A state with no ent, an ent that is no id, an ent that is not listed and a state of another enterprise all end as failed, and an
 * unlisted ent derives no key.
 *
 * The words: denied (Google sent an error), not_ready (this copy has no Google values), failed (no code, no state, or a state that is
 * not true), old (a true state past 10 minutes), finish (the code and the state follow in the fragment).
 * The log gets the word only, never the query.
 */

export const GOOGLE_CALLBACK_PATH = '/google/callback';

/** The longest code and state that google.connect takes (src/api/contract/server.ts). A longer value is not from Google. */
const MAX_CODE = 512;
const MAX_STATE = 1024;

/** Says whether an enterprise id is in the list of the Worker. The host passes it; with none, any id of the right form goes on to the signature check. */
export type CallbackOptions = { listed?: (ent: EnterpriseId) => Promise<boolean> };

async function wordOf(url: URL, deps: Deps, o: CallbackOptions): Promise<{ word: 'denied' | 'not_ready' | 'failed' | 'old' } | { word: 'finish'; code: string; state: string }> {
  if (url.searchParams.has('error')) return { word: 'denied' };
  if (!deps.config.google) return { word: 'not_ready' };
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || code.length > MAX_CODE || state.length > MAX_STATE) return { word: 'failed' };
  const ent = entOfState(state);
  if (ent === null) return { word: 'failed' };
  if (o.listed && !(await o.listed(ent))) return { word: 'failed' };
  const read = await readState(await googleKeysOf(deps.config.google.key, ent), state, deps.clock.now());
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

export async function googleCallback(request: Request, deps: Deps, o: CallbackOptions = {}): Promise<Response> {
  let found: Awaited<ReturnType<typeof wordOf>>;
  try {
    found = await wordOf(new URL(request.url), deps, o);
  } catch {
    found = { word: 'failed' };
  }
  deps.log.info('The Google callback ended.', { word: found.word });
  const fragment = found.word === 'finish' ? `google=finish&code=${encodeURIComponent(found.code)}&state=${encodeURIComponent(found.state)}` : `google=${found.word}`;
  return callbackRedirect(deps.config.appUrl, fragment);
}

export const GOOGLE_CALLBACK_ROUTE: RouteDef = { method: 'GET', path: GOOGLE_CALLBACK_PATH, handler: googleCallback };
