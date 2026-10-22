import { act, render } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { onTestFinished } from 'vitest';
import { calls, type Calls } from '../api/calls';
import { createApi } from '../api/client';
import { ApiError } from '../api/errors';
import { memoryPersister } from '../api/persist';
import { isRead } from '../api/remote/keys';
import { createRemoteApi } from '../api/remote/remoteApi';
import { callCost, BATCH_BUDGET, type ChangeSignal, type WireEntry, type WireRequest } from '../api/remote/wire';
import { Store, type State } from '../api/store';
import { buildSeed } from '../data/seed';
import { sampleOffice } from '../data/sampleOffice';
import { AppearanceSync } from '../app/AppearanceSync';
import { COLLECTION_KINDS } from '../app/readMap';
import { createAppRouter } from '../app/routes';
import { preloadScreens } from '../app/screens';
import { RuntimeProvider, createQueryClient, type ChangeSource, type Runtime } from '../app/runtime';
import type { ChangeListener } from '../app/signals';
import { ToastProvider } from '../app/toasts';
import { WRITE_KINDS } from '../app/writeKinds';
import { loadDragLayer } from '../features/project/tasks/dragLayerLoader';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from './factories';

// The routes start initialized only when their screens are loaded (performance audit BND-1), as in renderHeldRemoteApp.
await preloadScreens();
await loadDragLayer();

/** One request that the real RemoteApi sent: the call names and inputs in order, and the cost of the overview calls in it. */
export type Trip = { names: string[]; calls: { name: string; input: unknown }[]; cost: number };

/**
 * The whole app over the REAL RemoteApi (batcher, follow reads, signals) and a fake server (performance audit 2026-10-22, savetrip).
 * The fake server runs the prototype handlers of each request in order, as the batch route does, and refuses a request whose
 * calls cost more than the budget, as the server does. "trips" lists each request. A save sends one request when its follow reads fit.
 * Real Realtime signals are simulated for an own write: the own answer carries them, and the frame of Realtime can come first.
 */
export async function renderWireApp(path: string, prepare?: (state: State) => void, o: { echoFirst?: boolean } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const office = createApi(calls, { store, latencyMs: 0, sampleOffice });
  const trips: Trip[] = [];
  let seq = 0;
  const listeners = new Set<ChangeListener>();
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as WireRequest;
    const cost = body.calls.reduce((sum, call) => sum + callCost(call.name, call.input), 0);
    trips.push({ names: body.calls.map((call) => call.name), calls: body.calls.map((call) => ({ name: call.name, input: call.input })), cost });
    if (cost > BATCH_BUDGET) {
      return new Response(JSON.stringify({ error: { code: 'invalid_input', message: 'A request holds too many overview calls.', details: { reason: 'too_many_overviews' } } }), { status: 413 });
    }
    const results: WireEntry[] = [];
    for (const call of body.calls) {
      try {
        const result = await office.run(call.name as never, call.input as never);
        const entry: WireEntry = { i: call.i, ok: true, output: JSON.parse(JSON.stringify(result.output ?? null)), storyId: result.storyId, changed: result.changed };
        if (!isRead(call.name) && result.changed) {
          seq += 1;
          const signal: ChangeSignal = {
            v: 1, id: `sig-${seq}`, channel: 'office', seq, projects: [], office: true, kinds: [...(WRITE_KINDS[call.name] ?? COLLECTION_KINDS)],
            people: [state.session.currentUserId], storyId: result.storyId, actorId: state.session.currentUserId,
          };
          entry.signals = [signal];
          if (o.echoFirst) for (const listener of [...listeners]) listener([signal], 'channel');
        }
        results.push(entry);
      } catch (error) {
        const known = error instanceof ApiError ? error : new ApiError('failed', 'The call failed. Try again.');
        results.push({ i: call.i, ok: false, error: { code: known.code, message: known.message } });
      }
    }
    return new Response(JSON.stringify({ v: 1, serverTime: '', results }), { status: 200 });
  }) as typeof globalThis.fetch;
  const changes: ChangeSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status: () => 'open',
  };
  const api = createRemoteApi<Calls>({
    url: 'https://ref.supabase.co/functions/v1/api',
    build: 'test',
    token: async () => 'tok-1',
    fetch,
    onSignals: (signals, fresh) => {
      for (const listener of [...listeners]) {
        if (fresh) listener(signals, 'own', fresh);
        else listener(signals, 'own');
      }
    },
  });
  const runtime: Runtime = { api, changes, mode: 'remote' };
  initI18n('en');
  window.history.replaceState(null, '', `#${path}`);
  const router = createAppRouter();
  onTestFinished(() => router.dispose());
  const queryClient = createQueryClient({ remote: true });
  const view = render(
    <RuntimeProvider runtime={runtime} queryClient={queryClient}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  /** Waits until no new request goes out for a while (real timers). */
  const settle = async () => {
    let seen = -1;
    while (seen !== trips.length) {
      seen = trips.length;
      await act(() => new Promise<void>((resolve) => { setTimeout(resolve, 200); }));
    }
  };
  return { ...view, state, store, router, queryClient, trips, settle };
}
