import { safeRedirect } from '../../../src/features/oauth/knownHosts';

/** The return addresses of the own OAuth server (Supabase exit, wave 2). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A return address a client may register: the rule of the consent screen (https, loopback http, an app scheme; no script scheme). */
export function registrable(uri: string): boolean {
  return uri.length <= 2000 && safeRedirect(uri);
}

/** The address of an authorize request is a registered one: exactly, or on loopback with any port (RFC 8252, section 7.3). */
export function redirectAllowed(registered: readonly string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let asked: URL;
  try {
    asked = new URL(uri);
  } catch {
    return false;
  }
  if (!LOOPBACK.has(asked.hostname)) return false;
  return registered.some((one) => {
    try {
      const known = new URL(one);
      return known.protocol === asked.protocol && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search;
    } catch {
      return false;
    }
  });
}

/** The address with these query values set; a null or absent value stays out. */
export function withQuery(base: string, values: Record<string, string | null | undefined>): string {
  const url = new URL(base);
  for (const [name, value] of Object.entries(values)) if (value !== null && value !== undefined) url.searchParams.set(name, value);
  return url.toString();
}
