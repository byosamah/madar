import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../app/lang';
import { LoadFailed } from '../../components/LoadFailed';
import { formatNumber } from '../../lib/dates';
import { usePlatform } from './usePlatform';

const BARS = ['requests', 'rowsRead', 'rowsWritten', 'mails'] as const;

/** A part of 100, whole, never above 100 for the width of a bar. */
const percentOf = (used: number, limit: number) => (limit <= 0 ? 0 : Math.floor((used / limit) * 100));

/**
 * Today's use of the free day limits of the whole account (design G8): four bars, a calm line for each limit at 70 percent or more, and one
 * line when the account reached the stop line. It shows counts only, never a record of an enterprise.
 */
export function MeterStrip() {
  const { t } = useTranslation();
  const lang = useLang();
  const platform = usePlatform();
  const meter = useQuery({ queryKey: ['platform', 'meter'], queryFn: () => platform['platform.meter.get']({}), refetchInterval: 5 * 60_000 });
  if (meter.isPending) return null;
  if (meter.isError) return <LoadFailed query={meter} />;
  const { total, limits, warn, stop } = meter.data;
  return (
    <section aria-labelledby="meter-title" className="surface flex flex-col gap-4 rounded-card p-5">
      <h2 id="meter-title" className="text-headline text-ink">{t('enterprises.meter.title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BARS.map((key) => {
          const percent = percentOf(total[key], limits[key]);
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-subheadline text-ink">{t(`enterprises.meter.${key}`)}</span>
                <span className="text-footnote text-ink-2">{t('enterprises.meter.of', { used: formatNumber(total[key], lang), limit: formatNumber(limits[key], lang) })}</span>
              </div>
              <span role="progressbar" aria-label={t(`enterprises.meter.${key}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)} className="block h-1.5 overflow-hidden rounded-full bg-fill">
                <span className={`block h-full rounded-full ${warn.includes(key) ? 'bg-late' : 'bg-ink-2'}`} style={{ width: `${Math.min(100, percent)}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      {warn.map((key) => (
        <p key={key} className="text-subheadline text-late">
          {t('enterprises.meter.warn', { limit: t(`enterprises.meter.${key}`), percent: percentOf(total[key as (typeof BARS)[number]], limits[key as (typeof BARS)[number]]) })}
        </p>
      ))}
      {stop && <p className="text-subheadline text-late">{t('enterprises.meter.stop')}</p>}
    </section>
  );
}
