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

/**
 * Sign out on this device (plan 5.1, client map 7.3): end the session (the Supabase port also closes the Realtime channels), drop
 * every list of the person from the cache and every unsent word in this tab, then go to Sign in with the reason. After this the
 * next person in the tab cannot see the lists or the drafts of the person before.
 */
export function useSignOut(): (reason?: 'signed_out' | 'expired' | 'account_off') => Promise<void> {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async (reason = 'signed_out') => {
    leaving = true;
    try {
      // The session is gone on this device even when the server does not answer.
      await auth.signOut().catch(() => undefined);
      queryClient.clear();
      keepDraftsOf('');
      await navigate(signInPath({ reason }), { replace: true });
    } finally {
      leaving = false;
    }
  }, [auth, queryClient, navigate]);
}
