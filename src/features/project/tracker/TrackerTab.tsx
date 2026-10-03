import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { TRACKER_TYPES, TrackerDirection as Sides, type TrackerDirection, type TrackerType } from '../../../api/contract/entities';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { FilterButton } from '../../../components/FilterButton';
import { LoadFailed } from '../../../components/LoadFailed';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { DownloadIcon } from '../../../components/icons/animated/download';
import { oneOf } from '../../../lib/params';
import { activeMembers } from '../../../lib/tracker';
import { ENTRY_PANEL, usePanelLink } from '../panelLink';
import { setFilterParam, type TabProps } from '../tabs';
import { EntrySheet } from './EntrySheet';
import { ExportSheet } from './ExportSheet';
import { History } from './History';
import { OpenLoops } from './OpenLoops';
import { QuickLog } from './QuickLog';

type Filter = { type: TrackerType | 'all'; direction: TrackerDirection | 'all'; openOnly: boolean };
const TYPES = ['all', ...TRACKER_TYPES] as const;
const SIDES = ['all', ...Sides.options] as const;

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
  const [params, setParams] = useSearchParams();
  // The filter lives in the link, so a reload, Back or a trip to another tab keeps it (audit 2026-10-03, PRJ-22).
  const filter: Filter = {
    type: oneOf(params.get('type'), TYPES, 'all'),
    direction: oneOf(params.get('side'), SIDES, 'all'),
    openOnly: params.get('open') === '1',
  };
  const setFilter = (next: Filter) => {
    if (next.type !== filter.type) setFilterParam(setParams, 'type', next.type === 'all' ? null : next.type);
    if (next.direction !== filter.direction) setFilterParam(setParams, 'side', next.direction === 'all' ? null : next.direction);
    if (next.openOnly !== filter.openOnly) setFilterParam(setParams, 'open', next.openOnly ? '1' : null);
  };
  // The open entry lives in the link too, so the Overview can open one entry (audit 2026-10-03, PRJ-19). Open adds one
  // history step and Close goes back over it, so an entry costs no extra Back (audit 2026-10-03, S-1).
  const openId = params.get('entry');
  const panel = usePanelLink(ENTRY_PANEL);
  const setOpenId = (id: string | null) => (id ? panel.open({ entry: id }) : panel.close());
  // The Overview opens an entry here, and its opener is then gone. So when an entry closes and the focus is not on this tab,
  // the focus goes to the entry's row, or to the Tracker tab itself, never to the page (audit 2026-10-03, V-30). The timer
  // runs after the sheet gave the focus back to its opener, when that opener is still on the page.
  const root = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<string | null>(null);
  useEffect(() => {
    if (openId) {
      lastOpen.current = openId;
      return undefined;
    }
    const closed = lastOpen.current;
    lastOpen.current = null;
    if (!closed) return undefined;
    const timer = window.setTimeout(() => {
      const here = root.current;
      if (!here || here.contains(document.activeElement)) return;
      const tab = document.getElementById(here.closest('[role="tabpanel"]')?.getAttribute('aria-labelledby') ?? '');
      (here.querySelector<HTMLElement>(`[data-entry="${closed}"]`) ?? tab)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openId]);
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
    <div ref={root} className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* A list that did not load says so and offers Retry (audit 2026-10-03, PRJ-4). */}
      {open.error && !open.data ? <LoadFailed error={open.error} onRetry={() => void open.refetch()} /> : <OpenLoops rows={open.data ?? []} onOpen={setOpenId} />}
      {detail.viewerCan.post ? <QuickLog projectId={projectId} members={activeMembers(detail.members)} /> : <p className="text-footnote text-label-2">{t('tracker.cannotLog')}</p>}
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
