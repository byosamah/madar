import { ApiError } from '../../src/api/errors';
import { principalOf } from '../auth/principal';
import { resolveActor } from '../core/actor';
import type { OfficeSnapshot, Principal } from '../core/types';

/**
 * Who sends a batch to the office object (exit wave 3). The Worker checks the token and passes what the check gives; the office
 * object finds the person in its office lists, because only the object holds them. "browser" holds what verifyBrowserToken gives
 * (server/auth/verify.ts). "agent" (the merge of exit waves 2 and 3) is the agent of an MCP tool call: the MCP app of the office
 * object checked its token and its agent link (liteAgentOf, server/mcp/oauth/agent.ts) and gives the agent user and its client.
 */
export type OfficeWho = { kind: 'browser'; authUserId: string } | { kind: 'agent'; agentUserId: string; clientId: string };

export function principalOfWho(who: OfficeWho, office: OfficeSnapshot): Principal {
  switch (who.kind) {
    case 'browser':
      return principalOf(who.authUserId, office);
    case 'agent': {
      // The second guard after the agent check: the agent row and its person act now (resolveActor), from this office.
      const principal: Principal = { userId: who.agentUserId, agent: { clientId: who.clientId } };
      resolveActor(office, principal);
      return principal;
    }
    default:
      throw new ApiError('unauthenticated', 'This sign-in does not reach the office object.');
  }
}
