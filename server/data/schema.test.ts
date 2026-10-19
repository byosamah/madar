import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { OFFICE_COLLECTIONS } from '../core/types';
import { applyMigrations, dropSchema, localClient } from '../it/migrate';
import type { Query } from '../core/ports';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES, collectionOf, rowsOf } from './tables';
import { loadWhole, writeState } from './whole';

const TODAY = '2026-10-04';
/** The State fields that are not tables: the session lives in the browser, and counters has its own table (plan 4.2). */
const NOT_TABLES = ['version', 'seededOn', 'session', 'counters'];

describe('the table registry (server/data/tables.ts)', () => {
  it('has one table for each State collection', () => {
    // feedback, subCompanies and meetings are optional in State and emptyState leaves them out, so they are named here.
    const collections = new Set([...Object.keys(emptyState(TODAY)), 'feedback', 'subCompanies', 'meetings'].filter((key) => !NOT_TABLES.includes(key)));
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

/**
 * The schema check against zod (plan 4.4). It needs the local stack, so it runs only with MADAR_IT=1 and is skipped in
 * "npm test". "npm run test:it" runs it once the merge lead adds this file to the "it" project of vite.config.ts; until then
 * run MADAR_IT=1 npx vitest run --project server server/data/schema.test.ts under the Docker lock. It applies the
 * non-platform migrations into a schema of its own, as the db-mode harness does for each worker.
 *
 * It writes and reads through writeState and loadWhole of server/data/whole.ts (task C1), the same save step that runCall uses.
 */
describe.runIf(process.env.MADAR_IT === '1')('the schema against zod, on the local database', () => {
  const schema = `madar_b2_${process.pid}`;
  let db: pg.Client;
  let seed: State;
  const q: Query = async <R,>(text: string, values?: unknown[]) => (await db.query(text, values)).rows as R[];

  async function writeHere(state: State): Promise<void> {
    await db.query('begin');
    try {
      await writeState(q, state);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  }

  async function loadHere(): Promise<Record<string, unknown>> {
    return (await loadWhole(q, { withEvents: true, today: TODAY })) as unknown as Record<string, unknown>;
  }

  beforeAll(async () => {
    db = await localClient();
    await applyMigrations(db, schema);
    await db.query(`set search_path to ${schema}`);
    seed = await buildSeed(TODAY, async () => undefined);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await dropSchema(db, schema);
    await db.end();
  });

  it('starts empty, with the settings of emptyState and one office_meta row', async () => {
    const { rows: settings } = await db.query('select id, doc from settings');
    expect(settings).toEqual([{ id: 'office', doc: emptyState(TODAY).settings }]);
    const { rows: meta } = await db.query('select id, version, office_seq from office_meta');
    expect(meta).toEqual([{ id: 1, version: '0', office_seq: '0' }]);
    for (const spec of TABLES.filter((table) => table.collection !== 'settings')) {
      const { rows } = await db.query(`select count(*)::integer as n from ${spec.table}`);
      expect(rows[0].n, spec.table).toBe(0);
    }
  });

  it('has no stray table: the tables equal the registry plus the server-only list', async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'r'`,
      [schema],
    );
    const expected = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...SERVER_TABLES].sort();
    expect(rows.map((row) => row.relname).sort()).toEqual(expected);
  });

  it('reads only zod fields in the generated columns, and has the id, ord, doc, chg and server columns', async () => {
    const { rows } = await db.query(
      `select table_name, column_name, is_generated, generation_expression from information_schema.columns where table_schema = $1`,
      [schema],
    );
    for (const spec of TABLES) {
      const columns = rows.filter((row) => row.table_name === spec.table);
      const names = columns.map((row) => row.column_name);
      expect(names, spec.table).toEqual(expect.arrayContaining(['id', 'ord', 'doc', ...Object.keys(spec.serverColumns ?? {})]));
      expect(names.includes('chg'), `${spec.table} has chg only when it is an office table`).toBe(spec.office);
      for (const column of columns.filter((row) => row.is_generated === 'ALWAYS')) {
        const fields = [...String(column.generation_expression).matchAll(/'([A-Za-z]+)'::text/g)].map((match) => match[1]);
        expect(fields.length, `${spec.table}.${column.column_name} reads doc`).toBeGreaterThan(0);
        for (const field of fields) expect(Object.keys(spec.schema.shape), `${spec.table}.${column.column_name}`).toContain(field);
      }
    }
  });

  it('gives the sample office back exactly, in the same order, events and one undo pair included', async () => {
    // The sample office has no undo event, so one pair is added: Y undoes X, and the loader must fill X.undoneBy (plan 4.3).
    const office = structuredClone(seed);
    const events = Object.values(office.events);
    const x = events[0];
    const y = { ...x, id: 'evt_9001', seq: Math.max(...events.map((event) => event.seq)) + 1, verb: 'undo', undoes: x.id, undoneBy: null };
    office.events[y.id] = y;
    x.undoneBy = y.id;
    await writeHere(office);
    const loaded = await loadHere();
    expect((loaded.events as State['events'])[x.id].undoneBy).toBe(y.id);
    const { rows: stored } = await db.query('select doc from events where id = $1', [x.id]);
    expect(stored[0].doc.undoneBy).toBeNull();
    // What JSON can hold: a field set to undefined is absent.
    const expected = JSON.parse(JSON.stringify(office)) as Record<string, unknown>;
    for (const spec of TABLES) {
      const want = expected[spec.collection] ?? {};
      expect(loaded[spec.collection], spec.table).toStrictEqual(want);
      if (spec.collection !== 'settings') expect(Object.keys(loaded[spec.collection] as object), spec.table).toEqual(Object.keys(want as object));
    }
    expect(loaded.counters).toStrictEqual(expected.counters);
    expect(Object.keys(seed.events).length).toBeGreaterThan(0);
  });

  it('loads only records that parse with their zod schema', async () => {
    const loaded = await loadHere();
    for (const spec of TABLES) {
      const records = spec.collection === 'settings' ? [loaded.settings] : Object.values(loaded[spec.collection] as object);
      for (const record of records) {
        const parsed = spec.schema.safeParse(record);
        expect(parsed.success, `${spec.table}: ${parsed.error?.message ?? ''}`).toBe(true);
      }
    }
  });

  it('keeps the server columns that the save step writes', async () => {
    const { rows } = await db.query(`select count(*)::integer as n from comments where project_id is null`);
    expect(rows[0].n).toBe(0);
    const { rows: tasks } = await db.query(`select search_text from tasks order by ord limit 1`);
    expect(tasks[0].search_text).toBe(TABLES.find((spec) => spec.collection === 'tasks')!.serverColumns!.search_text(Object.values(seed.tasks)[0], seed));
  });
});
