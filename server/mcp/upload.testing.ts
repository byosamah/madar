import type { State } from '../../src/api/store';
import { OUTBOX_INSERT_SQL } from '../core/effects';
import { memoryData, type MemoryData } from '../core/memoryData';
import type { Db } from '../core/ports';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { KEYS_IN_USE_SQL } from '../files/effects';
import { fakeFilesDb, type FakeFilesDb } from '../files/fakeFilesDb';
import { INTENT_INSERT_SQL, INTENTS_SELECT_SQL, INTENTS_USE_SQL } from '../files/intents';
import { MEETING_DOC_SQL, TASK_DOC_SQL, TASK_PROJECT_SQL } from '../files/records';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import type { FakeFiles } from '../test/fakes/files';
import { browserPut, storedContent } from '../test/uploads';
import { mcpApp } from './app';
import type { AgentPrincipal } from './auth';
import { MCP_URL, TOKEN, type World } from './bulk.testing';

/**
 * The harness of the upload tests (owner, 2026-10-26): the MCP app of bulk.testing.ts with the real runCall on the memory office, plus the
 * three things an upload needs that the memory data has not. The upload intents live in the fake files database (server/files/fakeFilesDb.ts),
 * which also answers the task and meeting reads of the start call. The fetch that puts the bytes to the signed link writes the object into the
 * fake file store, as a browser does (server/test/uploads.ts), and logs each PUT. Only tests import this file.
 */

export type Put = { url: string; headers: Record<string, string>; size: number };
export type UploadWorld = World & { deps: FakeDeps; filesDb: FakeFilesDb; puts: Put[]; files: FakeFiles; content: Map<string, Blob>; failPut: { status: number | 'network' | null } };

const INTENT_STATEMENTS: ReadonlySet<string> = new Set([INTENT_INSERT_SQL, INTENTS_SELECT_SQL, INTENTS_USE_SQL, OUTBOX_INSERT_SQL, KEYS_IN_USE_SQL]);

/** A world where the agent usr_950 acts for the given person. `prepare` changes the office before the first request. */
export function uploadWorld(seed: State, personId: string, prepare?: (state: State) => void, o: { maxFileBytes?: number } = {}): UploadWorld {
  const agentId = 'usr_950';
  const mem: MemoryData = memoryData(seed);
  mem.tables.state.users[agentId] = { ...mem.tables.state.users.usr_009, id: agentId, email: `${agentId}@madar.test`, ownerId: personId };
  prepare?.(mem.tables.state);
  mem.tables.version += 1;
  const filesDb = fakeFilesDb();
  const state = () => mem.tables.state;
  const db: Db = {
    ...mem.db,
    async statement<R>(mode: 'read' | 'write', text: string, values: unknown[] = []): Promise<R[]> {
      if (INTENT_STATEMENTS.has(text)) return filesDb.statement<R>(mode, text, values);
      if (text === TASK_DOC_SQL) {
        const task = state().tasks[String(values[0])];
        return (task ? [{ doc: task }] : []) as R[];
      }
      if (text === TASK_PROJECT_SQL) {
        const task = state().tasks[String(values[0])];
        return (task ? [{ project_id: task.projectId }] : []) as R[];
      }
      if (text === MEETING_DOC_SQL) {
        const meeting = state().meetings?.[String(values[0])];
        return (meeting ? [{ doc: meeting }] : []) as R[];
      }
      return mem.db.statement<R>(mode, text, values);
    },
  };
  const deps = fakeDeps({ db, config: { mcpUrl: MCP_URL, ...(o.maxFileBytes ? { limits: { maxFileBytes: o.maxFileBytes, filesTotalBytes: 1024 * 1024 * 1024 } } : {}) } });
  deps.clock.set(new Date('2026-10-04T06:00:00Z'));
  const content = storedContent(deps.files);
  const puts: Put[] = [];
  const failPut: UploadWorld['failPut'] = { status: null };
  // The store: the PUT writes the object at the key of the signed link, with the signed type and the size of the body.
  const storeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body as Uint8Array;
    const headers = init?.headers as Record<string, string>;
    puts.push({ url: String(url), headers, size: body.byteLength });
    if (failPut.status === 'network') throw new TypeError('fetch failed');
    if (failPut.status !== null) return new Response('<Error><Code>InternalError</Code></Error>', { status: failPut.status });
    browserPut(deps.files, { url: String(url), headers }, new Blob([body as BlobPart]));
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const hits = { count: 0 };
  const app = mcpApp(deps, {
    checkToken: async () => TOKEN,
    agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: agentId, agent: { clientId: TOKEN.clientId } }, ownerId: personId, linked: false }),
    runCall: createRunCall({
      data: () => {
        const data = mem.data();
        // The save step marks the upload intent used inside the transaction: its query goes to the fake files database.
        return { ...data, tx: (mode, work) => data.tx(mode, (t) => work({ ...t, q: ((text: string, values?: unknown[]) => (INTENT_STATEMENTS.has(text) ? filesDb.q(text, values) : t.q(text, values))) as typeof t.q })) };
      },
    }),
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit: async () => ({ ok: true, count: ++hits.count, retryAfterMs: 0 }),
    stateKey: 'k'.repeat(40),
    storeFetch,
  });
  return { app, mem, agentId, hits, deps, filesDb, puts, files: deps.files, content, failPut };
}

/** The base64 text of some bytes. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** Some bytes that are not all alike, so a copy that lost or moved bytes shows. */
export function sampleBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += 1) bytes[at] = (at * 31 + (at >> 8)) & 0xff;
  return bytes;
}
