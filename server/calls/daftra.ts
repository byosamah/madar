import type { DaftraInvoiceView } from '../../src/api/contract/server';
import type { Project } from '../../src/api/contract/entities';
import { ApiError, forbidden, invalid, notFound } from '../../src/api/errors';
import type { DaftraSnapshot } from '../../src/api/handlers/payments';
import { can, type Actor } from '../../src/api/permissions';
import type { ServerHooks } from '../../src/api/registry';
import { withRights } from '../../src/api/rights';
import { addDays, nowStamp, todayISO } from '../../src/lib/dates';
import { daftraOf, DaftraError, type DaftraClient } from '../daftra/client';
import { cachedInvoicesOf, clientMatch, paymentFacts, putInvoices, putMatch, readState, takenInvoiceIds } from '../daftra/store';
import { chooseFrom, suggestInvoice, type CachedInvoice } from '../daftra/suggest';
import { readOffice } from '../data/officeCache';
import { assertMayView } from '../files/rights';
import type { Deps } from '../core/ports';
import type { OfficeSnapshot, ServerCall } from '../core/types';

/**
 * The four Daftra calls and the preflight of payments.linkInvoice (the Daftra link, owner 2026-10-26; server/daftra/CLAUDE.md).
 * Madar only reads Daftra. Every call is for a person who holds payment.view and the switch payment.daftraLink; an agent gets forbidden, and
 * the MCP deny list keeps all of them away from agents too. An error says who may not, never which Daftra thing: the refusal of a person
 * without payment.view names that right, never a Daftra word. No answer, error or log line holds the key, the site or a text of a Daftra
 * answer. A Daftra call never runs inside a transaction and never under the office lock.
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

const notReady = () => invalid('daftra', 'Daftra is not set up for this office yet.', 'daftra_not_ready');

function readyOf(deps: Deps): DaftraClient {
  const client = daftraOf(deps);
  if (!client) throw notReady();
  return client;
}

/** A Daftra failure as the refusal of the call. The code and the status go to the log; no text of Daftra goes anywhere. */
export function refusalOf(deps: Deps, call: string, error: unknown, what: 'invoice' | 'client' | 'list'): unknown {
  if (!(error instanceof DaftraError)) return error;
  deps.log.warn('A Daftra read failed.', { call, code: error.code, ...(error.status > 0 ? { status: error.status } : {}) });
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

export const daftraStatus: ServerCall<'daftra.status'> = async (_input, ctx) => {
  linkerOf(ctx.office, ctx.principal.userId);
  if (!ctx.deps.config.daftra) return { output: { ready: false, lastReadAt: null, problem: null }, changed: false };
  const state = await ctx.deps.db.tx('read', (q) => readState(q));
  return { output: { ready: true, lastReadAt: state.lastReadAt === null ? null : nowStamp(new Date(state.lastReadAt)), problem: state.problem }, changed: false };
};

/** For the payment sheet: the match of the client, one invoice to suggest and the others. It reads the cache only, so it is fast. */
export const daftraPaymentLink: ServerCall<'daftra.paymentLink'> = async (input, ctx) => {
  const { deps, office } = ctx;
  linkerOf(office, ctx.principal.userId);
  readyOf(deps);
  const missing = () => notFound('Payment', input.paymentId);
  const payment = await deps.db.tx('read', (q) => paymentFacts(q, input.paymentId));
  if (!payment) throw missing();
  // A payment of a project that the person does not see reads as a missing payment (hidden projects).
  assertMayView(office, ctx.principal.userId, payment.projectId, missing);
  const project = office.lists.projects[payment.projectId];
  if (!project) throw missing();
  const clientId = clientOfProject(project);
  if (clientId === null) return { output: { matched: null, projectHasNoClient: true, suggested: null, others: [] }, changed: false };
  return deps.db.tx('read', async (q) => {
    const match = await clientMatch(q, clientId);
    if (!match) return { output: { matched: null, projectHasNoClient: false, suggested: null, others: [] }, changed: false };
    const matched = { name: match.daftraName };
    // A payment that has its invoice already needs no list.
    if (payment.daftra) return { output: { matched, projectHasNoClient: false, suggested: null, others: [] }, changed: false };
    const cached = await cachedInvoicesOf(q, match.daftraId);
    const taken = await takenInvoiceIds(q, cached.map((invoice) => invoice.id), payment.id);
    const suggested = suggestInvoice({ amount: payment.amount, dueDate: payment.dueDate, invoices: cached, taken });
    const others = chooseFrom(cached, taken).filter((invoice) => invoice.id !== suggested?.id).slice(0, 10);
    return { output: { matched, projectHasNoClient: false, suggested: suggested ? viewOf(suggested) : null, others: others.map(viewOf) }, changed: false };
  });
};

/** The one live read of a screen: a search of the Daftra clients by name. */
export const daftraFindClients: ServerCall<'daftra.findClients'> = async (input, ctx) => {
  linkerOf(ctx.office, ctx.principal.userId);
  const daftra = readyOf(ctx.deps);
  try {
    const found = await daftra.findClients(input.query);
    return { output: { clients: found.slice(0, 10).map((client) => ({ id: client.id, name: client.name, number: client.number })) }, changed: false };
  } catch (error) {
    throw refusalOf(ctx.deps, 'daftra.findClients', error, 'list');
  }
};

/**
 * Keeps the match of a Madar client to a Daftra client, and fills the cache for it. The Daftra client is read first, outside any
 * transaction. A failed cache fill never undoes the match: the 15-minute job fills the cache later.
 */
export const daftraMatchClient: ServerCall<'daftra.matchClient'> = async (input, ctx) => {
  const { deps, office, now } = ctx;
  linkerOf(office, ctx.principal.userId);
  const daftra = readyOf(deps);
  if (!office.lists.clients[input.clientId]) throw notFound('Client', input.clientId);
  let found: Awaited<ReturnType<DaftraClient['client']>>;
  try {
    found = await daftra.client(input.daftraClientId);
  } catch (error) {
    throw refusalOf(deps, 'daftra.matchClient', error, 'client');
  }
  await deps.db.tx('write', (q) => putMatch(q, { clientId: input.clientId, daftraId: found.id, daftraName: found.name, matchedBy: ctx.principal.userId, at: now }));
  let invoices = 0;
  try {
    const list = await daftra.invoicesOf(found.id, addDays(todayISO(now), -MATCH_BACK_DAYS));
    await deps.db.tx('write', (q) => putInvoices(q, list, now));
    invoices = list.length;
  } catch (error) {
    if (error instanceof DaftraError) deps.log.warn('A Daftra read failed.', { call: 'daftra.matchClient', code: error.code, ...(error.status > 0 ? { status: error.status } : {}) });
    else throw error;
  }
  return { output: { matched: { name: found.name }, invoices }, changed: false };
};

/**
 * The preflight of payments.linkInvoice: it runs before the office lock, reads the invoice from Daftra and gives the snapshot that the
 * handler copies into Payment.daftra. It never trusts the browser: the browser names only an id. It checks the rights, the config, that the
 * payment is of a project the person sees, that the client of the project has a match, that the invoice is of that Daftra client, and that it
 * is no draft. The check that no other payment holds the invoice happens inside the lock (the handler).
 */
export const paymentsLinkInvoiceHooks: ServerHooks<unknown, unknown, Deps> = {
  async preflight(raw, { actorId, deps }): Promise<DaftraSnapshot> {
    const input = raw as { id: string; invoiceId: string };
    const office = await readOffice(deps);
    linkerOf(office, actorId);
    const daftra = readyOf(deps);
    const missing = () => notFound('Payment', input.id);
    const payment = await deps.db.tx('read', (q) => paymentFacts(q, input.id));
    if (!payment) throw missing();
    assertMayView(office, actorId, payment.projectId, missing);
    const project = office.lists.projects[payment.projectId];
    const clientId = project ? clientOfProject(project) : null;
    if (clientId === null) throw invalid('invoiceId', 'Add a client to this project to link a Daftra invoice.', 'daftra_no_client');
    const match = await deps.db.tx('read', (q) => clientMatch(q, clientId));
    if (!match) throw invalid('invoiceId', 'Find the client in Daftra first.', 'daftra_no_match');
    let invoice: Awaited<ReturnType<DaftraClient['invoice']>>;
    try {
      invoice = await daftra.invoice(input.invoiceId);
    } catch (error) {
      throw refusalOf(deps, 'payments.linkInvoice', error, 'invoice');
    }
    if (invoice.clientId !== match.daftraId) throw invalid('invoiceId', 'This invoice is of another Daftra client.', 'daftra_client_mismatch');
    if (invoice.draft) throw invalid('invoiceId', 'This invoice is a draft in Daftra.', 'daftra_draft');
    return { invoiceId: invoice.id, invoiceNo: invoice.no, total: invoice.totalHalalas / 100, issuedOn: invoice.issuedOn };
  },
};
