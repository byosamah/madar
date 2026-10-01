import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { useLang } from '../../app/lang';
import { Avatar } from '../../components/Avatar';
import { Sheet } from '../../components/Sheet';
import { addDays, formatNumber, todayISO } from '../../lib/dates';

export type DashboardData = CallOutput<'dashboard.get'>;

function HoursSheet({ open, onOpenChange, view }: { open: boolean; onOpenChange: (open: boolean) => void; view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { perProject, perPerson } = view.hoursThisWeek;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('dashboard.hoursSheet')}>
      <div className="flex flex-col gap-4 pt-1">
        <section className="flex flex-col gap-1">
          <h3 className="text-headline">{t('dashboard.perProject')}</h3>
          {perProject.length === 0 ? <p className="text-footnote text-label-2">{t('dashboard.noData')}</p> : (
            <ul>
              {perProject.map((row) => (
                <li key={row.projectId} className="flex min-h-11 items-center gap-3">
                  <span className="tabular text-footnote text-label-2">{row.code}</span>
                  <bdi className="min-w-0 flex-1 truncate">{row.name}</bdi>
                  <span className="tabular">{t('dashboard.hoursValue', { n: formatNumber(row.hours, lang, 1) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {perPerson && (
          <section className="flex flex-col gap-1">
            <h3 className="text-headline">{t('dashboard.perPerson')}</h3>
            <ul>
              {perPerson.map((row) => (
                <li key={row.user.id} className="flex min-h-11 items-center gap-3">
                  <Avatar user={row.user} size={28} />
                  <bdi className="min-w-0 flex-1 truncate">{row.user.name}</bdi>
                  <span className={`tabular ${row.hours < row.target ? 'text-orange-text' : ''}`}>
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

/** Six numbers, each a way into the list behind it (spec 8.2). */
export function Tiles({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const [hoursOpen, setHoursOpen] = useState(false);
  const today = todayISO();
  const { tiles } = view;
  const items: { key: string; value: string; detail?: string; open: () => void }[] = [
    { key: 'activeProjects', value: formatNumber(tiles.activeProjects, lang), open: () => navigate('/projects?status=active') },
    { key: 'atRiskOrLate', value: formatNumber(tiles.atRiskOrLate, lang), open: () => navigate('/projects?filter=at_risk') },
    { key: 'overdueTasks', value: formatNumber(tiles.overdueTasks, lang), open: () => navigate('/tasks?filter=overdue') },
    { key: 'deadlines', value: formatNumber(tiles.deadlinesNext14, lang), open: () => navigate(`/tasks?mode=deadlines&from=${today}&to=${addDays(today, 14)}`) },
    {
      key: 'officeHours',
      value: t('dashboard.percent', { n: formatNumber(tiles.officeHours.percent, lang) }),
      detail: t('dashboard.hoursOf', { hours: formatNumber(tiles.officeHours.hours, lang, 1), target: formatNumber(tiles.officeHours.target, lang) }),
      open: () => setHoursOpen(true),
    },
    { key: 'area', value: t('dashboard.areaValue', { n: formatNumber(tiles.areaInDesign, lang) }), open: () => navigate('/projects?status=active') },
  ];
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" onClick={item.open} className="pressable surface flex h-full w-full flex-col items-start gap-1 rounded-card p-4 text-start">
              <span className="text-footnote text-label-2">{t(`dashboard.tiles.${item.key}`)}</span>
              <span className="tabular text-title-1">{item.value}</span>
              {item.detail && <span className="tabular text-footnote text-label-2">{item.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
      <HoursSheet open={hoursOpen} onOpenChange={setHoursOpen} view={view} />
    </>
  );
}
