import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '../design/tokens.css';
import { ToastProvider } from '../app/toasts';
import { createPlatformSite, createSessionStore } from './client';
import { PlatformApp } from './PlatformApp';
import { createSiteQueryClient } from './queryClient';
import { applyTheme, startTheme } from './theme';
import { initSiteI18n, startLanguage } from './words';

/**
 * The entry of the site Madar enterprises (design 12, D7), built by `npm run build:platform` from platform.html. It loads no company code: the
 * client, the sign-in screen, the page and its own words (src/platform/*). The API is the own /api of this page, which the Pages Function of
 * the project madar-platform hands to the Worker (functions-platform/).
 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

initSiteI18n(startLanguage());
applyTheme(startTheme());
const site = createPlatformSite({ base: '/api', build: import.meta.env.VITE_MADAR_BUILD?.trim() || '0', store: createSessionStore(storage()) });
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={createSiteQueryClient()}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <PlatformApp site={site} />
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
