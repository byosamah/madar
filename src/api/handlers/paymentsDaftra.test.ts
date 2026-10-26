import { beforeEach, describe, expect, it } from 'vitest';
import { defineCall } from '../registry';
import { paymentCalls, type DaftraSnapshot } from './payments';
import { historyCalls } from './history';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The two payment calls of the Daftra link (owner, 2026-10-26). The server preflight reads the invoice from Daftra and gives the snapshot as
 * `prepared`: here a test prepare stands in for it, so no test reaches Daftra. The prototype prepare of the real call refuses.
 */
let snapshot: DaftraSnapshot = { account: 'MAZJ', invoiceId: '1830', invoiceNo: '1521945', total: 12500, issuedOn: '2026-09-29' };
const withSnapshot = defineCall({ ...paymentCalls['payments.linkInvoice'], async prepare() { return snapshot; } });
const calls = { ...paymentCalls, 'payments.linkInvoice': withSnapshot, ...historyCalls };

// usr_001 Admin, usr_002 leads prj_001, usr_003 is on its team, usr_004 is outside, usr_005 is the agent of usr_003.
// usr_006 Management (no Daftra switch by default), usr_007 Accounting (holds it), usr_008 the agent of usr_007.
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  for (const user of [
    makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' }),
    makeUser('usr_007', { name: 'Noura Accounting', systemRole: 'accounting' }),
    makeUser('usr_008', { name: 'Accounts Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_007' }),
  ]) state.users[user.id] = user;
  state.counters.usr = 8;
  return t;
}

const NEW = { projectId: 'prj_001', name: 'Concept stage fee', amount: 12500, dueDate: '2026-10-10' };
const LINKED = { account: 'MAZJ', invoiceId: '1830', invoiceNo: '1521945', total: 12500, issuedOn: '2026-09-29' };

async function withPayment(extra: Partial<typeof NEW> = {}) {
  const t = world();
  snapshot = { ...LINKED };
  t.as('usr_007');
  const row = await t.api.call('payments.create', { ...NEW, ...extra });
  return { t, id: row.payment.id };
}

describe('payments.linkInvoice', () => {
  it('sets Payment.daftra from the prepared snapshot, and writes one event with the person who linked it', async () => {
    const { t, id } = await withPayment();
    const row = await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    expect(row.payment.daftra).toEqual({ ...LINKED, linkedBy: 'usr_007', linkedAt: '2026-09-30T09:00:00.000+03:00' });
    // The status keeps its three values: a linked payment is still awaiting until Daftra says paid.
    expect(row.status).toBe('awaiting');
    const events = Object.values(t.store.state.events).filter((e) => e.verb === 'payment.daftra_linked');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ targetType: 'payment', targetId: id, projectId: 'prj_001', actorId: 'usr_007', before: { daftra: null }, after: { daftra: row.payment.daftra } });
  });

  it('takes the invoice from the snapshot, never from the browser: an invoiceId that the snapshot does not hold is refused', async () => {
    const { t, id } = await withPayment();
    await expect(t.api.call('payments.linkInvoice', { id, invoiceId: '9999' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_invoice_changed' } });
    expect(t.store.state.payments?.[id].daftra).toBeUndefined();
  });

  it('lets the Admin and Accounting link, and refuses Management, a member, the leader, an outsider and every agent', async () => {
    for (const user of ['usr_001', 'usr_007']) {
      const { t, id } = await withPayment();
      t.as(user);
      expect((await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' })).payment.daftra?.linkedBy).toBe(user);
    }
    for (const user of ['usr_006', 'usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_008']) {
      const { t, id } = await withPayment();
      t.as(user);
      await expect(t.api.call('payments.linkInvoice', { id, invoiceId: '1830' }), user).rejects.toMatchObject({ code: 'forbidden' });
      expect(t.store.state.payments?.[id].daftra, user).toBeUndefined();
    }
  });

  it('needs the switch Link Daftra invoices: a role with payment.manage but not the switch cannot link', async () => {
    const { t, id } = await withPayment();
    t.store.state.settings.roles = { custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.view', 'payment.receive'] }] };
    t.store.state.users.usr_011 = makeUser('usr_011', { name: 'Cashier Person', roleId: 'rol_001' });
    t.as('usr_011');
    await expect(t.api.call('payments.linkInvoice', { id, invoiceId: '1830' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a second payment for the same invoice (daftra_invoice_taken), and leaves the first link', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    const second = await t.api.call('payments.create', { ...NEW, name: 'Second fee', dueDate: '2026-11-10' });
    await expect(t.api.call('payments.linkInvoice', { id: second.payment.id, invoiceId: '1830' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_invoice_taken' } });
    expect(t.store.state.payments?.[second.payment.id].daftra).toBeUndefined();
    expect(t.store.state.payments?.[id].daftra?.invoiceId).toBe('1830');
  });

  it('is a quiet repeat for the same invoice, and refuses another invoice on a linked payment (daftra_already_linked)', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    const again = await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    expect(again.payment.daftra?.invoiceId).toBe('1830');
    expect(Object.values(t.store.state.events).filter((e) => e.verb === 'payment.daftra_linked')).toHaveLength(1);
    snapshot = { ...LINKED, invoiceId: '1831', invoiceNo: '1521946' };
    await expect(t.api.call('payments.linkInvoice', { id, invoiceId: '1831' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_already_linked' } });
  });

  it('knows an invoice by its account and its id together: the same id in another account is another invoice', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    const second = await t.api.call('payments.create', { ...NEW, name: 'Second fee', dueDate: '2026-11-10' });
    snapshot = { ...LINKED, account: 'VADO' };
    const row = await t.api.call('payments.linkInvoice', { id: second.payment.id, invoiceId: '1830' });
    expect(row.payment.daftra).toMatchObject({ account: 'VADO', invoiceId: '1830' });
    expect(t.store.state.payments?.[id].daftra?.account).toBe('MAZJ');
  });

  it('refuses a payment that has an invoice of another account as already linked (the account is part of the link)', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    snapshot = { ...LINKED, account: 'VADO' };
    await expect(t.api.call('payments.linkInvoice', { id, invoiceId: '1830' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_already_linked' } });
    expect(t.store.state.payments?.[id].daftra?.account).toBe('MAZJ');
  });

  it('accepts a different amount (a partial invoice is possible) and keeps the total of the invoice', async () => {
    const { t, id } = await withPayment({ amount: 20000 });
    const row = await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    expect(row.payment.amount).toBe(20000);
    expect(row.payment.daftra?.total).toBe(12500);
  });

  it('answers not_found for a payment that is not there', async () => {
    const { t } = await withPayment();
    await expect(t.api.call('payments.linkInvoice', { id: 'pay_404', invoiceId: '1830' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('payments.unlinkInvoice', { id: 'pay_404' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('the prototype call, with its own prepare, refuses with daftra_not_ready and changes nothing', async () => {
    const t = testApi({ ...paymentCalls });
    t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Noura Accounting', systemRole: 'accounting' });
    t.as('usr_007');
    const row = await t.api.call('payments.create', NEW);
    await expect(t.api.call('payments.linkInvoice', { id: row.payment.id, invoiceId: '1830' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_not_ready' } });
    expect(t.store.state.payments?.[row.payment.id].daftra).toBeUndefined();
  });

  it('takes only a number for the invoice id', async () => {
    const { t, id } = await withPayment();
    for (const invoiceId of ['', 'abc', '12 3', '1'.repeat(21)]) await expect(t.api.call('payments.linkInvoice', { id, invoiceId })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('payments.unlinkInvoice', () => {
  it('clears the link with one event, keeps receivedOn, and is quiet when nothing is linked', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    await t.api.call('payments.update', { id, patch: { receivedOn: '2026-09-29' } });
    const row = await t.api.call('payments.unlinkInvoice', { id });
    expect(row.payment.daftra).toBeUndefined();
    expect('daftra' in row.payment).toBe(false);
    expect(row.payment.receivedOn).toBe('2026-09-29');
    const events = Object.values(t.store.state.events).filter((e) => e.verb === 'payment.daftra_unlinked');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ before: { daftra: { invoiceId: '1830' } }, after: { daftra: null } });
    await t.api.call('payments.unlinkInvoice', { id });
    expect(Object.values(t.store.state.events).filter((e) => e.verb === 'payment.daftra_unlinked')).toHaveLength(1);
  });

  it('lets the Admin and Accounting unlink, and refuses everyone else and every agent', async () => {
    for (const user of ['usr_006', 'usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_008']) {
      const { t, id } = await withPayment();
      await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
      t.as(user);
      await expect(t.api.call('payments.unlinkInvoice', { id }), user).rejects.toMatchObject({ code: 'forbidden' });
      expect(t.store.state.payments?.[id].daftra?.invoiceId, user).toBe('1830');
    }
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    t.as('usr_001');
    expect((await t.api.call('payments.unlinkInvoice', { id })).payment.daftra).toBeUndefined();
  });

  it('frees the invoice for another payment', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    const second = await t.api.call('payments.create', { ...NEW, name: 'Second fee', dueDate: '2026-11-10' });
    await t.api.call('payments.unlinkInvoice', { id });
    expect((await t.api.call('payments.linkInvoice', { id: second.payment.id, invoiceId: '1830' })).payment.daftra?.invoiceId).toBe('1830');
  });
});

describe('Undo of the link and the unlink', () => {
  it('takes a link back: the field is gone, not null, so the payment still parses', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'payment.daftra_linked')!;
    await t.api.call('events.undo', { eventId: event.id });
    expect('daftra' in t.store.state.payments![id]).toBe(false);
  });

  it('takes an unlink back: the link comes again', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    await t.api.call('payments.unlinkInvoice', { id });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'payment.daftra_unlinked')!;
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.payments![id].daftra).toMatchObject({ invoiceId: '1830', linkedBy: 'usr_007' });
  });

  // Security review 2026-10-26: an Undo must never give one Daftra invoice to two payments. Two links to one invoice would let one
  // payment in Daftra mark two payments in Madar as received.
  it('refuses the Undo of an unlink when another payment took the invoice since (daftra_invoice_taken), and changes nothing', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    await t.api.call('payments.unlinkInvoice', { id });
    const second = await t.api.call('payments.create', { ...NEW, name: 'Second fee', dueDate: '2026-11-10' });
    await t.api.call('payments.linkInvoice', { id: second.payment.id, invoiceId: '1830' });
    const unlink = Object.values(t.store.state.events).find((e) => e.verb === 'payment.daftra_unlinked')!;
    await expect(t.api.call('events.undo', { eventId: unlink.id })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'daftra_invoice_taken' } });
    await expect(t.api.call('events.undoStory', { correlationId: unlink.correlationId })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'daftra_invoice_taken' } });
    expect(t.store.state.payments![id].daftra).toBeUndefined();
    expect(t.store.state.payments![second.payment.id].daftra?.invoiceId).toBe('1830');
  });

  it('refuses the Undo of a delete that would bring back a link to an invoice that another payment took since', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    await t.api.call('payments.delete', { id });
    const second = await t.api.call('payments.create', { ...NEW, name: 'Second fee', dueDate: '2026-11-10' });
    await t.api.call('payments.linkInvoice', { id: second.payment.id, invoiceId: '1830' });
    const deleted = Object.values(t.store.state.events).find((e) => e.verb === 'payment.deleted')!;
    await expect(t.api.call('events.undo', { eventId: deleted.id })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'daftra_invoice_taken' } });
    expect(t.store.state.payments![id]).toBeUndefined();
  });

  it('still brings back a deleted linked payment when no other payment holds its invoice', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    await t.api.call('payments.delete', { id });
    const deleted = Object.values(t.store.state.events).find((e) => e.verb === 'payment.deleted')!;
    await t.api.call('events.undo', { eventId: deleted.id });
    expect(t.store.state.payments![id].daftra?.invoiceId).toBe('1830');
  });

  it('asks the switch Link Daftra invoices, and an agent never undoes it, even for its own person', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'payment.daftra_linked')!;
    t.as('usr_008');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_006');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect('daftra' in t.store.state.payments![id]).toBe(true);
  });
});

describe('the other payment calls keep their rules for a linked payment', () => {
  it('markReceived and update still work, and a received payment keeps its link', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    const row = await t.api.call('payments.markReceived', { id });
    expect(row.status).toBe('received');
    expect(row.payment.daftra?.invoiceId).toBe('1830');
    const edited = await t.api.call('payments.update', { id, patch: { note: 'Paid' } });
    expect(edited.payment.daftra?.invoiceId).toBe('1830');
  });

  it('payments.list gives the daftra field only to a person who holds payment.view', async () => {
    const { t, id } = await withPayment();
    await t.api.call('payments.linkInvoice', { id, invoiceId: '1830' });
    expect((await t.api.call('payments.list', { projectId: 'prj_001' }))[0].payment.daftra?.invoiceNo).toBe('1521945');
    for (const user of ['usr_003', 'usr_004', 'usr_005', 'usr_002']) {
      t.as(user);
      await expect(t.api.call('payments.list', { projectId: 'prj_001' }), user).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
});
