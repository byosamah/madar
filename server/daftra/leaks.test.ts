import { describe, expect, it } from 'vitest';
import { fakeDaftra } from './fakeDaftra';
import { daftraOffice, okOf } from './testOffice';

/**
 * Leak tests of the Daftra link (owner 2026-10-26). A payment that is linked to a Daftra invoice has the field `daftra` and two events. Only a
 * person who holds payment.view reads them. Every other person (a project leader, a member, an outsider) probes every read path that could carry
 * the field, an event, a search hit or a signal, and finds no sign of the link: no field, no invoice number, no invoice id, no account name.
 * The marks below are unique, so a hit cannot be an accident.
 */

const INVOICE_ID = '9183041';
const INVOICE_NO = 'INV-LEAK-77';
const ACCOUNT = 'MAZJ';

async function linkedWorld() {
  const mazj = fakeDaftra({
    account: ACCOUNT,
    clients: [{ id: '842', name: 'Gulf Crest Holding' }],
    invoices: [{ id: INVOICE_ID, no: INVOICE_NO, clientId: '842', total: 320_000, date: '2026-10-10', created: '2026-10-10 09:00:00' }],
  });
  const t = await daftraOffice({ fakes: [mazj] });
  okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
  okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: INVOICE_ID }));
  mazj.invoices[0].paymentStatus = 2;
  mazj.invoices[0].payments = [{ date: '2026-10-22 00:00:00', amount: 320_000 }];
  await t.step();
  expect((await t.payment('pay_003'))?.receivedOn).toBe('2026-10-22');
  return { t, mazj };
}

const MARKS = [/daftra/i, new RegExp(INVOICE_ID), new RegExp(INVOICE_NO), /invoiceNo/, /invoiceId/];

describe('a person without "See payments" never reads the link', () => {
  const OUTSIDERS = [
    ['usr_002', 'the leader of the project (prj_001)'],
    ['usr_003', 'a member'],
    ['usr_004', 'a member'],
    ['usr_005', 'a member'],
  ] as const;

  it('finds no trace on any read path: payments, projects, events, search, the Dashboard, the notices and the session', async () => {
    const { t } = await linkedWorld();
    const answers: Record<string, unknown> = {};
    for (const [who] of OUTSIDERS) {
      const reads: [string, unknown][] = [
        ['payments.list', { projectId: 'prj_001' }],
        ['projects.get', { id: 'prj_001' }],
        ['projects.list', { status: 'all' }],
        ['events.list', { projectId: 'prj_001', limit: 500 }],
        ['events.list', { since: '2026-10-01T00:00:00+03:00', limit: 500 }],
        ['events.list', { targetType: 'payment', targetId: 'pay_003', limit: 500 }],
        ['events.list', { targetId: 'pay_003', limit: 500 }],
        ['search.query', { text: INVOICE_NO }], ['search.query', { text: INVOICE_ID }], ['search.query', { text: 'daftra' }], ['search.query', { text: 'invoice' }],
        ['dashboard.get', {}], ['dashboard.get', { status: 'all' }],
        ['updates.list', { projectId: 'prj_001', filter: 'all', limit: 50 }],
        ['notifications.list', {}], ['reports.office', { period: 'quarter' }], ['session.get', {}],
      ];
      for (const [name, input] of reads) {
        const result = await t.call(who, name, input);
        answers[`${who} ${name} ${JSON.stringify(input)}`] = result.ok ? result.output : result.error;
      }
    }
    for (const [key, answer] of Object.entries(answers)) {
      const text = JSON.stringify(answer);
      for (const mark of MARKS) expect(text, `${key}: ${mark}`).not.toMatch(mark);
    }
    // The probes did reach real data: the leader sees the project, and payments.list refuses a person without the right.
    expect(answers['usr_002 projects.get {"id":"prj_001"}']).toMatchObject({ project: expect.anything() });
    expect(answers['usr_003 payments.list {"projectId":"prj_001"}']).toMatchObject({ code: 'forbidden' });
  });

  it('refuses every Daftra call and the link calls with no Daftra word in the error', async () => {
    const { t } = await linkedWorld();
    for (const [who] of OUTSIDERS) {
      for (const [name, input] of [
        ['daftra.status', {}], ['daftra.paymentLink', { paymentId: 'pay_003' }], ['daftra.findClients', { paymentId: 'pay_003', query: 'gulf' }],
        ['daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }], ['payments.linkInvoice', { id: 'pay_003', invoiceId: INVOICE_ID }],
        ['payments.unlinkInvoice', { id: 'pay_003' }],
      ] as const) {
        const result = await t.call(who, name, input);
        expect(result.ok, `${who} ${name}`).toBe(false);
        if (!result.ok) {
          expect(result.error.code, `${who} ${name}`).toBe('forbidden');
          const text = JSON.stringify(result.error);
          expect(text, `${who} ${name}`).not.toMatch(/daftra|invoice|MAZJ|9183041/i);
        }
      }
    }
    // The link is still there after all the refusals.
    expect((await t.payment('pay_003'))?.daftra).toMatchObject({ account: ACCOUNT, invoiceId: INVOICE_ID });
  });

  it('cannot undo the link or the Daftra received event, and the undo error names no invoice', async () => {
    const { t } = await linkedWorld();
    const events = (await t.db.statement('read', "select doc from events where json_extract(doc, '$.targetId') = 'pay_003'")) as { doc: { id: string; verb: string } }[];
    expect(events.map((e) => e.doc.verb).sort()).toEqual(['payment.daftra_linked', 'payment.received_daftra']);
    for (const [who] of OUTSIDERS) {
      for (const event of events) {
        const result = await t.call(who, 'events.undo', { eventId: event.doc.id });
        // The same refusal as for any payment event: forbidden, with no word about Daftra or an invoice.
        expect(result, `${who} ${event.doc.verb}`).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(JSON.stringify(result), `${who} ${event.doc.verb}`).not.toMatch(/daftra|invoice|9183041|INV-LEAK/i);
      }
    }
    expect((await t.payment('pay_003'))?.daftra).toBeDefined();
  });

  it('gets no Realtime signal that names Daftra, an invoice or an account', async () => {
    const { t } = await linkedWorld();
    expect(t.deps.signal.sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(t.deps.signal.sent)).not.toMatch(/daftra|invoice|MAZJ|9183041/i);
  });
});

describe('a person with "See payments" reads the link and nothing more', () => {
  it('shows the Accounting person, Management and the agent of the Admin the field of a linked payment, with no key and no site', async () => {
    const { t, mazj } = await linkedWorld();
    for (const [who, principal] of [['usr_011', undefined], ['usr_010', undefined], ['usr_009', { userId: 'usr_009', agent: { clientId: 'client-1' } }]] as const) {
      const result = principal ? await t.callAs(principal, 'payments.list', { projectId: 'prj_001' }) : await t.call(who, 'payments.list', { projectId: 'prj_001' });
      const rows = okOf(result) as unknown as { payment: { id: string; daftra?: Record<string, unknown> } }[];
      const row = rows.find((r) => r.payment.id === 'pay_003')!;
      expect(row.payment.daftra, who).toMatchObject({ account: ACCOUNT, invoiceId: INVOICE_ID, invoiceNo: INVOICE_NO, total: 320_000 });
      const text = JSON.stringify(result);
      for (const secret of [mazj.apiKey, mazj.site]) expect(text, who).not.toContain(secret);
    }
  });

  it('never has the key or the site in any answer of any call of the step, the calls or the events', async () => {
    const { t, mazj } = await linkedWorld();
    const events = JSON.stringify(await t.db.statement('read', 'select doc from events'));
    const payments = JSON.stringify(await t.db.statement('read', 'select doc from payments'));
    const everything = `${events} ${payments} ${t.logText()} ${JSON.stringify(t.deps.signal.sent)}`;
    for (const secret of [mazj.apiKey, mazj.site]) expect(everything).not.toContain(secret);
  });
});
