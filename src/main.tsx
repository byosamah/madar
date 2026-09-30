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
import { AppearanceSync } from './app/AppearanceSync';
import { bootstrap, startScheduler } from './app/bootstrap';
import { createAppRouter } from './app/routes';
import { RuntimeProvider, createQueryClient } from './app/runtime';
import { ToastProvider } from './app/toasts';
import { initI18n } from './i18n';

async function main(): Promise<void> {
  const runtime = await bootstrap();
  const user = runtime.store.state.users[runtime.store.state.session.currentUserId];
  initI18n(user?.preferences.language ?? 'en');
  startScheduler(runtime.store);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RuntimeProvider runtime={runtime} queryClient={createQueryClient()}>
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
