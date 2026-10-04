import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/errors';
import { SERVER_CALL_NAMES } from '../src/api/contract/server';
import { SERVER_EXCLUDED } from '../src/api/sharedCalls';
import { SERVER_CALLS, SERVER_HOOKS } from './calls/index';
import { ROUTES } from './http/routes';
import { r2FilesPort } from './files/r2';
import { supabaseStorageFilesPort } from './files/supabaseStorage';
import { mcpApp } from './mcp/app';
import { jobsApp } from './jobs/app';
import { meterPort } from './usage/meter';
import worker from './entries/worker';
import { fakeDeps } from './test/fakes/deps';
import { noDb } from './test/fakes/db-none';

/** Each stub keeps its final signature and refuses with ApiError('failed') until its owner track replaces the body (plan 6.1, rule 5). */
async function refusesNotBuilt(work: () => Promise<unknown>) {
  const error = await work().then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe('failed');
}

const deps = fakeDeps();
const office = { version: 0, lists: {} } as never;
const ctx = { deps, principal: { userId: 'usr_001' }, office, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: new Date() };

describe('the registries', () => {
  it('list the 9 server calls by name, and every stub refuses until its track builds it (story.start: server/core/runCall.test.ts; users.invites and users.resendInvite: server/calls/people.test.ts; the file calls: server/calls/{files,feedback}.test.ts)', async () => {
    expect(Object.keys(SERVER_CALLS).sort()).toEqual([...SERVER_CALL_NAMES].sort());
    const built = ['story.start', 'users.invites', 'users.resendInvite', 'files.uploadStart', 'files.link', 'feedback.uploadStart'];
    for (const name of SERVER_CALL_NAMES.filter((n) => !built.includes(n))) await refusesNotBuilt(() => SERVER_CALLS[name](undefined as never, ctx));
  });

  it('hold the server hooks of files.upload, feedback.send, feedback.screenshot and projects.delete, never for an excluded call', async () => {
    expect(Object.keys(SERVER_HOOKS).sort()).toEqual(['feedback.screenshot', 'feedback.send', 'files.upload', 'projects.delete']);
    for (const name of Object.keys(SERVER_HOOKS)) expect(SERVER_EXCLUDED as readonly string[]).not.toContain(name);
    // Track F built every hook (server/calls/{files,feedback}.test.ts): each one has its functions.
    expect(Object.fromEntries(Object.entries(SERVER_HOOKS).map(([name, hooks]) => [name, Object.keys(hooks ?? {}).sort()]))).toEqual({
      'files.upload': ['preflight', 'prepare'],
      'feedback.send': ['preflight', 'prepare'],
      'feedback.screenshot': ['preflight'],
      'projects.delete': ['prepare'],
    });
  });

  it('hold the extra HTTP route of the api function: POST /auth/forgot', async () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /auth/forgot']);
    // Track P built it (server/auth/forgot.test.ts): a request with no email gets 400 before any database work.
    expect((await ROUTES[0].handler(new Request('http://127.0.0.1/api/auth/forgot', { method: 'POST' }), deps)).status).toBe(400);
  });
});

describe('the stubs', () => {
  it('the two file stores name their kind and limit (they are built: server/files/*.test.ts)', () => {
    const supabase = supabaseStorageFilesPort({ supabaseUrl: 'http://127.0.0.1:54321', secretKey: 'x', bucket: 'madar-files' });
    expect([supabase.kind, supabase.maxFileBytes]).toEqual(['supabase', 50 * 1024 * 1024]);
    const r2 = r2FilesPort({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'madar-files' });
    expect([r2.kind, r2.maxFileBytes]).toEqual(['r2', 250 * 1024 * 1024]);
  });

  it('the MCP app, the jobs app and the Workers entry answer 501 until built, so a mounted stub never crashes a host', async () => {
    for (const app of [mcpApp(deps), jobsApp(deps)]) {
      const response = await app.fetch(new Request('http://127.0.0.1/run', { method: 'POST' }));
      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({ error: { code: 'failed' } });
    }
    // Track E4 built the Workers entry: with its values, it mounts the MCP stub, which still answers 501.
    const bindings = { DATABASE_URL: 'postgres://u:p@127.0.0.1:54329/postgres', SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'x', APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <a@madar.test>', MAIL_DRIVER: 'outbox' };
    const response = await worker.fetch(new Request('http://127.0.0.1/mcp', { method: 'POST' }), bindings);
    expect(response.status).toBe(501);
  });

  it('the meter does nothing until track M fills it', async () => {
    const meter = meterPort();
    meter.addBytes(10);
    await expect(meter.countRequest(noDb)).resolves.toBeUndefined();
  });
});
