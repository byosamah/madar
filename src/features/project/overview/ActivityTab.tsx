import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCall } from '../../../app/runtime';
import { FilterButton } from '../../../components/FilterButton';
import { EmptyState } from '../../../components/EmptyState';
import { LoadFailed } from '../../../components/LoadFailed';
import { oneOf } from '../../../lib/params';
import { setFilterParam, type TabProps } from '../tabs';
import { Composer } from './Composer';
import { FeedEntry } from './FeedEntry';

// Decisions sits next to Posts: a decision is a post with the Decision label (owner, 2026-10-03).
const FILTERS = ['all', 'posts', 'decisions', 'tasks', 'files'] as const;

/** The project's log: posts and system events with a filter, and the composer on top (spec 5.2). The Overview shows the state of the project instead (owner, 2026-10-01). */
export function ActivityTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  // The feed filter lives in the link, so a reload, Back or a trip to another tab keeps it (audit 2026-10-03, PRJ-22).
  const filter = oneOf(params.get('feed'), FILTERS, 'all');
  const setFilter = (value: (typeof FILTERS)[number]) => setFilterParam(setParams, 'feed', value === 'all' ? null : value);
  const openUpdate = params.get('update');
  const feed = useCall('updates.list', { projectId: detail.project.id, filter });
  const files = useCall('files.list', { projectId: detail.project.id });
  // Until the file list loads, a post shows no file chips rather than "File removed" (audit 2026-10-03, PRJ-6).
  const fileNames = files.data ? new Map(files.data.map((view) => [view.file.id, view.file.name])) : undefined;
  return (
    <div className="mx-auto w-full max-w-3xl">
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
        {/* A feed that did not load says so and offers Retry (audit 2026-10-03, PRJ-4). */}
        {feed.error && !feed.data ? <LoadFailed error={feed.error} onRetry={() => void feed.refetch()} />
          : feed.data && feed.data.length === 0
          ? <EmptyState title={t('overview.feed')} body={t(filter === 'decisions' ? 'overview.emptyDecisions' : 'overview.emptyFeed')} />
          : <ol className="flex flex-col gap-3">{(feed.data ?? []).map((item) => (
            <FeedEntry
              key={item.id}
              item={item}
              projectId={detail.project.id}
              fileNames={fileNames}
              people={detail.members.map((member) => member.user)}
              canPost={detail.viewerCan.post}
              startOpen={item.id === openUpdate}
            />
          ))}</ol>}
      </section>
    </div>
  );
}
