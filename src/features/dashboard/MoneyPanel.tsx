import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { formatDay } from '../../lib/dates';
import { counted } from '../../lib/grammar';
import { projectKey } from '../../lib/projectCode';
import { PRIVATE } from '../../app/privateMark';
import { amountText } from '../project/payments/PaymentsPanel';
import type { DashboardData } from './Tiles';

type Money = NonNullable<DashboardData['money']>;

const HEADING = 'text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2';

/** One row of the panel: its name, how many and how much, then each payment. A payment opens in its project. */
function MoneyRow({ label, rows, late }: { label: string; rows: Money['pastDue']; late: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const id = useId();
  const summary = `${counted(t, 'dashboard.money.count', rows.count)}${rows.count > 0 ? ` · ${amountText(t, lang, rows.total)}` : ''}`;
  return (
    <li className="flex flex-col py-2">
      <p id={id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
        <span className="text-subheadline font-semibold text-ink">{label}</span>
        <span className={`${PRIVATE} tabular text-subheadline ${late && rows.count > 0 ? 'font-semibold text-attn' : 'text-ink-2'}`}>{summary}</span>
      </p>
      {rows.count > 0 && (
        <ul aria-labelledby={id} className="flex flex-col">
          {rows.payments.map((payment) => (
            <li key={payment.id}>
              <Link to={`/projects/${payment.projectId}?payment=${payment.id}`} className="pressable flex min-h-14 items-center gap-3 rounded-xl py-2 text-start hover:bg-fill/50">
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate text-subheadline text-ink">{payment.name}</bdi>
                  <span className="tabular block truncate text-footnote text-ink-2">
                    <bdi>{projectKey(payment.projectCode)}</bdi> · {t('payments.due', { date: formatDay(payment.dueDate, lang) })}
                  </span>
                </span>
                <span className={`${PRIVATE} tabular shrink-0 text-subheadline text-ink`}>{amountText(t, lang, payment.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The payments that clients owe the office: past due, and due in the next 30 days (owner, 2026-10-06). The server sends them only
 * to the people who may handle payments; for anyone else the field is null, so the panel is not there. It also stays away when
 * nothing is owed.
 */
export function MoneyPanel({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const id = useId();
  const { money } = view;
  if (!money || money.pastDue.count + money.next30.count === 0) return null;
  return (
    <section aria-labelledby={id} className="panel flex flex-col gap-1 p-5">
      <h2 id={id} className={`${HEADING} pb-1`}>{t('dashboard.money.title')}</h2>
      <ul className="hairline flex flex-col">
        <MoneyRow label={t('dashboard.money.pastDue')} rows={money.pastDue} late />
        <MoneyRow label={t('dashboard.money.next30')} rows={money.next30} late={false} />
      </ul>
    </section>
  );
}
