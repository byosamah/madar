import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../../src/data/seed';
import { TABLES, rowsOf } from '../../data/tables';
import { YEAR, shifted, yearOffice } from './yearOffice';

const TODAY = '2026-10-04';

describe('the year office of test:office (server/office/test/yearOffice.ts)', () => {
  it('moves a stamp and a date, and keeps their text form', () => {
    expect(shifted('2026-09-30T09:00:00.000+03:00', -86_400_000)).toBe('2026-09-29T09:00:00.000+03:00');
    expect(shifted('2026-09-30T06:00:00Z', 3_600_000)).toBe('2026-09-30T07:00:00Z');
    expect(shifted('2026-09-30', -2 * 86_400_000)).toBe('2026-09-28');
    expect(shifted('not a date', 1)).toBe('not a date');
  });

  it('builds records that parse with the zod schema of their table, with one key for each record and one seq for each event', async () => {
    const office = await yearOffice(TODAY);
    for (const spec of TABLES) {
      const rows = rowsOf(office, spec);
      expect(new Set(rows.map((row) => row.id)).size, spec.table).toBe(rows.length);
      rows.forEach((row, i) => {
        if (spec.office || i % 25 === 0) expect(spec.schema.safeParse(row.doc).success, `${spec.table} ${row.id}`).toBe(true);
      });
    }
    const seqs = Object.values(office.events).map((event) => event.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(office.counters.evt).toBeGreaterThanOrEqual(seqs.length);
  }, 120_000);

  it('reaches the sizes of the wave 0 year profile', async () => {
    const [office, seed] = await Promise.all([yearOffice(TODAY), buildSeed(TODAY, async () => undefined)]);
    for (const c of ['events', 'comments', 'notifications', 'messages', 'files', 'updates', 'tracker'] as const) {
      expect(Object.keys(office[c] ?? {}).length, c).toBe(YEAR[c]);
    }
    expect(Object.keys(office.projects).length).toBe(Object.keys(seed.projects).length * YEAR.copies);
  }, 120_000);
});
