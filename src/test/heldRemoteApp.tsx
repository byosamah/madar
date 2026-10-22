import { render } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { onTestFinished } from 'vitest';
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { ApiError } from '../api/errors';
import { memoryPersister } from '../api/persist';
import { Store, type State } from '../api/store';
import { buildSeed } from '../data/seed';
import { sampleOffice } from '../data/sampleOffice';
import { AppearanceSync } from '../app/AppearanceSync';
import { createAppRouter } from '../app/routes';
import { preloadScreens } from '../app/screens';
import { loadDragLayer } from '../features/project/tasks/dragLayerLoader';
import { RuntimeProvider, createQueryClient, type ChangeSource } from '../app/runtime';
import { ToastProvider } from '../app/toasts';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from './factories';

// The routes start initialized only when their screens are loaded (performance audit BND-1), as in render.tsx.
await preloadScreens();
// The drag layer of the sortable task lists is a chunk of its own (RN-5, FL-2). The tests load it once, so each list starts with the grips live.
await loadDragLayer();

/** One call that the screens asked, with its input and the idempotency key it carried (a write of the real build; a retry carries the key of the failed attempt). */
export type Asked = { name: string; input: unknown; key?: string };

/** No change signals: a test of the start of the reads sees only the reads that the screens ask, no reload pass. */
const quiet: ChangeSource = { subscribe: () => () => undefined, status: () => 'open' };

/**
 * Renders the whole app over the sample office as the real build runs it (runtime mode remote, its query defaults), at a hash
 * route (performance audit 2026-10-07, FET-1, FET-2, LIV-1, FET-12, FET-M2). The API records every call. With hold, no answer
 * comes until the test calls release(), so a test sees which reads start before the first answer. fail makes each matching call
 * fail as a server error would.
 */
export async function renderHeldRemoteApp(path: string, prepare?: (state: State) => void, o: { hold?: boolean; fail?: (name: string, input: unknown) => boolean } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0, sampleOffice });
  const original = (api.call as (name: string, input: unknown, meta?: unknown) => Promise<unknown>).bind(api);
  const asked: Asked[] = [];
  let holding = o.hold ?? false;
  let held: Array<() => void> = [];
  api.call = ((name: string, input: unknown, meta?: unknown) => {
    asked.push({ name, input, key: (meta as { key?: string } | undefined)?.key });
    const answer = () => (o.fail?.(name, input) ? Promise.reject(new ApiError('failed', 'The call failed. Try again.')) : original(name, input, meta));
    if (!holding) return answer();
    return new Promise<unknown>((resolve, reject) => {
      held.push(() => {
        answer().then(resolve, reject);
      });
    });
  }) as typeof api.call;
  /** Lets every held answer and every later one come. */
  const release = () => {
    holding = false;
    const waiting = held;
    held = [];
    for (const go of waiting) go();
  };
  /** Holds every later answer until release() or releaseHeld(). */
  const hold = () => {
    holding = true;
  };
  /** Lets the held answers come and keeps holding the later ones. */
  const releaseHeld = () => {
    const waiting = held;
    held = [];
    for (const go of waiting) go();
  };
  initI18n('en');
  window.history.replaceState(null, '', `#${path}`);
  const router = createAppRouter();
  onTestFinished(() => router.dispose());
  const queryClient = createQueryClient({ remote: true });
  const view = render(
    <RuntimeProvider runtime={{ store, api, mode: 'remote', changes: quiet }} queryClient={queryClient}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  /** The calls of one name, in the order they were asked. */
  const callsOf = (name: string) => asked.filter((call) => call.name === name).map((call) => call.input);
  /** The idempotency keys of the calls of one name, in the order they were asked. */
  const keysOf = (name: string) => asked.filter((call) => call.name === name).map((call) => call.key);
  return { ...view, store, api, router, queryClient, asked, callsOf, keysOf, hold, release, releaseHeld };
}
