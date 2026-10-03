import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { OFFICE_COLLECTIONS } from '../core/types';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES, collectionOf, rowsOf } from './tables';

const TODAY = '2026-10-04';
/** The State fields that are not tables: the session lives in the browser, and counters has its own table (plan 4.2). */
const NOT_TABLES = ['version', 'seededOn', 'session', 'counters'];

describe('the table registry (server/data/tables.ts)', () => {
  it('has one table for each State collection', () => {
    // feedback is optional in State and emptyState leaves it out, so it is named here.
    const collections = new Set([...Object.keys(emptyState(TODAY)), 'feedback'].filter((key) => !NOT_TABLES.includes(key)));
    expect(new Set(TABLES.map((spec) => spec.collection))).toEqual(collections);
    expect(TABLES.length).toBe(collections.size);
  });

  it('gives each table its own snake_case name, apart from the server-only tables', () => {
    const names = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...SERVER_TABLES];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z_]*[a-z]$/);
  });

  it('marks exactly the office lists of the office cache as office tables', () => {
    expect(TABLES.filter((spec) => spec.office).map((spec) => spec.collection).sort()).toEqual([...OFFICE_COLLECTIONS].sort());
  });

  it('gives every record of the sample office the key that State uses for it', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    for (const spec of TABLES) {
      if (spec.collection === 'settings') continue;
      const map = (seed[spec.collection] ?? {}) as Record<string, Record<string, unknown>>;
      for (const [key, record] of Object.entries(map)) expect(spec.key(record), `${spec.table} ${key}`).toBe(key);
    }
    const settings = TABLES.find((spec) => spec.collection === 'settings')!;
    expect(rowsOf(seed, settings)).toEqual([{ id: 'office', doc: seed.settings }]);
  });

  it('turns rows back into the same collection, in the same order', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    for (const spec of TABLES) {
      const rows = rowsOf(seed, spec);
      const back = collectionOf(spec, rows.map((row) => row.doc));
      expect(back, spec.table).toEqual(spec.collection === 'settings' ? seed.settings : (seed[spec.collection] ?? {}));
      if (spec.collection !== 'settings') expect(Object.keys(back as object)).toEqual(Object.keys((seed[spec.collection] ?? {}) as object));
    }
  });

  it('finds the project of every comment of the sample office from its target', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const comments = TABLES.find((spec) => spec.collection === 'comments')!;
    const projectOf = comments.serverColumns!.project_id;
    for (const comment of Object.values(seed.comments)) {
      const target = comment.targetType === 'task' ? seed.tasks[comment.targetId] : seed.updates[comment.targetId];
      expect(projectOf(comment, seed), comment.id).toBe(target.projectId);
    }
  });

  it('writes search text with the same normal form that search.query matches', () => {
    const state: State = emptyState(TODAY);
    state.clients.cli_001 = { id: 'cli_001', name: 'Gulf Crest', nameAr: 'الخليج', contactName: '', phone: '', email: '' };
    const project = { id: 'prj_001', code: 'KH-26-001', name: 'Villa  Ahmed', clientId: 'cli_001' };
    const projects = TABLES.find((spec) => spec.collection === 'projects')!;
    expect(projects.serverColumns!.search_text(project, state)).toBe('kh-26-001 villa ahmed gulf crest الخليج');
    const tasks = TABLES.find((spec) => spec.collection === 'tasks')!;
    expect(tasks.serverColumns!.search_text({ title: 'Floor PLANS' }, state)).toBe('floor plans');
    const files = TABLES.find((spec) => spec.collection === 'files')!;
    expect(files.serverColumns!.search_text({ name: 'مخطط  الدور' }, state)).toBe('مخطط الدور');
  });
});
