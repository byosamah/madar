import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ApiError } from '../../api/errors';
import { signInPath } from './paths';
import { SessionExpiredSheet } from './SessionExpiredSheet';
import { isLeaving, useSignOut } from './signOut';
import { useAuth } from './useAuth';

const unauthenticated = (error: unknown): error is ApiError => error instanceof ApiError && error.code === 'unauthenticated';

/**
 * The layout route around the shell and the meeting view in the remote build (plan 5.1, client map 7.3). With no session it
 * goes to Sign in with the link to come back to. When the session ends later, or a call says so after the API's one refresh,
 * it opens the session sheet over the screen, so the screen and its drafts stay. It mounts that sheet once for both places.
 * A person whose account was turned off goes to Sign in with that reason.
 */
export function AuthGate() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const signOut = useSignOut();
  const [entered] = useState(() => auth.status() === 'signed_in');
  const [expired, setExpired] = useState(false);

  useEffect(() => auth.subscribe((status) => {
    // The listener runs at once when the status changes, so a sign-out of this person is still marked as one.
    if (status === 'signed_out' && !isLeaving()) setExpired(true);
  }), [auth]);

  useEffect(() => {
    const seen = (error: unknown) => {
      if (!unauthenticated(error) || isLeaving()) return;
      if (error.details.reason === 'account_off') void signOut('account_off');
      else setExpired(true);
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
      <SessionExpiredSheet
        open={expired}
        onSignedIn={() => {
          setExpired(false);
          // The lists that failed while the session was gone load again. A failed change keeps the Retry of its toast.
          void queryClient.invalidateQueries({ queryKey: ['api'] });
        }}
      />
    </>
  );
}
