import { useEffect, useState } from 'react';
import type { AdminReach } from '../../api/contract/entities';
import { useCall, useRuntime } from '../../app/runtime';
import { reachOfSession } from '../../lib/projectReach';
import { readHint, writeRoleHint } from './roleHint';

/**
 * The role and the "What reaches me" choice of the person, for the screens that choose a project list: Home and Projects. Before
 * session.get answers, the real build takes what this device saw last for this auth user, so the first request carries the right list
 * (performance audit 2026-10-07, FET-8; the reach: owner, 2026-10-26, fbk_065). The session answer then decides. The prototype has no auth
 * user and no hint. `known` is true when the session answered or a hint exists: a screen whose list depends on the reach waits for it.
 */
export function useRoleHint(): { admin: boolean; reach: AdminReach; known: boolean } {
  const { mode, auth } = useRuntime();
  const authUserId = mode === 'remote' ? auth?.userId?.() ?? null : null;
  const [hint] = useState(() => readHint(authUserId));
  const session = useCall('session.get', {});
  const answer = session.data;
  const role = answer?.user.systemRole;
  const reach = reachOfSession(answer);
  useEffect(() => {
    if (authUserId && role) writeRoleHint(authUserId, role, reach);
  }, [authUserId, role, reach]);
  const admin = (role ?? hint.role) === 'admin';
  return { admin, reach: answer ? reach : admin ? hint.reach : 'mixed', known: Boolean(answer) || hint.role !== null };
}
