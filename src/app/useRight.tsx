import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import type { CallOutput } from '../api/calls';
import { can, type Action, type Resource } from '../api/permissions';
import type { GuardRead } from './guardReads';
import { usePrefetchCall } from './prefetch';
import { NotFound } from './RouteError';
import { useCall } from './runtime';

/**
 * Role rights version 2 (owner, 2026-10-21): a control that has no project or to-do asks the rights of the session. session.get
 * attaches the held switches (officeRights) to the authority, and can() reads them as the server does.
 * "whileLoading" is the answer before the session arrives. A button waits hidden (fail closed). A tab of the tab bar shows, so the bar
 * does not jump for the many people who hold the switch; its route asks the session again.
 */
export function useCan(whileLoading = false): (action: Action, resource?: Resource) => boolean {
  const session = useCall('session.get', {}).data;
  return (action, resource) => (session?.authority ? can(session.authority, action, resource) : whileLoading);
}

/** True when the person of the session holds the action. */
export function useRight(action: Action, resource?: Resource, whileLoading = false): boolean {
  return useCan(whileLoading)(action, resource);
}

/**
 * A screen that needs a switch. Without it, the address shows the page that a wrong link shows, with the way Home (the rule of a
 * section of the Admin page that the person may not open). The screen inside never mounts, so it asks the server nothing.
 */
export function RequireRight({ action, framed = false, children }: { action: Action; framed?: boolean; children: ReactNode }) {
  const session = useCall('session.get', {}).data;
  if (!session?.authority) return null;
  return can(session.authority, action) ? <>{children}</> : <NotFound framed={framed} />;
}

/**
 * Starts the reads of a guarded screen with the session (performance audit 2026-10-21, DF-7). The guard draws nothing until
 * session.get answers, so without this the reads of the screen would start one round trip later. The reads come from guardReads.ts.
 * They start once, when the guard mounts; a later change of the link is read by the screen itself. A session in the cache that lacks
 * the switch of the route starts nothing: the server would refuse each read.
 */
export function StartReads({ reads, action, children }: {
  reads: (params: URLSearchParams, section: string | undefined) => GuardRead[]; action?: Action; children: ReactNode;
}) {
  const [params] = useSearchParams();
  const { section } = useParams();
  const prefetch = usePrefetchCall();
  const client = useQueryClient();
  useEffect(() => {
    const cached = client.getQueryData<CallOutput<'session.get'>>(['api', 'session.get', {}]);
    if (action && cached?.authority && !can(cached.authority, action)) return;
    for (const start of reads(params, section)) start(prefetch);
    // Once for each mount of the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}
