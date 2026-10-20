import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import { createOfficeCache, OFFICE_ROWS_SQL, setAuthUserId, userIdOfAuth } from '../data/officeCache';
import { save } from '../data/save';
import { loadWhole, writeState } from '../data/whole';
import { applyMigrations, dropSchema, localClient } from './migrate';

/**
 * The office cache on the local database (plan 4.7; task C2), with real saves through save.ts: a change of one project reloads one
 * row, a delete arrives through office_deletes, a cache that may have missed a delete loads everything again, and the objects are
 * frozen. It needs the local stack and the Docker lock, and talks only to 127.0.0.1.
 */

const TODAY = '2026-10-04';
const STORY = { storyId: 'sty_c2', actorId: 'usr_001' };

describe('the office cache on the local database', () => {
  const schema = `madar_c2_cache_${process.pid}`;
  let db: pg.Client;
  /** The office rows that each refresh read, by the version it asked above. */
  const refreshes: { above: number; rows: number }[] = [];
  const q: Query = async <R,>(text: string, values?: unknown[]) => {
    const rows = (await db.query(text, values)).rows as R[];
    if (text === OFFICE_ROWS_SQL) refreshes.push({ above: Number(values![0]), rows: rows.length });
    return rows;
  };
  const deps = { db: undefined as never };

  async function inTx<T>(mode: 'read' | 'write', work: () => Promise<T>): Promise<T> {
    await db.query(mode === 'read' ? 'begin isolation level repeatable read, read only' : 'begin');
    try {
      const result = await work();
      await db.query('commit');
      return result;
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  }

  /** One write of the server: the save of the change that "edit" makes to the office in the database. */
  async function change(edit: (state: State) => void) {
    return inTx('write', async () => {
      const before = await loadWhole(q, { today: TODAY });
      const after = structuredClone(before);
      edit(after);
      return save(q, before, after, { story: STORY });
    });
  }

  beforeAll(async () => {
    db = await localClient();
    await applyMigrations(db, schema);
    await db.query(`set search_path to ${schema}`);
    const seed = await buildSeed(TODAY, async () => undefined);
    await inTx('write', () => writeState(q, seed));
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await dropSchema(db, schema);
    await db.end();
  });

  it('loads the office once, then reloads one row for a change of one project, and drops a row deleted through office_deletes', async () => {
    const cache = createOfficeCache();
    const first = await inTx('read', () => cache.read(deps, q));
    expect(Object.keys(first.lists.projects).length).toBe(12);
    expect(refreshes.at(-1)).toMatchObject({ above: -1 });
    expect(await inTx('read', () => cache.read(deps, q))).toBe(first);

    const saved = await change((state) => {
      state.projects.prj_002.name = 'Renamed in the cache test';
    });
    expect(saved.officeVersion).toBe(first.version + 1);
    const second = await inTx('read', () => cache.read(deps, q));
    expect(refreshes.at(-1)).toEqual({ above: first.version, rows: 1 });
    expect(second.lists.projects.prj_002.name).toBe('Renamed in the cache test');
    expect(Object.keys(second.lists.projects)).toEqual(Object.keys(first.lists.projects));

    const key = Object.keys(second.lists.members)[0];
    await change((state) => {
      delete state.members[key];
    });
    const third = await inTx('read', () => cache.read(deps, q));
    expect(refreshes.at(-1)).toEqual({ above: second.version, rows: 0 });
    expect(third.lists.members[key]).toBeUndefined();
    expect(Object.keys(third.lists.members).length).toBe(Object.keys(second.lists.members).length - 1);
  });

  it('a task change does not move the version, so the cache reads only office_meta', async () => {
    const cache = createOfficeCache();
    const first = await inTx('read', () => cache.read(deps, q));
    const count = refreshes.length;
    await change((state) => {
      const task = Object.values(state.tasks)[0];
      task.title = 'A task title';
    });
    expect(await inTx('read', () => cache.read(deps, q))).toBe(first);
    expect(refreshes.length).toBe(count);
  });

  it('loads everything again when the cache may have missed a delete that the job removed', async () => {
    const cache = createOfficeCache({ keepMs: 0 });
    await inTx('read', () => cache.read(deps, q));
    await change((state) => {
      state.clients[Object.keys(state.clients)[0]].name = 'Client renamed';
    });
    const snapshot = await inTx('read', () => cache.read(deps, q));
    expect(refreshes.at(-1)?.above).toBe(-1);
    expect(Object.values(snapshot.lists.clients)[0].name).toBe('Client renamed');
  });

  it('never serves the rows of a transaction that rolled back, when a later commit reuses its version number', async () => {
    const cache = createOfficeCache();
    const warm = await inTx('read', () => cache.read(deps, q));
    await db.query('begin');
    try {
      const before = await loadWhole(q, { today: TODAY });
      const after = structuredClone(before);
      after.projects.prj_003.name = 'Rolled back';
      await save(q, before, after, { story: STORY });
      // The same transaction reads the cache after its own save, as an effect builder of runCall may.
      const inside = await cache.read(deps, q);
      expect(inside.version).toBe(warm.version + 1);
      expect(inside.lists.projects.prj_003.name).toBe('Rolled back');
    } finally {
      await db.query('rollback');
    }
    expect(cache.version()).toBe(warm.version);
    await change((state) => {
      state.projects.prj_004.name = 'Committed instead';
    });
    const later = await inTx('read', () => cache.read(deps, q));
    expect(later.version).toBe(warm.version + 1);
    expect(later.lists.projects.prj_003.name).toBe(warm.lists.projects.prj_003.name);
    expect(later.lists.projects.prj_004.name).toBe('Committed instead');
  });

  it('gives frozen objects, and a warm cache finds a sign-in link that setAuthUserId writes and drops a link it clears', async () => {
    const auth = '00000000-0000-4000-8000-000000000001';
    const cache = createOfficeCache();
    const warm = await inTx('read', () => cache.read(deps, q));
    expect(() => {
      (warm.lists.users.usr_002 as { name: string }).name = 'Changed';
    }).toThrow(TypeError);
    expect(userIdOfAuth(warm, auth)).toBeUndefined();
    expect(await inTx('write', () => setAuthUserId(q, 'usr_002', auth))).toBe(true);
    const linked = await inTx('read', () => cache.read(deps, q));
    expect(refreshes.at(-1)).toEqual({ above: warm.version, rows: 1 });
    expect(userIdOfAuth(linked, auth)).toBe('usr_002');
    await inTx('write', () => setAuthUserId(q, 'usr_002', null));
    const cleared = await inTx('read', () => cache.read(deps, q));
    expect(userIdOfAuth(cleared, auth)).toBeUndefined();
    expect(cleared.lists.users.usr_002).toEqual(warm.lists.users.usr_002);
  });
});
