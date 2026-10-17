import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ApiError, type ApiErrorCode } from '../../api/errors';
import { regionUrl } from '../../api/remote/region';
import { REMOTE } from '../../app/mode';
import { authModeOf } from '../../app/remote/authMode';
import { useAuth } from '../auth/useAuth';
import { safeRedirect } from './knownHosts';

/**
 * The OAuth steps of the consent screen and of Settings, Agents (plan 5.6; task G4), over plain HTTP with the person's token:
 * the OAuth server of Supabase Auth (the routes that supabase-js calls in auth.oauth.*) and the Madar approval on the api function.
 * Plain HTTP, so the screens need no second Supabase client next to the one of src/app/remote/supabase.ts, and the prototype
 * page carries no Supabase code.
 *
 * The order of an approval: details (Auth writes the person into the request), recordApproval (Madar), then approve (Auth).
 * An agent token cannot record an approval (the api function refuses it), so an approval that an agent makes at Auth alone never
 * links in Madar (server/mcp/approval.ts).
 */

export type ConsentRequest = { authorizationId: string; clientId: string; clientName: string; redirectUri: string };
/** ask: the person decides. done: Auth knows this client from an earlier consent and gives the redirect at once. */
export type ConsentDetails = { kind: 'ask'; request: ConsentRequest } | { kind: 'done'; redirectUrl: string };
export type Grant = { clientId: string; clientName: string; grantedAt: string | null };

export interface OAuthPort {
  details(authorizationId: string): Promise<ConsentDetails>;
  /** POST /agents/approve on the api function, with the person's browser token. */
  recordApproval(authorizationId: string): Promise<void>;
  /** The redirect address back to the AI app. */
  approve(authorizationId: string): Promise<string>;
  deny(authorizationId: string): Promise<string>;
  listGrants(): Promise<Grant[]>;
  revokeGrant(clientId: string): Promise<void>;
}

/** A refusal of Supabase Auth: its status and code (for example oauth_authorization_not_found). */
export class OAuthFailure extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) {
    super(message);
    this.name = 'OAuthFailure';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const API_CODES: readonly ApiErrorCode[] = ['invalid_input', 'unauthenticated', 'forbidden', 'not_found', 'conflict', 'failed'];

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const redirectOf = (data: unknown): string => {
  const url = (data as { redirect_url?: unknown } | null)?.redirect_url;
  if (typeof url !== 'string' || url === '') throw new OAuthFailure(500, undefined, 'Madar gave no redirect address.');
  return url;
};

/** POST /agents/approve with the person's browser token. A refusal is a Madar refusal (ApiError), so the screen sees agent_removed. */
async function recordApprovalAt(send: Fetch, approveUrl: string, token: string, authorizationId: string): Promise<void> {
  const response = await send(approveUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorizationId }),
  });
  if (response.ok) return;
  const error = ((await json(response)).error ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> };
  const code = API_CODES.includes(error.code as ApiErrorCode) ? (error.code as ApiErrorCode) : 'failed';
  throw new ApiError(code, error.message ?? 'Something went wrong. Try again.', error.details ?? {});
}

export function httpOAuthPort(o: { supabaseUrl: string; publishableKey: string; apiUrl: string; accessToken: () => Promise<string | null>; fetch?: Fetch }): OAuthPort {
  const send: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const authUrl = `${o.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  // The region parameter goes only on a Supabase function URL; the page api of the Worker host takes none (owner, 2026-10-16).
  const approveUrl = regionUrl(`${o.apiUrl.replace(/\/+$/, '')}/agents/approve`);

  const token = async () => {
    const value = await o.accessToken();
    if (!value) throw new ApiError('unauthenticated', 'Sign in to continue.');
    return value;
  };

  async function auth(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await send(`${authUrl}${path}`, {
      method,
      headers: { apikey: o.publishableKey, Authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return null;
    const data = await json(response);
    if (!response.ok) {
      const message = String(data.msg ?? data.message ?? data.error_description ?? `Auth answered ${response.status}.`);
      throw new OAuthFailure(response.status, typeof data.code === 'string' ? data.code : typeof data.error_code === 'string' ? data.error_code : undefined, message);
    }
    return data;
  }

  const consent = (id: string, action: 'approve' | 'deny') => auth('POST', `/oauth/authorizations/${encodeURIComponent(id)}/consent`, { action }).then(redirectOf);

  return {
    async details(authorizationId) {
      const data = (await auth('GET', `/oauth/authorizations/${encodeURIComponent(authorizationId)}`)) as Record<string, unknown>;
      if (typeof data.redirect_url === 'string' && data.authorization_id === undefined) return { kind: 'done', redirectUrl: data.redirect_url };
      const client = (data.client ?? {}) as { id?: unknown; name?: unknown };
      return {
        kind: 'ask',
        request: {
          authorizationId: String(data.authorization_id ?? authorizationId),
          clientId: String(client.id ?? ''),
          clientName: typeof client.name === 'string' && client.name.trim() !== '' ? client.name.trim() : '',
          redirectUri: String(data.redirect_uri ?? ''),
        },
      };
    },
    recordApproval: async (authorizationId) => recordApprovalAt(send, approveUrl, await token(), authorizationId),
    approve: (authorizationId) => consent(authorizationId, 'approve'),
    deny: (authorizationId) => consent(authorizationId, 'deny'),
    async listGrants() {
      const data = await auth('GET', '/user/oauth/grants');
      return (Array.isArray(data) ? data : []).map((row: { client?: { id?: unknown; name?: unknown }; granted_at?: unknown }) => ({
        clientId: String(row.client?.id ?? ''),
        clientName: typeof row.client?.name === 'string' ? row.client.name : '',
        grantedAt: typeof row.granted_at === 'string' ? row.granted_at : null,
      })).filter((grant) => grant.clientId !== '');
    },
    async revokeGrant(clientId) {
      try {
        await auth('DELETE', `/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`);
      } catch (error) {
        // Auth has no active grant of this client (UserRevokeOAuthGrant of Supabase Auth): an earlier revoke whose answer was
        // lost, another tab, or an agent token that revoked it (proof.md G1). The access is gone, so the revoke is done.
        if (error instanceof OAuthFailure && error.status === 404 && error.code === 'oauth_consent_not_found') return;
        throw error;
      }
    },
  };
}

/**
 * The OAuth steps over the own OAuth server of Madar (Supabase exit, wave 2), at the page's own /api. The order of the consent
 * screen stays: details, recordApproval, approve; the server gives a code only after the approval. A refusal of a step other
 * than the approval is an OAuthFailure with its status, so an ended request (404) shows the words of authorization_ended.
 */
export function madarOAuthPort(o: { apiUrl: string; accessToken: () => Promise<string | null>; fetch?: Fetch }): OAuthPort {
  const send: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const base = o.apiUrl.replace(/\/+$/, '');
  const at = (path: string) => regionUrl(`${base}${path}`);
  const token = async () => {
    const value = await o.accessToken();
    if (!value) throw new ApiError('unauthenticated', 'Sign in to continue.');
    return value;
  };
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const response = await send(at(path), {
      method,
      headers: { Authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await json(response);
    if (!response.ok) {
      const error = (data.error ?? {}) as { code?: string; message?: string; details?: { reason?: unknown } };
      throw new OAuthFailure(response.status, typeof error.details?.reason === 'string' ? error.details.reason : error.code, error.message ?? `Madar answered ${response.status}.`);
    }
    return data;
  }
  const consent = (id: string, action: 'approve' | 'deny') => call('POST', `/oauth/authorizations/${encodeURIComponent(id)}/consent`, { action }).then(redirectOf);
  return {
    async details(authorizationId) {
      const data = (await call('GET', `/oauth/authorizations/${encodeURIComponent(authorizationId)}`)) as Record<string, unknown>;
      if (typeof data.redirect_url === 'string') return { kind: 'done', redirectUrl: data.redirect_url };
      const client = (data.client ?? {}) as { id?: unknown; name?: unknown };
      return {
        kind: 'ask',
        request: {
          authorizationId: String(data.authorization_id ?? authorizationId), clientId: String(client.id ?? ''),
          clientName: typeof client.name === 'string' ? client.name.trim() : '', redirectUri: String(data.redirect_uri ?? ''),
        },
      };
    },
    recordApproval: async (authorizationId) => recordApprovalAt(send, at('/agents/approve'), await token(), authorizationId),
    approve: (authorizationId) => consent(authorizationId, 'approve'),
    deny: (authorizationId) => consent(authorizationId, 'deny'),
    async listGrants() {
      const data = await call('POST', '/oauth/grants', {});
      return (Array.isArray(data) ? data : []).map((row: { client_id?: unknown; client_name?: unknown; granted_at?: unknown }) => ({
        clientId: String(row.client_id ?? ''), clientName: typeof row.client_name === 'string' ? row.client_name : '', grantedAt: typeof row.granted_at === 'string' ? row.granted_at : null,
      })).filter((grant) => grant.clientId !== '');
    },
    async revokeGrant(clientId) {
      await call('POST', '/oauth/grants/revoke', { client_id: clientId });
    },
  };
}

/** The prototype has no OAuth server: no request to show and no grants. */
export const NO_OAUTH: OAuthPort = {
  details: () => Promise.reject(new ApiError('not_found', 'The prototype has no AI app connections.')),
  recordApproval: () => Promise.reject(new ApiError('not_found', 'The prototype has no AI app connections.')),
  approve: () => Promise.reject(new ApiError('not_found', 'The prototype has no AI app connections.')),
  deny: () => Promise.reject(new ApiError('not_found', 'The prototype has no AI app connections.')),
  listGrants: async () => [],
  revokeGrant: async () => undefined,
};

/** What the OAuth screens use: the port, and the step that leaves Madar for the AI app (a full page load). */
export type OAuthTools = { port: OAuthPort; leave: (url: string) => void };

const OAuthContext = createContext<OAuthTools | null>(null);

/** Tests and the screenshot page give their own port and leave step. */
export function OAuthProvider({ value, children }: { value: OAuthTools; children: ReactNode }) {
  return <OAuthContext.Provider value={value}>{children}</OAuthContext.Provider>;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** The port of the remote build from its public values (config/remote.<env>.env), as src/app/remote/bootstrap.ts reads them. */
function remotePort(accessToken: () => Promise<string | null>): OAuthPort {
  const env = import.meta.env as Record<string, unknown>;
  if (authModeOf({ VITE_MADAR_AUTH: text(env.VITE_MADAR_AUTH) }) === 'madar') {
    const apiUrl = text(env.VITE_API_URL);
    return apiUrl ? madarOAuthPort({ apiUrl, accessToken }) : NO_OAUTH;
  }
  const supabaseUrl = text(env.VITE_SUPABASE_URL);
  const publishableKey = text(env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!supabaseUrl || !publishableKey) return NO_OAUTH;
  const apiUrl = text(env.VITE_API_URL) ?? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/api`;
  return httpOAuthPort({ supabaseUrl, publishableKey, apiUrl, accessToken });
}

export function useOAuth(): OAuthTools {
  const given = useContext(OAuthContext);
  const auth = useAuth();
  return useMemo(() => given ?? {
    port: REMOTE ? remotePort(() => auth.accessToken()) : NO_OAUTH,
    // The screen checks the address first; this check stays as the last guard before the page goes (security review of G4).
    leave: (url: string) => {
      if (safeRedirect(url)) window.location.assign(url);
    },
  }, [given, auth]);
}
