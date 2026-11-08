import { ApiError } from '../../../../src/api/errors';
import { emptyState } from '../../../../src/api/store';
import { consoleLogger } from '../../../core/deps';
import { officeRoutes, type OfficeStub } from '../../../entries/officeWorker';
import { ENT_VADO, PLATFORM_OBJECT, VADO_ADDRESS } from '../../../enterprise/ids';
import type { PlatformStub } from '../../../enterprise/platform/stub';
import { setEnvSource } from '../../../env';
import { testConfig } from '../../../test/fakes/deps';
import { fakeFiles } from '../../../test/fakes/files';
import { fakeMail } from '../../../test/fakes/mail';
import { WorkerNet } from '../../workerNet';
import { TestOffice } from './testOffice';
import { TestPlatform } from './testPlatform';

export { TestOffice, TestPlatform };

type Namespace = { idFromName(name: string): unknown; get(id: unknown): unknown };
type Env = Record<string, unknown> & { OFFICE: Namespace; PLATFORM: Namespace };
type Ctx = { waitUntil(work: Promise<unknown>): void };
type Test = OfficeStub & Pick<TestOffice, 'seed' | 'readBack' | 'rows' | 'exec' | 'agent' | 'statusRows'>;

// The network of the test Worker: files and mail in memory, and a push service that takes every push. /test/net shows them.
const files = fakeFiles({ kind: 'r2' });
const mail = fakeMail();
const pushes: { endpoint: string; headers: Record<string, string> }[] = [];
const pushFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  pushes.push({ endpoint: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
  return new Response(null, { status: 201 });
}) as typeof fetch;

// The object of the test Worker is named with the enterprise id, as the real Worker names it (the gate compares the name with its row).
const stubOf = (env: Env, ent: string = ENT_VADO) => env.OFFICE.get(env.OFFICE.idFromName(ent)) as Test;
const platformOf = (env: Env) => env.PLATFORM.get(env.PLATFORM.idFromName(PLATFORM_OBJECT)) as unknown as PlatformStub;
const routes = officeRoutes({
  deps: { config: testConfig({ fileStore: 'r2' }), clock: { now: () => new Date() }, log: consoleLogger() },
  // No sign-in here: the token is the Madar user id (TestOffice.principal checks that the person acts now), or "<ent>:<user id>" for an
  // enterprise other than ENT_VADO (the claim ent of a real token).
  verifyToken: async (header) => {
    const token = (header ?? '').replace(/^Bearer /, '');
    const match = /^(?:(ent_\d{3,}):)?(usr_\d{3})$/.exec(token);
    if (!match) throw new ApiError('unauthenticated', 'Sign in to Madar again.');
    return { authUserId: match[2], ...(match[1] ? { ent: match[1] } : {}) };
  },
  stubFor: (env, ent) => stubOf(env as Env, ent),
  platform: (env) => platformOf(env as Env),
  // The office ops of exit wave 4: an object by its name, and the two secrets of this test Worker (harness.ts sends them).
  stubOf: (env, name) => (env as Env).OFFICE.get((env as Env).OFFICE.idFromName(name === 'office' ? ENT_VADO : name)) as Test,
  net: () => new WorkerNet({ files, mail, fetch: pushFetch }),
  jobsSecret: () => 'test-jobs-secret',
  exportSecret: () => 'test-export-secret',
  opsSecret: () => 'test-ops-secret',
});

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    setEnvSource(env);
    const { pathname } = new URL(request.url);
    if (pathname === '/test/net') return Response.json({ files: files.calls, mails: mail.sent, pushes });
    if (pathname === '/test/seed') {
      const ent = new URL(request.url).searchParams.get('ent') ?? ENT_VADO;
      await stubOf(env, ent).seed(await request.json());
      // VADOs' Companies is listed by the platform, as in production: the Worker finds a socket ticket and an MCP address through the list.
      if (ent === ENT_VADO) {
        await platformOf(env).register({
          row: {
            id: ENT_VADO, address: VADO_ADDRESS, name: "VADOs' Companies", nameAr: 'شركات فادو', state: 'active', limits: { people: null, storageBytes: null },
            createdAt: '2026-11-08T08:00:00.000Z', firstAdmin: { name: 'First Admin', email: 'first-admin@vado.test' },
          },
          emails: [],
        });
      }
      return Response.json({ ok: true });
    }
    if (pathname === '/test/platform') {
      // One method of the platform object by name, or resolveRows (the rows of a directory read).
      const { method, args } = (await request.json()) as { method: string; args: unknown[] };
      const platform = platformOf(env) as unknown as Record<string, (...values: unknown[]) => Promise<unknown>>;
      return Response.json({ value: (await platform[method](...args)) ?? null });
    }
    if (pathname === '/test/statusRows') return Response.json(await stubOf(env).statusRows());
    if (pathname === '/test/named') {
      // An object of another name, made with a row of ENT_VADO: the gate compares the name with the row (spike S3).
      const { name } = (await request.json()) as { name: string };
      const other = env.OFFICE.get(env.OFFICE.idFromName(name)) as Test;
      await other.seed(emptyState(''));
      try {
        await other.status({ ent: ENT_VADO });
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ ok: false, code: (error as { code?: string }).code ?? null, message: (error as Error).message });
      }
    }
    if (pathname === '/test/readBack') return Response.json(await stubOf(env).readBack());
    if (pathname === '/test/rows') {
      const { text, values } = (await request.json()) as { text: string; values?: unknown[] };
      return Response.json(await stubOf(env).rows(text, values));
    }
    if (pathname === '/test/agent') {
      const { ownerId } = (await request.json()) as { ownerId: string };
      return Response.json(await stubOf(env).agent(ownerId));
    }
    if (pathname === '/test/exec') {
      const { text, values } = (await request.json()) as { text: string; values?: unknown[] };
      await stubOf(env).exec(text, values);
      return Response.json({ ok: true });
    }
    return routes.fetch(request, env, ctx);
  },
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: Ctx): Promise<void> {
    setEnvSource(env);
    ctx.waitUntil(routes.scheduled(new Date(controller.scheduledTime), env));
  },
};
