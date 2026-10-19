import { lazy, Suspense, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeoPoint } from '../../api/contract/entities';
import type { ProjectSummary } from '../../api/contract/views';
import { useAction, useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { ProjectTile } from '../../components/ProjectTile';
import { Sheet } from '../../components/Sheet';
import { projectKey } from '../../lib/projectCode';
import { PinPicker } from '../map/PinPicker';
import { MapPinCard } from './MapPinCard';
import type { DashboardFilters } from './Tiles';

// The street map loads in the real build only. The flag is folded here, as in PinPicker.tsx, so the prototype keeps no map code (fbk_017).
const MapCanvas = import.meta.env.VITE_MADAR_API === 'remote' ? lazy(() => import('../map/MapCanvas')) : null;

/**
 * The Map section of the Dashboard (owner, 2026-10-18, fbk_017). Each active project with a pin shows on the map. The list beside
 * the map (under it on a phone) reaches each pin by keyboard. The projects with no pin wait in a list, and a person who may edit
 * a project sets its pin in a sheet. The Leader, Client and Team filters apply, as to every number of the Dashboard.
 */
export function DashboardMap({ filters }: { filters: DashboardFilters }) {
  const { t } = useTranslation();
  const headingId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [unpinnedOpen, setUnpinnedOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [draft, setDraft] = useState<GeoPoint | null>(null);
  const projects = useCall('projects.list', { status: 'active', sort: 'name', ...filters });
  const save = useAction('projects.update', {
    onSuccess: () => {
      setEditing(null);
      setDraft(null);
    },
  });
  const rows = projects.data ?? [];
  const pinned = rows.flatMap((row) => (row.geo ? [{ row, point: row.geo }] : []));
  const unpinned = rows.filter((row) => row.geo === null);
  const current = pinned.find((item) => item.row.project.id === selected);
  const pins = pinned.map(({ row, point }) => ({ id: row.project.id, point, label: row.project.name }));

  return (
    <div className="flex flex-col gap-4">
      {!MapCanvas && <p className="text-subheadline text-ink-2">{t('map.dashboard.note')}</p>}
      {projects.data && rows.length === 0 && <p className="text-subheadline text-ink-2">{t('map.dashboard.none')}</p>}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {MapCanvas && (
              <Suspense fallback={<div className="h-80" />}>
                <MapCanvas pins={pins} onPinClick={setSelected} fitTo="pins" />
              </Suspense>
            )}
            {current && <MapPinCard summary={current.row} />}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={headingId} className="pb-1 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2">{t('map.dashboard.pinned')}</h2>
            {pinned.length === 0 ? (
              <p className="text-subheadline text-ink-2">{t('map.dashboard.pinnedNone')}</p>
            ) : (
              <ul aria-labelledby={headingId} className="hairline flex flex-col">
                {pinned.map(({ row }) => (
                  <li key={row.project.id}>
                    <button
                      type="button"
                      aria-pressed={selected === row.project.id}
                      onClick={() => setSelected(row.project.id)}
                      className="pressable flex min-h-14 w-full items-center gap-3 py-2 text-start hover:bg-fill/50"
                    >
                      <ProjectTile id={row.project.id} mark={row.project.mark} size={28} subCompanyId={row.subCompanyId} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <bdi dir="auto" className="break-words text-subheadline font-semibold text-ink">{row.project.name}</bdi>
                        <span dir="ltr" className="tabular text-footnote text-ink-2">{projectKey(row.project.code)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {unpinned.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button className="self-start" aria-expanded={unpinnedOpen} onClick={() => setUnpinnedOpen((open) => !open)}>
            {t('map.dashboard.noPin', { n: unpinned.length })}
          </Button>
          {unpinnedOpen && (
            <ul className="hairline flex flex-col">
              {unpinned.map((row) => (
                <li key={row.project.id} className="flex min-h-14 items-center gap-3 py-2">
                  <ProjectTile id={row.project.id} mark={row.project.mark} size={28} subCompanyId={row.subCompanyId} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <bdi dir="auto" className="break-words text-subheadline font-semibold text-ink">{row.project.name}</bdi>
                    <span dir="ltr" className="tabular text-footnote text-ink-2">{projectKey(row.project.code)}</span>
                  </span>
                  {row.viewerCan.edit && (
                    <Button
                      aria-label={t('map.dashboard.setPinFor', { name: row.project.name })}
                      onClick={() => {
                        setDraft(null);
                        setEditing(row);
                      }}
                    >
                      {t('map.pin.set')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={t('map.pinSheet.title')}
        description={editing?.project.name}
        footer={(
          <>
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={draft === null || save.isPending}
              onClick={() => {
                if (editing && draft) save.mutate({ id: editing.project.id, patch: { geo: draft } });
              }}
            >
              {t('map.dashboard.save')}
            </Button>
          </>
        )}
      >
        {editing && <PinPicker value={draft} onChange={setDraft} />}
      </Sheet>
    </div>
  );
}
