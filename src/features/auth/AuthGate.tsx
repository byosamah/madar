import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ApiError } from '../../api/errors';
import { useOnceOn } from '../../app/lazyOverlay';
import { LazySessionExpiredSheet } from '../../app/overlays';
import { clearHomeCache } from '../../app/remote/homeCache';
import { useCall } from '../../app/runtime';
import { LANGUAGE_KEY } from './AuthPage';
import { signInPath } from './paths';
import type { SessionChange } from './sessionEnd';
import { isLeaving, useLeaveScreen, useSignOut } from './signOut';
import { useAuth } from './useAuth';

const unauthenticated = (error: unknown): error is ApiError => error instanceof ApiError && error.code === 'unauthenticated';

/**
 * The layout route around the shell and the meeting view in the remote build (plan 5.1, client map 7.3). With no session it
 * goes to Sign in with the link to come back to. When the session ends later, or a call says so after the API's one refresh,
 * it opens the session sheet over the screen, so the screen and its drafts stay. It mounts that sheet once for both places.
 * A person whose account was turned off goes to Sign in with that reason. A sign-out on purpose, or a sign-in of another person,
 * in another tab of the browser is not an ended session: the screen, the lists and the drafts go, as at a sign-out here.
 */
export function AuthGate() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const signOut = useSignOut();
  const leave = useLeaveScreen();
  const [entered] = useState(() => auth.status() === 'signed_in');
  const [expired, setExpired] = useState(false);
  // The sheet loads in its own chunk (FL-4): it mounts when the session first ends, and stays so its closing animation stays.
  const expiredMounted = useOnceOn(expired);
  const language = useCall('session.get', {}, { enabled: entered }).data?.user.preferences.language;

  // The Sign in screen of the next cold start opens in the language of the last person (client map 7.4).
  useEffect(() => {
    if (!language) return;
    try { window.localStorage.setItem(LANGUAGE_KEY, language); } catch { /* blocked storage */ }
  }, [language]);

  useEffect(() => auth.subscribe((status, change?: SessionChange) => {
    // The listener runs at once when the status changes, so a sign-out in this tab is still marked as one.
    if (isLeaving()) return;
    if (change === 'left' || change === 'person') void leave('signed_out');
    else if (status === 'signed_out') {
      // The session ended: the last Home lists of this person leave the device too (DF-14).
      void clearHomeCache();
      setExpired(true);
    }
  }), [auth, leave]);

  useEffect(() => {
    const seen = (error: unknown) => {
      // A call that went with no session (no_session) is not the end of this session: it comes from before the sign-in, or
      // the sign-in status has already said signed out, and the listener above opens the sheet for that.
      if (!unauthenticated(error) || isLeaving() || error.details.reason === 'no_session') return;
      if (error.details.reason === 'account_off') void signOut('account_off');
      else {
        void clearHomeCache();
        setExpired(true);
      }
    };
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') seen(event.action.error);
    });
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') seen(event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient, signOut]);

  if (!entered) return <Navigate to={signInPath({ next: `${location.pathname}${location.search}` })} replace />;
  return (
    <>
      <Outlet />
      {expiredMounted && <LazySessionExpiredSheet
        open={expired}
        onSignedIn={() => {
          setExpired(false);
          // The lists that failed while the session was gone load again. A change that failed keeps its toast, and canRetry
          // (src/app/errors.ts) decides whether that toast offers Retry.
          void queryClient.invalidateQueries({ queryKey: ['api'] });
        }}
      />}
    </>
  );
}
