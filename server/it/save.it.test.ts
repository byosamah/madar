import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import { save } from '../data/save';
import { pgDb, type PgDb } from '../data/sql';
import { loadWhole, writeState } from '../data/whole';
import { applyMigrations, dropSchema, localClient, localDbUrl } from './migrate';

/**
 * The save step and pgDb on the local stack (plan 4.5, 4.8; task C1). It applies the non-platform migrations into a schema of its
 * own, writes the sample office as madar_server through pgDb, and checks each save rule with real commits. It needs the local
 * stack (`supabase start`) and the Docker lock. It talks only to 127.0.0.1.
 *
 * madar_server connects straight to Postgres (port 54322) with its schema in the startup options: the local pooler connects to
 * Postgres as postgres (proof.md, E1, fact 2), so only a direct connection runs as the server role. The pooler path is proved
 * by server/it/workerdb.it.test.ts.
 */

const TODAY = '2026-10-04';
const SERVER_PASSWORD = 'madar-local-test';
const STORY = { storyId: 'sty_c1', actorId: 'usr_002' };

describe('the save step on the local database, as madar_server', () => {
  const schema = `madar_c1_${process.pid}`;
  let admin: pg.Client;
  let db: PgDb;
  let seed: State;

  /** One write transaction of the server: the save of the change that "edit" makes to the office as the database holds it. */
  async function change(edit: (state: State) => void) {
    const before = await db.tx('read', (q) => loadWhole(q, { today: TODAY }));
    const after = structuredClone(before);
    edit(after);
    return db.tx('write', (q) => save(q, before, after, { story: STORY }));
  }

  const one = async <R,>(text: string, values?: unknown[]) => (await admin.query(text, values)).rows[0] as R;
  const meta = () => one<{ version: string; office_seq: string }>(`select version, office_seq from ${schema}.office_meta`);

  beforeAll(async () => {
    admin = await localClient();
    await applyMigrations(admin, schema);
    await admin.query(`alter role madar_server login password '${SERVER_PASSWORD}'`);
    const url = new URL(localDbUrl());
    url.username = 'madar_server';
    url.password = SERVER_PASSWORD;
    url.searchParams.set('options', `-c search_path=${schema}`);
    db = pgDb({ writeUrl: url.toString(), readUrl: url.toString() });
    seed = await buildSeed(TODAY, async () => undefined);
    await db.tx('write', (q) => writeState(q, seed));
  }, 60_000);

  afterAll(async () => {
    await db?.close();
    if (!admin) return;
    await admin.query('alter role madar_server nologin password null');
    await dropSchema(admin, schema);
    await admin.end();
  });

  it('runs as madar_server, and gives the sample office back exactly through writeState and loadWhole', async () => {
    const [who] = await db.statement<{ user: string }>('read', 'select current_user as user');
    expect(who.user).toBe('madar_server');
    const loaded = await db.tx('read', (q) => loadWhole(q, { today: TODAY }));
    const expected = JSON.parse(JSON.stringify(seed)) as State;
    for (const key of Object.keys(expected) as (keyof State)[]) {
      if (key === 'session' || key === 'version' || key === 'seededOn') continue;
      expect(loaded[key], key).toStrictEqual(expected[key]);
    }
    expect(Object.keys(loaded.tasks)).toEqual(Object.keys(seed.tasks));
  });

  it('updates a row in place and keeps its ord; a new row goes last; a row that comes back after a delete gets a new ord', async () => {
    const [first, second] = Object.keys(seed.tasks);
    const ordOf = async (id: string) => Number((await one<{ ord: string }>(`select ord from ${schema}.tasks where id = $1`, [id])).ord);
    const firstOrd = await ordOf(first);
    await change((state) => {
      state.tasks[first].title = 'Renamed in place';
    });
    expect(await ordOf(first)).toBe(firstOrd);
    const { max } = await one<{ max: string }>(`select max(ord) as max from ${schema}.tasks`);

    let kept: State['tasks'][string] | undefined;
    await change((state) => {
      kept = state.tasks[second];
      delete state.tasks[second];
      state.tasks.tsk_c1_new = { ...state.tasks[first], id: 'tsk_c1_new', title: 'New' };
    });
    expect(await ordOf('tsk_c1_new')).toBeGreaterThan(Number(max));
    await change((state) => {
      state.tasks[second] = kept!;
    });
    expect(await ordOf(second)).toBeGreaterThan(await ordOf('tsk_c1_new'));
    const loaded = await db.tx('read', (q) => loadWhole(q, { withEvents: false }));
    expect(Object.keys(loaded.tasks).slice(-2)).toEqual(['tsk_c1_new', second]);
    expect(loaded.tasks[first].title).toBe('Renamed in place');
    expect((await one<{ search_text: string }>(`select search_text from ${schema}.tasks where id = $1`, [first])).search_text).toBe('renamed in place');
  });

  it('raises the office version once for office rows, sets chg, and records office deletes', async () => {
    const before = await meta();
    const [client] = Object.keys(seed.clients);
    const [team] = Object.keys(seed.teams ?? {});
    const result = await change((state) => {
      state.clients[client].name = 'Renamed client';
      delete state.teams![team];
    });
    const after = await meta();
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    expect(result.officeVersion).toBe(Number(after.version));
    expect((await one<{ chg: string }>(`select chg from ${schema}.clients where id = $1`, [client])).chg).toBe(after.version);
    expect(await one(`select tbl, id, chg from ${schema}.office_deletes where id = $1`, [team])).toEqual({ tbl: 'teams', id: team, chg: after.version });

    await change((state) => {
      Object.values(state.tasks)[0].title = 'Not an office row';
    });
    expect((await meta()).version).toBe(after.version);
  });

  it('numbers the office signals and the person signals each on their own channel, gap-free', async () => {
    const start = await meta();
    const office = await change((state) => {
      Object.values(state.tasks)[0].flagged = !Object.values(state.tasks)[0].flagged;
    });
    expect(office.signals.map((s) => [s.channel, s.seq])).toEqual([['office', Number(start.office_seq) + 1]]);
    expect(office.signals[0]).toMatchObject({ storyId: STORY.storyId, actorId: STORY.actorId, people: [] });

    const read = Object.values(seed.chatReads)[0];
    const seqOf = async () => Number((await one<{ seq?: string }>(`select seq from ${schema}.person_seq where user_id = $1`, [read.userId]))?.seq ?? 0);
    const personBefore = await seqOf();
    const personal = await change((state) => {
      Object.values(state.chatReads)[0].lastReadAt = '2026-10-04T12:00:00.000+03:00';
    });
    expect(personal.signals.map((s) => [s.channel, s.seq])).toEqual([[`person:${read.userId}`, personBefore + 1]]);
    expect(await seqOf()).toBe(personBefore + 1);
    // A personal change raises no office number, so other screens see no gap.
    expect((await meta()).office_seq).toBe(String(Number(start.office_seq) + 1));
  });

  it('stores an undo event, never writes undoneBy, and fills it on the next load', async () => {
    const x = Object.values(seed.events)[0];
    await change((state) => {
      const seq = Math.max(...Object.values(state.events).map((e) => e.seq)) + 1;
      state.events.evt_c1_undo = { ...state.events[x.id], id: 'evt_c1_undo', seq, verb: 'undo', undoes: x.id, undoneBy: null };
      state.events[x.id].undoneBy = 'evt_c1_undo';
      state.counters.evt = seq;
    });
    const stored = await one<{ doc: { undoneBy: unknown } }>(`select doc from ${schema}.events where id = $1`, [x.id]);
    expect(stored.doc.undoneBy).toBeNull();
    const loaded = await db.tx('read', (q) => loadWhole(q));
    expect(loaded.events[x.id].undoneBy).toBe('evt_c1_undo');
  });

  it('fails a save that changes an old event, and writes nothing of it', async () => {
    const before = await meta();
    await expect(change((state) => {
      Object.values(state.clients)[0].name = 'Never saved';
      Object.values(state.events)[0].verb = 'task.forged';
    })).rejects.toThrow(/History only grows/);
    expect(await meta()).toEqual(before);
    expect((await one<{ n: number }>(`select count(*)::int as n from ${schema}.clients where doc->>'name' = 'Never saved'`)).n).toBe(0);
  });

  it('checks the deferred foreign keys inside the save, so a task of a missing project fails the call', async () => {
    await expect(change((state) => {
      state.tasks.tsk_c1_orphan = { ...Object.values(state.tasks)[0], id: 'tsk_c1_orphan', projectId: 'prj_missing' };
    })).rejects.toThrow(/foreign key/);
    expect((await one<{ n: number }>(`select count(*)::int as n from ${schema}.tasks where id = 'tsk_c1_orphan'`)).n).toBe(0);
  });

  it('looks up the project of a comment whose target the call did not load', async () => {
    const task = Object.values(seed.tasks)[0];
    const before = await db.tx('read', (q) => loadWhole(q, { withEvents: false }));
    const after = structuredClone(before);
    after.comments.cmt_c1 = { ...Object.values(after.comments)[0], id: 'cmt_c1', targetType: 'task', targetId: task.id };
    // The call loaded no task: only the comment is in the State.
    before.tasks = {};
    after.tasks = {};
    const result = await db.tx('write', (q) => save(q, before, after, { story: STORY }));
    expect([...result.projects]).toEqual([task.projectId]);
    expect((await one<{ project_id: string }>(`select project_id from ${schema}.comments where id = 'cmt_c1'`)).project_id).toBe(task.projectId);
  });
});

describe('pgDb on the local database', () => {
  let admin: pg.Client;
  let a: PgDb;
  let b: PgDb;

  beforeAll(async () => {
    admin = await localClient();
    a = pgDb({ writeUrl: localDbUrl(), readUrl: localDbUrl() });
    b = pgDb({ writeUrl: localDbUrl(), readUrl: localDbUrl() });
  });

  afterAll(async () => {
    await Promise.all([a?.close(), b?.close()]);
    await admin?.end();
  });

  it('sets the timeouts with set local, so they end with the transaction and never stay on the connection', async () => {
    const inside = await a.tx('write', async (q) => {
      const [lock] = await q<{ lock_timeout: string }>('show lock_timeout');
      const [statement] = await q<{ statement_timeout: string }>('show statement_timeout');
      return [lock.lock_timeout, statement.statement_timeout];
    });
    expect(inside).toEqual(['5s', '10s']);
    const [after] = await a.statement<{ lock_timeout: string }>('write', 'show lock_timeout');
    expect(after.lock_timeout).toBe('0');
  });

  it('runs a read in a read only transaction', async () => {
    await expect(a.tx('read', (q) => q('create temporary table c1_probe (n int)'))).rejects.toThrow(/read-only/);
  });

  it('gives up on the office lock after 5 s with the lock timeout, while another transaction holds it', async () => {
    const key = 7_310_777;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = a.tx('write', async (q) => {
      await q('select pg_advisory_xact_lock($1)', [key]);
      locked();
      await held;
    });
    await isLocked;
    const started = Date.now();
    const error = await b.tx('write', (q) => q('select pg_advisory_xact_lock($1)', [key])).catch((e: { code?: string }) => e);
    release();
    await holder;
    expect((error as { code?: string }).code).toBe('55P03');
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
    expect(Date.now() - started).toBeLessThan(9000);
    // The lock went with the holder's commit.
    await b.tx('write', (q) => q('select pg_advisory_xact_lock($1)', [key]));
  }, 20_000);

  it('refuses a nested transaction on the real pools, and the outer one rolls back', async () => {
    await expect(a.tx('write', () => b.tx('read', async () => 1))).rejects.toThrow(/nested/);
    expect(await a.tx('read', async (q: Query) => (await q<{ n: number }>('select 1 as n'))[0].n)).toBe(1);
  });
});
