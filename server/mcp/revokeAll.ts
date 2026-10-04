import { registerEffect, registerOutbox, type OutboxRow } from '../core/effects';
import type { Deps } from '../core/ports';

/**
 * agents.revokeAll (plan 4.12; task G3, the follow-up of P2): when a person or an agent is turned off, every agent link of that
 * user is removed (agent_links.revoked_at). The MCP token check already refuses an agent whose person is off
 * (madar_private.agent_session_ok); the removal keeps the agents off after the person is turned on again. A removed link never
 * links again (server/mcp/auth.ts): to connect again, each AI app must register a new client (a new DCR client_id), and the person
 * must approve it again on the Madar consent screen (server/mcp/approval.ts).
 *
 * Auth keeps the OAuth grants (track H, proof.md section H): Auth v2.197.0 has no admin call that removes one person's grant for
 * one client, so the authorize step of a known app gives a code at once and the consent screen does not show. Madar refuses the
 * tokens of such an app all the same, and the same statement deletes every approval of the person, so an app that the person
 * approved but that never called Madar does not link either. Settings, Agents lists each such grant, and its Remove ends it at
 * Auth with the person's own token; the next connection then shows the consent screen.
 *
 * - The producers: users.deactivate, and an Undo (events.undo, events.undoStory) whose event turns a user off.
 * - The handler never asks whether the user is still off: the outbox row exists only because a turn-off committed, so a retry by
 *   the job after the person is on again still removes the links.
 * - This module holds no MCP code, so the api and jobs bundles carry it. server/calls/agents.ts imports it, so every entry that
 *   builds the call map registers it.
 */

export const REVOKE_ALL_KIND = 'agents.revokeAll';

/**
 * One statement: every live link of the user is removed, and every approval that the user recorded in Madar is deleted
 * (20261004000403_platform_agent_approvals_revoke.sql). Auth keeps the OAuth grants (no admin call removes one person's grant
 * for one client, proof.md section H), so an approval of an app that never called Madar would otherwise still link it later.
 */
export const REVOKE_ALL_SQL =
  'with links as (update agent_links set revoked_at = now() where revoked_at is null and (owner_user_id = $1 or agent_user_id = $1) returning 1), ' +
  'approvals as (delete from agent_approvals where owner_user_id = $1 returning 1) ' +
  'select (select count(*) from links)::integer as links, (select count(*) from approvals)::integer as approvals';

type Rec = Record<string, unknown>;
type UserEvent = { targetType: string; targetId: string; after: unknown };

const row = (userId: string): OutboxRow => ({ kind: REVOKE_ALL_KIND, payload: { userId } });

function offIn(event: UserEvent): string | null {
  if (event.targetType !== 'user' || event.after === null || typeof event.after !== 'object') return null;
  return (event.after as Rec).active === false ? event.targetId : null;
}

/** The outbox rows of one call, from its output. */
export function revokeAllRowsOf(name: string, output: unknown): OutboxRow[] {
  switch (name) {
    case 'users.deactivate': {
      const user = output as { id: string; active: boolean };
      return user.active === false ? [row(user.id)] : [];
    }
    case 'events.undo': {
      const id = offIn((output as { event: UserEvent }).event);
      return id ? [row(id)] : [];
    }
    case 'events.undoStory': {
      const ids = (output as { undone: { event: UserEvent }[] }).undone.map(({ event }) => offIn(event)).filter((id): id is string => id !== null);
      return [...new Set(ids)].map(row);
    }
    default:
      return [];
  }
}

export async function runRevokeAll(payload: Rec, deps: Pick<Deps, 'db'>): Promise<void> {
  if (typeof payload.userId !== 'string' || payload.userId === '') throw new Error('The agents.revokeAll payload has no user id.');
  await deps.db.statement('write', REVOKE_ALL_SQL, [payload.userId]);
}

for (const name of ['users.deactivate', 'events.undo', 'events.undoStory'] as const) {
  registerOutbox(name, async (output) => revokeAllRowsOf(name, output));
}
registerEffect(REVOKE_ALL_KIND, runRevokeAll);
