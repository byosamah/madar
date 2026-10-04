import { mcpApp } from '../mcp/app';
import { startApps, type AppMount } from './apps';
import type { Started } from './start';

/** The MCP app at /mcp (plan 5.6). The requestState key of the reason questions comes from the server secret key. */
export const mcpMount: AppMount = { name: 'mcp', app: (deps, values) => mcpApp(deps, { secretKey: values.secretKey }) };

export const startMcp = (): Started => startApps([mcpMount]);
