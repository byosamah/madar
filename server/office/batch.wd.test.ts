import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { startLive } from './test/live/harness';

const TODAY = new Date().toISOString().slice(0, 10);

describe('the batch call into the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('answers a batch from the office object, with the session of the person', async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    const { status, body } = await live.batch('usr_005', [{ name: 'session.get', input: {} }]);
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ i: 0, ok: true, output: { user: { id: 'usr_005' } } });
  });

  it('refuses a batch with no token before the office object', async () => {
    const response = await live.worker().fetch('/api/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, calls: [] }) });
    expect(response.status).toBe(401);
  });
});
