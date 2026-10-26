import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Day, Payment, PaymentId, ProjectId } from '../contract/entities';
import { PaymentRow } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { assertNotInternal } from '../internalProject';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { nextId, paymentsOf } from '../store';
import { paymentRowOf } from '../views';
import { assertCan, requireProject, seesProject } from './shared';

const Name = z.string().trim().min(1).max(120);
const Amount = Payment.shape.amount;
const Note = z.string().max(500);

/**
 * Payments are for the people with the payment rights (fbk_014): by default the Admin, Management and Accounting. Each call asks its
 * own right: see (list), add (create), change (update and delete) and receive (mark as received).
 * No payment call works for anyone else, a project leader and an agent of a member included. None of these calls marks the project
 * as updated, so a member never sees a sign of a change.
 */
function requireRight(ctx: Ctx, right: 'payment.view' | 'payment.add' | 'payment.change' | 'payment.receive' | 'payment.daftraLink'): void {
  assertCan(ctx, right);
}

/** A payment by id. One of a project that the person does not see reads as missing, with the text of an unknown payment (hidden projects). */
function requirePayment(ctx: Ctx, id: string): Payment {
  const payment = paymentsOf(ctx.state)[id];
  if (!payment || !seesProject(ctx, payment.projectId)) throw notFound('Payment', id);
  return payment;
}

/** Money cannot arrive in the future. */
function assertNotFuture(ctx: Ctx, receivedOn: string | null | undefined): void {
  if (receivedOn && receivedOn > ctx.today) throw invalid('receivedOn', 'The received date cannot be in the future.', 'future_received');
}

const paymentsList = defineCall({
  input: z.object({ projectId: ProjectId }),
  output: z.array(PaymentRow),
  readOnly: true,
  run(input, ctx) {
    requireRight(ctx, 'payment.view');
    requireProject(ctx, input.projectId);
    return Object.values(paymentsOf(ctx.state))
      .filter((p) => p.projectId === input.projectId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
      .map((p) => paymentRowOf(ctx.state, p, ctx.today));
  },
});

const paymentsCreate = defineCall({
  input: z.object({
    projectId: ProjectId,
    name: Name,
    amount: Amount,
    dueDate: Day,
    receivedOn: Day.nullable().default(null),
    note: Note.default(''),
  }),
  output: PaymentRow,
  run(input, ctx) {
    requireRight(ctx, 'payment.add');
    const project = requireProject(ctx, input.projectId);
    // An internal project has no client, so no payments (fbk_044).
    assertNotInternal(ctx, project);
    assertNotFuture(ctx, input.receivedOn);
    const id = nextId(ctx.state, 'pay');
    const payment: Payment = {
      id, projectId: project.id, name: input.name, amount: input.amount, dueDate: input.dueDate, receivedOn: input.receivedOn,
      note: input.note, createdBy: ctx.actor.id, createdAt: ctx.stamp,
    };
    paymentsOf(ctx.state)[id] = payment;
    recordCreate(ctx, { projectId: project.id, verb: 'payment.created', targetType: 'payment', targetId: id, entity: payment });
    return paymentRowOf(ctx.state, payment, ctx.today);
  },
});

const paymentsUpdate = defineCall({
  input: z.object({
    id: PaymentId,
    patch: z.object({
      name: Name.optional(),
      amount: Amount.optional(),
      dueDate: Day.optional(),
      receivedOn: Day.nullable().optional(),
      note: Note.optional(),
    }).strict(),
  }),
  output: PaymentRow,
  run(input, ctx) {
    requireRight(ctx, 'payment.change');
    const payment = requirePayment(ctx, input.id);
    assertNotFuture(ctx, input.patch.receivedOn);
    applyPatch(ctx, payment, input.patch, { projectId: payment.projectId, verb: 'payment.updated', targetType: 'payment', targetId: payment.id });
    return paymentRowOf(ctx.state, payment, ctx.today);
  },
});

const paymentsMarkReceived = defineCall({
  input: z.object({ id: PaymentId, receivedOn: Day.optional() }),
  output: PaymentRow,
  run(input, ctx) {
    requireRight(ctx, 'payment.receive');
    const payment = requirePayment(ctx, input.id);
    if (payment.receivedOn) throw invalid('id', 'This payment is already marked as received.', 'already_received');
    const receivedOn = input.receivedOn ?? ctx.today;
    assertNotFuture(ctx, receivedOn);
    applyPatch(ctx, payment, { receivedOn }, { projectId: payment.projectId, verb: 'payment.received', targetType: 'payment', targetId: payment.id });
    return paymentRowOf(ctx.state, payment, ctx.today);
  },
});

const paymentsDelete = defineCall({
  input: z.object({ id: PaymentId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    requireRight(ctx, 'payment.change');
    const payment = requirePayment(ctx, input.id);
    recordDelete(ctx, { projectId: payment.projectId, verb: 'payment.deleted', targetType: 'payment', targetId: payment.id, entity: payment });
    delete paymentsOf(ctx.state)[payment.id];
    return { deleted: true as const };
  },
});

/**
 * What the server reads from Daftra before the link call (server/calls/daftra.ts, the preflight of payments.linkInvoice): the invoice
 * itself, never the word of the browser, and the account that it read it from (the account of the project, one for each sub-company). `total`
 * is the total with VAT in riyals. The handler only copies it into Payment.daftra.
 */
export type DaftraSnapshot = { account: string; invoiceId: string; invoiceNo: string; total: number; issuedOn: string };

/** The Daftra link is for a person, never for an agent (MCP deny list). Rights: see payments, and the switch Link Daftra invoices. */
function requireDaftraLink(ctx: Ctx): void {
  if (ctx.actor.kind === 'agent') throw forbidden('An agent never uses the Daftra link.', { action: 'payment.daftraLink' });
  requireRight(ctx, 'payment.view');
  requireRight(ctx, 'payment.daftraLink');
}

const paymentsLinkInvoice = defineCall({
  input: z.object({ id: PaymentId, invoiceId: z.string().regex(/^[0-9]{1,20}$/, 'A Daftra invoice id is a number.') }),
  output: PaymentRow,
  /**
   * The prototype has no Daftra, so it refuses. The server never runs this: its hook reads the invoice from Daftra (server/calls/daftra.ts)
   * and checks the client, the draft flag and the config before the lock.
   */
  async prepare(): Promise<DaftraSnapshot> {
    throw invalid('invoiceId', 'The Daftra link works in the real Madar only.', 'daftra_not_ready');
  },
  run(input, ctx, prepared) {
    requireDaftraLink(ctx);
    const payment = requirePayment(ctx, input.id);
    if (prepared.invoiceId !== input.invoiceId) throw invalid('invoiceId', 'This invoice changed. Choose it again.', 'daftra_invoice_changed');
    if (payment.daftra) {
      if (payment.daftra.account === prepared.account && payment.daftra.invoiceId === prepared.invoiceId) return paymentRowOf(ctx.state, payment, ctx.today);
      throw invalid('invoiceId', 'This payment has another Daftra invoice. Unlink it first.', 'daftra_already_linked');
    }
    // The loader reads every payment that holds this invoice id, so a second link to one invoice is refused inside the lock. An invoice is
    // known by its account and its id together: the same id in another account is another invoice.
    const holder = Object.values(paymentsOf(ctx.state)).some(
      (other) => other.id !== payment.id && other.daftra?.invoiceId === prepared.invoiceId && other.daftra.account === prepared.account,
    );
    if (holder) throw invalid('invoiceId', 'Another payment has this Daftra invoice.', 'daftra_invoice_taken');
    const daftra = {
      account: prepared.account, invoiceId: prepared.invoiceId, invoiceNo: prepared.invoiceNo, total: prepared.total, issuedOn: prepared.issuedOn, linkedBy: ctx.actor.id, linkedAt: ctx.stamp,
    };
    payment.daftra = daftra;
    // The before side holds null, not a missing key, so the Undo can name the field and take it away again (events.ts, ABSENT_WHEN_NULL).
    writeEvent(ctx, {
      projectId: payment.projectId, verb: 'payment.daftra_linked', targetType: 'payment', targetId: payment.id, before: { daftra: null }, after: { daftra: structuredClone(daftra) },
    });
    return paymentRowOf(ctx.state, payment, ctx.today);
  },
});

const paymentsUnlinkInvoice = defineCall({
  input: z.object({ id: PaymentId }),
  output: PaymentRow,
  run(input, ctx) {
    requireDaftraLink(ctx);
    const payment = requirePayment(ctx, input.id);
    // Nothing to unlink is no error: a second press of the button changes nothing. A payment that Daftra already marked as received keeps its day.
    if (!payment.daftra) return paymentRowOf(ctx.state, payment, ctx.today);
    const was = payment.daftra;
    delete payment.daftra;
    writeEvent(ctx, {
      projectId: payment.projectId, verb: 'payment.daftra_unlinked', targetType: 'payment', targetId: payment.id, before: { daftra: structuredClone(was) }, after: { daftra: null },
    });
    return paymentRowOf(ctx.state, payment, ctx.today);
  },
});

export const paymentCalls = {
  'payments.list': paymentsList,
  'payments.create': paymentsCreate,
  'payments.update': paymentsUpdate,
  'payments.markReceived': paymentsMarkReceived,
  'payments.delete': paymentsDelete,
  'payments.linkInvoice': paymentsLinkInvoice,
  'payments.unlinkInvoice': paymentsUnlinkInvoice,
};
