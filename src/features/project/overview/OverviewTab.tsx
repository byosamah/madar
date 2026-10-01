import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCall } from '../../../app/runtime';
import { FilterButton } from '../../../components/FilterButton';
import { EmptyState } from '../../../components/EmptyState';
import type { TabProps } from '../tabs';
import { AboutPanel } from './AboutPanel';
import { Composer } from './Composer';
import { FeedEntry } from './FeedEntry';

const FILTERS = ['all', 'posts', 'tasks', 'files'] as const;

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label={t('overview.feed')} className="flex min-w-0 flex-col gap-4">
        {detail.viewerCan.post ? <Composer detail={detail} /> : <p className="text-footnote text-label-2">{t('overview.cannotPost')}</p>}
        <div>
          <FilterButton label={t('filter.label')} count={filter === 'all' ? 0 : 1}>
            <fieldset className="flex flex-col">
              <legend className="pb-1 text-footnote font-semibold text-ink-2">{t('overview.feed')}</legend>
              {FILTERS.map((value) => (
                <label key={value} className="flex min-h-11 items-center gap-3 text-body text-ink">
                  <input type="radio" name="feed-show" checked={filter === value} onChange={() => setFilter(value)} className="size-5 accent-[var(--sig-from)]" />
                  {t(`overview.feedFilter.${value}`)}
                </label>
              ))}
            </fieldset>
          </FilterButton>
        </div>
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
      <aside className="min-w-0"><AboutPanel detail={detail} /></aside>
    </div>
  );
}
