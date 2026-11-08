import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';
import { COPY_HOSTS, SERVER_HOST_SETTING, serverHostOf, type Copy, type ServerHostSetting } from '../core/serverHost';
import { bindingOf, INTERNAL_ORIGIN, type PagesEnv, type ServiceBinding } from './pagesForward';

/**
 * The own key set for a Pages Function (plan A of Madar enterprises). A copy on the office object signs its tokens with its own key
 * (server/auth/ownKeys.ts), and a Pages Function holds no secret. So it asks the Worker of the copy for the public key set through
 * the service binding, keeps the set for 10 minutes, and asks again at most once in 30 seconds when a token names a key it does not
 * know (a key change). The Worker answers the set at `GET /api/auth/jwks` with no sign-in (server/auth/own/routes.ts).
 *
 * A set that does not load throws a plain Error, never a jose error: the caller answers 503, and an outage is no refusal of a token.
 */

export const OWN_KEYS_PATH = '/api/auth/jwks';
/** How long a loaded key set stays. */
export const OWN_KEYS_TTL_MS = 10 * 60_000;
/** The shortest time between two loads that an unknown key id causes. */
export const OWN_KEYS_RELOAD_MS = 30_000;

type Loaded = { at: number; set: JWTVerifyGetKey };

async function loadKeys(binding: ServiceBinding): Promise<JSONWebKeySet> {
  let body: unknown;
  try {
    const response = await binding.fetch(new Request(`${INTERNAL_ORIGIN}${OWN_KEYS_PATH}`, { method: 'GET', headers: { accept: 'application/json' } }));
    if (response.status !== 200) throw new Error('The answer was not 200.');
    body = await response.json();
  } catch {
    throw new Error('The own key set of the Worker did not load.');
  }
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.some((key) => key === null || typeof key !== 'object')) throw new Error('The own key set of the Worker is not a key set.');
  return { keys: keys as JSONWebKeySet['keys'] };
}

/** The key set of the Worker behind a binding: a function for jwtVerify. */
export function ownKeySetOfBinding(binding: ServiceBinding, o: { now?: () => number } = {}): JWTVerifyGetKey {
  const now = o.now ?? (() => Date.now());
  let held: Loaded | undefined;
  let loading: Promise<Loaded> | undefined;

  /** One load at a time: callers that meet a load in progress wait for the same one. */
  function load(): Promise<Loaded> {
    loading ??= loadKeys(binding)
      .then((jwks) => (held = { at: now(), set: createLocalJWKSet(jwks) }))
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }

  return async (header, token) => {
    let current = held && now() - held.at < OWN_KEYS_TTL_MS ? held : await load();
    try {
      return await current.set(header, token);
    } catch (error) {
      // An unknown key id: the Worker may have a new key. Ask again, but not more than once in 30 seconds.
      if (!(error instanceof errors.JWKSNoMatchingKey) || now() - current.at < OWN_KEYS_RELOAD_MS) throw error;
      current = await load();
      return current.set(header, token);
    }
  };
}

const made = new Map<Copy, { binding: ServiceBinding; set: JWTVerifyGetKey }>();

/**
 * The key set of the own tokens of a copy, or undefined: only for a copy whose setting is office, and only with its binding.
 * The set is kept for each copy and binding.
 */
export function ownKeySetFor(copy: Copy, env: PagesEnv, setting: ServerHostSetting = SERVER_HOST_SETTING): JWTVerifyGetKey | undefined {
  if (serverHostOf(copy, setting) !== 'office') return undefined;
  const binding = bindingOf(env, COPY_HOSTS[copy].workers.binding);
  if (!binding) return undefined;
  const kept = made.get(copy);
  if (kept && kept.binding === binding) return kept.set;
  const set = ownKeySetOfBinding(binding);
  made.set(copy, { binding, set });
  return set;
}
