import type { DaftraInvoiceView } from '../../src/api/contract/server';
import type { Project } from '../../src/api/contract/entities';
import { ApiError, forbidden, invalid, notFound } from '../../src/api/errors';
import type { DaftraSnapshot } from '../../src/api/handlers/payments';
import { can, type Actor } from '../../src/api/permissions';
import type { ServerHooks } from '../../src/api/registry';
import { withOfficeRights, withRights } from '../../src/api/rights';
import { addDays, nowStamp, todayISO } from '../../src/lib/dates';
import { accountOfProject, type AccountOfProject } from '../daftra/account';
import { daftraAccountsOf, daftraOf, DaftraError, type DaftraClient } from '../daftra/client';
import { officeOf } from '../daftra/office';
import { cachedInvoicesOf, clientMatch, paymentFacts, putInvoices, putMatch, readStates, takenInvoiceIds, type PaymentFacts } from '../daftra/store';
import { chooseFrom, suggestInvoice, type CachedInvoice } from '../daftra/suggest';
import { readRoles, readUsers } from '../files/records';
import { assertMayView } from '../files/rights';
import type { Deps } from '../core/ports';
import type { OfficeSnapshot, ServerCall } from '../core/types';

/**
 * The four Daftra calls and the preflight of payments.linkInvoice (the Daftra link, owner 2026-10-26; server/daftra/CLAUDE.md).
 * Madar only reads Daftra. Each sub-company has its own Daftra account and key, so a call never takes an account from the browser: it takes a
 * payment id, and the server finds the project of the payment, its sub-company and the account (server/daftra/account.ts).
 *
 * Every call is for a person who holds payment.view and the switch payment.daftraLink; an agent gets forbidden, and the MCP deny list keeps all
 * of them away from agents too. An error says who may not, never which Daftra thing: the refusal of a person without payment.view names that
 * right, never a Daftra word. No answer, error or log line holds a key, a site or a text of a Daftra answer (the account name is not secret).
 * A Daftra call never runs inside a transaction and never under the office lock.
 */

/** The days of invoices that the match reads at once, so the sheet shows a suggestion at once (the job keeps the cache after that). */
export const MATCH_BACK_DAYS = 180;

const refuse = (action: 'payment.view' | 'payment.daftraLink') => forbidden('You cannot do this.', { action });

/**
 * The person of a Daftra call, with the office rights. The view right comes first: a person who may not see payments gets a refusal that
 * names that right, never the Daftra switch. An agent gets the same first refusal.
 */
export function linkerOf(office: OfficeSnapshot, userId: string): Actor {
  const user = office.lists.users[userId];
  if (!user || user.kind === 'agent') throw refuse('payment.view');
  const authority = withRights(office.lists, user);
  if (!can(authority, 'payment.view')) throw refuse('payment.view');
  if (!can(authority, 'payment.daftraLink')) throw refuse('payment.daftraLink');
  return authority;
}

/**
 * The same check for a hook, which has no office snapshot: the person and the roles come from two single statements (the rule of the file hooks,
 * server/files/rights.ts). It comes before every other check, so a copy with no Daftra account reads no office for a person who may not.
 */
async function linkerFromDb(deps: Deps, userId: string): Promise<void> {
  const user = (await readUsers(deps.db, [userId])).get(userId);
  if (!user || user.kind === 'agent') throw refuse('payment.view');
  const authority = withOfficeRights(user, await readRoles(deps.db));
  if (!can(authority, 'payment.view')) throw refuse('payment.view');
  if (!can(authority, 'payment.daftraLink')) throw refuse('payment.daftraLink');
}

const notReady = () => invalid('daftra', 'Daftra is not set up for this office yet.', 'daftra_not_ready');

/** A Daftra failure as the refusal of the call. The code and the status go to the log; no text of Daftra goes anywhere. */
export function refusalOf(deps: Deps, call: string, account: string, error: unknown, what: 'invoice' | 'client' | 'list'): unknown {
  if (!(error instanceof DaftraError)) return error;
  deps.log.warn('A Daftra read failed.', { call, account, code: error.code, ...(error.status > 0 ? { status: error.status } : {}) });
  if (error.code === 'bad_key') return new ApiError('failed', 'Madar cannot sign in to Daftra. Ask an Admin.', { reason: 'daftra_bad_key' });
  if (error.code === 'refused') return new ApiError('failed', 'Daftra does not let Madar read this. Ask an Admin.', { reason: 'daftra_refused' });
  if (error.code === 'not_found' && what === 'invoice') return invalid('invoiceId', 'Daftra has no such invoice.', 'daftra_invoice_not_found');
  if (error.code === 'not_found' && what === 'client') return invalid('daftraClientId', 'Daftra has no such client.', 'daftra_client_not_found');
  return new ApiError('failed', 'Madar could not reach Daftra. Try again in a minute.', { reason: 'daftra_unreachable' });
}

const viewOf = (invoice: Pick<CachedInvoice, 'id' | 'no' | 'totalHalalas' | 'issuedOn'>): DaftraInvoiceView => ({
  id: invoice.id, no: invoice.no, total: invoice.totalHalalas / 100, issuedOn: invoice.issuedOn,
});

/** The Madar client of a project, or null: an internal project has none. */
const clientOfProject = (project: Pick<Project, 'kind' | 'clientId'>): string | null => (project.kind === 'internal' ? null : project.clientId);

/**
 * The payment of a call, its project and the Daftra account of that project. A payment of a project that the person does not see reads as a
 * missing payment (hidden projects). The copy must hold at least one account: else daftra_not_ready, as for every Daftra call.
 */
async function paymentOf(deps: Deps, office: OfficeSnapshot, userId: string, paymentId: string): Promise<{
  payment: PaymentFacts; project: Project; clientId: string | null; where: AccountOfProject;
}> {
  const accounts = daftraAccountsOf(deps);
  if (accounts.length === 0) throw notReady();
  const missing = () => notFound('Payment', paymentId);
  const payment = await deps.db.tx('read', (q) => paymentFacts(q, paymentId));
  if (!payment) throw missing();
  assertMayView(office, userId, payment.projectId, missing);
  const project = office.lists.projects[payment.projectId];
  if (!project) throw missing();
  return { payment, project, clientId: clientOfProject(project), where: accountOfProject(project, office.lists.subCompanies, accounts) };
}

/** The client of the account of the payment, or the refusal daftra_not_ready when the project has no account. */
function clientFor(deps: Deps, where: AccountOfProject): { account: string; daftra: DaftraClient } {
  const daftra = where.account === null ? undefined : daftraOf(deps, where.account);
  if (where.account === null || !daftra) throw notReady();
  return { account: where.account, daftra };
}

export const daftraStatus: ServerCall<'daftra.status'> = async (_input, ctx) => {
  linkerOf(ctx.office, ctx.principal.userId);
  const names = daftraAccountsOf(ctx.deps);
  if (names.length === 0) return { output: { ready: false, accounts: [] }, changed: false };
  const states = await ctx.deps.db.tx('read', (q) => readStates(q));
  const accounts = names.map((name) => {
    const state = states[name];
    return { name, lastReadAt: state?.lastReadAt ? nowStamp(new Date(state.lastReadAt)) : null, problem: state?.problem ?? null };
  });
  return { output: { ready: true, accounts }, changed: false };
};

/** For the payment sheet: the account, the match of the client, one invoice to suggest and the others. It reads the cache only, so it is fast. */
export const daftraPaymentLink: ServerCall<'daftra.paymentLink'> = async (input, ctx) => {
  const { deps, office } = ctx;
  linkerOf(office, ctx.principal.userId);
  const { payment, clientId, where } = await paymentOf(deps, office, ctx.principal.userId, input.paymentId);
  const empty = { matched: null, suggested: null, others: [] };
  if (where.account === null) return { output: { account: null, noAccount: where.noAccount, projectHasNoClient: clientId === null, ...empty }, changed: false };
  const account = where.account;
  if (clientId === null) return { output: { account, noAccount: null, projectHasNoClient: true, ...empty }, changed: false };
  return deps.db.tx('read', async (q) => {
    const match = await clientMatch(q, account, clientId);
    if (!match) return { output: { account, noAccount: null, projectHasNoClient: false, ...empty }, changed: false };
    const matched = { name: match.daftraName };
    // A payment that has its invoice already needs no list.
    if (payment.daftra) return { output: { account, noAccount: null, projectHasNoClient: false, matched, suggested: null, others: [] }, changed: false };
    const cached = await cachedInvoicesOf(q, account, match.daftraId);
    const taken = await takenInvoiceIds(q, account, cached.map((invoice) => invoice.id), payment.id);
    const suggested = suggestInvoice({ amount: payment.amount, dueDate: payment.dueDate, invoices: cached, taken });
    const others = chooseFrom(cached, taken).filter((invoice) => invoice.id !== suggested?.id).slice(0, 10);
    return {
      output: { account, noAccount: null, projectHasNoClient: false, matched, suggested: suggested ? viewOf(suggested) : null, others: others.map(viewOf) },
      changed: false,
    };
  });
};

/** The one live read of a screen: a search of the Daftra clients by name, in the account of the payment. */
export const daftraFindClients: ServerCall<'daftra.findClients'> = async (input, ctx) => {
  const { deps, office } = ctx;
  linkerOf(office, ctx.principal.userId);
  const { where } = await paymentOf(deps, office, ctx.principal.userId, input.paymentId);
  const { account, daftra } = clientFor(deps, where);
  try {
    const found = await daftra.findClients(input.query);
    return { output: { clients: found.slice(0, 10).map((client) => ({ id: client.id, name: client.name, number: client.number })) }, changed: false };
  } catch (error) {
    throw refusalOf(deps, 'daftra.findClients', account, error, 'list');
  }
};

/**
 * Keeps the match of the client of a payment to a Daftra client in the account of that payment, and fills the cache for it. The Daftra client is
 * read first, outside any transaction. A failed cache fill never undoes the match: the 15-minute job fills the cache later.
 */
export const daftraMatchClient: ServerCall<'daftra.matchClient'> = async (input, ctx) => {
  const { deps, office, now } = ctx;
  linkerOf(office, ctx.principal.userId);
  const { clientId, where } = await paymentOf(deps, office, ctx.principal.userId, input.paymentId);
  if (clientId === null) throw invalid('paymentId', 'Add a client to this project to link a Daftra invoice.', 'daftra_no_client');
  const { account, daftra } = clientFor(deps, where);
  let found: Awaited<ReturnType<DaftraClient['client']>>;
  try {
    found = await daftra.client(input.daftraClientId);
  } catch (error) {
    throw refusalOf(deps, 'daftra.matchClient', account, error, 'client');
  }
  await deps.db.tx('write', (q) => putMatch(q, { account, clientId, daftraId: found.id, daftraName: found.name, matchedBy: ctx.principal.userId, at: now }));
  let invoices = 0;
  try {
    const list = await daftra.invoicesOf(found.id, addDays(todayISO(now), -MATCH_BACK_DAYS));
    await deps.db.tx('write', (q) => putInvoices(q, account, list, now));
    invoices = list.length;
  } catch (error) {
    if (error instanceof DaftraError) deps.log.warn('A Daftra read failed.', { call: 'daftra.matchClient', account, code: error.code, ...(error.status > 0 ? { status: error.status } : {}) });
    else throw error;
  }
  return { output: { matched: { name: found.name }, invoices }, changed: false };
};

/**
 * The preflight of payments.linkInvoice: it runs before the office lock, reads the invoice from Daftra and gives the snapshot that the
 * handler copies into Payment.daftra. It never trusts the browser: the browser names only an id, and the server finds the account. It checks
 * the rights, the config, that the payment is of a project the person sees, that the project has an account, that the client of the project has
 * a match in that account, that the invoice is of that Daftra client, and that it is no draft. The check that no other payment holds the
 * invoice happens inside the lock (the handler).
 */
export const paymentsLinkInvoiceHooks: ServerHooks<unknown, unknown, Deps> = {
  async preflight(raw, { actorId, deps }): Promise<DaftraSnapshot> {
    const input = raw as { id: string; invoiceId: string };
    await linkerFromDb(deps, actorId);
    // A copy with no Daftra account stops here, before any read of the office.
    if (daftraAccountsOf(deps).length === 0) throw notReady();
    const office = await officeOf(deps);
    const { clientId, where } = await paymentOf(deps, office, actorId, input.id);
    const { account, daftra } = clientFor(deps, where);
    if (clientId === null) throw invalid('invoiceId', 'Add a client to this project to link a Daftra invoice.', 'daftra_no_client');
    const match = await deps.db.tx('read', (q) => clientMatch(q, account, clientId));
    if (!match) throw invalid('invoiceId', 'Find the client in Daftra first.', 'daftra_no_match');
    let invoice: Awaited<ReturnType<DaftraClient['invoice']>>;
    try {
      invoice = await daftra.invoice(input.invoiceId);
    } catch (error) {
      throw refusalOf(deps, 'payments.linkInvoice', account, error, 'invoice');
    }
    if (invoice.clientId !== match.daftraId) throw invalid('invoiceId', 'This invoice is of another Daftra client.', 'daftra_client_mismatch');
    if (invoice.draft) throw invalid('invoiceId', 'This invoice is a draft in Daftra.', 'daftra_draft');
    return { account, invoiceId: invoice.id, invoiceNo: invoice.no, total: invoice.totalHalalas / 100, issuedOn: invoice.issuedOn };
  },
};
