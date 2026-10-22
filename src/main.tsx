import './app/zodConfig';
import './i18n/firstWords';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './design/tokens.css';
import type { Language } from './api/contract/entities';
import { AppearanceSync } from './app/AppearanceSync';
import { canonicalUrl } from './app/canonicalHost';
import { REMOTE } from './app/mode';
import { hasStoredSession } from './app/remote/authMode';
import { startHomeCache } from './app/remote/homeCache';
import { watchInstall } from './app/remote/install';
import { createAppRouter, screensAt } from './app/routes';
import { warmAtIdle, warmForAddress } from './app/overlays';
import { prefetchSkip } from './app/prefetchRules';
import { RuntimeProvider, createQueryClient, type Runtime } from './app/runtime';
import { loadScreen, prefetchScreens, preloadScreens } from './app/screens';
import { ToastProvider } from './app/toasts';
import { applyLanguage, initI18n, loadWords } from './i18n';
import { browserLanguage } from './i18n/firstLanguage';
import { loadOtherLanguageLater } from './i18n/otherLanguage';

/**
 * The runtime of this build (client map 8). The flag is fixed at build time, so each build keeps only its own branch: the
 * prototype page carries no Supabase code, and the real page carries no sample office and no handlers. Both branches load
 * their bootstrap with a dynamic import: a static import of the prototype bootstrap would keep the sample office in the real page.
 */
async function start(): Promise<{ runtime: Runtime; language: Language }> {
  // The flag itself, not REMOTE from mode.ts: the bundler folds this comparison and drops the other branch with its chunk.
  if (import.meta.env.VITE_MADAR_API === 'remote') {
    const { bootstrapRemote } = await import('./app/remote/bootstrap');
    // The first screen opens in the saved language, else the browser's. AppearanceSync applies the person's own after the session.
    return { runtime: await bootstrapRemote(), language: browserLanguage() };
  }
  const { bootstrap, startScheduler } = await import('./app/bootstrap');
  const runtime = await bootstrap();
  const user = runtime.store.state.users[runtime.store.state.session.currentUserId];
  startScheduler(runtime.store, runtime.api);
  return { runtime, language: user?.preferences.language ?? 'en' };
}

/** True when this browser keeps a session of the sign-in of this build (supabase or madar, VITE_MADAR_AUTH). Blocked storage keeps none. */
function storedSession(): boolean {
  return hasStoredSession(import.meta.env, () => window.localStorage);
}

/**
 * The remote build loads the screens of this address next to the bootstrap (performance audit BND-1), plus Sign in when the
 * address sits behind the gate and no session is stored. A failed import is no failure here: the route then imports the
 * screen itself, and reloads the page once if that fails too (src/app/screens.ts).
 */
function warmFirstScreens(pathname: string): Promise<unknown> {
  // A push link opens Home with ?task=: the task panel loads next to the first screens (performance audit 2026-10-21, FL-1).
  warmForAddress(pathname, window.location.search);
  const { screens, gated } = screensAt(pathname);
  const names = gated && !storedSession() ? [...screens, 'signIn' as const] : screens;
  return Promise.all(names.map((name) => loadScreen(name).catch(() => undefined)));
}

async function main(): Promise<void> {
  const pathname = window.location.pathname;
  // The prototype loads every screen from its one script file before the router, so it starts as before.
  const [{ runtime, language }] = await Promise.all([start(), REMOTE ? warmFirstScreens(pathname) : preloadScreens()]);
  // A stored session that did not renew sends the person to Sign in, so that screen loads before the first frame too.
  if (REMOTE && runtime.auth?.status() === 'signed_out' && screensAt(pathname).gated) await loadScreen('signIn').catch(() => undefined);
  // The words of one language (performance audit BND-7). The remote build started this load with the first script
  // (i18n/firstWords.ts), and the prototype holds its words in its one script file.
  await loadWords(language);
  initI18n(language);
  applyLanguage(document.documentElement, language);
  const queryClient = createQueryClient({ remote: REMOTE });
  // The last Home lists of this person show at once while the fresh ones load (performance audit 2026-10-21, DF-14). It starts next
  // to the first request, never before it, and the real build only: the prototype stores nothing.
  if (REMOTE) startHomeCache({ queryClient, runtime, build: import.meta.env.VITE_MADAR_BUILD?.trim() || '0' });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RuntimeProvider runtime={runtime} queryClient={queryClient}>
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <AppearanceSync />
            <RouterProvider router={createAppRouter()} />
          </ToastProvider>
        </MotionConfig>
      </RuntimeProvider>
    </StrictMode>,
  );
  // The other language loads after the first reads of the screen settled, plus a quiet gap of 3 s (performance audit 2026-10-21,
  // FL-7), so a person who never switches language does not pay for it at the start. A switch before that waits for its words
  // (`withWords`). The prototype holds both languages in its one script file, so it loads at once as before.
  if (REMOTE) loadOtherLanguageLater({ queryClient, language });
  else void loadWords(language === 'ar' ? 'en' : 'ar').catch(() => undefined);
  // The other screens load one at a time at idle, so a later screen change waits for no chunk (remote build only).
  if (REMOTE) {
    // The sign-in screens stay out for a stored session, and Admin for a person who cannot open it (performance audit 2026-10-21, FL-8).
    prefetchScreens(undefined, undefined, prefetchSkip({ storedSession: storedSession(), session: () => queryClient.getQueryData(['api', 'session.get', {}]) }));
    // The task panel, Focus mode, the feedback sheet and the sheet of an ended session load in their own chunks (FL-1, FL-4).
    warmAtIdle();
  }
}

// www.<host> moves to <host> first (src/app/canonicalHost.ts), so nothing starts on the address that the person leaves.
const canonical = REMOTE ? canonicalUrl(window.location.href) : null;
if (canonical) window.location.replace(canonical);
else {
  // Chrome on Android can send its install event before the first screen, so the page listens from the start (owner, 2026-10-20).
  if (REMOTE) watchInstall();
  void main();
}
