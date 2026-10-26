import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/errors';
import type { DaftraInvoiceView } from '../../../api/contract/server';
import type { PaymentRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { PRIVATE } from '../../../app/privateMark';
import { useAction, useCall } from '../../../app/runtime';
import { useSubCompany } from '../../../app/subCompanies';
import { useToast } from '../../../app/toasts';
import { useRight } from '../../../app/useRight';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { clientName } from '../../../lib/clientName';
import { formatDay, type Lang } from '../../../lib/dates';
import { amountText } from './PaymentsPanel';

/**
 * The Daftra part of the payment sheet (the Daftra link, owner 2026-10-26; spec "Screens"). Madar only reads Daftra. Each sub-company has its own
 * Daftra account, and the server finds it from the payment, so a screen never names an account.
 *
 * - A person who holds payment.daftraLink and sees an open payment with no link gets the states 0 to 4. The part shows only after
 *   daftra.status says ready. With no Daftra in the copy (the prototype) nothing shows.
 * - A payment that carries a link shows the states 5 and 6 to every person who sees payments. Only a holder of the switch gets Unlink.
 *   These lines come from the payment itself, so they need no Daftra call.
 * - The one main button is Link, in the sheet footer, while a suggestion or a chosen invoice shows. Then Save is a plain button.
 * - Every state is calm: one line, one next step. A failed read shows the reason and Retry (LoadFailed); the rest of the sheet keeps working.
 */

const HEADING = 'text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2';
const QUIET = 'pressable inline-flex min-h-11 items-center self-start rounded-full text-footnote font-medium text-link';
const SEARCH_WAIT_MS = 350;

/** A name or an invoice number with its own direction: in an Arabic sentence it keeps its own order (src/CLAUDE.md, RTL). */
const isolate = (lang: Lang, text: string): string => (lang === 'ar' ? `\u2068${text}\u2069` : text);

/** True when the screen reads this refusal as "this copy has no Daftra": the part stays hidden. */
const isNotReady = (error: unknown): boolean => error instanceof ApiError && error.details.reason === 'daftra_not_ready';

const inHalalas = (riyals: number): number => Math.round(riyals * 100);

export type DaftraPart = {
  /** The part for the body of the sheet, or null. */
  part: ReactNode;
  /** The main button Link for the footer, or null. When it shows, Save is a plain button. */
  /** True while the Link button shows in the part: the sheet's Save is then a plain button, so the sheet keeps one main button. */
  linkShown: boolean;
  /** A Daftra write is on its way: the other buttons wait. */
  pending: boolean;
};

export function useDaftraPart({ projectId, row, busy, onDone }: { projectId: string; row: PaymentRow | null; busy: boolean; onDone: () => void }): DaftraPart {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const mayLink = useRight('payment.daftraLink');
  const payment = row?.payment;
  const linked = payment?.daftra;
  // States 0 to 4: a holder of the switch, a saved payment that is open and has no link. A received payment has nothing to link.
  const asking = mayLink && !!payment && !linked && !payment.receivedOn;
  const status = useCall('daftra.status', {}, { enabled: asking });
  const ready = asking && status.data?.ready === true;
  const paymentId = payment?.id ?? '';
  const read = useCall('daftra.paymentLink', { paymentId }, { enabled: ready });
  const link = read.data;
  const hidden = isNotReady(read.error);

  // The client name for the search comes from the project that the page already holds.
  const detail = useCall('projects.get', { id: projectId }, { enabled: ready });
  const subCompany = useSubCompany(detail.data?.project.subCompanyId);
  const defaultName = detail.data?.client ? clientName(detail.data.client, lang) : '';
  // A matched client can change: the search of state 2 opens again, and a new match replaces the old one (daftra.matchClient).
  const [changing, setChanging] = useState(false);
  const needsMatch = !!link && !link.noAccount && !link.projectHasNoClient && (link.matched === null || changing);
  const [typed, setTyped] = useState<string | null>(null);
  const [settled, setSettled] = useState('');
  useEffect(() => {
    if (typed === null) return undefined;
    const timer = window.setTimeout(() => setSettled(typed), SEARCH_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const query = (typed === null ? defaultName : settled).trim().slice(0, 100);
  const found = useCall('daftra.findClients', { paymentId, query }, { enabled: needsMatch && query.length > 0, keepPrevious: true });

  // The invoice to link: the one that the person chose from the list, else the suggestion.
  const [picked, setPicked] = useState<DaftraInvoiceView | null>(null);
  const [listing, setListing] = useState(false);
  const chosen = picked ?? link?.suggested ?? null;

  // The number of the invoice for the toast is kept at the press: the reads after the write change the row before the toast shows.
  const toastNo = useRef('');
  const match = useAction('daftra.matchClient', {
    onSuccess: (output) => {
      toast.show({ message: t('daftra.matched', { name: isolate(lang, output.matched.name) }) });
      // A new client means new invoices: the old pick and the open list go.
      setChanging(false);
      setPicked(null);
      setListing(false);
      void read.refetch();
    },
  });
  const linkWrite = useUndoable('payments.linkInvoice', {
    message: () => t('daftra.linkedToast', { no: isolate(lang, toastNo.current) }),
    onSuccess: onDone,
    // The server may refuse an invoice that another payment took in the meantime: read the list again so the sheet shows what Daftra holds now.
    onRefused: () => {
      void read.refetch();
      return false;
    },
  });
  const unlinkWrite = useUndoable('payments.unlinkInvoice', { message: () => t('daftra.unlinkedToast', { no: isolate(lang, toastNo.current) }), onSuccess: onDone });
  const pending = match.isPending || linkWrite.isPending || unlinkWrite.isPending;

  if (!payment) return { part: null, linkShown: false, pending: false };

  const money = (amount: number) => amountText(t, lang, amount);
  const invoiceLine = (invoice: DaftraInvoiceView) => t('daftra.suggested', { no: isolate(lang, invoice.no), amount: money(invoice.total), day: formatDay(invoice.issuedOn, lang) });
  const section = (body: ReactNode) => (
    <section aria-labelledby="payment-daftra" className="mt-4 flex flex-col gap-2 rounded-2xl bg-fill/60 p-4">
      <h3 id="payment-daftra" className={HEADING}>{t('daftra.title')}</h3>
      {body}
    </section>
  );

  // States 5 and 6: the payment carries a link.
  if (linked) {
    const paid = !!payment.receivedOn;
    const differs = !paid && inHalalas(linked.total) !== inHalalas(payment.amount);
    return {
      pending,
      linkShown: false,
      part: section(
        <>
          <p className="tabular text-subheadline text-ink">
            {paid ? t('daftra.paidLine', { no: isolate(lang, linked.invoiceNo) }) : t('daftra.invoicedLine', { no: isolate(lang, linked.invoiceNo) })}
          </p>
          {!paid && <p className="text-footnote text-ink-2">{t('daftra.waiting')}</p>}
          {differs && <p className={`${PRIVATE} tabular text-footnote text-ink-2`}>{t('daftra.differs', { invoice: money(linked.total), payment: money(payment.amount) })}</p>}
          {mayLink && (
            <button
              type="button"
              className={QUIET}
              disabled={busy || pending}
              onClick={() => { toastNo.current = linked.invoiceNo; unlinkWrite.mutate({ id: payment.id }); }}
            >
              {t('daftra.unlink')}
            </button>
          )}
        </>,
      ),
    };
  }

  // States 0 to 4 are only for a holder of the switch, on an open payment, in a copy that has Daftra.
  if (!asking || status.isPending || (status.data && !status.data.ready) || hidden) return { part: null, linkShown: false, pending };
  if (status.error) return { part: section(<LoadFailed query={status} />), linkShown: false, pending };
  if (read.isPending) return { part: section(<p className="text-footnote text-ink-2" role="status">{t('daftra.checking')}</p>), linkShown: false, pending };
  if (read.error && !link) return { part: section(<LoadFailed query={read} />), linkShown: false, pending };
  if (!link) return { part: null, linkShown: false, pending };

  // State 0: no Daftra account for the project.
  if (link.noAccount === 'no_sub_company') return { part: section(<p className="text-subheadline text-ink">{t('daftra.noSubCompany')}</p>), linkShown: false, pending };
  if (link.noAccount) {
    const name = subCompany ? (lang === 'ar' ? subCompany.nameAr : subCompany.name) : '';
    return { part: section(<p className="text-subheadline text-ink">{t('daftra.noAccount', { name: isolate(lang, name) })}</p>), linkShown: false, pending };
  }
  // State 1: the project has no client.
  if (link.projectHasNoClient) return { part: section(<p className="text-subheadline text-ink">{t('daftra.noClient')}</p>), linkShown: false, pending };

  // State 2: the client has no match in Daftra yet, or the person changes the match. No invoice can be linked meanwhile.
  if (link.matched === null || changing) {
    const current = link.matched;
    return {
      pending,
      linkShown: false,
      part: section(
        <>
          <p className="text-subheadline text-ink">{t('daftra.findClient', { name: isolate(lang, defaultName) })}</p>
          {current && (
            <button type="button" className={QUIET} disabled={pending} onClick={() => { setChanging(false); setTyped(null); }}>
              {t('daftra.keepMatch', { name: isolate(lang, current.name) })}
            </button>
          )}
          <TextField id="daftra-search" label={t('daftra.searchLabel')} dir="auto" maxLength={100} value={typed ?? defaultName} onChange={(event) => setTyped(event.target.value)} />
          {found.error && !found.data && <LoadFailed query={found} />}
          {found.isFetching && !found.data && <p className="text-footnote text-ink-2" role="status">{t('daftra.checking')}</p>}
          {found.data && found.data.clients.length === 0 && <p className="text-footnote text-ink-2">{t('daftra.noResults')}</p>}
          {found.data && found.data.clients.length > 0 && (
            <ul className="hairline flex flex-col">
              {found.data.clients.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    aria-label={t('daftra.matchWith', { name: isolate(lang, client.name) })}
                    disabled={busy || pending}
                    onClick={() => match.mutate({ paymentId: payment.id, daftraClientId: client.id })}
                    className="pressable flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-start transition-colors hover:bg-fill disabled:opacity-40"
                  >
                    <bdi className="min-w-0 truncate text-subheadline text-ink">{client.name}</bdi>
                    {client.number && <bdi className="tabular shrink-0 text-footnote text-ink-2">{client.number}</bdi>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>,
      ),
    };
  }

  // States 3 and 4: the client is matched. The list of the other invoices opens from either state.
  const others = link.others.filter((invoice) => invoice.id !== chosen?.id);
  const differs = !!chosen && inHalalas(chosen.total) !== inHalalas(payment.amount);
  const list = listing && (
    <div className="flex flex-col gap-1">
      <p className="text-footnote text-ink-2">{t('daftra.otherTitle')}</p>
      {others.length === 0 && <p className="text-footnote text-ink-2">{t('daftra.noOthers')}</p>}
      {others.length > 0 && (
        <ul className="hairline flex flex-col">
          {others.map((invoice) => (
            <li key={invoice.id}>
              <button
                type="button"
                onClick={() => { setPicked(invoice); setListing(false); }}
                className={`${PRIVATE} pressable tabular flex min-h-11 w-full items-center rounded-xl px-2 py-2 text-start text-subheadline text-ink transition-colors hover:bg-fill`}
              >
                {invoiceLine(invoice)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  const press = () => {
    if (!chosen) return;
    toastNo.current = chosen.no;
    linkWrite.mutate({ id: payment.id, invoiceId: chosen.id });
  };
  return {
    pending,
    linkShown: !!chosen,
    part: section(
      <>
        <p className="text-footnote text-ink-2">{t('daftra.clientLine', { name: isolate(lang, link.matched.name) })}</p>
        <button type="button" className={QUIET} disabled={busy || pending} onClick={() => { setChanging(true); setTyped(null); setListing(false); }}>
          {t('daftra.changeClient')}
        </button>
        {chosen ? (
          <>
            <p className={`${PRIVATE} tabular text-subheadline font-medium text-ink`}>{invoiceLine(chosen)}</p>
            {differs && <p className={`${PRIVATE} tabular text-footnote text-ink-2`}>{t('daftra.differs', { invoice: money(chosen.total), payment: money(payment.amount) })}</p>}
            {/* Link sits here, under the invoice it links, not in the footer: a fifth footer button fell off the sheet (owner, 2026-10-26). */}
            <div className="mt-1">
              <Button variant="primary" disabled={busy || pending || read.isFetching} onClick={press}>{t('daftra.link')}</Button>
            </div>
          </>
        ) : (
          <p className={`${PRIVATE} text-subheadline text-ink`}>{t('daftra.none', { amount: money(payment.amount) })}</p>
        )}
        {!listing && <button type="button" className={QUIET} onClick={() => setListing(true)}>{t(chosen ? 'daftra.chooseAnother' : 'daftra.chooseInvoice')}</button>}
        {list}
      </>,
    ),
  };
}
