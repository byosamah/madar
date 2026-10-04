import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Navigate, useSearchParams } from 'react-router';
import { ApiError } from '../../api/errors';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { AuthPage, FormError } from '../auth/AuthPage';
import { signInPath } from '../auth/paths';
import { useAuth } from '../auth/useAuth';
import { addressOf, needsWarning, safeRedirect } from './knownHosts';
import { OAuthFailure, useOAuth, type ConsentRequest } from './oauthPort';

/**
 * The agent consent screen at /oauth/consent?authorization_id= (plan 5.6; task G4). Supabase Auth sends the person here from the
 * authorize step of an AI app.
 *
 * - No session: Sign in first, with this address as the way back, so the authorization_id stays.
 * - A client that the person approved before: Auth gives the redirect at once (platform facts 6.3), and the screen goes back to
 *   the AI app with no new approval in Madar. A client that Madar has no approval for still links nothing (server/mcp/approval.ts).
 * - Else: the name of the AI app, the host its answer goes to, and what it may do, in plain words (proof.md G1, mitigation 3:
 *   it can use the account outside the Madar screens). A host that is not loopback and not a known AI app gets a plain warning,
 *   and Approve is then not the main button.
 * - Approve: the approval is recorded in Madar first (the api function, the person's browser token), then Auth approves. When
 *   Madar refuses, Auth is never asked. Deny: Auth denies, and Madar records nothing.
 * - After Madar refuses Approve for an app that the person removed (agent_removed), Approve goes: a second press only repeats
 *   the refusal. The refusal words say how to connect the app again, and Deny stays as the way back to the AI app.
 * - The return address (security review of G4): the screen leaves only for a safe address (knownHosts.ts, safeRedirect), and
 *   after Approve or Deny only for the request's own address. A request whose address is not safe has no Approve.
 */
export function ConsentScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id')?.trim() ?? '';

  if (!authorizationId) {
    return (
      <AuthPage title={t('consent.generic')}>
        <p className="text-body text-ink-2">{t('consent.missing')}</p>
      </AuthPage>
    );
  }
  if (auth.status() !== 'signed_in') {
    const back = `/oauth/consent?${new URLSearchParams({ authorization_id: authorizationId }).toString()}`;
    return <Navigate to={signInPath({ next: back })} replace />;
  }
  return <Consent authorizationId={authorizationId} />;
}

/** The sentence of a failed step: Madar's own reason, or for Auth an ended request (gone, expired, already answered). */
function failureText(error: unknown, t: TFunction): string {
  if (error instanceof OAuthFailure && (error.status === 400 || error.status === 404)) return t('errors.reasons.authorization_ended');
  return errorMessage(error, t);
}

function Consent({ authorizationId }: { authorizationId: string }) {
  const { t } = useTranslation();
  const { port, leave } = useOAuth();
  const details = useQuery({
    queryKey: ['oauth', 'details', authorizationId],
    queryFn: () => port.details(authorizationId),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const done = details.data?.kind === 'done' ? details.data.redirectUrl : null;
  const doneSafe = done !== null && safeRedirect(done);

  useEffect(() => {
    if (done && doneSafe) leave(done);
  }, [done, doneSafe, leave]);

  if (details.isPending) {
    return (
      <AuthPage title={t('consent.generic')}>
        <p className="text-body text-ink-2" aria-live="polite">{t('consent.loading')}</p>
      </AuthPage>
    );
  }
  if (details.isError) {
    return (
      <AuthPage title={t('consent.generic')}>
        <FormError text={failureText(details.error, t)} />
        <Button className="self-start" onClick={() => void details.refetch()}>{t('common.retry')}</Button>
      </AuthPage>
    );
  }
  if (details.data.kind === 'done') {
    return (
      <AuthPage title={t('consent.generic')}>
        {doneSafe ? <p className="text-body text-ink-2" aria-live="polite">{t('consent.leaving')}</p> : <FormError text={t('consent.badAddress')} />}
      </AuthPage>
    );
  }
  return <Decide request={details.data.request} leave={leave} />;
}

function Decide({ request, leave }: { request: ConsentRequest; leave: (url: string) => void }) {
  const { t } = useTranslation();
  const { port } = useOAuth();
  const person = useCall('session.get', {}).data?.user.name;
  const [pending, setPending] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Madar refused Approve for an app that the person removed (TASKS.md, Wave 5 follow-ups, G calm screen).
  const [removed, setRemoved] = useState(false);
  const name = request.clientName || t('consent.generic');
  // The host is Latin text inside an Arabic sentence too: the isolate marks keep it one unit, apart from the words around it.
  const host = `\u2068${addressOf(request.redirectUri)}\u2069`;
  const warn = needsWarning(request.redirectUri);
  const unsafe = !safeRedirect(request.redirectUri);

  const answer = async (choice: 'approve' | 'deny') => {
    setPending(choice);
    setError(null);
    try {
      if (choice === 'approve') await port.recordApproval(request.authorizationId);
      const redirect = choice === 'approve' ? await port.approve(request.authorizationId) : await port.deny(request.authorizationId);
      // Only back to the request's own address, and only to a safe one (security review of G4).
      if (!safeRedirect(redirect) || !redirect.startsWith(request.redirectUri)) {
        setError(t('consent.badAddress'));
        setPending(null);
        return;
      }
      leave(redirect);
    } catch (failure) {
      if (failure instanceof ApiError && failure.details.reason === 'agent_removed') setRemoved(true);
      setError(failureText(failure, t));
      setPending(null);
    }
  };

  return (
    <AuthPage title={request.clientName ? t('consent.title', { name: request.clientName }) : t('consent.generic')}>
      {person && <p className="text-footnote text-ink-2">{t('consent.signedInAs', { name: person })}</p>}
      {/* An address that Madar would never leave for gets the plain error in place of the warning, and no Approve. */}
      {unsafe ? <FormError text={t('consent.badAddress')} /> : warn && (
        <p className="rounded-xl bg-late-bg p-3 text-subheadline text-late">
          {t('consent.unknownHost', { host })}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-body font-semibold text-ink">{t('consent.mayTitle', { name })}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink-2">
          <li>{t('consent.rights')}</li>
          <li>{t('consent.history')}</li>
          <li>{t('consent.account')}</li>
          <li>{t('consent.remove')}</li>
        </ul>
      </div>
      <p className="text-footnote text-ink-2">
        {t('consent.returnsTo', { host })}
      </p>
      {!unsafe && <FormError text={error} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* An unknown host takes away the main button, so the warning stays the one colored highlight. */}
        {!removed && <Button variant={warn ? 'secondary' : 'primary'} className="flex-1" disabled={pending !== null || unsafe} onClick={() => void answer('approve')}>{t('consent.approve')}</Button>}
        <Button className="flex-1" disabled={pending !== null} onClick={() => void answer('deny')}>{t('consent.deny')}</Button>
      </div>
    </AuthPage>
  );
}
