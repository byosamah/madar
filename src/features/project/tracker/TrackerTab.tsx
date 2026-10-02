import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRACKER_TYPES, TrackerDirection as Sides, type TrackerDirection, type TrackerType } from '../../../api/contract/entities';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { FilterButton } from '../../../components/FilterButton';
import { LoadFailed } from '../../../components/LoadFailed';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { DownloadIcon } from '../../../components/icons/animated/download';
import type { TabProps } from '../tabs';
import { EntrySheet } from './EntrySheet';
import { ExportSheet } from './ExportSheet';
import { History } from './History';
import { OpenLoops } from './OpenLoops';
import { QuickLog } from './QuickLog';

type Filter = { type: TrackerType | 'all'; direction: TrackerDirection | 'all'; openOnly: boolean };
const NO_FILTER: Filter = { type: 'all', direction: 'all', openOnly: false };

function Choice({ name, value, checked, label, onChange }: { name: string; value: string; checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-body text-ink">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="size-5 accent-[var(--sig-from)]" />
      {label}
    </label>
  );
}

/** The record of every exchange with the client (owner, 2026-10-01): open loops on top, a one-line log, then the history by week. */
export function TrackerTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const projectId = detail.project.id;
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const open = useCall('tracker.list', { projectId, openOnly: true });
  const history = useCall('tracker.list', {
    projectId,
    ...(filter.type !== 'all' && { type: filter.type }),
    ...(filter.direction !== 'all' && { direction: filter.direction }),
    ...(filter.openOnly && { openOnly: true }),
  });
  const active = [filter.type !== 'all', filter.direction !== 'all', filter.openOnly].filter(Boolean).length;
  const shown = [...(history.data ?? []), ...(open.data ?? [])].find((row) => row.entry.id === openId);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* A list that did not load says so and offers Retry (audit 2026-10-03, PRJ-4). */}
      {open.error && !open.data ? <LoadFailed error={open.error} onRetry={() => void open.refetch()} /> : <OpenLoops rows={open.data ?? []} onOpen={setOpenId} />}
      {detail.viewerCan.post ? <QuickLog projectId={projectId} members={detail.members.map((member) => member.user)} /> : <p className="text-footnote text-label-2">{t('tracker.cannotLog')}</p>}
      <section aria-label={t('tracker.history')} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterButton label={t('filter.label')} count={active}>
            <div className="flex flex-col gap-3">
              <fieldset className="flex flex-col">
                <legend className="pb-1 text-footnote font-semibold text-ink-2">{t('tracker.typeLabel')}</legend>
                <Choice name="tracker-type" value="all" checked={filter.type === 'all'} label={t('tracker.filterAll')} onChange={() => setFilter({ ...filter, type: 'all' })} />
                {TRACKER_TYPES.map((value) => (
                  <Choice key={value} name="tracker-type" value={value} checked={filter.type === value} label={t(`tracker.type.${value}`)} onChange={() => setFilter({ ...filter, type: value })} />
                ))}
              </fieldset>
              <fieldset className="flex flex-col">
                <legend className="pb-1 text-footnote font-semibold text-ink-2">{t('tracker.directionLabel')}</legend>
                <Choice name="tracker-direction" value="all" checked={filter.direction === 'all'} label={t('tracker.filterAll')} onChange={() => setFilter({ ...filter, direction: 'all' })} />
                {Sides.options.map((value) => (
                  <Choice key={value} name="tracker-direction" value={value} checked={filter.direction === value} label={t(`tracker.direction.${value}`)} onChange={() => setFilter({ ...filter, direction: value })} />
                ))}
              </fieldset>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="checkbox" checked={filter.openOnly} onChange={(event) => setFilter({ ...filter, openOnly: event.target.checked })} className="size-5 accent-[var(--sig-from)]" />
                {t('tracker.openOnly')}
              </label>
            </div>
          </FilterButton>
          <Button onClick={() => setExporting(true)}>
            <AnimatedIcon icon={DownloadIcon} size={16} aria-hidden />
            {t('tracker.export.button')}
          </Button>
        </div>
        {history.error && !history.data ? <LoadFailed error={history.error} onRetry={() => void history.refetch()} />
          : history.data && history.data.length === 0
          ? active > 0
            ? <p className="text-subheadline text-ink-2">{t('tracker.emptyFilter')}</p>
            : <EmptyState title={t('tracker.emptyTitle')} body={t('tracker.empty')} />
          : <History rows={history.data ?? []} onOpen={setOpenId} />}
      </section>
      {exporting && (
        <ExportSheet
          projectId={projectId}
          code={detail.project.code}
          type={filter.type === 'all' ? undefined : filter.type}
          side={filter.direction === 'all' ? undefined : filter.direction}
          onClose={() => setExporting(false)}
        />
      )}
      {shown && <EntrySheet key={shown.entry.id} row={shown} detail={detail} onClose={() => setOpenId(null)} />}
    </div>
  );
}
