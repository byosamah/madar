import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { everyCall } from '../core/everyCall';
import { createRunCall } from '../core/runCall';
import { liteData } from '../data/lite/callData';
import { EXPECTED_CHECKS } from '../data/lite/hostChecks';
import { freshLite } from '../data/lite/testDb';
import { liteLoadWhole, liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';
import { startOffice } from './test/harness';

const TODAY = '2026-10-04';
const NOW = '2026-10-04T06:00:00.000Z';
/** An answer with the parts that differ on each run made the same: story ids, upload ids, uuids. */
const steady = (value: unknown) =>
  JSON.stringify(value).replace(/sty_[a-z2-7]{22}/g, 'sty_x').replace(/upl_[a-z2-7]{22}/g, 'upl_x').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'uuid');

describe('the office object host on local workerd (server/office/doHost.ts)', () => {
  let started: Awaited<ReturnType<typeof startOffice>>;
  beforeAll(async () => {
    started = await startOffice();
  }, 120_000);
  afterAll(async () => {
    await started?.server.close();
  });

  it('refuses what node:sqlite refuses in test:lite, and keeps the same transactions', async () => {
    expect(await started.office('checks').hostChecks()).toEqual(EXPECTED_CHECKS);
  });

  it('runs every call of everyCall on the sample office with the answers of node:sqlite', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const office = started.office('every');
    await office.writeState(seed);
    const lite = await freshLite();
    await lite.db.tx('write', (q) => liteWriteState(q, seed));
    const deps = fakeDeps({ db: lite.db });
    deps.clock.set(new Date(NOW));
    const run = createRunCall({ data: liteData });
    for (const c of everyCall(seed)) {
      const inObject = (await office.call({ name: c.name, input: c.input, actorId: c.actorId, now: NOW })).result;
      const onNode = await run(deps, { principal: { userId: c.actorId }, name: c.name, input: c.input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
      expect(steady(inObject), c.name).toBe(steady(onNode));
    }
    expect(steady(await office.readBack())).toBe(steady(await lite.db.tx('read', (q) => liteLoadWhole(q))));
  }, 300_000);

  it('runs two writes that arrive at one time one after the other', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const office = started.office('two');
    await office.writeState(seed);
    const oldMax = Math.max(...Object.values(seed.events).map((event) => event.seq));
    const c = everyCall(seed).find((one) => one.name === 'tasks.update')!;
    const [a, b] = await Promise.all([office.call({ ...c, now: NOW }), office.call({ ...c, now: NOW })]);
    expect([a.result.ok, b.result.ok]).toEqual([true, true]);
    const fresh = Object.values((await office.readBack()).events).map((event) => event.seq).filter((seq) => seq > oldMax).sort((x, y) => x - y);
    expect(fresh).toEqual(fresh.map((_, i) => oldMax + 1 + i));
  });
});
