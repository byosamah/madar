import { mcpApp } from '../mcp/app';
import { startApps, type AppMount } from './apps';
import type { Started } from './start';

/** The MCP app at /mcp (plan 5.6). */
export const mcpMount: AppMount = { name: 'mcp', app: (deps) => mcpApp(deps) };

export const startMcp = (): Started => startApps([mcpMount]);
