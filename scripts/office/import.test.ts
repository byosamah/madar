import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { IMPORT_ROWS_PER_RECORD as PIN } from '../../server/office/test/pins';
import { NODE_TODAY, nodeOffice } from '../../server/office/test/nodeOffice';
import { recordDigest } from './digest';
import { budgetProblem, IMPORT_ROWS_PER_RECORD, importOffice, planParts, rowsToWrite, targetOf } from './import';
import { partsOps, type OfficeOps } from './ops';
import { stateSource } from './source';

describe('the import client (scripts/office/import.ts)', () => {
  it('plans 7.5 rows written for each record, the ceiling of the rows pins of wave 1', () => {
    expect(IMPORT_ROWS_PER_RECORD).toBe(PIN);
    expect(rowsToWrite(908)).toBe(8_810);
  });

  it('splits a table into parts of at most 2,000 rows and about 2 MB', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const source = stateSource(seed);
    const big = { ...source, tables: [{ table: 'events', rows: Array.from({ length: 4_500 }, (_, i) => ({ id: `evt_${i}`, doc: { n: i }, columns: {} })) }] };
    expect(planParts(big).map((p) => p.rows.length)).toEqual([2_000, 2_000, 500]);
    const heavy = { ...source, tables: [{ table: 'users', rows: Array.from({ length: 3 }, (_, i) => ({ id: `usr_${i}`, doc: { avatar: 'x'.repeat(900_000) }, columns: {} })) }] };
    expect(planParts(heavy).map((p) => p.rows.length)).toEqual([2, 1]);
  });

  it('says how many Free days the year office needs, and refuses it as one import', () => {
    expect(budgetProblem({ records: 132_221, usedToday: 0, limit: 90_000 })).toContain('about 993,658 rows written');
    expect(budgetProblem({ records: 132_221, usedToday: 0, limit: 90_000 })).toContain('10 days');
    expect(budgetProblem({ records: 908, usedToday: 0, limit: 90_000 })).toBeUndefined();
    expect(budgetProblem({ records: 908, usedToday: 85_000, limit: 90_000 })).toContain('left of the limit');
  });

  it('refuses an office over the day budget and writes nothing: only the begin and the abort reach the object', async () => {
    const t = await nodeOffice({ seed: false });
    const seen: string[] = [];
    const inner = partsOps(t.parts);
    const ops: OfficeOps = { post: async <T,>(op: string, body: unknown) => (seen.push((body as { step: string }).step), inner.post<T>(op, body)) };
    const source = stateSource(await buildSeed(NODE_TODAY, async () => undefined));
    await expect(importOffice(ops, source, { mode: 'empty', limit: 5_000 })).rejects.toThrow('One import must fit one UTC day');
    expect(seen).toEqual(['begin', 'abort']);
    expect(t.raw.prepare('select count(*) as n from tasks').get()).toEqual({ n: 0 });
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('sends a part again after a failed answer, and the office ends with each record once', async () => {
    const t = await nodeOffice({ seed: false });
    const inner = partsOps(t.parts);
    let failed = false;
    const ops: OfficeOps = {
      post: async <T,>(op: string, body: unknown): Promise<T> => {
        const out = await inner.post<T>(op, body);
        // The first part of tasks commits, and then its answer gets lost.
        if (!failed && (body as { table?: string }).table === 'tasks') {
          failed = true;
          throw new Error('The office op import answered 502: lost');
        }
        return out;
      },
    };
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const report = await importOffice(ops, stateSource(seed), { mode: 'empty', wait: async () => undefined });
    expect(report.skipped).toBe(1);
    expect(t.raw.prepare('select count(*) as n from tasks').get()).toEqual({ n: Object.keys(seed.tasks).length });
    const tasks = (t.raw.prepare('select id, doc from tasks').all() as { id: string; doc: string }[]);
    expect(recordDigest(tasks)).toEqual(recordDigest(stateSource(seed).tables.find((x) => x.table === 'tasks')!.rows));
  });

  it('sends no part again after a refusal of the object (4xx), and frees the office', async () => {
    const t = await nodeOffice({ seed: false });
    const inner = partsOps(t.parts);
    const steps: string[] = [];
    const ops: OfficeOps = {
      post: async <T,>(op: string, body: unknown): Promise<T> => {
        const step = (body as { step: string }).step;
        steps.push(step);
        // A part with a hold id that is not the hold: the object answers 409 hold_ended.
        return inner.post<T>(op, step === 'part' ? { ...(body as object), id: 'f'.repeat(32) } : body);
      },
    };
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    await expect(importOffice(ops, stateSource(seed), { mode: 'empty', wait: async () => undefined })).rejects.toThrow(/answered 409/);
    expect(steps).toEqual(['begin', 'part', 'abort']);
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('takes the test copy and the local office as targets, and refuses production before wave 6', () => {
    expect(targetOf('https://preview.madar-46r.pages.dev').copy).toBe('test');
    expect(targetOf('http://127.0.0.1:8792').copy).toBe('local');
    expect(() => targetOf('https://madar.vado.sa')).toThrow('wave 6');
    expect(() => targetOf('https://example.com')).toThrow('not a Madar copy');
  });
});
