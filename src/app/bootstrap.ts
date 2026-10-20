import { calls } from '../api/calls';
import { createApi, type Api, type CallMap } from '../api/client';
import { runScheduledTriggers } from '../api/notify';
import { memoryPersister, openPersister, type Persister } from '../api/persist';
import { STATE_VERSION, Store } from '../api/store';
import { migrateState } from '../data/migrate';
import { buildSeed } from '../data/seed';
import { addSampleMeetings } from '../data/sampleMeetings';
import { addSampleSubCompanies } from '../data/sampleSubCompanies';
import { sampleOffice } from '../data/sampleOffice';
import { settleFuture, shiftState } from '../data/shift';
import { diffDays, now, todayISO } from '../lib/dates';
import { dueToSettle, seriesToExtend } from '../api/handlers/meetings';
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
    addSampleSubCompanies(state, today);
    addSampleMeetings(state, today);
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
    sampleOffice,
    latencyMs: options.latencyMs,
    failureRate: () => (store.state.session.simulateErrors ? 0.2 : 0),
  });
  return { store, api, auth: alwaysSignedIn(), changes: storeChangeSource(store), mode: 'prototype' };
}

/**
 * Runs the time-based triggers every minute. A tick tells the screens and saves the office only when it made a notice, or when
 * the office day changed, so the day counts ("due today", "past due") still refresh after midnight (performance audit FET-11).
 * notify changes the state only when it makes a notice, so a quiet tick changes nothing. With the api, a tick also settles the meetings
 * that ended and keeps the repeating series full (the prototype has no 15-minute job).
 */
export function startScheduler(store: Store, api?: Api<CallMap>): () => void {
  let day = todayISO();
  const id = window.setInterval(() => {
    store.runIf((s) => {
      const made = runScheduledTriggers(s, now());
      const today = todayISO();
      const newDay = today !== day;
      day = today;
      return made > 0 || newDay;
    });
    // The prototype has no job: the same tick settles the meetings that ended (fbk_022, wave 2), with the normal call. A meeting that the
    // current person does not see answers not_found, and any other refusal waits for the next tick. A settled meeting leaves the list.
    if (api) for (const meeting of dueToSettle(store.state, now())) api.call('meetings.settle', { id: meeting.id }).catch(() => undefined);
    // The same tick keeps a series full (fbk_022, wave 3), as the job does: the series that has fewer than 8 meetings ahead gets the missing ones.
    if (api) for (const seriesId of seriesToExtend(store.state, now())) api.call('meetings.extend', { seriesId }).catch(() => undefined);
  }, 60_000);
  return () => window.clearInterval(id);
}
