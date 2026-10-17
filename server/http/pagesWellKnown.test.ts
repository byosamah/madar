import { describe, expect, it } from 'vitest';
import { proxyWellKnown } from './pagesWellKnown';

/** The own OAuth server runs only on an office copy (exit wave 4). */
const SETTING = { test: 'office', production: 'supabase' } as const;
const binding = { fetch: async (request: Request) => new Response(new URL(request.url).pathname) };

describe('the forwarder of the OAuth discovery paths (server/http/pagesWellKnown.ts, for the Pages Functions of exit wave 4)', () => {
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

describe('the discovery files only for an office copy (exit wave 4)', () => {
  const env = (seen: string[]) => ({ MADAR_SERVER_TEST: { fetch: async (request: Request) => (seen.push(new URL(request.url).pathname), Response.json({ issuer: 'x' })) } });
  // A fetch that refuses, so a test that fails never reaches a real Supabase function.
  const noFetch = (async () => {
    throw new Error('This test sends nothing to a Supabase function.');
  }) as unknown as typeof fetch;

  it('forwards the discovery path of an office copy to /mcp/.well-known of its Worker', async () => {
    const seen: string[] = [];
    const response = await proxyWellKnown(new Request('https://preview.madar-46r.pages.dev/.well-known/oauth-authorization-server/mcp'), noFetch, env(seen), { setting: { test: 'office', production: 'supabase' }, log: () => undefined });
    expect(response.status).toBe(200);
    expect(seen).toEqual(['/mcp/.well-known/oauth-authorization-server']);
  });

  it('answers 404 on a copy that is not office, and on production before wave 6', async () => {
    const seen: string[] = [];
    for (const url of ['https://preview.madar-46r.pages.dev/.well-known/openid-configuration/mcp', 'https://madar.vado.sa/.well-known/oauth-authorization-server/mcp']) {
      const response = await proxyWellKnown(new Request(url), noFetch, env(seen), { setting: { test: 'workers', production: 'supabase' }, log: () => undefined });
      expect(response.status).toBe(404);
    }
    expect(seen).toEqual([]);
  });
});

it('the two Pages Functions call proxyWellKnown', async () => {
  const { readFileSync } = await import('node:fs');
  for (const name of ['oauth-authorization-server', 'openid-configuration']) {
    const text = readFileSync(new URL(`../../functions/.well-known/${name}/[[path]].ts`, import.meta.url), 'utf8');
    expect(text).toMatch(/export const onRequest = \(\{ request, env \}[^\n]*=> proxyWellKnown\(request, fetch, env\);/);
  }
});
