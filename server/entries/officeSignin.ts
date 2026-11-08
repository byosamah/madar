import { ENT_VADO, normalizeEmail, untag, type EnterpriseId } from '../enterprise/ids';
import type { JSONWebKeySet } from 'jose';
import { CLIENT_ADDRESS_HEADER, FORGOT_MIN_MS, FORGOT_PATH } from '../auth/forgot';
import type { OpInput, OpOutput, OpResult, SigninOffice, SigninOpName } from '../auth/own/office';
import { ownApiRoutes } from '../auth/own/routes';
import { GOOGLE_CALLBACK_PATH, callbackRedirect } from '../google/callback';
import { RENEW_MIN_MS, RENEW_PATH } from '../auth/renew';
import type { TokenChecker } from '../auth/verify';
import type { Deps } from '../core/ports';
import { errorResponse } from '../http/errors';
import { readBody } from '../http/limits';
import type { RouteDef } from '../http/routes';
import type { OfficeMailAnswer, OfficeMailRoute } from '../office/parts';
import { officeErrorOf, type OfficeCall, type OfficeRoute } from './officeWorker';

/**
 * The own sign-in routes of the office path (exit waves 2 and 3), under /api: the routes of ownApiRoutes (server/auth/own/routes.ts)
 * with the steps in the office object. The Worker does the HTTP part only (the body, the address, the browser token check); each
 * step is one call of Office.signin. The forgot and renew routes need the database, so they run in two object calls: mailRoute
 * (the shape check and the limits) before the answer, and mailWork (the mail) after it. The Worker pads the answer to the minimum
 * time of the route, so the time of the answer does not tell a known email from an unknown one.
 */

/** One answer for an input that names no listed enterprise: the real step runs on the empty tables of the platform object. */
const REFUSABLE: Readonly<Record<string, 'auth.password' | 'auth.verify' | 'auth.refresh'>> = {
  'auth.password': 'auth.password', 'auth.verify': 'auth.verify', 'auth.refresh': 'auth.refresh',
};

/**
 * The SigninOffice of one request on the Worker (Madar enterprises, design 5.2). The first steps find the enterprise themselves:
 * - auth.password: the enterprise of the normalized email, from the directory of the platform object.
 * - auth.refresh and auth.verify: the tag of the refresh token or the link token (<ent>.<secret>). The object gets the bare secret.
 * An unknown email, an untagged text, a malformed tag and an unlisted enterprise all go to platform.refuseSignin with the text as it
 * came: the real step runs on empty tables, so the answer and the time match a wrong credential, and no object is made.
 * Every other step belongs to a signed-in person: it goes to the enterprise of the signed token claim.
 */
export function enterpriseSigninOffice(call: Pick<OfficeCall, 'router' | 'platform'>): SigninOffice {
  const refuse = <N extends SigninOpName>(name: N, input: OpInput<N>) =>
    call.platform.refuseSignin({ signin: REFUSABLE[name], input }) as Promise<OpResult<OpOutput<N>>>;
  return {
    async run<N extends SigninOpName>(name: N, input: OpInput<N>, ent?: EnterpriseId): Promise<OpResult<OpOutput<N>>> {
      if (name === 'auth.password') {
        const given = input as OpInput<'auth.password'>;
        const found = await call.platform.resolveEmail({ email: normalizeEmail(given.email) });
        const target = found ? await call.router.listedStub(found.ent) : null;
        if (!target) return refuse(name, input);
        return target.stub.signin({ ent: target.ent, signin: name, input }) as Promise<OpResult<OpOutput<N>>>;
      }
      if (name === 'auth.refresh' || name === 'auth.verify') {
        const text = name === 'auth.refresh' ? (input as OpInput<'auth.refresh'>).refreshToken : (input as OpInput<'auth.verify'>).token;
        const tag = untag(text);
        const target = tag ? await call.router.listedStub(tag.ent) : null;
        if (!tag || !target) return refuse(name, input);
        const bare = name === 'auth.refresh' ? { ...input, refreshToken: tag.secret } : { ...input, token: tag.secret };
        return target.stub.signin({ ent: target.ent, signin: name, input: bare }) as Promise<OpResult<OpOutput<N>>>;
      }
      // A step of a signed-in person: the signed claim names the enterprise. A token with no claim never gets here on the own key.
      if (!ent) return { ok: false, error: { code: 'unauthenticated', message: 'Sign in to continue.' } };
      return call.router.stub(ent).signin({ ent, signin: name, input }) as Promise<OpResult<OpOutput<N>>>;
    },
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

/** The route list needs only the paths and methods: no step of this office ever runs. */
const NO_OFFICE: SigninOffice = { run: () => Promise.reject(new Error('This route list only names the paths.')) };

export function officeSigninRoutes(o: OfficeSigninOptions): OfficeRoute[] {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const options = { jwks: o.jwks, ...(o.checkToken ? { checkToken: o.checkToken } : {}) };
  const routesOf = (office: SigninOffice): RouteDef[] => ownApiRoutes(office, options);
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
        answer = await call.router.stub(ENT_VADO).mailRoute({ ent: ENT_VADO, route, body, address }, net);
      } catch (error) {
        return errorResponse(officeErrorOf(error, o.deps.log));
      }
      if (answer.work !== undefined) {
        const work = call.router.stub(ENT_VADO).mailWork({ ent: ENT_VADO, route, value: answer.work }, net).catch((error: unknown) => {
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

  // The office path has no Google yet (fbk_022; docs/superpowers/real-build/exit-handoff.md): the callback answers not_ready and calls no
  // object. The log gets the word only, never the query.
  const googleNotReady: OfficeRoute = {
    method: 'GET',
    path: GOOGLE_CALLBACK_PATH,
    handler: async () => {
      o.deps.log.info('The Google callback ended.', { word: 'not_ready' });
      return callbackRedirect(o.deps.config.appUrl, 'google=not_ready');
    },
  };

  return routesOf(NO_OFFICE).map((route): OfficeRoute => {
    if (route.method === 'GET' && route.path === GOOGLE_CALLBACK_PATH) return googleNotReady;
    if (route.method === 'POST' && route.path === FORGOT_PATH) return mailRoute('forgot', route.path, o.minMs?.forgot ?? FORGOT_MIN_MS);
    if (route.method === 'POST' && route.path === RENEW_PATH) return mailRoute('renew', route.path, o.minMs?.renew ?? RENEW_MIN_MS);
    // The routes of the own steps read no deps: each one sends its step to the office object of the request.
    return { method: route.method, path: route.path, handler: (request, call) => routesOf(enterpriseSigninOffice(call)).find(same(route))!.handler(request, o.deps) };
  });
}
