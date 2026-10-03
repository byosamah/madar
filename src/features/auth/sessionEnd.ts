import type { AuthStatus } from '../../app/auth';

/**
 * Why the session changed, when the sign-in port knows it. Supabase tells every tab of the browser about a sign-in or a
 * sign-out in one of them, so a tab must tell these apart from a session that ended by itself:
 * - left: a person signed out on purpose, in this tab or in another one.
 * - person: another person signed in, in this tab or in another one, so this tab now sends the token of someone else.
 */
export type SessionChange = 'left' | 'person';

/** A listener of the port. The second argument is optional, so a listener that only reads the status still fits AuthPort. */
export type SessionListener = (status: AuthStatus, change?: SessionChange) => void;

// The mark of a sign-out on purpose. It sits in local storage, so the other tabs of the browser can read it.
export const LEAVING_KEY = 'madar.auth.leaving';

export function markLeaving(): void {
  try { window.localStorage.setItem(LEAVING_KEY, '1'); } catch { /* blocked storage */ }
}

export function clearLeaving(): void {
  try { window.localStorage.removeItem(LEAVING_KEY); } catch { /* blocked storage */ }
}

export function leftOnPurpose(): boolean {
  try { return window.localStorage.getItem(LEAVING_KEY) === '1'; } catch { return false; }
}
