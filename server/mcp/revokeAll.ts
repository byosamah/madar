import { registerEffect, registerOutbox, type OutboxRow } from '../core/effects';
import type { Deps } from '../core/ports';

/**
 * agents.revokeAll (plan 4.12; task G3, the follow-up of P2): when a person or an agent is turned off, every agent link of that
 * user is removed (agent_links.revoked_at). The MCP token check already refuses an agent whose person is off
 * (madar_private.agent_session_ok); the removal keeps the agents off after the person is turned on again, so each AI app must be
 * approved again (a new session after the removal links again, server/mcp/auth.ts).
 *
 * - The producers: users.deactivate, and an Undo (events.undo, events.undoStory) whose event turns a user off.
 * - The handler reads the user again in the same statement: a user who is on again when the effect runs keeps the links.
 * - This module holds no MCP code, so the api and jobs bundles carry it. server/calls/agents.ts imports it, so every entry that
 *   builds the call map registers it.
 */

export const REVOKE_ALL_KIND = 'agents.revokeAll';

export const REVOKE_ALL_SQL =
  'update agent_links l set revoked_at = now() from users u where u.id = $1 and not u.active and l.revoked_at is null and (l.owner_user_id = $1 or l.agent_user_id = $1)';

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
