import { normalizeEmail, untag, type EnterpriseId } from '../enterprise/ids';
import { padTo } from '../enterprise/pad';
import type { EntStub } from '../enterprise/router';
import type { JSONWebKeySet } from 'jose';
import { googleCallback, GOOGLE_CALLBACK_PATH } from '../google/callback';
import { CLIENT_ADDRESS_HEADER, FORGOT_MIN_MS, FORGOT_PATH, ForgotBody, tooMany as forgotTooMany } from '../auth/forgot';
import type { OpInput, OpOutput, OpResult, SigninOffice, SigninOpName } from '../auth/own/office';
import { ownApiRoutes } from '../auth/own/routes';
import { RENEW_MIN_MS, RENEW_PATH, RenewBody, tooMany as renewTooMany } from '../auth/renew';
import { tooMany as signinTooMany } from '../auth/own/sessions';
import type { TokenChecker } from '../auth/verify';
import type { Deps } from '../core/ports';
import { errorResponse, runErrorOf } from '../http/errors';
import { readBody } from '../http/limits';
import type { RouteDef } from '../http/routes';
import type { OfficeMailAnswer, OfficeMailRoute } from '../office/parts';
import { officeErrorOf, type OfficeCall, type OfficeRoute } from './officeWorker';

/**
 * The own sign-in routes of the office path (exit waves 2 and 3), under /api: the routes of ownApiRoutes (server/auth/own/routes.ts)
 * with the steps in the office object. The Worker does the HTTP part only (the body, the address, the browser token check); each
 * step is one call of Office.signin. The forgot and renew routes need the database, so they run in two object calls: mailRoute
 * (the shape check and the limits) before the answer, and mailWork (the mail) after it. The Worker pads the answer to the minimum
 * time of the route, so the time of the answer does not tell a known email from an unknown one. The Google callback runs in the Worker
 * as it is: it checks the signed state with the Worker values and calls no object (server/google/callback.ts).
 */

/** One answer for an input that names no listed enterprise: the real step runs on the empty tables of the platform object. */
const REFUSABLE: Readonly<Record<string, 'auth.password' | 'auth.verify' | 'auth.refresh'>> = {
  'auth.password': 'auth.password', 'auth.verify': 'auth.verify', 'auth.refresh': 'auth.refresh',
};

/**
 * The SigninOffice of one request on the Worker (Madar enterprises, design 5.2). The first steps find the enterprise themselves:
 * - auth.password: the enterprise of the normalized email, from the directory of the platform object.
 * - auth.refresh and auth.verify: the tag of the refresh token or the link token (<ent>.<secret>). The object gets the bare secret.
 * The limit of the network address of auth.password and auth.verify is counted once, in the platform object, before the enterprise is
 * chosen (platform.hitAddress), so one address has one count whatever the enterprise of the email or of the tag. The object and the refuse
 * step get addressChecked and count the limits of the email only.
 * An unknown email, an untagged text, a malformed tag and an unlisted enterprise all go to platform.refuseSignin with the text as it
 * came: the real step runs on empty tables, so the answer and the time match a wrong credential, and no object is made.
 * Every other step belongs to a signed-in person: it goes to the enterprise of the signed token claim.
 */
export function enterpriseSigninOffice(call: Pick<OfficeCall, 'router' | 'platform'>): SigninOffice {
  const refuse = <N extends SigninOpName>(name: N, input: OpInput<N>) =>
    call.platform.refuseSignin({ signin: REFUSABLE[name], input }) as Promise<OpResult<OpOutput<N>>>;
  /** The one count of the address of a first step. null: under the limit. Else the answer of the step over its limit. */
  const hitAddress = async <N extends 'auth.password' | 'auth.verify'>(name: N, address: string): Promise<OpResult<OpOutput<N>> | null> => {
    const hit = await call.platform.hitAddress({ step: name, address });
    return hit.ok ? null : ({ ok: false, error: runErrorOf(signinTooMany(hit.retryAfterMs)) } as OpResult<OpOutput<N>>);
  };
  return {
    async run<N extends SigninOpName>(name: N, input: OpInput<N>, ent?: EnterpriseId): Promise<OpResult<OpOutput<N>>> {
      if (name === 'auth.password') {
        const given = input as OpInput<'auth.password'>;
        // Before the directory read: the count does not depend on the email, so it says nothing about it.
        const over = await hitAddress(name, given.address);
        if (over) return over as OpResult<OpOutput<N>>;
        const checked = { ...given, addressChecked: true } as OpInput<N>;
        const found = await call.platform.resolveEmail({ email: normalizeEmail(given.email) });
        const target = found ? await call.router.listedStub(found.ent) : null;
        if (!target) return refuse(name, checked);
        return target.stub.signin({ ent: target.ent, signin: name, input: checked }) as Promise<OpResult<OpOutput<N>>>;
      }
      if (name === 'auth.refresh' || name === 'auth.verify') {
        // The refresh token has no limit of the address. The link open has one, counted before the tag is read.
        let checked = input;
        if (name === 'auth.verify') {
          const over = await hitAddress(name, (input as OpInput<'auth.verify'>).address);
          if (over) return over as OpResult<OpOutput<N>>;
          checked = { ...(input as OpInput<'auth.verify'>), addressChecked: true } as OpInput<N>;
        }
        const text = name === 'auth.refresh' ? (input as OpInput<'auth.refresh'>).refreshToken : (input as OpInput<'auth.verify'>).token;
        const tag = untag(text);
        const target = tag ? await call.router.listedStub(tag.ent) : null;
        if (!tag || !target) return refuse(name, checked);
        const bare = name === 'auth.refresh' ? { ...checked, refreshToken: tag.secret } : { ...checked, token: tag.secret };
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

  /**
   * The forgot and renew routes (Madar enterprises, design 5.2). The Worker reads the body once and finds the enterprise: the email
   * through the directory for forgot, the tag of the key for renew. A good enterprise runs the limits in its object (mailRoute) and the
   * mail after the answer (mailWork). Every other case, a body that does not parse included, runs platform.refuseMail: the same limits
   * and the same answer on the empty tables of the platform object, and no work. Every branch ends at the same minimum time (padTo).
   */
  const mailRoute = (route: OfficeMailRoute, path: string, minMs: number): OfficeRoute => ({
    method: 'POST',
    path,
    handler: async (request, call) => {
      const started = performance.now();
      let body = '';
      try {
        body = await readBody(request);
      } catch {
        // A body over the limit: the platform object answers it as a body with no email or key.
      }
      // The address that the Pages Function wrote (clientAddress on the Workers host).
      const address = request.headers.get(CLIENT_ADDRESS_HEADER)?.trim() || 'unknown';
      let answer: OfficeMailAnswer;
      let target: EntStub | null = null;
      let sent = body;
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = undefined;
        }
        const forgotBody = route === 'forgot' ? ForgotBody.safeParse(parsed) : null;
        const renewBody = route === 'renew' ? RenewBody.safeParse(parsed) : null;
        // The count of the address comes first, before the enterprise is chosen, and only for a body that the route counts (a good email or
        // key, as in createForgotRoute and createRenewRoute). A body that does not parse counts nothing and gets the 400 of the refuse step.
        const hit = (forgotBody ?? renewBody)!.success ? await call.platform.hitAddress({ step: route, address }) : null;
        if (hit && !hit.ok) {
          // Over the limit: the same answer for every email and key. No enterprise is chosen and no work follows.
          const over = route === 'forgot' ? forgotTooMany(hit.retryAfterMs) : renewTooMany(hit.retryAfterMs);
          answer = { status: over.status, body: await over.text() };
        } else {
          if (forgotBody) {
            const found = forgotBody.success ? await call.platform.resolveEmail({ email: normalizeEmail(forgotBody.data.email) }) : null;
            target = found ? await call.router.listedStub(found.ent) : null;
          } else if (renewBody) {
            const tag = renewBody.success ? untag(renewBody.data.key) : null;
            target = tag ? await call.router.listedStub(tag.ent) : null;
            // The object keeps the sha256 of the bare key: it gets the bare key.
            if (tag && target) sent = JSON.stringify({ key: tag.secret });
          }
          // addressChecked: the address is counted above, in the platform object. It is on the RPC input only, never from the request body.
          answer = target
            ? await target.stub.mailRoute({ ent: target.ent, route, body: sent, address, addressChecked: true }, call.net(target.ent))
            : await call.platform.refuseMail({ route, body, address, addressChecked: true });
        }
      } catch (error) {
        return errorResponse(officeErrorOf(error, o.deps.log));
      }
      if (answer.work !== undefined && target) {
        const { stub, ent } = target;
        const work = stub.mailWork({ ent, route, value: answer.work }, call.net(ent)).catch((error: unknown) => {
          o.deps.log.warn(route === 'forgot' ? 'A reset mail did not go out.' : 'A renewed invitation did not go out.', { error: error instanceof Error ? error.message : String(error) });
        });
        if (call.after) call.after(work);
        else await work;
      }
      await padTo(started, minMs, sleep);
      return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'application/json' } });
    },
  });

  return routesOf(NO_OFFICE).map((route): OfficeRoute => {
    if (route.method === 'POST' && route.path === FORGOT_PATH) return mailRoute('forgot', route.path, o.minMs?.forgot ?? FORGOT_MIN_MS);
    if (route.method === 'POST' && route.path === RENEW_PATH) return mailRoute('renew', route.path, o.minMs?.renew ?? RENEW_MIN_MS);
    // The Google callback (Madar enterprises, design 5.17): the state names its enterprise, and the Worker accepts only a listed one. An
    // unlisted id derives no key. The callback calls no object and reads no database.
    if (route.method === 'GET' && route.path === GOOGLE_CALLBACK_PATH) {
      return { method: route.method, path: route.path, handler: (request, call) => googleCallback(request, o.deps, { listed: async (ent) => (await call.router.listedStub(ent)) !== null }) };
    }
    // The routes of the own steps read no deps: each one sends its step to the office object of the request. The Google callback reads
    // no database and calls no object: it runs here, in the Worker, with the Worker deps (server/google/callback.ts).
    return { method: route.method, path: route.path, handler: (request, call) => routesOf(enterpriseSigninOffice(call)).find(same(route))!.handler(request, o.deps) };
  });
}
