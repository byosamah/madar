import type { QueryClient } from '@tanstack/react-query';
import type { CallInput, CallName } from '../../api/calls';
import type { User } from '../../api/contract/entities';
import { can } from '../../api/permissions';

/**
 * One read that a screen part mounts, with the exact input of its useCall. A prefetch of it fills the same cache key, so the
 * part finds the answer there and asks the server nothing (performance audit 2026-10-07, FET-1, FET-2, LIV-1, FET-12).
 */
export type Read = { [N in CallName]: { name: N; input: CallInput<N> } }[CallName];

/** Starts each read with the prefetch function of usePrefetchCall (src/app/prefetch.ts). Call it in an effect, never in render. */
export function prefetchReads(prefetch: <N extends CallName>(name: N, input: CallInput<N>) => void, reads: readonly Read[]): void {
  const start = prefetch as (name: CallName, input: unknown) => void;
  for (const read of reads) start(read.name, read.input);
}

/**
 * True when the person of the cached session may see payments: the rule of viewerCan.payments (src/api/views.ts), so only
 * the payment roles prefetch payments.list. False while the session is not cached: the payments part then asks as before.
 */
export function sessionSeesPayments(queryClient: QueryClient): boolean {
  const session = queryClient.getQueryData<{ authority?: User }>(['api', 'session.get', {}]);
  return session?.authority ? can(session.authority, 'payment.view') : false;
}

/**
 * True when the cached session may add a to-do on a project where the person is on the team, and the Tasks tab shows the list view
 * (the gates of the template menu in TasksTab.tsx; DF-13). A guess for the prefetch only: the tab still asks with the exact gate
 * (viewerCan.addTask), so a wrong guess costs one read and never shows a thing. False while the session is not cached.
 */
export function sessionMayAddTask(queryClient: QueryClient): boolean {
  const session = queryClient.getQueryData<{ authority?: User }>(['api', 'session.get', {}]);
  if (!session?.authority || !can(session.authority, 'task.add', { projectRole: 'team' })) return false;
  try {
    return window.localStorage.getItem('madar.tasks.view') !== 'board';
  } catch {
    return true;
  }
}
