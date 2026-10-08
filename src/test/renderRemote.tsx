import { render } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { onTestFinished } from 'vitest';
import type { CallName } from '../api/calls';
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { memoryPersister } from '../api/persist';
import { Store, type State } from '../api/store';
import { buildSeed } from '../data/seed';
import { sampleOffice } from '../data/sampleOffice';
import { AppearanceSync } from '../app/AppearanceSync';
import type { AuthPort } from '../app/auth';
import { createAppRouter } from '../app/routes';
import { RuntimeProvider, createQueryClient } from '../app/runtime';
import { ToastProvider } from '../app/toasts';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from './factories';

export type SentCall = { name: CallName; input: unknown };

/**
 * Renders the whole app over the sample office as the real build reads it: runtime mode "remote" and the query client of the
 * real build (an answer stays until a change names it). The screens and routes stay the ones of the test build. "sent" lists
 * each call in order. A call that "hold" picks waits until release() (performance audit 2026-10-07).
 */
export async function renderRemoteApp(path = '/', prepare?: (state: State) => void, o: {
  hold?: (name: CallName, input: unknown) => boolean; auth?: AuthPort;
} = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0, sampleOffice });
  const sent: SentCall[] = [];
  const held: Array<() => void> = [];
  const original = api.call.bind(api) as (name: CallName, input: unknown, meta?: unknown) => Promise<unknown>;
  api.call = ((name: CallName, input: unknown, meta?: unknown) => {
    sent.push({ name, input });
    if (!o.hold?.(name, input)) return original(name, input, meta);
    return new Promise<unknown>((resolve, reject) => {
      held.push(() => { original(name, input, meta).then(resolve, reject); });
    });
  }) as typeof api.call;
  initI18n('en');
  window.history.replaceState(null, '', `#${path}`);
  const router = createAppRouter();
  onTestFinished(() => router.dispose());
  const queryClient = createQueryClient({ remote: true });
  const view = render(
    <RuntimeProvider runtime={{ store, api, auth: o.auth, mode: 'remote' }} queryClient={queryClient}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  const release = () => {
    for (const go of held.splice(0)) go();
  };
  return { ...view, store, api, router, queryClient, sent, release };
}
