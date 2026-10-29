import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';
import { MCP_ALLOW, MCP_DENY } from './tools';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';

/**
 * The folder tools over MCP (fbk_066, owner 2026-10-26). The agent of a person who sees the project makes, renames and deletes a folder and moves a
 * file, with the rights of its person; projects.get lists the folders and files.list gives each folderId. For the agent of a person who does not
 * see a hidden project, every folder tool answers as for a missing record. In process, as hiddenProjectTools.test.ts: prj_005 (leader usr_003,
 * team usr_007) is hidden, with usr_011 chosen; usr_002 is outside it.
 */
const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const NOW = new Date('2026-10-04T06:00:00Z');
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};
const HIDDEN = 'prj_005';

let seed: State;
let stageId: string;
let fileId: string;
const SECRET = 'Secret mood folder';

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  seed.projects[HIDDEN].access = { hidden: true, viewerIds: ['usr_011'] };
  stageId = Object.values(seed.stages).find((s) => s.projectId === HIDDEN)!.id;
  fileId = Object.values(seed.files).find((f) => f.projectId === HIDDEN)!.id;
  seed.projects[HIDDEN].folders = [{ id: 'fld_901', stageId, name: SECRET, createdBy: 'usr_003', createdAt: '2026-10-04T09:00:00.000+03:00' }];
  seed.counters.fld = 901;
});

type World = { app: ReturnType<typeof mcpApp>; deps: FakeDeps; mem: MemoryData };
type Acting = { agentId: string; personId: string };
const agentOf = (personId: string): Acting => ({ agentId: `usr_9${personId.slice(-2)}`, personId });

function world(acting: Acting): World {
  const mem = memoryData(seed);
  mem.tables.state.users[acting.agentId] = { ...mem.tables.state.users.usr_009, id: acting.agentId, email: `${acting.agentId}@madar.test`, ownerId: acting.personId };
  mem.tables.version += 1;
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(NOW);
  const app = mcpApp(deps, {
    checkToken: async () => TOKEN,
    agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: acting.agentId, agent: { clientId: TOKEN.clientId } }, ownerId: acting.personId, linked: false }),
    runCall: createRunCall({ data: () => mem.data() }),
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit: async () => ({ ok: true, count: 1, retryAfterMs: 0 }),
    stateKey: 'k'.repeat(40),
  });
  return { app, deps, mem };
}

let nextRpc = 1;
async function call(w: World, name: string, args: Record<string, unknown>) {
  const response = await w.app.fetch(new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN.token}`,
      'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': name,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: nextRpc++, method: 'tools/call',
      params: {
        name, arguments: args,
        _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-agent', version: '1.0.0' } },
      },
    }),
  }));
  const body = JSON.parse(await response.text()) as { result: Record<string, any> };
  return body.result;
}
const errorOf = (result: Record<string, any>) => ({ isError: result.isError, error: result.structuredContent?.error as { code: string; message: string; details?: unknown } | undefined });
const swap = (value: unknown, id: string) => JSON.parse(JSON.stringify(value ?? null).split(id).join('@')) as unknown;

describe('the folder tools for the agent of a person who sees the project', () => {
  it('make, rename, move into, and delete a folder, and the reads show the folders and the folderId', async () => {
    for (const person of ['usr_003', 'usr_011']) {
      const w = world(agentOf(person));
      const read = await call(w, 'projects.get', { id: HIDDEN });
      expect(read.structuredContent.output.folders.map((f: { name: string }) => f.name), person).toEqual([SECRET]);
      expect(read.structuredContent.output.project.folders).toBeUndefined();
    }
    const w = world(agentOf('usr_003'));
    const made = await call(w, 'folders.create', { projectId: HIDDEN, stageId, name: 'Sketches' });
    expect(made.isError).toBeUndefined();
    const folder = made.structuredContent.output as { id: string; name: string; stageId: string };
    expect(folder).toMatchObject({ name: 'Sketches', stageId });
    expect((await call(w, 'folders.rename', { id: folder.id, name: 'First sketching' })).structuredContent.output.name).toBe('First sketching');
    const moved = await call(w, 'files.move', { id: fileId, stageId, folderId: folder.id });
    expect(moved.structuredContent.output.file).toMatchObject({ stageId, folderId: folder.id });
    const listed = await call(w, 'files.list', { projectId: HIDDEN });
    expect(listed.structuredContent.output.find((view: { file: { id: string } }) => view.file.id === fileId).file.folderId).toBe(folder.id);
    expect((await call(w, 'folders.delete', { id: folder.id })).structuredContent.output).toEqual({ deleted: true });
    const after = await call(w, 'files.list', { projectId: HIDDEN });
    expect(after.structuredContent.output.find((view: { file: { id: string } }) => view.file.id === fileId).file.folderId).toBeNull();
  });
});

describe('the folder tools for the agent of a person who does not see the hidden project', () => {
  it('answer as for a missing record, and show no folder name', async () => {
    const w = world(agentOf('usr_002'));
    const probes: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
      ['folders.create', { projectId: HIDDEN, stageId, name: 'Mine' }, { projectId: 'prj_999', stageId, name: 'Mine' }, HIDDEN],
      ['folders.rename', { id: 'fld_901', name: 'Mine' }, { id: 'fld_999', name: 'Mine' }, 'fld_901'],
      ['folders.delete', { id: 'fld_901' }, { id: 'fld_999' }, 'fld_901'],
      ['files.move', { id: fileId, stageId, folderId: 'fld_901' }, { id: 'fil_999', stageId, folderId: 'fld_901' }, fileId],
      ['projects.get', { id: HIDDEN }, { id: 'prj_999' }, HIDDEN],
      ['files.list', { projectId: HIDDEN }, { projectId: 'prj_999' }, HIDDEN],
    ];
    for (const [name, hidden, gone, id] of probes) {
      const a = errorOf(await call(w, name, hidden));
      const b = errorOf(await call(w, name, gone));
      expect(a.isError, name).toBe(true);
      expect(a.error?.code, name).toBe('not_found');
      expect(swap(a, id), name).toEqual(swap(b, JSON.stringify(gone).match(/"([a-z]{3}_999)"/)![1]));
      expect(JSON.stringify(a), name).not.toContain(SECRET);
    }
    expect(JSON.stringify((await call(w, 'projects.list', {})).structuredContent)).not.toContain(SECRET);
    expect(JSON.stringify((await call(w, 'events.list', { limit: 500 })).structuredContent)).not.toContain(SECRET);
  });
});

describe('the lists and the words of the folder tools', () => {
  it('put the five tools on the allow list, each with a short doc, and tell the agent about folders in the instructions', () => {
    for (const name of ['folders.create', 'folders.rename', 'folders.setLock', 'folders.delete', 'files.move']) {
      expect(MCP_ALLOW as readonly string[], name).toContain(name);
      expect(MCP_DENY as readonly string[], name).not.toContain(name);
      expect(TOOL_DOCS[name].description.length, name).toBeLessThanOrEqual(600);
      expect(TOOL_DOCS[name].description, name).not.toMatch(/[–—]/);
    }
    expect(INSTRUCTIONS).toContain('Folders:');
    expect(INSTRUCTIONS).not.toMatch(/[–—]/);
    expect(TOOL_DOCS['files.list'].description).toContain('folderId');
    expect(TOOL_DOCS['projects.get'].description).toContain('folders');
  });
});

/**
 * The locked folders over MCP (fbk_074, owner 2026-10-29). prj_001 is open. Its folder fld_902 is locked and holds one file. The agent of the Admin
 * (usr_001, who holds the switch "Locked folders") sees and changes the folder. The agent of a person without the switch (usr_002) finds no trace of
 * the folder or the file, and every tool that names them answers as for a missing record.
 */
describe('the locked folder tools', () => {
  const OPEN = 'prj_001';
  const LOCKED_NAME = 'Signed papers';
  let lockedFile: string;
  beforeAll(() => {
    lockedFile = Object.values(seed.files).find((f) => f.projectId === OPEN)!.id;
    seed.projects[OPEN].folders = [{ id: 'fld_902', stageId: null, name: LOCKED_NAME, createdBy: 'usr_002', createdAt: '2026-10-04T09:00:00.000+03:00', locked: true }];
    // A locked folder holds no file of a to-do and no cover, so the sample file leaves its task.
    seed.files[lockedFile] = { ...seed.files[lockedFile], stageId: null, taskId: null, folderId: 'fld_902' };
    if (seed.projects[OPEN].coverFileId === lockedFile) seed.projects[OPEN].coverFileId = null;
    seed.counters.fld = 902;
  });

  it('shows the folder and its file to the agent of a holder, and lets it lock and unlock', async () => {
    const w = world(agentOf('usr_001'));
    const read = await call(w, 'projects.get', { id: OPEN });
    expect(read.structuredContent.output.folders).toEqual([expect.objectContaining({ id: 'fld_902', name: LOCKED_NAME, locked: true })]);
    const listed = await call(w, 'files.list', { projectId: OPEN });
    expect(listed.structuredContent.output.map((view: { file: { id: string } }) => view.file.id)).toContain(lockedFile);
    const open = await call(w, 'folders.setLock', { id: 'fld_902', locked: false });
    expect(open.isError).toBeUndefined();
    expect(open.structuredContent.output.locked).toBeUndefined();
    const again = await call(w, 'folders.setLock', { id: 'fld_902', locked: true });
    expect(again.structuredContent.output.locked).toBe(true);
  });

  it('answers the agent of a person without the switch as for a missing record, and shows no name', async () => {
    const w = world(agentOf('usr_002'));
    const probes: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
      ['folders.setLock', { id: 'fld_902', locked: false }, { id: 'fld_999', locked: false }, 'fld_902'],
      ['folders.rename', { id: 'fld_902', name: 'Mine' }, { id: 'fld_999', name: 'Mine' }, 'fld_902'],
      ['folders.delete', { id: 'fld_902' }, { id: 'fld_999' }, 'fld_902'],
      ['files.move', { id: lockedFile, stageId: null, folderId: null }, { id: 'fil_999', stageId: null, folderId: null }, lockedFile],
      ['files.delete', { id: lockedFile }, { id: 'fil_999' }, lockedFile],
      ['files.link', { id: lockedFile, variant: 'full', disposition: 'inline' }, { id: 'fil_999', variant: 'full', disposition: 'inline' }, lockedFile],
    ];
    for (const [name, hidden, gone, id] of probes) {
      const a = errorOf(await call(w, name, hidden));
      const b = errorOf(await call(w, name, gone));
      expect(a.isError, name).toBe(true);
      expect(a.error?.code, name).toBe('not_found');
      expect(swap(a, id), name).toEqual(swap(b, JSON.stringify(gone).match(/"([a-z]{3}_999)"/)![1]));
      expect(JSON.stringify(a).split(id).join('@'), name).not.toContain(LOCKED_NAME);
    }
    const read = await call(w, 'projects.get', { id: OPEN });
    expect(read.structuredContent.output.folders).toEqual([]);
    const listed = await call(w, 'files.list', { projectId: OPEN });
    expect(listed.structuredContent.output.map((view: { file: { id: string } }) => view.file.id)).not.toContain(lockedFile);
    for (const [name, args] of [['projects.list', {}], ['events.list', { limit: 500 }], ['search.query', { text: LOCKED_NAME }], ['files.list', { projectId: OPEN }]] as const) {
      expect(JSON.stringify((await call(w, name, args)).structuredContent), name).not.toMatch(new RegExp(`${LOCKED_NAME}|fld_902|${lockedFile}`));
    }
  });

  it('refuses the lock to the agent of a person without the switch on a folder that the person sees', async () => {
    const w = world(agentOf('usr_002'));
    const made = await call(w, 'folders.create', { projectId: OPEN, name: 'Site photos' });
    const id = made.structuredContent.output.id as string;
    const refused = errorOf(await call(w, 'folders.setLock', { id, locked: true }));
    expect(refused.error).toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
  });
});
