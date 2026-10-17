import type { Hono } from 'hono';
import type { JSONWebKeySet } from 'jose';
import { clientAddress } from '../../auth/forgot';
import type { SigninOffice } from '../../auth/own/office';
import { answer, jsonOf } from '../../auth/own/routes';
import { readBody } from '../../http/limits';
import { authServerMetadata, WELL_KNOWN } from './metadata';

/**
 * The OAuth routes of the own sign-in in the MCP app, under /mcp (Supabase exit, wave 2). The host of the office object passes
 * mountOAuth as McpAppOptions.oauth; no Supabase entry has them. The steps run in the office object through SigninOffice.
 */

const OPEN = { 'Access-Control-Allow-Origin': '*' };

export async function formOf(request: Request): Promise<Record<string, string>> {
  try {
    return Object.fromEntries(new URLSearchParams(await readBody(request)));
  } catch {
    return {};
  }
}

export function mountOAuth(app: Hono, office: SigninOffice, o: { mcpUrl: string; jwks: JSONWebKeySet }): void {
  const metadata = authServerMetadata(o.mcpUrl);
  for (const path of WELL_KNOWN) app.get(path, () => Response.json(metadata, { headers: { ...OPEN, 'Cache-Control': 'public, max-age=3600' } }));
  app.get('/oauth/jwks', () => Response.json(o.jwks, { headers: { ...OPEN, 'Cache-Control': 'public, max-age=600' } }));
  app.post('/oauth/register', async (c) => answer(await office.run('oauth.register', { body: await jsonOf(c.req.raw), address: clientAddress(c.req.raw) }), 201));
  app.get('/oauth/authorize', async (c) => {
    const result = await office.run('oauth.authorize', { query: Object.fromEntries(new URL(c.req.url).searchParams) });
    return result.ok ? new Response(null, { status: 302, headers: { Location: result.value.redirect, 'Cache-Control': 'no-store' } }) : answer(result);
  });
  app.post('/oauth/token', async (c) => answer(await office.run('oauth.token', { form: await formOf(c.req.raw) })));
}
