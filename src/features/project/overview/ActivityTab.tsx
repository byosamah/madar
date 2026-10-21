import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { FilterButton } from '../../../components/FilterButton';
import { EmptyState } from '../../../components/EmptyState';
import { LoadFailed } from '../../../components/LoadFailed';
import { oneOf } from '../../../lib/params';
import { setFilterParam, type TabProps } from '../tabs';
import { Composer } from './Composer';
import { FeedEntry } from './FeedEntry';

// Decisions sits next to Posts: a decision is a post with the Decision label (owner, 2026-10-03).
const FILTERS = ['all', 'posts', 'decisions', 'tasks', 'files'] as const;
// The API sends the newest items, 50 by default and 200 at most. "Show older" asks for 50 more (audit 2026-10-03, PRJ-5).
const PAGE = 50;
const MOST = 200;
/** The feed choices and the first page, for the reads that the project page starts with projects.get (tabs.tsx, FET-2). */
export { FILTERS as FEED_FILTERS, PAGE as FEED_PAGE };

/** The project's log: posts and system events with a filter, and the composer on top (spec 5.2). The Overview shows the state of the project instead (owner, 2026-10-01). */
export function ActivityTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  // The feed filter lives in the link, so a reload, Back or a trip to another tab keeps it (audit 2026-10-03, PRJ-22).
  const filter = oneOf(params.get('feed'), FILTERS, 'all');
  const setFilter = (value: (typeof FILTERS)[number]) => setFilterParam(setParams, 'feed', value === 'all' ? null : value);
  const openUpdate = params.get('update');
  const [shown, setShown] = useState<{ filter: string; limit: number }>({ filter, limit: PAGE });
  const limit = shown.filter === filter ? shown.limit : PAGE;
  const feed = useCall('updates.list', { projectId: detail.project.id, filter, limit }, { keepPrevious: true });
  const more = Boolean(feed.data && !feed.isPlaceholderData && feed.data.length >= limit && limit < MOST);
  // A link to an older post (from a mention) loads older items until the post shows.
  const missing = Boolean(openUpdate && feed.data && !feed.isPlaceholderData && !feed.data.some((item) => item.id === openUpdate));
  useEffect(() => {
    if (missing && more) setShown({ filter, limit: Math.min(MOST, limit + PAGE) });
  }, [missing, more, filter, limit]);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <section aria-label={t('overview.feed')} className="flex min-w-0 flex-col gap-4">
        {detail.viewerCan.postUpdate ? <Composer detail={detail} /> : <p className="text-footnote text-label-2">{t('overview.cannotPost')}</p>}
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
              people={detail.members.map((member) => member.user)}
              canPost={detail.viewerCan.comment === true}
              canAttach={detail.viewerCan.upload === true}
              startOpen={item.id === openUpdate}
            />
          ))}</ol>}
        {more && (
          <Button variant="plain" className="self-center" disabled={feed.isFetching} onClick={() => setShown({ filter, limit: Math.min(MOST, limit + PAGE) })}>
            {t('overview.showOlder')}
          </Button>
        )}
      </section>
    </div>
  );
}
