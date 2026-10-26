import { describe, expect, it } from 'vitest';
import { freshLite } from '../data/lite/testDb';
import type { DaftraInvoice } from './parse';
import { allMatches, cachedInvoicesOf, clientMatch, putInvoices, putMatch, readStates, saveGoodRead, saveProblem, takenInvoiceIds } from './store';

const AT = new Date('2026-10-26T06:00:00.000Z');
const invoice = (over: Partial<DaftraInvoice> & { id: string }): DaftraInvoice => ({
  no: `N${over.id}`, clientId: '842', totalHalalas: 1_250_000, issuedOn: '2026-10-20', createdAt: '2026-10-21T10:00:00.000Z', paymentStatus: 0, paidOn: null, draft: false, ...over,
});

describe('the Daftra store on SQLite (one account for each sub-company)', () => {
  it('keeps one match for each Madar client and account, and a second match in the same account replaces the first', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      expect(await clientMatch(q, 'MAZJ', 'cli_001')).toBeUndefined();
      await putMatch(q, { account: 'MAZJ', clientId: 'cli_001', daftraId: '842', daftraName: 'Al Noor', matchedBy: 'usr_002', at: AT });
      await putMatch(q, { account: 'MAZJ', clientId: 'cli_002', daftraId: '99', daftraName: 'Other', matchedBy: 'usr_002', at: AT });
      expect(await clientMatch(q, 'MAZJ', 'cli_001')).toEqual({ account: 'MAZJ', clientId: 'cli_001', daftraId: '842', daftraName: 'Al Noor', matchedBy: 'usr_002', matchedAt: AT.toISOString() });
      await putMatch(q, { account: 'MAZJ', clientId: 'cli_001', daftraId: '777', daftraName: 'Al Noor Group', matchedBy: 'usr_003', at: new Date('2026-10-27T06:00:00.000Z') });
      expect(await clientMatch(q, 'MAZJ', 'cli_001')).toMatchObject({ daftraId: '777', daftraName: 'Al Noor Group', matchedBy: 'usr_003', matchedAt: '2026-10-27T06:00:00.000Z' });
      expect((await allMatches(q)).map((m) => `${m.account}/${m.clientId}`)).toEqual(['MAZJ/cli_001', 'MAZJ/cli_002']);
    });
  });

  it('keeps the match of one Madar client in two accounts apart: a match in one account never answers for another', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putMatch(q, { account: 'MAZJ', clientId: 'cli_001', daftraId: '842', daftraName: 'Al Noor (Mazj books)', matchedBy: 'usr_002', at: AT });
      expect(await clientMatch(q, 'VADO', 'cli_001')).toBeUndefined();
      await putMatch(q, { account: 'VADO', clientId: 'cli_001', daftraId: '55', daftraName: 'Al Noor (Vado books)', matchedBy: 'usr_002', at: AT });
      expect(await clientMatch(q, 'MAZJ', 'cli_001')).toMatchObject({ daftraId: '842' });
      expect(await clientMatch(q, 'VADO', 'cli_001')).toMatchObject({ daftraId: '55' });
      expect((await allMatches(q)).map((m) => m.account)).toEqual(['MAZJ', 'VADO']);
    });
  });

  it('saves invoices, reads them newest first for one Daftra client of one account, and updates an invoice in place', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putInvoices(q, 'MAZJ', [
        invoice({ id: '1', createdAt: '2026-10-01T10:00:00.000Z' }),
        invoice({ id: '2', createdAt: '2026-10-09T10:00:00.000Z', draft: true }),
        invoice({ id: '3', clientId: '99' }),
      ], AT);
      const rows = await cachedInvoicesOf(q, 'MAZJ', '842');
      expect(rows.map((r) => r.id)).toEqual(['2', '1']);
      expect(rows[0]).toEqual({ id: '2', no: 'N2', totalHalalas: 1_250_000, issuedOn: '2026-10-20', createdAt: '2026-10-09T10:00:00.000Z', paymentStatus: 0, paidOn: null, draft: true });
      await putInvoices(q, 'MAZJ', [invoice({ id: '2', createdAt: '2026-10-09T10:00:00.000Z', draft: false, totalHalalas: 5, paymentStatus: 2 })], AT);
      const again = await cachedInvoicesOf(q, 'MAZJ', '842');
      expect(again).toHaveLength(2);
      expect(again[0]).toMatchObject({ id: '2', draft: false, totalHalalas: 5, paymentStatus: 2 });
    });
  });

  it('treats the same invoice id in two accounts as two invoices, and reads only the account that it is asked for', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putInvoices(q, 'MAZJ', [invoice({ id: '1830', totalHalalas: 100 })], AT);
      await putInvoices(q, 'VADO', [invoice({ id: '1830', totalHalalas: 200 })], AT);
      expect((await cachedInvoicesOf(q, 'MAZJ', '842')).map((r) => r.totalHalalas)).toEqual([100]);
      expect((await cachedInvoicesOf(q, 'VADO', '842')).map((r) => r.totalHalalas)).toEqual([200]);
      expect(await cachedInvoicesOf(q, 'BUNAH', '842')).toEqual([]);
    });
  });

  it('keeps the paid day of an earlier read when a list read has none', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putInvoices(q, 'MAZJ', [invoice({ id: '1', paymentStatus: 2, paidOn: '2026-10-22' })], AT);
      await putInvoices(q, 'MAZJ', [invoice({ id: '1', paymentStatus: 2, paidOn: null })], AT);
      expect((await cachedInvoicesOf(q, 'MAZJ', '842'))[0].paidOn).toBe('2026-10-22');
      await putInvoices(q, 'MAZJ', [invoice({ id: '1', paymentStatus: 2, paidOn: '2026-10-24' })], AT);
      expect((await cachedInvoicesOf(q, 'MAZJ', '842'))[0].paidOn).toBe('2026-10-24');
    });
  });

  it('reads at most 100 invoices of a client', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await putInvoices(q, 'MAZJ', Array.from({ length: 120 }, (_, n) => invoice({ id: String(1000 + n), createdAt: `2026-10-01T10:${String(n % 60).padStart(2, '0')}:00.000Z` })), AT);
      expect(await cachedInvoicesOf(q, 'MAZJ', '842')).toHaveLength(100);
    });
  });

  it('finds the invoice ids that another payment holds in the same account, and never an id of another account', async () => {
    const { db } = await freshLite();
    const doc = (id: string, daftra?: { account: string; invoiceId: string }) =>
      JSON.stringify({ id, projectId: 'prj_001', name: 'P', amount: 5, dueDate: '2026-10-26', receivedOn: null, note: '', createdBy: 'usr_001', createdAt: '2026-10-01T00:00:00.000+03:00', ...(daftra ? { daftra } : {}) });
    await db.tx('write', async (q) => {
      await q('insert into payments (id, doc) values (?1, ?2)', ['pay_001', doc('pay_001', { account: 'MAZJ', invoiceId: '10' })]);
      await q('insert into payments (id, doc) values (?1, ?2)', ['pay_002', doc('pay_002', { account: 'MAZJ', invoiceId: '11' })]);
      await q('insert into payments (id, doc) values (?1, ?2)', ['pay_003', doc('pay_003')]);
      await q('insert into payments (id, doc) values (?1, ?2)', ['pay_004', doc('pay_004', { account: 'VADO', invoiceId: '12' })]);
      expect([...(await takenInvoiceIds(q, 'MAZJ', ['10', '11', '12'], 'pay_009'))].sort()).toEqual(['10', '11']);
      expect([...(await takenInvoiceIds(q, 'MAZJ', ['10', '11', '12'], 'pay_001'))]).toEqual(['11']);
      expect([...(await takenInvoiceIds(q, 'VADO', ['10', '11', '12'], 'pay_001'))]).toEqual(['12']);
      expect((await takenInvoiceIds(q, 'MAZJ', [], 'pay_001')).size).toBe(0);
    });
  });

  it('keeps the state of the last read of each account: a good read clears the problem of that account only', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      expect(await readStates(q)).toEqual({});
      await saveProblem(q, 'MAZJ', 'bad_key', AT);
      await saveProblem(q, 'VADO', 'unreachable', AT);
      expect(await readStates(q)).toEqual({ MAZJ: { lastReadAt: null, problem: 'bad_key' }, VADO: { lastReadAt: null, problem: 'unreachable' } });
      await saveGoodRead(q, 'MAZJ', new Date('2026-10-26T06:15:00.000Z'));
      expect(await readStates(q)).toEqual({ MAZJ: { lastReadAt: '2026-10-26T06:15:00.000Z', problem: null }, VADO: { lastReadAt: null, problem: 'unreachable' } });
      await saveProblem(q, 'MAZJ', 'unreachable', new Date('2026-10-26T06:30:00.000Z'));
      await saveProblem(q, 'MAZJ', 'refused', new Date('2026-10-26T06:45:00.000Z'));
      expect((await readStates(q)).MAZJ).toEqual({ lastReadAt: '2026-10-26T06:15:00.000Z', problem: 'refused' });
      expect((await q<{ key: string }>("select key from job_runs where key like 'daftra:%' order by key")).map((r) => r.key)).toEqual([
        'daftra:problem:MAZJ:refused', 'daftra:problem:VADO:unreachable', 'daftra:read:MAZJ',
      ]);
    });
  });
});
