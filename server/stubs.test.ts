import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/errors';
import { SERVER_CALL_NAMES } from '../src/api/contract/server';
import { SERVER_EXCLUDED } from '../src/api/sharedCalls';
import { SERVER_CALLS, SERVER_HOOKS } from './calls/index';
import { ROUTES } from './http/routes';
import { r2FilesPort } from './files/r2';
import { supabaseStorageFilesPort } from './files/supabaseStorage';
import { resendMailPort } from './mail/resend';
import { outboxMailPort } from './mail/outboxDriver';
import { realtimeSignalPort } from './signal/realtime';
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
  it('list the 9 server calls by name, and every stub refuses until its track builds it (story.start is built: server/core/runCall.test.ts)', async () => {
    expect(Object.keys(SERVER_CALLS).sort()).toEqual([...SERVER_CALL_NAMES].sort());
    for (const name of SERVER_CALL_NAMES.filter((n) => n !== 'story.start')) await refusesNotBuilt(() => SERVER_CALLS[name](undefined as never, ctx));
  });

  it('hold the server hooks of files.upload, feedback.send, feedback.screenshot and projects.delete, never for an excluded call', async () => {
    expect(Object.keys(SERVER_HOOKS).sort()).toEqual(['feedback.screenshot', 'feedback.send', 'files.upload', 'projects.delete']);
    for (const name of Object.keys(SERVER_HOOKS)) expect(SERVER_EXCLUDED as readonly string[]).not.toContain(name);
    const hookCtx = { actorId: 'usr_001', now: new Date(), deps };
    const q = (async () => []) as never;
    await refusesNotBuilt(async () => SERVER_HOOKS['files.upload']?.preflight?.({} as never, hookCtx));
    await refusesNotBuilt(async () => SERVER_HOOKS['files.upload']?.prepare?.({} as never, { ...hookCtx, q }, undefined));
    await refusesNotBuilt(async () => SERVER_HOOKS['feedback.send']?.prepare?.({} as never, { ...hookCtx, q }, undefined));
    // A read call: its preflight value reaches run() as "prepared", so the stub must refuse with an ApiError before run() reads it.
    await refusesNotBuilt(async () => SERVER_HOOKS['feedback.screenshot']?.preflight?.({ id: 'fbk_001', index: 0 } as never, hookCtx));
    // Until track F lists the stored files, projects.delete removes no stored data, so the db-mode tests of D2 pass before F merges.
    await expect(SERVER_HOOKS['projects.delete']?.prepare?.({ id: 'prj_001' } as never, { ...hookCtx, q }, undefined)).resolves.toEqual({ blobKeys: [] });
  });

  it('hold the extra HTTP route of the api function: POST /auth/forgot', async () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /auth/forgot']);
    await refusesNotBuilt(() => ROUTES[0].handler(new Request('http://127.0.0.1/api/auth/forgot', { method: 'POST' }), deps));
  });
});

describe('the stubs', () => {
  it('the signal sender refuses (the database is built: server/data/sql.test.ts; runCall is built: server/core/runCall.test.ts)', async () => {
    await refusesNotBuilt(() => realtimeSignalPort.send((async () => []) as never, []));
  });

  it('the two file stores name their kind and limit, and refuse', async () => {
    const supabase = supabaseStorageFilesPort({ supabaseUrl: 'http://127.0.0.1:54321', secretKey: 'x', bucket: 'madar-files' });
    expect([supabase.kind, supabase.maxFileBytes]).toEqual(['supabase', 50 * 1024 * 1024]);
    const r2 = r2FilesPort({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'madar-files' });
    expect([r2.kind, r2.maxFileBytes]).toEqual(['r2', 250 * 1024 * 1024]);
    for (const port of [supabase, r2]) {
      await refusesNotBuilt(() => port.presignPut('k', { mimeType: 'image/png' }));
      await refusesNotBuilt(() => port.presignGet('k', { disposition: 'inline', filename: 'a.png', mimeType: 'image/png' }));
      await refusesNotBuilt(() => port.head('k'));
      await refusesNotBuilt(() => port.copy('a', 'b'));
      await refusesNotBuilt(() => port.remove(['a']));
    }
  });

  it('mail refuses (the office cache is built: server/data/officeCache.test.ts; the token check and the person lookup are built: server/auth/verify.test.ts, principal.test.ts; the Auth admin is built: server/auth/admin.test.ts)', async () => {
    const mail = { to: 'a@madar.test', subject: 's', html: '', text: '', tag: 't', idempotencyKey: 'k' };
    await refusesNotBuilt(() => resendMailPort({ apiKey: 'x', from: 'Madar <a@madar.test>' }).send(mail));
    await refusesNotBuilt(() => outboxMailPort(noDb).send(mail));
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
