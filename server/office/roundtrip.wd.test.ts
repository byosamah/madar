import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportOffice } from '../../scripts/backup/officeExport';
import { compareDigests } from '../../scripts/office/digest';
import { compareImport } from '../../scripts/office/compare';
import { importOffice } from '../../scripts/office/import';
import { opsOf, type OfficeOps } from '../../scripts/office/ops';
import { exportSource, stateSource } from '../../scripts/office/source';
import { startLive } from './test/live/harness';
import { IMPORT_ROWS_PER_RECORD } from './test/pins';
import { yearOffice } from './test/yearOffice';

const TODAY = '2026-10-04';
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

type Live = Awaited<ReturnType<typeof startLive>>;
/** The init of the fetch of the test harness (the Workers form of RequestInit). */
type WorkerInit = Parameters<ReturnType<Live['worker']>['fetch']>[1];

describe('the round trip of the year office through the office ops (A.2 gate of wave 4)', () => {
  let live: Live;
  const folders: string[] = [];

  beforeAll(async () => {
    live = await startLive();
  }, 120_000);

  afterAll(async () => {
    await live?.server.close();
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  });

  /** The ops of one object of the test Worker, through its routes and secrets (entry.ts). */
  const opsFor = (office: string, kind: 'ops' | 'export'): OfficeOps => opsOf({
    base: 'http://office.test', office,
    header: kind === 'export' ? 'x-madar-export-secret' : 'x-madar-ops-secret', secret: kind === 'export' ? 'test-export-secret' : 'test-ops-secret',
    fetch: ((url: string, init?: RequestInit) => {
      const target = new URL(url);
      return live.worker().fetch(`${target.pathname}${target.search}`, init as WorkerInit);
    }) as unknown as typeof fetch,
  });

  const folder = (name: string) => {
    const made = mkdtempSync(join(tmpdir(), `madar-roundtrip-${name}-`));
    folders.push(made);
    return made;
  };

  it('imports the year office, exports it, imports the export into a second object, exports again: every table is equal', async () => {
    const source = stateSource(await yearOffice(TODAY));
    await importOffice(opsFor('rehearsal-20261001', 'ops'), source, { mode: 'empty', limit: NO_LIMIT });
    const first = folder('a');
    const a = await exportOffice(opsFor('rehearsal-20261001', 'export'), { copy: 'local', folder: first });
    expect(compareImport(source, first).problems).toEqual([]);

    await importOffice(opsFor('rehearsal-20261002', 'ops'), exportSource(first, { today: TODAY }), { mode: 'empty', limit: NO_LIMIT });
    const second = folder('b');
    const b = await exportOffice(opsFor('rehearsal-20261002', 'export'), { copy: 'local', folder: second });
    // The version, the meters and the sign-in rows of the import step differ by design; every record and server row is the same.
    expect(compareDigests(a.tables, b.tables, { skip: ['office_meta', 'usage_day', 'usage_month'] }).problems).toEqual([]);

    // The rows pin of the import through the real routes: at most 7.5 rows written for each record (wave 1 measured 6.90).
    const day = readFileSync(join(first, 'tables', 'usage_day.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { rows_written: number });
    const written = day.reduce((sum, row) => sum + Number(row.rows_written), 0);
    console.info(`round trip: ${source.records} records, ${written} rows written, ${(written / source.records).toFixed(2)} for each record`);
    expect(written / source.records).toBeLessThanOrEqual(IMPORT_ROWS_PER_RECORD);
  }, 1_800_000);
});
