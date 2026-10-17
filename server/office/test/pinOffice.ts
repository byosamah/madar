import { DurableObject } from 'cloudflare:workers';
import { emptyState, type State } from '../../../src/api/store';
import { createRunCall } from '../../core/runCall';
import type { RunResult } from '../../core/types';
import { liteData } from '../../data/lite/callData';
import { liteDb, type LiteDb } from '../../data/lite/db';
import { hostChecks } from '../../data/lite/hostChecks';
import { writeOfficeSnapshot, type OfficeLists } from '../../data/lite/office';
import { insertRow } from '../../data/lite/save';
import { applyLiteSchema } from '../../data/lite/schema';
import { liteLoadWhole, liteWriteState } from '../../data/lite/whole';
import type { Row } from '../../data/rows';
import { TABLES } from '../../data/tables';
import { fakeDeps, type FakeDeps } from '../../test/fakes/deps';
import { doHost, type DoHost, type TraceLine } from '../doHost';

/**
 * The office object of test:office (Supabase exit, wave 1). It runs the real runCall on the SQLite path with the fakes of the
 * server tests, and gives back the rows that each request read and wrote, schema check included (the cold wake pin). With
 * trace, it also gives each statement of the call with its rows.
 */
export type PinCall = { name: string; input: unknown; actorId: string; now: string; key?: string; trace?: boolean };
export type Rows = { rowsRead: number; rowsWritten: number };
export type PinAnswer = { result: RunResult; rows: Rows; trace?: TraceLine[] };

export interface PinOfficeApi {
  hostChecks(): Promise<Record<string, string>>;
  writeState(state: State): Promise<Rows>;
  load(table: string, rows: Row[]): Promise<Rows>;
  finish(lists: OfficeLists, counters: Record<string, number>): Promise<Rows>;
  call(c: PinCall): Promise<PinAnswer>;
  readBack(): Promise<State>;
  statTables(): Promise<number>;
  dropIndex(name: string): Promise<void>;
}

type Parts = { host: DoHost; db: LiteDb; deps: FakeDeps };
const EMPTY = emptyState('');
const run = createRunCall({ data: liteData });

export class PinOffice extends DurableObject implements PinOfficeApi {
  #parts?: Parts;

  async #ready(): Promise<Parts> {
    if (!this.#parts) {
      const host = doHost(this.ctx.storage);
      await applyLiteSchema(host);
      const db = liteDb(host);
      this.#parts = { host, db, deps: fakeDeps({ db }) };
    }
    return this.#parts;
  }

  /** The work of one request, with the rows it read and wrote; a new host counts its schema check too. */
  async #measured<T>(work: (parts: Parts) => Promise<T>): Promise<[T, Rows]> {
    const before = this.#parts ? { ...this.#parts.host.totals } : { rowsRead: 0, rowsWritten: 0 };
    const parts = await this.#ready();
    const out = await work(parts);
    return [out, { rowsRead: parts.host.totals.rowsRead - before.rowsRead, rowsWritten: parts.host.totals.rowsWritten - before.rowsWritten }];
  }

  async hostChecks(): Promise<Record<string, string>> {
    return hostChecks(doHost(this.ctx.storage));
  }

  async writeState(state: State): Promise<Rows> {
    return (await this.#measured(({ db }) => db.tx('write', (q) => liteWriteState(q, state))))[1];
  }

  /**
   * Rows of one table as Task 17 makes them (doc and server columns), with no diff: the import of the year office. The schema
   * makes the settings row of a new office, so the import replaces that one row. Every other row is new.
   */
  async load(table: string, rows: Row[]): Promise<Rows> {
    const spec = TABLES.find((one) => one.table === table);
    if (!spec) throw new Error(`No table ${table}.`);
    const onConflict = spec.collection === 'settings' ? 'update' : 'fail';
    return (await this.#measured(({ db }) => db.tx('write', async (q) => {
      for (const row of rows) await insertRow(q, spec, row, EMPTY, onConflict);
    })))[1];
  }

  /** The end of an import: the counters, a new office version, and the snapshot of the office lists. */
  async finish(lists: OfficeLists, counters: Record<string, number>): Promise<Rows> {
    return (await this.#measured(({ db }) => db.tx('write', async (q) => {
      for (const [prefix, n] of Object.entries(counters)) await q('insert into counters (prefix, n) values (?, ?) on conflict (prefix) do update set n = excluded.n', [prefix, n]);
      const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
      await writeOfficeSnapshot(q, lists, Number(meta.version));
    })))[1];
  }

  async call(c: PinCall): Promise<PinAnswer> {
    let trace: TraceLine[] | undefined;
    const [result, rows] = await this.#measured(async ({ host, deps }) => {
      host.trace = c.trace ? [] : undefined;
      deps.clock.set(new Date(c.now));
      try {
        return await run(deps, { principal: { userId: c.actorId }, name: c.name, input: c.input, batch: { storyRefs: new Map(), overviewCalls: 0 }, ...(c.key ? { key: c.key } : {}) });
      } finally {
        trace = host.trace;
        host.trace = undefined;
      }
    });
    return { result, rows, ...(trace ? { trace } : {}) };
  }

  async readBack(): Promise<State> {
    const { db } = await this.#ready();
    return db.tx('read', (q) => liteLoadWhole(q));
  }

  async statTables(): Promise<number> {
    const { host } = await this.#ready();
    return Number(host.exec("select count(*) as n from sqlite_master where name like 'sqlite_stat%'", []).rows[0].n);
  }

  async dropIndex(name: string): Promise<void> {
    if (!/^[a-z_]+$/.test(name)) throw new Error(`Not an index name: ${name}`);
    this.ctx.storage.sql.exec(`drop index if exists ${name}`);
  }

  /**
   * The cold wake test calls through fetch: an RPC stub that Node holds keeps the object awake (map of schema and tests), and
   * the proxy of miniflare frees a stub only after Node collects it. So the rows pins send every method of the year office
   * through /rpc ({ method, args }), and Node holds no stub to that object when it evicts it.
   */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/call' && request.method === 'POST') return Response.json(await this.call((await request.json()) as PinCall));
    if (path === '/rpc' && request.method === 'POST') {
      const { method, args } = (await request.json()) as { method: string; args: unknown[] };
      if (!FETCH_METHODS.has(method)) return Response.json({ error: `No method ${method}.` }, { status: 404 });
      try {
        const work = this[method as keyof PinOfficeApi] as (...values: unknown[]) => Promise<unknown>;
        return Response.json({ value: (await work.apply(this, args)) ?? null });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
      }
    }
    return new Response('not found', { status: 404 });
  }
}

const FETCH_METHODS = new Set<string>(['hostChecks', 'writeState', 'load', 'finish', 'call', 'readBack', 'statTables', 'dropIndex'] satisfies (keyof PinOfficeApi)[]);
