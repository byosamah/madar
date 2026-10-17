import type { Deps } from '../../core/ports';
import type { OfficeSnapshot } from '../../core/types';
import { liteData } from '../../data/lite/callData';
import { ensureAgentUser } from '../agentUser';
import { agentPrincipalResolver, type AgentPrincipal, type AgentToken } from '../auth';

/**
 * The agent of a token on the SQLite path (Supabase exit, wave 2): the agent check of auth.ts with AGENT_LITE, and ensureAgentUser on
 * liteData. The MCP host of the office object passes it as McpAppOptions.agentOf (wave 3).
 */
export function liteAgentOf(deps: Deps, token: AgentToken, office: () => Promise<OfficeSnapshot>): Promise<AgentPrincipal> {
  return agentPrincipalResolver({
    query: (text, values) => deps.db.statement('read', text, values),
    office,
    ensure: async (o) => void (await ensureAgentUser(deps, { ...o, data: liteData(deps) })),
    lite: { now: () => deps.clock.now() },
  })(token);
}
