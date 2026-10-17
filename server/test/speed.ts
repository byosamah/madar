import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** What one test file of a worker writes into the run folder when it closes (server/test/db.ts, server/test/liteHarness.ts). */
export type WorkerStats = { n: number; ms: number };

/**
 * The gate of TM 4.1: the db job fails when the run takes more than 180 s, or a call more than 25 ms on average. The call average is
 * the real speed check. The run time grows with each new test, and the same code took 105 s and 126 s on the shared CI machines
 * (2026-10-06), so the old 120 s failed a run that was right.
 */
export const GATE_RUN_MS = 180_000;
export const GATE_CALL_MS = 25;

/** Every stats file of the run folder. A file that does not hold the numbers fails the run, so the gate never reads a partial sum. */
export function readWorkerStats(dir: string): WorkerStats[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const stats = JSON.parse(readFileSync(join(dir, name), 'utf8')) as WorkerStats;
      if (typeof stats.n !== 'number' || typeof stats.ms !== 'number') throw new Error(`db mode: the stats file ${name} does not hold the numbers n and ms.`);
      return stats;
    });
}

/**
 * The one line of the speed gate, from the stats of every test file and the time of the whole run. In CI a run over the gate
 * fails. On the shared Mac it only warns: the load of the other tracks' work there can slow a run that is right.
 */
export function speedGate(stats: readonly WorkerStats[], runMs: number, o: { ci: boolean }): { line: string; failure?: string } {
  const n = stats.reduce((sum, one) => sum + one.n, 0);
  const ms = stats.reduce((sum, one) => sum + one.ms, 0);
  const perCall = n > 0 ? ms / n : 0;
  const seconds = Math.round(runMs / 1000);
  const over = [
    perCall > GATE_CALL_MS ? `${perCall.toFixed(1)} ms a call is over the gate of ${GATE_CALL_MS} ms` : '',
    runMs > GATE_RUN_MS ? `the run of ${seconds} s is over the gate of ${GATE_RUN_MS / 1000} s` : '',
  ].filter(Boolean);
  let line = `db mode: ${n} calls, ${perCall.toFixed(1)} ms a call in runCall, the run took ${seconds} s.`;
  if (over.length === 0) return { line };
  const failure = `db mode, speed gate (TM 4.1): ${over.join('; ')}.`;
  return o.ci ? { line, failure } : { line: `${line} Warning, over the gate (only CI fails on it): ${over.join('; ')}.` };
}
