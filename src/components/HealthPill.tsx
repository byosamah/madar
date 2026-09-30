import { useTranslation } from 'react-i18next';
import type { ProjectStatus } from '../api/contract/entities';
import type { ProjectSummary, UserCard } from '../api/contract/views';

const TEXT = { on_track: 'text-green-text', at_risk: 'text-orange-text', late: 'text-red-text' } as const;
const DOT = { on_track: 'bg-green', at_risk: 'bg-orange', late: 'bg-red' } as const;

/** The health word always sits next to its color (spec 4.2). A project that is not active shows its status instead. */
export function HealthPill({ health, status, setBy }: { health: ProjectSummary['health']; status: ProjectStatus; setBy: UserCard | null }) {
  const { t } = useTranslation();
  if (!health) {
    return (
      <span className="inline-flex min-h-6 items-center rounded-full bg-fill px-2.5 text-caption font-semibold text-label-2">
        {t(`status.${status}`)}
      </span>
    );
  }
  return (
    <span
      title={health.overridden && health.reason ? health.reason : undefined}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full bg-fill px-2.5 text-caption font-semibold ${TEXT[health.value]}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${DOT[health.value]}`} />
      {t(`health.${health.value}`)}
      {health.overridden && setBy && <span className="font-normal text-label-2">{t('health.setBy', { name: setBy.name })}</span>}
    </span>
  );
}
