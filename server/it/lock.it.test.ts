import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyCall } from '../../src/api/registry';
import { sharedCalls } from '../../src/api/sharedCalls';
import { LOCK_SQL } from '../core/lock';
import { createRunCall, runCall, sqlData, type CallData } from '../core/runCall';
import type { RunResult } from '../core/types';
import type { Row } from '../data/loaders/query';
import { mapWith, newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 5 of TM 7: the office lock under parallel writes (plan 4.5; task C3), on the production pgDb with real commits. Each
 * parallel call runs on an isolate of its own (its own connections). It needs the local stack and the Docker lock.
 */

const ADMIN = 'usr_001';

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

const numberOf = (id: string) => Number(id.slice(id.indexOf('_') + 1));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('suite 5: the office lock under parallel writes, on the local database', () => {
  let office: ItOffice;

  beforeAll(async () => {
    office = await startOffice('lock');
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  it('runs 20 parallel tasks.create: all succeed, the IDs are unique with no gap, and the event seq rises with no gap', async () => {
    const leader = office.seed.projects.prj_001.leaderId!;
    const [{ n: lastTask }] = await office.sql<{ n: number }>("select n from counters where prefix = 'tsk'");
    const [{ max: lastSeq }] = await office.sql<{ max: number }>('select max(seq)::integer as max from events');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      runCall(office.isolate(), { principal: { userId: leader }, name: 'tasks.create', input: { projectId: 'prj_001', title: `Parallel ${i}` }, batch: newBatch() })));
    const ids = results.map((result) => okOf<{ task: { id: string } }>(result).task.id);
    expect(ids.map(numberOf).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => lastTask + 1 + i));
    const events = await office.sql<{ seq: number; correlation_id: string }>('select seq, correlation_id from events where seq > $1 order by ord', [lastSeq]);
    const seqs = events.map((event) => event.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => lastSeq + 1 + i));
    expect(new Set(events.map((event) => event.correlation_id))).toEqual(new Set(results.map((r) => (r.ok ? r.storyId : ''))));
  }, 60_000);

  it('runs tasks.complete and tasks.delete on one task at once: one wins, and the other runs on the state that the first left', async () => {
    const task = Object.values(office.seed.tasks).find((t) => t.projectId === 'prj_003' && t.status !== 'done')!;
    const [complete, remove] = await Promise.all([
      runCall(office.isolate(), { principal: { userId: ADMIN }, name: 'tasks.complete', input: { id: task.id }, batch: newBatch() }),
      runCall(office.isolate(), { principal: { userId: ADMIN }, name: 'tasks.delete', input: { id: task.id }, batch: newBatch() }),
    ]);
    expect(complete.ok || remove.ok).toBe(true);
    const rows = await office.sql('select id from tasks where id = $1', [task.id]);
    const seqOf = async (result: RunResult) => (result.ok
      ? (await office.sql<{ seq: number }>('select seq from events where correlation_id = $1 order by seq', [result.storyId])).map((e) => e.seq)
      : []);
    if (complete.ok && remove.ok) {
      // complete ran first; delete then removed the done task, and its events come after.
      expect(Math.min(...(await seqOf(remove)))).toBeGreaterThan(Math.max(...(await seqOf(complete))));
      expect(rows).toEqual([]);
    } else if (remove.ok) {
      // delete ran first; complete then found no task.
      expect(complete.ok ? '' : complete.error.code).toBe('not_found');
      expect(rows).toEqual([]);
    } else {
      expect(rows).toEqual([{ id: task.id }]);
    }
  }, 60_000);

  it('lets a read run while another transaction holds the office lock: it does not wait', async () => {
    const holder = await office.client();
    await holder.query('begin');
    await holder.query(LOCK_SQL, [office.lockKey]);
    try {
      const started = performance.now();
      const result = await runCall(office.isolate(), { principal: { userId: ADMIN }, name: 'projects.get', input: { id: 'prj_001' }, batch: newBatch() });
      expect(result.ok).toBe(true);
      expect(performance.now() - started).toBeLessThan(2000);
    } finally {
      await holder.query('rollback');
    }
  }, 30_000);

  it('never shows half a story to a read: a write that commits during the read is not in any of its reads', async () => {
    const leader = office.seed.projects.prj_001.leaderId!;
    const seen: Row[] = [];
    let selects = 0;
    // The read pauses after its first select, a write commits, and then the read goes on with its other selects. The write runs
    // in the test body, outside the read's transaction context (pgDb refuses a transaction inside another).
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const pausing = (deps: Parameters<typeof sqlData>[0]): CallData => {
      const data = sqlData(deps);
      return {
        office: data.office,
        tx: (mode, work) => data.tx(mode, (t) => work({
          ...t,
          source: () => {
            const src = t.source();
            return {
              ...src,
              async select(s) {
                const rows = await src.select(s);
                seen.push(...rows);
                selects += 1;
                if (selects === 1) {
                  reached();
                  await gate;
                }
                return rows;
              },
            };
          },
        })),
      };
    };
    const reading = createRunCall({ data: pausing })(office.isolate(), { principal: { userId: leader }, name: 'tasks.list', input: { projectId: 'prj_001' }, batch: newBatch() });
    await paused;
    const write = await runCall(office.isolate(), { principal: { userId: leader }, name: 'tasks.create', input: { projectId: 'prj_001', title: 'During the read' }, batch: newBatch() });
    open();
    const read = await reading;
    expect(read.ok).toBe(true);
    expect(selects).toBeGreaterThan(1);
    const created = okOf<{ task: { id: string } }>(write);
    const storyId = write.ok ? write.storyId : '';
    expect(await office.sql('select id from tasks where id = $1', [created.task.id])).toHaveLength(1);
    expect(seen.filter((row) => row.doc.id === created.task.id || row.doc.correlationId === storyId)).toEqual([]);
    expect(JSON.stringify(read.ok ? read.output : null)).not.toContain(created.task.id);
  }, 30_000);

  it('gives failed with the reason busy after the 5 s lock_timeout, and the call writes nothing', async () => {
    const holder = await office.client();
    await holder.query('begin');
    await holder.query(LOCK_SQL, [office.lockKey]);
    const [{ count: before }] = await office.sql<{ count: string }>('select count(*) from clients');
    try {
      const deps = office.isolate();
      const started = performance.now();
      const result = await runCall(deps, { principal: { userId: ADMIN }, name: 'clients.create', input: { name: 'Waits' }, batch: newBatch() });
      const waited = performance.now() - started;
      expect(result.ok ? null : [result.error.code, result.error.details?.reason]).toEqual(['failed', 'busy']);
      expect(waited).toBeGreaterThan(4500);
      expect(waited).toBeLessThan(9000);
      expect(deps.logs.filter((line) => line.level === 'error')).toEqual([]);
    } finally {
      await holder.query('rollback');
    }
    expect(await office.sql<{ count: string }>('select count(*) from clients')).toEqual([{ count: before }]);
  }, 30_000);

  it('runs a preflight of 10 s outside the lock: another write commits while it waits', async () => {
    const real = sharedCalls['clients.create'] as AnyCall;
    const slow = createRunCall({ calls: mapWith('clients.create', real, { preflight: () => sleep(10_000) }) });
    const started = performance.now();
    const waiting = slow(office.isolate(), { principal: { userId: ADMIN }, name: 'clients.create', input: { name: 'After a slow preflight' }, batch: newBatch() });
    await sleep(300);
    const quick = await runCall(office.isolate(), { principal: { userId: ADMIN }, name: 'clients.create', input: { name: 'Meanwhile' }, batch: newBatch() });
    expect(quick.ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(5000);
    expect((await waiting).ok).toBe(true);
    expect(performance.now() - started).toBeGreaterThan(10_000);
  }, 30_000);
});
