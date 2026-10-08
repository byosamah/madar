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
 * True when the person of the cached session may manage payments: the rule of viewerCan.payments (src/api/views.ts), so only
 * the payment roles prefetch payments.list. False while the session is not cached: the payments part then asks as before.
 */
export function sessionSeesPayments(queryClient: QueryClient): boolean {
  const session = queryClient.getQueryData<{ authority?: User }>(['api', 'session.get', {}]);
  return session?.authority ? can(session.authority, 'payment.manage') : false;
}
