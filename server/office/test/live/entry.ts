import { ApiError } from '../../../../src/api/errors';
import { consoleLogger } from '../../../core/deps';
import { officeRoutes, type OfficeStub } from '../../../entries/officeWorker';
import { setEnvSource } from '../../../env';
import { testConfig } from '../../../test/fakes/deps';
import { fakeFiles } from '../../../test/fakes/files';
import { fakeMail } from '../../../test/fakes/mail';
import { WorkerNet } from '../../workerNet';
import { TestOffice } from './testOffice';

export { TestOffice };

type Env = Record<string, unknown> & { OFFICE: { idFromName(name: string): unknown; get(id: unknown): unknown } };
type Ctx = { waitUntil(work: Promise<unknown>): void };
type Test = OfficeStub & Pick<TestOffice, 'seed' | 'readBack' | 'rows' | 'exec'>;

// The network of the test Worker: files and mail in memory, and a push service that takes every push. /test/net shows them.
const files = fakeFiles({ kind: 'r2' });
const mail = fakeMail();
const pushes: { endpoint: string; headers: Record<string, string> }[] = [];
const pushFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  pushes.push({ endpoint: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
  return new Response(null, { status: 201 });
}) as typeof fetch;

const stubOf = (env: Env) => env.OFFICE.get(env.OFFICE.idFromName('office')) as Test;
const routes = officeRoutes({
  deps: { config: testConfig({ fileStore: 'r2' }), clock: { now: () => new Date() }, log: consoleLogger() },
  // No sign-in here: the token is the Madar user id (TestOffice.principal checks that the person acts now).
  verifyToken: async (header) => {
    const token = (header ?? '').replace(/^Bearer /, '');
    if (!/^usr_\d{3}$/.test(token)) throw new ApiError('unauthenticated', 'Sign in to Madar again.');
    return { authUserId: token };
  },
  stub: (env) => stubOf(env as Env),
  net: () => new WorkerNet({ files, mail, fetch: pushFetch }),
  jobsSecret: () => 'test-jobs-secret',
});

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    setEnvSource(env);
    const { pathname } = new URL(request.url);
    if (pathname === '/test/net') return Response.json({ files: files.calls, mails: mail.sent, pushes });
    if (pathname === '/test/seed') {
      await stubOf(env).seed(await request.json());
      return Response.json({ ok: true });
    }
    if (pathname === '/test/readBack') return Response.json(await stubOf(env).readBack());
    if (pathname === '/test/rows') {
      const { text, values } = (await request.json()) as { text: string; values?: unknown[] };
      return Response.json(await stubOf(env).rows(text, values));
    }
    if (pathname === '/test/exec') {
      const { text, values } = (await request.json()) as { text: string; values?: unknown[] };
      await stubOf(env).exec(text, values);
      return Response.json({ ok: true });
    }
    return routes.fetch(request, env, ctx);
  },
};
