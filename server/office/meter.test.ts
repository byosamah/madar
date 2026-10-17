import { describe, expect, it } from 'vitest';
import { freshLite } from '../data/lite/testDb';
import { DAY_ROW_LITE, OfficeMeter } from './meter';

const NOW = new Date('2026-10-04T06:00:00Z');

async function setup() {
  const lite = await freshLite();
  const totals = { rowsRead: 0, rowsWritten: 0 };
  return { ...lite, totals, meter: new OfficeMeter({ totals }) };
}

describe('the office meter (server/office/meter.ts)', () => {
  it('keeps the counts in memory and writes no statement for a request', async () => {
    const { db, log, meter } = await setup();
    meter.request({ calls: 3, worker: 2 });
    await meter.countRequest(db);
    expect(log).toEqual([]);
    expect(meter.pending()).toEqual({ rowsRead: 0, rowsWritten: 0, requests: 1, calls: 3, workerRequests: 2 });
  });

  it('adds the rows of the host, the requests and the calls in the next write, and clears them after the commit', async () => {
    const { db, totals, meter } = await setup();
    meter.request({ calls: 2, worker: 1 });
    meter.addBytes(500);
    totals.rowsRead = 120;
    totals.rowsWritten = 9;
    await db.tx('write', (q) => meter.flush(q, NOW));
    expect(await db.statement('read', DAY_ROW_LITE, ['2026-10-04'])).toEqual([{ rows_read: 120, rows_written: 9, requests: 1, calls: 2, worker_requests: 1 }]);
    expect(await db.statement('read', 'select calls, bytes_read from usage_month where month = ?1', ['2026-10'])).toEqual([{ calls: 1, bytes_read: 500 }]);
    expect(meter.pending()).toEqual({ rowsRead: 0, rowsWritten: 0, requests: 0, calls: 0, workerRequests: 0 });
  });

  it('keeps the counts of a write that rolled back, also the rows that it wrote', async () => {
    const { db, totals, meter } = await setup();
    meter.request({ calls: 1 });
    totals.rowsWritten = 7;
    await expect(db.tx('write', async (q) => {
      await meter.flush(q, NOW);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    totals.rowsWritten = 9;
    expect(meter.pending()).toMatchObject({ rowsWritten: 9, requests: 1, calls: 1 });
  });

  it('adds a flush of another UTC day to its own row', async () => {
    const { db, meter } = await setup();
    meter.request();
    await db.tx('write', (q) => meter.flush(q, NOW));
    meter.request();
    meter.request();
    await db.tx('write', (q) => meter.flush(q, new Date('2026-10-05T00:00:01Z')));
    expect(await db.statement('read', 'select day, requests from usage_day')).toEqual([{ day: '2026-10-04', requests: 1 }, { day: '2026-10-05', requests: 2 }]);
  });

  it('writes nothing when no count changed', async () => {
    const { db, log, meter } = await setup();
    await db.tx('write', (q) => meter.flush(q, NOW));
    expect(log).toEqual([]);
  });
});
