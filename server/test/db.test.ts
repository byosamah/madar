import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Event } from '../../src/api/contract/entities';
import { makeTask, makeWorld, STAMP } from '../../src/test/factories';
import { noDb } from './fakes/db-none';
import { Worker, createGate, downChanges, type Session } from './db';

const ROOT = new URL('../../', import.meta.url);
/** A static import or export of a file: "import type" leaves no module behind, every other form loads its module. */
const STATIC_IMPORT = /^(?:import|export)\s+(?!type\s)(?:[^;'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm;

/** Every file of the repository that loading this file loads at once, by path from the root. dynamic import() is left out. */
function staticGraph(start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const [, spec] of readFileSync(new URL(file, ROOT), 'utf8').matchAll(STATIC_IMPORT)) {
      const base = new URL(spec, new URL(file, ROOT)).pathname.slice(ROOT.pathname.length);
      const found = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find((path) => /\.tsx?$/.test(path) && existsSync(new URL(path, ROOT)));
      if (found && !seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
    }
  }
  return seen;
}

const event = (id: string, over: Partial<Event> = {}): Event => ({
  id, seq: 1, projectId: 'prj_001', actorId: 'usr_001', actorKind: 'human', actingForId: 'usr_001', correlationId: 'cor_a', verb: 'created',
  targetType: 'task', targetId: 'tsk_001', before: null, after: null, createdAt: STAMP, undoneBy: null, ...over,
});

describe('the write-down of the test edits (TM 3.3, step 2)', () => {
  it('writes nothing when the mirror equals the image, also with keys in another order and a missing optional list', () => {
    const image = makeWorld();
    image.teams = {};
    const mirror = structuredClone(image);
    delete mirror.teams;
    const { prj_001: project } = mirror.projects;
    mirror.projects.prj_001 = Object.fromEntries(Object.entries(project).reverse()) as typeof project;
    expect(downChanges(image, mirror)).toEqual({ tables: [], counters: {}, removedCounters: [] });
  });

  it('finds new, changed and removed records, and the counters', () => {
    const image = makeWorld();
    image.tasks.tsk_001 = makeTask();
    const mirror = structuredClone(image);
    mirror.tasks.tsk_002 = makeTask({ id: 'tsk_002' });
    mirror.users.usr_004.name = 'Omar Renamed';
    delete mirror.stages.stg_001;
    mirror.counters.tsk = 2;
    delete mirror.counters.usr;
    const { tables, counters, removedCounters } = downChanges(image, mirror);
    const by = Object.fromEntries(tables.map((t) => [t.spec.table, { deleted: t.deleted, upserts: t.upserts.map((row) => row.id) }]));
    expect(by).toEqual({ users: { deleted: [], upserts: ['usr_004'] }, stages: { deleted: ['stg_001'], upserts: [] }, tasks: { deleted: [], upserts: ['tsk_002'] } });
    expect(counters).toEqual({ tsk: 2 });
    expect(removedCounters).toEqual(['usr']);
  });

  it('marks a change of an old event, and ignores undoneBy, which the database never keeps', () => {
    const image = makeWorld();
    image.events.evt_001 = event('evt_001');
    const filled = structuredClone(image);
    filled.events.evt_001.undoneBy = 'evt_009';
    expect(downChanges(image, filled).tables).toEqual([]);

    const edited = structuredClone(image);
    edited.events.evt_001.createdAt = '2026-09-01T09:00:00.000+03:00';
    const [change] = downChanges(image, edited).tables;
    expect(change).toMatchObject({ touchesOld: true, deleted: [] });

    const added = structuredClone(image);
    added.events.evt_002 = event('evt_002', { seq: 2 });
    expect(downChanges(image, added).tables[0]).toMatchObject({ touchesOld: false });
  });
});

describe('the test gate of the db harness', () => {
  it('lets the calls of the running test through, and refuses a call that comes after its test ended', async () => {
    const gate = createGate();
    gate.start('t1');
    const bind = gate.binding();
    expect(await bind(async () => 'ok')).toBe('ok');
    await gate.end();
    await expect(bind(async () => 'late')).rejects.toThrow(/db mode: this call came after its test ended/);
    gate.start('t2');
    // A backend made in one test never serves the next one.
    await expect(bind(async () => 'late')).rejects.toThrow(/after its test ended/);
    expect(await gate.binding()(async () => 'fresh')).toBe('fresh');
  });

  it('binds a backend made outside a test to the first test that uses it', async () => {
    const gate = createGate();
    const bind = gate.binding();
    gate.start('t1');
    expect(await bind(async () => 1)).toBe(1);
  });

  it('waits at the end of a test for the database step that still runs', async () => {
    const gate = createGate();
    gate.start('t1');
    const steps: string[] = [];
    let finish!: () => void;
    const running = gate.binding()(() => new Promise<void>((resolve) => { finish = resolve; }).then(() => { steps.push('step'); }));
    const ended = gate.end().then(() => steps.push('end'));
    await Promise.resolve();
    finish();
    await Promise.all([running, ended]);
    expect(steps).toEqual(['step', 'end']);
  });
});

describe('the setup file of the db project', () => {
  it('loads no API module that a test file may mock, beyond the ones src/test/factories.ts loads', () => {
    // A test file's vi.mock does not reach a module that the setup file loaded first (stageBackTracker.test.ts mocks permissions).
    expect(staticGraph('server/core/runCall.ts')).toContain('src/api/permissions.ts');
    const setup = staticGraph('server/test/db.ts');
    const factories = staticGraph('src/test/factories.ts');
    expect([...setup].filter((file) => file.startsWith('src/api/') && !factories.has(file))).toEqual([]);
    expect(setup).not.toContain('server/core/runCall.ts');
    expect(setup).not.toContain('server/core/serverCallMap.ts');
  });
});

/** A connection that answers the setup queries of the worker and records every statement. */
function fakeSession(o: { schema: string; currentSchema?: string }): Session & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    db: noDb,
    baseline: 'sum_fresh',
    client: {
      async query(text: string) {
        sql.push(text);
        if (text.includes('current_schema()')) return { rows: [{ s: o.currentSchema ?? o.schema }] };
        if (text.includes('pg_tables')) return { rows: [{ tablename: 'office_meta' }] };
        if (text.includes('md5(')) return { rows: [{ sum: 'sum_fresh' }] };
        return { rows: [] };
      },
    },
    async close() {},
  };
}

describe('the worker of the db harness', () => {
  const provided = { url: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', baselines: {}, run: 'run_test' };

  it('gives each test fresh fakes, so a fake upload of one test is gone in the next', async () => {
    const worker = new Worker({ provided, open: async (w) => fakeSession({ schema: w.schema }) });
    await worker.begin();
    worker.deps.files.objects.set('blob_1', { size: 3, mimeType: 'text/plain' });
    worker.deps.mail.sent.push({ to: 'a@madar.test' } as never);
    await worker.rollback();
    await worker.begin();
    expect(worker.deps.files.objects.size).toBe(0);
    expect(worker.deps.mail.sent).toEqual([]);
    await worker.close();
  });

  it('writes its call count and time into the run folder of the global setup when it closes, for the speed gate', async () => {
    const stats = mkdtempSync(join(tmpdir(), 'madar-worker-stats-'));
    try {
      const worker = new Worker({ provided: { ...provided, stats }, open: async (w) => fakeSession({ schema: w.schema }) });
      await worker.begin();
      await worker.close();
      const files = readdirSync(stats);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^madar_w\d+-[0-9a-f-]+\.json$/);
      expect(JSON.parse(readFileSync(join(stats, files[0]), 'utf8'))).toEqual({ n: 0, ms: 0, standIns: 0 });
      const without = new Worker({ provided, open: async (w) => fakeSession({ schema: w.schema }) });
      await without.begin();
      await without.close();
      expect(readdirSync(stats)).toHaveLength(1);
    } finally {
      rmSync(stats, { recursive: true, force: true });
    }
  });

  it('refuses a connection whose search_path did not take, as through the pooler, and names the direct port', async () => {
    const session = fakeSession({ schema: 'x', currentSchema: 'public' });
    const worker = new Worker({ provided, open: async () => session });
    await expect(worker.begin()).rejects.toThrow(/works in the schema public, not in madar_w\d+.*direct connection.*54322/);
    expect(session.sql.some((text) => text === 'begin')).toBe(false);
  });
});
