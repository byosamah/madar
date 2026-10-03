/** The screens that open with no session (plan U2). The agent consent screen belongs to track G but is public too. */
export const PUBLIC_PATHS = ['/sign-in', '/welcome', '/forgot', '/reset', '/oauth/consent'] as const;

/**
 * Where to go after sign-in. Only a path inside Madar counts, never another site ("//host" or "/\host") and never a sign-in
 * screen again; anything else goes Home.
 */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  const path = value.split(/[?#]/)[0];
  return (PUBLIC_PATHS as readonly string[]).includes(path) ? '/' : value;
}

/** The sign-in link that brings the person back to this place. */
export function signInPath(o: { next?: string; reason?: 'signed_out' | 'expired' | 'account_off' } = {}): string {
  const params = new URLSearchParams();
  if (o.next && safeNext(o.next) !== '/') params.set('next', o.next);
  if (o.reason) params.set('reason', o.reason);
  const query = params.toString();
  return query ? `/sign-in?${query}` : '/sign-in';
}
