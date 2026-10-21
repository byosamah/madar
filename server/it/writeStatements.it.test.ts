import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps, Query } from '../core/ports';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { META_COUNTERS_SQL, META_SQL } from '../data/officeCache';
import { COUNTERS_SELECT_SQL } from '../data/rows';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * The statements of a write on the local database (performance audit DB-12): the counters of the office come with the first
 * statement after the office lock, so the loader sends no select of its own for them. A read never asks for them.
 * It needs the local stack and the Docker lock.
 */

function okOf<T = Record<string, unknown>>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

describe('a write asks for the counters with office_meta, as madar_server', () => {
  let office: ItOffice;
  let deps: ReturnType<ItOffice['isolate']>;
  let log: string[];
  let seen: Deps;

  beforeAll(async () => {
    office = await startOffice('wstm');
    deps = office.isolate();
    log = [];
    // The same Db, with each statement of a transaction written down in order.
    seen = {
      ...deps,
      db: {
        ...deps.db,
        tx: (mode, work) =>
          deps.db.tx(mode, (q) =>
            work((async (text: string, values?: unknown[]) => {
              log.push(text);
              return q(text, values);
            }) as Query),
          ),
      },
    } as Deps;
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  const run = (userId: string, name: string, input: unknown) => runCall(seen, { principal: { userId }, name, input, batch: newBatch() });
  const counter = async (prefix: string) => Number((await office.sql<{ n: string }>('select n from counters where prefix = $1', [prefix]))[0].n);

  it('sends no select of the counters, and sends office_meta with them right after the lock', async () => {
    const leader = office.seed.projects.prj_001.leaderId!;
    const before = await counter('tsk');
    log.length = 0;
    const { task } = okOf<{ task: { id: string } }>(await run(leader, 'tasks.create', { projectId: 'prj_001', title: 'Counted with office_meta' }));
    expect(log).not.toContain(COUNTERS_SELECT_SQL);
    expect(log).not.toContain(META_SQL);
    const lock = log.findIndex((text) => text.includes('pg_advisory_xact_lock'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(log[lock + 1]).toBe(META_COUNTERS_SQL);
    // The number is still the next one, and the table holds it.
    expect(await counter('tsk')).toBe(before + 1);
    expect(task.id).toMatch(/^tsk_/);
    expect(Number(task.id.slice(4))).toBe(before + 1);
  });

  it('gives the next number again for a second write, so no number repeats and none is skipped', async () => {
    const leader = office.seed.projects.prj_001.leaderId!;
    const before = await counter('tsk');
    const a = okOf<{ task: { id: string } }>(await run(leader, 'tasks.create', { projectId: 'prj_001', title: 'First' }));
    const b = okOf<{ task: { id: string } }>(await run(leader, 'tasks.create', { projectId: 'prj_001', title: 'Second' }));
    expect([Number(a.task.id.slice(4)), Number(b.task.id.slice(4))]).toEqual([before + 1, before + 2]);
    expect(await counter('tsk')).toBe(before + 2);
  });

  it('keeps the plain office_meta statement, with no counters, for a read', async () => {
    log.length = 0;
    okOf(await run('usr_005', 'dashboard.get', {}));
    expect(log).toContain(META_SQL);
    expect(log).not.toContain(META_COUNTERS_SQL);
    expect(log).not.toContain(COUNTERS_SELECT_SQL);
  });
});
