import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { fakeDaftra } from '../daftra/fakeDaftra';
import { addSubCompanies } from '../daftra/testOffice';
import { outsideOffice } from './test/outsideOffice';

/**
 * The Daftra link in the office object (plan A of Madar enterprises). The object sends the address only through the network port. The
 * Worker side (`daftraRequest`) adds the key of the account and sends the GET to the fake Daftra. pay_003 (320,000) is of prj_001, the
 * sub-company MAZJ. The run is at 2026-10-26, 09:00 Riyadh.
 */

const AT = '2026-10-26T06:00:00Z';
const link = (account: string, invoiceId: string) => ({
  account, invoiceId, invoiceNo: `N${invoiceId}`, total: 5, issuedOn: '2026-10-20', linkedBy: 'usr_011', linkedAt: '2026-10-20T10:00:00.000+03:00',
});
const world = () => {
  const mazj = fakeDaftra({
    account: 'MAZJ',
    clients: [{ id: '842', name: 'Gulf Crest Holding' }],
    invoices: [{ id: '1830', no: 'N1830', clientId: '842', total: 5, date: '2026-10-20', created: '2026-10-20 09:00:00', paymentStatus: 2, payments: [{ date: '2026-10-22 00:00:00', amount: 5 }] }],
  });
  const vado = fakeDaftra({ account: 'VADO', clients: [{ id: '55', name: 'Dune Line Developments' }], invoices: [] });
  return { mazj, vado };
};
const linked = (seed: State) => {
  addSubCompanies(seed);
  seed.payments!.pay_003.daftra = link('MAZJ', '1830');
};
const okOf = (results: { ok: boolean; output?: unknown; error?: unknown }[]): Record<string, unknown> => {
  if (!results[0].ok) throw new Error(`The call failed: ${JSON.stringify(results[0].error)}`);
  return results[0].output as Record<string, unknown>;
};

describe('the Daftra step in the office object', () => {
  it('reads the paid invoice through the port on the Cron run, and sets Received', async () => {
    const { mazj, vado } = world();
    const t = await outsideOffice({ at: AT, daftra: [mazj, vado], edit: linked });
    const report = await t.cron(new Date(AT));
    const step = report.steps.find((one) => one.name === 'daftra');
    expect(step).toMatchObject({ ok: true, result: { accounts: 2, calls: 1, paid: 1, problems: [] } });
    expect((await t.rows("select json_extract(doc, '$.receivedOn') as day from payments where id = 'pay_003'"))[0].day).toBe('2026-10-22');
    expect(t.net.calls).toContain('daftra GET https://mazj.daftra.com/api2/invoices/1830.json');
    // The Worker added the key of the account. The object never held it.
    expect(mazj.requests[0].apikey).toBe(mazj.apiKey);
    expect(JSON.stringify([t.net.calls, t.lines])).not.toContain(mazj.apiKey);
    expect(t.openAtCall.length).toBeGreaterThan(0);
    expect(t.openAtCall.every((open) => open === false)).toBe(true);
  });

  it('skips on a copy with no Daftra account, with no request', async () => {
    const t = await outsideOffice({ at: AT });
    const report = await t.cron(new Date(AT));
    expect(report.steps.find((one) => one.name === 'daftra')).toMatchObject({ ok: true, result: { skipped: 'no_config' } });
    expect(t.net.calls).toEqual([]);
  });

  it('reads one live page of clients through the port on daftra.findClients', async () => {
    const { mazj, vado } = world();
    const t = await outsideOffice({ at: AT, daftra: [mazj, vado], edit: linked });
    const found = okOf((await t.batch('usr_011', [{ name: 'daftra.findClients', input: { paymentId: 'pay_003', query: 'gulf' } }])).results);
    expect(mazj.paths()).toEqual(['clients.json?keywords=gulf&limit=10']);
    expect(JSON.stringify(found)).toContain('Gulf Crest Holding');
  });

  it('reads the invoice before the lock on payments.linkInvoice, and links it', async () => {
    const { mazj, vado } = world();
    const t = await outsideOffice({
      at: AT, daftra: [mazj, vado],
      edit: (seed) => {
        addSubCompanies(seed);
      },
    });
    okOf((await t.batch('usr_011', [{ name: 'daftra.matchClient', input: { paymentId: 'pay_003', daftraClientId: '842' } }])).results);
    okOf((await t.batch('usr_011', [{ name: 'payments.linkInvoice', input: { id: 'pay_003', invoiceId: '1830' } }])).results);
    expect(t.openAtCall.length).toBeGreaterThan(0);
    expect(t.openAtCall.every((open) => open === false)).toBe(true);
    expect((await t.rows("select json_extract(doc, '$.daftra.invoiceId') as id from payments where id = 'pay_003'"))[0].id).toBe('1830');
  });
});
