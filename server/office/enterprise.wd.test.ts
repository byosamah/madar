import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { startLive } from './test/live/harness';

/** The enterprise gate on local workerd (Madar enterprises, plan B Task 6). */
describe('the enterprise gate of the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('status reads at most 6 rows on the sample office', async () => {
    await live.fresh(await buildSeed('2026-10-04', async () => undefined));
    const { status, rows } = await live.statusRows();
    expect(status).toMatchObject({ ent: 'ent_001', invited: 0, storageBytes: 0 });
    expect(rows).toBeLessThanOrEqual(6);
  });

  it('the object reports its own name, and an object of another name refuses a row of ent_001 (spike S3: the name is stable)', async () => {
    await live.fresh(await buildSeed('2026-10-04', async () => undefined));
    // The same object name as the row: the call runs.
    expect((await live.statusRows()).status.ent).toBe('ent_001');
    // An object named ent_002 that holds the identity row of ent_001: the gate refuses it with the text of a bad token.
    expect(await live.named('ent_002')).toEqual({ ok: false, code: 'unauthenticated', message: 'Sign in to continue.' });
  });
});
