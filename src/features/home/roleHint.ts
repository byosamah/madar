const KEY = 'madar.homeRole.';

/**
 * The system role that this device saw last for one auth user (performance audit 2026-10-07, FET-8). Home asks for the project
 * list of that role before session.get answers. It is only a hint: the session answer always picks the list on screen, and every
 * role may read both lists. Blocked storage gives no hint, and Home asks as before.
 */
export function readRoleHint(authUserId: string | null): string | null {
  if (!authUserId) return null;
  try {
    return window.localStorage.getItem(`${KEY}${authUserId}`);
  } catch {
    return null;
  }
}

export function writeRoleHint(authUserId: string, role: string): void {
  try {
    window.localStorage.setItem(`${KEY}${authUserId}`, role);
  } catch {
    // Storage is blocked. The next start asks as with no hint.
  }
}
