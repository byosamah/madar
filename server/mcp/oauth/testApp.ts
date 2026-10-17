import { Hono } from 'hono';
import { localSigninOffice } from '../../auth/own/office';
import { signingKeysOf } from '../../auth/own/keys';
import { testPrivateJwk } from '../../auth/own/testKeys';
import { signinOffice } from '../../auth/own/testOffice';
import type { SigninDeps } from '../../auth/own/types';
import { ownIssuer, ownKeySet, ownPublicJwks } from '../../auth/ownKeys';
import type { Deps } from '../../core/ports';
import { createRunCall } from '../../core/runCall';
import { liteData } from '../../data/lite/callData';
import { readLiteOffice } from '../../data/lite/office';
import { mcpApp } from '../app';
import { agentTokenChecker } from '../auth';
import { liteAgentOf } from './agent';
import { mountOAuth } from './routes';

export const TEST_MCP_URL = 'https://madar.test/mcp';

/**
 * For tests only: the MCP app of the own stack on node:sqlite, as the office object host of wave 3 builds it: the own issuer, the
 * own agent token check, the agent check on SQLite, runCall on liteData, and the OAuth routes. root serves it at /mcp.
 */
export async function oauthApp(o: { at?: string } = {}) {
  const t = await signinOffice({ at: o.at ?? new Date().toISOString(), config: { mcpUrl: TEST_MCP_URL, appUrl: 'https://madar.test', allowedOrigins: ['https://madar.test'] } });
  const jwk = await testPrivateJwk();
  const keys = await signingKeysOf(jwk, TEST_MCP_URL);
  const deps: SigninDeps = { db: t.db, clock: t.deps.clock, log: t.deps.log, config: t.deps.config, keys };
  const office = localSigninOffice(deps);
  const run = createRunCall({ data: liteData });
  const mcp = mcpApp(t.deps as unknown as Deps, {
    issuer: ownIssuer(TEST_MCP_URL),
    checkToken: agentTokenChecker({ issuer: ownIssuer(TEST_MCP_URL), audience: TEST_MCP_URL, jwks: ownKeySet(jwk) }),
    agentOf: liteAgentOf,
    runCall: run,
    readOffice: () => t.db.tx('read', (q) => readLiteOffice(t.db, q)),
    stateKey: new Uint8Array(32),
    oauth: (app) => mountOAuth(app, office, { mcpUrl: TEST_MCP_URL, jwks: ownPublicJwks(jwk) }),
  });
  const root = new Hono();
  root.route('/mcp', mcp);
  return { t, jwk, keys, deps, office, root };
}
