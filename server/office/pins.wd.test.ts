import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyCall } from '../core/everyCall';
import { OFFICE_COLLECTIONS } from '../core/types';
import type { OfficeLists } from '../data/lite/office';
import { rowOf } from '../data/rows';
import { TABLES, rowsOf } from '../data/tables';
import type { State } from '../../src/api/store';
import { startOffice } from './test/harness';
import { COLD_EXTRA_ROWS, CRON_PINS, IMPORT_ROWS_PER_RECORD, READ_PINS, WRITE_PINS } from './test/pins';
import { yearOffice } from './test/yearOffice';

const TODAY = '2026-10-04';
const NOW = '2026-10-04T12:00:00.000Z';
const MEASURE = process.env.MADAR_PINS_MEASURE === '1';
const PART = 2_000;

describe('the rows pins on one year of data (server/office/test/pins.ts)', () => {
  let started: Awaited<ReturnType<typeof startOffice>>;
  let year: State;
  let records = 0;
  let written = 0;

  beforeAll(async () => {
    started = await startOffice();
    year = await yearOffice(TODAY);
    const office = started.officeByFetch('year');
    for (const spec of TABLES) {
      const rows = rowsOf(year, spec).map((row) => rowOf(spec, row.doc, year));
      records += rows.length;
      for (let at = 0; at < rows.length; at += PART) written += (await office.load(spec.table, rows.slice(at, at + PART))).rowsWritten;
    }
    const lists = Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, year[c]])) as unknown as OfficeLists;
    written += (await office.finish(lists, year.counters)).rowsWritten;
  }, 900_000);

  afterAll(async () => {
    await started?.server.close();
  });

  it('imports the year office at no more rows written for each record than wave 0', () => {
    if (MEASURE) console.info(`import: ${records} records, ${written} rows written, ${(written / records).toFixed(2)} for each record`);
    expect(written / records).toBeLessThanOrEqual(IMPORT_ROWS_PER_RECORD);
  });

  it('keeps each heavy read under its ceiling of rows read', async () => {
    const office = started.officeByFetch('year');
    const over: string[] = [];
    for (const pin of READ_PINS) {
      const input = pin.sinceHours ? { ...pin.input, since: new Date(Date.parse(NOW) - pin.sinceHours * 3_600_000).toISOString() } : pin.input;
      const { result, rows } = await office.call({ name: pin.name, input, actorId: pin.actorId, now: NOW });
      expect(result.ok, `${pin.name} ${JSON.stringify(input)}`).toBe(true);
      if (MEASURE) console.info(`read pin: ${pin.name} ${JSON.stringify(input)} as ${pin.actorId}: ${rows.rowsRead} rows read (ceiling ${pin.rowsRead})`);
      if (rows.rowsRead > pin.rowsRead) over.push(`${pin.name} ${JSON.stringify(input)} as ${pin.actorId}: ${rows.rowsRead} > ${pin.rowsRead}`);
    }
    expect(over).toEqual([]);
  });

  it('keeps each write under its ceiling of rows written', async () => {
    const office = started.officeByFetch('year');
    const over: string[] = [];
    for (const pin of WRITE_PINS) {
      const c = everyCall(year).find((one) => one.name === pin.name)!;
      const { result, rows } = await office.call({ name: c.name, input: c.input, actorId: c.actorId, now: NOW });
      expect(result.ok, pin.name).toBe(true);
      if (MEASURE) console.info(`write pin: ${pin.name}: ${rows.rowsWritten} rows written (ceiling ${pin.rowsWritten})`);
      if (rows.rowsWritten > pin.rowsWritten) over.push(`${pin.name}: ${rows.rowsWritten} > ${pin.rowsWritten}`);
    }
    expect(over).toEqual([]);
  });

  it('keeps one Cron run under its ceiling of rows read', async () => {
    const office = started.officeByFetch('year');
    await office.cron('2026-10-04T12:15:00.000Z');
    const quarter = (await office.cron('2026-10-04T12:30:00.000Z')).rowsRead;
    const hourly = (await office.cron('2026-10-04T13:00:00.000Z')).rowsRead;
    if (MEASURE) console.info(`cron pin: quarter ${quarter} rows read (ceiling ${CRON_PINS.quarter}), hourly ${hourly} (ceiling ${CRON_PINS.hourly})`);
    expect([quarter <= CRON_PINS.quarter, hourly <= CRON_PINS.hourly]).toEqual([true, true]);
  });

  it('reads at most a few more rows on the first call after the office object slept', async () => {
    const c = { name: 'notifications.count', input: {}, actorId: 'usr_005', now: NOW };
    const warm = (await started.callByFetch('year', c)).rows.rowsRead;
    await started.evict('year');
    const cold = (await started.callByFetch('year', c)).rows.rowsRead;
    if (MEASURE) console.info(`cold wake: ${cold - warm} more rows read`);
    expect(cold - warm).toBeLessThanOrEqual(COLD_EXTRA_ROWS);
  });

  it('never makes the statistics table of ANALYZE', async () => {
    expect(await started.officeByFetch('year').statTables()).toBe(0);
  });
});
