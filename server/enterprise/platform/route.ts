import { PLATFORM_CALL_NAMES, platformContracts, type PlatformCallName } from '../../../src/api/contract/platform';
import { ApiError } from '../../../src/api/errors';
import { nowStamp } from '../../../src/lib/dates';
import type { Deps } from '../../core/ports';
import type { OfficeStub } from '../../entries/officeWorker';
import { errorResponse, runErrorOf } from '../../http/errors';
import { checkBuild, parseBatch, readBody } from '../../http/limits';
import type { NetApi } from '../../office/net';
import { isEnterpriseId, type EnterpriseId } from '../ids';
import { ownerOf } from './guard';
import { PLATFORM_HANDLERS, type PlatformCtx } from './handlers';
import type { PlatformStub } from './stub';

/**
 * POST /api/platform (Madar enterprises, design 5.6): one platform call for each request, in the wire form of one entry of /api/batch. The
 * order of the checks: the build, the body size, the browser token (an agent token gets 403 agent_token), the owner check (any person who
 * is no owner gets not_found, the answer of an unknown address), then the shape of the request, the name of the call, its input and the
 * handler. So a stranger learns nothing from the shape of a request. The office path only: the Postgres path has no such route.
 */

type Env = Record<string, unknown>;
type After = (work: Promise<unknown>) => void;

export type PlatformRouteOptions = {
  deps: Pick<Deps, 'config' | 'clock' | 'log'>;
  verifyToken: (header: string | null) => Promise<{ authUserId: string; ent?: EnterpriseId }>;
  stubFor: (env: Env, ent: EnterpriseId) => OfficeStub;
  platform: (env: Env) => PlatformStub;
  net: (env: Env, ent?: EnterpriseId) => NetApi;
  /** The handlers. Default: PLATFORM_HANDLERS. */
  handlers?: typeof PLATFORM_HANDLERS;
};

const notFound = () => new ApiError('not_found', 'This address does not exist.');
const readerOf = (env: Env) => (name: string): string | undefined => (typeof env[name] === 'string' && env[name] !== '' ? (env[name] as string) : undefined);

export function platformRoute(o: PlatformRouteOptions): (request: Request, env: Env, after?: After) => Promise<Response> {
  const { log } = o.deps;
  const handlers = o.handlers ?? PLATFORM_HANDLERS;

  return async (request, env) => {
    try {
      if (request.method !== 'POST') throw notFound();
      checkBuild(request.headers.get('X-Madar-Build') ?? undefined, o.deps.config.minClientBuild);
      const text = await readBody(request);
      const token = await o.verifyToken(request.headers.get('Authorization'));
      const platform = o.platform(env);
      // A token with no claim is the Postgres way back: it serves ENT_VADO only and holds no platform power.
      const owner = token.ent !== undefined && isEnterpriseId(token.ent)
        ? await ownerOf({ token: { authUserId: token.authUserId, ent: token.ent }, office: (ent) => o.stubFor(env, ent), platform, log })
        : null;
      if (!owner) throw notFound();
      const { request: batch } = parseBatch(text);
      if (batch.calls.length !== 1) throw new ApiError('invalid_input', 'A platform request holds one call.', { reason: 'bad_request' });
      const call = batch.calls[0];
      if (!(PLATFORM_CALL_NAMES as readonly string[]).includes(call.name)) throw notFound();
      const name = call.name as PlatformCallName;
      const contract = platformContracts[name];
      const parsed = contract.input.safeParse(call.input);
      if (!parsed.success) {
        throw new ApiError('invalid_input', 'The input of this call is not right.', { fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))] });
      }
      const ctx: PlatformCtx = {
        ent: owner.ent, userId: owner.userId, platform, office: (ent) => o.stubFor(env, ent), net: () => o.net(env, owner.ent), read: readerOf(env),
        now: () => o.deps.clock.now(), log,
      };
      let output: unknown;
      try {
        output = await (handlers[name] as (input: unknown, ctx: PlatformCtx) => Promise<unknown>)(parsed.data, ctx);
      } catch (error) {
        if (!(error instanceof ApiError)) log.error('A platform call failed.', { name, error: error instanceof Error ? error.message : String(error) });
        return Response.json({ v: 1, serverTime: nowStamp(o.deps.clock.now()), results: [{ i: call.i, ok: false, error: runErrorOf(error) }] });
      }
      // The contract output strips every key it does not name, so a handler can never send more than the page may see.
      const checked = contract.output.safeParse(output);
      if (!checked.success) {
        log.error('A platform call returned data in the wrong shape.', { name, issues: checked.error.issues.length });
        return Response.json({ v: 1, serverTime: nowStamp(o.deps.clock.now()), results: [{ i: call.i, ok: false, error: runErrorOf(new ApiError('failed', 'Something went wrong. Try again.')) }] });
      }
      return Response.json({ v: 1, serverTime: nowStamp(o.deps.clock.now()), results: [{ i: call.i, ok: true, output: checked.data }] });
    } catch (error) {
      if (!(error instanceof ApiError)) log.error('The platform route failed before its call.', { error: error instanceof Error ? error.message : String(error) });
      return errorResponse(runErrorOf(error));
    }
  };
}
