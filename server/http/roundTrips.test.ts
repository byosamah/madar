import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { runInHost } from '../core/after';
import { CLAIM_SQL, registerEffect, registerOutbox } from '../core/effects';
import { memoryData, type MemoryData } from '../core/memoryData';
import type { Db, Deps, Query } from '../core/ports';
import { createRunCall, type CallData, type CallTx } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { META_SQL } from '../data/officeCache';
import { diffState, writeDiff } from '../data/save';
import { NEW_NOTICES_SQL, NOTICE_EFFECT, NOTICE_MAIL_SQL, sendNoticeMail } from '../mail/notices';
import { RESERVE_SQL } from '../mail/quota';
import { fakeDeps } from '../test/fakes/deps';
import { meterPort } from '../usage/meter';
import { apiApp } from './app';

/**
 * The database round trips before the answer (performance audit 2026-10-07: SRV-1, SRV-4, SRV-9). A unit-level count: the real
 * pgDb over a fake pg that counts every query, the real batch route, runCall, meter and notice mail effect. Only the rows come
 * from memory (server/core/memoryData.ts): each step of a call transaction sends the statement that the SQL form sends (the lock,
 * office_meta, one statement for each loader read, the real writeDiff, the outbox insert, the notice producer, the signal), so
 * the counts follow the real code. The story and idempotency rows stay in memory and are not counted (the same in both forms).
 */

const sent: string[] = [];
let preferences: unknown;

/** The answers the fake pg gives: a claimed mail.notice row, its notice and person, a free place in the mail quota. */
function answer(text: string, values: unknown[] = []): unknown[] {
  if (text === CLAIM_SQL) return [{ id: values[0], kind: NOTICE_EFFECT, payload: { notificationId: 'ntf_900' } }];
  if (text === NOTICE_MAIL_SQL) {
    return [{ id: 'ntf_900', trigger: 'task_assigned', user_id: 'usr_005', kind: 'human', active: true, email: 'p5@madar.test', preferences, gender: null }];
  }
  if (text === RESERVE_SQL) return [{ ok: true }];
  if (text.startsWith('update office_meta')) return [{ version: 2, office_seq: 1 }];
  if (text.startsWith('insert into person_seq')) return ((values[0] as string[]) ?? []).map((userId) => ({ user_id: userId, seq: 1 }));
  return [];
}

vi.mock('pg', () => {
  class Client {
    async query(text: string, values?: unknown[]) {
      // A round trip takes time, and it counts when its answer comes: work in flight after the answer does not count before it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      sent.push(text);
      return { rows: answer(text, values) };
    }
    release() {}
    on() {
      return this;
    }
    off() {
      return this;
    }
  }
  class Pool {
    totalCount = 0;
    idleCount = 0;
    on() {
      return this;
    }
    async connect() {
      return new Client();
    }
    async end() {}
  }
  return { default: { Pool }, Pool };
});

const { pgDb } = await import('../data/sql');

const TODAY = '2026-10-04';
const ADMIN = 'usr_001';
const LOCAL = { writeUrl: 'postgres://madar_server:pw@127.0.0.1:54329/postgres', readUrl: 'postgres://madar_server:pw@127.0.0.1:54329/postgres' };

let seed: State;
const undo: (() => void)[] = [];
beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
  preferences = seed.users.usr_005.preferences;
  undo.push(registerEffect(NOTICE_EFFECT, sendNoticeMail));
  // The notice producer of a lead change: one query for the new notices, one mail.notice row (server/mail/notices.ts).
  undo.push(registerOutbox('tasks.update', async (_output, _saved, q) => {
    await q(NEW_NOTICES_SQL, [['usr_005']]);
    return [{ kind: NOTICE_EFFECT, payload: { notificationId: 'ntf_900' } }];
  }));
});
afterAll(() => {
  while (undo.length > 0) undo.pop()!();
});

/** Each Source method sends one statement, as sqlSource does. */
function countingSource(source: ReturnType<CallTx['source']>, q: Query): ReturnType<CallTx['source']> {
  return new Proxy(source, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await q(`select /* loader ${String(key)} */ 1`);
        return value.apply(target, args);
      };
    },
  });
}

/** The memory data, with each transaction on the counting pgDb and each step sending the statements of its SQL form. */
function countingData(mem: MemoryData, db: Db): CallData {
  const inner = mem.data();
  return {
    tx: (mode, work) =>
      db.tx(mode, (q) =>
        inner.tx(mode, (t) =>
          work({
            ...t,
            q,
            lock: async (key) => {
              await q('select pg_advisory_xact_lock($1)', [key]);
              return t.lock(key);
            },
            office: async () => {
              await q(META_SQL);
              return t.office();
            },
            source: () => countingSource(t.source(), q),
            save: async (before, after, o) => {
              await writeDiff(q, diffState(before, after), o);
              return t.save(before, after, o);
            },
            outbox: async (rows) => {
              if (rows.length > 0) await q('insert into outbox (kind, payload) select 1');
              return t.outbox(rows);
            },
          }),
        ),
      ),
    office: () => db.tx('read', async (q) => {
      await q(META_SQL);
      return inner.office();
    }),
  };
}

type Measured = { beforeAnswer: number; total: number; status: number };

async function measure(calls: { name: string; input: unknown }[]): Promise<Measured> {
  const mem = memoryData(seed);
  const db = pgDb(LOCAL);
  // The real meter, and a signal port that sends its one realtime.send statement (server/signal/realtime.ts).
  const deps: Deps = { ...fakeDeps({ db }), meter: meterPort(), signal: { send: async (q) => void (await q('select realtime.send($1)')) } };
  const data = countingData(mem, db);
  const app = apiApp(deps, {
    runCall: createRunCall({ data: () => data }),
    verifyToken: async () => ({ authUserId: 'auth-1' }),
    principalOf: () => ({ userId: ADMIN }),
    readOffice: (): Promise<OfficeSnapshot> => data.office(),
  });
  sent.length = 0;
  const later: Promise<unknown>[] = [];
  const request = new Request('http://127.0.0.1/batch', {
    method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify({ v: 1, calls: calls.map((c, i) => ({ i, ...c })) }),
  });
  const response = await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => app.fetch(request));
  const beforeAnswer = sent.length;
  await Promise.all(later);
  return { beforeAnswer, total: sent.length, status: response.status };
}

describe('the round trips before the answer (performance audit SRV-1, SRV-4, SRV-9)', () => {
  it('a read batch of 4 calls: the sign-in read, 4 read transactions with one start statement each, and no meter', async () => {
    const read = await measure([
      { name: 'projects.get', input: { id: 'prj_001' } },
      { name: 'tasks.list', input: { projectId: 'prj_001' } },
      { name: 'deadlines.list', input: {} },
      { name: 'users.list', input: {} },
    ]);
    console.log('round trips, 4-call read batch:', JSON.stringify(read));
    expect(read.status).toBe(200);
    // Before the audit: 37 before the answer. The sign-in read 4, each entry 4 plus its 3 loader reads, the meter 5.
    // Now: the sign-in read 3, each entry 3 plus its loader reads, and the meter (3) after the answer.
    expect(read).toMatchObject({ beforeAnswer: 27, total: 30 });
  });

  it('a task save that mails one person: the notice mail and the meter go after the answer', async () => {
    const save = await measure([{ name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Roof plan' } } }]);
    console.log('round trips, a task save that mails one person:', JSON.stringify(save));
    expect(save.status).toBe(200);
    // Before the audit: 57 before the answer. The sign-in read 4, the write transaction 22, the notice mail 26, the meter 5.
    // Now: the sign-in read 3 and the write transaction 20 before the answer; the notice mail 16 and the meter 3 after it.
    expect(save).toMatchObject({ beforeAnswer: 23, total: 42 });
  });
});
