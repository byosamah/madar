import { describe, expect, it } from 'vitest';
import { freshLite } from '../data/lite/testDb';
import type { DaftraInvoice } from './parse';
import { allMatches, cachedInvoicesOf, clientMatch, putInvoices, putMatch, readState, saveGoodRead, saveProblem, takenInvoiceIds } from './store';

const AT = new Date('2026-10-26T06:00:00.000Z');
const invoice = (over: Partial<DaftraInvoice> & { id: string }): DaftraInvoice => ({
  no: `N${over.id}`, clientId: '842', totalHalalas: 1_250_000, issuedOn: '2026-10-20', createdAt: '2026-10-21T10:00:00.000Z', paymentStatus: 0, paidOn: null, draft: false, ...over,
});

describe('the Daftra store on SQLite', () => {
  it('keeps one match for each Madar client, and a second match replaces the first', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      expect(await clientMatch(q, 'cli_001')).toBeUndefined();
      await putMatch(q, { clientId: 'cli_001', daftraId: '842', daftraName: 'Al Noor', matchedBy: 'usr_002', at: AT });
      await putMatch(q, { clientId: 'cli_002', daftraId: '99', daftraName: 'Other', matchedBy: 'usr_002', at: AT });
      expect(await clientMatch(q, 'cli_001')).toEqual({ clientId: 'cli_001', daftraId: '842', daftraName: 'Al Noor', matchedBy: 'usr_002', matchedAt: AT.toISOString() });
      await putMatch(q, { clientId: 'cli_001', daftraId: '777', daftraName: 'Al Noor Group', matchedBy: 'usr_003', at: new Date('2026-10-27T06:00:00.000Z') });
      expect(await clientMatch(q, 'cli_001')).toMatchObject({ daftraId: '777', daftraName: 'Al Noor Group', matchedBy: 'usr_003', matchedAt: '2026-10-27T06:00:00.000Z' });
      expect((await allMatches(q)).map((m) => m.clientId)).toEqual(['cli_001', 'cli_002']);
    });
  });

  it('saves invoices, reads them newest first for one Daftra client, and updates an invoice in place', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putInvoices(q, [
        invoice({ id: '1', createdAt: '2026-10-01T10:00:00.000Z' }),
        invoice({ id: '2', createdAt: '2026-10-09T10:00:00.000Z', draft: true }),
        invoice({ id: '3', clientId: '99' }),
      ], AT);
      const rows = await cachedInvoicesOf(q, '842');
      expect(rows.map((r) => r.id)).toEqual(['2', '1']);
      expect(rows[0]).toEqual({ id: '2', no: 'N2', totalHalalas: 1_250_000, issuedOn: '2026-10-20', createdAt: '2026-10-09T10:00:00.000Z', paymentStatus: 0, paidOn: null, draft: true });
      await putInvoices(q, [invoice({ id: '2', createdAt: '2026-10-09T10:00:00.000Z', draft: false, totalHalalas: 5, paymentStatus: 2 })], AT);
      const again = await cachedInvoicesOf(q, '842');
      expect(again).toHaveLength(2);
      expect(again[0]).toMatchObject({ id: '2', draft: false, totalHalalas: 5, paymentStatus: 2 });
    });
  });

  it('keeps the paid day of an earlier read when a list read has none', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putInvoices(q, [invoice({ id: '1', paymentStatus: 2, paidOn: '2026-10-22' })], AT);
      await putInvoices(q, [invoice({ id: '1', paymentStatus: 2, paidOn: null })], AT);
      expect((await cachedInvoicesOf(q, '842'))[0].paidOn).toBe('2026-10-22');
      await putInvoices(q, [invoice({ id: '1', paymentStatus: 2, paidOn: '2026-10-24' })], AT);
      expect((await cachedInvoicesOf(q, '842'))[0].paidOn).toBe('2026-10-24');
    });
  });

  it('reads at most 100 invoices of a client', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putInvoices(q, Array.from({ length: 120 }, (_, n) => invoice({ id: String(1000 + n), createdAt: `2026-10-01T10:${String(n % 60).padStart(2, '0')}:00.000Z` })), AT);
      expect(await cachedInvoicesOf(q, '842')).toHaveLength(100);
    });
  });

  it('finds the invoice ids that another payment holds', async () => {
    const { db } = await freshLite();
    const doc = (id: string, invoiceId?: string) => JSON.stringify({ id, projectId: 'prj_001', name: 'P', amount: 5, dueDate: '2026-10-26', receivedOn: null, note: '', createdBy: 'usr_001', createdAt: '2026-10-01T00:00:00.000+03:00', ...(invoiceId ? { daftra: { invoiceId } } : {}) });
    await db.tx('write', async (q) => {
      await q('insert into payments (id, doc) values (?1, ?2)', ['pay_001', doc('pay_001', '10')]);
      await q('insert into payments (id, doc) values (?1, ?2)', ['pay_002', doc('pay_002', '11')]);
      await q('insert into payments (id, doc) values (?1, ?2)', ['pay_003', doc('pay_003')]);
      expect([...(await takenInvoiceIds(q, ['10', '11', '12'], 'pay_009'))].sort()).toEqual(['10', '11']);
      expect([...(await takenInvoiceIds(q, ['10', '11', '12'], 'pay_001'))]).toEqual(['11']);
      expect((await takenInvoiceIds(q, [], 'pay_001')).size).toBe(0);
    });
  });

  it('keeps the state of the last read: a good read clears the problem, a problem keeps the last good read', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      expect(await readState(q)).toEqual({ lastReadAt: null, problem: null });
      await saveProblem(q, 'bad_key', AT);
      expect(await readState(q)).toEqual({ lastReadAt: null, problem: 'bad_key' });
      await saveGoodRead(q, new Date('2026-10-26T06:15:00.000Z'));
      expect(await readState(q)).toEqual({ lastReadAt: '2026-10-26T06:15:00.000Z', problem: null });
      await saveProblem(q, 'unreachable', new Date('2026-10-26T06:30:00.000Z'));
      await saveProblem(q, 'refused', new Date('2026-10-26T06:45:00.000Z'));
      expect(await readState(q)).toEqual({ lastReadAt: '2026-10-26T06:15:00.000Z', problem: 'refused' });
      expect((await q<{ key: string }>("select key from job_runs where key like 'daftra:%' order by key")).map((r) => r.key)).toEqual(['daftra:problem:refused', 'daftra:read']);
    });
  });
});
