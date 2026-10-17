import { afterAll, afterEach, beforeEach, inject, vi } from 'vitest';
import { setNow } from '../../src/lib/dates';
import { useDbTestApi } from '../../src/test/factories';
import { skipReason } from './db-mode.skip';
import { createDbApi } from './dbApi';
import { createGate, fullName } from './gate';
import { LiteWorker } from './liteHarness';

/**
 * The setup file of the lite project (Supabase exit, wave 1): the same mirror store as db mode (server/test/dbApi.ts), on the
 * SQLite backend of liteHarness.ts. The project sets MADAR_DB=1 for src/test/factories.ts and MADAR_LITE=1 for this file. The
 * skip list of db mode holds here too.
 */
if (process.env.MADAR_LITE === '1') {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
  const worker = new LiteWorker({ stats: inject('madarLite')?.stats });
  const gate = createGate();
  useDbTestApi((calls, state) => createDbApi(calls, state, worker.backendFor(gate)));

  beforeEach((ctx) => {
    const reason = skipReason(ctx.task.file.filepath, fullName(ctx.task));
    if (reason) ctx.skip(`lite mode: ${reason}`);
    gate.start(ctx.task.id);
  });

  afterEach(async () => {
    await gate.end();
    worker.end();
  });

  afterAll(() => {
    worker.close();
  });
}

afterEach(() => {
  // Many API tests call setNow without their own reset.
  setNow(null);
});
