import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { ProjectPin } from '../../map/ProjectPin';

// The real build only: the prototype has no street map, and its bundle must not hold the map code (check-bundles).
const MapCanvas = import.meta.env.VITE_MADAR_API === 'remote' ? lazy(() => import('../../map/MapCanvas')) : null;

/**
 * The place of the project on a small street map, at the top of About, where the cover picture was (owner, 2026-10-19: "the map is
 * better"). It shows only when the project has a pin, so a project with no pin gets no empty box. A button opens it full screen.
 */
export function ProjectPlace({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const point = detail.geo;
  if (!MapCanvas || !point) return null;
  const { project } = detail;
  const health = detail.health?.value;
  return (
    <Suspense fallback={<div className="h-56" />}>
      <MapCanvas
        pins={[{ id: project.id, point, label: project.name }]}
        compact
        fullscreen
        label={t('map.overview.label')}
        renderPin={() => (
          <ProjectPin
            id={project.id}
            mark={project.mark}
            subCompanyId={detail.subCompanyId}
            sign={health === 'late' || health === 'at_risk' ? health : null}
            selected={false}
          />
        )}
      />
    </Suspense>
  );
}
