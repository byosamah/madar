import type { TFunction } from 'i18next';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { PaymentRow } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { PRIVATE } from '../../../app/privateMark';
import { useCall } from '../../../app/runtime';
import { useRight } from '../../../app/useRight';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { LoadFailed } from '../../../components/LoadFailed';
import { StatusSign } from '../../../components/StatusSign';
import { formatDay, formatNumber, type Lang } from '../../../lib/dates';
import { PAYMENT_PANEL, usePanelLink } from '../panelLink';
import { PaymentSheet, type PaymentDraft } from './PaymentSheet';

/** "SAR 120,000" in English and "120,000 ر.س" in Arabic. Madar writes Western digits in both. */
export function amountText(t: TFunction, lang: Lang, amount: number): string {
  return t('payments.amount', { n: formatNumber(amount, lang, amount % 1 === 0 ? 0 : 2) });
}

/** The sign of a milestone: a check with the day it arrived, a quiet "Awaiting", or the late sign. */
export function PaymentSign({ row }: { row: PaymentRow }) {
  const { t } = useTranslation();
  const lang = useLang();
  if (row.status === 'received' && row.payment.receivedOn) {
    return <StatusSign state="completed">{t('payments.status.received', { date: formatDay(row.payment.receivedOn, lang) })}</StatusSign>;
  }
  return <StatusSign state={row.status === 'overdue' ? 'late' : 'active'}>{t(`payments.status.${row.status === 'overdue' ? 'overdue' : 'awaiting'}`)}</StatusSign>;
}

const HEADING = 'text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2';

/**
 * The payment milestones of a project (colleague comment 6). Only the Admin, Management and Accounting see this panel;
 * the page does not draw it for anyone else and payments.list refuses them. A row opens the sheet through the "payment" address part.
 */
export function PaymentsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [params] = useSearchParams();
  const list = useCall('payments.list', { projectId });
  // Add payment needs payment.add (role rights version 2). The sheet asks the other money switches for itself.
  const mayAdd = useRight('payment.add');
  const rows = list.data ?? [];
  const openId = params.get('payment');
  // Open adds one history step and Close goes back over it, so a sheet costs no extra Back (audit 2026-10-03, PRJ-9, V-36).
  const panel = usePanelLink(PAYMENT_PANEL);
  // What a person typed in a payment sheet and did not save, for as long as this panel lives (audit 2026-10-03, F-17).
  const drafts = useRef(new Map<string, PaymentDraft>());
  const setOpen = (id: string | null) => (id ? panel.open({ payment: id }) : panel.close());
  const total = rows.reduce((sum, row) => sum + row.payment.amount, 0);
  const received = rows.filter((row) => row.status === 'received').reduce((sum, row) => sum + row.payment.amount, 0);
  const open = openId === 'new' ? null : rows.find((row) => row.payment.id === openId);
  return (
    <section aria-labelledby="overview-payments" className="panel flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="overview-payments" className={HEADING}>{t('payments.title')}</h2>
          {rows.length > 0 && (
            <p className={`${PRIVATE} tabular pt-1 text-footnote text-ink-2`}>{t('payments.summary', { received: amountText(t, lang, received), total: amountText(t, lang, total) })}</p>
          )}
        </div>
        {mayAdd && (
          <Button onClick={() => setOpen('new')}>
            <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
            {t('payments.add')}
          </Button>
        )}
      </div>
      {/* A list that did not load says so and offers Retry (audit 2026-10-03, PRJ-4). */}
      <LoadFailed query={list} />
      {list.data && rows.length === 0 && <p className="text-subheadline text-ink-2">{t('payments.empty')}</p>}
      {rows.length > 0 && (
        <ul className="hairline -mx-2 flex flex-col">
          {rows.map((row) => (
            <li key={row.payment.id}>
              <button
                type="button"
                aria-label={t('payments.open', { name: row.payment.name })}
                onClick={() => setOpen(row.payment.id)}
                className="pressable flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors hover:bg-fill/50"
              >
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate text-subheadline font-medium text-ink">{row.payment.name}</bdi>
                  <span className="tabular block text-footnote text-ink-2">{t('payments.due', { date: formatDay(row.payment.dueDate, lang) })}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`${PRIVATE} tabular text-subheadline font-semibold text-ink`}>{amountText(t, lang, row.payment.amount)}</span>
                  <PaymentSign row={row} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId === 'new' && mayAdd && <PaymentSheet key="new" projectId={projectId} row={null} onClose={() => setOpen(null)} drafts={drafts.current} />}
      {open && <PaymentSheet key={open.payment.id} projectId={projectId} row={open} onClose={() => setOpen(null)} drafts={drafts.current} />}
    </section>
  );
}
