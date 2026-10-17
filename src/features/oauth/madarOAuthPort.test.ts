import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors';
import { madarOAuthPort, OAuthFailure } from './oauthPort';

function port(answers: Record<string, Response>, calls: { path: string; method: string; body: unknown }[] = []) {
  return madarOAuthPort({
    apiUrl: '/api',
    accessToken: async () => 'browser-token',
    fetch: async (input, init) => {
      const path = new URL(input, 'https://madar.test').pathname;
      calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return answers[`${init?.method ?? 'GET'} ${path}`]?.clone() ?? new Response('{}', { status: 404 });
    },
  });
}

describe('the OAuth port over the own OAuth server (madarOAuthPort)', () => {
  it('tells the consent screen that an agent token cannot use the account outside the screens (every own route refuses it)', () => {
    expect(port({}).agentReachesAccount).toBe(false);
  });

  it('gives the request to ask about, or the redirect of a known client', async () => {
    const ask = port({ 'GET /api/oauth/authorizations/req1': Response.json({ authorization_id: 'req1', client: { id: 'c1', name: ' Claude ' }, redirect_uri: 'https://claude.ai/cb' }) });
    expect(await ask.details('req1')).toEqual({ kind: 'ask', request: { authorizationId: 'req1', clientId: 'c1', clientName: 'Claude', redirectUri: 'https://claude.ai/cb' } });
    const done = port({ 'GET /api/oauth/authorizations/req2': Response.json({ redirect_url: 'https://claude.ai/cb?code=x' }) });
    expect(await done.details('req2')).toEqual({ kind: 'done', redirectUrl: 'https://claude.ai/cb?code=x' });
  });

  it('records the approval, then approves or denies, in the order of the consent screen', async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const p = port({
      'POST /api/agents/approve': Response.json({ approved: true }),
      'POST /api/oauth/authorizations/req1/consent': Response.json({ redirect_url: 'https://claude.ai/cb?code=x&state=s' }),
    }, calls);
    await p.recordApproval('req1');
    expect(await p.approve('req1')).toBe('https://claude.ai/cb?code=x&state=s');
    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ['POST', '/api/agents/approve', { authorizationId: 'req1' }],
      ['POST', '/api/oauth/authorizations/req1/consent', { action: 'approve' }],
    ]);
  });

  it('keeps the words of the screen: agent_removed as a Madar refusal, an ended request as 404', async () => {
    const removed = port({ 'POST /api/agents/approve': Response.json({ v: 1, error: { code: 'forbidden', message: 'You removed this AI app in Madar.', details: { reason: 'agent_removed' } } }, { status: 403 }) });
    await expect(removed.recordApproval('req1')).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_removed' } });
    await expect(removed.recordApproval('req1')).rejects.toBeInstanceOf(ApiError);
    const ended = port({ 'GET /api/oauth/authorizations/gone': Response.json({ v: 1, error: { code: 'not_found', message: 'This approval request ended.', details: { reason: 'authorization_ended' } } }, { status: 404 }) });
    await expect(ended.details('gone')).rejects.toBeInstanceOf(OAuthFailure);
    await expect(ended.details('gone')).rejects.toMatchObject({ status: 404 });
  });

  it('lists the grants and revokes one with the client id', async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const p = port({
      'POST /api/oauth/grants': Response.json([{ client_id: 'c1', client_name: 'Claude', granted_at: '2026-10-17T06:00:00.000Z' }]),
      'POST /api/oauth/grants/revoke': Response.json({ ok: true }),
    }, calls);
    expect(await p.listGrants()).toEqual([{ clientId: 'c1', clientName: 'Claude', grantedAt: '2026-10-17T06:00:00.000Z' }]);
    await p.revokeGrant('c1');
    expect(calls.at(-1)).toEqual({ path: '/api/oauth/grants/revoke', method: 'POST', body: { client_id: 'c1' } });
  });
});
