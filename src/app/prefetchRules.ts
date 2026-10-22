import { opensAdminPage } from '../api/rights';
import type { Actor } from '../api/permissions';
import type { ScreenName } from './screens';

/**
 * The screens that the idle prefetch leaves out (performance audit 2026-10-21, FL-8). A person with a stored session needs no
 * sign-in screen, and a person who cannot open the Admin page needs no Admin chunk (30 KB gz). That is about 36 KB gz of data in
 * a cold session. Every other screen stays in the prefetch. A skipped screen loads at its first use, as before the prefetch
 * existed: an email link (welcome, forgot, reset, consent) loads its own screen with the first address, and the sheet of an ended
 * session sends the person to Sign in, which then loads once.
 */
export const SIGN_IN_SCREENS = ['signIn', 'welcome', 'forgot', 'reset', 'consent'] as const satisfies readonly ScreenName[];

export function prefetchSkip(o: {
  /** True when this browser keeps a session of the sign-in of this build (`hasStoredSession`). */
  storedSession: boolean;
  /** The cached `session.get` answer, or undefined while it has not come. An unknown session skips nothing. */
  session: () => { authority: Actor } | undefined;
}): (name: ScreenName) => boolean {
  return (name) => {
    if (o.storedSession && (SIGN_IN_SCREENS as readonly string[]).includes(name)) return true;
    if (name === 'admin') {
      const session = o.session();
      return session !== undefined && !opensAdminPage(session.authority);
    }
    return false;
  };
}
