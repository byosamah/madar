import type { AdminReach } from '../../api/contract/entities';

const KEY = 'madar.homeRole.';
const REACHES: readonly AdminReach[] = ['mine', 'mixed', 'all'];

/** What this device saw last for one auth user: the system role, and for an Admin the "What reaches me" choice. */
export type Hint = { role: string | null; reach: AdminReach };

/**
 * The system role that this device saw last for one auth user (performance audit 2026-10-07, FET-8). Home asks for the project
 * list of that role before session.get answers. It is only a hint: the session answer always picks the list on screen, and every
 * role may read both lists. Blocked storage gives no hint, and Home asks as before.
 * The text is the role, and for an Admin with a choice other than "mixed" also "|" and the choice (owner, 2026-10-26, fbk_065: "Only my
 * work" changes the project lists, so the first request needs it). The old text "admin" means "mixed".
 */
export function readHint(authUserId: string | null): Hint {
  const none: Hint = { role: null, reach: 'mixed' };
  if (!authUserId) return none;
  try {
    const text = window.localStorage.getItem(`${KEY}${authUserId}`);
    if (!text) return none;
    const [role, reach] = text.split('|');
    return { role: role || null, reach: REACHES.find((choice) => choice === reach) ?? 'mixed' };
  } catch {
    return none;
  }
}

export function readRoleHint(authUserId: string | null): string | null {
  return readHint(authUserId).role;
}

export function writeRoleHint(authUserId: string, role: string, reach: AdminReach = 'mixed'): void {
  try {
    window.localStorage.setItem(`${KEY}${authUserId}`, role === 'admin' && reach !== 'mixed' ? `${role}|${reach}` : role);
  } catch {
    // Storage is blocked. The next start asks as with no hint.
  }
}
