import { render } from '@testing-library/react';
import { onTestFinished } from 'vitest';
import { RouterProvider, createMemoryRouter, useLocation, type RouteObject } from 'react-router';
import { calls } from '../../api/calls';
import { createApi } from '../../api/client';
import { memoryPersister } from '../../api/persist';
import { Store, type State } from '../../api/store';
import { RuntimeProvider, createQueryClient } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { buildSeed } from '../../data/seed';
import { applyLanguage, initI18n } from '../../i18n';
import { setNow } from '../../lib/dates';
import { NOW, TODAY } from '../../test/factories';
import type { Language } from '../../api/contract/entities';
import type { FakeAuth } from './fakeAuth';
import { ForgotScreen } from './ForgotScreen';
import { ResetScreen } from './ResetScreen';
import { SignInScreen } from './SignInScreen';
import { WelcomeScreen } from './WelcomeScreen';

/** Shows where the router went, for the tests of a screen that moves on. */
function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

export const AUTH_ROUTES: RouteObject[] = [
  { path: '/sign-in', element: <SignInScreen /> },
  { path: '/welcome', element: <WelcomeScreen /> },
  { path: '/forgot', element: <ForgotScreen /> },
  { path: '/reset', element: <ResetScreen /> },
  { path: '*', element: <Where /> },
];

/** The phone width of the calm checks: 390 px, so useIsPhone and the sheets take their phone shape. */
export function atPhoneWidth(): void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('max-width: 639px') || original(query).matches })) as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  onTestFinished(() => {
    window.matchMedia = original;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });
}

/** Renders the sign-in screens over the sample office, with a fake sign-in port and no shell. */
export async function renderAuth(path: string, o: { auth: FakeAuth; language?: Language; routes?: RouteObject[]; prepare?: (state: State) => void }) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  o.prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  const language = o.language ?? 'en';
  initI18n(language);
  applyLanguage(document.documentElement, language);
  const router = createMemoryRouter(o.routes ?? AUTH_ROUTES, { initialEntries: [path] });
  onTestFinished(() => router.dispose());
  const queryClient = createQueryClient();
  const view = render(
    <RuntimeProvider runtime={{ store, api, auth: o.auth, mode: 'remote' }} queryClient={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api, router, queryClient };
}
