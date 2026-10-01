import { useTranslation } from 'react-i18next';
import type { CallOutput } from '../../api/calls';
import { useLang } from '../../app/lang';
import { Avatar } from '../../components/Avatar';
import { Sheet } from '../../components/Sheet';
import { formatNumber } from '../../lib/dates';

export type DashboardData = CallOutput<'dashboard.get'>;

export function HoursSheet({ open, onOpenChange, view }: { open: boolean; onOpenChange: (open: boolean) => void; view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { perProject, perPerson } = view.hoursThisWeek;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('dashboard.hoursSheet')}>
      <div className="flex flex-col gap-4 pt-1">
        <section className="flex flex-col gap-1">
          <h3 className="text-headline text-ink">{t('dashboard.perProject')}</h3>
          {perProject.length === 0 ? <p className="text-footnote text-ink-2">{t('dashboard.noData')}</p> : (
            <ul>
              {perProject.map((row) => (
                <li key={row.projectId} className="flex min-h-11 items-center gap-3">
                  <span className="tabular text-footnote text-ink-2">{row.code}</span>
                  <bdi className="min-w-0 flex-1 truncate">{row.name}</bdi>
                  <span className="tabular">{t('dashboard.hoursValue', { n: formatNumber(row.hours, lang, 1) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {perPerson && (
          <section className="flex flex-col gap-1">
            <h3 className="text-headline text-ink">{t('dashboard.perPerson')}</h3>
            <ul>
              {perPerson.map((row) => (
                <li key={row.user.id} className="flex min-h-11 items-center gap-3">
                  <Avatar user={row.user} size={28} />
                  <bdi className="min-w-0 flex-1 truncate">{row.user.name}</bdi>
                  <span className={`tabular ${row.hours < row.target ? 'text-attn' : ''}`}>
                    {t('dashboard.hoursOf', { hours: formatNumber(row.hours, lang, 1), target: formatNumber(row.target, lang) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
