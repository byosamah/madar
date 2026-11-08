import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlatformSite } from './client';
import { EnterprisesScreen } from './EnterprisesScreen';
import { SignInScreen } from './SignInScreen';
import { SiteHeader } from './SiteHeader';
import { PlatformProvider } from './usePlatform';

/**
 * The whole site Madar enterprises (design 12, D7): the sign-in screen, or the page of the enterprises inside a small shell. There is no router: the
 * site has one page. The state of the session decides. When the session ends (sign out, a refused refresh, a turned-off account) the answers of the
 * last person leave the cache, so the next person sees none of them.
 */
export function PlatformApp({ site }: { site: PlatformSite }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const session = useSyncExternalStore(site.subscribe, site.session);
  const signedIn = session !== null;
  useEffect(() => {
    if (!signedIn) queryClient.clear();
  }, [signedIn, queryClient]);
  useEffect(() => {
    document.title = t('enterprises.title');
  }, [t, i18n.language]);

  if (!session) return <SignInScreen site={site} notice={site.notice()} />;
  return (
    <PlatformProvider api={site.api}>
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))] text-ink sm:pt-8">
        <SiteHeader onSignOut={() => void site.signOut()} />
        <main className="min-w-0 flex-1">
          <EnterprisesScreen />
        </main>
      </div>
    </PlatformProvider>
  );
}
