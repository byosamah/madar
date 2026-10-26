import { z } from 'zod';
import { DAFTRA_ACCOUNT_PATTERN } from '../../src/api/contract/limits';
import { Day, PaymentId } from '../../src/api/contract/entities';
import { applyPatch } from '../../src/api/events';
import { defineCall, type AnyCall } from '../../src/api/registry';
import { paymentsOf } from '../../src/api/store';
import { buildServerCallMap } from '../core/serverCallMap';

/**
 * The one write that the job step `daftra` makes (the Daftra link, owner 2026-10-26): Daftra says the invoice of a payment is paid, so Madar
 * sets `receivedOn`. It is a call that no person and no agent can reach: it is NOT in `sharedCalls` or `SERVER_CALLS`, so the public map
 * `serverCallMap` has no entry for it, the HTTP routes and the MCP tools answer `not_found` for its name, and no screen can send it. Only the
 * job step passes `DAFTRA_INTERNAL_CALLS` to `createRunCall`. It still runs through runCall, so it has the office lock, a story, the events,
 * the save and the Realtime signals of every other write.
 *
 * The call checks again, inside the lock, that the payment still holds the same invoice of the same account and has no received day, because
 * a person may have unlinked or changed the payment since the job read it. A payment that changed is a quiet no-op (`received: false`).
 * The day never lies after today. The event verb `payment.received_daftra` names Daftra as the source, and it has no Undo (history.ts).
 */

export const DAFTRA_PAID_CALL = 'payments.daftraPaid';

const daftraPaid = defineCall({
  input: z.object({ id: PaymentId, account: z.string().regex(DAFTRA_ACCOUNT_PATTERN), invoiceId: z.string().min(1).max(40), receivedOn: Day }),
  output: z.object({ received: z.boolean() }),
  run(input, ctx) {
    const payment = paymentsOf(ctx.state)[input.id];
    if (!payment || !payment.daftra || payment.receivedOn) return { received: false };
    if (payment.daftra.account !== input.account || payment.daftra.invoiceId !== input.invoiceId) return { received: false };
    const receivedOn = input.receivedOn > ctx.today ? ctx.today : input.receivedOn;
    applyPatch(ctx, payment, { receivedOn }, { projectId: payment.projectId, verb: 'payment.received_daftra', targetType: 'payment', targetId: payment.id });
    return { received: true };
  },
});

/** The private call map of the job step. It holds the one call above and nothing else. */
export const DAFTRA_INTERNAL_CALLS = buildServerCallMap({
  shared: { [DAFTRA_PAID_CALL]: daftraPaid as unknown as AnyCall },
  server: {},
  contracts: {},
  hooks: {},
});
