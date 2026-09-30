import type { ReactElement } from 'react';
import { onTestFinished } from 'vitest';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { memoryPersister } from '../api/persist';
import { Store, type State } from '../api/store';
import { buildSeed } from '../data/seed';
import { AppearanceSync } from '../app/AppearanceSync';
import { createAppRouter } from '../app/routes';
import { RuntimeProvider, createQueryClient } from '../app/runtime';
import { ToastProvider } from '../app/toasts';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from './factories';

/** Renders the whole app over the sample office, at a hash route, with no latency. "prepare" may change the office first. */
export async function renderApp(path = '/', prepare?: (state: State) => void) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  initI18n('en');
  window.location.hash = `#${path}`;
  const router = createAppRouter();
  onTestFinished(() => router.dispose());
  const view = render(
    <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api, router };
}

/** Renders one component with the API, the toasts and the sample office, for hook tests. */
export async function renderWithRuntime(ui: ReactElement, prepare?: (state: State) => void, options: { failureRate?: () => number; path?: string } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0, failureRate: options.failureRate });
  initI18n('en');
  const content = options.path === undefined
    ? ui
    : <RouterProvider router={createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [options.path] })} />;
  const view = render(
    <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
      <ToastProvider>{content}</ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api };
}
