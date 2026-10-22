import { Suspense, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { useIsPhone } from '../../app/useIsPhone';
import { Button } from '../../components/Button';
import { ProjectTile } from '../../components/ProjectTile';
import { Sheet } from '../../components/Sheet';
import { projectKey } from '../../lib/projectCode';
import { lazyMapCanvas } from '../map/mapLib';
import { PinSheet } from '../map/PinSheet';
import { ProjectPin } from '../map/ProjectPin';
import { isLive } from '../../lib/overview';
import { MapPinCard } from './MapPinCard';
import type { DashboardFilters } from './Tiles';

// The street map loads in the real build only. The flag is folded here, as in PinPicker.tsx, so the prototype keeps no map code (fbk_017).
const MapCanvas = import.meta.env.VITE_MADAR_API === 'remote' ? lazyMapCanvas() : null;

/**
 * The Map section of the Dashboard (owner, 2026-10-18, fbk_017). Each active project with a pin shows on the map as its own
 * picture tile; a late or at-risk project carries the status shape (PRJ-14). A press on a pin opens its card next to it on a computer,
 * and in a short sheet on a phone, or when the map did not load. The list beside the map (under it on a phone) reaches each pin by
 * keyboard. The projects with no pin wait in a list; a person who may edit a project sets its pin in a sheet, and a person who may
 * not sees the leader to ask (PRJ-20). The Leader, Client and Team filters apply, as to every number of the Dashboard.
 */
export function DashboardMap({ filters }: { filters: DashboardFilters }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const phone = useIsPhone();
  const headingId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [unpinnedOpen, setUnpinnedOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  // The open projects are the active and the paused ones: the same rule as the Open space (INT-11).
  const projects = useCall('projects.list', { status: 'all', sort: 'name', ...filters });
  const save = useUndoable('projects.update', {
    message: () => t('map.pinSheet.saved'),
    onSuccess: () => setEditing(null),
  });
  const rows = (projects.data ?? []).filter((row) => isLive(row.project.status));
  const pinned = rows.flatMap((row) => (row.geo ? [{ row, point: row.geo }] : []));
  const unpinned = rows.filter((row) => row.geo === null);
  const current = pinned.find((item) => item.row.project.id === selected);
  const pins = pinned.map(({ row, point }) => ({ id: row.project.id, point, label: row.project.name }));
  const canEditSome = unpinned.some((row) => row.viewerCan.editDetails);
  // The card sits in a sheet on a phone, and when the map cannot show it next to the pin.
  const cardInSheet = phone || mapFailed;

  return (
    <div className="flex flex-col gap-4">
      {!MapCanvas && <p className="text-subheadline text-ink-2">{t('map.dashboard.note')}</p>}
      {projects.data && rows.length === 0 && <p className="text-subheadline text-ink-2">{t('map.dashboard.none')}</p>}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {MapCanvas && (
              <Suspense fallback={<div className="h-96" />}>
                <MapCanvas
                  pins={pins}
                  fullscreen
                  fitTo="pins"
                  onPinClick={setSelected}
                  onFailedChange={setMapFailed}
                  selectedId={selected}
                  renderPin={(pin, isSelected) => {
                    const item = pinned.find(({ row }) => row.project.id === pin.id);
                    if (!item) return null;
                    const { row } = item;
                    const health = row.health?.value;
                    return (
                      <ProjectPin
                        id={row.project.id}
                        mark={row.project.mark}
                        subCompanyId={row.subCompanyId}
                        sign={health === 'late' || health === 'at_risk' ? health : null}
                        selected={isSelected}
                      />
                    );
                  }}
                  renderPopup={cardInSheet ? undefined : (id) => {
                    const item = pinned.find(({ row }) => row.project.id === id);
                    return item ? <MapPinCard summary={item.row} /> : null;
                  }}
                  onPopupClose={() => setSelected(null)}
                />
              </Suspense>
            )}
            {/* Without the map, the card shows under the list: the person still reaches the project. */}
            {current && !MapCanvas && <MapPinCard summary={current.row} />}
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
                        <span dir="ltr" className="tabular text-footnote text-ink-2 [text-align:start]">{projectKey(row.project.code)}</span>
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
            <>
              {!canEditSome && <p className="text-subheadline text-ink-2">{t('map.dashboard.askLeader')}</p>}
              <ul className="hairline flex flex-col">
                {unpinned.map((row) => (
                  <li key={row.project.id} className="flex min-h-14 items-center gap-3 py-2">
                    <ProjectTile id={row.project.id} mark={row.project.mark} size={28} subCompanyId={row.subCompanyId} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <bdi dir="auto" className="break-words text-subheadline font-semibold text-ink">{row.project.name}</bdi>
                      <span dir="ltr" className="tabular text-footnote text-ink-2 [text-align:start]">{projectKey(row.project.code)}</span>
                      {!row.viewerCan.editDetails && row.leader && (
                        <span dir="auto" className="text-footnote text-ink-2">{t('dashboard.meeting.leader', { name: nameOf(row.leader) })}</span>
                      )}
                    </span>
                    {row.viewerCan.editDetails && (
                      <Button aria-label={t('map.dashboard.setPinFor', { name: row.project.name })} onClick={() => setEditing(row)}>
                        {t('map.pin.set')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <PinSheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        initial={null}
        description={editing?.project.name}
        busy={save.isPending}
        // The pin and its address go in one write, so one Undo takes both back (owner, 2026-10-19).
        onUse={(point, address) => {
          if (editing) save.mutate({ id: editing.project.id, patch: { geo: point, location: address } });
        }}
      />
      {cardInSheet && MapCanvas && (
        <Sheet open={current !== undefined} onOpenChange={(open) => !open && setSelected(null)} title={current?.row.project.name ?? ''}>
          {current && <MapPinCard summary={current.row} variant="plain" />}
        </Sheet>
      )}
    </div>
  );
}
