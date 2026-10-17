import { describe, expect, it } from 'vitest';
import { proxyWellKnown } from './pagesWellKnown';

const SETTING = { test: 'workers', production: 'supabase' } as const;
const binding = { fetch: async (request: Request) => new Response(new URL(request.url).pathname) };

describe('the forwarder of the OAuth discovery paths (server/http/pagesWellKnown.ts, for the Pages Function of wave 5)', () => {
  it('sends the two discovery paths of the MCP issuer to the Worker as /mcp/.well-known/<name>', async () => {
    for (const [from, to] of [['oauth-authorization-server', 'oauth-authorization-server'], ['openid-configuration', 'openid-configuration']]) {
      const answer = await proxyWellKnown(new Request(`https://preview.madar-46r.pages.dev/.well-known/${from}/mcp`), fetch, { MADAR_SERVER_TEST: binding }, { setting: SETTING });
      expect(await answer.text()).toBe(`/mcp/.well-known/${to}`);
    }
  });

  it('answers 404 for another path, another method and another host', async () => {
    const env = { MADAR_SERVER_TEST: binding };
    expect((await proxyWellKnown(new Request('https://preview.madar-46r.pages.dev/.well-known/oauth-authorization-server'), fetch, env, { setting: SETTING })).status).toBe(404);
    expect((await proxyWellKnown(new Request('https://preview.madar-46r.pages.dev/.well-known/oauth-authorization-server/mcp', { method: 'POST' }), fetch, env, { setting: SETTING })).status).toBe(404);
    expect((await proxyWellKnown(new Request('https://stranger.example/.well-known/oauth-authorization-server/mcp'), fetch, env, { setting: SETTING })).status).toBe(404);
  });
});
