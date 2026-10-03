import { Hono } from 'hono';
import { notBuiltResponse } from '../core/notBuilt';
import type { Deps } from '../core/ports';

/**
 * The MCP 2026-07-28 server (plan 5.6). The entries mount it at /mcp. Until track G builds it, every request gets 501,
 * so a mounted stub never crashes its host.
 */
export function mcpApp(_deps: Deps): Hono {
  const app = new Hono();
  app.all('*', () => notBuiltResponse('The MCP server'));
  return app;
}
