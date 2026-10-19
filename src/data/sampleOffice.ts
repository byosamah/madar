import type { State } from '../api/store';
import { todayISO } from '../lib/dates';
import { addSampleSubCompanies } from './sampleSubCompanies';
import { buildSeed, type PutBlob } from './seed';
import { settleFuture } from './shift';

/**
 * The sample office of the prototype as of "now": the sample stamps of later today move to before now (audit 2026-10-03, BRW-4).
 * The prototype runtime gives it to session.resetSampleData. The server bundles never load it, so no path runs settleFuture on a
 * real office (server/workerGraph.test.ts, cleanup 2026-10-06).
 */
export async function sampleOffice(now: Date, putBlob: PutBlob): Promise<State> {
  const state = await buildSeed(todayISO(now), putBlob);
  addSampleSubCompanies(state, todayISO(now));
  return settleFuture(state, now);
}
