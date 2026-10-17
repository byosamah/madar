import { ApiError } from '../../../src/api/errors';
import { runErrorOf } from '../../http/errors';
import {
  answerConsent, approveClient, authorizationDetails, exchangeToken, listGrants, registerClient, revokeGrant, startAuthorization,
} from '../../mcp/oauth/ops';
import { passwordSignIn, refreshSignIn, setSignInPassword, signOutSessions, verifySignInLink } from './ops';
import { OAuthError, type SigninDeps } from './types';

/**
 * The sign-in steps of the office object (Supabase exit, wave 2) and the port that the Worker routes call. Each answer is plain data
 * (a structured clone carries it over the object method of wave 3): a value, a Madar refusal, or an OAuth refusal.
 */

export const SIGNIN_STEPS = {
  'auth.password': passwordSignIn,
  'auth.refresh': refreshSignIn,
  'auth.verify': verifySignInLink,
  'auth.setPassword': setSignInPassword,
  'auth.logout': signOutSessions,
  'oauth.register': registerClient,
  'oauth.authorize': startAuthorization,
  'oauth.details': authorizationDetails,
  'oauth.approve': approveClient,
  'oauth.consent': answerConsent,
  'oauth.grants': listGrants,
  'oauth.revoke': revokeGrant,
  'oauth.token': exchangeToken,
} as const;

export type SigninSteps = typeof SIGNIN_STEPS;
export type SigninOpName = keyof SigninSteps;
export type OpInput<N extends SigninOpName> = Parameters<SigninSteps[N]>[1];
export type OpOutput<N extends SigninOpName> = Awaited<ReturnType<SigninSteps[N]>>;
export type OAuthFailure = { status: number; error: string; error_description: string };
export type OpResult<T> = { ok: true; value: T } | { ok: false; error: ReturnType<typeof runErrorOf> } | { ok: false; oauth: OAuthFailure };

export async function runSigninOp<N extends SigninOpName>(deps: SigninDeps, name: N, input: OpInput<N>): Promise<OpResult<OpOutput<N>>> {
  const step = (SIGNIN_STEPS as Record<string, ((deps: SigninDeps, input: unknown) => Promise<unknown>) | undefined>)[name];
  if (!step) return { ok: false, error: runErrorOf(new ApiError('not_found', 'This sign-in step does not exist.')) };
  try {
    return { ok: true, value: (await step(deps, input)) as OpOutput<N> };
  } catch (error) {
    if (error instanceof OAuthError) return { ok: false, oauth: { status: error.status, error: error.code, error_description: error.message } };
    if (!(error instanceof ApiError)) deps.log.error('A sign-in step failed.', { name, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: runErrorOf(error) };
  }
}

/** The way of the Worker routes to the steps. Wave 3 gives one that calls the office object; tests and local runs use this one. */
export interface SigninOffice {
  run<N extends SigninOpName>(name: N, input: OpInput<N>): Promise<OpResult<OpOutput<N>>>;
}

export function localSigninOffice(deps: SigninDeps): SigninOffice {
  return { run: (name, input) => runSigninOp(deps, name, input) };
}
