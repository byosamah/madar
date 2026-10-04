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
import { REMOTE } from './app/mode';
import { createAppRouter } from './app/routes';
import { RuntimeProvider, createQueryClient, type Runtime } from './app/runtime';
import { ToastProvider } from './app/toasts';
import { initI18n } from './i18n';

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

async function main(): Promise<void> {
  const { runtime, language } = await start();
  initI18n(language);
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
}

void main();
