import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Day, Payment, PaymentId, ProjectId } from '../contract/entities';
import { PaymentRow } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
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
function requireRight(ctx: Ctx, right: 'payment.view' | 'payment.add' | 'payment.change' | 'payment.receive'): void {
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

export const paymentCalls = {
  'payments.list': paymentsList,
  'payments.create': paymentsCreate,
  'payments.update': paymentsUpdate,
  'payments.markReceived': paymentsMarkReceived,
  'payments.delete': paymentsDelete,
};
