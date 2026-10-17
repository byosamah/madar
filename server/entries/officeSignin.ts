import type { JSONWebKeySet } from 'jose';
import { CLIENT_ADDRESS_HEADER, FORGOT_MIN_MS, FORGOT_PATH } from '../auth/forgot';
import type { OpInput, OpOutput, OpResult, SigninOffice, SigninOpName } from '../auth/own/office';
import { ownApiRoutes } from '../auth/own/routes';
import { RENEW_MIN_MS, RENEW_PATH } from '../auth/renew';
import type { TokenChecker } from '../auth/verify';
import type { Deps } from '../core/ports';
import { errorResponse } from '../http/errors';
import { readBody } from '../http/limits';
import type { RouteDef } from '../http/routes';
import type { OfficeMailAnswer, OfficeMailRoute } from '../office/parts';
import { officeErrorOf, type OfficeRoute, type OfficeStub } from './officeWorker';

/**
 * The own sign-in routes of the office path (exit waves 2 and 3), under /api: the routes of ownApiRoutes (server/auth/own/routes.ts)
 * with the steps in the office object. The Worker does the HTTP part only (the body, the address, the browser token check); each
 * step is one call of Office.signin. The forgot and renew routes need the database, so they run in two object calls: mailRoute
 * (the shape check and the limits) before the answer, and mailWork (the mail) after it. The Worker pads the answer to the minimum
 * time of the route, so the time of the answer does not tell a known email from an unknown one.
 */

/** The SigninOffice of one request: each step runs in the office object of that request. */
export function objectSigninOffice(stub: Pick<OfficeStub, 'signin'>): SigninOffice {
  return {
    run: <N extends SigninOpName>(name: N, input: OpInput<N>) => stub.signin({ signin: name, input }) as Promise<OpResult<OpOutput<N>>>,
  };
}

export type OfficeSigninOptions = {
  jwks: JSONWebKeySet;
  /** The deps of the Worker. Its database refuses every statement: no route here reads it. */
  deps: Deps;
  checkToken?: TokenChecker;
  minMs?: Partial<Record<OfficeMailRoute, number>>;
  sleep?: (ms: number) => Promise<void>;
};

const NO_OFFICE: Pick<OfficeStub, 'signin'> = { signin: () => Promise.reject(new Error('This route list only names the paths.')) };

export function officeSigninRoutes(o: OfficeSigninOptions): OfficeRoute[] {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const options = { jwks: o.jwks, ...(o.checkToken ? { checkToken: o.checkToken } : {}) };
  const routesOf = (stub: Pick<OfficeStub, 'signin'>): RouteDef[] => ownApiRoutes(objectSigninOffice(stub), options);
  const same = (a: RouteDef) => (b: RouteDef) => a.method === b.method && a.path === b.path;

  const mailRoute = (route: OfficeMailRoute, path: string, minMs: number): OfficeRoute => ({
    method: 'POST',
    path,
    handler: async (request, call) => {
      const started = performance.now();
      let body = '';
      try {
        body = await readBody(request);
      } catch {
        // A body over the limit: the object answers it as a body with no email or key.
      }
      // The address that the Pages Function wrote (clientAddress on the Workers host).
      const address = request.headers.get(CLIENT_ADDRESS_HEADER)?.trim() || 'unknown';
      const net = call.net();
      let answer: OfficeMailAnswer;
      try {
        answer = await call.stub.mailRoute({ route, body, address }, net);
      } catch (error) {
        return errorResponse(officeErrorOf(error, o.deps.log));
      }
      if (answer.work !== undefined) {
        const work = call.stub.mailWork({ route, value: answer.work }, net).catch((error: unknown) => {
          o.deps.log.warn(route === 'forgot' ? 'A reset mail did not go out.' : 'A renewed invitation did not go out.', { error: error instanceof Error ? error.message : String(error) });
        });
        if (call.after) call.after(work);
        else await work;
      }
      const spent = performance.now() - started;
      if (spent < minMs) await sleep(minMs - spent);
      return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'application/json' } });
    },
  });

  return routesOf(NO_OFFICE).map((route): OfficeRoute => {
    if (route.method === 'POST' && route.path === FORGOT_PATH) return mailRoute('forgot', route.path, o.minMs?.forgot ?? FORGOT_MIN_MS);
    if (route.method === 'POST' && route.path === RENEW_PATH) return mailRoute('renew', route.path, o.minMs?.renew ?? RENEW_MIN_MS);
    // The routes of the own steps read no deps: each one sends its step to the office object of the request.
    return { method: route.method, path: route.path, handler: (request, call) => routesOf(call.stub).find(same(route))!.handler(request, o.deps) };
  });
}
