import { ApiError } from '../api/errors';
import type { ReactElement } from 'react';
import { onTestFinished } from 'vitest';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { memoryPersister } from '../api/persist';
import { Store, type State } from '../api/store';
import { buildSeed } from '../data/seed';
import { sampleOffice } from '../data/sampleOffice';
import { AppearanceSync } from '../app/AppearanceSync';
import { createAppRouter } from '../app/routes';
import type { LivePort } from '../app/live/types';
import { RuntimeProvider, createQueryClient } from '../app/runtime';
import { preloadScreens } from '../app/screens';
import { loadChecklistLayer } from '../features/project/tasks/checklistLayerLoader';
import { loadDragLayer } from '../features/project/tasks/dragLayerLoader';
import { ToastProvider } from '../app/toasts';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from './factories';

// The screens load on demand (src/app/screens.ts). The tests load all of them once, so each router starts with every screen,
// as the prototype does.
await preloadScreens();
// The drag layer of the sortable task lists is a chunk of its own (RN-5, FL-2). The tests load it once, so each list starts with the grips live.
await loadDragLayer();
await loadChecklistLayer();

/** Renders the whole app over the sample office, at a hash route, with no latency. "prepare" may change the office first. */
/** failFirst makes the first call of that name fail, as the "Simulate errors" switch can. */
export async function renderApp(path = '/', prepare?: (state: State) => void, options: { latencyMs?: number; failFirst?: string | ((name: string, input: unknown) => boolean); live?: LivePort } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: options.latencyMs ?? 0, sampleOffice });
  if (options.failFirst) {
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: unknown) => {
      const matches = typeof options.failFirst === 'function' ? options.failFirst(name, input) : name === options.failFirst;
      if (matches && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
  }
  initI18n('en');
  // replaceState queues no popstate. A set of location.hash did, and the late popstate mounted the route a second time (audit 2026-10-03, V-8).
  window.history.replaceState(null, '', `#${path}`);
  const router = createAppRouter();
  onTestFinished(() => router.dispose());
  const queryClient = createQueryClient();
  const view = render(
    <RuntimeProvider runtime={{ store, api, ...(options.live ? { live: options.live } : {}) }} queryClient={queryClient}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api, router, queryClient };
}

/** Renders one component with the API, the toasts and the sample office, for hook tests. */
export async function renderWithRuntime(ui: ReactElement, prepare?: (state: State) => void, options: { failureRate?: () => number; path?: string; live?: LivePort } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0, failureRate: options.failureRate, sampleOffice });
  initI18n('en');
  const content = options.path === undefined
    ? ui
    : <RouterProvider router={createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [options.path] })} />;
  const view = render(
    <RuntimeProvider runtime={{ store, api, ...(options.live ? { live: options.live } : {}) }} queryClient={createQueryClient()}>
      <ToastProvider>{content}</ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api };
}
