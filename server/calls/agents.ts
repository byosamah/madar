import { notBuiltAsync } from '../core/notBuilt';
import type { ServerCall } from '../core/types';

/** Track G replaces these stubs (plan 5.6). */
export const agentsList: ServerCall<'agents.list'> = () => notBuiltAsync('agents.list');
export const agentsRemove: ServerCall<'agents.remove'> = () => notBuiltAsync('agents.remove');
