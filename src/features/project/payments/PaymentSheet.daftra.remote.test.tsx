import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { calls, type CallName, type CallOutput } from '../../../api/calls';
import { invalid } from '../../../api/errors';
import type { State } from '../../../api/store';
import { addSampleSubCompanies } from '../../../data/sampleSubCompanies';
import { initI18n } from '../../../i18n';
import { renderRemoteApp } from '../../../test/renderRemote';

/**
 * The Daftra part of the payment sheet in the real build (runtime mode "remote"), states 0 to 6 of the spec "Screens" (owner, 2026-10-26).
 * The whole app runs over the sample office. A stand-in answers the four daftra calls, so no test reaches Daftra or any network.
 * The write payments.linkInvoice runs the prototype handler with a test snapshot in place of the server preflight.
 */
const PROJECT = '/projects/prj_001';
const NAME = 'Construction documents fee';
type Link = CallOutput<'daftra.paymentLink'>;
type Status = CallOutput<'daftra.status'>;

const READY: Status = { ready: true, accounts: [{ name: 'MAZJ', lastReadAt: '2026-10-26T09:00:00.000+03:00', problem: null }] };
const invoice = (id: string, no: string, total: number, issuedOn = '2026-09-29') => ({ id, no, total, issuedOn });
const BASE: Link = { account: 'MAZJ', noAccount: null, matched: { name: 'Gulf Crest Trading' }, projectHasNoClient: false, suggested: null, others: [] };

type Answers = {
  status: () => Status | Promise<Status>;
  link: (input: { paymentId: string }) => Link | Promise<Link>;
  find: (input: { paymentId: string; query: string }) => CallOutput<'daftra.findClients'> | Promise<CallOutput<'daftra.findClients'>>;
  match: (input: { paymentId: string; daftraClientId: string }) => CallOutput<'daftra.matchClient'> | Promise<CallOutput<'daftra.matchClient'>>;
};

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

async function open(o: { user?: string; answers?: Partial<Answers>; prepare?: (state: State) => void; payment?: string } = {}) {
  const answers: Answers = {
    status: () => READY, link: () => BASE, find: () => ({ clients: [] }), match: () => ({ matched: { name: 'Gulf Crest Trading' }, invoices: 0 }), ...o.answers,
  };
  const view = await renderRemoteApp(PROJECT, (state) => {
    state.session.currentUserId = o.user ?? 'usr_011';
    o.prepare?.(state);
  });
  const asked: Array<{ name: CallName; input: unknown }> = [];
  const through = view.api.call.bind(view.api) as (name: CallName, input: unknown, meta?: unknown) => Promise<unknown>;
  const handlers: Partial<Record<CallName, (input: never) => unknown>> = {
    'daftra.status': answers.status, 'daftra.paymentLink': answers.link, 'daftra.findClients': answers.find, 'daftra.matchClient': answers.match,
  };
  view.api.call = ((name: CallName, input: unknown, meta?: unknown) => {
    const handler = handlers[name];
    if (!name.startsWith('daftra.') || !handler) return through(name, input, meta);
    asked.push({ name, input });
    try { return Promise.resolve(handler(input as never)); } catch (error) { return Promise.reject(error); }
  }) as typeof view.api.call;
  const payment = Object.values(view.store.state.payments ?? {}).find((item) => item.name === (o.payment ?? NAME))!;
  const project = view.store.state.projects[payment.projectId];
  const client = view.store.state.clients[project.clientId ?? '']!;
  // A busy machine is slow to draw the whole app, so these waits are longer than the default second.
  const slow = { timeout: 8000 };
  await userEvent.click(await within(await screen.findByRole('region', { name: 'Payments' }, slow)).findByRole('button', { name: `Open payment ${payment.name}` }, slow));
  const sheet = await screen.findByRole('dialog', { name: 'Edit payment' }, slow);
  const askedOf = (name: CallName) => asked.filter((call) => call.name === name);
  return { ...view, sheet, asked, askedOf, payment, client };
}
const settle = () => act(() => new Promise<void>((resolve) => { window.setTimeout(resolve, 30); }));
const linkSnapshot = (account = 'MAZJ') => ({ account, invoiceId: '1830', invoiceNo: '1521945', total: 360000, issuedOn: '2026-09-29' });
/** The prepare step of the link call: the server preflight reads Daftra in the real build, and the prototype step refuses. A test stands in for it. */
const prepareOf = () => calls['payments.linkInvoice'] as unknown as { prepare: () => Promise<unknown> };
function standIn(snapshot = linkSnapshot()) {
  spies.push(vi.spyOn(prepareOf(), 'prepare').mockResolvedValue(snapshot));
}

describe('no Daftra part', () => {
  it('shows none while daftra.status says not ready, and never asks about the payment', async () => {
    const { sheet, askedOf } = await open({ answers: { status: () => ({ ready: false, accounts: [] }) } });
    await settle();
    expect(within(sheet).queryByText('Daftra')).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Mark as received' })).toBeInTheDocument();
    expect(askedOf('daftra.paymentLink')).toHaveLength(0);
  });

  it('shows none to a person without the Daftra switch, and never asks Daftra anything', async () => {
    const { sheet, asked } = await open({ user: 'usr_010', answers: { link: () => ({ ...BASE, suggested: invoice('1830', '1521945', 360000) }) } });
    await settle();
    expect(within(sheet).queryByText('Daftra')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Link this invoice' })).toBeNull();
    expect(within(sheet).queryByRole('textbox', { name: 'Client name in Daftra' })).toBeNull();
    expect(asked).toEqual([]);
  });

  it('shows none while the status loads, and shows the part when it says ready', async () => {
    let release: (status: Status) => void = () => undefined;
    const { sheet } = await open({ answers: { status: () => new Promise<Status>((resolve) => { release = resolve; }) } });
    await settle();
    expect(within(sheet).queryByText('Daftra')).toBeNull();
    await act(async () => { release(READY); });
    expect(await within(sheet).findByText('Daftra')).toBeInTheDocument();
  });

  it('hides the part when the payment read answers daftra_not_ready', async () => {
    const { sheet } = await open({ answers: { link: () => { throw invalid('daftra', 'x', 'daftra_not_ready'); } } });
    await settle();
    expect(within(sheet).queryByText('Daftra')).toBeNull();
    expect(within(sheet).queryByText('Retry')).toBeNull();
  });
});

describe('state 0: the project has no Daftra account', () => {
  it('says to pick a sub-company when the project has none', async () => {
    const { sheet } = await open({ answers: { link: () => ({ ...BASE, account: null, noAccount: 'no_sub_company', matched: null }) } });
    expect(await within(sheet).findByText('Pick a sub-company for this project to link a Daftra invoice.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Link this invoice' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Mark as received' })).toBeInTheDocument();
  });

  it('names the sub-company that has no account', async () => {
    const { sheet } = await open({
      prepare: (state) => {
        addSampleSubCompanies(state, '2026-09-30');
        const project = Object.values(state.projects).find((item) => item.code === 'KH-26-001')!;
        project.subCompanyId = Object.values(state.subCompanies ?? {}).find((sub) => sub.name === 'Vado')!.id;
      },
      answers: { link: () => ({ ...BASE, account: null, noAccount: 'no_daftra_account', matched: null }) },
    });
    expect(await within(sheet).findByText('Vado has no Daftra account in Madar yet.')).toBeInTheDocument();
  });
});

describe('state 1: the project has no client', () => {
  it('says to add a client', async () => {
    const { sheet } = await open({ answers: { link: () => ({ ...BASE, matched: null, projectHasNoClient: true }) } });
    expect(await within(sheet).findByText('Add a client to this project to link a Daftra invoice.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('textbox', { name: 'Client name in Daftra' })).toBeNull();
  });
});

describe('state 2: the client has no match', () => {
  const found = { clients: [{ id: '77', name: 'Gulf Crest Trading', number: '000123' }, { id: '78', name: 'Gulf Crest Holding Co.', number: '000124' }] };

  it('fills the search with the client name, lists the results, and matches with one press and a toast', async () => {
    let matched = false;
    const { sheet, askedOf, payment, client } = await open({
      answers: {
        link: () => (matched ? { ...BASE, suggested: invoice('1830', '1521945', 360000) } : { ...BASE, matched: null }),
        find: () => found,
        match: () => { matched = true; return { matched: { name: 'Gulf Crest Trading' }, invoices: 3 }; },
      },
    });
    expect(await within(sheet).findByText(`Find ${client.name} in Daftra`)).toBeInTheDocument();
    const field = within(sheet).getByRole('textbox', { name: 'Client name in Daftra' });
    expect(field).toHaveValue(client.name);
    expect(await within(sheet).findByRole('button', { name: 'Use Gulf Crest Trading' })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('button', { name: /^Use / })).toHaveLength(2);
    expect(askedOf('daftra.findClients')[0].input).toEqual({ paymentId: payment.id, query: client.name });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Use Gulf Crest Trading' }));
    expect(askedOf('daftra.matchClient')[0].input).toEqual({ paymentId: payment.id, daftraClientId: '77' });
    expect(await screen.findByText('Matched to Gulf Crest Trading in Daftra.')).toBeInTheDocument();
    // The sheet reads the payment again after its own match, and the suggestion shows.
    expect(await within(sheet).findByRole('button', { name: 'Link this invoice' })).toBeInTheDocument();
    expect(askedOf('daftra.paymentLink').length).toBeGreaterThanOrEqual(2);
  });

  it('searches again for what the person types, after a short wait', async () => {
    const { sheet, askedOf } = await open({ answers: { link: () => ({ ...BASE, matched: null }), find: () => found } });
    const field = await within(sheet).findByRole('textbox', { name: 'Client name in Daftra' });
    fireEvent.change(field, { target: { value: 'Crest' } });
    await waitFor(() => expect(askedOf('daftra.findClients').map((call) => (call.input as { query: string }).query)).toContain('Crest'));
  });

  it('says so when Daftra has no client with the name', async () => {
    const { sheet } = await open({ answers: { link: () => ({ ...BASE, matched: null }), find: () => ({ clients: [] }) } });
    expect(await within(sheet).findByText('Daftra has no client with this name.')).toBeInTheDocument();
  });

  it('shows a failed search calmly, with Retry', async () => {
    let fail = true;
    const { sheet, askedOf } = await open({
      answers: { link: () => ({ ...BASE, matched: null }), find: () => { if (fail) throw invalid('daftra', 'x', 'daftra_unreachable'); return found; } },
    });
    expect(await within(sheet).findByText('Madar could not reach Daftra. Try again in a minute.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Retry' }));
    expect(await within(sheet).findByRole('button', { name: 'Use Gulf Crest Trading' })).toBeInTheDocument();
    expect(askedOf('daftra.findClients').length).toBeGreaterThanOrEqual(2);
  });
});

describe('state 3: a suggestion', () => {
  const suggested = invoice('1830', '1521945', 360000);

  it('shows the invoice and one main button, Link, and Save stops being the main button', async () => {
    const { sheet } = await open({ answers: { link: () => ({ ...BASE, suggested }) } });
    expect(await within(sheet).findByText('Invoice 1521945, SAR 360,000, made 29 Sept')).toBeInTheDocument();
    expect(within(sheet).getByText('Daftra client: Gulf Crest Trading')).toBeInTheDocument();
    const link = within(sheet).getByRole('button', { name: 'Link this invoice' });
    expect(link).toHaveClass('signature');
    expect(within(sheet).getByRole('button', { name: 'Save' })).not.toHaveClass('signature');
    expect(within(sheet).queryByRole('textbox', { name: 'Client name in Daftra' })).toBeNull();
    // The amounts are equal, so no second amount line.
    expect(within(sheet).queryByText(/The invoice total is/)).toBeNull();
  });

  // Owner, 2026-10-26: in the footer, Link made a fifth button that fell off the sheet. It sits in the Daftra box, under the invoice it links.
  it('puts Link in the Daftra box, under the invoice, and keeps the footer to its own buttons', async () => {
    const { sheet } = await open({ answers: { link: () => ({ ...BASE, suggested }) } });
    const box = await within(sheet).findByRole('region', { name: 'Daftra' });
    expect(within(box).getByRole('button', { name: 'Link this invoice' })).toHaveClass('signature');
    expect(within(sheet).getAllByRole('button', { name: 'Link this invoice' })).toHaveLength(1);
  });

  // A wrong match must be easy to fix: the search of state 2 opens again from the client line, and a new match replaces the old one.
  it('changes the Daftra client: the search opens again, Keep closes it, and a new match replaces the old one', async () => {
    const found = { clients: [{ id: '78', name: 'Gulf Crest Holding Co.', number: '000124' }] };
    let name = 'Gulf Crest Trading';
    const { sheet, askedOf, payment } = await open({
      answers: {
        link: () => ({ ...BASE, matched: { name }, suggested }),
        find: () => found,
        match: () => { name = 'Gulf Crest Holding Co.'; return { matched: { name }, invoices: 1 }; },
      },
    });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Change the Daftra client' }));
    expect(within(sheet).getByRole('textbox', { name: 'Client name in Daftra' })).toBeInTheDocument();
    // While the person changes the client, no invoice of the old client can be linked.
    expect(within(sheet).queryByRole('button', { name: 'Link this invoice' })).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Keep Gulf Crest Trading' }));
    expect(within(sheet).queryByRole('textbox', { name: 'Client name in Daftra' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Link this invoice' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Change the Daftra client' }));
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Use Gulf Crest Holding Co.' }));
    expect(askedOf('daftra.matchClient')[0].input).toEqual({ paymentId: payment.id, daftraClientId: '78' });
    expect(await within(sheet).findByText('Daftra client: Gulf Crest Holding Co.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('textbox', { name: 'Client name in Daftra' })).toBeNull();
  });

  it('sends only the payment and the invoice with Link, and shows a toast with Undo', async () => {
    standIn();
    const { sheet, sent, payment, store } = await open({ answers: { link: () => ({ ...BASE, suggested }) } });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Link this invoice' }));
    expect(await screen.findByText('Invoice 1521945 is linked.')).toBeInTheDocument();
    expect(sent.filter((call) => call.name === 'payments.linkInvoice').map((call) => call.input)).toEqual([{ id: payment.id, invoiceId: '1830' }]);
    await waitFor(() => expect(store.state.payments?.[payment.id].daftra?.invoiceId).toBe('1830'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit payment' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(await within(await screen.findByRole('region', { name: 'Payments' })).findByText('Invoiced')).toBeInTheDocument();
  });

  it('keeps the sheet open and shows the reason when the server refuses the link, and reads the payment again', async () => {
    spies.push(vi.spyOn(prepareOf(), 'prepare').mockRejectedValue(invalid('invoiceId', 'x', 'daftra_invoice_taken')));
    const { sheet, askedOf } = await open({ answers: { link: () => ({ ...BASE, suggested }) } });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Link this invoice' }));
    expect(await screen.findByText('Another payment has this Daftra invoice.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit payment' })).toBeInTheDocument();
    await waitFor(() => expect(askedOf('daftra.paymentLink').length).toBeGreaterThanOrEqual(2));
  });

  it('opens the other invoices, and a press on one makes it the invoice to link, with both amounts when they differ', async () => {
    standIn({ ...linkSnapshot(), invoiceId: '1829', invoiceNo: '1521900', total: 150000, issuedOn: '2026-09-20' });
    const others = [invoice('1829', '1521900', 150000, '2026-09-20'), invoice('1828', '1521899', 90000, '2026-09-18')];
    const { sheet, sent, payment } = await open({ answers: { link: () => ({ ...BASE, suggested, others }) } });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Not this one? Choose another' }));
    expect(within(sheet).getByText('Other recent invoices of this client')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Invoice 1521900, SAR 150,000, made 20 Sept' }));
    expect(within(sheet).getByText('Invoice 1521900, SAR 150,000, made 20 Sept')).toBeInTheDocument();
    expect(within(sheet).getByText(/The invoice total is SAR 150,000\. The payment is SAR 360,000\./)).toBeInTheDocument();
    expect(within(sheet).queryByText('Other recent invoices of this client')).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Link this invoice' }));
    await waitFor(() => expect(sent.filter((call) => call.name === 'payments.linkInvoice').map((call) => call.input)).toEqual([{ id: payment.id, invoiceId: '1829' }]));
  });
});

describe('state 4: no suggestion', () => {
  it('says when Madar looks again, and offers the other invoices', async () => {
    const others = [invoice('1829', '1521900', 150000, '2026-09-20')];
    const { sheet } = await open({ answers: { link: () => ({ ...BASE, others }) } });
    expect(await within(sheet).findByText('No Daftra invoice of SAR 360,000 yet. Madar looks again every 15 minutes.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Link this invoice' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Save' })).toHaveClass('signature');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Choose another invoice' }));
    expect(within(sheet).getByRole('button', { name: 'Invoice 1521900, SAR 150,000, made 20 Sept' })).toBeInTheDocument();
  });

  it('says so when Daftra has no other recent invoice', async () => {
    const { sheet } = await open({ answers: { link: () => BASE } });
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Choose another invoice' }));
    expect(within(sheet).getByText('Daftra has no other recent invoice for this client.')).toBeInTheDocument();
  });
});

describe('states 5 and 6: a linked payment', () => {
  const LINKED = { account: 'MAZJ', invoiceId: '1830', invoiceNo: '1521945', total: 360000, issuedOn: '2026-09-29', linkedBy: 'usr_011', linkedAt: '2026-09-29T10:00:00.000+03:00' };
  const linked = (state: State) => { for (const payment of Object.values(state.payments ?? {})) if (payment.name === NAME) payment.daftra = { ...LINKED }; };

  it('shows Invoiced and a quiet Unlink, hides Mark as received, and asks nothing about a suggestion', async () => {
    const { sheet, askedOf, sent, payment } = await open({ prepare: linked });
    expect(await within(sheet).findByText('Invoiced: invoice 1521945.')).toBeInTheDocument();
    expect(within(sheet).getByText('Daftra sets Received when it is paid.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Mark as received' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Link this invoice' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Save' })).toHaveClass('signature');
    await settle();
    expect(askedOf('daftra.paymentLink')).toHaveLength(0);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(sent.filter((call) => call.name === 'payments.unlinkInvoice').map((call) => call.input)).toEqual([{ id: payment.id }]));
    expect(await screen.findByText('Invoice 1521945 is unlinked.')).toBeInTheDocument();
  });

  it('shows the invoice of a payment that Daftra marked received', async () => {
    const { sheet } = await open({ payment: 'Concept stage fee', prepare: (state) => { for (const payment of Object.values(state.payments ?? {})) if (payment.name === 'Concept stage fee') payment.daftra = { ...LINKED }; } });
    expect(await within(sheet).findByText('Invoice 1521945 is paid in Daftra.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Unlink' })).toBeInTheDocument();
  });

  it('shows the read-only lines to a person without the Daftra switch, and asks Daftra nothing', async () => {
    const { sheet, asked } = await open({ user: 'usr_010', prepare: linked });
    expect(await within(sheet).findByText('Invoiced: invoice 1521945.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Unlink' })).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe('loading and errors', () => {
  it('shows a quiet line while the payment read loads', async () => {
    let release: (link: Link) => void = () => undefined;
    const { sheet } = await open({ answers: { link: () => new Promise<Link>((resolve) => { release = resolve; }) } });
    expect(await within(sheet).findByText('Looking in Daftra...')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled();
    await act(async () => { release({ ...BASE, suggested: invoice('1830', '1521945', 360000) }); });
    expect(await within(sheet).findByRole('button', { name: 'Link this invoice' })).toBeInTheDocument();
    expect(within(sheet).queryByText('Looking in Daftra...')).toBeNull();
  });

  it('shows the reason and Retry when the read fails, and the rest of the sheet keeps working', async () => {
    let fail = true;
    const { sheet, askedOf } = await open({
      answers: { link: () => { if (fail) throw invalid('daftra', 'x', 'daftra_bad_key'); return { ...BASE, suggested: invoice('1830', '1521945', 360000) }; } },
    });
    expect(await within(sheet).findByText('Madar cannot sign in to Daftra. Ask an Admin.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Mark as received' })).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Retry' }));
    expect(await within(sheet).findByRole('button', { name: 'Link this invoice' })).toBeInTheDocument();
    expect(askedOf('daftra.paymentLink')).toHaveLength(2);
  });
});

describe('in Arabic', () => {
  // The invoice number and the Daftra client name each sit inside a direction isolate, so an English name keeps its order in an Arabic sentence.
  const FSI = String.fromCharCode(0x2068);
  const PDI = String.fromCharCode(0x2069);

  it('shows the suggestion, the client and the main button in Arabic, with the names isolated, and keeps the sheet in order', async () => {
    const { sheet } = await open({ answers: { link: () => ({ ...BASE, suggested: invoice('1830', '1521945', 360000) }) } });
    await within(sheet).findByRole('button', { name: 'Link this invoice' });
    act(() => { initI18n('ar'); });
    const link = await within(sheet).findByRole('button', { name: 'اربط هذه الفاتورة' });
    expect(link).toHaveClass('signature');
    expect(sheet.textContent).toContain(`الفاتورة ${FSI}1521945${PDI}، 360,000 ر.س، صدرت 29 سبتمبر`);
    expect(sheet.textContent).toContain(`العميل في دفترة: ${FSI}Gulf Crest Trading${PDI}`);
    expect(within(sheet).getByRole('button', { name: 'ليست هذه؟ اختر فاتورة أخرى' })).toBeInTheDocument();
  });

  it('shows the Invoiced sign in Arabic', async () => {
    const LINKED = { account: 'MAZJ', invoiceId: '1830', invoiceNo: '1521945', total: 360000, issuedOn: '2026-09-29', linkedBy: 'usr_011', linkedAt: '2026-09-29T10:00:00.000+03:00' };
    const { sheet } = await open({ prepare: (state) => { for (const payment of Object.values(state.payments ?? {})) if (payment.name === NAME) payment.daftra = { ...LINKED }; } });
    await within(sheet).findByText('Invoiced: invoice 1521945.');
    act(() => { initI18n('ar'); });
    expect(await within(sheet).findByText(`صدرت الفاتورة ${FSI}1521945${PDI}.`)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'ألغِ الربط' })).toBeInTheDocument();
    expect(within(sheet).getByText('تسجّل دفترة الاستلام عندما تُدفع الفاتورة.')).toBeInTheDocument();
  });
});
