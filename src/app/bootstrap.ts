import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { runScheduledTriggers } from '../api/notify';
import { openPersister, type Persister } from '../api/persist';
import { STATE_VERSION, Store } from '../api/store';
import { migrateState } from '../data/migrate';
import { buildSeed } from '../data/seed';
import { shiftState } from '../data/shift';
import { diffDays, now, todayISO } from '../lib/dates';
import type { Runtime } from './runtime';

/** The only place that builds the store and the API. */
export async function bootstrap(options: { persister?: Persister; latencyMs?: number } = {}): Promise<Runtime> {
  const persister = options.persister ?? (await openPersister());
  const today = todayISO();
  let state = await persister.load().catch(() => null);
  if (state && state.version !== STATE_VERSION) state = migrateState(state);
  if (!state) {
    await persister.clear().catch(() => undefined);
    state = await buildSeed(today, (key, blob) => persister.putBlob(key, blob));
  } else if (state.seededOn !== today) {
    state = shiftState(state, diffDays(state.seededOn, today));
    state.seededOn = today;
  }
  const store = new Store(state, persister);
  store.run((s) => {
    runScheduledTriggers(s, now());
  });
  const api = createApi(calls, {
    store,
    latencyMs: options.latencyMs,
    failureRate: () => (store.state.session.simulateErrors ? 0.2 : 0),
  });
  return { store, api };
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
