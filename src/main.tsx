import './app/zodConfig';
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
import { createAppRouter, screensAt } from './app/routes';
import { RuntimeProvider, createQueryClient, type Runtime } from './app/runtime';
import { loadScreen, prefetchScreens, preloadScreens } from './app/screens';
import { ToastProvider } from './app/toasts';
import { applyLanguage, initI18n } from './i18n';

/**
 * The runtime of this build (client map 8). The flag is fixed at build time, so each build keeps only its own branch: the
 * prototype page carries no Supabase code, and the real page carries no sample office and no handlers. Both branches load
 * their bootstrap with a dynamic import: a static import of the prototype bootstrap would keep the sample office in the real page.
 */
async function start(): Promise<{ runtime: Runtime; language: Language }> {
  // The flag itself, not REMOTE from mode.ts: the bundler folds this comparison and drops the other branch with its chunk.
  if (import.meta.env.VITE_MADAR_API === 'remote') {
    const { bootstrapRemote, browserLanguage } = await import('./app/remote/bootstrap');
    // The first screen opens in the saved language, else the browser's. AppearanceSync applies the person's own after the session.
    return { runtime: await bootstrapRemote(), language: browserLanguage() };
  }
  const { bootstrap, startScheduler } = await import('./app/bootstrap');
  const runtime = await bootstrap();
  const user = runtime.store.state.users[runtime.store.state.session.currentUserId];
  startScheduler(runtime.store);
  return { runtime, language: user?.preferences.language ?? 'en' };
}

/** True when this browser keeps a Supabase session (the storageKey of src/app/remote/supabase.ts). Blocked storage keeps none. */
function storedSession(): boolean {
  try {
    return window.localStorage.getItem('madar.auth') !== null;
  } catch {
    return false;
  }
}

/**
 * The remote build loads the screens of this address next to the bootstrap (performance audit BND-1), plus Sign in when the
 * address sits behind the gate and no session is stored. A failed import is no failure here: the route then imports the
 * screen itself, and reloads the page once if that fails too (src/app/screens.ts).
 */
function warmFirstScreens(pathname: string): Promise<unknown> {
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
  initI18n(language);
  applyLanguage(document.documentElement, language);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: REMOTE })}>
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <AppearanceSync />
            <RouterProvider router={createAppRouter()} />
          </ToastProvider>
        </MotionConfig>
      </RuntimeProvider>
    </StrictMode>,
  );
  // The other screens load one at a time at idle, so a later screen change waits for no chunk (remote build only).
  if (REMOTE) prefetchScreens();
}

// www.<host> moves to <host> first (src/app/canonicalHost.ts), so nothing starts on the address that the person leaves.
const canonical = REMOTE ? canonicalUrl(window.location.href) : null;
if (canonical) window.location.replace(canonical);
else void main();
