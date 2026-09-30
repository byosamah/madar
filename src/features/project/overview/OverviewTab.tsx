import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { Avatar } from '../../../components/Avatar';
import { ChipGroup } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { formatDay, formatNumber, todayISO } from '../../../lib/dates';
import type { TabProps } from '../tabs';
import { Composer } from './Composer';
import { FeedEntry } from './FeedEntry';

const FILTERS = ['all', 'posts', 'tasks', 'files'] as const;

function SideColumn({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const today = todayISO();
  const next = detail.deadlines.filter((deadline) => deadline.date >= today).slice(0, 3);
  const none = t('overview.none');
  const facts: [string, ReactNode][] = [
    [t('projectForm.location'), project.location || none],
    [t('projectForm.area'), project.areaM2 === null ? none : formatNumber(project.areaM2, lang)],
    [t('projectForm.startDate'), project.startDate ? formatDay(project.startDate, lang, 'long') : none],
    [t('projectForm.endDate'), project.targetEndDate ? formatDay(project.targetEndDate, lang, 'long') : none],
    [t('projectForm.modelFolder'), project.modelFolderPath ? <bdi dir="ltr" className="break-all text-footnote">{project.modelFolderPath}</bdi> : none],
  ];
  return (
    <aside className="flex flex-col gap-4">
      <section className="surface rounded-card p-4">
        <h2 className="text-headline">{t('overview.facts')}</h2>
        <dl className="mt-2 flex flex-col gap-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-footnote text-label-2">{label}</dt>
              <dd dir="auto" className="tabular text-subheadline">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="surface rounded-card p-4">
        <h2 className="text-headline">{t('overview.deadlines')}</h2>
        {next.length === 0 ? <p className="mt-2 text-footnote text-label-2">{t('overview.noDeadlines')}</p> : (
          <ul className="mt-2 flex flex-col gap-2">
            {next.map((deadline) => (
              <li key={deadline.id} className="flex items-baseline justify-between gap-3 text-subheadline">
                <bdi className="min-w-0 truncate">{deadline.name}</bdi>
                <span className="tabular shrink-0 text-label-2">{formatDay(deadline.date, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="surface rounded-card p-4">
        <h2 className="text-headline">{t('overview.team')}</h2>
        <ul className="mt-1 flex flex-col">
          {detail.members.map((member) => (
            <li key={member.user.id} className="flex min-h-11 items-center gap-2">
              <Avatar user={member.user} size={28} />
              <bdi className="min-w-0 truncate text-subheadline">{member.user.name}</bdi>
              <span className="ms-auto shrink-0 text-footnote text-label-2">{member.isLeader ? t('team.leader') : member.discipline}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

/** Posts and system events with a filter, the composer on top, and the key facts beside (spec 5.2). */
export function OverviewTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [params] = useSearchParams();
  const openUpdate = params.get('update');
  const feed = useCall('updates.list', { projectId: detail.project.id, filter });
  const files = useCall('files.list', { projectId: detail.project.id });
  const fileNames = new Map((files.data ?? []).map((view) => [view.file.id, view.file.name]));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label={t('overview.feed')} className="flex min-w-0 flex-col gap-4">
        {detail.viewerCan.post ? <Composer detail={detail} /> : <p className="text-footnote text-label-2">{t('overview.cannotPost')}</p>}
        <ChipGroup label={t('overview.feed')} value={filter} onChange={setFilter} options={FILTERS.map((value) => ({ value, label: t(`overview.feedFilter.${value}`) }))} />
        {feed.data && feed.data.length === 0
          ? <EmptyState title={t('overview.feed')} body={t('overview.emptyFeed')} />
          : <ol className="flex flex-col gap-3">{(feed.data ?? []).map((item) => (
            <FeedEntry
              key={item.id}
              item={item}
              fileNames={fileNames}
              people={detail.members.map((member) => member.user)}
              canPost={detail.viewerCan.post}
              startOpen={item.id === openUpdate}
            />
          ))}</ol>}
      </section>
      <SideColumn detail={detail} />
    </div>
  );
}
