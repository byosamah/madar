import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { TextField } from '../components/Fields';
import { FormError } from '../components/FormError';
import { ScreenTitle } from '../components/ScreenTitle';
import { PlatformSignInFailure, type PlatformSite, type SiteNotice } from './client';
import { SiteHeader } from './SiteHeader';

/** One sentence for each reason. A wrong email, a wrong password and a turned-off account give the same one, so no one learns which emails exist. */
function failureKey(error: unknown): string {
  if (!(error instanceof PlatformSignInFailure)) return 'platformSite.signIn.failed';
  switch (error.reason) {
    case 'wrong_credentials': return 'platformSite.signIn.wrong';
    case 'too_many': return 'platformSite.signIn.tooMany';
    case 'offline': return 'platformSite.signIn.offline';
    default: return 'platformSite.signIn.failed';
  }
}

/**
 * The only screen of the site before sign-in (design 12, D8). It signs in a platform account, never a person of a company: a company login fails here
 * with the same one sentence as a wrong password. The paused sentence of the companies is not here: a platform account has no company to pause.
 */
export function SignInScreen({ site, notice }: { site: PlatformSite; notice: SiteNotice }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await site.signIn(email, password);
    } catch (failure) {
      setError(t(failureKey(failure)));
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-ink sm:pt-16">
      <SiteHeader />
      <ScreenTitle title={t('platformSite.signIn.title')} />
      <div className="panel flex flex-col gap-4 p-5">
        {notice && <p role="status" className="text-subheadline text-ink-2">{t(notice === 'off' ? 'platformSite.signIn.off' : 'platformSite.signIn.ended')}</p>}
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <TextField id="platform-email" type="email" dir="ltr" autoComplete="username" label={t('platformSite.signIn.email')} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} />
          <TextField id="platform-password" type="password" dir="ltr" autoComplete="current-password" label={t('platformSite.signIn.password')} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          <FormError text={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={pending || !email.trim() || !password}>{t('platformSite.signIn.submit')}</Button>
        </form>
      </div>
    </main>
  );
}
