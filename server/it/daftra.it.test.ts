import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { fakeDaftra, daftraDeps, type FakeDaftra } from '../daftra/fakeDaftra';
import { readStates } from '../daftra/store';
import { daftra as daftraStep } from '../jobs/steps/daftra';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * The Daftra link on the local database, as madar_server (the Daftra link, owner 2026-10-26; one Daftra account for each sub-company): the
 * migration 20261026000100_daftra.sql, the Postgres text of every statement of server/daftra/store.ts (the two tables keyed by account, the array
 * parameter of takenInvoiceIds, the job_runs state), the calls and the preflight of the link, and the job step with its internal paid write under
 * the real office lock. Daftra is a stand-in (fakeDaftra), so nothing leaves the Mac. It needs the local stack and the Docker lock; the merge lead
 * runs it (the builder has no Docker, so this file was written but not run by the builder).
 *
 * The sample office has no sub-company, so the test makes MAZJ and Vado with subCompanies.save and gives prj_001 and prj_002 to them.
 * Noura Al-Shammari (usr_011) is Accounting and holds the switch Link Daftra invoices.
 */

type Live = ReturnType<ItOffice['isolate']>;

function okOf<T = Record<string, unknown>>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

describe('the Daftra link on the local database, as madar_server', () => {
  let office: ItOffice;
  let deps: Live;
  let mazj: FakeDaftra;
  let vado: FakeDaftra;
  let payment: { mazj: string; vado: string };

  const call = (as: string, name: string, input: unknown) => runCall(deps, { principal: { userId: as }, name, input, batch: newBatch() });

  beforeAll(async () => {
    office = await startOffice('daftra');
    mazj = fakeDaftra({
      account: 'MAZJ', clients: [{ id: '842', name: 'Gulf Crest Holding' }],
      invoices: [{ id: '1830', no: '1521945', clientId: '842', total: 320_000, date: '2026-09-30', created: '2026-09-30 09:00:00' }],
    });
    vado = fakeDaftra({
      account: 'VADO', clients: [{ id: '55', name: 'Dune Line Developments' }],
      invoices: [{ id: '1830', no: 'V-0001', clientId: '55', total: 120_000, date: '2026-09-30', created: '2026-09-30 09:00:00' }],
    });
    const isolate = office.isolate();
    const wired = daftraDeps(mazj, vado);
    deps = Object.assign(isolate, { config: { ...isolate.config, ...wired.config }, daftraFetch: wired.daftraFetch });
    const subs: Record<string, string> = {};
    for (const [name, nameAr] of [['MAZJ', 'مزج'], ['Vado', 'فادو']] as const) {
      subs[name] = okOf<{ id: string }>(await call('usr_001', 'subCompanies.save', { name, nameAr, logo: null })).id;
    }
    okOf(await call('usr_001', 'projects.update', { id: 'prj_001', patch: { subCompanyId: subs.MAZJ } }));
    okOf(await call('usr_001', 'projects.update', { id: 'prj_002', patch: { subCompanyId: subs.Vado } }));
    // One open payment of each project (the sample office has some; these two are new, so the test knows their amounts).
    const made = async (projectId: string, amount: number) =>
      okOf<{ payment: { id: string } }>(await call('usr_011', 'payments.create', { projectId, name: 'Daftra test fee', amount, dueDate: '2026-10-04' })).payment.id;
    payment = { mazj: await made('prj_001', 320_000), vado: await made('prj_002', 120_000) };
  }, 120_000);

  afterAll(async () => {
    await office?.close();
  });

  it('keeps the two tables private: madar_server reads and writes them, and the rights block of a private table is there', async () => {
    const [mark] = await office.sql<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'daftra_clients'::regclass");
    expect(mark.relrowsecurity).toBe(true);
    const [other] = await office.sql<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'daftra_invoices'::regclass");
    expect(other.relrowsecurity).toBe(true);
    const keys = await office.sql<{ table_name: string; column_name: string }>(
      "select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = current_schema() and tc.table_name in ('daftra_clients', 'daftra_invoices') order by tc.table_name, kcu.ordinal_position",
    );
    expect(keys.map((row) => `${row.table_name}.${row.column_name}`)).toEqual(['daftra_clients.account', 'daftra_clients.client_id', 'daftra_invoices.account', 'daftra_invoices.id']);
  });

  it('matches a client in the account of the payment, fills the cache, and suggests the invoice with the same total', async () => {
    expect(okOf(await call('usr_011', 'daftra.matchClient', { paymentId: payment.mazj, daftraClientId: '842' }))).toMatchObject({ matched: { name: 'Gulf Crest Holding' }, invoices: 1 });
    expect(okOf(await call('usr_011', 'daftra.matchClient', { paymentId: payment.vado, daftraClientId: '55' }))).toMatchObject({ invoices: 1 });
    // The invoice id 1830 is in both accounts: two rows, one for each account.
    expect(await office.sql('select account, id from daftra_invoices order by account')).toEqual([{ account: 'MAZJ', id: '1830' }, { account: 'VADO', id: '1830' }]);
    expect(okOf(await call('usr_011', 'daftra.paymentLink', { paymentId: payment.mazj }))).toMatchObject({ account: 'MAZJ', suggested: { id: '1830', no: '1521945', total: 320_000 } });
    expect(okOf(await call('usr_011', 'daftra.paymentLink', { paymentId: payment.vado }))).toMatchObject({ account: 'VADO', suggested: { id: '1830', no: 'V-0001', total: 120_000 } });
  });

  it('links an invoice after the preflight read, refuses a second payment of the same account for it, and lets the other account use the same id', async () => {
    const linked = okOf<{ payment: { daftra: Record<string, unknown> } }>(await call('usr_011', 'payments.linkInvoice', { id: payment.mazj, invoiceId: '1830' }));
    expect(linked.payment.daftra).toMatchObject({ account: 'MAZJ', invoiceId: '1830', invoiceNo: '1521945', total: 320_000, linkedBy: 'usr_011' });
    const second = okOf<{ payment: { id: string } }>(await call('usr_011', 'payments.create', { projectId: 'prj_001', name: 'Second fee', amount: 320_000, dueDate: '2026-10-04' })).payment.id;
    const refused = await call('usr_011', 'payments.linkInvoice', { id: second, invoiceId: '1830' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'daftra_invoice_taken' } } });
    okOf(await call('usr_011', 'payments.linkInvoice', { id: payment.vado, invoiceId: '1830' }));
    // The array parameter of takenInvoiceIds, in the account that holds the invoice only.
    expect(okOf(await call('usr_011', 'daftra.paymentLink', { paymentId: second }))).toMatchObject({ account: 'MAZJ', suggested: null });
  });

  it('runs the daftra step on Postgres: it sets Received through the internal call under the lock, fills the state of each account, and is safe to run twice', async () => {
    mazj.invoices[0].paymentStatus = 2;
    mazj.invoices[0].payments = [{ date: '2026-10-02 00:00:00', amount: 320_000 }];
    const first = await daftraStep(deps, new Date('2026-10-04T06:00:00Z'));
    expect(first).toMatchObject({ accounts: 2, paid: 1, problems: [] });
    const [row] = await office.sql<{ doc: { receivedOn: string | null } }>('select doc from payments where id = $1', [payment.mazj]);
    expect(row.doc.receivedOn).toBe('2026-10-02');
    const events = await office.sql<{ doc: { verb: string; actorId: string } }>("select doc from events where doc->>'verb' = 'payment.received_daftra'");
    expect(events.map((event) => event.doc.actorId)).toEqual(['usr_011']);
    const [vadoRow] = await office.sql<{ doc: { receivedOn: string | null } }>('select doc from payments where id = $1', [payment.vado]);
    expect(vadoRow.doc.receivedOn).toBeNull();
    const states = await deps.db.tx('read', (q) => readStates(q));
    expect(states.MAZJ).toEqual({ lastReadAt: '2026-10-04T06:00:00.000Z', problem: null });
    expect(states.VADO).toEqual({ lastReadAt: '2026-10-04T06:00:00.000Z', problem: null });
    const second = await daftraStep(deps, new Date('2026-10-04T06:15:00Z'));
    expect(second).toMatchObject({ paid: 0 });
    expect(await office.sql("select count(*)::int as n from events where doc->>'verb' = 'payment.received_daftra'")).toEqual([{ n: 1 }]);
  });

  it('records the problem of one account, keeps the time of its last good read, and reads the other account', async () => {
    mazj.invoices.push({ id: '1900', no: '1521999', clientId: '842', total: 5, date: '2026-10-03', created: '2026-10-03 09:00:00' });
    const third = okOf<{ payment: { id: string } }>(await call('usr_011', 'payments.create', { projectId: 'prj_001', name: 'Third fee', amount: 5, dueDate: '2026-10-04' })).payment.id;
    okOf(await call('usr_011', 'payments.linkInvoice', { id: third, invoiceId: '1900' }));
    mazj.mode = 401;
    const report = await daftraStep(deps, new Date('2026-10-04T06:30:00Z'));
    mazj.mode = 'ok';
    expect(report).toMatchObject({ accounts: 2, problems: [{ account: 'MAZJ', problem: 'bad_key' }] });
    const states = await deps.db.tx('read', (q) => readStates(q));
    expect(states.MAZJ).toEqual({ lastReadAt: '2026-10-04T06:00:00.000Z', problem: 'bad_key' });
    expect(states.VADO?.problem).toBeNull();
    const after = await daftraStep(deps, new Date('2026-10-04T06:45:00Z'));
    expect(after).toMatchObject({ problems: [] });
    expect((await deps.db.tx('read', (q) => readStates(q))).MAZJ).toEqual({ lastReadAt: '2026-10-04T06:45:00.000Z', problem: null });
  });

  it('answers daftra.status for the accounts, with no key and no site', async () => {
    const status = okOf<{ ready: boolean; accounts: { name: string }[] }>(await call('usr_011', 'daftra.status', {}));
    expect(status.ready).toBe(true);
    expect(status.accounts.map((account) => account.name)).toEqual(['MAZJ', 'VADO']);
    const text = JSON.stringify(status);
    for (const secret of [mazj.apiKey, mazj.site, vado.apiKey, vado.site]) expect(text).not.toContain(secret);
  });
});
