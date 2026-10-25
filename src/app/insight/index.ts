import type { QueryClient } from '@tanstack/react-query';
import { insightEnv } from '../../lib/insightEnv';
import type { AuthPort } from '../auth';
import { screensAt, type createAppRouter } from '../routes';
import { setInsightClient, type InsightClient, type InsightPerson } from './notes';

export { noteSheet, noteSlow, reportError } from './notes';
export type { InsightClient, InsightPerson, SheetName, SheetStep } from './notes';

/**
 * Usage data and errors for the owner (insight design, 2026-10-25). This file is in the first load of the real build, so it holds no
 * PostHog code: the lazy `client.ts` imports the library. Nothing here may throw, wait, or show anything to the team.
 */
export type AppRouter = ReturnType<typeof createAppRouter>;

/** The person of the signed-in session, read from the cached `session.get` answer. Null while the answer has not come. */
function personOf(queryClient: QueryClient): InsightPerson | null {
  const session = queryClient.getQueryData<{ user?: { id?: unknown; name?: unknown } }>(['api', 'session.get', {}]);
  const { id, name } = session?.user ?? {};
  return typeof id === 'string' && typeof name === 'string' && name !== '' ? { id, name } : null;
}

/**
 * Starts the watchers after the first screen showed its data (called from the idle step of `startIdlePrefetch`). It starts only in the
 * real build, with the public key, for a signed-in person on an address behind the sign-in gate. A sign-out stops it and resets
 * PostHog; the next sign-in starts it again for the new person. A failed import or a failed start stays quiet and never reloads the page.
 */
export function startInsight(o: { queryClient: QueryClient; auth: AuthPort | undefined; router: AppRouter }): void {
  try {
    // The flag itself, not REMOTE from mode.ts: the bundler folds this comparison, so the prototype build drops the import and its chunk.
    if (import.meta.env.VITE_MADAR_API === 'remote') {
      const key = (import.meta.env.VITE_POSTHOG_KEY ?? '').trim();
      const { queryClient, auth, router } = o;
      if (key === '' || !auth) return;
      const build = import.meta.env.VITE_MADAR_BUILD?.trim() || '0';
      let client: InsightClient | null = null;
      let loading = false;
      let failed = false;
      const wanted = () => {
        try {
          return auth.status() === 'signed_in' && screensAt(router.state.location.pathname, true).gated;
        } catch {
          return false;
        }
      };
      const begin = () => {
        if (client || loading || failed || !wanted()) return;
        loading = true;
        import('./client')
          .then(({ createInsightClient }) => {
            loading = false;
            // The person may have signed out while the chunk loaded.
            if (client || !wanted()) return;
            try {
              client = createInsightClient({ key, env: insightEnv(window.location.hostname), build, person: () => personOf(queryClient), queryClient, router });
              setInsightClient(client);
            } catch {
              failed = true;
            }
          })
          .catch(() => {
            loading = false;
            failed = true;
          });
      };
      const end = () => {
        const stopped = client;
        client = null;
        setInsightClient(null);
        try {
          stopped?.stop();
        } catch {
          // A stop that fails leaves nothing to clean.
        }
      };
      auth.subscribe((status) => {
        if (status === 'signed_out') {
          end();
          failed = false;
        } else begin();
      });
      // A signed-in person who stands on a sign-in screen starts when the first gated address shows.
      router.subscribe(() => begin());
      begin();
    }
  } catch {
    // PostHog is never allowed to break Madar.
  }
}
