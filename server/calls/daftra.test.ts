import { describe, expect, it } from 'vitest';
import { fakeDaftra, type FakeDaftra } from '../daftra/fakeDaftra';
import { daftraOffice, okOf, type DaftraOffice } from '../daftra/testOffice';

/**
 * The four Daftra calls and payments.linkInvoice (the Daftra link, owner 2026-10-26; one Daftra account for each sub-company) on the sample
 * office on node:sqlite, with a fake Daftra for each account behind the Daftra fetch. No test reaches Daftra.
 *
 * Payments: pay_003 (320,000) is of prj_001, client cli_001, sub-company MAZJ. pay_006 (120,000) is of prj_002, client cli_002, Vado.
 * pay_009 is of prj_003, which has no sub-company. pay_011 is of prj_006, whose sub-company (Studio X) has no Daftra account.
 * People: usr_011 Accounting and usr_001 Admin hold the switch. usr_010 Management and usr_003 Member do not. usr_009 is an agent of usr_001.
 */

const AGENT = { userId: 'usr_009', agent: { clientId: 'client-1' } };

function fakes() {
  const mazj = fakeDaftra({
    account: 'MAZJ',
    clients: [{ id: '842', name: 'Gulf Crest Holding', number: '12' }, { id: '900', name: 'Gulf Other Co' }],
    invoices: [
      { id: '1830', no: '1521945', clientId: '842', total: 320_000, date: '2026-10-10', created: '2026-10-10 09:00:00' },
      { id: '1831', no: '1521946', clientId: '842', total: 320_000, date: '2026-10-12', created: '2026-10-12 09:00:00', draft: true },
      { id: '1832', no: '1521947', clientId: '842', total: 100, date: '2026-10-13', created: '2026-10-13 09:00:00' },
      { id: '1900', no: '1521999', clientId: '900', total: 320_000, date: '2026-10-13', created: '2026-10-13 09:00:00' },
    ],
  });
  // The same invoice id as one of MAZJ: ids repeat across accounts.
  const vado = fakeDaftra({
    account: 'VADO',
    clients: [{ id: '55', name: 'Dune Line Developments' }],
    invoices: [{ id: '1830', no: 'V-0001', clientId: '55', total: 120_000, date: '2026-10-20', created: '2026-10-20 09:00:00' }],
  });
  return { mazj, vado };
}

async function world(o: { edit?: Parameters<typeof daftraOffice>[0] extends infer P ? (P extends { edit?: infer E } ? E : never) : never } = {}) {
  const { mazj, vado } = fakes();
  const t = await daftraOffice({ fakes: [mazj, vado], ...(o.edit ? { edit: o.edit } : {}) });
  return { t, mazj, vado };
}

const failure = (result: Awaited<ReturnType<DaftraOffice['call']>>) => {
  if (result.ok) throw new Error('The call did not fail.');
  return result.error;
};

describe('the rights of the Daftra calls', () => {
  const CALLS: [string, unknown][] = [
    ['daftra.status', {}],
    ['daftra.paymentLink', { paymentId: 'pay_003' }],
    ['daftra.findClients', { paymentId: 'pay_003', query: 'gulf' }],
    ['daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }],
    ['payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }],
  ];

  it('refuses a Member, Management and every agent, and an Admin and Accounting may call', async () => {
    const { t, mazj, vado } = await world();
    for (const [name, input] of CALLS) {
      expect(failure(await t.call('usr_003', name, input)), `member ${name}`).toMatchObject({ code: 'forbidden' });
      expect(failure(await t.call('usr_010', name, input)), `management ${name}`).toMatchObject({ code: 'forbidden' });
      expect(failure(await t.callAs(AGENT, name, input)), `agent ${name}`).toMatchObject({ code: 'forbidden' });
    }
    // Nothing reached Daftra for the refused ones.
    expect(mazj.requests).toEqual([]);
    expect(vado.requests).toEqual([]);
    expect(okOf(await t.call('usr_011', 'daftra.status', {}))).toMatchObject({ ready: true });
    expect(okOf(await t.call('usr_001', 'daftra.status', {}))).toMatchObject({ ready: true });
  });

  it('refuses before it says anything about Daftra: a person without payment.view gets an error with no Daftra word, also on a copy with no Daftra', async () => {
    const { t } = await world();
    const bare = await daftraOffice();
    for (const office of [t, bare]) {
      for (const [name, input] of CALLS) {
        const error = failure(await office.call('usr_003', name, input));
        expect(error, name).toMatchObject({ code: 'forbidden', details: { action: 'payment.view' } });
        expect(JSON.stringify(error), name).not.toMatch(/daftra|invoice|MAZJ|VADO/i);
        // A person with payment.view but no switch learns only the name of the switch, never an account, an invoice or the state of the copy.
        const management = failure(await office.call('usr_010', name, input));
        expect(management, name).toMatchObject({ code: 'forbidden', message: 'You cannot do this.', details: { action: 'payment.daftraLink' } });
      }
    }
  });

  it('answers not_found for a payment of a hidden project, as for a payment that is not there, with no Daftra word', async () => {
    const { t, mazj } = await world({ edit: (seed) => { seed.projects.prj_001.access = { hidden: true, viewerIds: [] }; } });
    for (const [name, input] of CALLS.slice(1)) {
      const error = failure(await t.call('usr_011', name, input));
      expect(error, name).toMatchObject({ code: 'not_found' });
      expect(JSON.stringify(error), name).not.toMatch(/daftra|invoice|MAZJ/i);
    }
    expect(failure(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_404' }))).toMatchObject({ code: 'not_found' });
    // The Admin holds the right to see hidden projects.
    expect(okOf(await t.call('usr_001', 'daftra.paymentLink', { paymentId: 'pay_003' }))).toMatchObject({ account: 'MAZJ' });
    expect(mazj.requests).toEqual([]);
  });
});

describe('a copy with no Daftra account', () => {
  it('says ready false in daftra.status, and refuses the other calls with daftra_not_ready, with no request', async () => {
    const t = await daftraOffice();
    expect(okOf(await t.call('usr_011', 'daftra.status', {}))).toEqual({ ready: false, accounts: [] });
    for (const [name, input] of [
      ['daftra.paymentLink', { paymentId: 'pay_003' }], ['daftra.findClients', { paymentId: 'pay_003', query: 'gulf' }],
      ['daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }], ['payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }],
    ] as const) {
      expect(failure(await t.call('usr_011', name, input)), name).toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_not_ready' } });
    }
  });
});

describe('daftra.status', () => {
  it('lists every account of the copy by name, sorted, with no state before the first read', async () => {
    const { t } = await world();
    expect(okOf(await t.call('usr_011', 'daftra.status', {}))).toEqual({
      ready: true,
      accounts: [{ name: 'MAZJ', lastReadAt: null, problem: null }, { name: 'VADO', lastReadAt: null, problem: null }],
    });
  });

  it('gives the answer keys and nothing else: no key, no site', async () => {
    const { t, mazj, vado } = await world();
    const text = JSON.stringify(okOf(await t.call('usr_011', 'daftra.status', {})));
    for (const secret of [mazj.apiKey, mazj.site, vado.apiKey, vado.site]) expect(text).not.toContain(secret);
  });
});

describe('daftra.paymentLink', () => {
  it('says which account a payment is read from, from the sub-company of its project, and reads the cache only', async () => {
    const { t, mazj, vado } = await world();
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }))).toEqual({
      account: 'MAZJ', noAccount: null, projectHasNoClient: false, matched: null, suggested: null, others: [],
    });
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_006' }))).toMatchObject({ account: 'VADO', matched: null });
    expect(mazj.requests).toEqual([]);
    expect(vado.requests).toEqual([]);
  });

  it('says why a project has no account: no sub-company, or a sub-company with no Daftra account', async () => {
    const { t } = await world();
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_009' }))).toEqual({
      account: null, noAccount: 'no_sub_company', projectHasNoClient: false, matched: null, suggested: null, others: [],
    });
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_011' }))).toMatchObject({ account: null, noAccount: 'no_daftra_account' });
  });

  it('says projectHasNoClient for an internal project', async () => {
    const { t } = await world({
      edit: (seed) => {
        seed.projects.prj_008.kind = 'internal';
        seed.payments!.pay_090 = {
          id: 'pay_090', projectId: 'prj_008', name: 'Odd', amount: 5, dueDate: '2026-10-26', receivedOn: null, note: '', createdBy: 'usr_011',
          createdAt: '2026-10-01T09:00:00.000+03:00',
        };
      },
    });
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_090' }))).toMatchObject({ projectHasNoClient: true, matched: null, suggested: null });
  });

  it('suggests the one invoice of the matched client with the same total, and lists the other recent ones (no draft)', async () => {
    const { t } = await world();
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    const link = okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }));
    expect(link).toEqual({
      account: 'MAZJ', noAccount: null, projectHasNoClient: false, matched: { name: 'Gulf Crest Holding' },
      suggested: { id: '1830', no: '1521945', total: 320_000, issuedOn: '2026-10-10' },
      others: [{ id: '1832', no: '1521947', total: 100, issuedOn: '2026-10-13' }],
    });
  });

  it('suggests nothing for a payment whose amount no invoice has, and lists the invoices of the client as others', async () => {
    const { t } = await world();
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    // The payment of 320,000 changes to 321,000: the invoice of 320,000 no longer matches.
    okOf(await t.call('usr_011', 'payments.update', { id: 'pay_003', patch: { amount: 321_000 } }));
    const link = okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }));
    expect(link.suggested).toBeNull();
    expect((link.others as { id: string }[]).map((invoice) => invoice.id)).toEqual(['1832', '1830']);
  });

  // Owner, 2026-10-26 ("fix it"): an accountant who just made the invoice in Daftra expects Madar to see it at once, not in 15 minutes.
  it('looks in Daftra at once when no invoice matches and its copy is older than a minute: the new invoice is the suggestion', async () => {
    const { t, mazj } = await world();
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    okOf(await t.call('usr_011', 'payments.update', { id: 'pay_003', patch: { amount: 34.5 } }));
    // The accountant makes the invoice in Daftra two minutes later.
    mazj.invoices.push({ id: '1961', no: '1521961', clientId: '842', total: 34.5, date: '2026-10-26', created: '2026-10-26 09:55:00' });
    t.deps.clock.set(new Date(t.deps.clock.now().getTime() + 2 * 60_000));
    mazj.requests.length = 0;
    const link = okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }));
    expect(link.suggested).toEqual({ id: '1961', no: '1521961', total: 34.5, issuedOn: '2026-10-26' });
    expect(mazj.paths()).toHaveLength(1);
    expect(mazj.paths()[0]).toMatch(/^invoices\.json\?client_id=842&created_from=/);
  });

  it('asks Daftra at most once a minute for one client, and never when an invoice already matches', async () => {
    const { t, mazj } = await world();
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    mazj.requests.length = 0;
    // A suggestion stands: no look.
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' })).suggested).not.toBeNull();
    // No suggestion, but the match read the client a moment ago: no look.
    okOf(await t.call('usr_011', 'payments.update', { id: 'pay_003', patch: { amount: 34.5 } }));
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' })).suggested).toBeNull();
    expect(mazj.requests).toEqual([]);
  });

  it('gives the copy it holds when the fresh look fails, with no error, and logs only the code', async () => {
    const { t, mazj } = await world();
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    okOf(await t.call('usr_011', 'payments.update', { id: 'pay_003', patch: { amount: 34.5 } }));
    t.deps.clock.set(new Date(t.deps.clock.now().getTime() + 2 * 60_000));
    mazj.mode = 503;
    const link = okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }));
    expect(link.suggested).toBeNull();
    expect((link.others as { id: string }[]).map((invoice) => invoice.id)).toEqual(['1832', '1830']);
  });

  it('keeps the match and the cache of one account apart from another account', async () => {
    const { t } = await world({ edit: (seed) => { seed.projects.prj_009.subCompanyId = seed.projects.prj_002.subCompanyId; } });
    // prj_009 has the client cli_001 like prj_001, but its sub-company is Vado: it has its own match in the Vado account.
    okOf(await t.call('usr_011', 'payments.create', { projectId: 'prj_009', name: 'Fee', amount: 120_000, dueDate: '2026-10-26' }));
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    const second = 'pay_012';
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: second }))).toMatchObject({ account: 'VADO', matched: null, suggested: null });
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: second, daftraClientId: '55' }));
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: second }))).toMatchObject({
      account: 'VADO', matched: { name: 'Dune Line Developments' }, suggested: { id: '1830', no: 'V-0001' },
    });
    // The MAZJ payment still reads its own match and its own invoice 1830.
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }))).toMatchObject({
      account: 'MAZJ', matched: { name: 'Gulf Crest Holding' }, suggested: { id: '1830', no: '1521945' },
    });
  });
});

describe('daftra.findClients', () => {
  it('sends one GET to the account of the payment and none to another account, and gives at most 10 clients', async () => {
    const { t, mazj, vado } = await world();
    expect(okOf(await t.call('usr_011', 'daftra.findClients', { paymentId: 'pay_003', query: 'gulf' }))).toEqual({
      clients: [{ id: '842', name: 'Gulf Crest Holding', number: '12' }, { id: '900', name: 'Gulf Other Co', number: '900' }],
    });
    expect(mazj.paths()).toEqual(['clients.json?keywords=gulf&limit=10']);
    expect(vado.requests).toEqual([]);
    okOf(await t.call('usr_011', 'daftra.findClients', { paymentId: 'pay_006', query: 'dune' }));
    expect(vado.paths()).toEqual(['clients.json?keywords=dune&limit=10']);
    expect(mazj.requests).toHaveLength(1);
  });

  it('never takes an account from the browser: an account in the input changes nothing', async () => {
    const { t, mazj, vado } = await world();
    await t.call('usr_011', 'daftra.findClients', { paymentId: 'pay_003', query: 'gulf', account: 'VADO' });
    expect(mazj.requests).toHaveLength(1);
    expect(vado.requests).toHaveLength(0);
  });

  it('refuses a payment whose project has no account, with no request', async () => {
    const { t, mazj, vado } = await world();
    for (const id of ['pay_009', 'pay_011']) {
      expect(failure(await t.call('usr_011', 'daftra.findClients', { paymentId: id, query: 'x' })), id).toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_not_ready' } });
    }
    expect(mazj.requests.length + vado.requests.length).toBe(0);
  });

  it('answers a bad key, a refused key role and an unreachable Daftra with a sentence and a reason, and no text of Daftra', async () => {
    const { t, mazj } = await world();
    const cases: [FakeDaftra['mode'], string][] = [[401, 'daftra_bad_key'], [403, 'daftra_refused'], [500, 'daftra_unreachable'], ['network', 'daftra_unreachable'], ['junk', 'daftra_unreachable']];
    for (const [mode, reason] of cases) {
      mazj.mode = mode;
      const error = failure(await t.call('usr_011', 'daftra.findClients', { paymentId: 'pay_003', query: 'gulf' }));
      expect(error, String(mode)).toMatchObject({ code: 'failed', details: { reason } });
      expect(JSON.stringify(error)).not.toContain(mazj.apiKey);
      expect(JSON.stringify(error)).not.toContain(mazj.site);
    }
  });
});

describe('daftra.matchClient', () => {
  it('reads the Daftra client, keeps the match for the account of the payment, and fills the cache at once', async () => {
    const { t, mazj, vado } = await world();
    const out = okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    expect(out).toEqual({ matched: { name: 'Gulf Crest Holding' }, invoices: 3 });
    expect(mazj.paths()[0]).toBe('clients/842.json');
    expect(mazj.paths()[1]).toMatch(/^invoices\.json\?client_id=842&created_from=2026-04-2\d&limit=50$/);
    expect(vado.requests).toEqual([]);
    const rows = (await t.db.statement('read', 'select account, client_id, daftra_id, daftra_name, matched_by from daftra_clients')) as Record<string, unknown>[];
    expect(rows).toEqual([{ account: 'MAZJ', client_id: 'cli_001', daftra_id: '842', daftra_name: 'Gulf Crest Holding', matched_by: 'usr_011' }]);
    const cached = (await t.db.statement('read', 'select account, id from daftra_invoices order by id')) as { account: string; id: string }[];
    expect(cached.map((row) => `${row.account}/${row.id}`)).toEqual(['MAZJ/1830', 'MAZJ/1831', 'MAZJ/1832']);
  });

  it('is a write that changes no office record: no event, no signal', async () => {
    const { t } = await world();
    const eventsBefore = ((await t.db.statement('read', 'select count(*) as n from events')) as { n: number }[])[0].n;
    t.deps.signal.sent.length = 0;
    const result = await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(((await t.db.statement('read', 'select count(*) as n from events')) as { n: number }[])[0].n).toBe(eventsBefore);
    expect(t.deps.signal.sent).toEqual([]);
  });

  it('replaces the first match of the client in the account with the second', async () => {
    const { t } = await world();
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    okOf(await t.call('usr_001', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '900' }));
    const rows = (await t.db.statement('read', 'select daftra_id, matched_by from daftra_clients')) as Record<string, unknown>[];
    expect(rows).toEqual([{ daftra_id: '900', matched_by: 'usr_001' }]);
  });

  it('refuses a Daftra client that is not there, with daftra_client_not_found, and keeps no match', async () => {
    const { t } = await world();
    expect(failure(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '777' }))).toMatchObject({
      code: 'invalid_input', details: { reason: 'daftra_client_not_found' },
    });
    expect(await t.db.statement('read', 'select * from daftra_clients')).toEqual([]);
  });

  it('keeps the match when only the cache fill fails (a bad Daftra answer after the client)', async () => {
    const { t, mazj } = await world();
    let calls = 0;
    const real = mazj.fetch;
    (t.deps as unknown as { daftraFetch: typeof fetch }).daftraFetch = async (input, init) => {
      calls += 1;
      return calls === 1 ? real(input, init) : new Response('{}', { status: 500 });
    };
    expect(okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }))).toEqual({ matched: { name: 'Gulf Crest Holding' }, invoices: 0 });
    expect((await t.db.statement('read', 'select * from daftra_clients')) as unknown[]).toHaveLength(1);
  });

  it('refuses a payment whose project has no client or no account', async () => {
    const { t } = await world();
    for (const id of ['pay_009', 'pay_011']) {
      expect(failure(await t.call('usr_011', 'daftra.matchClient', { paymentId: id, daftraClientId: '842' })), id).toMatchObject({ details: { reason: 'daftra_not_ready' } });
    }
  });
});

describe('payments.linkInvoice (the preflight reads the invoice from the account of the project)', () => {
  async function matched() {
    const w = await world();
    okOf(await w.t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    w.mazj.requests.length = 0;
    return w;
  }

  it('reads the invoice from Daftra, and sets Payment.daftra from that read with the account of the project', async () => {
    const { t, mazj, vado } = await matched();
    const out = okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }));
    expect((out.payment as { daftra: unknown }).daftra).toEqual({
      account: 'MAZJ', invoiceId: '1830', invoiceNo: '1521945', total: 320_000, issuedOn: '2026-10-10', linkedBy: 'usr_011', linkedAt: '2026-10-26T09:00:00.000+03:00',
    });
    expect(out.status).toBe('overdue');
    expect(mazj.paths()).toEqual(['invoices/1830.json']);
    expect(vado.requests).toEqual([]);
    expect((await t.payment('pay_003'))?.daftra).toMatchObject({ account: 'MAZJ' });
  });

  it('never trusts the browser for the account or the numbers: the input account and total are ignored', async () => {
    const { t, vado } = await matched();
    const result = await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830', account: 'VADO', invoiceNo: 'x', total: 1 });
    expect((okOf(result).payment as { daftra: { account: string; invoiceNo: string; total: number } }).daftra).toMatchObject({ account: 'MAZJ', invoiceNo: '1521945', total: 320_000 });
    expect(vado.requests).toEqual([]);
  });

  it('refuses an invoice of another Daftra client (daftra_client_mismatch) and a draft (daftra_draft)', async () => {
    const { t } = await matched();
    expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1900' }))).toMatchObject({ details: { reason: 'daftra_client_mismatch' } });
    expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1831' }))).toMatchObject({ details: { reason: 'daftra_draft' } });
    expect((await t.payment('pay_003'))?.daftra).toBeUndefined();
  });

  it('refuses an invoice that Daftra does not have (daftra_invoice_not_found), and a client with no match (daftra_no_match)', async () => {
    const { t } = await matched();
    expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '4040' }))).toMatchObject({ details: { reason: 'daftra_invoice_not_found' } });
    expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_006', invoiceId: '1830' }))).toMatchObject({ details: { reason: 'daftra_no_match' } });
  });

  it('refuses a project with no sub-company or with no account (daftra_not_ready), with no request', async () => {
    const { t, mazj, vado } = await matched();
    mazj.requests.length = 0;
    for (const id of ['pay_009', 'pay_011']) {
      expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id, invoiceId: '1830' })), id).toMatchObject({ details: { reason: 'daftra_not_ready' } });
    }
    expect(mazj.requests.length + vado.requests.length).toBe(0);
  });

  it('refuses an invoice that another payment of the same account holds (daftra_invoice_taken), and lets the same id of another account in', async () => {
    const { t } = await matched();
    okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }));
    okOf(await t.call('usr_011', 'payments.create', { projectId: 'prj_001', name: 'Second', amount: 320_000, dueDate: '2026-11-10' }));
    expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_012', invoiceId: '1830' }))).toMatchObject({ details: { reason: 'daftra_invoice_taken' } });
    // Vado has an invoice with the same id 1830: it is another invoice.
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_006', daftraClientId: '55' }));
    const out = okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_006', invoiceId: '1830' }));
    expect((out.payment as { daftra: unknown }).daftra).toMatchObject({ account: 'VADO', invoiceId: '1830', invoiceNo: 'V-0001' });
  });

  it('writes the event payment.daftra_linked with the person, and its Undo takes the link away', async () => {
    const { t } = await matched();
    okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }));
    const events = (await t.db.statement('read', "select doc from events where json_extract(doc, '$.verb') = 'payment.daftra_linked'")) as { doc: Record<string, unknown> }[];
    expect(events).toHaveLength(1);
    expect(events[0].doc).toMatchObject({ targetId: 'pay_003', actorId: 'usr_011' });
    okOf(await t.call('usr_011', 'events.undo', { eventId: events[0].doc.id }));
    expect('daftra' in ((await t.payment('pay_003')) ?? {})).toBe(false);
  });

  it('unlinks with payments.unlinkInvoice, and the next link may use another invoice', async () => {
    const { t } = await matched();
    okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }));
    okOf(await t.call('usr_011', 'payments.unlinkInvoice', { id: 'pay_003' }));
    expect('daftra' in ((await t.payment('pay_003')) ?? {})).toBe(false);
    okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1832' }));
    expect((await t.payment('pay_003'))?.daftra).toMatchObject({ invoiceId: '1832' });
  });

  it('answers a bad key from Daftra with daftra_bad_key and changes nothing', async () => {
    const { t, mazj } = await matched();
    mazj.mode = 401;
    expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }))).toMatchObject({ code: 'failed', details: { reason: 'daftra_bad_key' } });
    expect((await t.payment('pay_003'))?.daftra).toBeUndefined();
  });

  it('refuses an invoice of the right id but in a payment of a hidden project with not_found', async () => {
    const { t } = await world({ edit: (seed) => { seed.projects.prj_001.access = { hidden: true, viewerIds: [] }; } });
    expect(failure(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }))).toMatchObject({ code: 'not_found' });
  });
});

describe('no answer, error, log line or signal holds a key or a site', () => {
  it('holds for every call, every answer, and every failure mode of Daftra', async () => {
    const { t, mazj, vado } = await world();
    const results: unknown[] = [];
    const calls: [string, unknown][] = [
      ['daftra.status', {}], ['daftra.paymentLink', { paymentId: 'pay_003' }], ['daftra.findClients', { paymentId: 'pay_003', query: 'gulf' }],
      ['daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }], ['daftra.paymentLink', { paymentId: 'pay_003' }],
      ['payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }], ['payments.list', { projectId: 'prj_001' }], ['payments.unlinkInvoice', { id: 'pay_003' }],
    ];
    for (const mode of ['ok', 401, 403, 500, 'network', 'junk'] as FakeDaftra['mode'][]) {
      mazj.mode = mode;
      vado.mode = mode;
      for (const [name, input] of calls) {
        results.push(await t.call('usr_011', name, input));
        results.push(await t.call('usr_001', name, input));
      }
    }
    const everything = `${JSON.stringify(results)} ${t.logText()} ${JSON.stringify(t.deps.signal.sent)}`;
    for (const secret of [mazj.apiKey, mazj.site, vado.apiKey, vado.site]) expect(everything).not.toContain(secret);
    // The log names the account and the code, so it helps: it is not silent.
    expect(t.logText()).toContain('"account":"MAZJ"');
  });

  it('holds for the signals of a link and an unlink: they name payments and events, never Daftra', async () => {
    const { t } = await world();
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    t.deps.signal.sent.length = 0;
    okOf(await t.call('usr_011', 'payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }));
    okOf(await t.call('usr_011', 'payments.unlinkInvoice', { id: 'pay_003' }));
    expect(t.deps.signal.sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(t.deps.signal.sent)).not.toMatch(/daftra|invoice|MAZJ/i);
  });
});
