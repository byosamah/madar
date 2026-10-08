import { configure, render } from '@testing-library/react';
import { onTestFinished } from 'vitest';
import { RouterProvider, createMemoryRouter, useLocation, type RouteObject } from 'react-router';
import { calls } from '../../api/calls';
import { createApi } from '../../api/client';
import { memoryPersister } from '../../api/persist';
import { Store, type State } from '../../api/store';
import { RuntimeProvider, createQueryClient, type ChangeSource } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { buildSeed } from '../../data/seed';
import { applyLanguage, initI18n } from '../../i18n';
import { setNow } from '../../lib/dates';
import { NOW, TODAY } from '../../test/factories';
import type { Language } from '../../api/contract/entities';
import { ApiError } from '../../api/errors';
import { AppearanceSync } from '../../app/AppearanceSync';
import { appRoutes } from '../../app/routes';
import { preloadScreens } from '../../app/screens';
import { fakeAuth, type FakeAuth } from './fakeAuth';
import { ForgotScreen } from './ForgotScreen';
import { ResetScreen } from './ResetScreen';
import { SignInScreen } from './SignInScreen';
import { WelcomeScreen } from './WelcomeScreen';

// These tests sign in and out and load whole screens again. A busy test machine needs more than the default 1 s for a find.
configure({ asyncUtilTimeout: 5000 });

// The screens load on demand (src/app/screens.ts). The tests load all of them once, so each router starts with every screen.
await preloadScreens();

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

/** Two people of the sample office with a password, for the tests of the real screens. */
export const SAMPLE_ACCOUNTS = {
  hala: { email: 'hala.nasser@madar.test', password: 'hala-pass-01', userId: 'usr_001' },
  faisal: { email: 'faisal.al.harbi@madar.test', password: 'faisal-pass-02', userId: 'usr_002' },
} as const;

/**
 * Renders the routes of the remote build (path links, the sign-in gate) over the sample office, with the fake API and a fake
 * sign-in port. A sign-in makes that person the current one, as the server does when it reads the person from the token, and
 * with no session every call fails with "unauthenticated".
 * `refuse` makes every call fail with "unauthenticated" while it returns true (or with the error it returns), as the real server
 * does after a session ends.
 */
export async function renderRemoteApp(path: string, o: { signedInAs?: keyof typeof SAMPLE_ACCOUNTS | null; prepare?: (state: State) => void; refuse?: () => boolean | ApiError } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  o.prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  const signedInAs = o.signedInAs === undefined ? 'hala' : o.signedInAs;
  if (signedInAs) state.session.currentUserId = SAMPLE_ACCOUNTS[signedInAs].userId;
  const auth = fakeAuth({
    accounts: Object.values(SAMPLE_ACCOUNTS).map((account) => ({ ...account })),
    signedInAs: signedInAs ? SAMPLE_ACCOUNTS[signedInAs].email : undefined,
    onSignIn: (account) => { store.state.session.currentUserId = account.userId; },
  });
  // As the real server: no session, no answer.
  const original = api.call.bind(api);
  api.call = ((name: string, input: unknown, meta?: unknown) => {
    const refused = auth.status() === 'signed_out' || o.refuse?.();
    if (refused) return Promise.reject(refused === true ? new ApiError('unauthenticated', 'Sign in to continue.') : refused);
    return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
  }) as typeof api.call;
  initI18n('en');
  const router = createMemoryRouter(appRoutes(true), { initialEntries: [path] });
  onTestFinished(() => router.dispose());
  const queryClient = createQueryClient();
  const view = render(
    <RuntimeProvider runtime={{ store, api, auth, mode: 'remote' }} queryClient={queryClient}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api, auth, router, queryClient };
}

/** Renders the sign-in screens over the sample office, with a fake sign-in port and no shell. */
export async function renderAuth(path: string, o: {
  auth: FakeAuth;
  language?: Language;
  routes?: RouteObject[];
  prepare?: (state: State) => void;
  /** The change source of the runtime, for the connection banner. */
  changes?: ChangeSource;
  /** An answer in place of the fake API's, for a call the prototype answers in another way (for example users.invites). */
  answer?: (name: string, input: unknown) => unknown;
}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  o.prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  if (o.answer) {
    const original = api.call.bind(api);
    api.call = ((name: string, input: unknown, meta?: unknown) => {
      const given = o.answer?.(name, input);
      if (given !== undefined) return Promise.resolve(given);
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
  }
  const language = o.language ?? 'en';
  initI18n(language);
  applyLanguage(document.documentElement, language);
  const router = createMemoryRouter(o.routes ?? AUTH_ROUTES, { initialEntries: [path] });
  onTestFinished(() => router.dispose());
  const queryClient = createQueryClient();
  const view = render(
    <RuntimeProvider runtime={{ store, api, auth: o.auth, changes: o.changes, mode: 'remote' }} queryClient={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api, router, queryClient };
}
