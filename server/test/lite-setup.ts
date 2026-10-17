import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { readWorkerStats, speedGate } from './speed';

declare module 'vitest' {
  export interface ProvidedContext {
    madarLite: { stats: string };
  }
}

/** The global setup of the lite project: the run folder of the call stats, and the speed gate of db mode at the end. */
export default function setup(project: TestProject): () => void {
  const started = performance.now();
  const stats = mkdtempSync(join(tmpdir(), 'madar-lite-stats-'));
  project.provide('madarLite', { stats });
  return () => {
    try {
      const gate = speedGate(readWorkerStats(stats), performance.now() - started, { ci: Boolean(process.env.CI) });
      console.info(gate.line.replace('db mode', 'lite mode'));
      if (gate.failure) throw new Error(gate.failure.replace('db mode', 'lite mode'));
    } finally {
      rmSync(stats, { recursive: true, force: true });
    }
  };
}
