import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { keepDraftsOf } from '../../app/drafts';
import { signInPath } from './paths';
import { useAuth } from './useAuth';

// True while a sign-out runs, so the gate does not read the end of the session as an expired one.
let leaving = false;

export function isLeaving(): boolean {
  return leaving;
}

type Reason = 'signed_out' | 'expired' | 'account_off';

/**
 * The steps after the session of the person ends in this tab: go to Sign in with the reason, then drop every answer of the
 * person from the cache and every unsent word in this tab. After this the next person in the tab cannot see the lists or the
 * drafts of the person before. The gate also runs these steps when the person signs out, or another person signs in, in another
 * tab of the browser.
 */
export function useLeaveScreen(): (reason: Reason) => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async (reason) => {
    leaving = true;
    try {
      // Leave the screen first, so its lists do not ask the server again with no session.
      await navigate(signInPath({ reason }), { replace: true });
      // Every answer of the person goes. A reset, not a clear: a list that stays mounted above the router (the language and
      // theme of AppearanceSync) keeps its link to the cache, so it loads the next person's answer after their sign-in.
      queryClient.getMutationCache().clear();
      void queryClient.resetQueries();
      keepDraftsOf('');
    } finally {
      leaving = false;
    }
  }, [queryClient, navigate]);
}

/**
 * Sign out on this device (plan 5.1, client map 7.3): end the session (the Supabase port also closes the Realtime channels), then
 * the steps of useLeaveScreen.
 */
export function useSignOut(): (reason?: Reason) => Promise<void> {
  const auth = useAuth();
  const leave = useLeaveScreen();
  return useCallback(async (reason = 'signed_out') => {
    leaving = true;
    try {
      // The session is gone on this device even when the server does not answer.
      await auth.signOut().catch(() => undefined);
    } finally {
      leaving = false;
    }
    await leave(reason);
  }, [auth, leave]);
}
