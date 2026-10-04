import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { hostOf, needsWarning, safeRedirect } from './knownHosts';
import { httpOAuthPort } from './oauthPort';

describe('the redirect host of an AI app (knownHosts)', () => {
  it('takes the host without the port, also of an app address with its own scheme', () => {
    expect(hostOf('http://127.0.0.1:33418/callback')).toBe('127.0.0.1');
    expect(hostOf('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
    expect(hostOf('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe('anysphere.cursor-retrieval');
    expect(hostOf('not a url')).toBeNull();
  });

  it('warns for a host that is not loopback and not a known AI app, and for an address it cannot read', () => {
    for (const uri of ['http://127.0.0.1:9/cb', 'http://localhost:9/cb', 'http://[::1]:9/cb', 'https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect', 'https://vscode.dev/redirect']) {
      expect(needsWarning(uri), uri).toBe(false);
    }
    for (const uri of ['https://evil.example/callback', 'https://claude.ai.evil.example/cb', 'https://evil-claude.ai/cb', 'not a url']) expect(needsWarning(uri), uri).toBe(true);
  });
});

describe('the return address of an AI app (safeRedirect, security review of G4)', () => {
  it('accepts https, http on a loopback host only, and an app scheme', () => {
    for (const url of ['https://claude.ai/api/mcp/auth_callback?code=x', 'http://127.0.0.1:33418/callback?code=x', 'http://localhost:9/cb', 'cursor://anysphere.cursor-retrieval/oauth/callback?code=x']) {
      expect(safeRedirect(url), url).toBe(true);
    }
  });

  it('refuses script and local schemes, http to another host, and an address that does not parse; each one gets the warning', () => {
    for (const url of ['javascript://claude.ai/%0aalert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'vbscript:msgbox', 'blob:https://claude.ai/x', 'file:///etc/passwd', 'filesystem:https://claude.ai/temporary/x', 'about:blank', 'http://evil.example/cb', 'not a url']) {
      expect(safeRedirect(url), url).toBe(false);
      expect(needsWarning(url), url).toBe(true);
    }
  });
});

describe('httpOAuthPort: the OAuth calls of Supabase Auth and the Madar approval', () => {
  const answers: Response[] = [];
  const fetch = vi.fn(async () => answers.shift() ?? Response.json({}));
  const port = httpOAuthPort({ supabaseUrl: 'https://ref.supabase.co/', publishableKey: 'pk', apiUrl: 'https://ref.supabase.co/functions/v1/api', accessToken: async () => 'tok', fetch });
  const sent = (n: number) => {
    const [url, init] = fetch.mock.calls[n] as unknown as [string, RequestInit];
    return { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body };
  };

  it('reads the details of a request, or the redirect of a client that the person approved before', async () => {
    answers.push(Response.json({ authorization_id: 'a1', redirect_uri: 'https://claude.ai/cb', client: { id: 'c1', name: 'Claude' }, user: { id: 'u', email: 'e' }, scope: 'email' }));
    expect(await port.details('a1')).toEqual({ kind: 'ask', request: { authorizationId: 'a1', clientId: 'c1', clientName: 'Claude', redirectUri: 'https://claude.ai/cb' } });
    expect(sent(0)).toMatchObject({ url: 'https://ref.supabase.co/auth/v1/oauth/authorizations/a1', method: 'GET', headers: { apikey: 'pk', Authorization: 'Bearer tok' } });
    answers.push(Response.json({ redirect_url: 'https://claude.ai/cb?code=x' }));
    expect(await port.details('a1')).toEqual({ kind: 'done', redirectUrl: 'https://claude.ai/cb?code=x' });
  });

  it('records the approval on the api function first, then approves or denies at Auth', async () => {
    fetch.mockClear();
    answers.push(Response.json({ approved: true }), Response.json({ redirect_url: 'https://claude.ai/cb?code=y' }), Response.json({ redirect_url: 'https://claude.ai/cb?error=access_denied' }));
    await port.recordApproval('a/1');
    expect(await port.approve('a/1')).toBe('https://claude.ai/cb?code=y');
    expect(await port.deny('a/1')).toBe('https://claude.ai/cb?error=access_denied');
    expect(sent(0)).toMatchObject({ url: 'https://ref.supabase.co/functions/v1/api/agents/approve?forceFunctionRegion=eu-central-1', method: 'POST', headers: { Authorization: 'Bearer tok' }, body: JSON.stringify({ authorizationId: 'a/1' }) });
    expect(sent(1)).toMatchObject({ url: 'https://ref.supabase.co/auth/v1/oauth/authorizations/a%2F1/consent', method: 'POST', body: JSON.stringify({ action: 'approve' }) });
    expect(sent(2)).toMatchObject({ method: 'POST', body: JSON.stringify({ action: 'deny' }) });
  });

  it('turns a refusal of the api function into its ApiError, and of Auth into an Error with the status', async () => {
    answers.push(Response.json({ v: 1, error: { code: 'forbidden', message: 'No.', details: { reason: 'agent_token' } } }, { status: 403 }));
    const refused = await port.recordApproval('a1').then(() => null, (e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ code: 'forbidden', details: { reason: 'agent_token' } });
    answers.push(Response.json({ code: 'oauth_authorization_not_found', msg: 'gone' }, { status: 404 }));
    await expect(port.approve('a1')).rejects.toMatchObject({ status: 404 });
  });

  it('lists the grants of the person and revokes one by client', async () => {
    fetch.mockClear();
    answers.push(Response.json([{ client: { id: 'c1', name: 'Claude' }, scopes: ['email'], granted_at: '2026-10-04T08:38:41Z' }]), new Response(null, { status: 204 }));
    expect(await port.listGrants()).toEqual([{ clientId: 'c1', clientName: 'Claude', grantedAt: '2026-10-04T08:38:41Z' }]);
    await port.revokeGrant('c1');
    expect(sent(0)).toMatchObject({ url: 'https://ref.supabase.co/auth/v1/user/oauth/grants', method: 'GET' });
    expect(sent(1)).toMatchObject({ url: 'https://ref.supabase.co/auth/v1/user/oauth/grants?client_id=c1', method: 'DELETE' });
  });

  it('asks for a sign-in when there is no session', async () => {
    const signedOut = httpOAuthPort({ supabaseUrl: 'https://ref.supabase.co', publishableKey: 'pk', apiUrl: 'https://x/api', accessToken: async () => null, fetch });
    await expect(signedOut.listGrants()).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
