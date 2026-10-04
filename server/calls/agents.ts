import { notBuiltAsync } from '../core/notBuilt';
// Registers agents.revokeAll after a turn-off (plan 4.12) in every entry that builds the call map.
import '../mcp/revokeAll';
import type { ServerCall } from '../core/types';

/** Track G replaces these stubs (plan 5.6). */
export const agentsList: ServerCall<'agents.list'> = () => notBuiltAsync('agents.list');
export const agentsRemove: ServerCall<'agents.remove'> = () => notBuiltAsync('agents.remove');
