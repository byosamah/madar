import { addDays, todayISO } from '../../../src/lib/dates';
import { accountOfProject } from '../../daftra/account';
import { daftraAccountsOf, daftraOf, DaftraError, type DaftraClient } from '../../daftra/client';
import { officeOf } from '../../daftra/office';
import { DAFTRA_INTERNAL_CALLS, DAFTRA_PAID_CALL } from '../../daftra/paidCall';
import {
  allMatches, checkedTimes, linkedUnpaid, openUnlinked, putInvoices, saveChecked, saveGoodRead, saveProblem, type DaftraProblem, type PaymentFacts,
} from '../../daftra/store';
import { dayMinus } from '../../daftra/suggest';
import { createRunCall, type RunCall } from '../../core/runCall';
import type { Deps } from '../../core/ports';
import type { OfficeSnapshot } from '../../core/types';
import { isLite } from '../../data/dialect';

/**
 * The daftra step of the 15-minute job (the Daftra link, owner 2026-10-26; server/daftra/CLAUDE.md). It reads Daftra, one account at a time, and
 * never writes to it. Each sub-company has its own Daftra account, so every read names an account.
 *
 *   1. The paid check: each payment that holds a Daftra invoice and has no received day, the oldest link first. It reads that invoice from the
 *      account stored in `Payment.daftra.account`. When Daftra says the invoice is paid (`payment_status` 2), Madar sets `receivedOn` to the
 *      day of the last Daftra payment of the invoice (never after today). The write is the internal call `payments.daftraPaid`
 *      (server/daftra/paidCall.ts): under the office lock, with a story, an event that names Daftra as the source, the save and the signals.
 *      The actor is the person who linked the payment while that person is active, else the first active Admin.
 *   2. The cache: each matched client that has an open payment with no invoice, due within 30 days or past due, gets its recent invoices read
 *      (`invoicesOf`, from 60 days before the oldest due day) and saved in daftra_invoices. The sheet suggests from this cache.
 *   3. The state: `lastReadAt` and the last `problem` of each account (job_runs rows), for daftra.status.
 *
 * Rules:
 *   - No office lock and no transaction is open during a Daftra call. The paid write takes the lock for its own short transaction.
 *   - A budget for each run, for all accounts together: at most 20 Daftra calls and 60 seconds. The accounts take turns, one item each, so a slow
 *     account cannot starve the others. When the budget ends, the rest waits for the next run. The step is safe to run twice.
 *   - One account that fails (a wrong key, a key role that refuses, Daftra down) stops only its own items for this run. The others go on.
 *   - It logs codes, ids and account names only: never a key, a site, a text of a Daftra answer, or a name of a client.
 *   - With no Daftra account in the config it returns at once. On the office object path (SQLite) it also returns at once, until the office
 *     has a NetApi method for it (server/daftra/CLAUDE.md, TASKS.md). A test turns the office path on with `onOffice`.
 */

export const DAFTRA_MAX_CALLS = 20;
export const DAFTRA_MAX_MS = 60_000;
/** An open payment that falls due within this many days (or is past due) makes its client's cache fill. */
export const CACHE_AHEAD_DAYS = 30;
/** The cache starts this many days before the oldest due day, so an invoice made before the due day is read too. */
export const CACHE_BACK_DAYS = 60;

export type DaftraStepOptions = {
  /** For a test: run the step on the SQLite data. The real step returns at once there. */
  onOffice?: boolean;
  /** For a test: the runner of the internal call. Default: the Postgres runCall on the private map. */
  run?: RunCall;
  /** For a test: the clock of the budget, in milliseconds. */
  nowMs?: () => number;
};

export type DaftraReport =
  | { skipped: 'no_config' | 'office' }
  | {
    accounts: number;
    /** The Daftra calls of this run. */
    calls: number;
    /** The payments that this run set to Received. */
    paid: number;
    /** The matched clients whose invoices this run read into the cache. */
    filled: number;
    /** The items that the budget left for the next run. */
    left: number;
    /** The accounts that met a problem in this run: name and problem. */
    problems: { account: string; problem: DaftraProblem }[];
  };

type Linked = PaymentFacts & { daftra: NonNullable<PaymentFacts['daftra']> };
type Item = { kind: 'paid'; payment: Linked } | { kind: 'cache'; daftraClientId: string; from: string };

/** The problem that a Daftra error is, for daftra.status. A missing record is no problem of the account. */
export function problemOf(error: DaftraError): DaftraProblem | null {
  if (error.code === 'bad_key') return 'bad_key';
  if (error.code === 'refused') return 'refused';
  if (error.code === 'not_found') return null;
  return 'unreachable';
}

/** The person who sets Received for a linked payment: the one who linked it while active, else the first active Admin by id. Null when nobody can. */
export function paidActorOf(office: OfficeSnapshot, linkedBy: string): string | null {
  const users = office.lists.users;
  if (users[linkedBy]?.kind === 'human' && users[linkedBy].active) return linkedBy;
  return Object.values(users)
    .filter((user) => user.kind === 'human' && user.active && user.systemRole === 'admin')
    .map((user) => user.id)
    .sort()[0] ?? null;
}

/**
 * The queue of each account: the cache fills first (oldest due day first; they feed the suggestions of the sheet, and there are few), then the
 * paid checks, the invoice read longest ago first and a never read one before all (code review, 2026-10-26: a busy account must never starve a
 * newer link or its suggestions). Equal times keep the order of the read (oldest link first). A payment of an account that the copy has no key
 * for is left out. Pure, so a test can read it.
 */
export function queuesOf(o: {
  office: OfficeSnapshot; accounts: readonly string[]; linked: readonly PaymentFacts[]; open: readonly PaymentFacts[]; matches: ReadonlyMap<string, string>;
  checked?: ReadonlyMap<string, string>;
}): Map<string, Item[]> {
  const queues = new Map<string, Item[]>(o.accounts.map((account) => [account, []]));
  const paid = new Map<string, Linked[]>(o.accounts.map((account) => [account, []]));
  for (const payment of o.linked) {
    if (payment.daftra) paid.get(payment.daftra.account)?.push(payment as Linked);
  }
  // The oldest due day of each matched client in each account.
  const oldest = new Map<string, { account: string; daftraClientId: string; due: string }>();
  for (const payment of o.open) {
    const project = o.office.lists.projects[payment.projectId];
    if (!project || project.kind === 'internal') continue;
    const where = accountOfProject(project, o.office.lists.subCompanies, o.accounts);
    if (where.account === null) continue;
    const daftraClientId = o.matches.get(`${where.account}/${project.clientId}`);
    if (daftraClientId === undefined) continue;
    const key = `${where.account}/${daftraClientId}`;
    const known = oldest.get(key);
    if (!known || payment.dueDate < known.due) oldest.set(key, { account: where.account, daftraClientId, due: payment.dueDate });
  }
  for (const { account, daftraClientId, due } of [...oldest.values()].sort((a, b) => a.due.localeCompare(b.due) || a.daftraClientId.localeCompare(b.daftraClientId))) {
    queues.get(account)?.push({ kind: 'cache', daftraClientId, from: dayMinus(due, CACHE_BACK_DAYS) });
  }
  const lastCheck = (payment: Linked) => o.checked?.get(`${payment.daftra.account}:${payment.daftra.invoiceId}`) ?? '';
  for (const [account, payments] of paid) {
    // A stable sort: equal times keep the order of the read.
    const ordered = [...payments].sort((a, b) => lastCheck(a).localeCompare(lastCheck(b)));
    queues.get(account)?.push(...ordered.map((payment): Item => ({ kind: 'paid', payment })));
  }
  return queues;
}

export async function daftra(deps: Deps, at: Date, o: DaftraStepOptions = {}): Promise<DaftraReport> {
  const accounts = daftraAccountsOf(deps);
  if (accounts.length === 0) return { skipped: 'no_config' };
  if (isLite(deps.db) && !o.onOffice) return { skipped: 'office' };

  const nowMs = o.nowMs ?? (() => performance.now());
  const startedAt = nowMs();
  const today = todayISO(at);
  const report = { accounts: accounts.length, calls: 0, paid: 0, filled: 0, left: 0, problems: [] as { account: string; problem: DaftraProblem }[] };

  // One read of everything the run needs, with no lock. The office lists come from the cache (Postgres) or the office rows (SQLite).
  const office = await officeOf(deps);
  const { linked, open, matches, checked } = await deps.db.tx('read', async (q) => ({
    linked: await linkedUnpaid(q),
    open: await openUnlinked(q, addDays(today, CACHE_AHEAD_DAYS)),
    matches: await allMatches(q),
    checked: await checkedTimes(q),
  }));
  const matched = new Map(matches.map((match) => [`${match.account}/${match.clientId}`, match.daftraId]));
  const queues = queuesOf({ office, accounts, linked, open, matches: matched, checked });
  const run = o.run ?? createRunCall({ calls: DAFTRA_INTERNAL_CALLS });

  const clients = new Map<string, DaftraClient>();
  const clientOf = (account: string): DaftraClient | undefined => {
    if (!clients.has(account)) {
      const made = daftraOf(deps, account);
      if (made) clients.set(account, made);
    }
    return clients.get(account);
  };
  const problem = new Map<string, DaftraProblem>();
  const read = new Set<string>();
  const overBudget = () => report.calls >= DAFTRA_MAX_CALLS || nowMs() - startedAt >= DAFTRA_MAX_MS;

  // The accounts take turns: one item each, until every queue is empty, an account has failed, or the budget ends.
  let moved = true;
  while (moved && !overBudget()) {
    moved = false;
    for (const account of accounts) {
      if (overBudget()) break;
      const queue = queues.get(account) ?? [];
      const item = problem.has(account) ? undefined : queue.shift();
      if (!item) continue;
      moved = true;
      const daftraClient = clientOf(account);
      if (!daftraClient) continue;
      report.calls += 1;
      try {
        if (item.kind === 'paid') {
          const invoice = await daftraClient.invoice(item.payment.daftra.invoiceId);
          read.add(account);
          await deps.db.tx('write', (q) => saveChecked(q, account, item.payment.daftra.invoiceId, at));
          if (invoice.paymentStatus === 2) {
            // The day of the last Daftra payment row. A paid invoice with no readable payment row gets the day of this run.
            const receivedOn = invoice.paidOn !== null && invoice.paidOn < today ? invoice.paidOn : today;
            const actorId = paidActorOf(office, item.payment.daftra.linkedBy);
            if (actorId === null) {
              deps.log.warn('Daftra says an invoice is paid, but no active person can set the payment. The next run tries it again.', { step: 'daftra', account, id: item.payment.id });
            } else {
              const result = await run(deps, {
                principal: { userId: actorId }, name: DAFTRA_PAID_CALL, batch: { storyRefs: new Map(), overviewCalls: 0 },
                input: { id: item.payment.id, account, invoiceId: item.payment.daftra.invoiceId, receivedOn },
              });
              if (!result.ok) deps.log.error('A payment could not be set to Received. The next run tries it again.', { step: 'daftra', account, id: item.payment.id, error: result.error.code });
              else if ((result.output as { received: boolean }).received) report.paid += 1;
            }
          }
        } else {
          const invoices = await daftraClient.invoicesOf(item.daftraClientId, item.from);
          await deps.db.tx('write', (q) => putInvoices(q, account, invoices, at));
          read.add(account);
          report.filled += 1;
        }
      } catch (error) {
        if (!(error instanceof DaftraError)) throw error;
        // Daftra no longer has this invoice: it goes to the back of the line, so it never blocks the other links (code review, 2026-10-26).
        if (error.code === 'not_found' && item.kind === 'paid') await deps.db.tx('write', (q) => saveChecked(q, account, item.payment.daftra.invoiceId, at));
        // The code, the status and the account only: a Daftra text, a key or a site never reaches the log.
        deps.log.warn('A Daftra read failed. The next run tries it again.', { step: 'daftra', account, code: error.code, ...(error.status > 0 ? { status: error.status } : {}) });
        const found = problemOf(error);
        if (found !== null) problem.set(account, found);
      }
    }
  }

  // The state of each account that this run read or met a problem with. An account with nothing to read keeps its old state. A good read comes
  // first (it clears the old problem), so an account that read well and then failed keeps the time of that read and the new problem.
  for (const account of read) await deps.db.tx('write', (q) => saveGoodRead(q, account, at));
  for (const [account, found] of problem) {
    await deps.db.tx('write', (q) => saveProblem(q, account, found, at));
    report.problems.push({ account, problem: found });
  }
  // What stays for the next run: the items that the budget did not reach (an account that failed counts its whole queue).
  for (const queue of queues.values()) report.left += queue.length;
  return report;
}
