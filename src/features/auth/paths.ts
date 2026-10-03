/** The sign-in screens: they open with no session, and a link after sign-in never goes back to one (plan U2). */
export const SIGN_IN_PATHS = ['/sign-in', '/welcome', '/forgot', '/reset'] as const;

/**
 * Where to go after sign-in. Only a path inside Madar counts, never another site ("//host" or "/\host") and never a sign-in
 * screen again; anything else goes Home. The agent consent screen (track G) counts: it sends a person with no session here
 * and gets them back after sign-in.
 */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  const path = value.split(/[?#]/)[0];
  return (SIGN_IN_PATHS as readonly string[]).includes(path) ? '/' : value;
}

/** The sign-in link that brings the person back to this place. */
export function signInPath(o: { next?: string; reason?: 'signed_out' | 'expired' | 'account_off' } = {}): string {
  const params = new URLSearchParams();
  if (o.next && safeNext(o.next) !== '/') params.set('next', o.next);
  if (o.reason) params.set('reason', o.reason);
  const query = params.toString();
  return query ? `/sign-in?${query}` : '/sign-in';
}
