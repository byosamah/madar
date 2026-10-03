import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { runScheduledTriggers } from '../api/notify';
import { memoryPersister, openPersister, type Persister } from '../api/persist';
import { STATE_VERSION, Store } from '../api/store';
import { migrateState } from '../data/migrate';
import { buildSeed } from '../data/seed';
import { settleFuture, shiftState } from '../data/shift';
import { diffDays, now, todayISO } from '../lib/dates';
import { alwaysSignedIn } from './auth';
import type { ChangeSource, Runtime } from './runtime';

/** The prototype runtime always has its store. */
export type PrototypeRuntime = Runtime & { store: Store };

/** Every change of the store is one change signal with no detail, so the screens reload all, as before. The store is always open. */
export function storeChangeSource(store: Store): ChangeSource {
  return { subscribe: (listener) => store.subscribe(() => listener([])), status: () => 'open' };
}

/** The only place that builds the store and the API. */
export async function bootstrap(options: { persister?: Persister; latencyMs?: number } = {}): Promise<PrototypeRuntime> {
  let persister = options.persister ?? (await openPersister());
  const today = todayISO();
  const saved = await persister.load().then((value) => ({ value, read: true }), () => ({ value: null, read: false }));
  // An office saved by a newer build, or one that cannot be read now, is never wiped. Madar runs in memory with the "not saved"
  // banner, and the saved copy waits for a build that can read it (audit 2026-10-03, API-2). An office older than any migration
  // step is still replaced: no build can read it.
  const newer = saved.value !== null && saved.value.version > STATE_VERSION;
  if (!saved.read || newer) persister = memoryPersister();
  let state = newer ? null : saved.value;
  if (state && state.version !== STATE_VERSION) state = migrateState(state);
  if (!state) {
    await persister.clear().catch(() => undefined);
    state = await buildSeed(today, (key, blob) => persister.putBlob(key, blob));
  } else if (state.seededOn !== today) {
    state = shiftState(state, diffDays(state.seededOn, today));
    state.seededOn = today;
  }
  // The sample office and the daily shift can put a stamp later than now. Nothing happened in the future (audit 2026-10-03, BRW-4).
  state = settleFuture(state, now());
  const store = new Store(state, persister);
  store.run((s) => {
    runScheduledTriggers(s, now());
  });
  const api = createApi(calls, {
    store,
    latencyMs: options.latencyMs,
    failureRate: () => (store.state.session.simulateErrors ? 0.2 : 0),
  });
  return { store, api, auth: alwaysSignedIn(), changes: storeChangeSource(store), mode: 'prototype' };
}

/** Runs the time-based triggers every minute. */
export function startScheduler(store: Store): () => void {
  const id = window.setInterval(() => {
    store.run((s) => {
      runScheduledTriggers(s, now());
    });
  }, 60_000);
  return () => window.clearInterval(id);
}
